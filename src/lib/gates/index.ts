/**
 * Plan gates — deterministic checks on a computed plan (the "CI checks" of
 * Plan PR). Every gate returns {status, why[], inputs[]}; red = hard fail,
 * amber = needs review, green = pass. No LLM.
 */
import { ASSET_RISK, riskCapacity, type PlanOutput, type PlannerFacts } from "@/lib/planner";
import type { VaultFund } from "@/lib/vault";

export type GateStatus = "green" | "amber" | "red";
export interface GateResult {
  id: string;
  name: string;
  status: GateStatus;
  why: string[];
  inputs: string[];
}

export interface GateContext {
  facts: PlannerFacts;
  plan: PlanOutput;
  vault: VaultFund[];
  behavioralFlags?: string[];
  draftText?: string;
}

const TOLERANCE_RISK: Record<string, number> = {
  low: 1,
  low_moderate: 2,
  moderate: 3,
  moderate_high: 4,
  high: 4,
  very_high: 5,
  very_high_stated: 5,
};

export { riskCapacity };

export function runAllGates(ctx: GateContext): GateResult[] {
  const { facts, plan, vault } = ctx;
  const results: GateResult[] = [];
  const cap = riskCapacity(facts);
  const tolerance = TOLERANCE_RISK[facts.statedRiskTolerance] ?? 3;
  const planRisk = Math.max(
    ...plan.numbers.goals.map((g) => ASSET_RISK[g.assetClass] ?? 3),
    0,
  );

  // 1. identity: every suggested fund resolves in the vault
  const unresolved = plan.suggestedFunds.filter(
    (sf) => !vault.find((v) => v.schemeCode === sf.schemeCode),
  );
  results.push({
    id: "identity",
    name: "Fund identity lock",
    status: unresolved.length ? "red" : "green",
    why: unresolved.length
      ? [`${unresolved.length} suggested fund(s) missing from vault: ${unresolved.map((u) => u.schemeCode).join(", ")}`]
      : ["all suggested funds resolve to vault entries"],
    inputs: plan.suggestedFunds.map((s) => s.schemeCode),
  });

  // 2. freshness: fields actually used are sourced (nav freshness checked at lookup)
  const vaultFieldMissing = plan.suggestedFunds
    .map((sf) => vault.find((v) => v.schemeCode === sf.schemeCode))
    .filter((v): v is VaultFund => Boolean(v))
    .filter((v) => v.fields.expense_ratio_direct?.status !== "ok");
  results.push({
    id: "freshness",
    name: "Field freshness / availability",
    status: vaultFieldMissing.length ? "amber" : "green",
    why: vaultFieldMissing.length
      ? [`${vaultFieldMissing.length} fund(s) lack verified TER — costs can't be compared until factsheets land`]
      : ["all consulted fields present in vault"],
    inputs: vaultFieldMissing.map((v) => v.schemeCode),
  });

  // 3. horizon-liquidity: protected/short goals not in volatile buckets
  const badHorizon = plan.numbers.goals.filter(
    (g) => g.horizonMonths <= 36 && (ASSET_RISK[g.assetClass] ?? 0) >= 3,
  );
  results.push({
    id: "horizon_liquidity",
    name: "Horizon vs liquidity",
    status: badHorizon.length ? "red" : "green",
    why: badHorizon.length
      ? badHorizon.map((g) => `${g.label}: ${g.horizonMonths}m horizon into ${g.assetClass}`)
      : ["no short-horizon goal in volatile assets"],
    inputs: plan.numbers.goals.map((g) => `${g.id}:${g.horizonMonths}m`),
  });

  // 4. goal protection: essential_protected goals only in protected buckets
  const unprotected = plan.numbers.goals.filter(
    (g) => g.bucket === "protected" && (ASSET_RISK[g.assetClass] ?? 0) > 1,
  );
  results.push({
    id: "goal_protection",
    name: "Essential goal ring-fence",
    status: unprotected.length ? "red" : "green",
    why: unprotected.length
      ? unprotected.map((g) => `${g.label} sits in ${g.assetClass}`)
      : ["protected goals are in liquid/short-debt buckets"],
    inputs: plan.numbers.goals.filter((g) => g.bucket === "protected").map((g) => g.id),
  });

  // 5. concentration: no single fund >40% of allocation
  const concentrated = plan.suggestedFunds.filter((f) => f.pct > 40 && plan.suggestedFunds.length > 1);
  results.push({
    id: "concentration",
    name: "Fund concentration",
    status: concentrated.length ? "amber" : "green",
    why: concentrated.length
      ? concentrated.map((f) => `${f.schemeCode} at ${f.pct}% of allocation`)
      : ["no single fund above 40%"],
    inputs: plan.suggestedFunds.map((f) => `${f.schemeCode}:${f.pct}%`),
  });

  // 6. risk capacity vs tolerance: planRisk <= min(capacity, tolerance)
  const allowed = Math.min(cap.score, tolerance);
  const over = planRisk - allowed;
  results.push({
    id: "risk_capacity_tolerance",
    name: "Risk: capacity vs tolerance",
    status: over > 1 ? "red" : over === 1 ? "amber" : "green",
    why: [
      `capacity=${cap.score} (${cap.reasons.join("; ")})`,
      `tolerance=${tolerance} (stated ${facts.statedRiskTolerance})`,
      `plan risk=${planRisk} vs allowed min=${allowed}`,
    ],
    inputs: [facts.statedRiskTolerance],
  });

  // 7. escalations: behavioural flags / contradictions force in_review
  const escalations = [
    ...(ctx.behavioralFlags ?? []),
    ...plan.contradictions.filter((c) => c.severity === "red").map((c) => c.id),
  ];
  results.push({
    id: "escalations",
    name: "Escalations & contradictions",
    status: escalations.length ? "red" : plan.contradictions.length ? "amber" : "green",
    why: escalations.length
      ? escalations.map((e) => `escalate: ${e}`)
      : plan.contradictions.length
        ? plan.contradictions.map((c) => c.text)
        : ["no behavioural flags"],
    inputs: ctx.behavioralFlags ?? [],
  });

  // 8. citation coverage: every number in plan output traces to a tagged input
  const uncited = plan.numbers.goals.filter(
    (g) => g.monthlySip != null && g.rateSource == null,
  );
  const missingPolicy = Object.values(plan.inputsUsed).filter(
    (v): v is { missing: string } => "missing" in v,
  );
  results.push({
    id: "citation_coverage",
    name: "Citation/input coverage",
    status: uncited.length || missingPolicy.length ? "amber" : "green",
    why: [
      ...(uncited.length ? [`${uncited.length} goal SIPs lack a rate source`] : []),
      ...(missingPolicy.length ? missingPolicy.map((m) => `missing input: ${m.missing}`) : []),
      ...(!uncited.length && !missingPolicy.length ? ["every computed number traces to a tagged input"] : []),
    ],
    inputs: Object.keys(plan.inputsUsed),
  });

  // 9. disclosure: direct-plan + AI-use disclosure must appear in the draft
  const draft = ctx.draftText ?? "";
  const hasPlanType = /direct/i.test(draft);
  const hasAi = /ai|illustrative|not guaranteed|adviser/i.test(draft);
  results.push({
    id: "disclosure",
    name: "Disclosure (plan type + AI use)",
    status: !draft ? "amber" : hasPlanType && hasAi ? "green" : "red",
    why: !draft
      ? ["no draft yet — disclosure check pending"]
      : [`plan type disclosed: ${hasPlanType}`, `AI/illustrative disclosed: ${hasAi}`],
    inputs: [],
  });

  return results;
}
