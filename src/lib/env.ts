import "server-only";
import { z } from "zod";

/**
 * Server-side environment. All API keys stay server-side only (invariant I6).
 * At least one LLM provider key is required for chat; every feature that needs
 * a missing key degrades to an explicit "unavailable" path, never a fake.
 */
/** Empty / whitespace-only env values count as "not set". */
const key = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  OPENROUTER_API_KEY: key,
  GROQ_API_KEY: key,
  NVIDIA_API_KEY: key,
  TAVILY_API_KEY: key,
});

export type LlmProviderId = "openrouter" | "groq" | "nvidia";

export interface ProviderFlags {
  openrouter: boolean;
  groq: boolean;
  nvidia: boolean;
  tavily: boolean;
}

export interface Env {
  /** Raw key material. Never serialise this object into a response. */
  keys: Record<LlmProviderId | "tavily", string | undefined>;
  /** Presence flags safe to expose (e.g. /api/health). */
  providers: ProviderFlags;
  /** True when no LLM provider is configured; chat is then unavailable. */
  llmMissing: boolean;
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  const e = parsed.data;
  const keys = {
    openrouter: e.OPENROUTER_API_KEY,
    groq: e.GROQ_API_KEY,
    nvidia: e.NVIDIA_API_KEY,
    tavily: e.TAVILY_API_KEY,
  } as const;
  const providers: ProviderFlags = {
    openrouter: keys.openrouter !== undefined,
    groq: keys.groq !== undefined,
    nvidia: keys.nvidia !== undefined,
    tavily: keys.tavily !== undefined,
  };
  return {
    keys,
    providers,
    llmMissing: !providers.openrouter && !providers.groq && !providers.nvidia,
  };
}

/** Memoised env for server code paths. */
let cached: Env | undefined;
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

export function llmKey(provider: LlmProviderId): string | undefined {
  return env().keys[provider];
}
