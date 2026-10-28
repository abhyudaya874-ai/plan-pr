---
trigger: glob
globs: src/lib/llm/**,scripts/models-probe.ts,src/app/api/models/**
description: Multi-provider model gateway, registry, latency router, tool-call robustness.
---
# Model gateway

## Providers (all OpenAI-compatible chat completions with `tools` + streaming)
- OpenRouter  base `https://openrouter.ai/api/v1`
- Groq        base `https://api.groq.com/openai/v1`
- NVIDIA NIM  base `https://integrate.api.nvidia.com/v1`
Verify base URLs, auth headers, `/models` endpoints, tool-call and stream formats in current docs BEFORE coding. One client class `OpenAICompatClient` parameterised by provider config.

## Registry (never trust model IDs from memory)
- `src/lib/llm/registry.seed.json`: CANDIDATES only (`verified:false`). Discover live IDs from each provider's `/models` and fill the seed from that, not from memory.
- `pnpm models:probe` tests every candidate and writes `registry.live.json`. Entry (zod):
  `{ key, provider, modelId, label, tier: fast|balanced|strong, caps:{tools,json,vision,reasoning}, contextWindow, verified, probe:{ttftMs,totalMs,toolCallOk,jsonOk,at}, cooldownUntil? }`
- Probe per model: (1) "Reply with OK" -> TTFT + total; (2) forced tool call to a dummy tool, args zod-validated; (3) JSON-schema reply; (4) 2 typo'd prompts must still be understood. Repeat latency 3x, store median.
- Only `verified` models show in the picker (with badges: provider, median TTFT, tools check). Failed ones are hidden or flagged "experimental".
- Seed with a wide spread so users get real choice: fast open models on Groq, Llama/Nemotron-class on NIM, frontier + strong open models on OpenRouter (incl. `:free` variants where available).

## Router
Modes: `auto-fast` (default), `auto-quality`, `manual:<key>`.
Route classes and capability filters:
- `chat` (smalltalk, simple Q): any verified model; pick LOWEST rolling TTFT (EWMA over real traffic + probe).
- `research` (needs tools): `caps.tools && toolCallOk`; lowest TTFT among those; prefer `balanced+`.
- `reason` (plans, explanations, drafting): tier >= balanced; `auto-quality` prefers strong.
- `check` (citation/injection checkers, structured): `caps.json`, temperature 0, different provider than the drafter when possible.
Tie-break: provider diversity. Manual mode always wins, but still fails over if the model errors (and tells the user).

## Hedging + failover (this is what makes it feel instant)
- `chat` route: if no first token within `HEDGE_MS` (default 900), start the next-best model on a DIFFERENT provider. First token wins, abort the loser. Cap hedges per minute.
- 429 / 5xx / timeout / empty stream: set `cooldownUntil` (exponential backoff), switch to next candidate, retry up to 3, emit a `step` event `{kind:"model_switch"}`. Never show raw provider errors to the user.
- Streaming idle timeout 15s. Per-route max tokens.

## Tool-call robustness (models must do REAL tool calls)
- Validate every tool call's args with zod. Invalid -> ONE repair retry with the validation error appended as a tool message. Still invalid -> demote that model's `caps.tools` for 10 min and fail over.
- Support parallel tool calls and assemble streamed tool-call deltas by index.
- Models without native tools: `json-action` fallback (strict JSON `{action,args}` loop) behind the same interface.
- Max 6 tool rounds per turn. Per-tool timeout. Tool errors go back to the model as data, not exceptions.
- Do not display raw chain-of-thought. If a provider returns reasoning, show only a collapsed "Thinking" label.

## Telemetry
Per request: `{route, provider, model, ttftMs, totalMs, tokensIn, tokensOut, retries, hedged}`. Emit as event, append to `workspace/<session>/telemetry.csv`, feed the EWMA. `GET /api/models` returns verified list + live latency for the picker.
