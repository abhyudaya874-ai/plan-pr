"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, FilePlus, FilePen, FileX, RotateCcw, Save } from "lucide-react";
import type { FileChangeEv } from "@/components/chat/useChatStream";

interface FileInfo {
  path: string;
  size: number;
  mtime: string;
}

export function Workbench({
  sessionId,
  filesVersion,
  changedThisTurn,
}: {
  sessionId: string;
  filesVersion: number; // bump triggers re-list
  changedThisTurn: FileChangeEv[];
}) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [edited, setEdited] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"file" | "diff">("file");
  const [toast, setToast] = useState("");

  const reload = useCallback(() => {
    if (!sessionId) return;
    void fetch(`/api/workspace?sessionId=${sessionId}&op=list`)
      .then((r) => r.json())
      .then((d: { files: FileInfo[] }) => setFiles(d.files))
      .catch(() => undefined);
  }, [sessionId]);

  useEffect(reload, [reload, filesVersion]);

  useEffect(() => {
    if (!active || !sessionId) return;
    void fetch(`/api/workspace?sessionId=${sessionId}&op=read&path=${encodeURIComponent(active)}`)
      .then((r) => r.json())
      .then((d: { content?: string }) => {
        const c = d.content ?? "";
        setContent(c);
        setEdited(c);
        setDirty(false);
      })
      .catch(() => undefined);
  }, [active, sessionId, filesVersion]);

  const save = () => {
    if (!active) return;
    void fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, op: "write", path: active, content: edited }),
    }).then(() => {
      setContent(edited);
      setDirty(false);
      setToast("saved");
      setTimeout(() => setToast(""), 1500);
      reload();
    });
  };

  const undo = () => {
    void fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, op: "undo" }),
    }).then(() => reload());
  };

  const lastChange = changedThisTurn.filter((c) => c.path === active).at(-1);
  const changedPaths = new Set(changedThisTurn.map((c) => c.path));

  return (
    <div className="flex h-full flex-col text-[13px]">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          Workbench
        </span>
        <div className="flex items-center gap-1">
          {toast && <span className="text-[11px] text-emerald-500">{toast}</span>}
          <button
            onClick={undo}
            title="Undo last turn's file changes"
            className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* file list */}
        <div className="w-36 shrink-0 overflow-y-auto border-r border-zinc-800 py-1">
          {files.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-zinc-600">
              Empty — files the agent writes appear here live.
            </div>
          )}
          {files.map((f) => {
            const changed = changedPaths.has(f.path);
            const op = changedThisTurn.filter((c) => c.path === f.path).at(-1)?.op;
            return (
              <button
                key={f.path}
                onClick={() => setActive(f.path)}
                className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition ${
                  active === f.path ? "bg-zinc-800/70 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/40"
                }`}
              >
                <FileText size={12} className="shrink-0 text-zinc-600" />
                <span className="truncate">{f.path}</span>
                {changed && (
                  <span title={op} className="ml-auto shrink-0">
                    {op === "create" ? (
                      <FilePlus size={12} className="text-emerald-500" />
                    ) : op === "delete" ? (
                      <FileX size={12} className="text-red-400" />
                    ) : (
                      <FilePen size={12} className="text-[#c9854a]" />
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* viewer */}
        <div className="flex min-w-0 flex-1 flex-col">
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
                <span className="truncate font-mono text-[12px] text-zinc-300">{active}</span>
                <div className="ml-auto flex gap-1">
                  {lastChange && (
                    <button
                      onClick={() => setView(view === "diff" ? "file" : "diff")}
                      className={`rounded px-2 py-0.5 text-[11px] ${view === "diff" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                    >
                      diff
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={!dirty}
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-zinc-500 transition enabled:text-[#c9854a] enabled:hover:bg-zinc-800"
                  >
                    <Save size={11} /> save
                  </button>
                </div>
              </div>
              {view === "diff" && lastChange ? (
                <DiffView diff={lastChange.diff} />
              ) : (
                <textarea
                  value={edited}
                  onChange={(e) => {
                    setEdited(e.target.value);
                    setDirty(e.target.value !== content);
                  }}
                  className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-5 text-zinc-300 outline-none"
                  spellCheck={false}
                />
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-zinc-600">
              Select a file
            </div>
          )}
        </div>
      </div>

      {changedThisTurn.length > 0 && (
        <div className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
          {changedThisTurn.length} change{changedThisTurn.length === 1 ? "" : "s"} this turn
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-5">
      {diff.split("\n").map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-emerald-500/10 text-emerald-300"
              : line.startsWith("-") && !line.startsWith("---")
                ? "bg-red-500/10 text-red-300"
                : line.startsWith("@@")
                  ? "text-[#c9854a]"
                  : "text-zinc-500"
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}
