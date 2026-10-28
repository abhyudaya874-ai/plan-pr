import { z } from "zod";

export type ProviderId = "openrouter" | "groq" | "nvidia";
export type Tier = "fast" | "balanced" | "strong";
export type RouteClass = "chat" | "research" | "reason" | "check";

export const toolDefSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ToolDef = z.infer<typeof toolDefSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatRequest {
  modelId: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
  temperature?: number;
  maxTokens?: number;
  responseFormat?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict?: boolean; schema: object } };
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type LlmErrorKind =
  | "rate_limit"
  | "http"
  | "network"
  | "timeout"
  | "idle_timeout"
  | "aborted"
  | "empty_stream"
  | "bad_response";

export interface LlmError {
  kind: LlmErrorKind;
  message: string;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface CompletedToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as streamed by the model. Validate before use. */
  argsJson: string;
}

/** Events yielded by OpenAICompatClient.chatStream. */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: CompletedToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; error: LlmError };

/** Meta events emitted by the router (never by the raw client). */
export type RouterEvent =
  | { type: "model_switch"; from: string; to: string; reason: string }
  | { type: "hedged"; winner: string; loser: string };

export const modelEntrySchema = z.object({
  key: z.string(),
  provider: z.enum(["openrouter", "groq", "nvidia"]),
  modelId: z.string(),
  label: z.string(),
  tier: z.enum(["fast", "balanced", "strong"]),
  caps: z.object({
    tools: z.boolean(),
    json: z.boolean(),
    vision: z.boolean(),
    reasoning: z.boolean(),
  }),
  contextWindow: z.number().int().positive().nullable(),
  verified: z.boolean(),
  probe: z
    .object({
      ttftMs: z.number(),
      totalMs: z.number(),
      toolCallOk: z.boolean(),
      jsonOk: z.boolean(),
      at: z.string(),
    })
    .optional(),
  cooldownUntil: z.number().optional(),
});
export type ModelEntry = z.infer<typeof modelEntrySchema>;

export const registrySchema = z.object({
  generatedAt: z.string(),
  models: z.array(modelEntrySchema),
  defaults: z
    .object({
      chat: z.string().optional(),
      research: z.string().optional(),
      reason: z.string().optional(),
      check: z.string().optional(),
    })
    .optional(),
});
export type Registry = z.infer<typeof registrySchema>;

export type RouteMode = "auto-fast" | "auto-quality" | `manual:${string}`;

export interface Telemetry {
  route: RouteClass;
  provider: ProviderId;
  model: string;
  ttftMs: number;
  totalMs: number;
  tokensIn: number;
  tokensOut: number;
  retries: number;
  hedged: boolean;
}
