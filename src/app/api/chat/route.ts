import { readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendMessage,
  countMessages,
  kvGet,
  kvSet,
  loadHistory,
  loadOlderMessages,
} from "@/lib/db";
import { buildSessionContext } from "@/lib/agent/context";
import { classifyWithLlm, routeByHeuristics, type ChatRoute } from "@/lib/agent/intent";
import { SseWriter, type ServerEvent } from "@/lib/agent/events";
import { runLoop } from "@/lib/agent/loop";
import { buildSystemPrompt } from "@/lib/prompts/system";
import { toolMap } from "@/lib/tools";
import { ModelRouter } from "@/lib/llm/router";
import { makeClient } from "@/lib/llm/providers";
import { loadRegistry, verifiedModels } from "@/lib/llm/registry";
import { workspaceFor } from "@/lib/workspace";
import { env } from "@/lib/env";
import type { ChatMessage, RouteMode } from "@/lib/llm/types";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(8000),
  mode: z.enum(["chat", "research"]).default("chat"),
  modelKey: z.string().max(160).optional(),
});

/** Tiny per-IP token bucket (20 req/min). */
const buckets = new Map<string, { tokens: number; reset: number }>();
function rateOk(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: 20, reset: now + 60_000 };
  if (now > b.reset) {
    b.tokens = 20;
    b.reset = now + 60_000;
  }
  buckets.set(ip, b);
  if (b.tokens <= 0) return false;
  b.tokens--;
  return true;
}

const encoder = new TextEncoder();

/** GET /api/chat?sessionId -> prior turns for refresh-resume. */
export async function GET(req: Request): Promise<Response> {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || sessionId.length > 128) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const rows = loadHistory(sessionId, 60)
    .slice()
    .reverse()
    .map((r) => {
      let meta: Record<string, unknown> | null = null;
      try {
        meta = r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null;
      } catch {
        meta = null;
      }
      // internal work-log stays in DB for context; strip it from display
      const content = r.content.replace(/\n?\[files changed: [^\]]*\]/g, "");
      return { role: r.role, content, bridge: meta?.bridge ?? null };
    });
  return Response.json({ messages: rows });
}

export async function POST(req: Request): Promise<Response> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateOk(ip)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "bad_request", detail: parsed.error.message },
      { status: 400 },
    );
  }
  const { sessionId, message, mode, modelKey } = parsed.data;

  if (env().llmMissing) {
    return Response.json(
      { error: "no_llm_provider", detail: "Set at least one LLM API key in .env" },
      { status: 503 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const captured: ServerEvent[] = [];
      const sse = new SseWriter(
        (chunk) => controller.enqueue(encoder.encode(chunk)),
        (ev) => captured.push(ev),
      );
      const abort = () => {
        sse.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", abort, { once: true });

      // First event well under 100ms: optimistic "Understanding".
      sse.emit({ type: "step", kind: "understand", label: "Understanding", status: "running", t: 0 });

      void (async () => {
        try {
          await handle(sessionId, message, mode, modelKey, sse, req.signal);
          autoSave(sessionId, captured);
        } catch (e) {
          if (!req.signal.aborted) {
            sse.emit({
              type: "error",
              code: "internal",
              message: "Something went wrong on our side; please retry.",
            });
            console.error("[chat] unhandled", e);
          }
        } finally {
          sse.emit({ type: "step", kind: "understand", label: "Understanding", status: "done", t: 0 });
          req.signal.removeEventListener("abort", abort);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handle(
  sessionId: string,
  message: string,
  userMode: "chat" | "research",
  modelKey: string | undefined,
  sse: SseWriter,
  signal: AbortSignal,
): Promise<void> {
  const tools = toolMap();
  const models = verifiedModels({ fresh: true });
  const router = new ModelRouter({
    models,
    clientFor: (m) => makeClient(m.provider),
    defaults: loadRegistry().defaults,
  });

  // ---- routing decision ----------------------------------------------------
  let intent = routeByHeuristics(message);
  if (userMode === "research") {
    intent = { ...intent, route: "research", confidence: 1, needsTools: true };
  }
  if (intent.confidence < 0.6) {
    const classified = await classifyWithLlm(message, async (prompt) => {
      let out = "";
      for await (const ev of router.chat(
        {
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          maxTokens: 80,
          responseFormat: { type: "json_object" },
        },
        "check",
        "auto-fast",
        { signal },
      )) {
        if (ev.type === "text") out += ev.text;
      }
      return out;
    });
    if (classified) intent = { ...classified, source: "classifier" };
  }
  const route: ChatRoute = intent.route;
  const mode: RouteMode = modelKey ? `manual:${modelKey}` : "auto-fast";

  // ---- context + history ----------------------------------------------------
  const historyRows = loadHistory(sessionId, 12);
  const history: ChatMessage[] = historyRows
    .slice()
    .reverse()
    .map((r) => ({ role: r.role as ChatMessage["role"], content: r.content }));

  const total = countMessages(sessionId);
  let summaryPrefix = "";
  if (total > historyRows.length) {
    const summaryKey = `summary:${sessionId}`;
    const summarizedUpto = Number(kvGet(`${summaryKey}:upto`) ?? "0");
    const oldestShown = historyRows[0]?.id ?? 0;
    const existing = kvGet(summaryKey);
    if (existing && summarizedUpto >= oldestShown - 1) {
      summaryPrefix = `Earlier in this conversation (summary): ${existing}\n\n`;
    } else {
      // cheap rolling summary of the older turns
      const older = loadOlderMessages(sessionId, oldestShown);
      const digest = older
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join("\n")
        .slice(0, 6000);
      if (digest) {
        let sum = "";
        for await (const ev of router.chat(
          {
            messages: [
              {
                role: "user",
                content: `Summarize this conversation digest in <=120 words, keeping goals/numbers/decisions:\n${digest}`,
              },
            ],
            temperature: 0,
            maxTokens: 200,
          },
          "chat",
          "auto-fast",
          { signal },
        )) {
          if (ev.type === "text") sum += ev.text;
        }
        if (sum.trim()) {
          kvSet(summaryKey, sum.trim());
          kvSet(`${summaryKey}:upto`, String(oldestShown));
          summaryPrefix = `Earlier in this conversation (summary): ${sum.trim()}\n\n`;
        }
      }
    }
  }

  const files = listWorkspaceFilesSafe(sessionId);
  const previousBridge = kvGet(`bridge:${sessionId}`) ?? "none";
  const ctx = buildSessionContext({
    route,
    languageHint: intent.languageHint,
    workspaceFiles: files,
    previousBridgeAngle: previousBridge,
  });
  // Degraded previous turn? The work log with real tool outcomes is already in
  // history — tell the model to synthesize from it, not re-run tools.
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const degradedRetry = (lastAssistant?.content ?? "").includes("Degraded completion");
  const systemPrompt =
    buildSystemPrompt(ctx) +
    (degradedRetry
      ? "\n\nNOTE: the previous turn's tool results are already in the conversation above (the \"Work log\"). Do NOT re-call tools unless new data is genuinely needed — write the answer directly from that work."
      : "") +
    (intent.needsTools || route !== "chat"
      ? `\n\nIf you cannot call tools natively, reply with ONLY {"action":"<tool>","args":{...}} to invoke one.`
      : "");

  appendMessage(sessionId, "user", message);

  const loopMessages: ChatMessage[] = [
    ...history,
    { role: "user", content: summaryPrefix + message },
  ];

  const result = await runLoop(
    {
      router,
      tools,
      sse,
      mode,
      signal,
      sessionId,
    },
    {
      systemPrompt,
      messages: loopMessages,
      route,
      useTools: intent.needsTools || route !== "chat",
    },
  );

  if (result.answer || result.filesChanged.length) {
    // Persist a compact work-log so the next turn's context sees file ops
    // even when the model's own summary was thin or degraded.
    const worklog = result.filesChanged.length
      ? `\n\n[files changed: ${result.filesChanged.join(", ")}]`
      : "";
    appendMessage(sessionId, "assistant", (result.answer || "(files updated)") + worklog, {
      bridge: result.bridge,
      telemetry: result.telemetry.at(-1),
    });
  }
  if (result.bridge) {
    kvSet(`bridge:${sessionId}`, result.bridge.slice(0, 120));
    sse.emit({ type: "bridge", text: result.bridge });
  }
  sse.emit({
    type: "done",
    messageId: `${sessionId}:${Date.now()}`,
    sources: result.cited,
    files: result.filesChanged,
  });
}

/** Quiet audit writes after every turn (rule 40): trace, sources, telemetry. */
function autoSave(sessionId: string, events: ServerEvent[]): void {
  try {
    const ws = workspaceFor(sessionId);
    const trace = events
      .map((e) => {
        const { id: _id, ...rest } = e;
        return JSON.stringify(rest);
      })
      .join("\n");
    ws.write("trace.txt", trace + "\n");

    const sources = events
      .filter((e) => e.type === "source")
      .map((e) => (e as unknown as { source: Record<string, unknown> }).source);
    if (sources.length) {
      const csv =
        "n,url,title,domain,retrievedAt,via\n" +
        sources
          .map((s) =>
            [s.n, s.url, s.title, s.domain, s.retrievedAt, s.via]
              .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
              .join(","),
          )
          .join("\n") +
        "\n";
      ws.write("sources.csv", csv);
    }

    const telemetry = events.filter((e) => e.type === "telemetry");
    if (telemetry.length) {
      const prev = exists(ws, "telemetry.jsonl")
        ? ws.read("telemetry.jsonl").content
        : "";
      ws.write(
        "telemetry.jsonl",
        prev + telemetry.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
    }
  } catch {
    /* audit writes must never break the chat */
  }
}

function exists(ws: ReturnType<typeof workspaceFor>, p: string): boolean {
  try {
    ws.read(p);
    return true;
  } catch {
    return false;
  }
}

function listWorkspaceFilesSafe(sessionId: string): string[] {
  try {
    const dir = path.join(process.cwd(), "workspace", sessionId);
    return readdirSync(dir).slice(0, 20);
  } catch {
    return [];
  }
}
