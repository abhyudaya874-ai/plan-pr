/**
 * Sandboxed per-session workspace: path guard, diffs, snapshots.
 * Lands in phase 40 - see .devin/workflows/40-workbench-files.md.
 */
export type FileOp = "create" | "modify" | "delete";
export const WORKSPACE_ROOT = "workspace" as const;
