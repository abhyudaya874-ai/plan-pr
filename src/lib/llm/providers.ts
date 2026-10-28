import { OpenAICompatClient, type ProviderConfig } from "./openai-compat";
import type { ProviderId } from "./types";

interface ProviderSpec {
  baseUrl: string;
  envKey: "OPENROUTER_API_KEY" | "GROQ_API_KEY" | "NVIDIA_API_KEY";
  headers?: Record<string, string>;
}

export const PROVIDER_SPECS: Record<ProviderId, ProviderSpec> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    headers: {
      "HTTP-Referer": "https://localhost",
      "X-OpenRouter-Title": "Plan PR",
    },
  },
  groq: { baseUrl: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY" },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKey: "NVIDIA_API_KEY",
  },
};

/**
 * Key-presence check via process.env directly (not env.ts) so this module is
 * importable from tsx scripts as well as server routes.
 */
export function providerAvailable(id: ProviderId): boolean {
  return Boolean(process.env[PROVIDER_SPECS[id].envKey]?.trim());
}

export function providerKey(id: ProviderId): string | undefined {
  const spec = PROVIDER_SPECS[id];
  return process.env[spec.envKey];
}

export function makeClient(
  id: ProviderId,
  opts?: ConstructorParameters<typeof OpenAICompatClient>[1],
): OpenAICompatClient | null {
  const spec = PROVIDER_SPECS[id];
  const apiKey = providerKey(id);
  if (!apiKey) return null;
  const cfg: ProviderConfig = {
    provider: id,
    baseUrl: spec.baseUrl,
    apiKey,
    headers: spec.headers,
  };
  return new OpenAICompatClient(cfg, opts);
}
