"use client";

import { useEffect, useState } from "react";

interface ModelEntry {
  key: string;
  provider: string;
  modelId: string;
  label: string;
  tier: string;
  caps: { tools: boolean; json: boolean; vision: boolean; reasoning: boolean };
  ttftMs?: number;
}

export function ModelPicker({
  value,
  onChange,
}: {
  value: string; // "" = auto
  onChange: (key: string) => void;
}) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/models")
      .then((r) => r.json())
      .then((d: { models: ModelEntry[] }) => setModels(d.models))
      .catch(() => undefined);
  }, []);

  const current = value ? models.find((m) => m.key === value) : null;
  const label = value === "" ? "Auto" : (current?.label ?? value.split(":")[1]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1 text-[12px] text-zinc-300 transition hover:border-[#c9854a]/60"
      >
        <span className="text-zinc-500">model</span>
        <span className="font-medium">{label}</span>
        <span className="text-zinc-600">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 max-h-96 w-80 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl">
          <button
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="mb-1 w-full rounded-lg px-2.5 py-2 text-left text-[12px] hover:bg-zinc-800"
          >
            <div className="font-medium text-zinc-200">Auto — fastest verified</div>
            <div className="text-[11px] text-zinc-500">router picks by live TTFT + eval quality</div>
          </button>
          {models.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                onChange(m.key);
                setOpen(false);
              }}
              className={`w-full rounded-lg px-2.5 py-2 text-left text-[12px] hover:bg-zinc-800 ${m.key === value ? "bg-zinc-800" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-200">{m.label}</span>
                <span className="text-[10px] text-zinc-500">{m.provider}</span>
              </div>
              <div className="mt-0.5 flex gap-2 text-[10px] text-zinc-500">
                <span className="rounded bg-zinc-800 px-1.5">{m.tier}</span>
                {m.caps.tools && <span>tools</span>}
                {m.caps.json && <span>json</span>}
                {m.ttftMs !== undefined && <span>~{m.ttftMs}ms</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
