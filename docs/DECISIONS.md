# Decisions log

## 2026-10-28 — Phase 00 bootstrap

- **Scaffold**: `create-next-app@16.4.3` (latest stable; `npm view` +
  `create-next-app --help` output consulted, flags: `--ts --tailwind --eslint
  --app --src-dir --import-alias "@/*" --use-pnpm --disable-git`). Directory
  name `iitP` violates npm naming, so the app was scaffolded as
  `planpr-scaffold` in /tmp and moved in.
- **Next.js 16.4.3** uses Turbopack with `@tailwindcss/turbopack` for CSS and
  enables `cacheComponents` by default; kept as shipped.
- **Deps pinned exact** per rule 70 (lockfile committed).
- **lucide-react held at 1.55.0** (published 2026-10-10): 1.62.0 was published
  <48h ago and tripped pnpm's `minimumReleaseAge` gate; using the older version
  rather than adding a release-age exclusion.
- **esbuild + better-sqlite3 in allowBuilds** (pnpm-workspace.yaml): native
  build script needed for sqlite; esbuild postinstall needed by tsx/vitest.
  sharp/unrs-resolver builds stay disabled.
- **`server-only`** guards `src/lib/env.ts` from client-bundle import (I6);
  vitest aliases it to an empty stub since tests run in plain node.
- **Env**: `.env` (gitignored, chmod 600) holds provided OpenRouter/Groq/NIM
  keys. `TAVILY_API_KEY` absent — search tools will return `unavailable` until
  provided (graceful degradation per rule 10).
- **Scripts not yet implemented** exit 1 with the phase they land in (honest
  stubs, no fake output) — protocol item 5.
- **next/font/google kept** for Geist; if `pnpm build` stalls on the font
  fetch (slow network), fall back to the system stack — spec allows
  "system/Geist/Inter stack" (rule 50).
