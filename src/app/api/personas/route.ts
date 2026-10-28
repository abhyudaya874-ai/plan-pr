import { readFileSync } from "node:fs";
import path from "node:path";

/** GET /api/personas -> the 6 synthetic personas for case creation. */
export async function GET(): Promise<Response> {
  const p = path.join(process.cwd(), "data", "personas", "personas.json");
  const d = JSON.parse(readFileSync(p, "utf8")) as { personas: unknown[] };
  return Response.json(d);
}
