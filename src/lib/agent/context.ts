import type { SessionContext } from "@/lib/prompts/system";
import type { ChatRoute, LanguageHint } from "./intent";

export interface ContextInput {
  route: ChatRoute;
  languageHint: LanguageHint;
  caseLabel?: string;
  gates?: { red: number; amber: number; green: number };
  workspaceFiles?: string[];
  previousBridgeAngle?: string;
  now?: Date;
}

/** ISO date in Asia/Kolkata, e.g. "2026-10-28". */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function buildSessionContext(input: ContextInput): SessionContext {
  return {
    date: istDate(input.now),
    timezone: "Asia/Kolkata",
    route: input.route,
    languageHint: input.languageHint,
    caseLabel: input.caseLabel ?? "none",
    gatesRed: input.gates?.red ?? 0,
    gatesAmber: input.gates?.amber ?? 0,
    gatesGreen: input.gates?.green ?? 0,
    workspaceFiles: input.workspaceFiles ?? [],
    previousBridgeAngle: input.previousBridgeAngle ?? "none",
  };
}
