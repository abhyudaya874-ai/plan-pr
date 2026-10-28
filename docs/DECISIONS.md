# Decisions log

## 2026-10-28 — Phase 00 bootstrap

- **Scaffold**: `create-next-app@16.4.3` (latest stable; `npm view` +
  `create-next-app --help` output consulted, flags: `--ts --tailwind --eslint
  --app --src-dir --import-alias "@/*" --use-pnpm --disable-git`). Directory
  name `iitP` violates npm naming, so the app was scaffolded as
  `planpr-scaffold` in /tmp and moved in.
- **Next.js 16.4.3** uses Turbopack with `@tailwindcss/turbopack` for CSS and
  enables `cacheComponents` by default; kept as shipped.
- **Deps pinned exact** per rule 70 (lockfile committed).
- **lucide-react held at 1.55.0** (published 2026-10-10): 1.62.0 was published
  <48h ago and tripped pnpm's `minimumReleaseAge` gate; using the older version
  rather than adding a release-age exclusion.
- **esbuild + better-sqlite3 in allowBuilds** (pnpm-workspace.yaml): native
  build script needed for sqlite; esbuild postinstall needed by tsx/vitest.
  sharp/unrs-resolver builds stay disabled.
- **`server-only`** guards `src/lib/env.ts` from client-bundle import (I6);
  vitest aliases it to an empty stub since tests run in plain node.
- **Env**: `.env` (gitignored, chmod 600) holds provided OpenRouter/Groq/NIM
  keys. `TAVILY_API_KEY` absent — search tools will return `unavailable` until
  provided (graceful degradation per rule 10).
- **Scripts not yet implemented** exit 1 with the phase they land in (honest
  stubs, no fake output) — protocol item 5.
- **next/font/google kept** for Geist; if `pnpm build` stalls on the font
  fetch (slow network), fall back to the system stack — spec allows
  "system/Geist/Inter stack" (rule 50).

## 2026-10-28 — Phase 10 model gateway (docs pass)

- **OpenRouter** — https://openrouter.ai/docs/api/reference/overview : base
  `https://openrouter.ai/api/v1`, `Authorization: Bearer`, optional
  `HTTP-Referer`/`X-OpenRouter-Title` app headers; OpenAI-normalised schema;
  SSE stream may include `:` comment lines (ignored by parser);
  `response_format` supports `json_schema`; `GET /models` returns rich fields
  (context_length, supported_parameters) used for capability hints.
- **Groq** — https://console.groq.com/docs/api-reference : base
  `https://api.groq.com/openai/v1/chat/completions`; SSE ends with
  `data: [DONE]`; `parallel_tool_calls`, `tool_choice` (incl. forced named
  tool), `response_format` `json_object`/`json_schema`;
  `max_completion_tokens` preferred over deprecated `max_tokens`; `GET
  /openai/v1/models` exists.
- **NVIDIA NIM** — https://docs.api.nvidia.com/nim/reference/llm-apis +
  https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html :
  base `https://integrate.api.nvidia.com/v1`, `POST /chat/completions`
  OpenAI-compatible with streaming + tool calling, `GET /v1/models`.
- **Client design**: one `OpenAICompatClient` per provider; `fetch` injected
  for fixture tests; SSE comments and keep-alives treated as stream activity
  (reset idle timer).
- **Probe results (2026-10-28)**: 13 verified of 28 candidates. Findings:
  reasoning models (qwen3, gpt-oss) spend `max_tokens` on `delta.reasoning`
  before content, so probes use generous ceilings and count reasoning toward
  reachability; NIM free key has most catalog functions unprovisioned
  (404 "not found for account") — provisioned models found by probing live:
  `diffusiongemma-26b-a4b-it`, `llama-3.2-11b-vision-instruct`,
  `minimax-m3.1-flash`; several NIM functions hang on cold start
  (idle_timeout is a real probe failure, not a client bug).
- **Failover semantics**: any pre-content error (incl. non-retryable like 401)
  fails over to the next candidate; `retryable` only means "don't retry the
  same model". Caller abort is the only terminal error.
- **`server-only` boundary**: `env.ts` keeps the guard; `providers.ts` reads
  `process.env` directly so tsx scripts can import it.
- **tsx scripts**: no top-level await (tsx emits CJS); `.env` loaded manually
  (tsx doesn't auto-load it like Next).

## 2026-10-28 — Phase 20 chat core

- **Defaults now seed router ordering** (`RouterDeps.defaults`): eval-measured
  quality goes first in auto modes; EWMA TTFT orders the rest. Manual mode
  still wins outright.
- **check default** = `openrouter:google/gemma-4-31b-it` (90% eval pass, json
  capable); provider-diversity vs the drafter is handled by router's
  `avoidProvider`, not the default itself.
- **Citation scrub moved into phase 20** (ahead of schedule): live test showed
  a model inventing `[1]` with zero tool calls. Invalid markers are stripped
  from persisted text and excluded from `done.sources`; raw streamed tokens
  may briefly show them — phase-50 UI renders chips only from `done.sources`.
- **json-action fallback**: when a model without native tools emits a lone
  `{"action","args"}` object it executes as a tool call; a one-line system
  addendum advertises it only when tools are in play.
- **Bridge reliability**: tiny models (~7B) sometimes omit the ↪ bridge —
  recorded in eval; no synthesized fallback (would put words in the model's
  mouth). Defaults were chosen partly on bridge reliability.

## 2026-10-28 — Phase 30 research (docs pass)

- **Tavily** — https://docs.tavily.com/documentation/api-reference/endpoint/search
  + .../endpoint/extract : `POST https://api.tavily.com/search` and
  `POST /extract`, auth `Authorization: Bearer <key>` (verified in
  @tavily/core dist source). Search args used: `query`, `search_depth`
  (basic|advanced), `max_results`, `time_range`; extract: `urls[]`,
  `format:"text"`. Own thin fetch client for SSRF control, not the SDK.
- **TAVILY_API_KEY absent**: `web_search`/`fetch_url` fall back to an honest
  "unavailable" (search) and a guarded direct-HTTPS fetch (fetch_url only) —
  never fake results.
- **Direct fetch guard**: https only, no IP-literal/private hosts, DNS resolve
  then re-check every address, redirects manually followed max 3 with the same
  checks per hop, 6k char cap, 10s timeout.
