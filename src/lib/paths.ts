import path from "node:path";

/**
 * Runtime-writable root. Local dev: the repo (data/, workspace/ as before).
 * Serverless (Vercel): the filesystem is read-only except /tmp — set
 * RUNTIME_DIR=/tmp/pramaan so SQLite, case commits, workspace files and
 * quarantine flags land somewhere writable. Seed data (vault, policy,
 * personas) stays bundled and read-only.
 */
export function runtimeDir(): string {
  return process.env.RUNTIME_DIR || process.cwd();
}

export function runtimePath(...segments: string[]): string {
  return path.join(runtimeDir(), ...segments);
}
