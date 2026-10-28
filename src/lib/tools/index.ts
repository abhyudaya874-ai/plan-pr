import { calcTool } from "./calc";
import { makeWebTools } from "./web";
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
    unavailableTool("list_files", "40", "List files in the workspace.", jsonObj({}, [])),
    unavailableTool(
      "read_file",
      "40",
      "Read a workspace file.",
      jsonObj({ path: { type: "string" } }, ["path"]),
    ),
    unavailableTool(
      "write_file",
      "40",
      "Write content to a workspace file.",
      jsonObj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
    ),
    unavailableTool(
      "append_file",
      "40",
      "Append to a workspace file.",
      jsonObj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
    ),
    unavailableTool(
      "delete_file",
      "40",
      "Delete a workspace file.",
      jsonObj({ path: { type: "string" } }, ["path"]),
    ),
    unavailableTool(
      "export_csv",
      "40",
      "Export rows to a CSV file in the workspace.",
      jsonObj(
        { path: { type: "string" }, rows: { type: "string" } },
        ["path", "rows"],
      ),
    ),
    unavailableTool(
      "export_zip",
      "40",
      "Bundle selected workspace files into a zip.",
      jsonObj({ paths: { type: "string" } }, ["paths"]),
    ),
  ];
}

export function toolMap(): Map<string, Tool> {
  return new Map(allTools().map((t) => [t.name, t]));
}

export type { Tool, ToolCtx, ToolExecution } from "./registry";
