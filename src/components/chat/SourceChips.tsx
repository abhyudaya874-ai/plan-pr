"use client";

import { useState } from "react";
import type { SourceRef } from "./useChatStream";

/**
 * Citation chips. Chips render ONLY for [n] values in `cited` (from done) —
 * invented markers never get a chip (invariant I2).
 */
export function SourceChips({ sources, cited }: { sources: SourceRef[]; cited: number[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const seen = new Set<number>();
  const list = sources.filter((s) => cited.includes(s.n) && !seen.has(s.n) && seen.add(s.n));
  if (!list.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">Sources</span>
      {list.map((s) => (
        <span key={s.n} className="relative">
          <button
            onClick={() => setOpen(open === s.n ? null : s.n)}
            className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:border-[#c9854a]/60 hover:text-[#c9854a]"
          >
            [{s.n}] {s.domain}
          </button>
          {open === s.n && (
            <div className="absolute bottom-7 left-0 z-30 w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="block text-[13px] font-medium text-[#c9854a] hover:underline"
              >
                {s.title || s.url}
              </a>
              <div className="mt-1 break-all text-[11px] text-zinc-500">{s.url}</div>
              {s.quote && (
                <blockquote className="mt-2 border-l-2 border-[#c9854a]/50 pl-2 text-[12px] italic text-zinc-400">
                  {s.quote.slice(0, 180)}
                </blockquote>
              )}
              {s.snippet && <p className="mt-2 text-[12px] text-zinc-400">{s.snippet.slice(0, 220)}</p>}
              <div className="mt-2 flex gap-3 text-[10px] uppercase tracking-wide text-zinc-600">
                <span>via {s.via}</span>
                <span>{new Date(s.retrievedAt).toLocaleString()}</span>
              </div>
            </div>
          )}
        </span>
      ))}
    </div>
  );
}
