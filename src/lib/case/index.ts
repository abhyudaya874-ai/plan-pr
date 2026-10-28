import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Case repo (rule: case = repo, fact edit = commit).
 * - Every fact change creates a commit: {seq, parentHash, changes, factsAfter}
 * - hash = sha256(chain content); parent links form a tamper-evident chain.
 * - Any fact change revokes approval (status flips back to "open").
 * - Undo = a revert commit (never history rewrite).
 */

export const factValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  source: z.string().optional(), // "persona" | "adviser" | "vault" | "tool"
  at: z.string().optional(),
});
export type FactValue = z.infer<typeof factValueSchema>;

export const caseSchema = z.object({
  schema: z.literal("plan_case_v1"),
  caseId: z.string(),
  name: z.string(),
  personaId: z.string(),
  createdAt: z.string(),
  status: z.enum(["open", "in_review", "approved"]),
  facts: z.record(z.string(), factValueSchema),
  headCommit: z.number(),
});
export type PlanCase = z.infer<typeof caseSchema>;

export const commitSchema = z.object({
  schema: z.literal("case_commit_v1"),
  seq: z.number(),
  caseId: z.string(),
  at: z.string(),
  parentHash: z.string(),
  hash: z.string(),
  kind: z.enum(["init", "facts", "revert", "plan", "approval"]),
  changes: z.array(
    z.object({
      key: z.string(),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
    }),
  ),
  factsAfter: z.record(z.string(), factValueSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type CaseCommit = z.infer<typeof commitSchema>;

const ROOT = path.join(process.cwd(), "data", "cases");

const caseDir = (caseId: string) => path.join(ROOT, caseId);
const commitsDir = (caseId: string) => path.join(caseDir(caseId), "commits");

export function hashCommit(c: Omit<CaseCommit, "hash">): string {
  const canon = JSON.stringify({ ...c, hash: undefined });
  return createHash("sha256").update(canon).digest("hex");
}

export function loadCase(caseId: string): PlanCase | null {
  const p = path.join(caseDir(caseId), "case.json");
  if (!existsSync(p)) return null;
  try {
    return caseSchema.parse(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

export function saveCase(c: PlanCase): void {
  mkdirSync(caseDir(c.caseId), { recursive: true });
  writeFileSync(path.join(caseDir(c.caseId), "case.json"), JSON.stringify(c, null, 2) + "\n");
}

export function listCases(): { caseId: string; name: string; status: string; personaId: string }[] {
  if (!existsSync(ROOT)) return [];
  const out: { caseId: string; name: string; status: string; personaId: string }[] = [];
  for (const d of readdirSync(ROOT)) {
    const c = loadCase(d);
    if (c) out.push({ caseId: c.caseId, name: c.name, status: c.status, personaId: c.personaId });
  }
  return out;
}

export function loadCommit(caseId: string, seq: number): CaseCommit | null {
  const p = path.join(commitsDir(caseId), `${String(seq).padStart(4, "0")}.json`);
  if (!existsSync(p)) return null;
  try {
    return commitSchema.parse(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

export function listCommits(caseId: string): CaseCommit[] {
  const dir = commitsDir(caseId);
  if (!existsSync(dir)) return [];
  const out: CaseCommit[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    const c = loadCommit(caseId, Number(f.slice(0, 4)));
    if (c) out.push(c);
  }
  return out;
}

/** Verify the whole chain: every hash recomputes, every parent links. */
export function verifyChain(caseId: string): { ok: boolean; brokenAt?: number } {
  const commits = listCommits(caseId);
  let prev = "genesis";
  for (const c of commits) {
    if (c.parentHash !== prev) return { ok: false, brokenAt: c.seq };
    if (hashCommit(c) !== c.hash) return { ok: false, brokenAt: c.seq };
    prev = c.hash;
  }
  return { ok: true };
}

export function createCase(name: string, personaId: string, seedFacts: Record<string, FactValue>): PlanCase {
  const caseId = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(commitsDir(caseId), { recursive: true });
  const c: PlanCase = {
    schema: "plan_case_v1",
    caseId,
    name,
    personaId,
    createdAt: new Date().toISOString(),
    status: "open",
    facts: {},
    headCommit: -1,
  };
  saveCase(c);
  appendCommit(caseId, "init", seedFacts);
  return loadCase(caseId)!;
}

/**
 * Append a commit: compute changes vs current facts, snapshot factsAfter,
 * link parent hash, write immutable commit file, update case.
 * Any facts change revokes approval (I4: approval binds to content hash).
 */
export function appendCommit(
  caseId: string,
  kind: CaseCommit["kind"],
  changes: Record<string, FactValue | { __delete: true }>,
  meta?: Record<string, unknown>,
): CaseCommit {
  const c = loadCase(caseId);
  if (!c) throw new Error(`case not found: ${caseId}`);
  const parent = c.headCommit >= 0 ? loadCommit(caseId, c.headCommit) : null;
  const parentHash = parent?.hash ?? "genesis";
  const seq = c.headCommit + 1;

  const afterFacts = { ...c.facts };
  const diffs: CaseCommit["changes"] = [];
  for (const [key, v] of Object.entries(changes)) {
    if (v === null || (typeof v === "object" && "__delete" in v)) {
      if (key in afterFacts) {
        diffs.push({ key, before: afterFacts[key], after: undefined });
        delete afterFacts[key];
      }
      continue;
    }
    const before = afterFacts[key];
    if (JSON.stringify(before) === JSON.stringify(v)) continue;
    diffs.push({ key, before, after: v });
    afterFacts[key] = v;
  }

  const body: Omit<CaseCommit, "hash"> = {
    schema: "case_commit_v1",
    seq,
    caseId,
    at: new Date().toISOString(),
    parentHash,
    kind,
    changes: diffs,
    factsAfter: structuredClone(afterFacts),
    ...(meta ? { meta } : {}),
  };
  const commit: CaseCommit = { ...body, hash: hashCommit(body) };
  writeFileSync(
    path.join(commitsDir(caseId), `${String(seq).padStart(4, "0")}.json`),
    JSON.stringify(commit, null, 2) + "\n",
  );

  const updated: PlanCase = {
    ...c,
    facts: afterFacts,
    headCommit: seq,
    // a facts-changing commit revokes approval — gates must re-run
    status: kind === "approval" ? "approved" : diffs.length ? "open" : c.status,
  };
  saveCase(updated);
  return commit;
}

/** Revert the head commit's fact changes as a NEW revert commit. */
export function undoHead(caseId: string): CaseCommit | null {
  const c = loadCase(caseId);
  if (!c || c.headCommit <= 0) return null;
  const head = loadCommit(caseId, c.headCommit);
  if (!head) return null;
  const revert: Record<string, FactValue | { __delete: true }> = {};
  for (const ch of head.changes) {
    if (ch.before === undefined) {
      revert[ch.key] = { __delete: true };
    } else {
      revert[ch.key] = ch.before as FactValue;
    }
  }
  return appendCommit(caseId, "revert", revert, { reverted: head.seq });
}

/**
 * Blame: which commit introduced the CURRENT value of fact `key`?
 * Walk the chain backward; the latest commit touching key wins.
 */
export function blame(caseId: string, key: string) {
  const commits = listCommits(caseId);
  for (let i = commits.length - 1; i >= 0; i--) {
    const ch = commits[i]!.changes.find((x) => x.key === key);
    if (ch) {
      return {
        key,
        commitSeq: commits[i]!.seq,
        commitHash: commits[i]!.hash,
        at: commits[i]!.at,
        kind: commits[i]!.kind,
        before: ch.before,
        after: ch.after,
      };
    }
  }
  return null;
}
