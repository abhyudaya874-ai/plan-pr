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
| 00 bootstrap | in progress | pending | scaffold + env + structure |
| 10 model gateway | pending | | |
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
Phase 00 in progress.

## Blockers
- TAVILY_API_KEY not provided (needed at phase 30; degrades gracefully until then).
