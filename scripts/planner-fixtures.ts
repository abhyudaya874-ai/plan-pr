/**
 * Run all 6 synthetic personas through facts -> plan -> gates and emit
 * report/planner-fixtures.json for the report + eval harness.
 *   pnpm planner:fixtures
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { computePlan, type GoalInput, type PlannerFacts } from "../src/lib/planner";
import { runAllGates } from "../src/lib/gates";
import { plannerPolicy } from "../src/lib/policy";
import { vaultFunds } from "../src/lib/vault/load";

const personaSchema = z.object({
  personas: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      age: z.number(),
      incomeMonthly: z.number(),
      incomeStable: z.boolean(),
      dependents: z.number(),
      emergencyBufferMonths: z.number(),
      statedRiskTolerance: z.string(),
      corpus: z.number().optional(),
      behavioralFlags: z.array(z.string()).optional(),
      goals: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          amount: z.number().nullable(),
          horizonMonths: z.number(),
          priority: z.string(),
          type: z.string().optional(),
        }),
      ),
    }),
  ),
});

async function main() {
  const { personas } = personaSchema.parse(
    JSON.parse(readFileSync("data/personas/personas.json", "utf8")),
  );
  const policy = plannerPolicy();
  const universe = vaultFunds().map((f) => ({
    schemeCode: f.schemeCode,
    amfiName: f.identity.amfiName,
    category: f.category,
  }));

  const out = personas.map((p) => {
    const facts: PlannerFacts = {
      age: p.age,
      incomeMonthly: p.incomeMonthly,
      incomeStable: p.incomeStable,
      dependents: p.dependents,
      emergencyBufferMonths: p.emergencyBufferMonths,
      statedRiskTolerance: p.statedRiskTolerance,
      goals: p.goals as GoalInput[],
      ...(p.corpus ? { corpus: p.corpus } : {}),
    };
    const plan = computePlan(facts, policy, universe);
    const gates = runAllGates({
      facts,
      plan,
      vault: vaultFunds(),
      behavioralFlags: p.behavioralFlags,
    });
    return {
      persona: p.id,
      label: p.label,
      numbers: plan.numbers,
      suggestedFunds: plan.suggestedFunds,
      contradictions: plan.contradictions,
      gates: gates.map((g) => ({ id: g.id, status: g.status, why: g.why.slice(0, 2) })),
      gateSummary: {
        red: gates.filter((g) => g.status === "red").length,
        amber: gates.filter((g) => g.status === "amber").length,
        green: gates.filter((g) => g.status === "green").length,
      },
    };
  });

  mkdirSync("report", { recursive: true });
  writeFileSync(
    path.join("report", "planner-fixtures.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), personas: out }, null, 2) + "\n",
  );
  for (const r of out) {
    console.log(
      `${r.persona}: ${r.gateSummary.red}R/${r.gateSummary.amber}A/${r.gateSummary.green}G | funds: ${r.suggestedFunds.map((f) => `${f.schemeCode}:${f.pct}%`).join(", ") || "none"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
