/**
 * Canonical runtime prompts, stored verbatim from rules 30/31.
 * Lands in phase 20 - see .devin/workflows/20-chat-core.md.
 */
export const PROMPT_SOURCES = ["system.base", "route.classifier"] as const;
export type PromptSource = (typeof PROMPT_SOURCES)[number];
