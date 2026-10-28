---
trigger: always_on
description: How the agent works: plan, verify, commit, never fake. Always loaded.
---
# Operating protocol (how you, the agent, work)

## Before acting
1. Restate the phase goal in <=3 lines. List files you will touch and the main risk.
2. Read before write: view existing files, grep for duplicates. Never recreate what exists.
3. Never code an external API from memory. Versions drift (today is late Oct 2026). For Next.js, Tavily, OpenRouter, Groq, NVIDIA NIM, any npm package: read current docs (web search / fetch) or the package's own `.d.ts` in node_modules first. Record the doc URL you used in docs/DECISIONS.md.

## While acting
4. Small steps, one conventional commit per step (`feat:`, `fix:`, `chore:`, `test:`).
5. No placeholders: no `TODO` stubs, no mocked "success", no fake data presented as real. If something cannot be done, implement an honest degraded path (explicit `unavailable` state) and log it.
6. TypeScript strict. No `any`, no `@ts-ignore`, no silent `catch {}`. Validate every boundary with zod (HTTP bodies, tool args, LLM JSON, files).
7. Failure loop: read the FULL error -> one hypothesis -> smallest fix -> rerun. After 3 failed attempts on the same error, change approach and log why in docs/DECISIONS.md. Never weaken a test to pass it.
8. Run things. A claim of "works" requires the command you ran and its result.

## Phase gates
9. Each workflow ends with a Verify block. Do not start the next phase until every check passes. Paste the real command + 1-line result into PROGRESS.md.
10. Time-box: if a phase passes 150% of budget, stop, apply the descope list (workflow 95), log it, move on.

## Ask the human ONLY when
- you need a secret/API key, or
- a choice is irreversible, or
- the permitted fund universe is unknown (organisers decide).
Otherwise decide, log in docs/DECISIONS.md, proceed.

## Context hygiene
- `PROGRESS.md` = current state (phase, done, next, blockers). `docs/DECISIONS.md` = why. Update both at the end of every step.
- When context feels heavy or after a restart: re-read PROGRESS.md, DECISIONS.md, and the active workflow, then continue.

## Before declaring a phase done (self-review)
- Diff read top to bottom. Dead code removed. Names honest.
- Invariants I1-I7 intact (grep for hardcoded numbers/URLs in prompts and drafts).
- Error paths exercised at least once.
- Report honestly: what works, what is degraded, what is not done.
