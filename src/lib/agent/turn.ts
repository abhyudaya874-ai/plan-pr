import { readdirSync } from "node:fs";
import path from "node:path";
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
import { buildSystemPrompt } from "@/lib/prompts/system";
import { type SseWriter } from "@/lib/agent/events";
import { runLoop } from "@/lib/agent/loop";
import { makeClient } from "@/lib/llm/providers";
import { ModelRouter } from "@/lib/llm/router";
import { loadRegistry, verifiedModels } from "@/lib/llm/registry";
import type { ChatMessage, RouteMode } from "@/lib/llm/types";
import { toolMap } from "@/lib/tools";

function listWorkspaceFilesSafe(sessionId: string): string[] {
  try {
    const dir = path.join(process.cwd(), "workspace", sessionId);
    return readdirSync(dir).slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * One full chat turn: intent routing -> context -> tool loop -> persist.
 * Shared by /api/chat AND /api/redteam (the arcade must hit the real path,
 * not a shadow implementation).
 */
export async function runTurn(
  sessionId: string,
  message: string,
  userMode: "chat" | "research",
  modelKey: string | undefined,
  sse: SseWriter,
  signal: AbortSignal,
) {
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
  return result;
}
