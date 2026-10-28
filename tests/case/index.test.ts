import { describe, expect, it } from "vitest";
import {
  appendCommit,
  blame,
  createCase,
  listCommits,
  loadCase,
  undoHead,
  verifyChain,
} from "@/lib/case";

const id = `tc-${process.pid}`;

describe("case repo hash chain", () => {
  it("creates a case with init commit", () => {
    const c = createCase("test", "p1", { "fact.age": { value: 30, source: "persona" } });
    expect(c.caseId).toBeTruthy();
    const commits = listCommits(c.caseId);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(c.caseId).ok).toBe(true);
  });

  it("facts change creates a chained commit", () => {
    const c = createCase(`c${id}`, "p1", {});
    appendCommit(c.caseId, "facts", { "fact.age": { value: 30 } });
    appendCommit(c.caseId, "facts", { "fact.age": { value: 31 }, "fact.city": { value: "Pune" } });
    const commits = listCommits(c.caseId);
    expect(commits).toHaveLength(3);
    expect(commits[2]!.parentHash).toBe(commits[1]!.hash);
    expect(verifyChain(c.caseId).ok).toBe(true);
    expect(loadCase(c.caseId)!.facts["fact.city"]!.value).toBe("Pune");
  });

  it("tampering breaks verification", () => {
    const c = createCase(`t${id}`, "p1", {});
    appendCommit(c.caseId, "facts", { "fact.a": { value: 1 } });
    const commits = listCommits(c.caseId);
    // corrupt a stored commit file
    const bad = { ...commits[1]!, changes: [] };
    // write directly to simulate tamper
    const fs = require("node:fs") as typeof import("node:fs");
    const p = require("node:path") as typeof import("node:path");
    fs.writeFileSync(
      p.join(process.cwd(), "data/cases", c.caseId, "commits", "0001.json"),
      JSON.stringify(bad, null, 2),
    );
    const v = verifyChain(c.caseId);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("undo produces a revert commit, never rewrites history", () => {
    const c = createCase(`u${id}`, "p1", {});
    appendCommit(c.caseId, "facts", { "fact.a": { value: 1 } });
    const before = listCommits(c.caseId).length;
    const rev = undoHead(c.caseId);
    expect(rev).not.toBeNull();
    expect(listCommits(c.caseId).length).toBe(before + 1);
    expect(rev!.kind).toBe("revert");
    expect(loadCase(c.caseId)!.facts["fact.a"]).toBeUndefined();
  });

  it("blame finds the commit that introduced the current value", () => {
    const c = createCase(`b${id}`, "p1", {});
    appendCommit(c.caseId, "facts", { "fact.x": { value: 10 } });
    appendCommit(c.caseId, "facts", { "fact.y": { value: 20 } });
    appendCommit(c.caseId, "facts", { "fact.x": { value: 11 } });
    const b = blame(c.caseId, "fact.x");
    expect(b!.commitSeq).toBe(3);
    expect((b!.after as { value: number }).value).toBe(11);
    const b2 = blame(c.caseId, "fact.y");
    expect(b2!.commitSeq).toBe(2);
  });

  it("a facts commit revokes approval", () => {
    const c = createCase(`a${id}`, "p1", {});
    appendCommit(c.caseId, "facts", { "fact.a": { value: 1 } });
    appendCommit(c.caseId, "approval", {}, { approvedBy: "adviser-1" });
    expect(loadCase(c.caseId)!.status).toBe("approved");
    appendCommit(c.caseId, "facts", { "fact.a": { value: 2 } });
    expect(loadCase(c.caseId)!.status).toBe("open");
  });
});
