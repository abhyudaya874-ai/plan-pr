import { readFileSync } from "node:fs";
import path from "node:path";
import { registrySchema, type ModelEntry, type Registry } from "./types";

const LIVE_PATH = path.join(process.cwd(), "src/lib/llm/registry.live.json");
const SEED_PATH = path.join(process.cwd(), "src/lib/llm/registry.seed.json");

function loadFile(p: string): Registry | null {
  try {
    const parsed = registrySchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let cached: Registry | null = null;
let cachedAt = 0;
const CACHE_MS = 5_000;

/**
 * Live registry is authoritative; seed is a fallback containing only
 * unverified candidates (which never appear in the picker).
 */
export function loadRegistry(opts?: { fresh?: boolean }): Registry {
  if (!opts?.fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const reg =
    loadFile(LIVE_PATH) ?? loadFile(SEED_PATH) ?? { generatedAt: "", models: [] };
  cached = reg;
  cachedAt = Date.now();
  return reg;
}

export function verifiedModels(opts?: { fresh?: boolean }): ModelEntry[] {
  const now = Date.now();
  return loadRegistry(opts).models.filter(
    (m) => m.verified && (m.cooldownUntil === undefined || m.cooldownUntil <= now),
  );
}

export function allModels(): ModelEntry[] {
  return loadRegistry().models;
}

export function getModel(key: string): ModelEntry | undefined {
  return loadRegistry().models.find((m) => m.key === key);
}
