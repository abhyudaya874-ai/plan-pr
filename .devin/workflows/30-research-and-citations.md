---
description: Phase 30 (1.5h). Tavily search/fetch, source registry, citation post-processing, traced URLs.
---
# /30-research-and-citations
Rules in force: 40-tools-and-workspace (source registry, SSRF, citation post-processing).
1. Read current Tavily docs (search + extract params, response shape, limits). Log URL.
2. `SearchProvider` interface + `TavilyProvider`. Map results -> Source objects. Depth: basic by default, advanced for `research` mode.
3. `web_search` and `fetch_url` tools (replace the stubs): SSRF guard, caps, timeouts, SQLite cache keyed (query, date), sanitisation, injection regex pre-screen, `<tool_result untrusted>` wrapping.
4. Source registry per thread; emit `source` events as soon as search returns (before the answer streams).
5. Citation post-processor: drop invalid `[n]`, verify quotes, compute final cited list; log defects.
6. Emit `step` events with the actual query and the actual URL being read (this is the "traced" view).
7. Auto-write `sources.csv` and append `trace.txt` per turn (use the workspace API once /40 exists; until then buffer and flush in /40).
8. Tests: fixtures for search/extract; SSRF cases (127.0.0.1, 10.x, 169.254.x, DNS rebinding, redirect to private); a poisoned page with "ignore previous instructions" must not alter behaviour.
## Verify (live)
3 research queries (e.g. a current SEBI circular, a fee rule, a news item). Assert: every URL in `source` events appears in a tool result; every `[n]` in the answer maps to a registered source; zero invented URLs; answer cites primary sources when available.
## Commit
`feat(research): tavily tools, source registry, citations`. Next: /40-workbench-files
