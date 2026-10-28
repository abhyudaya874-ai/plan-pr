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
| 20 chat core | pending | | |
| prompt-evals | pending | | |
| 30 research+citations | pending | | blocked on TAVILY_API_KEY (not provided) |
| 40 workbench files | pending | | |
| 50 ui shell | pending | | Layer A complete at end |
| 60 case repo+vault | pending | | ASK: fund universe |
| 70 planner+gates | pending | | |
| 80 pr review+approval | pending | | |
| 90 policy+redteam | pending | | |
| 95 eval+submission | pending | | |

## Current state
Phases 00+10 done. Next: /20-chat-core.
Dev server note: port 3000 is used by another app on this machine; ours runs
on 3001 (`pnpm dev` picks a free port).

## Blockers
- TAVILY_API_KEY not provided (needed at phase 30; degrades gracefully until then).
