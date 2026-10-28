import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,

  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code: "path" | "notfound" | "toolarge" | "io",
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface FileInfo {
  path: string;
  size: number;
  mtime: string;
}

export interface FileChange {
  path: string;
  op: "create" | "modify" | "delete";
  before?: string;
  after?: string;
  bytes: number;
  by: "agent" | "user";
}

const ROOT = path.join(process.cwd(), "workspace");
const MAX_FILE = 2_000_000; // 2MB
const SNAP_DIR = ".snap";

/**
 * A per-session sandboxed directory. Every access goes through resolve()
 * which normalizes + rejects escapes (../, absolute, symlink hops).
 */
export class Workspace {
  readonly dir: string;

  constructor(readonly sessionId: string) {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
    this.dir = path.join(ROOT, safeSession);
  }

  /** Normalize + confine a user-supplied path inside the sandbox. */
  resolve(userPath: string): { abs: string; rel: string } {
    const raw = (userPath ?? "").replace(/^[/\\]+/, "").replace(/\0/g, "");
    if (!raw || raw === ".") {
      throw new WorkspaceError("path is empty", "path");
    }
    const norm = path.normalize(raw).replace(/\\/g, "/");
    if (norm.startsWith("..") || norm.includes("/../") || path.isAbsolute(userPath)) {
      throw new WorkspaceError(`path escapes the workspace: ${userPath}`, "path");
    }
    const abs = path.join(this.dir, norm);
    if (!abs.startsWith(this.dir + path.sep) && abs !== this.dir) {
      throw new WorkspaceError(`path escapes the workspace: ${userPath}`, "path");
    }
    // symlink escape check on existing ancestors
    let cursor = this.dir;
    for (const part of norm.split("/").slice(0, -1)) {
      cursor = path.join(cursor, part);
      if (existsSync(cursor)) {
        if (lstatSync(cursor).isSymbolicLink()) {
          throw new WorkspaceError(`symlink in path blocked: ${norm}`, "path");
        }
        if (!statSync(cursor).isDirectory()) {
          throw new WorkspaceError(`not a directory: ${part}`, "path");
        }
      }
    }
    return { abs, rel: norm };
  }

  /** Block writes into the snapshot area or other dot-system paths for agent tools. */
  private assertWritable(rel: string): void {
    const top = rel.split("/")[0]!;
    if (top === SNAP_DIR || (top.startsWith(".") && top !== ".")) {
      throw new WorkspaceError(`system path is not writable: ${rel}`, "path");
    }
  }

  list(): FileInfo[] {
    if (!existsSync(this.dir)) return [];
    const out: FileInfo[] = [];
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        if (name === SNAP_DIR) continue;
        const abs = path.join(dir, name);
        const rp = rel ? `${rel}/${name}` : name;
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs, rp);
        else if (st.isFile()) {
          out.push({ path: rp, size: st.size, mtime: st.mtime.toISOString() });
        }
      }
    };
    walk(this.dir, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  read(userPath: string): { content: string; bytes: number } {
    const { abs } = this.resolve(userPath);
    if (!existsSync(abs)) {
      throw new WorkspaceError(`file not found: ${userPath}`, "notfound");
    }
    const st = statSync(abs);
    if (st.size > MAX_FILE) {
      throw new WorkspaceError(`file too large to read (${st.size} bytes)`, "toolarge");
    }
    return { content: readFileSync(abs, "utf8"), bytes: st.size };
  }

  write(userPath: string, content: string, by: "agent" | "user" = "agent"): FileChange {
    const { abs, rel } = this.resolve(userPath);
    this.assertWritable(rel);
    if (Buffer.byteLength(content) > MAX_FILE) {
      throw new WorkspaceError("content exceeds 2MB limit", "toolarge");
    }
    const existed = existsSync(abs);
    const before = existed ? readFileSync(abs, "utf8") : undefined;
    mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = abs + `.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, abs); // atomic-ish
    return {
      path: rel,
      op: existed ? "modify" : "create",
      before,
      after: content,
      bytes: Buffer.byteLength(content),
      by,
    };
  }

  append(userPath: string, content: string, by: "agent" | "user" = "agent"): FileChange {
    const { abs, rel } = this.resolve(userPath);
    this.assertWritable(rel);
    const existed = existsSync(abs);
    const before = existed ? readFileSync(abs, "utf8") : "";
    if (Buffer.byteLength(before) + Buffer.byteLength(content) > MAX_FILE) {
      throw new WorkspaceError("file would exceed 2MB limit", "toolarge");
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, before + content, "utf8");
    return {
      path: rel,
      op: existed ? "modify" : "create",
      before,
      after: before + content,
      bytes: Buffer.byteLength(content),
      by,
    };
  }

  delete(userPath: string, by: "agent" | "user" = "agent"): FileChange {
    const { abs, rel } = this.resolve(userPath);
    this.assertWritable(rel);
    if (!existsSync(abs)) {
      throw new WorkspaceError(`file not found: ${userPath}`, "notfound");
    }
    const before = readFileSync(abs, "utf8");
    rmSync(abs);
    return { path: rel, op: "delete", before, bytes: 0, by };
  }

  /** Snapshot all current files (recursive, skipping .snap). Returns seq. */
  snapshot(): number {
    mkdirSync(this.dir, { recursive: true });
    const snapRoot = path.join(this.dir, SNAP_DIR);
    mkdirSync(snapRoot, { recursive: true });
    const seqs = readdirSync(snapRoot)
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n));
    const seq = (seqs.length ? Math.max(...seqs) : 0) + 1;
    const dest = path.join(snapRoot, String(seq));
    mkdirSync(dest, { recursive: true });
    const copy = (src: string, dst: string) => {
      for (const name of readdirSync(src)) {
        if (name === SNAP_DIR) continue;
        const s = path.join(src, name);
        const d = path.join(dst, name);
        if (statSync(s).isDirectory()) {
          mkdirSync(d, { recursive: true });
          copy(s, d);
        } else if (statSync(s).isFile()) {
          copyFileSync(s, d);
        }
      }
    };
    copy(this.dir, dest);
    return seq;
  }

  /** Restore the newest snapshot. Returns the seq restored, or null. */
  undo(): number | null {
    const snapRoot = path.join(this.dir, SNAP_DIR);
    if (!existsSync(snapRoot)) return null;
    const seqs = readdirSync(snapRoot)
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => b - a);
    const latest = seqs[0];
    if (latest === undefined) return null;
    // wipe current files except .snap, then copy back
    for (const name of readdirSync(this.dir)) {
      if (name === SNAP_DIR) continue;
      rmSync(path.join(this.dir, name), { recursive: true, force: true });
    }
    const src = path.join(snapRoot, String(latest));
    const restore = (s: string, d: string) => {
      for (const name of readdirSync(s)) {
        const sp = path.join(s, name);
        const dp = path.join(d, name);
        if (statSync(sp).isDirectory()) {
          mkdirSync(dp, { recursive: true });
          restore(sp, dp);
        } else {
          copyFileSync(sp, dp);
        }
      }
    };
    restore(src, this.dir);
    return latest;
  }
}

export function workspaceFor(sessionId: string): Workspace {
  return new Workspace(sessionId);
}

/** Path used by the real root for path-safety assertions in tests. */
export function workspaceRoot(): string {
  return ROOT;
}
