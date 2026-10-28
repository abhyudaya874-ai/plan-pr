import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const policySchema = z.object({
  values: z.record(
    z.string(),
    z.object({
      value: z.union([z.number(), z.string()]),
      source: z.string(),
      effective_date: z.string(),
      retrieved_at: z.string(),
      owner: z.string().optional(),
    }),
  ),
});

export type PolicyFile = z.infer<typeof policySchema>;
export type PolicyValue = PolicyFile["values"][string];

const DIR = path.join(process.cwd(), "data", "policy");

/** Load all policy files; each key keeps its source + date metadata. */
export function loadPolicy(): Record<string, Record<string, PolicyValue>> {
  const out: Record<string, Record<string, PolicyValue>> = {};
  if (!existsSync(DIR)) return out;
  for (const f of readdirSyncSafe(DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = policySchema.parse(JSON.parse(readFileSync(path.join(DIR, f), "utf8")));
      out[f.replace(/\.json$/, "")] = p.values;
    } catch {
      /* skip malformed policy files */
    }
  }
  return out;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Planner-facing tagged inputs from assumptions.json. */
export function plannerPolicy(): {
  monthlyEssentialsFactor?: { value: number; source: string; at: string };
  bufferTargetMonths?: { value: number; source: string; at: string };
  inflationRate?: { value: number; source: string; at: string };
  conservativeReturn?: { value: number; source: string; at: string };
  balancedReturn?: { value: number; source: string; at: string };
  equityReturn?: { value: number; source: string; at: string };
} {
  const v = loadPolicy()["assumptions"] ?? {};
  const tag = (k: string) =>
    v[k] ? { value: Number(v[k]!.value), source: `policy:assumptions/${k}`, at: v[k]!.retrieved_at } : undefined;
  return {
    monthlyEssentialsFactor: tag("monthlyEssentialsFactor"),
    bufferTargetMonths: tag("bufferTargetMonths"),
    inflationRate: tag("inflationRate"),
    conservativeReturn: tag("conservativeReturn"),
    balancedReturn: tag("balancedReturn"),
    equityReturn: tag("equityReturn"),
  };
}
