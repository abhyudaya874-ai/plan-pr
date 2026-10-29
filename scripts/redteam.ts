/**
 * Red-team arcade: the 10 adversarial prompts the judges throw.
 * Each case hits the live /api/chat and is scored for guardrail behavior
 * using the shared checkers in src/lib/eval/redteam.ts.
 *   pnpm redteam
 */
import { writeFileSync } from "node:fs";
import { ATTACKS, normalizeAnswer, type Attack } from "../src/lib/eval/redteam";

const BASE = process.env.BASE ?? "http://localhost:3001";

async function runOne(a: Attack, prompt: string): Promise<{ pass: boolean; reason: string | null; answer: string; bridge: string | null }> {
  const ask = async (): Promise<string> => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: `rt-${a.id}-${Math.abs(prompt.length * 7 + Date.now() % 97)}`, message: prompt, mode: "chat" }),
    });
    let answer = "";
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const e = JSON.parse(line.slice(5)) as { type: string; text?: string };
        if (e.type === "token") answer += e.text ?? "";
      } catch { /* ignore bad lines */ }
    }
    return answer;
  };
  let answer = await ask();
  // Empty answer = usually provider rate-limiting during rapid scripted runs
  // (degraded completion), not model compliance. Retry once after a pause.
  if (answer.trim().length < 10) {
    await new Promise((r) => setTimeout(r, 8000));
    answer = await ask();
  }
  // empty answer = rate-limit artifact; report it as such, not as a compliance fail
  const norm = normalizeAnswer(answer);
  const reason = norm.trim().length < 10 ? "rate_limited (empty answer)" : a.check(norm);
  return { pass: !reason, reason, answer: answer.slice(0, 400), bridge: null };
}

async function main() {
  const results = [];
  for (const a of ATTACKS) {
    const variants = [a.prompt, ...a.paraphrases];
    const runs: { prompt: string; pass: boolean; reason: string | null; answer?: string }[] = [];
    for (const p of variants) {
      try {
        const r = await runOne(a, p);
        runs.push({ prompt: p, pass: r.pass, reason: r.reason, answer: r.answer });
      } catch (e) {
        runs.push({ prompt: p, pass: false, reason: `error: ${(e as Error).message.slice(0, 60)}` });
      }
    }
    const survived = runs.filter((r) => r.pass).length;
    const pass = survived === runs.length;
    results.push({ id: a.id, title: a.title, pass, survived: `${survived}/${runs.length}`, runs });
    console.log(`${pass ? "PASS" : "FAIL"} ${a.id} — ${survived}/${runs.length} paraphrases survived`);
  }
  const score = results.filter((r) => r.pass).length;
  const out = { generatedAt: new Date().toISOString(), score: `${score}/${results.length}`, results };
  writeFileSync("report/redteam.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`\nred-team: ${score}/${results.length} cards — report/redteam.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
