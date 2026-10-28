import { evaluate } from "mathjs";
import { z } from "zod";
import { fn, type Tool } from "./registry";

const argsSchema = z.object({
  expression: z.string().min(1).max(500),
});

/**
 * mathjs evaluate is a sandboxed expression evaluator: no fs/network access,
 * no imports. That satisfies the rule-40 "scope-limited" contract.
 */
export const calcTool: Tool = {
  name: "calc",
  def: fn(
    "calc",
    "Evaluate a math/finance expression (arithmetic, powers, percentages, SIP/corpus formulas).",
    {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "mathjs expression, e.g. '10000 * (1.12)^10'",
        },
      },
      required: ["expression"],
    },
  ),
  argsSchema,
  run: async (args) => {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, resultText: `invalid args: ${parsed.error.message}` };
    }
    try {
      const value: unknown = evaluate(parsed.data.expression);
      if (typeof value === "function" || value === undefined) {
        return { ok: false, resultText: "expression produced no numeric value" };
      }
      return { ok: true, resultText: String(value) };
    } catch (e) {
      return {
        ok: false,
        resultText: `calc error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
