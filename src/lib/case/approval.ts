import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendCommit, loadCase, type PlanCase } from "./index";
import { writeReceiptArtifacts } from "./receipt";

/**
 * Approval = advisory sign-off bound to a content fingerprint (I4).
 * hash = sha256(facts + plan + draft + gates) — any change invalidates it.
 * Stored as an "approval" commit + receipt.json artifact.
 */

export interface ApprovalReceipt {
  schema: "approval_receipt_v1";
  caseId: string;
  approvedBy: string;
  at: string;
  contentHash: string; // sha256 over facts+plan+draft+gates
  headCommit: number;
  gateSummary: { green: number; amber: number; red: number };
  disclosure: string;
}

const caseDir = (id: string) => path.join(process.cwd(), "data", "cases", id);

/**
 * Canonical content hash: facts (canonical JSON) + plan + gates + draft.
 * case.json is deliberately EXCLUDED — it mutates on the approval commit
 * itself (status/headCommit), which would invalidate the fingerprint at once.
 */
export function contentHash(caseId: string): string | null {
  const c = loadCase(caseId);
  if (!c) return null;
  const dir = caseDir(caseId);
  const parts: string[] = [JSON.stringify(c.facts)];
  for (const f of ["plan.json", "gates.json", "draft.md"]) {
    const p = path.join(dir, f);
    if (existsSync(p)) parts.push(readFileSync(p, "utf8"));
  }
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}

export function approve(caseId: string, approver: string): ApprovalReceipt | null {
  const c = loadCase(caseId);
  if (!c) return null;
  const hash = contentHash(caseId);
  if (!hash) return null;
  const gatesPath = path.join(caseDir(caseId), "gates.json");
  const gates = existsSync(gatesPath)
    ? (JSON.parse(readFileSync(gatesPath, "utf8")) as { status: string }[])
    : [];
  const commit = appendCommit(caseId, "approval", {}, { approvedBy: approver, contentHash: hash });
  const receipt: ApprovalReceipt = {
    schema: "approval_receipt_v1",
    caseId,
    approvedBy: approver,
    at: new Date().toISOString(),
    contentHash: hash,
    headCommit: commit.seq, // recorded AFTER the approval commit lands
    gateSummary: {
      green: gates.filter((g) => g.status === "green").length,
      amber: gates.filter((g) => g.status === "amber").length,
      red: gates.filter((g) => g.status === "red").length,
    },
    disclosure:
      "Direct plans only. AI-assisted draft reviewed by a SEBI-registered Investment Adviser. Illustrative projections, not a return guarantee. Approval ≠ client trade consent; no execution in this app.",
  };
  writeFileSync(path.join(caseDir(caseId), "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  writeReceiptArtifacts(caseId, c, receipt); // receipt.md + evidence.csv
  return receipt;
}

export function loadReceipt(caseId: string): ApprovalReceipt | null {
  const p = path.join(caseDir(caseId), "receipt.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ApprovalReceipt;
  } catch {
    return null;
  }
}

/** Is the stored receipt still valid? Hash must match current content. */
export function approvalValid(c: PlanCase): { valid: boolean; receipt: ApprovalReceipt | null } {
  const receipt = loadReceipt(c.caseId);
  if (!receipt || c.status !== "approved") return { valid: false, receipt };
  const current = contentHash(c.caseId);
  return { valid: current === receipt.contentHash && receipt.headCommit === c.headCommit, receipt };
}
