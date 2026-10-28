/**
 * Live model probe (rule 20). For every candidate in registry.seed.json:
 *   1. "Reply with OK" x3 -> median TTFT + total
 *   2. forced tool call -> args zod-validated
 *   3. JSON-mode reply -> parses
 *   4. two typo'd prompts still understood
 * Writes src/lib/llm/registry.live.json + workspace/_system/model-bench.csv.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OpenAICompatClient } from "../src/lib/llm/openai-compat";
import { PROVIDER_SPECS } from "../src/lib/llm/providers";
import {
  registrySchema,
  type ChatRequest,
  type ModelEntry,
  type ProviderId,
  type Registry,
  type StreamEvent,
  type ToolDef,
} from "../src/lib/llm/types";

const envPath = path.join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

const SEED = path.join(process.cwd(), "src/lib/llm/registry.seed.json");
const LIVE = path.join(process.cwd(), "src/lib/llm/registry.live.json");
const BENCH = path.join(process.cwd(), "workspace/_system/model-bench.csv");
const STEP_TIMEOUT_MS = 45_000;

const DUMMY_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Get the current time for a named city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};
const toolArgsSchema = z.object({ city: z.string().min(1) });

interface Collected {
  text: string;
  reasoning: string;
  toolCalls: { id: string; name: string; argsJson: string }[];
  sawDone: boolean;
  ttftMs: number;
  totalMs: number;
  error: string | null;
}

async function collect(
  client: OpenAICompatClient,
  req: Omit<ChatRequest, "modelId"> & { modelId: string },
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<Collected> {
  const started = Date.now();
  const out: Collected = {
    text: "",
    reasoning: "",
    toolCalls: [],
    sawDone: false,
    ttftMs: -1,
    totalMs: -1,
    error: null,
  };
  const signal = AbortSignal.timeout(timeoutMs);
  for await (const ev of client.chatStream(req, signal)) {
    if (
      out.ttftMs < 0 &&
      (ev.type === "text" || ev.type === "reasoning" || ev.type === "tool_call")
    ) {
      out.ttftMs = Date.now() - started;
    }
    if (ev.type === "text") out.text += ev.text;
    if (ev.type === "reasoning") out.reasoning += ev.text;
    if (ev.type === "tool_call") out.toolCalls.push(ev.call);
    if (ev.type === "error") out.error = `${ev.error.kind}: ${ev.error.message}`;
    if (ev.type === "done") {
      out.sawDone = true;
      out.totalMs = Date.now() - started;
    }
  }
  if (out.totalMs < 0) out.totalMs = Date.now() - started;
  return out;
}

const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : -1;

async function probeModel(
  client: OpenAICompatClient,
  entry: ModelEntry,
): Promise<ModelEntry> {
  const ttfts: number[] = [];
  const totals: number[] = [];
  let reachable = false;
  let lastErr = "";

  for (let i = 0; i < 3; i++) {
    const r = await collect(client, {
      modelId: entry.modelId,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      // Generous ceiling: reasoning models spend tokens thinking first.
      maxTokens: 96,
      temperature: 0,
    });
    if (!r.error && (r.text.trim().length > 0 || r.reasoning.length > 0 || r.sawDone)) {
      reachable = true;
      if (r.ttftMs >= 0) ttfts.push(r.ttftMs);
      totals.push(r.totalMs);
    } else lastErr = r.error ?? "empty";
  }

  // Tool call probe (only if reachable - don't waste calls on dead models).
  let toolCallOk = false;
  if (reachable) {
    const r = await collect(client, {
      modelId: entry.modelId,
      messages: [
        { role: "user", content: "What time is it in Mumbai? Use the tool." },
      ],
      tools: [DUMMY_TOOL],
      toolChoice: { type: "function", function: { name: "get_current_time" } },
      maxTokens: 384,
      temperature: 0,
    });
    const call = r.toolCalls.find((c) => c.name === "get_current_time");
    if (call) {
      try {
        toolCallOk = toolArgsSchema.safeParse(JSON.parse(call.argsJson)).success;
      } catch {
        toolCallOk = false;
      }
    }
  }

  // JSON-mode probe.
  let jsonOk = false;
  if (reachable) {
    const r = await collect(client, {
      modelId: entry.modelId,
      messages: [
        {
          role: "user",
          content: 'Reply with JSON only: {"ok": true, "n": 4}',
        },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 384,
      temperature: 0,
    });
    if (!r.error) {
      try {
        const parsed: unknown = JSON.parse(r.text);
        jsonOk =
          typeof parsed === "object" && parsed !== null && "ok" in parsed;
      } catch {
        jsonOk = false;
      }
    }
  }

  // Typo robustness: two typo'd prompts must still be understood.
  let typosOk = false;
  if (reachable) {
    const a = await collect(client, {
      modelId: entry.modelId,
      messages: [{ role: "user", content: "whts 2+2" }],
      maxTokens: 512,
      temperature: 0,
    });
    const b = await collect(client, {
      modelId: entry.modelId,
      messages: [
        { role: "user", content: "mutal fnd direct vs regulr diff kya hai" },
      ],
      maxTokens: 512,
      temperature: 0,
    });
    typosOk =
      !a.error && /\b4\b/.test(a.text) && !b.error && b.text.trim().length > 10;
  }

  const probed: ModelEntry = {
    ...entry,
    caps: {
      ...entry.caps,
      tools: toolCallOk,
      json: jsonOk,
    },
    verified: reachable && typosOk,
    probe: {
      ttftMs: median(ttfts),
      totalMs: median(totals),
      toolCallOk,
      jsonOk,
      at: new Date().toISOString(),
    },
  };
  const p = probed.probe!;
  console.log(
    `  ${probed.verified ? "OK " : "FAIL"} ${entry.key} ttft=${p.ttftMs}ms total=${p.totalMs}ms tools=${toolCallOk} json=${jsonOk} typos=${typosOk}${reachable ? "" : ` err=${lastErr}`}`,
  );
  return probed;
}

async function main() {
  const seedParsed = registrySchema.safeParse(
    JSON.parse(readFileSync(SEED, "utf8")),
  );
  if (!seedParsed.success) {
    console.error("registry.seed.json missing/invalid - run models:discover first");
    process.exit(1);
  }
  const clients = new Map<ProviderId, OpenAICompatClient>();
  for (const p of ["openrouter", "groq", "nvidia"] as const) {
    const spec = PROVIDER_SPECS[p];
    const key = process.env[spec.envKey];
    if (key) {
      clients.set(
        p,
        new OpenAICompatClient({
          provider: p,
          baseUrl: spec.baseUrl,
          apiKey: key,
          headers: spec.headers,
        }),
      );
    }
  }

  // Optional `--only <substr>` filters seed keys; previous live results for
  // unprobed keys are preserved in the merged registry.live.json.
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
  const candidates = only
    ? seedParsed.data.models.filter((m) => m.key.includes(only!))
    : seedParsed.data.models;
  if (only) console.log(`[probe] --only "${only}": ${candidates.length} candidates`);

  const prevLive = (() => {
    try {
      const p = registrySchema.safeParse(
        JSON.parse(readFileSync(LIVE, "utf8")),
      );
      return p.success ? p.data.models : [];
    } catch {
      return [];
    }
  })();

  const results: ModelEntry[] = [];
  const benchRows = ["key,provider,tier,verified,ttft_ms,total_ms,tools,json,typos,at"];
  for (const entry of candidates) {
    const client = clients.get(entry.provider);
    if (!client) {
      console.log(`  SKIP ${entry.key} (no key)`);
      continue;
    }
    let probed: ModelEntry;
    try {
      probed = await probeModel(client, entry);
    } catch (e) {
      probed = { ...entry, verified: false };
      console.log(`  FAIL ${entry.key} exception: ${String(e)}`);
    }
    results.push(probed);
    benchRows.push(
      [
        probed.key,
        probed.provider,
        probed.tier,
        probed.verified,
        probed.probe?.ttftMs ?? "",
        probed.probe?.totalMs ?? "",
        probed.probe?.toolCallOk ?? "",
        probed.probe?.jsonOk ?? "",
        "",
        "",
        probed.probe?.at ?? new Date().toISOString(),
      ].join(","),
    );
  }

  const probedKeys = new Set(results.map((m) => m.key));
  const merged = [...prevLive.filter((m) => !probedKeys.has(m.key)), ...results];
  const live: Registry = { generatedAt: new Date().toISOString(), models: merged };
  writeFileSync(LIVE, JSON.stringify(live, null, 2) + "\n");
  mkdirSync(path.dirname(BENCH), { recursive: true });
  writeFileSync(BENCH, benchRows.join("\n") + "\n");

  const ok = merged.filter((m) => m.verified);
  console.log(
    `\n[probe] ${ok.length}/${results.length} verified -> ${LIVE}\n[probe] bench -> ${BENCH}`,
  );
  for (const p of ["openrouter", "groq", "nvidia"] as const) {
    const n = ok.filter((m) => m.provider === p).length;
    if (clients.has(p) && n === 0)
      console.log(`[probe] WARNING: ${p} had a key but 0 models verified`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
