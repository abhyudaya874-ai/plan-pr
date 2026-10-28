---
description: Phase 70 (4h). Deterministic planner, risk resolver, gate framework, persona packs, slot drafter + number linter.
---
# /70-planner-and-gates
Rules in force: 60-domain-guardrails, 31-runtime-prompts-plan.
1. `src/lib/planner/`: pure functions with unit tests (hand-computed fixtures): inflation-adjusted goal cost (per-goal inflation input, optional FX input), required corpus, SIP (monthly compounding, state timing convention), glide-path table by years-to-goal (editable policy), retirement drawdown scenarios (spending first; hypothetical stress table clearly labelled), unfunded-goal levers (contribution, date, cost) BEFORE return bumps.
2. Risk resolver: capacity score from facts, tolerance from facts; `planRisk = min(capacity, tolerance)`; conflicts emit contradiction cards; adviser override requires a recorded reason (commit).
3. Gate interface: `Gate{id,title,severity,run(case)=>{status:"pass"|"warn"|"block", reason, evidence?, fix?, rejectedOptions?[]}}`. Runner executes all enabled gates, stores results, logs rejections (powers "why not this fund?").
4. Core gates: triage (urgent liquidity / needs clarification / planning-ready), missing-facts, interaction checker (goal x horizon x category x liquidity x affordability), contradiction cards, release checklist (identity, horizon, liquidity, evidence, disclosures, approval), no-fund answer (underfunded goal), injection quarantine, number linter, citation check, refusal-recovery text.
5. "Ask only what matters" (counterfactual, deterministic): for each missing fact, rerun gates with plausible min and max values; if any gate outcome flips, the fact is high-impact -> ask it; rank by number of flips.
6. Persona packs (gate bundles, toggle-able): bengaluru-starter, pune-education-runway, surat-surplus-sweeper, patna-medical-firewall, chennai-withdrawal, mumbai-fo-breaker. Each = a few gates + planner config, nothing bespoke in core.
7. Drafter: build slot list (vault + planner + disclosures) -> `drafter.slots` -> renderer fills slots -> linter (no raw digits outside slots, no unknown slots, banned-phrase scan) -> fail closed to a template draft if the model keeps failing.
8. Shortlist: transparent criteria (cost, category fit, liquidity, AUM, tenure from vault) producing ranked options with per-criterion reasons and a recorded rejection reason for each rejected fund.
9. Backtest (optional if time): 10-year NAV mix backtest from AMFI NAV history, labelled historical, not predictive.
## Verify
Planner tests green. Each of the 6 personas runs end to end: gates fire as expected, draft passes lint, no number outside a slot. The Patna case blocks equity for the medical goal; the trader case triggers the circuit breaker; the retiree draft contains no sufficiency promise.
## Commit
`feat(plan): deterministic planner, gates, persona packs, slot drafter`. Next: /80-pr-review-and-approval
