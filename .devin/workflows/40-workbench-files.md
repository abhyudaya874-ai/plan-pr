---
description: Phase 40 (1.5h). Sandboxed workspace, file tools, live diffs, snapshots/undo, auto-saved txt/csv.
---
# /40-workbench-files
Rules in force: 40-tools-and-workspace.
1. `src/lib/workspace/fs.ts`: root resolution per session, path guard (traversal, absolute, symlink), ext allowlist, size/file-count caps.
2. `diff.ts` (unified diff via `diff`), `snapshots.ts` (.history, restore).
3. Tools: `list_files, read_file, write_file, append_file, delete_file, export_csv, export_zip`. Each write emits a `file_change` event (before/after/diff/bytes/by).
4. REST: `GET /api/workspace/[id]/files`, `GET .../file?path=`, `POST .../undo`, `GET .../zip`.
5. Per-turn auto-saves: `trace.txt`, `sources.csv`, `telemetry.csv` (flush anything buffered from earlier phases).
6. Teach the agent: when asked to save/export/write, call a file tool and state the path. Add a test: a "save this as notes.txt" prompt must produce a `file_change` event; a prompt that does NOT ask to save must not write files.
## Verify
- Path traversal attempts (`../../etc/passwd`, `/abs`, symlink) all rejected, tested.
- "make a csv of these 5 funds with columns X" -> file created, valid CSV, event emitted, download works.
- Edit an existing file twice -> two diffs, undo restores v1.
## Commit
`feat(workspace): sandboxed files with live diffs`. Next: /50-ui-shell
