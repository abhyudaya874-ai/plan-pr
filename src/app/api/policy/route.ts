import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { plannerPolicy } from "@/lib/policy";
import { loadCustomRules } from "@/lib/gates/custom";
import { quarantineList } from "@/lib/vault/quarantine";
import { vaultFunds } from "@/lib/vault/load";

const GATES = [
  { id: "identity", name: "Fund identity lock" },
  { id: "freshness", name: "Field freshness / availability" },
  { id: "horizon_liquidity", name: "Horizon vs liquidity" },
  { id: "goal_protection", name: "Essential goal ring-fence" },
  { id: "concentration", name: "Fund concentration" },
  { id: "risk_capacity_tolerance", name: "Risk: capacity vs tolerance" },
  { id: "escalations", name: "Escalations & contradictions" },
  { id: "citation_coverage", name: "Citation/input coverage" },
  { id: "disclosure", name: "Disclosure (plan type + AI use)" },
];

const BANNED = ["guaranteed %", "assured returns", "risk-free", "pakka return", "will double"];

/** GET /api/policy — the active policy pack as data (for /policy viewer). */
export async function GET(): Promise<Response> {
  const policy = plannerPolicy();
  const assumptionsPath = path.join(process.cwd(), "data", "policy", "assumptions.json");
  const assumptions = existsSync(assumptionsPath)
    ? (JSON.parse(readFileSync(assumptionsPath, "utf8")) as unknown)
    : null;
  const funds = vaultFunds().map((f) => ({
    schemeCode: f.schemeCode,
    amfiName: f.identity.amfiName,
    category: f.category,
    fields: Object.keys(f.fields),
  }));
  return Response.json({
    gates: GATES,
    bannedPhrases: BANNED,
    assumptions,
    policySummary: {
      inflation: policy.inflationRate?.value,
      equityReturn: policy.equityReturn?.value,
      conservativeReturn: policy.conservativeReturn?.value,
      balancedReturn: policy.balancedReturn?.value,
    },
    customRules: loadCustomRules(),
    quarantine: quarantineList(),
    universe: funds,
  });
}
