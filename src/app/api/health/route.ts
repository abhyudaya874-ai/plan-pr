import { connection, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(): Promise<NextResponse> {
  await connection();
  const e = env();
  return NextResponse.json({
    ok: true,
    providers: e.providers,
  });
}
