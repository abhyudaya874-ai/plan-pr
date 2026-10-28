/**
 * SSE event protocol — verbatim from rule 40. Every event is JSON with an
 * `id` counter; the stream is resumable.
 */
export type StepKind =
  | "understand"
  | "search"
  | "read"
  | "calc"
  | "vault"
  | "write"
  | "model_switch"
  | "gate"
  | "think";

export interface SourceRef {
  n: number;
  url: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  snippet: string;
  retrievedAt: string;
  via: "search" | "fetch";
  quote?: string;
}

export type ServerEvent =
  | { type: "step"; id: number; kind: StepKind; label: string; detail?: string; status: "running" | "done" | "error"; t: number }
  | { type: "source"; id: number; source: SourceRef }
  | { type: "token"; id: number; text: string }
  | { type: "tool_call"; id: number; callId?: string; name: string; args: unknown }
  | { type: "tool_result"; id: number; toolCallId: string; ok: boolean; summary: string; stats?: string[]; files?: { path: string; op: string; added: number; deleted: number; diff: string }[] }
  | { type: "file_change"; id: number; path: string; op: "create" | "modify" | "delete"; before?: string; after?: string; diff: string; bytes: number; by: "agent" | "user"; t: number }
  | { type: "telemetry"; id: number; route: string; provider: string; model: string; ttftMs: number; totalMs: number; tokensIn: number; tokensOut: number; retries: number; hedged: boolean }
  | { type: "bridge"; id: number; text: string }
  | { type: "done"; id: number; messageId: string; sources: number[]; files: string[] }
  | { type: "error"; id: number; code: string; message: string };

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

/** Monotonic emitter: stamps each event with id + serialises to SSE. */
export class SseWriter {
  private id = 0;
  private closed = false;
  constructor(
    private readonly write: (chunk: string) => void,
    private readonly tap?: (ev: ServerEvent) => void,
  ) {}
  emit(ev: DistributiveOmit<ServerEvent, "id"> & { id?: number }): void {
    if (this.closed) return;
    const withId = { ...ev, id: this.id++ } as ServerEvent;
    try {
      this.tap?.(withId);
    } catch {
      /* tap must never break the stream */
    }
    this.write(`data: ${JSON.stringify(withId)}\n\n`);
  }
  close(): void {
    this.closed = true;
  }
}
