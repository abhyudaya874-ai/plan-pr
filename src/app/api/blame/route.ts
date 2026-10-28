import { blame, loadCase } from "@/lib/case";

/** GET /api/blame?caseId=&key= -> which commit introduced a fact. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const caseId = url.searchParams.get("caseId");
  const key = url.searchParams.get("key");
  if (!caseId || !key) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!loadCase(caseId)) return Response.json({ error: "not_found" }, { status: 404 });
  const b = blame(caseId, key);
  if (!b) return Response.json({ found: false });
  return Response.json({ found: true, ...b });
}
