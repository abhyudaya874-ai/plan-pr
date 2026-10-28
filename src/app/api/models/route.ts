import { connection, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifiedModels } from "@/lib/llm/registry";

export async function GET(): Promise<NextResponse> {
  await connection();
  const models = verifiedModels({ fresh: true }).map((m) => ({
    key: m.key,
    provider: m.provider,
    modelId: m.modelId,
    label: m.label,
    tier: m.tier,
    caps: m.caps,
    contextWindow: m.contextWindow,
    ttftMs: m.probe?.ttftMs ?? null,
  }));
  return NextResponse.json({ models, providers: env().providers });
}
