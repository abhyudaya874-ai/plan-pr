---
description: Phase 00 (45 min). Scaffold repo, env, tooling, folders, scripts, PROGRESS.md. Run first.
---
# /00-bootstrap
1. Read every file in `.devin/rules/`. Write a 6-line restatement of mission + invariants I1-I7 into `PROGRESS.md`.
2. Check `node -v`, `pnpm -v`, `git status`. Init git if needed.
3. Scaffold Next.js (latest stable, App Router, TypeScript, Tailwind, ESLint, `src/`, alias `@/*`). Read `create-next-app --help` first; do not guess flags.
4. Install, pinned exact: zod, better-sqlite3, diff, mathjs, @tavily/core (verify package name in docs), lucide-react, clsx. Dev: vitest, tsx, prettier, @types/better-sqlite3, fastest-levenshtein.
5. tsconfig: strict + noUncheckedIndexedAccess. ESLint: no-explicit-any, no-floating-promises.
6. Create the folder structure from rule 10 (real empty modules with typed exports, no TODO stubs).
7. `.env.example` (names only), `.gitignore` (.env*, workspace/, *.db, .next, node_modules), `src/lib/env.ts` (zod, server-only, at least one LLM key required, booleans exposed for health).
8. package.json scripts per rule 10 (scripts may be stubs that exit 1 with a clear message until their phase).
9. Create `PROGRESS.md` (phase table: 00..95 with status/time/notes) and `docs/DECISIONS.md` (date, decision, why, doc URL).
10. `GET /api/health` -> `{ok, providers:{openrouter:bool,groq:bool,nvidia:bool,tavily:bool}}`.
## Verify
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`; run dev, `curl /api/health`.
## Commit
`chore: bootstrap project` . Update PROGRESS.md. Next: /10-model-gateway
