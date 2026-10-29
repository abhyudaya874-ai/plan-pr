<div align="center">

# प्रमाण · Pramaan

**Plan PR — every client plan is a pull request.**

Facts in → deterministic gates run → adviser reviews → approval = merge.
Any fact change = new commit → gates re-run → approval auto-revoked.
Every number has blame.

[![tests](https://img.shields.io/badge/tests-74%2F74-emerald)](#quickstart)
[![stack](https://img.shields.io/badge/Next.js%2016-React%2019-black)](#stack)
[![providers](https://img.shields.io/badge/LLM-OpenRouter%20·%20Groq%20·%20NVIDIA-blue)](#model-gateway)
[![search](https://img.shields.io/badge/search-Tavily%20·%20Exa-orange)](#live-web-research)
[![deploy](https://img.shields.io/badge/demo-plan--pr.vercel.app-000?logo=vercel)](https://plan-pr.vercel.app)
[![repro](https://img.shields.io/badge/repro-pnpm%20repro-success)](#reproducibility)

*Built for the Zeckathon (Zetheta) 24h hackathon — solo.*

</div>

---

## What is this?

An AI co-pilot for a **SEBI-registered Investment Adviser (RIA)** in India. Not a chatbot — a **research assistant + adviser console** where:

- the LLM **never** emits a material number (NAV, SIP, corpus, returns — all from a verified vault or deterministic calculators),
- every factual claim carries **blame** (source doc, page, quote, date) or says **"unavailable"**,
- nothing reaches a client without **adviser approval bound to a content hash**,
- and any fact change **dominoes**: new commit → gates re-run → approval revoked.

| Layer | What it is |
|---|---|
| **A — Research chat** | Perplexity-style cited answers with live steps, a Devin-style workbench (files change in front of you), multi-provider model picker with TTFT-based routing + hedging + failover |
| **B — Plan PR** | The console becomes an adviser workflow: case repo (hash-chained commits), deterministic planner, 9+ gates, slot-filled drafts, approval fingerprints, client view, receipts, policy packs, red-team arcade |

## Screenshots

| Research chat (cited, live steps, workbench) | Plan PR console (facts, gates, draft) |
|---|---|
| ![Research chat](docs/screenshots/chat.png) | ![Plan PR console](docs/screenshots/case.png) |

| Client view (approved, fingerprint, teach-back) | Red-team arcade (10 attacks) | Policy pack (gates, quarantine, rule compiler) |
|---|---|---|
| ![Client view](docs/screenshots/client.png) | ![Red-team arcade](docs/screenshots/redteam.png) | ![Policy pack](docs/screenshots/policy.png) |

## Architecture

```mermaid
flowchart LR
    subgraph Client["Browser"]
        UI["Chat console<br/>(SSE stream)"]
        CASEUI["Case / PR page"]
        CLIENTVIEW["Client view"]
    end

    subgraph Next["Next.js (Node runtime)"]
        API["/api/chat (SSE)"]
        LOOP["Agent loop<br/>intent → tools → scrub → done"]
        ROUTER["Model router<br/>TTFT EWMA · hedge · failover"]
        GATES["Planner + Gates<br/>(deterministic, no LLM)"]
        APPROVE["Approval fingerprint<br/>sha256(facts+plan+gates+draft)"]
    end

    subgraph Providers["Model providers"]
        OR["OpenRouter"]
        GQ["Groq"]
        NV["NVIDIA NIM"]
    end

    subgraph Tools["Tool layer"]
        WS["web_search<br/>Tavily → Exa fallback"]
        FU["fetch_url<br/>SSRF guard + injection screen"]
        CALC["calc (mathjs)"]
        VL["vault_lookup / vault_universe"]
        FT["write/append/export_csv<br/>sandboxed workspace"]
    end

    subgraph Data["Data (seed = committed, runtime = writable root)"]
        VAULT[("Fund vault<br/>12 funds · AMFI blame")]
        CASES[("Case repo<br/>hash-chained commits")]
        POLICY[("Policy packs<br/>assumptions + rules")]
        WSDB[("SQLite<br/>threads + kv")]
    end

    UI --> API --> LOOP
    LOOP --> ROUTER --> OR & GQ & NV
    LOOP --> WS & FU & CALC & VL & FT
    LOOP --> WSDB
    CASEUI --> GATES --> VAULT & POLICY
    CASEUI --> APPROVE --> CASES
    CLIENTVIEW --> APPROVE
```

### The Plan-PR lifecycle

```mermaid
sequenceDiagram
    participant A as Adviser
    participant C as Case repo
    participant P as Planner+Gates
    participant V as Client view

    A->>C: create case from persona (facts = commit #1)
    C->>P: domino: facts → plan → 9 gates → slot draft → numeric lint
    A->>C: edit any fact
    C->>C: new commit (hash-chained)
    C->>P: gates re-run (only affected checks change colour)
    C-->>A: ⚠ approval revoked (fingerprint mismatch)
    A->>C: review diffs + blame popovers → approve
    C->>C: approval commit + receipt.json/md + evidence.csv
    V->>C: renders ONLY if fingerprint still matches
    Note over V: fact change ⇒ client view flips to "being updated"
```

## Core functionality

### Layer A — research chat

| Feature | Detail |
|---|---|
| **Cited answers** | Every claim carries `[n]` → source chips (title, domain, snippet, URL, retrieval time). Invented citations are **stripped server-side** (I2) |
| **Live web research** | `web_search` = Tavily first, **Exa fallback**; `fetch_url` = Tavily extract or SSRF-guarded direct fetch; HTML stripped; prompt-injection screened + flagged |
| **Visible steps** | Perplexity-style thinking (real streamed reasoning text), Devin-style tool cards with **real diffs** (`+6 −0 183b`), line counts, result values, per-call source chips |
| **Model gateway** | 13 live-probed models across OpenRouter/Groq/NVIDIA; TTFT EWMA routing, cross-provider **hedging** (900ms), failover on any pre-content error, per-model cooldowns, transient-retry |
| **Workbench** | Sandboxed per-session FS: create/modify/delete with snapshots + undo, auto-saved audit trail (`trace.txt`, `sources.csv`, `telemetry.jsonl`) |
| **Intent routing** | Code-first heuristics (typos, Hinglish) → LLM classifier fallback; chat vs research routes |

### Layer B — Plan PR console

| Feature | Detail |
|---|---|
| **Case repo** | Git-like hash-chained commits (`sha256(parent+changes)`); every fact edit = commit with before→after; undo = revert commit |
| **Deterministic planner** | SIP/inflation math, goal bucketing, risk capacity vs tolerance (`min(capacity, tolerance)` with clamping), all inputs owner-tagged — **no LLM in the math** |
| **9 gates + custom rules** | identity, freshness, horizon/liquidity, essential-goal ring-fence, concentration, risk clamp, escalations, citation coverage, disclosure — plus adviser-authored rules via a zod-validated DSL with 6-persona dry-run |
| **Approval = merge** | `sha256(facts+plan+gates+draft)` fingerprint; any later commit revokes; client view renders only the matching fingerprint |
| **Client view** | Read-only approved plan, EN/हिंदी toggle (numbers slot-locked), disclosures, 3 teach-back questions |
| **Receipts + evidence** | `receipt.json` + `receipt.md` + `evidence.csv` + one-click **evidence.zip** export |
| **Policy pack** | Gates list, banned phrases, explicit assumptions (owner/date/source), **missing-page challenge** (quarantine a source → field flips to `unavailable` everywhere) |
| **Red-team arcade** | 10 attack cards × paraphrases through the **real** chat pipeline; verdict + rule fired + permitted alternative |

## Invariants (enforced in code, not vibes)

| # | Invariant | Where |
|---|---|---|
| I1 | LLM never emits a material number — vault/calculator slots only; raw digits in drafts fail lint | `src/lib/gates/draft.ts` |
| I2 | Every claim has a source or says "unavailable" — invented `[n]` stripped | `src/lib/agent/citations.ts` |
| I3 | No guaranteed/assured/risk-free language | banned-phrase screens + red-team checkers |
| I4 | Nothing reaches a client without hash-bound adviser approval | `src/lib/case/approval.ts` |
| I5 | Tool/web/PDF content is data, never instructions | injection screen + quarantine |
| I6 | Secrets server-side only | `src/lib/env.ts`, gitignored `.env` |
| I7 | Every reported number reproducible via `pnpm repro` | `scripts/repro.ts` |

## Quickstart

```bash
# 1. clone + install (Node LTS, pnpm)
git clone https://github.com/abhyudaya874-ai/plan-pr.git
cd plan-pr
pnpm install

# 2. add at least one LLM key (search keys optional — degrades gracefully)
cp .env.example .env
#   OPENROUTER_API_KEY=…   (or GROQ_API_KEY / NVIDIA_API_KEY)
#   TAVILY_API_KEY=…       (optional, real-time search)
#   EXA_API_KEY=…          (optional, search fallback)

# 3. run
pnpm dev            # http://localhost:3000

# 4. verify everything
pnpm typecheck && pnpm lint && pnpm test
pnpm repro          # regenerates every artifact in report/
```

**Demo paths**

| URL | What to try |
|---|---|
| `/` | `nav of parag parikh flexi cap` (vault blame) · `guarantee me 20%` (guardrail) · `save a csv of 3 index funds` (workbench + diff) |
| `/case` | pick the Patna doctor → facts commit → gates → **approve** → client link |
| `/client/<caseId>` | approved plan; edit any fact → watch it revoke |
| `/redteam` | run any attack card (+ paraphrases) through the real pipeline |
| `/policy` | hide a source page → its field flips to `unavailable`; compile a custom gate |

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `build` | dev server / production build |
| `pnpm typecheck` / `lint` / `test` | strict TS / ESLint / 74 vitest tests |
| `pnpm models:probe` | live-probe all provider models (TTFT, tool-calls, JSON) → `src/lib/llm/registry.live.json` |
| `pnpm vault:build` | rebuild the fund vault from `data/sources/` (AMFI NAV master + factsheets) |
| `pnpm prompt:eval` | golden-prompt eval across verified models → route defaults |
| `pnpm eval` | fund-QA (25 questions) + planner fixtures + red-team |
| `pnpm redteam` | 10 attack cards × paraphrases → `report/redteam.json` |
| `pnpm planner:fixtures` | all 6 personas through plan+gates → `report/planner-fixtures.json` |
| `pnpm deck` | regenerate the ≤10-slide PDF deck from report data |
| `pnpm repro` | **everything above, deterministically** |

## Reproducibility

Every number in `report/` regenerates from committed data + recorded runs:

```bash
pnpm repro && ls report/
# deck.pdf  fund-qa.json  latency.txt  manifest.json  planner-fixtures.json  redteam.json
```

- Dependencies pinned, lockfile committed, no randomness unseeded.
- LLM evals are **live** (recorded with model ids + timestamps); deterministic math is unit-tested with hand-computed fixtures.

## Judged metrics (current, honest)

| Metric | Result | Evidence |
|---|---|---|
| Fund QA (25 questions) | **25/25** — values with AMFI blame, gaps honestly `unavailable`, out-of-universe `not_found` | `report/fund-qa.json` |
| Suitability (6 personas) | 0 red gates on 5 personas; trader escalates **1 red by design** (loss-chasing flag) | `report/planner-fixtures.json` |
| Guardrails | **9/10 attack cards** fully green across 30 paraphrase variants (the 1 miss = provider rate-limit, not compliance); 10/10 on single prompts | `report/redteam.json` |
| Model gateway | 13 verified models, 3 providers, hedge + failover proven live | `report/latency.txt` |
| Tests | 74/74 across 9 files | `pnpm test` |

## Deployment (Vercel)

The app deploys to Vercel with one structural accommodation: serverless filesystems are read-only except `/tmp`, so all runtime writes (SQLite, case commits, workspace, quarantine) go through `RUNTIME_DIR` (`src/lib/paths.ts`) — the repo cwd in dev, `/tmp/pramaan` in production.

```bash
vercel link --project plan-pr
vercel env add OPENROUTER_API_KEY production   # + other keys
vercel env add RUNTIME_DIR production          # /tmp/pramaan
vercel deploy --prod
```

> Note: `/tmp` state is per-instance and resets on cold starts — the deployed demo is ephemeral between invocations. The durable, reproducible store is the local run + `pnpm repro`.

## Honest gaps

- **TER / AUM / returns** = `unavailable` in the vault — AMC factsheet pages are bot-guarded. The ingestion pipeline is ready: drop factsheet text into `data/sources/factsheets/` → `pnpm vault:build` fills fields with blame.
- **Cross-case retrieval isolation** is thin — the vault is a shared fund universe, not per-client data.
- **Deployed persistence** is ephemeral (above); local SQLite is durable.
- Model reasoning text shown in the UI is **provider-streamed output**, displayed as internal insight — not client-facing factual content.

## Stack

Next.js 16 (App Router, Node runtime) · React 19 · TypeScript strict · Tailwind · pnpm · zod · better-sqlite3 · vitest · `diff` · mathjs · own thin OpenAI-compatible SSE client (no LLM SDK) · Tavily + Exa behind one `SearchProvider` interface.

## License

MIT — demo data is synthetic and labelled SYNTHETIC; no real PAN, accounts, or health records.
