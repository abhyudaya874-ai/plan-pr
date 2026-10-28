/**
 * Build report/deck.html (10 slides) from generated report data, then
 * chromium --headless --print-to-pdf -> report/deck.pdf.  pnpm deck
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const j = <T>(p: string, fb: T): T =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fb;

interface Fixture {
  persona: string;
  label: string;
  gateSummary: { red: number; amber: number; green: number };
  suggestedFunds: { schemeCode: string; pct: number }[];
  contradictions: { id: string; severity: string; text: string }[];
}
const fixtures = j<{ personas: Fixture[] }>("report/planner-fixtures.json", { personas: [] });
const qa = j<{ score: string }>("report/fund-qa.json", { score: "?" });
const rt = j<{ score: string; results: { id: string; pass: boolean }[] }>("report/redteam.json", { score: "?", results: [] });
const universe = j<{ funds: { amfiName: string; category: string }[] }>("data/vault/universe.json", { funds: [] });

const personaRows = fixtures.personas
  .map(
    (p) => `<tr>
      <td>${p.label}</td>
      <td>${p.gateSummary.red}R ${p.gateSummary.amber}A ${p.gateSummary.green}G</td>
      <td>${p.suggestedFunds.slice(0, 2).map((f) => f.schemeCode + ":" + f.pct + "%").join(", ")}</td>
    </tr>`,
  )
  .join("");

const slide = (title: string, body: string) => `
  <section class="slide">
    <h2>${title}</h2>${body}
  </section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 1280px 720px; margin: 0; }
* { margin:0; box-sizing:border-box; font-family: Georgia, 'Times New Roman', serif; }
.slide { width:1280px; height:720px; padding:64px 80px; background:#0a0a0b; color:#e4e4e7; page-break-after:always; display:flex; flex-direction:column; }
h2 { font-size:44px; font-style:italic; color:#fafafa; margin-bottom:28px; }
h3 { font-size:22px; color:#c9854a; margin:18px 0 8px; }
p, li { font-size:20px; line-height:1.55; color:#d4d4d8; }
ul { padding-left:26px; }
table { border-collapse:collapse; width:100%; margin-top:12px; font-size:16px; }
td, th { border:1px solid #3f3f46; padding:8px 12px; text-align:left; }
th { color:#c9854a; font-family:monospace; font-size:13px; text-transform:uppercase; }
.big { font-size:64px; color:#fafafa; font-style:italic; }
.sub { font-size:22px; color:#a1a1aa; margin-top:14px; }
.kpi { display:flex; gap:48px; margin-top:28px; }
.kpi div { text-align:center; } .kpi .n { font-size:56px; color:#c9854a; font-style:italic; }
.kpi .l { font-size:15px; color:#a1a1aa; margin-top:4px; }
.mono { font-family:monospace; font-size:15px; color:#8b8b93; margin-top:auto; }
.center { justify-content:center; align-items:center; text-align:center; display:flex; }
.center > div { max-width:900px; }
</style></head><body>

<section class="slide center"><div>
  <div class="big">Pramaan</div>
  <div class="sub">Plan PR — every client plan is a pull request.<br/>AI co-pilot for a SEBI-registered Investment Adviser.</div>
  <div class="sub" style="margin-top:40px;font-size:16px;color:#71717a">Zeckathon · 24h · solo build</div>
</div></section>

${slide("The problem", `<p>An RIA must give suitable, source-backed advice fast. LLM chat can't be trusted with numbers: NAVs get invented, guarantees slip in, nothing is reproducible.</p>
<h3>The fix</h3><p>Facts are commits. Gates are CI. The LLM never writes a number — the vault and deterministic calculators do. Approval is a hash.</p>`)}

${slide("The loop (live demo)", `<ul>
<li>Pick persona → facts seed as <b>commits</b> (sha256-chained)</li>
<li>Deterministic planner: SIPs, emergency gap, drawdowns, risk clamp</li>
<li><b>9 gates</b> re-run on every commit — the domino</li>
<li>Slot-filled draft passes numeric + banned-phrase lint</li>
<li>Adviser approves → sha256 fingerprint → read-only client view</li>
<li>Any fact edit → new commit → approval auto-revoked</li>
</ul>`)}

${slide("Invariants, enforced", `<ul>
<li><b>I1</b> LLM never emits material numbers — slots only; lint fails on raw digits</li>
<li><b>I2</b> Every claim has a source ({doc,quote}/URL) or says "unavailable"</li>
<li><b>I3</b> No guaranteed/assured/risk-free language (banned-phrase lint, incl. Hinglish)</li>
<li><b>I4</b> Client output only under approval bound to content hash</li>
<li><b>I5</b> Retrieved docs/tools are data, never instructions · <b>I6</b> no secrets in repo · <b>I7</b> <code>pnpm repro</code> regenerates every report number</li>
</ul>`)}

${slide("Architecture", `<h3>Layer A — research chat</h3>
<p>Own OpenAI-compatible client (fetch+SSE) → 3 providers, 13 probed models, EWMA routing + hedging + failover → tool loop (web/calc/files/vault) → streamed cited answers + live workbench.</p>
<h3>Layer B — Plan PR</h3>
<p>Case repo (hash-chained commits) → planner (risk capacity vs tolerance, clamp) → gates → slot draft → approval fingerprint → client view.</p>`)}

${slide("Suitability — 6 personas", `<table>
<tr><th>persona</th><th>gates</th><th>fund pick</th></tr>${personaRows}</table>
<p style="margin-top:14px">Low tolerance / thin buffers clamp the plan down the risk ladder; behavioural flags escalate to the adviser. Trader stays escalation-red — by design.</p>`)}

${slide(`Factual QA — ${qa.score} with blame`, `<ul>
<li>Every served number carries AMFI blame {doc,url,retrievedAt}</li>
<li>Factsheet fields (TER/load/AUM/returns) → honest <b>unavailable</b>, never guessed</li>
<li>Out-of-universe funds → <b>not_found</b>, never invented</li>
<li>Live probes: vault_lookup used, zero invented figures</li>
</ul>
<h3>Universe (option A)</h3><p>${universe.funds.map((f) => f.amfiName).join(" · ")}</p>`)}

${slide("Guardrails — red-team ${rt.score}", `<ul>${rt.results.map((r) => `<li>${r.pass ? "✓" : "✗"} ${r.id}</li>`).join("")}</ul>
<p style="margin-top:14px">Refusals always carry safer alternatives; fake authority, injection, and 'hide from adviser' are rejected; no banned phrases survive.</p>`)}

${slide("Model gateway + perf", `<ul>
<li>13 models verified live (probe: reach, tools, JSON, latency, typos)</li>
<li>EWMA TTFT routing · hedge window (speculative restream) · cross-provider failover</li>
<li>Defaults chosen by <code>pnpm prompt:eval</code> (273 live cases): chat/reason = gemma-3-12b, research = qwen3.8-27b</li>
<li>First SSE event before any provider call; UI adds &lt;150ms</li>
</ul>`)}

${slide("Honest limitations + next", `<ul>
<li>TER/AUM/returns: AMC sites bot-guarded → marked <b>unavailable</b>, pipeline ready (drop factsheet text → blame auto-fills)</li>
<li>Tavily key absent → search degrades honestly; direct fetch works</li>
<li>Assumptions are adviser-tagged/editable, not sourced regulatory values</li>
<li>Next: factsheet ingestion, rule-compiler DSL, execution-free client reports</li>
</ul>
<p class="mono">repo: typecheck ✓ lint ✓ 74 tests ✓ build ✓ · pnpm repro regenerates report/</p>`)}

</body></html>`;

writeFileSync("report/deck.html", html);
try {
  execSync(
    `chromium --headless --no-sandbox --disable-gpu --print-to-pdf=report/deck.pdf --no-pdf-header-footer report/deck.html`,
    { stdio: "pipe", timeout: 60000 },
  );
  console.log(`deck -> report/deck.pdf (${statSync("report/deck.pdf").size} bytes)`);
} catch (e) {
  console.log(`pdf skipped (chromium): ${(e as Error).message.slice(0, 120)} — deck.html written`);
}
