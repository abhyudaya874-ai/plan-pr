import { calcTool } from "./calc";
import { makeWebTools } from "./web";
import { makeFileTools } from "./files";
import { vaultTool } from "./vault";
import { TavilyClient } from "./tavily";
import type { Tool } from "./registry";

export function allTools(): Tool[] {
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const tavily = tavilyKey ? new TavilyClient(tavilyKey) : null;
  return [
    calcTool,
    ...makeWebTools({ tavily }),
    ...makeFileTools(),
    vaultTool(),
  ];
}

export function toolMap(): Map<string, Tool> {
  return new Map(allTools().map((t) => [t.name, t]));
}

export type { Tool, ToolCtx, ToolExecution } from "./registry";
