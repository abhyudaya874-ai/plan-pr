---
description: Phase 10 (2h). Multi-provider gateway, live model probe, latency router with hedging and failover.
---
# /10-model-gateway
Rules in force: 20-model-gateway, 05, 70.
1. Docs pass (log URLs in DECISIONS.md): for OpenRouter, Groq, NVIDIA NIM confirm base URL, auth header, `GET /models`, chat-completions body, streaming chunk shape, tool-call delta shape, error/429 shapes, rate-limit headers.
2. `src/lib/llm/types.ts`: Provider, ModelEntry, ChatRequest, StreamEvent (text delta, tool_call, usage, done, error), zod schemas.
3. `openai-compat.ts`: fetch + SSE parser; tool-call delta assembly by index; abort signal; idle timeout; usage capture; normalised errors.
4. `providers.ts`: three provider configs, key presence from env.
5. `scripts/models-discover.ts`: call each provider's `/models`, print candidates, write `registry.seed.json` (verified:false). Choose a wide, sensible spread: fast, balanced, strong; include free variants where offered. Never hand-type model IDs from memory.
6. `scripts/models-probe.ts` (rule 20 probe): 3x latency median, forced tool call, JSON mode, 2 typo prompts. Write `registry.live.json` and `workspace/_system/model-bench.csv`.
7. `registry.ts` (load live, expose verified, cooldown map) and `router.ts` (route classes, EWMA TTFT, tie-break, manual mode, hedging, failover, tool-call repair + demotion, json-action fallback).
8. `GET /api/models` -> verified list with live latency, tier, caps.
9. Tests with recorded SSE fixtures: stream parsing, tool-call assembly, failover on 429, hedge winner, router picks lowest TTFT among capable.
## Verify
`pnpm models:probe` with real keys: >=1 verified model per provider that has a key. Print the bench table. `curl /api/models`. Kill a provider key to prove failover still answers "say hi".
## Commit
`feat(llm): multi-provider gateway, probe, router`. Next: /20-chat-core
