import { z } from "zod";
import type { ModelRouter } from "@/lib/llm/router";
import type {
  ChatMessage,
  ChatRequest,
  RouteMode,
  Telemetry,
  ToolDef,
} from "@/lib/llm/types";
import { createTwoFilesPatch } from "diff";
import type { SseWriter, SourceRef, StepKind } from "./events";
import { SourceRegistry, scrubCitations } from "./sources";
import { workspaceFor, type FileChange } from "@/lib/workspace";
import { MUTATING_TOOLS } from "@/lib/tools/files";
import type { Tool, ToolCtx } from "@/lib/tools/registry";

export interface LoopDeps {
  router: ModelRouter;
  tools: Map<string, Tool>;
  sse: SseWriter;
  mode: RouteMode;
  signal?: AbortSignal;
  sessionId: string;
  maxToolRounds?: number;
}

export interface LoopResult {
  /** Answer text WITHOUT the trailing ↪ bridge line. */
  answer: string;
  bridge: string | null;
  toolCallsMade: { name: string; ok: boolean }[];
  telemetry: Telemetry[];
  modelSwitches: number;
  sources: SourceRef[];
  /** [n] values that survived citation validation. */
  cited: number[];
  /** [n] values stripped as invented citations. */
  citationDefects: number[];
  filesChanged: string[];
}

const STEP_FOR_TOOL: Record<string, StepKind> = {
  web_search: "search",
  fetch_url: "read",
  calc: "calc",
  vault_lookup: "vault",
  list_files: "read",
  read_file: "read",
  write_file: "write",
  append_file: "write",
  delete_file: "write",
  export_csv: "write",
  export_zip: "write",
};

const jsonActionSchema = z.object({
  action: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});

/** A lone {"action":...} reply from a model without native tool support. */
function parseJsonAction(text: string): { name: string; args: unknown } | null {
  const t = text.trim();
  if (!t.startsWith("{") || !t.includes('"action"')) return null;
  try {
    const p = jsonActionSchema.safeParse(JSON.parse(t));
    if (!p.success || !p.data.action) return null;
    return { name: p.data.action, args: p.data.args ?? {} };
  } catch {
    return null;
  }
}

/**
 * The agent loop: model <-> tools, max 6 rounds. Streams rule-40 events.
 * Emitted step/tool events show REAL queries/paths (the "traced" view).
 */
export async function runLoop(
  deps: LoopDeps,
  params: {
    systemPrompt: string;
    messages: ChatMessage[];
    route: "chat" | "research" | "reason";
    useTools: boolean;
  },
): Promise<LoopResult> {
  const { router, tools, sse, mode, signal, sessionId } = deps;
  const maxRounds = deps.maxToolRounds ?? 6;
  const messages: ChatMessage[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  const result: LoopResult = {
    answer: "",
    bridge: null,
    toolCallsMade: [],
    telemetry: [],
    modelSwitches: 0,
    sources: [],
    cited: [],
    citationDefects: [],
    filesChanged: [],
  };
  const sourceRegistry = new SourceRegistry();
  let snapDone = false;
  const fileChanges: FileChange[] = [];
  const emittedSources = new Set<string>();

  const toolDefs: ToolDef[] | undefined = params.useTools
    ? [...tools.values()].map((t) => t.def)
    : undefined;

  let stepCounter = 0;
  const emitStep = (kind: StepKind, label: string, status: "running" | "done" | "error", detail?: string, t?: number) => {
    const tt = t ?? stepCounter++;
    sse.emit({ type: "step", kind, label, detail, status, t: tt });
    return tt;
  };

  // Text flushing with a tail hold-back so the ↪ bridge is never emitted as
  // answer tokens: keep the tail until the stream ends.
  let tail = "";
  let finished = false;
  const flushText = (incoming: string, final = false) => {
    let text = tail + incoming;
    tail = "";
    if (final) {
      const idx = text.lastIndexOf("↪");
      if (idx >= 0) {
        result.bridge = text.slice(idx + 1).trim() || null;
        text = text.slice(0, idx);
      }
      if (text) sse.emit({ type: "token", text });
      result.answer = text.trimEnd();
      return;
    }
    const cut = Math.max(0, text.length - 120);
    const emitPart = text.slice(0, cut);
    tail = text.slice(cut);
    if (emitPart) sse.emit({ type: "token", text: emitPart });
  };

  for (let round = 0; round <= maxRounds && !finished; round++) {
    const req: Omit<ChatRequest, "modelId"> = {
      messages,
      tools: toolDefs,
      temperature: 0.2,
      maxTokens: 1200,
    };

    let roundText = "";
    const pendingCalls: { id: string; name: string; argsJson: string }[] = [];
    let sawDone = false;
    let failed = false;
    // Reasoning models emit hundreds of reasoning deltas: collapse to ONE
    // running step, closed on first content/tool call.
    let thinkT: number | null = null;
    const closeThink = () => {
      if (thinkT == null) return;
      sse.emit({ type: "step", kind: "think", label: "Thinking", status: "done", t: thinkT });
      thinkT = null;
    };

    for await (const ev of router.chat(req, params.route, mode, { signal })) {
      if (signal?.aborted) return result;
      switch (ev.type) {
        case "text":
          closeThink();
          roundText += ev.text;
          flushText(ev.text);
          break;
        case "reasoning":
          if (thinkT == null) {
            thinkT = stepCounter++;
            sse.emit({ type: "step", kind: "think", label: "Thinking", status: "running", t: thinkT });
          }
          break;
        case "tool_call":
          closeThink();
          pendingCalls.push(ev.call);
          sse.emit({
            type: "tool_call",
            name: ev.call.name,
            args: safeParse(ev.call.argsJson),
          });
          break;
        case "usage":
          break;
        case "done":
          sawDone = true;
          break;
        case "model_switch":
          result.modelSwitches++;
          emitStep("model_switch", `Model switched: ${ev.from} → ${ev.to}`, "done", ev.reason);
          break;
        case "hedged":
          emitStep("model_switch", `Hedged: ${ev.winner} answered first`, "done");
          break;
        case "telemetry":
          result.telemetry.push(ev.telemetry);
          sse.emit({ type: "telemetry", ...ev.telemetry });
          break;
        case "error":
          failed = true;
          emitStep("think", "Model error", "error", ev.error.message);
          sse.emit({ type: "error", code: ev.error.kind, message: userSafeError(ev.error.message) });
          break;
      }
    }
    closeThink();
    void sawDone;

    // json-action fallback for models without native tool calling.
    if (pendingCalls.length === 0 && params.useTools) {
      const action = parseJsonAction(roundText);
      if (action && tools.has(action.name)) {
        // the emitted tokens were a raw JSON action, not an answer; drop them
        pendingCalls.push({ id: `json_${round}`, name: action.name, argsJson: JSON.stringify(action.args) });
        roundText = "";
        tail = "";
      }
    }

    if (failed) return result;
    if (pendingCalls.length === 0) {
      finished = true;
      break;
    }
    if (round === maxRounds) break;

    // Append the assistant turn carrying the tool calls, then run each tool.
    messages.push({
      role: "assistant",
      content: roundText || null,
      tool_calls: pendingCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.argsJson },
      })),
    });

    const stepIdByCall = new Map<string, StepKind>();
    await Promise.all(
      pendingCalls.map(async (call) => {
        const tool = tools.get(call.name);
        const stepKind = STEP_FOR_TOOL[call.name] ?? "read";
        stepIdByCall.set(call.id, stepKind);
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(call.argsJson || "{}");
        } catch {
          parsedArgs = { __unparsed: call.argsJson };
        }
        const stepT = emitStep(stepKind, stepLabel(call.name, parsedArgs), "running");

        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ error: `unknown tool ${call.name}` }),
          });
          sse.emit({ type: "tool_result", toolCallId: call.id, ok: false, summary: `unknown tool ${call.name}` });
          emitStep(stepKind, stepLabel(call.name, parsedArgs), "error", undefined, stepT);
          result.toolCallsMade.push({ name: call.name, ok: false });
          return;
        }

        // Snapshot once per turn BEFORE the first mutating call (undo).
        if (MUTATING_TOOLS.has(call.name)) {
          if (!snapDone) {
            try {
              const seq = workspaceFor(sessionId).snapshot();
              emitStep("write", `Workspace snapshot #${seq} (undo point)`, "done");
            } catch {
              /* snapshot failure must not block the write */
            }
            snapDone = true;
          }
        }
        const validated = tool.argsSchema.safeParse(parsedArgs);
        const ctx: ToolCtx = { sessionId, signal, sources: sourceRegistry };
        let exec;
        if (!validated.success) {
          // One repair chance comes free: the error goes back to the model as
          // data (next round can retry with corrected args).
          exec = {
            ok: false,
            resultText: `invalid arguments: ${validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          } as const;
        } else {
          try {
            exec = await tool.run(validated.data, ctx);
          } catch (e) {
            exec = {
              ok: false,
              resultText: `tool error: ${e instanceof Error ? e.message : String(e)}`,
            } as const;
          }
        }

        result.toolCallsMade.push({ name: call.name, ok: exec.ok });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: `<tool_result tool="${call.name}" untrusted="true">${exec.resultText}</tool_result>`,
        });
        // Web evidence: surface sources BEFORE the answer continues streaming.
        // Re-registrations (same canonicalUrl) are deduped: emit each once.
        const execSources = (exec.data?.sources ?? []) as SourceRef[];
        for (const s of execSources) {
          if (emittedSources.has(s.canonicalUrl)) continue;
          emittedSources.add(s.canonicalUrl);
          sse.emit({ type: "source", source: s });
        }
        // File changes: unified diff per file, capped for the wire.
        const changes = (exec.data?.fileChanges ?? []) as FileChange[];
        for (const c of changes) {
          fileChanges.push(c);
          const diff =
            c.op === "delete"
              ? `--- a/${c.path}\n+++ /dev/null\n`
              : createTwoFilesPatch(
                  `a/${c.path}`,
                  `b/${c.path}`,
                  (c.before ?? "").slice(0, 20_000),
                  (c.after ?? "").slice(0, 20_000),
                );
          sse.emit({
            type: "file_change",
            path: c.path,
            op: c.op,
            before: c.before?.slice(0, 20_000),
            after: c.after?.slice(0, 20_000),
            diff,
            bytes: c.bytes,
            by: c.by,
            t: Date.now(),
          });
        }
        if (exec.data?.injectionFlagged) {
          emitStep("think", "Possible prompt-injection in fetched content (flagged)", "done");
        }
        sse.emit({ type: "tool_result", toolCallId: call.id, ok: exec.ok, summary: summarize(exec.resultText) });
        emitStep(stepKind, stepLabel(call.name, parsedArgs), exec.ok ? "done" : "error", undefined, stepT);
      }),
    );
  }

  flushText("", true);

  // Citation post-processing: strip invented [n] markers (invariant I2).
  const scrub = scrubCitations(result.answer, sourceRegistry);
  result.answer = scrub.text;
  result.cited = scrub.cited;
  result.citationDefects = scrub.defects;
  result.sources = sourceRegistry.all();
  result.filesChanged = fileChanges.map((c) => c.path);
  if (scrub.defects.length) {
    emitStep(
      "think",
      `Removed ${scrub.defects.length} uncited marker(s) (no matching source)`,
      "done",
    );
  }
  return result;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function stepLabel(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case "web_search":
      return `Searching: ${String(a.query ?? "")}`;
    case "fetch_url":
      return `Reading: ${String(a.url ?? "")}`;
    case "calc":
      return `Calculating: ${String(a.expression ?? "")}`;
    case "vault_lookup":
      return `Vault: ${String(a.field ?? "")} of ${String(a.scheme ?? "")}`;
    case "write_file":
    case "append_file":
    case "export_csv":
      return `Writing ${String(a.path ?? "")}`;
    case "read_file":
      return `Reading ${String(a.path ?? "")}`;
    case "list_files":
      return "Listing workspace files";
    default:
      return name;
  }
}

function summarize(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? t.slice(0, 157) + "…" : t;
}

function userSafeError(msg: string): string {
  // never surface raw provider errors or internals
  if (/rate.?limit|429/i.test(msg)) return "That model was rate-limited; trying another.";
  if (/idle|timeout/i.test(msg)) return "That model was too slow; trying another.";
  if (/auth|401|403/i.test(msg)) return "A provider rejected its key; trying another.";
  return "The model hit an error; trying another or retry shortly.";
}
