"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { StepEvent, ToolCallItem } from "./useChatStream";

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

export function StepsTimeline({
  steps,
  toolCalls,
  live,
}: {
  steps: StepEvent[];
  toolCalls: ToolCallItem[];
  live: boolean;
}) {
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
