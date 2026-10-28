import { z } from "zod";
import { workspaceFor, WorkspaceError } from "@/lib/workspace";

const querySchema = z.object({
  sessionId: z.string().min(1).max(128),
  op: z.enum(["list", "read"]).default("list"),
  path: z.string().optional(),
});

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get("sessionId"),
    op: url.searchParams.get("op") ?? "list",
    path: url.searchParams.get("path") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const ws = workspaceFor(parsed.data.sessionId);
  try {
    if (parsed.data.op === "list") {
      return Response.json({ files: ws.list() });
    }
    if (!parsed.data.path) {
      return Response.json({ error: "path required" }, { status: 400 });
    }
    const { content, bytes } = ws.read(parsed.data.path);
    return Response.json({ content, bytes });
  } catch (e) {
    const status = e instanceof WorkspaceError && e.code === "notfound" ? 404 : 400;
    return Response.json(
      { error: e instanceof Error ? e.message : "error" },
      { status },
    );
  }
}

const postSchema = z.discriminatedUnion("op", [
  z.object({ sessionId: z.string().min(1).max(128), op: z.literal("undo") }),
  z.object({
    sessionId: z.string().min(1).max(128),
    op: z.literal("write"),
    path: z.string().min(1).max(500),
    content: z.string().max(2_000_000),
  }),
  z.object({
    sessionId: z.string().min(1).max(128),
    op: z.literal("delete"),
    path: z.string().min(1).max(500),
  }),
]);

export async function POST(req: Request): Promise<Response> {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const ws = workspaceFor(parsed.data.sessionId);
  try {
    switch (parsed.data.op) {
      case "undo": {
        const seq = ws.undo();
        return Response.json({ restored: seq });
      }
      case "write": {
        const c = ws.write(parsed.data.path, parsed.data.content, "user");
        return Response.json({ change: c });
      }
      case "delete": {
        const c = ws.delete(parsed.data.path, "user");
        return Response.json({ change: c });
      }
    }
  } catch (e) {
    const status = e instanceof WorkspaceError && e.code === "notfound" ? 404 : 400;
    return Response.json(
      { error: e instanceof Error ? e.message : "error" },
      { status },
    );
  }
}
