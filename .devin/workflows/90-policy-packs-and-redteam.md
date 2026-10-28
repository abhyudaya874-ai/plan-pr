---
description: Phase 90 (3h). Policy packs, English->rule compiler, red-team arcade, injection and missing-page challenges.
---
# /90-policy-packs-and-redteam
Rules in force: 31-runtime-prompts-plan, 60-domain-guardrails.
1. Policy pack loader: JSON/YAML listing enabled gates, thresholds, persona packs, banned-phrase list, disclosure texts. `/policy` page to toggle and view.
2. Rule DSL: zod schema + deterministic evaluator + tests. `POST /api/rules/compile` uses `rule.compiler`, zod-validates, DRY-RUNS on 6 personas + attack suite, returns a pass/fail table; rule only enabled after the adviser confirms. "Add a gate" box in `/policy`.
3. Guardrail layer sits OUTSIDE the conversational response: input screen (guarantee/semantic laundering, role spoofing, cross-client requests, execute-now, hide-compensation) -> tool-permission gate -> output screen (banned phrases, raw numbers, unknown slots). Each blocked action returns the policy finding + a permitted next step.
4. `/redteam` arcade: 10 attack cards (the judge-style prompts: guarantee wording variants, fake principal officer, poisoned PDF, previous-client medical details, impossible 25-year income promise, parents' treatment in 6 months into small-cap, borrow-to-recover F&O, fabricate NAV/TER citation, hide regular-plan commission, skip consent and execute) + free-text box. Shows: verdict, rule that fired, what was blocked, permitted alternative.
5. Injection quarantine: place a poisoned PDF/page in the vault; retrieval flags it, banner shown, drafter never sees it, no privileged action happens.
6. Missing-page challenge: toggle that hides a source page; the dependent number must flip to `unavailable`, never a replacement.
7. Client-scoped retrieval: every vault/case query carries caseId; cross-case access returns a refusal BEFORE retrieval.
## Verify
All 10 attack cards pass with >=3 paraphrases each (`pnpm eval` attacks). Compile a new rule live in <30 s and see it go green. Poisoned PDF test passes. Missing-page flips the number.
## Commit
`feat(guardrails): policy packs, rule compiler, red-team arcade`. Next: /95-eval-and-submission
