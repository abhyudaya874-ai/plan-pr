# Plan PR ("Pramaan")

AI co-pilot for a SEBI-registered Investment Adviser in India. Every client
plan is a **pull request**: facts in -> gates run -> adviser reviews ->
approval = merge. Every number carries `blame` (source doc, page, quote, date).

Zeckathon (Zetheta) 24-hour hackathon build. Full README (architecture,
repro steps, limitations) lands in phase 95.

## Quick start

```bash
cp .env.example .env   # fill at least one LLM key
pnpm install
pnpm dev               # http://localhost:3000, GET /api/health
```

## Verify

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Layout

See `.devin/rules/10-stack-and-structure.md` for the full structure contract.
Build order and per-phase gates live in `.devin/workflows/`; current state in
`PROGRESS.md`; rationale in `docs/DECISIONS.md`.
