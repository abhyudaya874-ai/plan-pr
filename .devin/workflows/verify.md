---
description: Cross-cutting verification. Run at the end of every phase and before any demo.
---
# /verify
1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Fix, never skip.
2. Secrets: grep repo + git history for key patterns; confirm `.env*` ignored.
3. Invariant audit: (I1) grep prompts/templates for literal numbers in drafts; run the number linter over all persona drafts. (I2) run the citation assertions: every shown URL is in a tool result. (I3) run banned-phrase scan on all outputs. (I4) try to read client view without approval. (I5) run the poisoned-page test. (I7) `pnpm repro` diff is empty.
4. Smoke the golden prompts (/20) in the UI on 3 different models.
5. Update `PROGRESS.md` with real command outputs (one line each) and any degraded paths.
6. Report: what works, what is degraded, what is not done.
