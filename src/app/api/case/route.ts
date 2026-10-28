import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendCommit,
  blame,
  createCase,
  factValueSchema,
  listCases,
  listCommits,
  loadCase,
  undoHead,
  verifyChain,
} from "@/lib/case";
import { runPipeline } from "@/lib/case/pipeline";
import { approve, approvalValid } from "@/lib/case/approval";

const postSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    name: z.string().min(1).max(200),
    personaId: z.string().min(1).max(80),
    facts: z.record(z.string(), factValueSchema).optional(),
  }),
  z.object({
    op: z.literal("facts"),
    caseId: z.string().min(1),
    facts: z.record(z.string(), factValueSchema),
  }),
  z.object({ op: z.literal("undo"), caseId: z.string().min(1) }),
  z.object({ op: z.literal("verify"), caseId: z.string().min(1) }),
  z.object({
    op: z.literal("approve"),
    caseId: z.string().min(1),
    approver: z.string().min(1).max(200),
    force: z.boolean().optional(),
  }),
]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const caseId = url.searchParams.get("caseId");
  if (!caseId) {
    return Response.json({ cases: listCases() });
  }
  const c = loadCase(caseId);
  if (!c) return Response.json({ error: "not_found" }, { status: 404 });
  const commits = listCommits(caseId);
  const verify = verifyChain(caseId);
  const dir = path.join(process.cwd(), "data", "cases", caseId);
  const readJson = (n: string) =>
    existsSync(path.join(dir, n))
      ? (JSON.parse(readFileSync(path.join(dir, n), "utf8")) as unknown)
      : null;
  const draft = existsSync(path.join(dir, "draft.md"))
    ? readFileSync(path.join(dir, "draft.md"), "utf8")
    : null;
  return Response.json({
    case: c,
    commits: commits.map((k) => ({
      seq: k.seq,
      kind: k.kind,
      at: k.at,
      hash: k.hash.slice(0, 12),
      changes: k.changes.map((ch) => ({
        key: ch.key,
        after: (ch.after as { value?: unknown } | undefined)?.value,
      })),
    })),
    chain: verify,
    head: commits.at(-1)?.hash.slice(0, 12) ?? null,
    plan: readJson("plan.json"),
    gates: readJson("gates.json"),
    draft,
    approval: approvalValid(c),
  });
}

export async function POST(req: Request): Promise<Response> {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request", detail: parsed.error.message }, { status: 400 });
  }
  const b = parsed.data;
  switch (b.op) {
    case "create": {
      const c = createCase(b.name, b.personaId, b.facts ?? {});
      const pipe = runPipeline(c.caseId); // domino: facts -> gates
      return Response.json({ case: c, gates: pipe?.gates.map((g) => ({ id: g.id, status: g.status })) });
    }
    case "facts": {
      if (!loadCase(b.caseId)) return Response.json({ error: "not_found" }, { status: 404 });
      const commit = appendCommit(b.caseId, "facts", b.facts);
      const pipe = runPipeline(b.caseId); // domino re-run on every fact change
      const c = loadCase(b.caseId)!;
      return Response.json({
        commit: { seq: commit.seq, hash: commit.hash.slice(0, 12) },
        case: c,
        gates: pipe?.gates.map((g) => ({ id: g.id, status: g.status })),
      });
    }
    case "undo": {
      const commit = undoHead(b.caseId);
      if (!commit) return Response.json({ error: "nothing_to_undo" }, { status: 400 });
      return Response.json({ reverted: true, case: loadCase(b.caseId) });
    }
    case "verify":
      return Response.json(verifyChain(b.caseId));
    case "approve": {
      const c = loadCase(b.caseId);
      if (!c) return Response.json({ error: "not_found" }, { status: 404 });
      const pipe = runPipeline(b.caseId);
      const redGates = (pipe?.gates ?? []).filter((g) => g.status === "red");
      if (redGates.length && !b.force) {
        return Response.json(
          { error: "red_gates", red: redGates.map((g) => g.id), hint: "resolve reds or force with a recorded reason" },
          { status: 409 },
        );
      }
      const receipt = approve(b.caseId, b.approver);
      return Response.json({ receipt, case: loadCase(b.caseId) });
    }
  }
}

export { blame };
