# Plan PR ("Pramaan")

AI co-pilot for a SEBI-registered Investment Adviser (RIA) in India.
Every client plan is a **pull request**: facts in -> gates (CI checks) run ->
adviser reviews -> approval = merge. Any fact change = new commit -> gates
re-run -> approval auto-revoked. Every number carries `blame` (source doc,
page, quote, retrieved-at).

Zeckathon (Zetheta) 24h hackathon, solo build.

## What it does

- **Research chat** (Layer A): Perplexity-style cited answers with live
  research steps, a Devin-style workbench where the agent writes files in
  front of you (txt/csv/md/json), and a multi-provider model picker
  (OpenRouter / Groq / NVIDIA NIM) with live probed benchmarks.
- **Plan PR** (Layer B): pick a persona -> facts become git-style commits ->
  deterministic planner computes SIPs/buffers/drawdowns -> 9 suitability
  gates run on every commit -> slot-filled draft (LLM never writes a number)
  -> adviser approval = sha256 fingerprint -> read-only client view.

## Invariants (enforced, not aspirational)

- **I1** LLM never emits material numbers. NAV/TER/SIP/corpus come from vault
  fields or deterministic calculators via `{{slots}}`; raw digits in drafts
  fail `lintNumbers`.
- **I2** Every claim carries a source (URL or {doc,page,quote}) or says
  `unavailable`. Invented `[n]` citations are scrubbed server-side.
- **I3** No guaranteed/assured/risk-free language (banned-phrase lint incl.
  Hinglish).
- **I4** Client output only after adviser approval bound to a content hash;
  any fact edit revokes it.
- **I5** Retrieved docs/tools are untrusted data, never instructions.
- **I6** Secrets never in repo/logs/bundle.
- **I7** `pnpm repro` regenerates every `report/` number.

## Quick start

```bash
cp .env.example .env    # >=1 LLM key: OPENROUTER/GROQ/NVIDIA; TAVILY optional
pnpm install
pnpm dev                # http://localhost:3000
```

Routes: `/` adviser console (chat + workbench) · `/case` case repo + gates +
approve · `/client/<caseId>` client view (read-only, approval-gated) ·
`/dev/chat` raw SSE debug.

## Reproducing the report

```bash
pnpm repro   # vault:build -> planner:fixtures -> eval -> manifest
```

Regenerates `report/fund-qa.json` (25Q fund suite), `planner-fixtures.json`
(6 personas x gates), `latency.txt` (model bench), `manifest.json` (inputs).
`pnpm redteam` reruns the 10 adversarial prompts (needs dev server).
`pnpm prompt:eval` re-benchmarks all verified models (live, needs keys).

## The 12-fund universe (option A, user decision)

Picked from the live AMFI scheme master (`data/sources/amfi-navall.txt`,
2026-10-28): SBI Liquid, HDFC Short Term, UTI Nifty 50 Index, PPFAS Flexi
Cap, Mirae L&M Cap, Nippon Small Cap, Mirae ELSS, SBI Aggressive Hybrid,
HDFC Conservative Hybrid, ICICI Pru BAF, ICICI Pru Corp Bond, SBI Gold —
all Direct Plan, Growth. Coverage: liquid/debt/index/flexi/L&M/small/ELSS/
hybrids/gold = every persona's need.

## Known limitations (honest)

- **Factsheet fields unavailable**: AMC sites were bot-guarded during the
  build; TER/load/AUM/benchmark/manager/returns are `unavailable` in the
  vault, not guessed. Drop extracted factsheet text into
  `data/sources/factsheets/<amc>.txt` and `pnpm vault:build` fills them
  with {doc,quote} blame — pipeline ready.
- NAV comes from AMFI NAVAll (daily), not factsheet-as-of dates.
- Tavily key absent -> web search degrades to `unavailable`; direct
  `fetch_url` (SSRF-guarded) still works.
- Suitability is heuristic (`riskCapacity` + tolerance clamp), documented
  in-code; adviser overrides are the designed escape hatch.

## Verify

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

74 unit tests cover SSE parsing, routing, hedging/failover, tools, SSRF,
workspace safety, hash chain, approval revocation, SIP math, clamping,
gates, numeric lint.

## Layout

`.devin/rules+workflows` — the build contract · `data/` universe, personas,
policy, vault · `src/lib/{llm,agent,tools,workspace,case,vault,planner,
gates,policy,eval}` · `scripts/` probe/build/eval/repro · `report/` generated
numbers · `PROGRESS.md` phase state · `docs/DECISIONS.md` rationale log.
