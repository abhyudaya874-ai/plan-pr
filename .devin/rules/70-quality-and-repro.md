---
trigger: always_on
description: Tests, determinism, reproducibility, security checklist.
---
# Quality and reproducibility
- Deterministic code (planner, gates, lint, linking) has vitest unit tests with hand-computed fixtures. Gates have one test per persona per gate that matters.
- LLM-touching code: temperature 0 for checks/extraction; golden tests with recorded fixtures; live evals run via `pnpm prompt:eval` and `pnpm eval` (never in unit tests).
- `pnpm repro` regenerates everything in `report/` (CSV/JSON: persona outcomes, fund QA results, attack results, latency table, planner fixtures) from committed data + recorded runs. README states exact steps. Every number in the deck must exist in `report/`.
- Reproducibility details: pin dependency versions, commit lockfile, seed any randomness, store `registry.live.json` and eval raw outputs with timestamps and model ids.
- Security checklist before each phase ends: no secrets in git history, env validated, zod at boundaries, SSRF/path guards tested, rate limit on chat, CSP set, dependency audit has no criticals.
- Performance budget: UI adds <=150 ms over provider TTFT; first SSE event <=100 ms; page JS reasonable.
- Logging: structured, no PII, no keys.
