/**
 * End-to-end router smoke: sends a message through ModelRouter with real
 * providers and prints every event. Usage:
 *   tsx scripts/chat-smoke.ts ["message"] [--route chat|research|reason|check]
 *   [--mode auto-fast|auto-quality|manual:<key>]
 * Kill a provider key (e.g. GROQ_API_KEY=bad) to watch failover work.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ModelRouter } from "../src/lib/llm/router";
import { makeClient } from "../src/lib/llm/providers";
import { verifiedModels } from "../src/lib/llm/registry";
import type { RouteClass, RouteMode } from "../src/lib/llm/types";

const envPath = path.join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

const argv = process.argv.slice(2).filter((a) => a !== "--");
const positional = argv.filter((a) => !a.startsWith("--"));
const get = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};

const message = positional[0] ?? "say hi";
const route = (get("--route") ?? "chat") as RouteClass;
const mode = (get("--mode") ?? "auto-fast") as RouteMode;

const models = verifiedModels({ fresh: true });
console.log(`[smoke] ${models.length} verified models; route=${route} mode=${mode}`);

const router = new ModelRouter({
  models,
  clientFor: (m) => makeClient(m.provider),
});

async function main() {
  const started = Date.now();
  let text = "";
  for await (const ev of router.chat(
    {
      messages: [{ role: "user", content: message }],
      maxTokens: 512,
      temperature: 0.2,
    },
    route,
    mode,
  )) {
    if (ev.type === "text") {
      text += ev.text;
      process.stdout.write(ev.text);
    } else if (ev.type === "reasoning") {
      // collapsed - not displayed
    } else if (ev.type === "telemetry") {
      console.log(
        `\n[smoke] telemetry ${JSON.stringify(ev.telemetry)} wall=${Date.now() - started}ms`,
      );
    } else {
      console.log(`\n[smoke] event ${JSON.stringify(ev)}`);
    }
  }
  console.log(
    `\n[smoke] answer (${text.length} chars): ${JSON.stringify(text.slice(0, 200))}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
