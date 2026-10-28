import { describe, expect, it } from "vitest";
import { OpenAICompatClient } from "@/lib/llm/openai-compat";
import type { StreamEvent } from "@/lib/llm/types";

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status });
}

function clientWith(res: Response | (() => Promise<Response>)) {
  const fetchFn =
    typeof res === "function" ? res : async () => res;
  return new OpenAICompatClient(
    { provider: "groq", baseUrl: "https://x.test/v1", apiKey: "k" },
    { fetchFn: fetchFn as typeof fetch, idleTimeoutMs: 300 },
  );
}

async function drain(
  c: OpenAICompatClient,
  req?: Parameters<OpenAICompatClient["chatStream"]>[0],
): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of c.chatStream(
    req ?? { modelId: "m", messages: [{ role: "user", content: "hi" }] },
  )) {
    out.push(ev);
  }
  return out;
}

const chunk = (delta: object, finish?: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`;

describe("OpenAICompatClient SSE", () => {
  it("streams text deltas then done", async () => {
    const res = sseResponse([
      chunk({ role: "assistant", content: "Hel" }),
      chunk({ content: "lo." }),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    const events = await drain(clientWith(res));
    const texts = events.filter((e) => e.type === "text").map((e) => e.text);
    expect(texts.join("")).toBe("Hello.");
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ usage: { totalTokens: 5 } });
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
  });

  it("ignores comment keep-alive lines and non-data lines", async () => {
    const res = sseResponse([
      ": OPENROUTER PROCESSING\n\n",
      "event: ping\n\n",
      chunk({ content: "ok" }),
    ]);
    const events = await drain(clientWith(res));
    expect(events.filter((e) => e.type === "text").map((e) => e.text).join("")).toBe("ok");
  });

  it("assembles tool-call deltas by index incl. parallel calls", async () => {
    const res = sseResponse([
      chunk({
        tool_calls: [
          { index: 0, id: "a1", type: "function", function: { name: "get_t", arguments: '{"ci' } },
          { index: 1, id: "b2", type: "function", function: { name: "get_w", arguments: '{"x' } },
        ],
      }),
      chunk({
        tool_calls: [
          { index: 0, function: { arguments: 'ty":"Mumbai"}' } },
          { index: 1, function: { arguments: '":1}' } },
        ],
      }),
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    const events = await drain(clientWith(res));
    const calls = events.filter((e) => e.type === "tool_call").map((e) => e.call);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ id: "a1", name: "get_t", argsJson: '{"city":"Mumbai"}' });
    expect(calls[1]).toMatchObject({ id: "b2", name: "get_w", argsJson: '{"x":1}' });
  });

  it("yields rate_limit error on 429 and keeps going", async () => {
    const res = new Response("rate limited", { status: 429 });
    const events = await drain(clientWith(res));
    expect(events[0]).toMatchObject({
      type: "error",
      error: { kind: "rate_limit", retryable: true },
    });
  });

  it("yields http error on 400, non-retryable", async () => {
    const events = await drain(clientWith(new Response("bad", { status: 400 })));
    expect(events[0]).toMatchObject({
      type: "error",
      error: { kind: "http", retryable: false },
    });
  });

  it("flags empty streams", async () => {
    const events = await drain(clientWith(sseResponse(["data: [DONE]\n\n"])));
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "empty_stream" } });
  });

  it("sends the expected request body", async () => {
    let seen = "";
    const fetchFn = async (_u: unknown, init?: RequestInit) => {
      seen = String(init?.body);
      return sseResponse([chunk({ content: "x" })]);
    };
    const c = new OpenAICompatClient(
      { provider: "openrouter", baseUrl: "https://x.test/v1", apiKey: "k" },
      { fetchFn: fetchFn as typeof fetch },
    );
    await drain(c, {
      modelId: "m1",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      maxTokens: 50,
      tools: [{ type: "function", function: { name: "t", parameters: {} } }],
      toolChoice: "auto",
    });
    const body = JSON.parse(seen) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "m1",
      stream: true,
      temperature: 0.2,
      max_tokens: 50,
      tool_choice: "auto",
    });
    expect(Array.isArray(body.tools)).toBe(true);
  });
});
