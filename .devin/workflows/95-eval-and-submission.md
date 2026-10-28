---
description: Phase 95 (3h). Eval harness, repro, deck + video, repo transfer, freeze. Includes descope table.
---
# /95-eval-and-submission
1. Eval harness `src/lib/eval/`: (a) personas: expected CONSTRAINTS per persona (not exact allocations): must-flag, must-not-do, must-ask; (b) fund QA: >=40 self-written questions from the vault incl. 10 must-abstain; scoring: correct+cited=+1, abstain-when-unknown=0, wrong/uncited=-1; (c) attacks: 10 x >=3 paraphrases; (d) latency table per route/model.
2. `pnpm repro` regenerates `report/*.csv|json` from committed data and recorded runs; README documents the exact steps; every deck number exists in `report/`.
3. README: what it is, architecture diagram, how to run, env, how to reproduce, limitations (be explicit: synthetic personas, curated fund universe, not legal advice, no execution).
4. Deck (<=10 slides PDF): problem, insight (advice as PR), live demo screenshots, architecture, guardrails + red-team results, factual accuracy results, suitability results, adviser time saved (honest method), limits + next steps. Optional 3-min video script from the demo flow.
5. Submission: transfer GitHub repo ownership to user `ZethetaIntern`; send Zetheta the originating GitHub user id + one team/personal email. Do this EARLY (T-3h), not at the last minute.
6. Freeze at T-2h: no features, only fixes + rehearsal. Rehearse the 10-minute final with Q&A on: why slots, why approval fingerprint, what you do when the source is missing.
## Descope table (apply when over time, in this order)
1. Plain-language Hindi mirror -> English only. 2. Teach-back -> drop. 3. 10-year backtest -> drop. 4. Withdrawal stress table -> simple deterministic table. 5. Rule compiler UI -> keep JSON toggle only. 6. Time duel page -> manual stopwatch in demo. Never descope: slots/linter, vault + blame, approval fingerprint, attack suite, repro.
## Verify
`pnpm repro && pnpm test && pnpm build` green from a fresh clone. Run the full demo on a different machine/browser.
## Commit
`chore: submission freeze`.
