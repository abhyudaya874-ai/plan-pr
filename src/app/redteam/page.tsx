"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Card {
  id: string;
  title: string;
  prompt: string;
  paraphrases: string[];
  rule: string;
}
interface Verdict {
  pass: boolean;
  reason: string | null;
  rule?: string;
  answer?: string;
  bridge?: string | null;
}

export default function RedTeamPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict | "running">>({});
  const [free, setFree] = useState("");
  const [freeVerdict, setFreeVerdict] = useState<Verdict | null>(null);
  const [report, setReport] = useState<{ score?: string; generatedAt?: string } | null>(null);

  useEffect(() => {
    void fetch("/api/redteam")
      .then((r) => r.json())
      .then((d) => {
        setCards(d.cards ?? []);
        setReport(d.lastReport);
      });
  }, []);

  const runPrompt = async (prompt: string, cardId?: string): Promise<Verdict> => {
    const res = await fetch("/api/redteam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, cardId }),
    });
    const d = (await res.json()) as Verdict & { verdict?: { pass: boolean; reason: string | null } };
    if (d.verdict) {
      return { pass: d.verdict.pass, reason: d.verdict.reason, rule: d.rule, answer: d.answer, bridge: d.bridge };
    }
    return { pass: false, reason: "request failed" };
  };

  const runCard = async (c: Card) => {
    setVerdicts((v) => ({ ...v, [c.id]: "running" }));
    // main prompt + paraphrases — card passes only if ALL survive
    const results = await Promise.all(
      [c.prompt, ...c.paraphrases].map((p) => runPrompt(p, c.id)),
    );
    const failed = results.find((r) => !r.pass);
    setVerdicts((v) => ({
      ...v,
      [c.id]: failed
        ? { ...failed, reason: `${failed.reason} (${results.filter((r) => r.pass).length}/${results.length} survived)` }
        : { pass: true, reason: null, answer: results[0]!.answer, rule: c.rule },
    }));
  };

  return (
    <div className="min-h-screen bg-[#0b0b0d] p-6 text-zinc-200">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Red-team arcade</h1>
            <p className="text-sm text-zinc-500">
              10 adversarial cards through the real chat pipeline{report?.score ? ` — last scripted run ${report.score}` : ""}
            </p>
          </div>
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← console</Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((c) => {
            const v = verdicts[c.id];
            return (
              <div key={c.id} className="rounded-xl border border-zinc-800 bg-[#0f0f11] p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-medium">{c.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      v === "running"
                        ? "bg-zinc-800 text-zinc-400"
                        : v?.pass
                          ? "bg-emerald-500/15 text-emerald-400"
                          : v
                            ? "bg-red-500/15 text-red-400"
                            : "bg-zinc-800 text-zinc-600"
                    }`}
                  >
                    {v === "running" ? "…" : v?.pass ? "safe" : v ? "fail" : "idle"}
                  </span>
                </div>
                <p className="mb-1 text-[11.5px] italic text-zinc-400">“{c.prompt}”</p>
                <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-600">{c.rule}</p>
                {v && v !== "running" && v.reason && (
                  <p className="mb-2 text-[11px] text-red-300">{v.reason}</p>
                )}
                {v && v !== "running" && v.answer && (
                  <details className="mb-2 text-[11px] text-zinc-500">
                    <summary className="cursor-pointer hover:text-zinc-300">answer preview</summary>
                    <p className="mt-1 whitespace-pre-wrap rounded bg-black/40 p-2 text-zinc-400">{v.answer}</p>
                  </details>
                )}
                <button
                  onClick={() => void runCard(c)}
                  disabled={v === "running"}
                  className="rounded-lg bg-zinc-800 px-3 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-40"
                >
                  run card + {c.paraphrases.length} paraphrases
                </button>
              </div>
            );
          })}
        </div>

        {/* free-text box */}
        <div className="mt-6 rounded-xl border border-zinc-800 bg-[#0f0f11] p-4">
          <p className="mb-2 text-[12px] font-medium text-zinc-300">Free attack</p>
          <div className="flex gap-2">
            <input
              value={free}
              onChange={(e) => setFree(e.target.value)}
              placeholder="type an adversarial prompt…"
              className="flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-zinc-600"
            />
            <button
              onClick={async () => {
                setFreeVerdict(null);
                setFreeVerdict(await runPrompt(free));
              }}
              disabled={!free.trim()}
              className="rounded-lg bg-[#c9854a] px-3 py-1.5 text-[12px] text-black disabled:opacity-40"
            >
              attack
            </button>
          </div>
          {freeVerdict && (
            <div className="mt-3 rounded-lg border border-zinc-800 p-2.5 text-[12px]">
              <span className={freeVerdict.pass ? "text-emerald-400" : "text-red-400"}>
                {freeVerdict.pass ? "held the line" : `broke: ${freeVerdict.reason}`}
              </span>
              {freeVerdict.answer && (
                <p className="mt-1 whitespace-pre-wrap text-zinc-400">{freeVerdict.answer.slice(0, 400)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
