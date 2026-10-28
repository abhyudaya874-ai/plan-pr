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
      return Response.json({ case: c });
    }
    case "facts": {
      if (!loadCase(b.caseId)) return Response.json({ error: "not_found" }, { status: 404 });
      const commit = appendCommit(b.caseId, "facts", b.facts);
      const c = loadCase(b.caseId)!;
      return Response.json({ commit: { seq: commit.seq, hash: commit.hash.slice(0, 12) }, case: c });
    }
    case "undo": {
      const commit = undoHead(b.caseId);
      if (!commit) return Response.json({ error: "nothing_to_undo" }, { status: 400 });
      return Response.json({ reverted: true, case: loadCase(b.caseId) });
    }
    case "verify":
      return Response.json(verifyChain(b.caseId));
  }
}

export { blame };
