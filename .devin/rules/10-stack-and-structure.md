---
trigger: always_on
description: Stack decisions, folder structure, env, scripts.
---
# Stack
Next.js (App Router, Node runtime for API routes) + TypeScript strict + Tailwind. pnpm. Node LTS.
zod everywhere. SQLite via better-sqlite3 (file DB, reproducible, zero infra). vitest. `diff` for unified diffs. mathjs for safe `calc`. No Python in the runtime path (offline PDF text/page-image extraction scripts are allowed, e.g. pdftotext/pdftoppm).
LLM access: OWN thin OpenAI-compatible client (fetch + SSE). No LLM SDK dependency (SDK API drift, less control over hedging/failover/latency). Web search: Tavily behind a `SearchProvider` interface.

# Structure
```
.devin/rules  .devin/workflows
PROGRESS.md   docs/DECISIONS.md   README.md
data/sources/        # original PDFs (factsheets/SIDs/circulars) - provenance
data/vault/          # verified fund fields (json) + page text + page images
data/policy/         # regulatory/policy values, each with source+date
data/personas/       # 6 synthetic personas (labelled SYNTHETIC)
src/app/             # pages + api routes (chat, models, workspace, case, blame, approve)
src/components/      # ui
src/lib/llm/         # providers, registry, router, probe
src/lib/prompts/     # canonical prompts (verbatim from rules 30/31)
src/lib/agent/       # intent, tool loop, context builder
src/lib/tools/       # web_search, fetch_url, calc, vault_lookup, file tools
src/lib/workspace/   # sandboxed fs, diff, snapshots
src/lib/case/        # case schema, commits, hash chain
src/lib/vault/       # lookup, identity lock, freshness
src/lib/planner/     # deterministic math
src/lib/gates/       # gate interface + gates + persona packs + rule DSL
src/lib/eval/        # eval harness
scripts/             # models-probe, vault-build, repro, eval
workspace/           # runtime, gitignored, per-session sandbox
report/              # generated numbers (committed for reproducibility)
```

# Env (server-only, validated in src/lib/env.ts)
OPENROUTER_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, TAVILY_API_KEY. At least one LLM key required; features degrade gracefully per missing key. Ship `.env.example` with names only.

# Scripts
dev, build, typecheck, lint, test, `models:probe`, `vault:build`, `prompt:eval`, `eval`, `repro`.
