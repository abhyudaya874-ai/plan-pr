import { describe, expect, it } from "vitest";
import { computePlan, inflateAmount, riskCapacity, sipForGoal, type PlannerFacts } from "@/lib/planner";
import { runAllGates } from "@/lib/gates";
import { fillSlots, lintNumbers } from "@/lib/gates/draft";
import type { VaultFund } from "@/lib/vault";

const UNIVERSE = [
  { schemeCode: "119800", amfiName: "SBI LIQUID FUND", category: "liquid" },
  { schemeCode: "119016", amfiName: "HDFC Short Term Fund", category: "short_duration_debt" },
  { schemeCode: "120692", amfiName: "ICICI Prudential Corporate Bond Fund", category: "corporate_bond" },
  { schemeCode: "122639", amfiName: "Parag Parikh Flexi Cap Fund", category: "flexi_cap" },
  { schemeCode: "119118", amfiName: "HDFC Conservative Hybrid Fund", category: "conservative_hybrid" },
  { schemeCode: "119609", amfiName: "SBI AGGRESSIVE HYBRID FUND", category: "aggressive_hybrid" },
  { schemeCode: "118778", amfiName: "Nippon India Small Cap Fund", category: "small_cap" },
];

const POLICY = {
  monthlyEssentialsFactor: { value: 0.7, source: "test", at: "t" },
  bufferTargetMonths: { value: 6, source: "test", at: "t" },
  inflationRate: { value: 0.06, source: "test", at: "t" },
  conservativeReturn: { value: 0.06, source: "test", at: "t" },
  balancedReturn: { value: 0.09, source: "test", at: "t" },
  equityReturn: { value: 0.11, source: "test", at: "t" },
};

const baseFacts: PlannerFacts = {
  age: 30,
  incomeMonthly: 100000,
  incomeStable: true,
  dependents: 0,
  emergencyBufferMonths: 6,
  statedRiskTolerance: "high",
  goals: [
    { id: "g1", label: "house", amount: 5000000, horizonMonths: 120, priority: "essential" },
  ],
};

const emptyVault: VaultFund[] = UNIVERSE.map((u) => ({
  schema: "vault_fund_v1",
  schemeCode: u.schemeCode,
  identity: { amc: "x", scheme: u.amfiName, plan: "Direct Plan", option: "Growth", amfiName: u.amfiName, matchedBy: "t", matchedAt: "t" },
  category: u.category,
  fields: {},
  freshness: { builtAt: "t" },
}));

describe("SIP math (hand-computed)", () => {
  it("sipForGoal: 50L in 120m @11% = ~22.8k", () => {
    // r=.11/12; factor=(1.009167^120-1)*(1.009167)=1.9914*1.009167=2.0097
    // 5e6*0.009167/2.0097 = 22810
    const sip = sipForGoal(5000000, 0.11, 120);
    expect(sip).toBeGreaterThan(22700);
    expect(sip).toBeLessThan(23000);
  });
  it("sipForGoal: zero rate = straight division", () => {
    expect(sipForGoal(120000, 0, 12)).toBe(10000);
  });
  it("inflateAmount: 1L @6% for 10y = 179085", () => {
    expect(inflateAmount(100000, 0.06, 120)).toBe(179085);
  });
});

describe("risk capacity + clamp", () => {
  it("irregular income alone -> capacity 2", () => {
    const cap = riskCapacity({ ...baseFacts, incomeStable: false });
    expect(cap.score).toBe(2);
  });
  it("irregular + 3 deps + thin buffer -> capacity 1", () => {
    const cap = riskCapacity({ ...baseFacts, incomeStable: false, dependents: 3, emergencyBufferMonths: 2 });
    expect(cap.score).toBe(1);
  });
  it("plan clamps flexi to cons_hybrid when allowed=2", () => {
    const plan = computePlan({ ...baseFacts, statedRiskTolerance: "high", incomeStable: false }, POLICY, UNIVERSE);
    const g = plan.numbers.goals[0]!;
    expect(g.assetClass).toBe("cons_hybrid");
    expect(plan.notes.join(" ")).toContain("clamped");
  });
  it("protected goal always ring-fenced to short_debt", () => {
    const plan = computePlan({ ...baseFacts, goals: [{ id: "g", label: "parents medical", amount: 1e6, horizonMonths: 36, priority: "essential_protected" }] }, POLICY, UNIVERSE);
    expect(plan.numbers.goals[0]!.assetClass).toBe("short_debt");
    expect(plan.numbers.goals[0]!.bucket).toBe("protected");
  });
  it("income_stream goal goes to cons_hybrid not flexi", () => {
    const plan = computePlan({ ...baseFacts, age: 68, statedRiskTolerance: "low_moderate", corpus: 8000000, goals: [{ id: "g", label: "income", amount: 35000, horizonMonths: 300, priority: "essential", type: "income_stream" }] }, POLICY, UNIVERSE);
    expect(plan.numbers.goals[0]!.assetClass).toBe("cons_hybrid");
    expect(plan.numbers.sustainableIncome!.monthly).toBeGreaterThan(40000);
  });
});

describe("gates", () => {
  it("escalations red on behavioral flags", () => {
    const facts = { ...baseFacts, goals: [] };
    const plan = computePlan(facts, POLICY, UNIVERSE);
    const gates = runAllGates({ facts, plan, vault: emptyVault, behavioralFlags: ["loss_chasing_history"] });
    expect(gates.find((g) => g.id === "escalations")!.status).toBe("red");
  });
  it("identity green when all funds in vault; red on missing fund", () => {
    const facts = { ...baseFacts };
    const plan = computePlan(facts, POLICY, UNIVERSE);
    const g1 = runAllGates({ facts, plan, vault: emptyVault });
    expect(g1.find((g) => g.id === "identity")!.status).toBe("green");
    const plan2 = { ...plan, suggestedFunds: [{ schemeCode: "999999", purpose: "x", pct: 100 }] };
    const g2 = runAllGates({ facts, plan: plan2, vault: emptyVault });
    expect(g2.find((g) => g.id === "identity")!.status).toBe("red");
  });
  it("concentration amber above 40% single fund", () => {
    const facts = { ...baseFacts };
    const plan = { ...computePlan(facts, POLICY, UNIVERSE), suggestedFunds: [{ schemeCode: "122639", purpose: "x", pct: 90 }, { schemeCode: "119016", purpose: "y", pct: 10 }] };
    const gates = runAllGates({ facts, plan, vault: emptyVault });
    expect(gates.find((g) => g.id === "concentration")!.status).toBe("amber");
  });
  it("disclosure red when draft lacks plan-type + AI wording", () => {
    const facts = { ...baseFacts };
    const plan = computePlan(facts, POLICY, UNIVERSE);
    const gates = runAllGates({ facts, plan, vault: emptyVault, draftText: "Buy these funds now." });
    expect(gates.find((g) => g.id === "disclosure")!.status).toBe("red");
    const ok = runAllGates({ facts, plan, vault: emptyVault, draftText: "Direct plans, AI-assisted, illustrative not guaranteed." });
    expect(ok.find((g) => g.id === "disclosure")!.status).toBe("green");
  });
});

describe("numeric lint (I1/I3)", () => {
  const slots = [{ path: "x", text: "₹15,183" }];
  it("passes when digits come from slots", () => {
    expect(fillSlots("SIP {{x}}", slots)).toBe("SIP ₹15,183");
    expect(lintNumbers("SIP ₹15,183", slots).ok).toBe(true);
  });
  it("fails on raw unsourced digits", () => {
    const r = lintNumbers("SIP ₹15,183 and 20% growth", slots);
    expect(r.ok).toBe(false);
    expect(r.rawDigits).toContain("20%");
  });
  it("fails on banned guarantee phrases (en + hinglish)", () => {
    expect(lintNumbers("guaranteed 20% returns", slots).bannedHits.length).toBeGreaterThan(0);
    expect(lintNumbers("assured income of ₹15,183", slots).bannedHits.length).toBeGreaterThan(0);
    expect(lintNumbers("pakka return milega", slots).bannedHits.length).toBeGreaterThan(0);
  });
});
