import { readFileSync } from "node:fs";
import path from "node:path";
import { computePlan, type PlannerFacts } from "@/lib/planner";
import { plannerPolicy } from "@/lib/policy";
import { vaultFunds } from "@/lib/vault/load";
import {
  customRuleSchema,
  evalCustomRule,
  loadCustomRules,
  saveCustomRules,
  type CustomRule,
} from "@/lib/gates/custom";

interface PersonaRow {
  id: string;
  label: string;
  behavioralFlags?: string[];
}

/**
 * POST /api/rules/compile — zod-validate a custom rule, DRY-RUN it across all
 * 6 personas, and (if enable=true) persist it. Adviser confirms before it
 * reaches the pipeline — nothing goes live from a compile alone.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { rule?: unknown; enable?: boolean } | null;
  const parsed = customRuleSchema.safeParse(body?.rule);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "invalid_rule", detail: parsed.error.message },
      { status: 400 },
    );
  }
  const rule = parsed.data;
  const started = Date.now();

  const personas = (
    JSON.parse(readFileSync(path.join(process.cwd(), "data", "personas", "personas.json"), "utf8")) as {
      personas: (PlannerFacts & PersonaRow)[];
    }
  ).personas;
  const policy = plannerPolicy();
  const universe = vaultFunds().map((f) => ({
    schemeCode: f.schemeCode,
    amfiName: f.identity.amfiName,
    category: f.category,
  }));

  const table = personas.map((p) => {
    const flags = p.behavioralFlags ?? [];
    const plan = computePlan(p, policy, universe);
    const fired = evalCustomRule(rule, { facts: p, behavioralFlags: flags });
    return {
      persona: p.id,
      label: p.label,
      fires: fired !== null,
      wouldEmit: fired ? `${fired.status.toUpperCase()} — ${fired.why[0]}` : "—",
      planAssetMix: plan.numbers.goals.map((g) => g.assetClass).join("/"),
    };
  });

  let enabled = false;
  if (body?.enable) {
    const rules = loadCustomRules().filter((r) => r.id !== rule.id);
    rules.push({ ...rule, enabled: true } as CustomRule);
    saveCustomRules(rules);
    enabled = true;
  }

  return Response.json({
    ok: true,
    rule: rule.id,
    dryRunMs: Date.now() - started,
    firesOn: table.filter((t) => t.fires).map((t) => t.persona),
    table,
    enabled,
  });
}
