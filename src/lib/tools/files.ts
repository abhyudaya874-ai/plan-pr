import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { existsSync, writeFileSync } from "node:fs";
import { workspaceFor, WorkspaceError, type FileChange } from "@/lib/workspace";
import { fn, type Tool, type ToolExecution } from "./registry";

const pathArg = z.object({ path: z.string().min(1).max(500) });
const writeArgs = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(2_000_000),
});
const csvArgs = z.object({
  path: z.string().min(1).max(500),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(5000),
});
const zipArgs = z.object({
  path: z.string().min(1).max(500),
  paths: z.array(z.string().min(1).max(500)).min(1).max(200),
});

const exec = (
  change: FileChange,
  note = "",
): ToolExecution => ({
  ok: true,
  resultText: `${change.op === "create" ? "Created" : change.op === "modify" ? "Updated" : "Deleted"} ${change.path} (${change.bytes} bytes). ${note}`.trim(),
  data: { fileChanges: [change] },
});

const fail = (e: unknown): ToolExecution => ({
  ok: false,
  resultText:
    e instanceof WorkspaceError
      ? `${e.code}: ${e.message}`
      : `file error: ${e instanceof Error ? e.message : String(e)}`,
});

function csvEscape(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function makeFileTools(): Tool[] {
  return [
    {
      name: "list_files",
      def: fn("list_files", "List all files in the session workspace with sizes.", {
        type: "object",
        properties: {},
      }),
      argsSchema: z.object({}),
      run: async (_args, ctx) => {
        const ws = workspaceFor(ctx.sessionId);
        const files = ws.list();
        return {
          ok: true,
          resultText: files.length
            ? files.map((f) => `${f.path} (${f.size}B)`).join("\n")
            : "Workspace is empty.",
          data: { files },
        };
      },
    },
    {
      name: "read_file",
      def: fn("read_file", "Read a workspace file's text content.", {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      }),
      argsSchema: pathArg,
      run: async (args, ctx) => {
        try {
          const { path: p } = pathArg.parse(args);
          const { content } = workspaceFor(ctx.sessionId).read(p);
          return { ok: true, resultText: content.slice(0, 12000) };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "write_file",
      def: fn(
        "write_file",
        "Create or overwrite a workspace file (.txt/.md/.csv/.json). Snapshot is taken before the first change each turn.",
        {
          type: "object",
          properties: {
            path: { type: "string", description: "relative path, e.g. notes/todo.md" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      ),
      argsSchema: writeArgs,
      run: async (args, ctx) => {
        try {
          const { path: p, content } = writeArgs.parse(args);
          return exec(workspaceFor(ctx.sessionId).write(p, content));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "append_file",
      def: fn("append_file", "Append text to the end of a workspace file.", {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      }),
      argsSchema: writeArgs,
      run: async (args, ctx) => {
        try {
          const { path: p, content } = writeArgs.parse(args);
          return exec(workspaceFor(ctx.sessionId).append(p, content));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "delete_file",
      def: fn("delete_file", "Delete a workspace file (recoverable via undo).", {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      }),
      argsSchema: pathArg,
      run: async (args, ctx) => {
        try {
          const { path: p } = pathArg.parse(args);
          return exec(workspaceFor(ctx.sessionId).delete(p));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "export_csv",
      def: fn(
        "export_csv",
        "Export validated rows (array of arrays) to a CSV file in the workspace.",
        {
          type: "object",
          properties: {
            path: { type: "string" },
            rows: { type: "array", items: { type: "array" }, description: "array of row arrays; scalars only" },
          },
          required: ["path", "rows"],
        },
      ),
      argsSchema: csvArgs,
      run: async (args, ctx) => {
        try {
          const { path: p, rows } = csvArgs.parse(args);
          const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
          return exec(workspaceFor(ctx.sessionId).write(p, csv), `${rows.length} rows`);
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "export_zip",
      def: fn(
        "export_zip",
        "Bundle the listed workspace files into a .zip saved in the workspace.",
        {
          type: "object",
          properties: {
            path: { type: "string", description: "zip filename, e.g. bundle.zip" },
            paths: { type: "array", items: { type: "string" } },
          },
          required: ["path", "paths"],
        },
      ),
      argsSchema: zipArgs,
      run: async (args, ctx) => {
        try {
          const { path: p, paths } = zipArgs.parse(args);
          const ws = workspaceFor(ctx.sessionId);
          const entries: Record<string, Uint8Array> = {};
          for (const f of paths) {
            const { content } = ws.read(f);
            entries[f] = strToU8(content);
          }
          const zipped = zipSync(entries);
          if (!p.endsWith(".zip")) {
            throw new WorkspaceError("zip path must end in .zip", "path");
          }
          const { abs, rel } = ws.resolve(p);
          const before = existsSync(abs) ? "<binary>" : undefined;
          writeFileSync(abs, zipped);
          return {
            ok: true,
            resultText: `Wrote ${rel} (${zipped.length} bytes, ${paths.length} files)`,
            data: {
              fileChanges: [
                {
                  path: rel,
                  op: before ? ("modify" as const) : ("create" as const),
                  before,
                  after: `<zip ${zipped.length} bytes>`,
                  bytes: zipped.length,
                  by: "agent" as const,
                },
              ],
            },
          };
        } catch (e) {
          return fail(e);
        }
      },
    },
  ];
}

/** Tools that mutate the filesystem (snapshot fires before the first one per turn). */
export const MUTATING_TOOLS = new Set([
  "write_file",
  "append_file",
  "delete_file",
  "export_csv",
  "export_zip",
]);
