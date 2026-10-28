import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

let db: Database.Database | null = null;

/** Lazily created file DB (data/app.db, gitignored). */
export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads(
      session_id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    CREATE TABLE IF NOT EXISTS kv(
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_cache(
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export interface StoredMessage {
  id: number;
  role: string;
  content: string;
  meta: string | null;
  created_at: string;
}

export function appendMessage(
  sessionId: string,
  role: string,
  content: string,
  meta?: Record<string, unknown>,
): void {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    "INSERT INTO threads(session_id, title, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET updated_at=excluded.updated_at",
  ).run(sessionId, content.slice(0, 80), now, now);
  d.prepare(
    "INSERT INTO messages(session_id, role, content, meta, created_at) VALUES(?,?,?,?,?)",
  ).run(sessionId, role, content, meta ? JSON.stringify(meta) : null, now);
}

export function loadHistory(sessionId: string, limit = 12): StoredMessage[] {
  const d = getDb();
  return d
    .prepare(
      "SELECT id, role, content, meta, created_at FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?",
    )
    .all(sessionId, limit) as StoredMessage[];
}

export function countMessages(sessionId: string): number {
  const d = getDb();
  const row = d
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id=?")
    .get(sessionId) as { n: number };
  return row.n;
}

export function loadOlderMessages(
  sessionId: string,
  beforeId: number,
): StoredMessage[] {
  const d = getDb();
  return d
    .prepare(
      "SELECT id, role, content, meta, created_at FROM messages WHERE session_id=? AND id<? ORDER BY id ASC",
    )
    .all(sessionId, beforeId) as StoredMessage[];
}

export function kvGet(k: string): string | null {
  const d = getDb();
  const row = d.prepare("SELECT v FROM kv WHERE k=?").get(k) as
    | { v: string }
    | undefined;
  return row?.v ?? null;
}

export function kvSet(k: string, v: string): void {
  const d = getDb();
  d.prepare("INSERT INTO kv(k, v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v);
}
