import { calcTool } from "./calc";
import { makeWebTools } from "./web";
import { makeFileTools } from "./files";
import { TavilyClient } from "./tavily";
import { unavailableTool, type Tool } from "./registry";

/**
 * Agent tools (rule 40). Tools whose phase has not landed are REAL tools that
 * return {status:"unavailable"} - never fake results.
 */
const jsonObj = (props: Record<string, unknown>, req: string[]) => ({
  type: "object",
  properties: props,
  required: req,
});

export function allTools(): Tool[] {
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const tavily = tavilyKey ? new TavilyClient(tavilyKey) : null;
  return [
    calcTool,
    ...makeWebTools({ tavily }),
    ...makeFileTools(),
    unavailableTool(
      "vault_lookup",
      "60",
      "Look up a verified fund field (NAV, TER, load, AUM, manager tenure, category, benchmark).",
      jsonObj(
        {
          amc: { type: "string" },
          scheme: { type: "string" },
          plan: { type: "string" },
          option: { type: "string" },
          field: { type: "string" },
        },
        ["amc", "scheme", "plan", "option", "field"],
      ),
    ),
  ];
}

export function toolMap(): Map<string, Tool> {
  return new Map(allTools().map((t) => [t.name, t]));
}

export type { Tool, ToolCtx, ToolExecution } from "./registry";
