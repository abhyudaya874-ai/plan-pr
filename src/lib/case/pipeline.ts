import { writeFileSync } from "node:fs";
import path from "node:path";
import { computePlan, type GoalInput, type PlanOutput, type PlannerFacts } from "@/lib/planner";
import { runAllGates, type GateResult } from "@/lib/gates";
import { DRAFT_A, fillSlots, lintNumbers, type LintResult, type SlotValue } from "@/lib/gates/draft";
import { plannerPolicy } from "@/lib/policy";
import { vaultFunds } from "@/lib/vault/load";
import { loadCase, type PlanCase } from "./index";

const inr = (n: number | null | undefined) =>
  n == null ? "unavailable" : `₹${n.toLocaleString("en-IN")}`;
const pct = (n: number | null | undefined) => (n == null ? "unavailable" : `${(n * 100).toFixed(1)}%`);

/** facts.* record -> PlannerFacts (goals reconstructed from goal_i.* keys). */
export function factsToPlanner(c: PlanCase): PlannerFacts {
  const f = c.facts;
  const num = (k: string) => (f[k] ? Number(f[k]!.value) : 0);
  const goals: GoalInput[] = [];
  for (let i = 0; i < 12; i++) {
    const label = f[`facts.goal_${i}.label`];
    if (!label) continue;
    goals.push({
      id: `goal_${i}`,
      label: String(label.value),
      amount: f[`facts.goal_${i}.amount`] ? Number(f[`facts.goal_${i}.amount`]!.value) : null,
      horizonMonths: Number(f[`facts.goal_${i}.horizon_months`]?.value ?? 60),
      priority: String(f[`facts.goal_${i}.priority`]?.value ?? "important"),
      ...(f[`facts.goal_${i}.type`] ? { type: String(f[`facts.goal_${i}.type`]!.value) } : {}),
    });
  }
  return {
    age: num("facts.age"),
    incomeMonthly: num("facts.income_monthly"),
    incomeStable: f["facts.income_stable"] ? Boolean(f["facts.income_stable"]!.value) : true,
    dependents: num("facts.dependents"),
    emergencyBufferMonths: num("facts.emergency_buffer_months"),
    statedRiskTolerance: String(f["facts.stated_risk_tolerance"]?.value ?? "moderate"),
    goals,
    ...(f["facts.corpus"] ? { corpus: Number(f["facts.corpus"]!.value) } : {}),
  };
}

export function behavioralFlags(c: PlanCase): string[] {
  const v = c.facts["facts.behavioral_flags"]?.value;
  return typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export interface PipelineResult {
  plan: PlanOutput;
  gates: GateResult[];
  draft: string;
  lint: LintResult;
}

/** Deterministic pipeline: facts -> plan -> gates -> slot draft -> lint. */
export function runPipeline(caseId: string): PipelineResult | null {
  const c = loadCase(caseId);
  if (!c) return null;
  const facts = factsToPlanner(c);
  const policy = plannerPolicy();
  const universe = vaultFunds().map((f) => ({
    schemeCode: f.schemeCode,
    amfiName: f.identity.amfiName,
    category: f.category,
  }));
  const plan = computePlan(facts, policy, universe);
  const gates = runAllGates({
    facts,
    plan,
    vault: vaultFunds(),
    behavioralFlags: behavioralFlags(c),
  });

  const slots: SlotValue[] = [
    { path: "client.name", text: c.name },
    { path: "client.age", text: String(facts.age) },
    { path: "client.city", text: String(c.facts["facts.city"]?.value ?? "—") },
    { path: "plan.emergency_target", text: inr(plan.numbers.emergencyTarget) },
    { path: "plan.buffer_months", text: "6" },
    { path: "plan.essentials_monthly", text: inr(plan.numbers.monthlyEssentials) },
    { path: "plan.current_buffer", text: inr(Math.round(facts.emergencyBufferMonths * (plan.numbers.monthlyEssentials ?? 0))) },
    { path: "plan.emergency_gap", text: inr(plan.numbers.emergencyGap) },
    {
      path: "goals.table",
      text: plan.numbers.goals
        .map(
          (g) =>
            `- ${g.label}: need ${inr(g.inflatedAmount ?? g.amountNeeded)} in ${g.horizonMonths}m → SIP ${g.monthlySip == null ? "needs rate" : inr(g.monthlySip)} (${g.assetClass})`,
        )
        .join("\n"),
    },
    {
      path: "funds.table",
      text: plan.suggestedFunds
        .map((s) => {
          const fund = vaultFunds().find((v) => v.schemeCode === s.schemeCode);
          return `- ${fund?.identity.amfiName ?? s.schemeCode} — ${s.pct}% (${s.purpose})`;
        })
        .join("\n"),
    },
    { path: "assumptions.inflation", text: pct(policy.inflationRate?.value) },
    { path: "assumptions.conservative", text: pct(policy.conservativeReturn?.value) },
    { path: "assumptions.balanced", text: pct(policy.balancedReturn?.value) },
    { path: "assumptions.equity", text: pct(policy.equityReturn?.value) },
  ];
  const draft = fillSlots(DRAFT_A, slots);
  const lint = lintNumbers(draft, slots);

  const result = { plan, gates, draft, lint };
  const dir = path.join(process.cwd(), "data", "cases", caseId);
  writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  writeFileSync(path.join(dir, "gates.json"), JSON.stringify(gates, null, 2) + "\n");
  writeFileSync(path.join(dir, "draft.md"), draft + "\n");
  return result;
}
