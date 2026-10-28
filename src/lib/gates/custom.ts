import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PlannerFacts } from "@/lib/planner";
import type { GateResult } from "./index";

/**
 * Custom rule DSL — the adviser adds a gate in English-ish JSON; it is
 * zod-validated, dry-run against all 6 personas, and only evaluated
 * after enablement. Deterministic evaluator, no LLM.
 */
export const customRuleSchema = z.object({
  schema: z.literal("custom_rule_v1"),
  id: z.string().regex(/^[a-z0-9_]{3,40}$/),
  name: z.string().min(4).max(120),
  when: z.union([
    z.object({
      field: z.enum([
        "age",
        "incomeMonthly",
        "emergencyBufferMonths",
        "statedRiskTolerance",
        "corpus",
        "dependents",
        "incomeStable",
      ]),
      op: z.enum([">", "<", ">=", "<=", "==", "!="]),
      value: z.union([z.number(), z.string(), z.boolean()]),
    }),
    z.object({ behavioralFlag: z.string().min(2).max(60) }),
    z.object({ goalHorizonMonthsLt: z.number().min(0).max(600) }),
  ]),
  then: z.object({
    status: z.enum(["amber", "red"]),
    message: z.string().min(6).max(400),
  }),
  enabled: z.boolean().default(false),
});
export type CustomRule = z.infer<typeof customRuleSchema>;

const RULES_PATH = path.join(process.cwd(), "data", "policy", "custom-rules.json");

export function loadCustomRules(): CustomRule[] {
  if (!existsSync(RULES_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(RULES_PATH, "utf8")) as { rules?: unknown[] };
    return (raw.rules ?? []).map((r) => customRuleSchema.parse(r));
  } catch {
    return [];
  }
}

export function saveCustomRules(rules: CustomRule[]) {
  writeFileSync(RULES_PATH, JSON.stringify({ schema: "custom_rules_v1", rules }, null, 2) + "\n");
}

export function evalCustomRule(
  rule: CustomRule,
  ctx: { facts: PlannerFacts; behavioralFlags: string[] },
): GateResult | null {
  const { facts, behavioralFlags } = ctx;
  const w = rule.when;
  let fires = false;
  let inputDesc = "";

  if ("field" in w) {
    const cur = (facts as unknown as Record<string, unknown>)[w.field];
    inputDesc = `${w.field}=${JSON.stringify(cur)}`;
    const v = w.value;
    const cmp = typeof cur === "number" && typeof v === "number" ? cur - v : String(cur).localeCompare(String(v));
    fires =
      w.op === ">" ? cmp > 0 :
      w.op === "<" ? cmp < 0 :
      w.op === ">=" ? cmp >= 0 :
      w.op === "<=" ? cmp <= 0 :
      w.op === "==" ? cmp === 0 : cmp !== 0;
  } else if ("behavioralFlag" in w) {
    inputDesc = `flags=${behavioralFlags.join(",") || "none"}`;
    fires = behavioralFlags.includes(w.behavioralFlag);
  } else if ("goalHorizonMonthsLt" in w) {
    const near = facts.goals.filter((g) => g.horizonMonths < w.goalHorizonMonthsLt);
    inputDesc = `goals<${w.goalHorizonMonthsLt}m=${near.length}`;
    fires = near.length > 0;
  }

  if (!fires) return null;
  return {
    id: `custom_${rule.id}`,
    name: rule.name,
    status: rule.then.status,
    why: [rule.then.message],
    inputs: [inputDesc],
  };
}

export function runCustomRules(
  ctx: { facts: PlannerFacts; behavioralFlags: string[] },
  rules: CustomRule[] = loadCustomRules().filter((r) => r.enabled),
): GateResult[] {
  return rules.map((r) => evalCustomRule(r, ctx)).filter((g): g is GateResult => g !== null);
}
