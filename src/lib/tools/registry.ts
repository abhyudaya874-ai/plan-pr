import { z } from "zod";
import type { ToolDef } from "@/lib/llm/types";

export interface ToolExecution {
  ok: boolean;
  /** Text handed back to the model (wrapped in <tool_result>). */
  resultText: string;
  /** Structured payload for SSE events (never raw page dumps). */
  data?: Record<string, unknown>;
}

export interface ToolCtx {
  sessionId: string;
  signal?: AbortSignal;
  /** Per-turn web-evidence registry; tools that return sources register them here. */
  sources?: import("@/lib/agent/sources").SourceRegistry;
}

export interface Tool {
  name: string;
  def: ToolDef;
  argsSchema: z.ZodType<unknown>;
  run: (args: unknown, ctx: ToolCtx) => Promise<ToolExecution>;
}

export function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): ToolDef {
  return {
    type: "function",
    function: { name, description, parameters },
  };
}

/** Honest degradation: a real tool that reports "unavailable" until its phase lands. */
export function unavailableTool(
  name: string,
  phase: string,
  description: string,
  parameters: Record<string, unknown>,
): Tool {
  return {
    name,
    def: fn(name, description, parameters),
    argsSchema: z.record(z.string(), z.unknown()),
    run: async () => ({
      ok: false,
      resultText: JSON.stringify({
        status: "unavailable",
        reason: `${name} is not built yet (lands in phase ${phase})`,
      }),
      data: { status: "unavailable", phase },
    }),
  };
}
