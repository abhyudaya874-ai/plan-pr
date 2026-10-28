import { z } from "zod";
import { quarantineClear, quarantineList, quarantineSet } from "@/lib/vault/quarantine";

export async function GET(): Promise<Response> {
  return Response.json({ entries: quarantineList() });
}

const postSchema = z.object({
  schemeCode: z.string().min(1).max(12),
  field: z.string().min(1).max(60),
  action: z.enum(["set", "clear"]),
  reason: z.string().max(300).optional(),
});

/** Missing-page challenge + injection quarantine toggle. */
export async function POST(req: Request): Promise<Response> {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  if (b.action === "set") {
    quarantineSet(b.schemeCode, b.field, b.reason ?? "source page missing", "adviser");
  } else {
    quarantineClear(b.schemeCode, b.field);
  }
  return Response.json({ entries: quarantineList() });
}
