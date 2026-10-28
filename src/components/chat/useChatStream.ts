"use client";

import { useCallback, useRef, useState } from "react";

/** Mirrors src/lib/agent/events.ts (client copy - keep in sync). */
export interface StepEvent {
  type: "step";
  id: number;
  kind: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
  t: number;
}
export interface SourceRef {
  n: number;
  url: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  snippet: string;
  retrievedAt: string;
  via: string;
  quote?: string;
}
export interface FileChangeEv {
  type: "file_change";
  path: string;
  op: "create" | "modify" | "delete";
  before?: string;
  after?: string;
  diff: string;
  bytes: number;
  by: string;
}
export interface Telemetry {
  route: string;
  provider: string;
  model: string;
  ttftMs: number;
  totalMs: number;
  tokensIn: number;
  tokensOut: number;
  retries: number;
  hedged: boolean;
}
interface Ev {
  type: string;
  id?: number;
  [k: string]: unknown;
}

export interface ToolCallItem {
  name: string;
  args: unknown;
  ok?: boolean;
  summary?: string;
}

export interface Turn {
  id: string;
  userText: string;
  startedAt: number;
  text: string;
  steps: StepEvent[];
  sources: SourceRef[];
  toolCalls: ToolCallItem[];
  fileChanges: FileChangeEv[];
  bridge: string | null;
  telemetry: Telemetry | null;
  cited: number[];
  done: boolean;
  error: string | null;
}

export type StreamAction = { type: "reset" };

function blankTurn(userText: string): Turn {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userText,
    startedAt: Date.now(),
    text: "",
    steps: [],
    sources: [],
    toolCalls: [],
    fileChanges: [],
    bridge: null,
    telemetry: null,
    cited: [],
    done: false,
    error: null,
  };
}

/** Single reducer handling EVERY event kind; unknown kinds are ignored. */
export function applyEvent(turn: Turn, ev: Ev): Turn {
  switch (ev.type) {
    case "step": {
      const s = ev as unknown as StepEvent;
      const steps = turn.steps.filter((x) => !(x.kind === s.kind && x.t === s.t));
      return { ...turn, steps: [...steps, s] };
    }
    case "source": {
      const s = (ev as unknown as { source: SourceRef }).source;
      // the registry re-emits on re-registration (e.g. fetch_url of a search hit)
      if (turn.sources.some((x) => x.canonicalUrl === s.canonicalUrl || x.n === s.n)) {
        return turn;
      }
      return { ...turn, sources: [...turn.sources, s] };
    }
    case "token":
      return { ...turn, text: turn.text + String(ev.text ?? "") };
    case "tool_call":
      return {
        ...turn,
        toolCalls: [...turn.toolCalls, { name: String(ev.name), args: ev.args }],
      };
    case "tool_result": {
      const toolCalls = [...turn.toolCalls];
      const last = toolCalls[toolCalls.length - 1];
      if (last) {
        toolCalls[toolCalls.length - 1] = {
          ...last,
          ok: Boolean(ev.ok),
          summary: String(ev.summary ?? ""),
        };
      }
      return { ...turn, toolCalls };
    }
    case "file_change":
      return { ...turn, fileChanges: [...turn.fileChanges, ev as unknown as FileChangeEv] };
    case "telemetry":
      return { ...turn, telemetry: ev as unknown as Telemetry };
    case "bridge":
      return { ...turn, bridge: String(ev.text ?? "") };
    case "done":
      return {
        ...turn,
        done: true,
        cited: (ev.sources as number[]) ?? [],
      };
    case "error":
      return { ...turn, done: true, error: String(ev.message ?? "error") };
    default:
      return turn;
  }
}

export interface SendArgs {
  sessionId: string;
  message: string;
  mode: "chat" | "research";
  modelKey?: string;
}

export function useChatStream() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [filesVersion, setFilesVersion] = useState(0);

  const dispatch = useCallback((turnId: string, ev: Ev) => {
    setTurns((prev) => prev.map((t) => (t.id === turnId ? applyEvent(t, ev) : t)));
    if (ev.type === "file_change") setFilesVersion((v) => v + 1);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  const send = useCallback(
    async (args: SendArgs) => {
      if (busy) return;
      setBusy(true);
      const turn = blankTurn(args.message);
      setTurns((prev) => [...prev, turn]);
      const ac = new AbortController();
      abortRef.current = ac;

      const attempt = async (retries: number): Promise<void> => {
        let res: Response;
        try {
          res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: args.sessionId,
              message: args.message,
              mode: args.mode,
              ...(args.modelKey ? { modelKey: args.modelKey } : {}),
            }),
            signal: ac.signal,
          });
        } catch {
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, 2000));
            return attempt(retries - 1);
          }
          dispatch(turn.id, { type: "error", message: "network error" });
          return;
        }
        if (!res.ok || !res.body) {
          dispatch(turn.id, { type: "error", message: `HTTP ${res.status}` });
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              for (const line of block.split("\n")) {
                if (!line.startsWith("data:")) continue;
                try {
                  dispatch(turn.id, JSON.parse(line.slice(5)) as Ev);
                } catch {
                  /* drop bad lines, keep streaming */
                }
              }
            }
          }
        } catch {
          if (!ac.signal.aborted) {
            dispatch(turn.id, { type: "error", message: "stream interrupted" });
          }
        }
        dispatch(turn.id, { type: "done", sources: [] });
      };

      await attempt(1);
      setBusy(false);
    },
    [busy, dispatch],
  );

  const clear = useCallback(() => setTurns([]), []);

  return { turns, busy, send, stop, clear, filesVersion };
}
