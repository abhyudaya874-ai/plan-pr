/**
 * Multi-provider LLM gateway (OpenRouter / Groq / NVIDIA NIM).
 * Lands in phase 10 - see .devin/workflows/10-model-gateway.md and rule 20.
 */
export type ProviderId = "openrouter" | "groq" | "nvidia";
export type Tier = "fast" | "balanced" | "strong";
export type RouteClass = "chat" | "research" | "reason" | "check";
