import { calcTool } from "./calc";
import { makeWebTools } from "./web";
import { makeFileTools } from "./files";
import { vaultTool, vaultUniverseTool } from "./vault";
import { TavilyClient } from "./tavily";
import { ExaClient } from "./exa";
import type { Tool } from "./registry";

export function allTools(): Tool[] {
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const exaKey = process.env.EXA_API_KEY?.trim();
  const tavily = tavilyKey ? new TavilyClient(tavilyKey) : null;
  const exa = exaKey ? new ExaClient(exaKey) : null;
  return [
    calcTool,
    ...makeWebTools({ tavily, exa }),
    ...makeFileTools(),
    vaultTool(),
    vaultUniverseTool(),
  ];
}

export function toolMap(): Map<string, Tool> {
  return new Map(allTools().map((t) => [t.name, t]));
}

export type { Tool, ToolCtx, ToolExecution } from "./registry";
