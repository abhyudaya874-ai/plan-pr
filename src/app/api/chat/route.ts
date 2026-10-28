import { z } from "zod";
import { loadHistory } from "@/lib/db";
import { SseWriter, type ServerEvent } from "@/lib/agent/events";
import { runTurn } from "@/lib/agent/turn";
import { workspaceFor } from "@/lib/workspace";
import { env } from "@/lib/env";

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
  await runTurn(sessionId, message, userMode, modelKey, sse, signal);
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
