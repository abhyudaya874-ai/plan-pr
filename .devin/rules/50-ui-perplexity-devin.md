---
trigger: glob
globs: src/app/**,src/components/**
description: UI spec: Perplexity-style answer view + Devin-style live workbench. The base of the app.
---
# UI spec (the base of the app)

Feel: Perplexity answer clarity + Devin workbench transparency. Dark-first minimal: neutral zinc palette, ONE accent, 8px grid, system/Geist/Inter stack, motion <=150ms, no decorative gradients. Light theme supported via CSS variables.

## Layout (desktop)
Left rail (threads/cases, collapsible) | Center answer column (max ~720px) | Right Workbench panel (resizable, collapsible).
Mobile: single column; Workbench = bottom sheet; model picker = sheet.

## Center: answer view (per message)
1. Query title (user text as typed, typos untouched).
2. **Steps timeline** (collapsible, open while running): ticking rows "Understanding" -> "Searching: <query>" -> "Reading: <domain/path>" -> "Calculating" -> "Writing <file>". Each row: spinner/check, label, duration. This is the "URLs it traced" view; rows with URLs are clickable.
3. **Sources row**: horizontally scrollable cards BEFORE the answer finishes streaming: number badge, letter-avatar (no third-party favicon calls), domain, title (2 lines), hover shows url + snippet. Click opens in new tab (rel=noopener).
4. **Answer**: streamed markdown. `[n]` rendered as small citation chips; hover/focus popover = title, full URL, snippet, retrieved date. Chips keyboard accessible. Invalid n never rendered.
5. **Bridge line** (the "↪ ..." closer) rendered as a subtle chip below the answer, clickable: clicking sends it as the next user message.
6. Footer: latency chip (model, TTFT, total), copy, regenerate, "Used N sources", follow-up suggestions (max 3, generated cheaply or from bridge).

## Composer
Multiline, Enter send / Shift+Enter newline, paste/drag file to workspace. Left of send: **model picker** (Auto-fast default | Auto-quality | list of verified models grouped by provider, each with TTFT, tools badge, tier). Mode toggle: Chat | Research (forces search) . Stop button while streaming (aborts server side too).

## Right: Workbench (Devin-like)
Tabs: **Files** | **Changes** | **Trace** | **Telemetry**.
- Files: live tree of `workspace/<session>`; new/modified files flash for 600 ms; click opens viewer (txt/md/csv as table/json). Download file / Download all (zip).
- Changes: chronological `file_change` cards: path, op badge, unified diff with +/- lines that animate in as events stream, "Saved" tick, Undo button.
- Trace: raw-ish log of steps/tool calls (trace.txt live view), collapsible JSON args, errors in red.
- Telemetry: per-request table (model, TTFT, total, tokens, retries, hedged) + export csv.

## Behaviour details
- Optimistic UI: show "Understanding" immediately, skeleton sources.
- Token rendering batched with requestAnimationFrame; markdown renderer must be streaming-safe (unclosed code fences/lists don't jump layout).
- Reducer: a single `useChatStream` hook consumes SSE events -> immutable message state (steps, sources, text, files, telemetry). Components are dumb.
- Errors: inline, human ("That model was slow, switched to X"), retry button.
- Empty state: 4 example prompts including deliberately typo'd ones ("wether in patna", "mutal fnd direct vs regulr") to show robustness.
- A11y: focus rings, aria-live polite for streaming, reduced-motion respected, contrast AA.

## Layer B transforms (phases 60-95, same components)
Chat = adviser console. Workbench Files = case repo (facts.json, assumptions.json, commits.log). Changes = commit diffs. Sources chips = evidence blame (click number -> page crop + highlighted quote). Add routes: `/case/[id]` (PR page), `/redteam`, `/policy`, `/client/[id]` (approved view).
