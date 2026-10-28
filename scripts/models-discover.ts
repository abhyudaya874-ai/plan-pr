/**
 * Discover live model IDs from each configured provider's GET /models and
 * write src/lib/llm/registry.seed.json (candidates only, verified:false).
 * Model IDs always come from the live API, never typed from memory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { OpenAICompatClient } from "../src/lib/llm/openai-compat";
import { PROVIDER_SPECS } from "../src/lib/llm/providers";
import type { ModelEntry, ProviderId, Registry, Tier } from "../src/lib/llm/types";

// Load .env (tsx does not auto-load it like Next does).
const envPath = path.join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}
void loadDotenv; // (env already applied above; kept explicit for clarity)

const PROVIDER_IDS: ProviderId[] = ["openrouter", "groq", "nvidia"];

/** Name-pattern tier guesses; the probe, not these guesses, decides the picker. */
const PATTERNS = {
  notChat:
    /embed|moderation|whisper|tts|image|dall|stable|flux|transcri|guard|safety|rerank|bge-|e5-|clip|audio|video|ocr|table|paint|segment|vision|fuyu|deplot|neva|kosmos|nvclip|reward|code-?|coder|starcoder|codestral|codellama|chatqa|translate|synthetic|ising|parse|omni|vl-|vlm|reward/i,
  fast: /(?:^|[-/:.])(1b|2b|3b|4b|7b|8b|9b|12b|14b|17b|20b|24b|27b|30b|mini|nano|lite|flash|instant|small|haiku|gemma(?:-|$)|mimo|scout|phi-3\.5|a800m)(?:[-/:.]|$)|8x7b|gpt-oss-20b/i,
  strong:
    /405b|frontier|opus|o1|o3|o4|gpt-5|ultra|pro(?:-|_|$)|deepseek.*(?:r1|v4-pro)|nemotron.*(?:ultra|super)|671b|kimi.*k2|glm-4\.6|qwen.*(?:max|235b)|grok-4|magnum|sonnet-4|nemotron-4/i,
  balanced: /70b|32b|33b|34b|51b|72b|90b|120b|180b|maverick|large|medium|sonnet|command|dbrx|jamba|mistral-large|yi-large|sea-lion/i,
};

function guessTier(id: string): Tier {
  if (PATTERNS.strong.test(id)) return "strong";
  if (PATTERNS.fast.test(id)) return "fast";
  if (PATTERNS.balanced.test(id)) return "balanced";
  return "balanced";
}

const PER_TIER: Record<ProviderId, Record<Tier, number>> = {
  openrouter: { fast: 3, balanced: 3, strong: 3 },
  groq: { fast: 3, balanced: 2, strong: 2 },
  nvidia: { fast: 4, balanced: 5, strong: 3 },
};

/** Providers like NIM host only *-instruct/chat* variants for chat. */
const PREFER_SUFFIX = /instruct|chat|-it$|it-| instruct$/i;
function preferScore(id: string): number {
  return (PREFER_SUFFIX.test(id) ? 0 : 10) + id.length / 100;
}

async function discoverProvider(provider: ProviderId): Promise<ModelEntry[]> {
  const spec = PROVIDER_SPECS[provider];
  const apiKey = process.env[spec.envKey];
  if (!apiKey) {
    console.log(`[discover] ${provider}: no API key, skipped`);
    return [];
  }
  const client = new OpenAICompatClient({
    provider,
    baseUrl: spec.baseUrl,
    apiKey,
    headers: spec.headers,
  });
  const listed = await client.listModels();
  const chat = listed.filter((m) => !PATTERNS.notChat.test(m.id));
  console.log(`[discover] ${provider}: ${listed.length} models listed, ${chat.length} look like chat`);

  const buckets: Record<Tier, typeof chat> = { fast: [], balanced: [], strong: [] };
  for (const m of chat) buckets[guessTier(m.id)].push(m);

  // Prefer instruct/chat-suffixed ids, then shorter ids (cheap proxy for
  // canonical names vs dated snapshot variants).
  const sortFn = (a: (typeof chat)[number], b: (typeof chat)[number]) =>
    preferScore(a.id) - preferScore(b.id);
  const out: ModelEntry[] = [];
  const seen = new Set<string>();
  const push = (m: (typeof chat)[number], tier: Tier) => {
    const key = `${provider}:${m.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      key,
      provider,
      modelId: m.id,
      label: m.id,
      tier,
      caps: {
        tools: m.supportsTools ?? true, // probe verifies
        json: m.supportsStructuredOutputs ?? true,
        vision: (m.modality ?? "").includes("image"),
        reasoning: false, // set true only when a probe proves reasoning stream
      },
      contextWindow: m.contextWindow,
      verified: false,
    });
  };
  for (const tier of ["fast", "balanced", "strong"] as const) {
    for (const m of buckets[tier].sort(sortFn).slice(0, PER_TIER[provider][tier])) {
      push(m, tier);
    }
  }
  // OpenRouter offers ":free" variants; include a couple so users see them.
  if (provider === "openrouter") {
    for (const m of chat.filter((x) => x.id.endsWith(":free")).sort(sortFn).slice(0, 2)) {
      push(m, guessTier(m.id.replace(/:free$/, "")));
    }
  }
  return out;
}

async function main() {
  const all: ModelEntry[] = [];
  for (const p of PROVIDER_IDS) {
    try {
      all.push(...(await discoverProvider(p)));
    } catch (e) {
      console.error(`[discover] ${providerUpper(p)} failed:`, e);
    }
  }
  const reg: Registry = { generatedAt: new Date().toISOString(), models: all };
  const outPath = path.join(process.cwd(), "src/lib/llm/registry.seed.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(reg, null, 2) + "\n");
  console.log(`\n[discover] wrote ${all.length} candidates -> ${outPath}`);
  for (const m of all) console.log(`  ${m.tier.padEnd(8)} ${m.key}`);
}

function providerUpper(p: ProviderId): string {
  return p.toUpperCase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
