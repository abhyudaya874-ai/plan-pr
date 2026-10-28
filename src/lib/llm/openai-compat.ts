import { z } from "zod";
import type {
  ChatRequest,
  CompletedToolCall,
  LlmError,
  ProviderId,
  StreamEvent,
} from "./types";

export interface ProviderConfig {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  /** Extra headers (e.g. OpenRouter app attribution). */
  headers?: Record<string, string>;
}

export interface ClientOptions {
  /** Injectable for fixture tests. */
  fetchFn?: typeof fetch;
  /** Stream idle timeout; any SSE activity (incl. comments) resets it. */
  idleTimeoutMs?: number;
  /** Connect timeout. */
  connectTimeoutMs?: number;
}

const DEFAULT_IDLE_MS = 15_000;
const DEFAULT_CONNECT_MS = 30_000;

const sseDataSchema = z.object({
  choices: z
    .array(
      z.object({
        index: z.number().optional(),
        delta: z
          .object({
            role: z.string().optional(),
            content: z.string().nullable().optional(),
            reasoning: z.string().nullable().optional(),
            reasoning_content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().optional(),
                  id: z.string().optional(),
                  type: z.string().optional(),
                  function: z
                    .object({
                      name: z.string().optional(),
                      arguments: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .nullable()
    .optional(),
  error: z
    .object({ message: z.string().optional(), code: z.unknown().optional() })
    .optional(),
});

const modelsResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        context_length: z.number().optional(), // OpenRouter
        context_window: z.number().optional(), // some providers
        supported_parameters: z.array(z.string()).optional(), // OpenRouter
        architecture: z
          .object({ modality: z.string().optional() })
          .passthrough()
          .optional(), // OpenRouter
      })
      .passthrough(),
  ),
});

export interface ListedModel {
  id: string;
  contextWindow: number | null;
  supportsTools: boolean | null;
  supportsStructuredOutputs: boolean | null;
  modality: string | null;
}

function toError(kind: LlmError["kind"], message: string, opts?: Partial<LlmError>): LlmError {
  return { kind, message, retryable: false, ...opts };
}

/**
 * One thin OpenAI-compatible chat client per provider. fetch + SSE only, no
 * SDK. All stream activity (including `:` comment keep-alives that OpenRouter
 * emits) resets the idle timer.
 */
export class OpenAICompatClient {
  readonly provider: ProviderId;
  private readonly cfg: ProviderConfig;
  private readonly fetchFn: typeof fetch;
  private readonly idleMs: number;
  private readonly connectMs: number;

  constructor(cfg: ProviderConfig, opts: ClientOptions = {}) {
    this.cfg = cfg;
    this.provider = cfg.provider;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    this.connectMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      ...this.cfg.headers,
    };
  }

  async listModels(): Promise<ListedModel[]> {
    const url = `${this.cfg.baseUrl}/models`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.connectMs),
      });
    } catch (e) {
      throw toError("network", `listModels ${this.provider}: ${String(e)}`, {
        retryable: true,
      });
    }
    if (!res.ok) {
      throw toError(
        res.status === 429 ? "rate_limit" : "http",
        `listModels ${this.provider} HTTP ${res.status}`,
        { status: res.status, retryable: res.status === 429 || res.status >= 500 },
      );
    }
    const parsed = modelsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw toError("bad_response", `listModels ${this.provider}: schema mismatch`);
    }
    return parsed.data.data.map((m) => ({
      id: m.id,
      contextWindow: m.context_length ?? m.context_window ?? null,
      supportsTools: m.supported_parameters
        ? m.supported_parameters.includes("tools")
        : null,
      supportsStructuredOutputs: m.supported_parameters
        ? m.supported_parameters.includes("structured_outputs") ||
          m.supported_parameters.includes("response_format")
        : null,
      modality: m.architecture?.modality ?? null,
    }));
  }

  /**
   * Streaming chat. Yields text deltas, assembled tool calls, usage, done.
   * Errors are yielded as {type:"error"} then the generator returns - callers
   * never see thrown exceptions mid-stream.
   */
  async *chatStream(
    req: ChatRequest,
    outerSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort(outerSignal?.reason);
    outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => controller.abort(new Error("idle_timeout")),
        this.idleMs,
      );
    };

    let res: Response;
    try {
      bumpIdle();
      const body: Record<string, unknown> = {
        model: req.modelId,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.tools?.length) body.tools = req.tools;
      if (req.toolChoice !== undefined) body.tool_choice = req.toolChoice;
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.maxTokens !== undefined) {
        // Groq deprecates max_tokens in favour of max_completion_tokens; it
        // still accepts max_tokens, and the other providers ignore unknowns.
        body.max_tokens = req.maxTokens;
      }
      if (req.responseFormat) body.response_format = req.responseFormat;

      res = await this.fetchFn(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (idleTimer) clearTimeout(idleTimer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
      yield {
        type: "error",
        error: this.classifyAbort(e, `chat ${this.provider}/${req.modelId}: ${String(e)}`),
      };
      return;
    }

    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => "");
      if (idleTimer) clearTimeout(idleTimer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
      yield { type: "error", error: this.classifyHttp(res.status, errBody) };
      return;
    }

    // --- SSE parse -----------------------------------------------------------
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawAnyData = false;
    let finishReason: string | null = null;
    const pendingTools = new Map<number, { id: string; name: string; args: string }>();

    const emitToolCalls = function* (): Generator<StreamEvent> {
      for (const [idx, t] of [...pendingTools.entries()].sort((a, b) => a[0] - b[0])) {
        const call: CompletedToolCall = {
          id: t.id || `call_${idx}`,
          name: t.name,
          argsJson: t.args || "{}",
        };
        yield { type: "tool_call", call };
      }
      pendingTools.clear();
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bumpIdle();
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line.
        let sepIdx: number;
        for (;;) {
          const lf = buffer.indexOf("\n\n");
          const crlf = buffer.indexOf("\r\n\r\n");
          sepIdx = lf === -1 ? crlf : crlf === -1 ? lf : Math.min(lf, crlf);
          if (sepIdx === -1) break;
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + (buffer.startsWith("\r\n\r\n", sepIdx) ? 4 : 2));

          for (const line of rawEvent.split(/\r?\n/)) {
            if (line.startsWith(":")) continue; // comment / keep-alive
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            sawAnyData = true;

            let json: unknown;
            try {
              json = JSON.parse(payload);
            } catch {
              continue; // non-JSON data line: ignore, keep streaming
            }
            const parsed = sseDataSchema.safeParse(json);
            if (!parsed.success) continue;
            const chunk = parsed.data;

            if (chunk.error) {
              yield {
                type: "error",
                error: toError("bad_response", chunk.error.message ?? "upstream error", {
                  retryable: true,
                }),
              };
            }
            if (chunk.usage) {
              yield {
                type: "usage",
                usage: {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens,
                },
              };
            }
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta?.content) yield { type: "text", text: delta.content };
            const reasoning = delta?.reasoning ?? delta?.reasoning_content;
            if (reasoning) yield { type: "reasoning", text: reasoning };

            for (const tc of delta?.tool_calls ?? []) {
              const idx = tc.index ?? 0;
              const acc = pendingTools.get(idx) ?? { id: "", name: "", args: "" };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
              pendingTools.set(idx, acc);
            }
            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
              if (finishReason === "tool_calls") yield* emitToolCalls();
            }
          }
        }
      }
      // Some providers end tool calls without a tool_calls finish_reason.
      if (pendingTools.size > 0) yield* emitToolCalls();
      if (!sawAnyData) {
        yield {
          type: "error",
          error: toError("empty_stream", `${this.provider}/${req.modelId}: stream ended with no data`, { retryable: true }),
        };
        return;
      }
      yield { type: "done", finishReason };
    } catch (e) {
      yield {
        type: "error",
        error: this.classifyAbort(e, `chat ${this.provider}/${req.modelId}: ${String(e)}`),
      };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
      try {
        await reader.cancel();
      } catch {
        /* reader may already be released */
      }
    }
  }

  private classifyHttp(status: number, body: string): LlmError {
    const retryAfter = /retry[- ]after[:=]\s*(\d+)/i.exec(body)?.[1];
    const base = {
      status,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
    };
    if (status === 429) {
      return toError("rate_limit", `HTTP 429 rate limited`, { ...base, retryable: true });
    }
    if (status === 401 || status === 403) {
      return toError("http", `HTTP ${status} auth/permission`, { ...base, retryable: false });
    }
    if (status >= 500) {
      return toError("http", `HTTP ${status} upstream`, { ...base, retryable: true });
    }
    return toError("http", `HTTP ${status}`, { ...base, retryable: false });
  }

  private classifyAbort(e: unknown, fallback: string): LlmError {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("idle_timeout")) {
      return toError("idle_timeout", "stream idle timeout", { retryable: true });
    }
    if (e instanceof DOMException && e.name === "AbortError") {
      return toError("aborted", "request aborted", { retryable: false });
    }
    if (msg.includes("abort")) {
      return toError("aborted", "request aborted", { retryable: false });
    }
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return toError("timeout", "connect timeout", { retryable: true });
    }
    return toError("network", fallback, { retryable: true });
  }
}
