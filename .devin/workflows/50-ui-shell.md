---
description: Phase 50 (2.5h). Perplexity-style answer view + Devin-style workbench. The base UI of the app.
---
# /50-ui-shell
Rules in force: 50-ui-perplexity-devin, 40-tools-and-workspace (event protocol).
1. Design tokens in `globals.css` (CSS variables, dark-first, light supported). One accent. 8px grid.
2. `useChatStream` hook: SSE client -> reducer (steps, sources, text, files, telemetry, bridge). Resume-safe, abortable. Unit-test the reducer with recorded event streams.
3. Shell layout: left rail, center column, right workbench (resizable/collapsible), mobile sheets.
4. Composer: multiline, file paste/drag to workspace, model picker (Auto-fast, Auto-quality, verified models grouped by provider with TTFT/tools/tier badges), Chat/Research toggle, Stop.
5. Answer view: query title, steps timeline, sources row, streaming markdown with citation chips + popovers, bridge chip (click = send), footer (latency chip, copy, regenerate, follow-ups).
6. Workbench: Files tree with flash on change + viewers (txt/md/csv table/json), Changes (animated diffs, Undo), Trace, Telemetry (+csv export), downloads.
7. Empty state with typo'd example prompts. Error states. Skeletons.
8. A11y + perf pass (aria-live polite, focus, reduced motion, rAF-batched tokens).
## Verify
Run the 5 golden prompts from /20 plus a research prompt and a "save this as notes.txt" prompt in the real UI. Check: sources appear before the answer finishes; chips resolve; every URL shown is from the registry; file appears live in tree and Changes; bridge chip works; model switch mid-thread works; mobile layout usable. Capture screenshots into `docs/screens/`.
## Commit
`feat(ui): research chat with live workbench`. LAYER A COMPLETE. Tag `v0-base`. Next: /60-case-repo-and-vault
