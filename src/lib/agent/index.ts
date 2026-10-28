/**
 * Chat agent: intent routing, context builder, tool loop.
 * Lands in phase 20 - see .devin/workflows/20-chat-core.md.
 */
export type RouteDecision = {
  route: "chat" | "research" | "reason";
  needsTools: boolean;
  confidence: number;
};
