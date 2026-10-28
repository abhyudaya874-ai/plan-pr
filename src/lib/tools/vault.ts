import { z } from "zod";
import { vaultLookup } from "@/lib/vault/load";
import { fn, type Tool } from "./registry";

const args = z.object({
  amc: z.string().min(1),
  scheme: z.string().min(1),
  plan: z.string().default("Direct Plan"),
  option: z.string().default("Growth"),
  field: z.string().min(1),
});

export function vaultTool(): Tool {
  return {
    name: "vault_lookup",
    def: fn(
      "vault_lookup",
      "Look up a VERIFIED fund field (nav, nav_date, expense_ratio_direct, exit_load, aum, benchmark, fund_manager, riskometer, inception_date, returns_1y/3y/5y/si, category, min_sip). Returns blame metadata or 'unavailable' — never guesses.",
      {
        type: "object",
        properties: {
          amc: { type: "string", description: "e.g. 'PPFAS' or 'SBI'" },
          scheme: { type: "string", description: "fund name tokens, e.g. 'flexi cap'" },
          plan: { type: "string", description: "usually 'Direct Plan'" },
          option: { type: "string", description: "usually 'Growth'" },
          field: { type: "string", description: "field name e.g. nav, expense_ratio_direct" },
        },
        required: ["amc", "scheme", "field"],
      },
    ),
    argsSchema: args,
    run: async (raw) => {
      const parsed = args.parse(raw);
      const out = vaultLookup(parsed);
      if (!out.found) {
        return {
          ok: false,
          resultText: JSON.stringify(
            out.ambiguous
              ? { status: "ambiguous", candidates: out.ambiguous, hint: "ask which fund, or include more name tokens" }
              : { status: "not_found", hint: "fund is outside the verified universe; say unavailable rather than guess" },
          ),
          data: { status: out.ambiguous ? "ambiguous" : "not_found" },
        };
      }
      const v = out.value!;
      if (v.status === "unavailable") {
        return {
          ok: true,
          resultText: JSON.stringify({
            status: "unavailable",
            fund: out.amfiName,
            field: out.field,
            reason: v.reason ?? "not in vault",
          }),
        };
      }
      return {
        ok: true,
        resultText: JSON.stringify({
          status: "ok",
          fund: out.amfiName,
          field: out.field,
          value: v.value,
          unit: v.unit,
          stale: out.stale,
          blame: v.source,
        }),
        data: { vault: { schemeCode: out.schemeCode, field: out.field, stale: out.stale } },
      };
    },
  };
}
