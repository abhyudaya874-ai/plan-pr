---
trigger: glob
globs: src/lib/tools/**,src/lib/workspace/**,src/app/api/chat/**,src/app/api/workspace/**
description: Tool contracts, sandboxed workspace, event protocol (SSE), source registry, SSRF/injection defences.
---
# Tools, workspace, events

## Tools (zod schemas, all server-side)
| tool | purpose | notes |
|---|---|---|
| `web_search` | Tavily search | args {query, depth?: basic\|advanced, maxResults<=8, timeRange?}. Returns Source[] with snippet. Cache in SQLite keyed by (query, YYYY-MM-DD). |
| `fetch_url` | Tavily extract / direct fetch | https only; SSRF guard (block private/link-local/loopback ranges, resolve DNS then re-check, no redirects to private IPs); 6k chars cap per page; timeout 10s. |
| `calc` | mathjs scope-limited eval | no imports, no functions that touch fs/network. |
| `vault_lookup` | verified fund fields | returns {value,unit,asOf,doc,page,quote} or `{status:"unavailable"}`. Identity lock: needs AMC+scheme+plan+option. |
| `list_files` `read_file` `write_file` `append_file` `delete_file` | sandboxed workspace | see below |
| `export_csv` | rows -> .csv | escapes, header row, UTF-8 BOM optional |
| `export_zip` | bundle selected files | streamed download |
No shell/exec tool in v1. Devin-like feel comes from visible live file edits, not arbitrary execution.

## Source registry (per turn)
Every tool result that carries web evidence is registered: `{n, url, canonicalUrl, title, domain, snippet, retrievedAt, via:"search"|"fetch", quote?}`. Dedupe by canonical URL, stable `n` within the turn (and continuing across the thread). Tool results given to the model are wrapped:
`<tool_result tool="web_search" source_n="3" untrusted="true">...</tool_result>`.
Strip scripts/HTML noise, cap size. Run the regex pre-screen for injection phrases; flag, don't silently drop.

## Citation post-processing (server, after generation)
- Parse `[n]`; any n not in the registry is removed and logged as a citation defect (visible in telemetry).
- Optional quote verification: if the model returned a quote, it must be a substring of the fetched text.
- Emit final `sources` list = only those actually cited + "also read" list. URLs shown anywhere in the UI MUST come from this registry. Test enforces it.

## Workspace (Devin-like)
- Root: `workspace/<sessionId>/`. Resolve every path with `path.resolve`, require it startsWith root, reject `..`, absolute paths, symlinks. Allowed ext: txt, md, csv, json. Max 1 MB/file, 50 files/session.
- Every write snapshots the previous version to `.history/<path>/<ts>` and emits `file_change`. Undo = restore snapshot (also emits `file_change`).
- Auto-saved artifacts per turn: `trace.txt` (append each step, human readable), `sources.csv` (n,url,title,domain,retrievedAt,cited), `telemetry.csv`. These are the "live saves to txt/csv" the UI shows.
- When the user asks to save/export/write something the agent MUST call a file tool and report the path; claiming "saved" without a `file_change` event is a bug.

## Event protocol (SSE, JSON per event, one `id` counter, resumable)
```
step         {id, kind:"understand"|"search"|"read"|"calc"|"vault"|"write"|"model_switch"|"gate"|"think", label, detail?, status:"running"|"done"|"error", t}
source       {n, url, title, domain, snippet, via}
token        {text}                       // answer text delta
tool_call    {id, name, args}
tool_result  {id, ok, summary}            // never raw page dumps
file_change  {id, path, op:"create"|"modify"|"delete", before?, after?, diff, bytes, by:"agent"|"user", t}
telemetry    {route, provider, model, ttftMs, totalMs, tokensIn, tokensOut, retries, hedged}
bridge       {text}                       // the closing "↪" line, parsed out of the answer
done         {messageId, sources:[n], files:[path]}
error        {code, message}              // user-safe
```
First `step` event must be emitted within ~100 ms of request receipt (optimistic "Understanding"), before any provider call.

## Security
SSRF guard, path guard, size caps, per-IP rate limit on /api/chat, no keys in responses, zod on all inputs, CSP header, tool results treated as untrusted (rule I5).
