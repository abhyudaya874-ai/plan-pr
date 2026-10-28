import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { navStale, resolveIdentity, vaultFundSchema, type FieldValue, type VaultFund } from "./index";
import { isQuarantined } from "./quarantine";

const VAULT_DIR = path.join(process.cwd(), "data", "vault", "funds");
const UNIVERSE_PATH = path.join(process.cwd(), "data", "vault", "universe.json");

let cache: { funds: VaultFund[]; universe: { funds: { schemeCode: string; amfiName: string; amc: string; category: string }[] }; loadedAt: number } | null = null;

export function vaultFunds(): VaultFund[] {
  return loadVault().funds;
}

export function loadVault() {
  if (cache && Date.now() - cache.loadedAt < 5000) return cache;
  const universe = JSON.parse(readFileSync(UNIVERSE_PATH, "utf8")) as {
    funds: { schemeCode: string; amfiName: string; amc: string; category: string }[];
  };
  const funds: VaultFund[] = [];
  if (existsSync(VAULT_DIR)) {
    for (const f of readdirSync(VAULT_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        funds.push(vaultFundSchema.parse(JSON.parse(readFileSync(path.join(VAULT_DIR, f), "utf8"))));
      } catch {
        /* skip malformed entries rather than crash */
      }
    }
  }
  cache = { funds, universe, loadedAt: Date.now() };
  return cache;
}

export interface VaultLookupOut {
  found: boolean;
  schemeCode?: string;
  amfiName?: string;
  ambiguous?: { code: string; name: string }[];
  field?: string;
  value?: FieldValue;
  stale?: boolean;
  identity?: VaultFund["identity"];
}

/**
 * 5-tuple lookup with identity lock: (amc, scheme, plan, option) resolves to
 * exactly one vault entry or fails/flags ambiguous. Then field serves from
 * vault only — never computed, never guessed.
 */
export function vaultLookup(input: {
  amc: string;
  scheme: string;
  plan: string;
  option: string;
  field: string;
}): VaultLookupOut {
  const { universe, funds } = loadVault();
  const res = resolveIdentity(universe, input.amc, input.scheme, input.plan, input.option);
  if (res.ambiguous.length) return { found: false, ambiguous: res.ambiguous };
  if (!res.code) return { found: false };
  const fund = funds.find((f) => f.schemeCode === res.code);
  if (!fund) return { found: false };
  const field = input.field.toLowerCase().replace(/\s+/g, "_");
  // quarantined/missing source page -> unavailable, never a substitute (I2)
  const q = isQuarantined(fund.schemeCode, field);
  if (q.flagged) {
    return {
      found: true,
      schemeCode: fund.schemeCode,
      amfiName: fund.identity.amfiName,
      field,
      value: { status: "unavailable", reason: `quarantined: ${q.reason}` },
      identity: fund.identity,
    };
  }
  const value = fund.fields[field];
  if (!value) {
    return {
      found: true,
      schemeCode: fund.schemeCode,
      amfiName: fund.identity.amfiName,
      field,
      value: { status: "unavailable", reason: `field "${field}" not in vault` },
      identity: fund.identity,
    };
  }
  const stale = field === "nav" ? navStale(String(fund.fields.nav_date?.value ?? "")) : false;
  return {
    found: true,
    schemeCode: fund.schemeCode,
    amfiName: fund.identity.amfiName,
    field,
    value,
    stale,
    identity: fund.identity,
  };
}

/** All fields for a fund (viewer). */
export function fundDetail(schemeCode: string): VaultFund | null {
  return vaultFunds().find((f) => f.schemeCode === schemeCode) ?? null;
}
