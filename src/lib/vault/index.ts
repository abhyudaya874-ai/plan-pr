import { z } from "zod";

export const fieldValueSchema = z.object({
  status: z.enum(["ok", "unavailable"]).default("ok"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  unit: z.string().optional(),
  reason: z.string().optional(),
  source: z
    .object({
      doc: z.string().optional(),
      url: z.string().optional(),
      page: z.number().optional(),
      quote: z.string().optional(),
      retrievedAt: z.string(),
    })
    .optional(),
});
export type FieldValue = z.infer<typeof fieldValueSchema>;

export const vaultFundSchema = z.object({
  schema: z.literal("vault_fund_v1"),
  schemeCode: z.string(),
  identity: z.object({
    amc: z.string(),
    scheme: z.string(),
    plan: z.string(),
    option: z.string(),
    amfiName: z.string(),
    matchedBy: z.string(),
    matchedAt: z.string(),
  }),
  category: z.string(),
  fields: z.record(z.string(), fieldValueSchema),
  freshness: z.object({
    builtAt: z.string(),
    note: z.string().optional(),
  }),
});
export type VaultFund = z.infer<typeof vaultFundSchema>;

export const FACTSHEET_FIELDS = [
  "expense_ratio_direct",
  "expense_ratio_regular",
  "exit_load",
  "aum",
  "benchmark",
  "fund_manager",
  "manager_since",
  "returns_1y",
  "returns_3y",
  "returns_5y",
  "returns_si",
  "riskometer",
  "inception_date",
  "min_sip",
  "min_lumpsum",
] as const;

export const BASE_FIELDS = [
  "scheme_code",
  "amc",
  "scheme_name",
  "plan",
  "option",
  "category",
  "nav",
  "nav_date",
] as const;

/** normalize for identity matching: lowercase, collapse space, strip punctuation noise */
export const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export interface LookupResult {
  found: boolean;
  ambiguous?: { code: string; name: string }[];
  value?: FieldValue;
  identity?: VaultFund["identity"];
  stale?: boolean;
}

/**
 * Identity lock: resolve (amc, scheme, plan, option) to exactly ONE universe
 * entry. Normalized substring matching on scheme name; AMC must match.
 * 0 hits -> found:false. >1 hits -> ambiguous list. Never guesses.
 */
export function resolveIdentity(
  universe: { funds: { schemeCode: string; amfiName: string; amc: string; category: string }[] },
  amc: string,
  scheme: string,
  plan: string,
  option: string,
): { code: string | null; ambiguous: { code: string; name: string }[] } {
  const nScheme = norm(scheme);
  const nAmc = norm(amc);
  const nPlan = norm(plan);
  const nOpt = norm(option);

  const scored = universe.funds.map((f) => {
    const fName = norm(f.amfiName);
    const fAmc = norm(f.amc);
    const amcOk =
      !nAmc ||
      fAmc.includes(nAmc) ||
      nAmc.includes(fAmc.split(" ")[0] ?? fAmc) ||
      fAmc.startsWith(nAmc);
    const planOk = !nPlan || /direct/.test(nPlan) === true; // universe is all Direct
    const optOk = !nOpt || /growth/.test(nOpt) === true;
    // scheme tokens must all appear in the amfi name
    const tokens = nScheme.split(" ").filter((t) => t.length > 1);
    const hits = tokens.filter((t) => fName.includes(t)).length;
    const score = hits / Math.max(tokens.length, 1);
    return { f, amcOk, planOk, optOk, score };
  });

  const matches = scored
    .filter((s) => s.amcOk && s.planOk && s.optOk && s.score >= 0.8)
    .map((s) => ({ code: s.f.schemeCode, name: s.f.amfiName }));

  if (matches.length === 1) return { code: matches[0]!.code, ambiguous: [] };
  if (matches.length === 0) return { code: null, ambiguous: [] };
  return { code: null, ambiguous: matches };
}

/** NAV freshness: nav date within ~4 days of build date counts fresh. */
export function navStale(navDateStr: string, now: Date = new Date()): boolean {
  const d = new Date(navDateStr);
  if (Number.isNaN(d.getTime())) return true;
  return now.getTime() - d.getTime() > 4 * 24 * 3600 * 1000;
}
