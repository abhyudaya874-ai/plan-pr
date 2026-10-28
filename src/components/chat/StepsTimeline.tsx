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
            <div key={i} className="flex items-center gap-2 text-[12px]">
              {s.status === "running" ? (
                <CircleDashed size={13} className="animate-spin text-[#c9854a]" />
              ) : s.status === "error" ? (
                <XCircle size={13} className="text-red-400" />
              ) : (
                <CheckCircle2 size={13} className="text-emerald-500" />
              )}
              <span className="text-zinc-500 w-14 shrink-0">{KIND_LABEL[s.kind] ?? s.kind}</span>
              <span className="truncate text-zinc-300">{s.label}</span>
              {s.detail && <span className="truncate text-zinc-600">· {s.detail}</span>}
            </div>
          ))}
          {toolCalls.map((t, i) => (
            <div key={`t${i}`} className="mt-1 rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-400">
              <span className="text-[#c9854a]">{t.name}</span>({trunc(JSON.stringify(t.args), 110)})
              {t.ok !== undefined && (
                <span className={t.ok ? "text-emerald-500" : "text-red-400"}>
                  {" "}→ {t.ok ? "ok" : "failed"} {t.summary ? `· ${trunc(t.summary, 90)}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
