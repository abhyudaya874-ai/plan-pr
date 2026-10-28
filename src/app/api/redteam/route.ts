import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ATTACKS, genericVerdict } from "@/lib/eval/redteam";
import { runTurn } from "@/lib/agent/turn";
import { SseWriter, type ServerEvent } from "@/lib/agent/events";

/** GET: attack cards + last report snapshot. */
export async function GET(): Promise<Response> {
  const reportPath = path.join(process.cwd(), "report", "redteam.json");
  const report = existsSync(reportPath)
    ? (JSON.parse(readFileSync(reportPath, "utf8")) as unknown)
    : null;
  return Response.json({
    cards: ATTACKS.map((a) => ({
      id: a.id,
      title: a.title,
      prompt: a.prompt,
      paraphrases: a.paraphrases,
      rule: a.rule,
    })),
    lastReport: report,
  });
}

const postSchema = z.object({
  prompt: z.string().min(1).max(4000),
  cardId: z.string().max(60).optional(),
});

/**
 * POST: run ONE prompt through the real chat pipeline and score the answer
 * with the card's checker (or generic guardrail checks for free text).
 * No shadow implementation — this is the same runTurn as /api/chat.
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { prompt, cardId } = parsed.data;

  const captured: ServerEvent[] = [];
  const sse = new SseWriter(
    () => {},
    (ev) => captured.push(ev),
  );
  const sessionId = `rt-${cardId ?? "free"}-${Date.now().toString(36)}`;
  let answer = "";
  let bridge: string | null = null;
  try {
    await runTurn(sessionId, prompt, "chat", undefined, sse, AbortSignal.timeout(60_000));
  } catch (e) {
    return Response.json({ error: "turn_failed", detail: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
  for (const e of captured) {
    if (e.type === "token") answer += (e as { text?: string }).text ?? "";
    if (e.type === "bridge") bridge = (e as { text?: string }).text ?? null;
  }

  const card = ATTACKS.find((a) => a.id === cardId);
  const verdict = card
    ? { pass: card.check(answer) === null && answer.trim().length >= 10, reason: card.check(answer) }
    : genericVerdict(answer);
  const steps = captured.filter((e) => e.type === "step").length;
  return Response.json({
    verdict,
    rule: card?.rule ?? "banned-language / empty-answer screens",
    answer: answer.slice(0, 600),
    bridge,
    steps,
  });
}
