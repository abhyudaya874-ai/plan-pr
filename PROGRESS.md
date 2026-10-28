# Plan PR ("Pramaan") — build progress

## Mission (restatement)
AI co-pilot for a SEBI-registered Investment Adviser in India. Every client
plan is a pull request: facts in -> deterministic gates -> adviser reviews ->
approval = merge. Any fact change re-runs gates and revokes approval. Every
number carries blame (source doc, page, quote, date). Invariants: I1 no
LLM-emitted numbers (vault/calculator slots only); I2 every claim sourced or
"unavailable"; I3 no guaranteed-return language; I4 nothing reaches a client
without hash-bound adviser approval; I5 tool output is untrusted data; I6 no
secrets in repo/logs/client; I7 `pnpm repro` reproduces every reported number.

## Phase table
| phase | status | verify evidence (real command output) | notes |
|---|---|---|---|
| 00 bootstrap | done | `pnpm typecheck` 0 err; `pnpm lint` 0 err; `pnpm test` 4/4 pass; `pnpm build` ok (ƒ /api/health); `curl :3001/api/health` -> `{"ok":true,"providers":{"openrouter":true,"groq":true,"nvidia":true,"tavily":false}}` | Next 16.4.3 + TS strict + nUIA; commit `chore: bootstrap project` |
| 10 model gateway | done | `pnpm test` 19/19; `pnpm build` ok (ƒ /api/models); `pnpm models:probe` -> 13 verified (openrouter 7, groq 3, nvidia 3); `curl :3001/api/models` -> 13 models w/ ttft; `GROQ_API_KEY=bad tsx scripts/chat-smoke.ts` -> model_switch to nvidia, answer delivered | hedging fired naturally on cold provider; NIM free key has most functions unprovisioned (3 working found) |
| 20 chat core | done | `pnpm test` 26/26; golden: `whts 2+2`->"4."+bridge; `wether in patna rn`->research, web_search unavailable, honest answer; `guarantee 20%`->refusal+bridge; invented `[1]` scrubbed (done.sources=[]); modelKey manual works | abort wired via req.signal->router->client; weak 7B models skip bridge sometimes (eval picks defaults) |
| prompt-evals | done | `pnpm prompt:eval` 13 models x 21 cases; defaults -> chat/reason=openrouter:google/gemma-3-12b-it (95%, ~950ms), research=groq:qwen/qwen3.8-27b, check=openrouter:google/gemma-4-31b-it; csv -> workspace/_system/prompt-eval.csv | eval-chosen defaults now seed router ordering |
| 30 research+citations | partial | `pnpm test` 39/39; `pnpm build` ok; fetch_url live w/o tavily (example.com fetched, source registered); SSRF blocked http://169.254.169.254; injection pre-screen tested | web_search live calls UNVERIFIED - no TAVILY_API_KEY (honest "unavailable"); sources.csv/trace.txt land in /40 |
| 40 workbench files | done | `pnpm test` 47/47 (path guard, symlink, unicode, snapshot/undo); live: export_csv -> file_change event + real file + snapshot + trace.txt/telemetry.jsonl auto-saved; `/api/workspace` list/read/undo | unit + live verified |
| 50 ui shell | done | `pnpm build` ok; rail + chat/research toggle + model picker + workbench w/ diff + mobile sheet; cited-only source chips, steps timeline, bridge card; history survives refresh | Layer A complete; user visual check via browser preview |
| 60 case repo+vault | partial | universe: 12 direct-plan funds from live AMFI master (user: option A); vault: 9 real fields/fund w/ AMFI blame + 15 honest `unavailable`; `pnpm test` 59/59 (hash chain, tamper, revoke, undo, blame, identity lock); live vault_lookup nav=₹89.2762 w/ blame; /case + /api/{case,blame,personas,vault} | factsheet fields UNAVAILABLE — AMC sites bot-guarded; drop text into data/sources/factsheets/ to fill |
| 70 planner+gates | done | deterministic computePlan (SIP/FV/buckets/risk-capacity+clamp); 9 gates incl identity/freshness/horizon/protection/concentration/risk/escalations/citation/disclosure; slot DRAFT_A + numeric+banned-phrase lint; domino verified live (facts->gates rerun); 74/74 tests; fixtures -> report/planner-fixtures.json; all 6 personas sensible (trader still escalation-red by design) | income_stream goals get SIP=0 fund % cosmetic; contradiction cards = notes not separate cards yet |
| 80 pr review+approval | pending | | |
| 90 policy+redteam | pending | | |
| 95 eval+submission | pending | | |

## Current state
Layer A + phase 60 (partial: factsheet fields unavailable) done. Next: /70-planner-and-gates.

## Blockers
- **TAVILY_API_KEY missing** → web_search returns "unavailable" (honest); fetch_url still works via guarded direct fetch. Drop the key into .env to enable live search.
Dev server note: port 3000 is used by another app on this machine; ours runs
on 3001 (`pnpm dev` picks a free port).

## Blockers
- TAVILY_API_KEY not provided (needed at phase 30; degrades gracefully until then).
