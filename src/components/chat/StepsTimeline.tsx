"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, ExternalLink, XCircle } from "lucide-react";
import type { SourceRef, StepEvent, ToolCallItem } from "./useChatStream";

const KIND_LABEL: Record<string, string> = {
  search: "Search",
  read: "Read",
  calc: "Calc",
  vault: "Vault",
  write: "Write",
  think: "Think",
  model_switch: "Model",
  gate: "Gate",
  understand: "Understand",
};

/** Perplexity-style expandable block for real model reasoning. */
function ThinkDetail({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="block w-full whitespace-pre-wrap rounded bg-black/30 px-2.5 py-1.5 text-left text-[11.5px] italic leading-5 text-zinc-500 transition hover:text-zinc-400"
    >
      <span className={expanded ? "" : "line-clamp-4"}>{text}</span>
      <span className="mt-0.5 block text-[10px] not-italic text-zinc-600">
        {expanded ? "collapse ▴" : "show full thinking ▾"}
      </span>
    </button>
  );
}

/** Devin-style inline diff inside a tool-call card. */
function MiniDiff({ f }: { f: { path: string; op: string; added: number; deleted: number; diff: string } }) {
  const [expanded, setExpanded] = useState(false);
  const lines = f.diff.split("\n").filter((l) => !l.startsWith("diff ") && !l.startsWith("index "));
  const shown = expanded ? lines : lines.slice(0, 24);
  const opColor =
    f.op === "create" ? "text-emerald-400" : f.op === "delete" ? "text-red-400" : "text-amber-400";
  return (
    <div className="mt-1 overflow-hidden rounded border border-zinc-800 bg-black/60">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
        <span className="font-mono text-[10.5px] text-zinc-400">{f.path}</span>
        <span className="font-mono text-[10px]">
          <span className={opColor}>{f.op}</span>
          {(f.added || f.deleted) > 0 && (
            <>
              {" "}<span className="text-emerald-500">+{f.added}</span>
              {" "}<span className="text-red-400">−{f.deleted}</span>
            </>
          )}
        </span>
      </div>
      <pre className="overflow-x-auto px-2 py-1 font-mono text-[10.5px] leading-[1.45]">
        {shown.map((l, i) => (
          <div
            key={i}
            className={
              l.startsWith("+")
                ? "bg-emerald-500/10 text-emerald-300"
                : l.startsWith("-")
                  ? "bg-red-500/10 text-red-300"
                  : l.startsWith("@@")
                    ? "text-[#7aa2f7]"
                    : "text-zinc-500"
            }
          >
            {l || " "}
          </div>
        ))}
      </pre>
      {lines.length > 24 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full border-t border-zinc-800 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "collapse ▴" : `show all ${lines.length} lines ▾`}
        </button>
      )}
    </div>
  );
}

/** Devin-style per-tool result stats: lines, diff counts, result values. */
function StatLine({ s }: { s: string }) {
  // colourize +n −m in file-change stats
  const parts = s.split(/(\+\d+|−\d+)/g);
  return (
    <div className="font-mono text-[10.5px] leading-4 text-zinc-500">
      {parts.map((p, i) =>
        p.startsWith("+") ? (
          <span key={i} className="text-emerald-500">{p}</span>
        ) : p.startsWith("−") ? (
          <span key={i} className="text-red-400">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

/** Source chip inside a tool-call card: [n] domain, popover + link. */
function SourceChip({ s }: { s: SourceRef }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:border-[#c9854a]/60 hover:text-[#c9854a]"
      >
        [{s.n}] {s.domain}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 block w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 text-left shadow-xl">
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[#c9854a] hover:underline"
          >
            {s.title || s.url} <ExternalLink size={10} />
          </a>
          <span className="block text-[10.5px] leading-4 text-zinc-400">{s.snippet}</span>
          <span className="mt-1 block text-[9.5px] text-zinc-600">
            via {s.via} · {new Date(s.retrievedAt).toLocaleString()}
          </span>
        </span>
      )}
    </span>
  );
}

export function StepsTimeline({
  steps,
  toolCalls,
  sources,
  live,
}: {
  steps: StepEvent[];
  toolCalls: ToolCallItem[];
  sources?: SourceRef[];
  live: boolean;
}) {
  const byUrl = new Map((sources ?? []).map((s) => [s.canonicalUrl, s]));
  const [open, setOpen] = useState(false);
  const real = steps.filter((s) => s.kind !== "understand" || s.status !== "running");
  if (!real.length && !toolCalls.length) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] text-zinc-500 transition hover:text-zinc-300"
      >
        <span className={live ? "animate-pulse" : ""}>
          {live ? "●" : "○"}
        </span>
        {real.length} step{real.length === 1 ? "" : "s"}
        {toolCalls.length ? ` · ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}` : ""}
        <span className="text-zinc-700">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
          {real.map((s, i) => (
            <div key={i} className="text-[12px]">
              <div className="flex items-center gap-2">
                {s.status === "running" ? (
                  <CircleDashed size={13} className="animate-spin text-[#c9854a]" />
                ) : s.status === "error" ? (
                  <XCircle size={13} className="text-red-400" />
                ) : (
                  <CheckCircle2 size={13} className="text-emerald-500" />
                )}
                <span className="w-14 shrink-0 text-zinc-500">{KIND_LABEL[s.kind] ?? s.kind}</span>
                <span className="truncate text-zinc-300">{s.label}</span>
                {s.kind !== "think" && s.detail && (
                  <span className="truncate text-zinc-600">· {s.detail}</span>
                )}
              </div>
              {s.kind === "think" && s.detail && <ThinkDetail text={s.detail} />}
            </div>
          ))}
          {toolCalls.map((t, i) => (
            <div key={`t${i}`} className="mt-1 rounded bg-black/40 px-2 py-1.5">
              <div className="font-mono text-[11px] text-zinc-400">
                <span className="text-[#c9854a]">{t.name}</span>({trunc(JSON.stringify(t.args), 110)})
                {t.ok !== undefined && (
                  <span className={t.ok ? "text-emerald-500" : "text-red-400"}>
                    {" "}→ {t.ok ? "ok" : "failed"} {t.summary ? `· ${trunc(t.summary, 70)}` : ""}
                  </span>
                )}
              </div>
              {t.stats?.map((s, j) => <StatLine key={j} s={s} />)}
              {t.sourceUrls && t.sourceUrls.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.sourceUrls.map((u, j) => {
                    const ref = byUrl.get(u);
                    return ref ? (
                      <SourceChip key={j} s={ref} />
                    ) : (
                      <a
                        key={j}
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-[#c9854a]"
                      >
                        {u.replace(/^https?:\/\//, "").slice(0, 32)}
                      </a>
                    );
                  })}
                </div>
              )}
              {t.files?.map((f, j) => <MiniDiff key={j} f={f} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
