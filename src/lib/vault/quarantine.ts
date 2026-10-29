import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runtimePath } from "@/lib/paths";

/**
 * Source quarantine: a flag file listing schemeCode.field pairs whose source
 * page is unavailable/poisoned. Lookup of a quarantined field returns
 * `unavailable` with reason `quarantined` — never a substitute value (I2).
 * Used by the missing-page challenge + injection quarantine in /policy.
 */
const Q_PATH = runtimePath("data", "vault", "quarantine.json");

interface QuarantineFile {
  entries: { key: string; reason: string; at: string; by: string }[];
}

function readQ(): QuarantineFile {
  if (!existsSync(Q_PATH)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(Q_PATH, "utf8")) as QuarantineFile;
  } catch {
    return { entries: [] };
  }
}

export function isQuarantined(schemeCode: string, field: string): { flagged: boolean; reason?: string } {
  const key = `${schemeCode}.${field.toLowerCase()}`;
  const hit = readQ().entries.find((e) => e.key === key || e.key === `${schemeCode}.*`);
  return hit ? { flagged: true, reason: hit.reason } : { flagged: false };
}

export function quarantineSet(schemeCode: string, field: string, reason: string, by: string) {
  const q = readQ();
  const key = `${schemeCode}.${field.toLowerCase()}`;
  if (!q.entries.some((e) => e.key === key)) {
    q.entries.push({ key, reason, at: new Date().toISOString(), by });
    writeFileSync(Q_PATH, JSON.stringify(q, null, 2) + "\n");
  }
}

export function quarantineClear(schemeCode: string, field: string) {
  const q = readQ();
  const key = `${schemeCode}.${field.toLowerCase()}`;
  q.entries = q.entries.filter((e) => e.key !== key);
  writeFileSync(Q_PATH, JSON.stringify(q, null, 2) + "\n");
}

export function quarantineList() {
  return readQ().entries;
}
