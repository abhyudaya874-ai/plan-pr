/**
 * Deterministic plan computation (plan_case_v1 → plan draft).
 * No LLM anywhere in this file. Every input is owner-tagged {value,source,at};
 * anything not supplied renders as "needs policy value" — never guessed.
 * Return/goal math uses the fixed-point SIP/FV formulas only.
 */
import { z } from "zod";

export const taggedValueSchema = z.object({
  value: z.union([z.number(), z.string()]),
  source: z.string(), // "persona" | "policy:<file>" | "adviser" | "calc"
  at: z.string(),
});
export type TaggedValue = z.infer<typeof taggedValueSchema>;

export interface GoalInput {
  id: string;
  label: string;
  amount: number | null; // INR needed (null = open-ended saving)
  horizonMonths: number;
  priority: string;
  type?: string; // "income_stream" = drawdown from corpus
}

export interface PlannerFacts {
  age: number;
  incomeMonthly: number;
  incomeStable: boolean;
  dependents: number;
  emergencyBufferMonths: number; // liquid savings measured in months of essentials
  statedRiskTolerance: string;
  goals: GoalInput[];
  corpus?: number;
}

/** Policy inputs the planner needs (all owner-tagged; defaults only where labelled). */
export interface PolicyInputs {
  monthlyEssentialsFactor?: TaggedValue; // fraction of income treated as essentials (adviser input)
  bufferTargetMonths?: TaggedValue;      // emergency buffer target (default 6, editable)
  inflationRate?: TaggedValue;           // for child education / income goals
  conservativeReturn?: TaggedValue;      // debt-ish illustrative rate
  balancedReturn?: TaggedValue;          // hybrid-ish illustrative rate
  equityReturn?: TaggedValue;            // equity-ish illustrative rate
}

export interface Allocation {
  bucket: "emergency" | "protected" | "growth" | "income" | "aggressive_satellite";
  amountMonthly: number;
  pct: number;
  assetClass: "liquid" | "short_debt" | "corp_bond" | "cons_hybrid" | "dynamic" | "index" | "flexi" | "elss" | "small_cap" | "gold";
  horizon: string;
  rationale: string;
}

export interface Contradiction {
  id: string;
  severity: "red" | "amber";
  text: string;
}

export interface PlanOutput {
  generatedAt: string;
  inputsUsed: Record<string, TaggedValue | { missing: string }>;
  numbers: {
    monthlyEssentials: number | null;
    emergencyTarget: number | null;
    emergencyGap: number | null;
    investableMonthly: number;
    goals: {
      id: string;
      label: string;
      amountNeeded: number | null;
      inflatedAmount: number | null;
      horizonMonths: number;
      monthlySip: number | null;
      bucket: Allocation["bucket"];
      assetClass: Allocation["assetClass"];
      assumedReturn: number | null; // null = needs policy value
      rateSource: string | null;
    }[];
    incomeMonthlyRequired?: number;
    sustainableIncome?: { monthly: number; note: string } | null;
  };
  suggestedFunds: { schemeCode: string; purpose: string; pct: number }[];
  contradictions: Contradiction[];
  notes: string[];
}

export const SIP_FORMULA_NOTE = "sip = FV * r / (((1+r)^n - 1) * (1+r))";

export function sipForGoal(target: number, annualReturn: number, months: number): number {
  const r = annualReturn / 12;
  if (months <= 0) return target;
  if (r === 0) return target / months;
  const factor = (Math.pow(1 + r, months) - 1) * (1 + r);
  return Math.round((target * r) / factor);
}

export function inflateAmount(amount: number, annualInflation: number, months: number): number {
  return Math.round(amount * Math.pow(1 + annualInflation, months / 12));
}

/** Horizon → equity band + bucket. Conservative, documented, deterministic. */
export function bucketForGoal(g: GoalInput): { bucket: Allocation["bucket"]; assetClass: Allocation["assetClass"] } {
  const m = g.horizonMonths;
  if (g.type === "income_stream") return { bucket: "income", assetClass: "cons_hybrid" };
  if (g.priority === "essential_protected") return { bucket: "protected", assetClass: "short_debt" };
  if (m <= 12) return { bucket: "protected", assetClass: "liquid" };
  if (m <= 36) return { bucket: "protected", assetClass: "corp_bond" };
  if (m <= 84) return { bucket: "growth", assetClass: "cons_hybrid" };
  if (m <= 120) return { bucket: "growth", assetClass: "dynamic" };
  return { bucket: "growth", assetClass: "flexi" };
}

/** Risk ladder used by BOTH planner and gates (single source of truth). */
export const ASSET_RISK: Record<Allocation["assetClass"], number> = {
  liquid: 0,
  short_debt: 1,
  corp_bond: 1,
  gold: 2,
  cons_hybrid: 2,
  dynamic: 3,
  index: 4,
  flexi: 4,
  elss: 4,
  small_cap: 5,
};

const RISK_DOWN: Record<number, Allocation["assetClass"]> = {
  5: "dynamic",
  4: "dynamic",
  3: "cons_hybrid",
  2: "corp_bond",
  1: "liquid",
  0: "liquid",
};

/** Deterministic risk-capacity score -> 1..5. Exported for gates (single source). */
export function riskCapacity(facts: PlannerFacts): { score: number; reasons: string[] } {
  let s = 3;
  const reasons: string[] = [];
  if (!facts.incomeStable) { s -= 1; reasons.push("irregular income (-1)"); }
  else reasons.push("stable income (0)");
  const maxHorizon = Math.max(...facts.goals.map((g) => g.horizonMonths), 0);
  if (maxHorizon > 120) { s += 1; reasons.push(`long horizon ${Math.round(maxHorizon / 12)}y (+1)`); }
  if (maxHorizon <= 36) { s -= 1; reasons.push("short horizon <=3y (-1)"); }
  if (facts.dependents > 2) { s -= 1; reasons.push(`${facts.dependents} dependents (-1)`); }
  if (facts.emergencyBufferMonths < 1) { s -= 2; reasons.push("buffer <1m (-2)"); }
  else if (facts.emergencyBufferMonths < 3) { s -= 1; reasons.push("buffer <3m (-1)"); }
  if (facts.corpus && facts.corpus > 0) { s += 1; reasons.push("existing corpus (+1)"); }
  return { score: Math.max(1, Math.min(5, s)), reasons };
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

/**
 * Default resolution rule (rule 60): plan risk <= min(capacity, tolerance).
 * Asset class steps DOWN the ladder until it fits; the clamp is recorded as a
 * note (adviser can override with a recorded reason — phase 80).
 */
function clampToAllowed(
  ac: Allocation["assetClass"],
  allowed: number,
  notes: string[],
  goalLabel: string,
): Allocation["assetClass"] {
  let out = ac;
  while ((ASSET_RISK[out] ?? 0) > allowed) {
    out = RISK_DOWN[ASSET_RISK[out] ?? 0] ?? "liquid";
  }
  if (out !== ac) notes.push(`${goalLabel}: risk clamped ${ac} -> ${out} (allowed risk ${allowed})`);
  return out;
}

const CATEGORY_TO_ASSET: Record<string, Allocation["assetClass"]> = {
  liquid: "liquid",
  short_duration_debt: "short_debt",
  corporate_bond: "corp_bond",
  conservative_hybrid: "cons_hybrid",
  dynamic_asset_allocation: "dynamic",
  index_equity: "index",
  flexi_cap: "flexi",
  large_mid_cap: "flexi",
  elss: "elss",
  small_cap: "small_cap",
  aggressive_hybrid: "dynamic",
  gold_fof: "gold",
};

export function computePlan(
  facts: PlannerFacts,
  policy: PolicyInputs,
  universe: { schemeCode: string; amfiName: string; category: string }[],
): PlanOutput {
  const now = new Date().toISOString();
  const tag = (v: number | string, source: string): TaggedValue => ({ value: v, source, at: now });
  const inputsUsed: PlanOutput["inputsUsed"] = {};

  const essentialsFactor = policy.monthlyEssentialsFactor;
  const bufferMonths = policy.bufferTargetMonths?.value ?? tag(6, "policy:default(buffer=6m, adviser-editable)").value;
  inputsUsed["bufferTargetMonths"] = policy.bufferTargetMonths ?? { missing: "policy:bufferTargetMonths (default 6 applied)" };
  if (essentialsFactor) inputsUsed["monthlyEssentialsFactor"] = essentialsFactor;
  else inputsUsed["monthlyEssentialsFactor"] = { missing: "policy:monthlyEssentialsFactor" };

  const notes: string[] = [];
  const contradictions: Contradiction[] = [];

  const monthlyEssentials = essentialsFactor
    ? Math.round(facts.incomeMonthly * Number(essentialsFactor.value))
    : Math.round(facts.incomeMonthly * 0.7); // labelled fallback
  if (!essentialsFactor) notes.push("essentials = 70% of income (fallback, adviser should override)");

  const emergencyTarget = monthlyEssentials * Number(bufferMonths);
  const currentBuffer = facts.emergencyBufferMonths * monthlyEssentials;
  const emergencyGap = Math.max(0, emergencyTarget - currentBuffer);

  const investable = Math.max(0, Math.round(facts.incomeMonthly - monthlyEssentials));

  const goalsOut: PlanOutput["numbers"]["goals"] = [];
  const suggested = new Map<string, { purpose: string; pct: number; sip: number }>();
  const assetPick = (ac: Allocation["assetClass"]) =>
    universe.find((u) => CATEGORY_TO_ASSET[u.category] === ac);

  const capacity = riskCapacity(facts);
  const tolerance = TOLERANCE_RISK[facts.statedRiskTolerance] ?? 3;
  const allowedRisk = Math.min(capacity.score, tolerance);
  if (capacity.reasons.length || facts.statedRiskTolerance) {
    notes.push(
      `risk: capacity ${capacity.score} (${capacity.reasons.join("; ")}), tolerance ${tolerance}, allowed <= ${allowedRisk}`,
    );
  }

  for (const g of facts.goals) {
    const { bucket, assetClass: rawAc } = bucketForGoal(g);
    const assetClass = clampToAllowed(rawAc, allowedRisk, notes, g.label);
    // rate assumption per bucket: equity-return for flexi/index/elss, balanced for hybrids/dynamic, conservative for debt/liquid
    const rateTag =
      assetClass === "flexi" || assetClass === "index" || assetClass === "elss" || assetClass === "small_cap"
        ? policy.equityReturn
        : assetClass === "liquid" || assetClass === "short_debt" || assetClass === "corp_bond"
          ? policy.conservativeReturn
          : policy.balancedReturn;
    const rate = rateTag ? Number(rateTag.value) : null;
    const inflated = g.amount != null && policy.inflationRate
      ? inflateAmount(g.amount, Number(policy.inflationRate.value), g.horizonMonths)
      : g.amount;
    const sip = inflated != null && rate != null ? sipForGoal(inflated, rate, g.horizonMonths) : null;
    const pick = assetPick(assetClass);
    if (pick) {
      const cur = suggested.get(pick.schemeCode);
      suggested.set(pick.schemeCode, {
        purpose: cur ? `${cur.purpose} + ${g.label}` : g.label,
        pct: 0,
        sip: (cur?.sip ?? 0) + (sip ?? 0),
      });
    }
    goalsOut.push({
      id: g.id,
      label: g.label,
      amountNeeded: g.amount,
      inflatedAmount: inflated,
      horizonMonths: g.horizonMonths,
      monthlySip: sip,
      bucket,
      assetClass,
      assumedReturn: rate,
      rateSource: rateTag?.source ?? null,
    });
  }

  // income stream goal (retiree): corpus → sustainable monthly via SWP over horizon
  let incomeMonthlyRequired: number | undefined;
  let sustainableIncome: PlanOutput["numbers"]["sustainableIncome"] = null;
  const incomeGoal = facts.goals.find(
    (g): g is GoalInput & { amount: number } =>
      g.horizonMonths >= 240 && g.priority === "essential" && g.amount != null && g.amount < 100000,
  );
  if (incomeGoal && facts.corpus) {
    incomeMonthlyRequired = incomeGoal.amount;
    // simple drawdown: corpus * monthlyRate / (1-(1+r)^-n) using conservative rate
    const rate = policy.conservativeReturn ? Number(policy.conservativeReturn.value) : null;
    if (rate != null) {
      const r = rate / 12;
      const n = incomeGoal.horizonMonths;
      const monthly = Math.round((facts.corpus * r) / (1 - Math.pow(1 + r, -n)));
      sustainableIncome = {
        monthly,
        note: `annuity-style drawdown @ ${(rate * 100).toFixed(1)}%/yr over ${n}m, corpus ₹${(facts.corpus / 1e5).toFixed(0)}L (illustrative, no guarantee)`,
      };
      if (monthly < incomeGoal.amount) {
        contradictions.push({
          id: "income_gap",
          severity: "amber",
          text: `sustainable income ₹${monthly.toLocaleString("en-IN")}/mo < required ₹${incomeGoal.amount.toLocaleString("en-IN")}/mo — corpus shortfall`,
        });
      }
    }
  }

  // behavioural / unsuitable contradictions
  const wantsSmallcapOnly = facts.goals.some((g) => g.horizonMonths <= 24 && g.priority !== "essential_protected") && /very high|aggressive/.test(facts.statedRiskTolerance);
  if (wantsSmallcapOnly) {
    contradictions.push({
      id: "horizon_vs_risk",
      severity: "red",
      text: "money needed within ~2y combined with aggressive posture — volatile equity unsuitable for near-term needs",
    });
  }
  if (facts.emergencyBufferMonths < 3 && facts.incomeMonthly > 0) {
    contradictions.push({
      id: "thin_buffer",
      severity: "amber",
      text: `emergency buffer ${facts.emergencyBufferMonths}m < 3m — build liquidity before long-horizon equity`,
    });
  }
  if (!facts.incomeStable) {
    contradictions.push({
      id: "irregular_income",
      severity: "amber",
      text: "irregular income — larger buffer + SIP flexibility required",
    });
  }

  return {
    generatedAt: now,
    inputsUsed,
    numbers: {
      monthlyEssentials,
      emergencyTarget,
      emergencyGap,
      investableMonthly: investable,
      goals: goalsOut,
      ...(incomeMonthlyRequired !== undefined ? { incomeMonthlyRequired } : {}),
      sustainableIncome,
    },
    suggestedFunds: (() => {
      const totalSip = [...suggested.values()].reduce((a, b) => a + b.sip, 0);
      return [...suggested.entries()].map(([schemeCode, v]) => ({
        schemeCode,
        purpose: v.purpose,
        pct: totalSip > 0 ? Math.round((v.sip / totalSip) * 100) : Math.round(100 / Math.max(suggested.size, 1)),
      }));
    })(),
    contradictions,
    notes,
  };
}
