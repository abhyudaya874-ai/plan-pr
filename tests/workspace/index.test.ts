import { describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Workspace, WorkspaceError, workspaceRoot } from "@/lib/workspace";

const sid = `test-${process.pid}`;

function fresh(): Workspace {
  return new Workspace(sid);
}

describe("workspace path guard", () => {
  it("blocks .. traversal and absolute paths", () => {
    const ws = fresh();
    for (const bad of ["../x.txt", "a/../../x.txt", "/etc/passwd", "a/./../../b.txt", "..\\x.txt"]) {
      expect(() => ws.write(bad, "x"), bad).toThrow(WorkspaceError);
    }
  });

  it("blocks writes into .snap and other dot paths", () => {
    const ws = fresh();
    expect(() => ws.write(".snap/evil.txt", "x")).toThrow(WorkspaceError);
    expect(() => ws.write(".hidden/evil.txt", "x")).toThrow(WorkspaceError);
  });

  it("blocks symlink escapes in ancestors", () => {
    const ws = fresh();
    mkdirSync(ws.dir, { recursive: true });
    const outside = path.join(workspaceRoot(), "outside-test");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "secret.txt"), "shh");
    symlinkSync(outside, path.join(ws.dir, "link"), "dir");
    expect(() => ws.write("link/evil.txt", "x")).toThrow(WorkspaceError);
    expect(() => ws.read("link/secret.txt")).toThrow(WorkspaceError);
  });

  it("allows unicode and nested names", () => {
    const ws = fresh();
    ws.write("नोट्स/फ़ाइल मेरी.md", "unicode content");
    expect(ws.read("नोट्स/फ़ाइल मेरी.md").content).toBe("unicode content");
    expect(ws.list().some((f) => f.path.includes("फ़ाइल मेरी.md"))).toBe(true);
  });

  it("rejects oversized content", () => {
    const ws = fresh();
    expect(() => ws.write("big.txt", "x".repeat(2_100_000))).toThrow(WorkspaceError);
  });
});

describe("crud + snapshot/undo", () => {
  it("write/read/append/delete roundtrip", () => {
    const ws = fresh();
    ws.write("a.txt", "hello");
    expect(ws.read("a.txt").content).toBe("hello");
    ws.append("a.txt", " world");
    expect(ws.read("a.txt").content).toBe("hello world");
    ws.delete("a.txt");
    expect(() => ws.read("a.txt")).toThrow(WorkspaceError);
  });

  it("snapshot + undo restores files", () => {
    const ws = fresh();
    ws.write("keep.txt", "v1");
    const seq = ws.snapshot();
    ws.write("keep.txt", "v2");
    ws.write("gone.txt", "bye");
    const restored = ws.undo();
    expect(restored).toBe(seq);
    expect(ws.read("keep.txt").content).toBe("v1");
    expect(ws.list().some((f) => f.path === "gone.txt")).toBe(false);
  });

  it("undo returns null with no snapshots", () => {
    const ws = new Workspace(`fresh-${process.pid}-none`);
    expect(ws.undo()).toBeNull();
  });
});
