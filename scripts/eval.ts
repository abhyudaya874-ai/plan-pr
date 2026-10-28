/**
 * Eval harness — the judged metrics, generated into report/:
 *  1. fund QA suite: 25 questions over vault_lookup + live chat citation honesty
 *  2. persona outcomes (delegates to planner-fixtures output)
 *  3. latency table (from workspace/_system/model-bench.csv)
 *  pnpm eval
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { vaultLookup, vaultFunds } from "../src/lib/vault/load";

const BASE = process.env.BASE ?? "http://localhost:3001";

interface QaCase {
  id: string;
  q: string;
  amc: string;
  scheme: string;
  field: string;
  expect: "value" | "unavailable" | "not_found";
}

/** The 25-question fund QA suite (hidden-set rehearsal). */
const QA: QaCase[] = [
  { id: "q1", q: "NAV of Parag Parikh Flexi Cap", amc: "PPFAS", scheme: "flexi cap", field: "nav", expect: "value" },
  { id: "q2", q: "NAV of SBI Liquid Fund", amc: "SBI", scheme: "liquid", field: "nav", expect: "value" },
  { id: "q3", q: "NAV of UTI Nifty 50 Index", amc: "UTI", scheme: "nifty 50 index", field: "nav", expect: "value" },
  { id: "q4", q: "NAV of Nippon India Small Cap", amc: "Nippon", scheme: "small cap", field: "nav", expect: "value" },
  { id: "q5", q: "NAV of Mirae ELSS Tax Saver", amc: "Mirae", scheme: "elss", field: "nav", expect: "value" },
  { id: "q6", q: "expense ratio of PPFAS flexi cap", amc: "PPFAS", scheme: "flexi cap", field: "expense_ratio_direct", expect: "unavailable" },
  { id: "q7", q: "exit load of Nippon small cap", amc: "Nippon", scheme: "small cap", field: "exit_load", expect: "unavailable" },
  { id: "q8", q: "AUM of SBI Liquid", amc: "SBI", scheme: "liquid", field: "aum", expect: "unavailable" },
  { id: "q9", q: "benchmark of UTI Nifty 50", amc: "UTI", scheme: "nifty 50 index", field: "benchmark", expect: "unavailable" },
  { id: "q10", q: "fund manager of Mirae Large Midcap", amc: "Mirae", scheme: "large midcap", field: "fund_manager", expect: "unavailable" },
  { id: "q11", q: "riskometer of HDFC Conservative Hybrid", amc: "HDFC", scheme: "conservative hybrid", field: "riskometer", expect: "unavailable" },
  { id: "q12", q: "inception date of SBI Gold", amc: "SBI", scheme: "gold", field: "inception_date", expect: "unavailable" },
  { id: "q13", q: "1y returns of PPFAS flexi cap", amc: "PPFAS", scheme: "flexi cap", field: "returns_1y", expect: "unavailable" },
  { id: "q14", q: "category of ICICI Corporate Bond", amc: "ICICI", scheme: "corporate bond", field: "category", expect: "value" },
  { id: "q15", q: "nav date of HDFC Short Term", amc: "HDFC", scheme: "short term", field: "nav_date", expect: "value" },
  { id: "q16", q: "NAV of Quantum Ultra Alpha fund", amc: "Quantum", scheme: "ultra alpha", field: "nav", expect: "not_found" },
  { id: "q17", q: "NAV of made-up SBI Bitcoin fund", amc: "SBI", scheme: "bitcoin fund", field: "nav", expect: "not_found" },
  { id: "q18", q: "min SIP of Mirae ELSS", amc: "Mirae", scheme: "elss", field: "min_sip", expect: "unavailable" },
  { id: "q19", q: "3y returns of UTI Nifty 50", amc: "UTI", scheme: "nifty 50 index", field: "returns_3y", expect: "unavailable" },
  { id: "q20", q: "5y returns of Nippon Small Cap", amc: "Nippon", scheme: "small cap", field: "returns_5y", expect: "unavailable" },
  { id: "q21", q: "NAV of ICICI Balanced Advantage", amc: "ICICI", scheme: "balanced advantage", field: "nav", expect: "value" },
  { id: "q22", q: "NAV of SBI Aggressive Hybrid", amc: "SBI", scheme: "aggressive hybrid", field: "nav", expect: "value" },
  { id: "q23", q: "NAV of Mirae Large and Midcap", amc: "Mirae", scheme: "large midcap", field: "nav", expect: "value" },
  { id: "q24", q: "regular TER of PPFAS flexi cap", amc: "PPFAS", scheme: "flexi cap", field: "expense_ratio_regular", expect: "unavailable" },
  { id: "q25", q: "since-inception returns of SBI Liquid", amc: "SBI", scheme: "liquid", field: "returns_si", expect: "unavailable" },
];

async function chatProbe(question: string): Promise<{ answer: string; toolCalls: string[] }> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: `qa-${Date.now()}`, message: question, mode: "chat" }),
  });
  const text = await res.text();
  let answer = "";
  const toolCalls: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const e = JSON.parse(line.slice(5)) as { type: string; name?: string; text?: string };
      if (e.type === "token") answer += e.text ?? "";
      if (e.type === "tool_call" && e.name) toolCalls.push(e.name);
    } catch { /* ignore */ }
  }
  return { answer, toolCalls };
}

async function main() {
  const qaResults = QA.map((c) => {
    const out = vaultLookup({ amc: c.amc, scheme: c.scheme, plan: "Direct Plan", option: "Growth", field: c.field });
    let status: string;
    if (!out.found) status = out.ambiguous ? "ambiguous" : "not_found";
    else status = out.value!.status === "unavailable" ? "unavailable" : "value";
    const pass = status === c.expect;
    return {
      id: c.id,
      q: c.q,
      expect: c.expect,
      got: status,
      pass,
      value: out.value?.value ?? null,
      blame: out.value?.source ?? null,
    };
  });
  const qaScore = qaResults.filter((r) => r.pass).length;
  console.log(`fund QA: ${qaScore}/${qaResults.length}`);
  qaResults.filter((r) => !r.pass).forEach((r) => console.log(`  MISS ${r.id} ${r.q}: expected ${r.expect}, got ${r.got}`));

  // live chat honesty probes (3 representative; skipped if no dev server)
  const live: { q: string; answer: string; toolCalls: string[]; invented: boolean }[] = [];
  let serverUp = false;
  try {
    const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    serverUp = h.ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) console.log("(no dev server — skipping live probes)");
  for (const c of serverUp ? [QA[5]!, QA[15]!, QA[0]!] : []) {
    try {
      const p = await chatProbe(c.q);
      const usedVault = p.toolCalls.includes("vault_lookup");
      const saysUnavailable = /unavailable|not (in|available in) (the )?(vault|verified)|don't have/i.test(p.answer);
      const hasNumber = /\d/.test(p.answer.replace(/\[\d+\]/g, ""));
      const invented = c.expect === "unavailable" ? hasNumber && !saysUnavailable : c.expect === "not_found" ? hasNumber && !/not found|outside|universe|unavailable/i.test(p.answer) : false;
      live.push({ q: c.q, answer: p.answer.slice(0, 300), toolCalls: p.toolCalls, invented: invented || !usedVault });
      console.log(`live ${c.id}: vault_used=${usedVault} invented=${invented}`);
    } catch (e) {
      live.push({ q: c.q, answer: `ERROR ${(e as Error).message.slice(0, 80)}`, toolCalls: [], invented: true });
    }
  }

  // latency table from model bench
  const benchPath = "workspace/_system/model-bench.csv";
  const latency = existsSync(benchPath) ? readFileSync(benchPath, "utf8") : "unavailable";

  mkdirSync("report", { recursive: true });
  writeFileSync("report/fund-qa.json", JSON.stringify({ generatedAt: new Date().toISOString(), score: `${qaScore}/${qaResults.length}`, results: qaResults, liveProbes: live }, null, 2) + "\n");
  writeFileSync("report/latency.txt", latency);
  const funds = vaultFunds().length;
  console.log(`report/: fund-qa.json (${qaScore}/${qaResults.length}), latency.txt, planner-fixtures.json (via pnpm planner:fixtures) | vault funds: ${funds}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
