import { describe, expect, it } from "vitest";
import { ModelRouter } from "@/lib/llm/router";
import type { OpenAICompatClient } from "@/lib/llm/openai-compat";
import type { ModelEntry, StreamEvent } from "@/lib/llm/types";

const entry = (
  key: string,
  provider: ModelEntry["provider"],
  tier: ModelEntry["tier"],
  ttft: number,
  caps?: Partial<ModelEntry["caps"]>,
): ModelEntry => ({
  key,
  provider,
  modelId: `${key}-id`,
  label: key,
  tier,
  caps: { tools: true, json: true, vision: false, reasoning: false, ...caps },
  contextWindow: null,
  verified: true,
  probe: { ttftMs: ttft, totalMs: ttft + 10, toolCallOk: caps?.tools ?? true, jsonOk: true, at: "t" },
});

function fakeClient(events: StreamEvent[], delayFirstMs = 0): OpenAICompatClient {
  return {
    provider: "groq",
    chatStream: async function* () {
      let first = true;
      for (const ev of events) {
        if (first && delayFirstMs) {
          await new Promise((r) => setTimeout(r, delayFirstMs));
        }
        first = false;
        yield ev;
      }
    },
  } as unknown as OpenAICompatClient;
}

const ok = (text = "hi"): StreamEvent[] => [
  { type: "text", text },
  { type: "done", finishReason: "stop" },
];

describe("ModelRouter", () => {
  it("orders candidates by EWMA/probe TTFT within a route", () => {
    const models = [
      entry("slow", "groq", "fast", 2000),
      entry("quick", "nvidia", "fast", 100),
      entry("mid", "openrouter", "balanced", 800),
    ];
    const r = new ModelRouter({ models, clientFor: () => null });
    const keys = r.candidates("chat", "auto-fast").map((m) => m.key);
    expect(keys).toEqual(["quick", "mid", "slow"]);
  });

  it("research route requires tool-capable probe-verified models, prefers balanced+", () => {
    const models = [
      entry("notools", "groq", "balanced", 50, { tools: false }),
      entry("fasttools", "nvidia", "fast", 60),
      entry("baltools", "openrouter", "balanced", 500),
    ];
    const r = new ModelRouter({ models, clientFor: () => null });
    const keys = r.candidates("research", "auto-fast").map((m) => m.key);
    expect(keys).toEqual(["baltools", "fasttools"]);
  });

  it("manual mode puts the chosen model first", () => {
    const models = [
      entry("a", "groq", "fast", 100),
      entry("b", "nvidia", "fast", 500),
    ];
    const r = new ModelRouter({ models, clientFor: () => null });
    expect(r.candidates("chat", "manual:b")[0]!.key).toBe("b");
  });

  it("streams from the top candidate and reports telemetry", async () => {
    const models = [entry("a", "groq", "fast", 50)];
    const r = new ModelRouter({
      models,
      clientFor: () => fakeClient(ok("hello")),
      hedgeMs: 20,
    });
    const events = [];
    for await (const ev of r.chat(
      { messages: [{ role: "user", content: "hi" }] },
      "chat",
      "auto-fast",
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "text" && e.text === "hello")).toBe(true);
    const tel = events.find((e) => e.type === "telemetry");
    expect(tel).toBeTruthy();
    expect(tel && "telemetry" in tel ? tel.telemetry.model : "").toBe("a-id");
  });

  it("fails over to the next candidate on a pre-content error", async () => {
    const models = [entry("bad", "groq", "fast", 10), entry("good", "nvidia", "fast", 20)];
    const r = new ModelRouter({
      models,
      hedgeMs: 5,
      clientFor: (m) =>
        m.key === "bad"
          ? fakeClient([{ type: "error", error: { kind: "rate_limit", message: "429", retryable: true } }])
          : fakeClient(ok("recovered")),
    });
    const events = [];
    for await (const ev of r.chat(
      { messages: [{ role: "user", content: "hi" }] },
      "chat",
      "auto-fast",
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "model_switch")).toBe(true);
    expect(events.some((e) => e.type === "text" && e.text === "recovered")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("hedges a slow chat primary and the faster other-provider stream wins", async () => {
    const models = [
      entry("slow", "groq", "fast", 10),
      entry("quick", "nvidia", "fast", 20),
    ];
    const r = new ModelRouter({
      models,
      hedgeMs: 15,
      clientFor: (m) =>
        m.key === "slow"
          ? fakeClient(ok("late"), 500) // first event after 500ms
          : fakeClient(ok("hedge-won"), 1),
    });
    const events = [];
    for await (const ev of r.chat(
      { messages: [{ role: "user", content: "hi" }] },
      "chat",
      "auto-fast",
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "hedged" && e.winner === "quick")).toBe(true);
    expect(events.some((e) => e.type === "text" && e.text === "hedge-won")).toBe(true);
    expect(events.some((e) => e.type === "text" && e.text === "late")).toBe(false);
  });

  it("does not hedge in manual mode", async () => {
    const models = [
      entry("slow", "groq", "fast", 10),
      entry("quick", "nvidia", "fast", 20),
    ];
    const r = new ModelRouter({
      models,
      hedgeMs: 1,
      clientFor: () => fakeClient(ok("x"), 100),
    });
    const events = [];
    for await (const ev of r.chat(
      { messages: [{ role: "user", content: "hi" }] },
      "chat",
      "manual:slow",
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "hedged")).toBe(false);
  });

  it("emits a terminal error when every candidate fails", async () => {
    const models = [entry("a", "groq", "fast", 10)];
    const r = new ModelRouter({
      models,
      clientFor: () =>
        fakeClient([{ type: "error", error: { kind: "http", message: "500", retryable: true } }]),
    });
    const events = [];
    for await (const ev of r.chat(
      { messages: [{ role: "user", content: "hi" }] },
      "chat",
      "auto-fast",
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "telemetry")).toBe(true);
  });
});
