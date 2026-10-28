"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GitCommitHorizontal, RotateCcw } from "lucide-react";
import { Resizer, useResizable } from "@/components/Resizer";

interface Persona {
  id: string;
  label: string;
  age: number;
  city: string;
  incomeMonthly: number;
  goals: { id: string; label: string; amount: number | null; horizonMonths: number; priority: string; type?: string }[];
  statedRiskTolerance: string;
  [k: string]: unknown;
}
interface CaseInfo {
  caseId: string;
  name: string;
  status: string;
  personaId: string;
  facts: Record<string, { value: unknown; source?: string }>;
}
interface CommitInfo {
  seq: number;
  kind: string;
  at: string;
  hash: string;
  changes: { key: string; before: unknown; after: unknown }[];
}
interface BlameInfo {
  found: boolean;
  key: string;
  commitSeq: number;
  commitHash: string;
  at: string;
}

/** Persona -> seed facts (everything labelled synthetic/persona). */
function seedFacts(p: Persona): Record<string, { value: unknown; source: string }> {
  const f: Record<string, { value: unknown; source: string }> = {
    "facts.age": { value: p.age, source: "persona" },
    "facts.city": { value: p.city, source: "persona" },
    "facts.income_monthly": { value: p.incomeMonthly, source: "persona" },
    "facts.income_stable": { value: p.incomeStable, source: "persona" },
    "facts.dependents": { value: p.dependents, source: "persona" },
    "facts.emergency_buffer_months": { value: p.emergencyBufferMonths, source: "persona" },
    "facts.stated_risk_tolerance": { value: p.statedRiskTolerance, source: "persona" },
  };
  if (p.behavioralFlags) {
    f["facts.behavioral_flags"] = { value: (p.behavioralFlags as string[]).join(","), source: "persona" };
  }
  if (p.corpus) {
    f["facts.corpus"] = { value: p.corpus, source: "persona" };
  }
  p.goals.forEach((g, i) => {
    f[`facts.goal_${i}.label`] = { value: g.label, source: "persona" };
    if (g.amount != null) f[`facts.goal_${i}.amount`] = { value: g.amount, source: "persona" };
    f[`facts.goal_${i}.horizon_months`] = { value: g.horizonMonths, source: "persona" };
    f[`facts.goal_${i}.priority`] = { value: g.priority, source: "persona" };
    if (g.type) {
      f[`facts.goal_${i}.type`] = { value: g.type, source: "persona" };
    }
  });
  return f;
}

export default function CasePage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [cases, setCases] = useState<CaseInfo[]>([]);
  const [active, setActive] = useState<CaseInfo | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [chain, setChain] = useState<{ ok: boolean } | null>(null);
  const [blameInfo, setBlameInfo] = useState<Record<string, BlameInfo>>({});
  const [gates, setGates] = useState<{ id: string; name: string; status: string; why: string[] }[]>([]);
  const [draft, setDraft] = useState("");
  const [approval, setApproval] = useState<{ valid: boolean; receipt: { contentHash: string; approvedBy: string; at: string } | null } | null>(null);
  const [approver, setApprover] = useState("adviser-1");
  const [openBlame, setOpenBlame] = useState<string | null>(null);
  const side = useResizable({
    axis: "x",
    initial: 256,
    min: 200,
    max: 460,
    storageKey: "pramaan:case-rail",
  });
  const personasH = useResizable({
    axis: "y",
    initial: 240,
    min: 80,
    max: () => window.innerHeight * 0.6,
    storageKey: "pramaan:case-personas-h",
  });

  const refresh = useCallback(() => {
    void fetch("/api/case").then((r) => r.json()).then((d: { cases: CaseInfo[] }) => setCases(d.cases));
  }, []);

  useEffect(() => {
    void fetch("/api/personas").then((r) => r.json()).then((d: { personas: Persona[] }) => setPersonas(d.personas));
    refresh();
  }, [refresh]);

  const openCase = (caseId: string) => {
    void fetch(`/api/case?caseId=${caseId}`).then((r) => r.json()).then(
      (d: {
        case: CaseInfo;
        commits: CommitInfo[];
        chain: { ok: boolean };
        gates: { id: string; name: string; status: string; why: string[] }[] | null;
        draft: string | null;
        approval: { valid: boolean; receipt: { contentHash: string; approvedBy: string; at: string } | null };
      }) => {
        setActive(d.case);
        setCommits(d.commits);
        setChain(d.chain);
        setGates(d.gates ?? []);
        setDraft(d.draft ?? "");
        setApproval(d.approval ?? null);
        // blame per fact key
        const keys = Object.keys(d.case.facts);
        void Promise.all(
          keys.map((k) =>
            fetch(`/api/blame?caseId=${caseId}&key=${encodeURIComponent(k)}`)
              .then((r) => r.json())
              .then((b) => [k, b] as const),
          ),
        ).then((pairs) => setBlameInfo(Object.fromEntries(pairs)));
      },
    );
  };

  const create = (p: Persona) => {
    void fetch("/api/case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "create", name: p.label, personaId: p.id, facts: seedFacts(p) }),
    })
      .then((r) => r.json())
      .then((d: { case: CaseInfo }) => {
        refresh();
        openCase(d.case.caseId);
      });
  };

  const undo = () => {
    if (!active) return;
    void fetch("/api/case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "undo", caseId: active.caseId }),
    }).then(() => openCase(active.caseId));
  };

  return (
    <div className="flex h-dvh bg-[#0a0a0b] text-zinc-200">
      <div className="flex shrink-0 flex-col bg-[#0d0d0f]" style={{ width: side.size }}>
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/" className="font-serif text-[20px] italic text-zinc-100">Pramaan</Link>
          <Link href="/" className="text-[11px] text-zinc-500 hover:text-zinc-300">← chat</Link>
        </div>
        <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">New case</div>
        <div className="space-y-1 overflow-y-auto px-3" style={{ maxHeight: personasH.size }}>
          {personas.map((p) => (
            <button
              key={p.id}
              onClick={() => create(p)}
              className="w-full rounded-lg border border-zinc-800 px-2.5 py-2 text-left text-[12px] text-zinc-400 transition hover:border-[#c9854a]/40 hover:text-zinc-200"
            >
              {p.label}
            </button>
          ))}
        </div>
        <Resizer
          orientation="horizontal"
          onPointerDown={personasH.onPointerDown}
          onDoubleClick={personasH.reset}
          className="mt-2"
        />
        <div className="mt-1 px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Cases</div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {cases.map((c) => (
            <button
              key={c.caseId}
              onClick={() => openCase(c.caseId)}
              className={`w-full rounded-lg px-2.5 py-2 text-left text-[12px] transition ${active?.caseId === c.caseId ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50"}`}
            >
              <div className="truncate">{c.name}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">{c.status}</div>
            </button>
          ))}
        </div>
      </div>
      <Resizer
        orientation="vertical"
        onPointerDown={side.onPointerDown}
        onDoubleClick={side.reset}
      />

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {!active ? (
          <div className="flex h-full items-center justify-center text-[14px] text-zinc-600">
            Pick a persona to create a case — every fact becomes a commit.
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {/* adviser time-duel: elapsed from first commit to approval + counters */}
            {commits.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-1.5 text-[11px] text-zinc-500">
                <span>⏱ persona → approved:</span>
                <span className="font-mono text-zinc-300">
                  {(() => {
                    const first = commits[0]!;
                    const lastApproval = [...commits].reverse().find((c) => c.kind === "approval");
                    const end = lastApproval ?? commits.at(-1)!;
                    const ms = new Date(end.at).getTime() - new Date(first.at).getTime();
                    return lastApproval ? `${(ms / 1000).toFixed(0)}s` : `in progress (${(ms / 1000).toFixed(0)}s so far)`;
                  })()}
                </span>
                <span>·</span>
                <span>{commits.filter((c) => c.kind === "facts" || c.kind === "create").length} fact commits</span>
                <span>·</span>
                <span>{commits.reduce((n, c) => n + c.changes.length, 0)} facts changed</span>
                <span>·</span>
                <span className={gates.some((g) => g.status === "red") ? "text-red-400" : "text-emerald-500"}>
                  {gates.filter((g) => g.status === "red").length} red gates
                </span>
              </div>
            )}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-[20px] font-semibold text-zinc-100">{active.name}</h1>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-zinc-500">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${active.status === "approved" ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-800 text-zinc-400"}`}>{active.status}</span>
                  {chain && <span className={chain.ok ? "text-emerald-500" : "text-red-400"}>chain {chain.ok ? "✓ verified" : "✗ BROKEN"}</span>}
                  <span className="font-mono text-zinc-600">{active.caseId}</span>
                  {approval?.valid && approval.receipt && (
                    <a
                      href={`/client/${active.caseId}`}
                      target="_blank"
                      className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400 hover:underline"
                      title={approval.receipt.contentHash}
                    >
                      ✓ {approval.receipt.contentHash.slice(0, 12)} — client view →
                    </a>
                  )}
                  {approval && !approval.valid && approval.receipt && (
                    <span className="rounded bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                      approval revoked by fact change
                    </span>
                  )}
                  <a
                    href={`/api/case?op=export&caseId=${active.caseId}`}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                    title="evidence bundle (zip): receipt, evidence.csv, plan, gates, draft, commits"
                  >
                    ⇓ evidence.zip
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  className="w-28 rounded-lg border border-zinc-700 bg-transparent px-2 py-1.5 text-[12px] outline-none"
                  placeholder="adviser id"
                />
                <button
                  onClick={() => {
                    if (!active) return;
                    void fetch("/api/case", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ op: "approve", caseId: active.caseId, approver }),
                    })
                      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
                      .then(({ ok, d }) => {
                        if (!ok && (d as { error?: string }).error === "red_gates") {
                          alert("Red gates block approval — resolve or force via API with a reason.");
                        }
                        openCase(active.caseId);
                      });
                  }}
                  className="rounded-lg border border-emerald-700 px-3 py-1.5 text-[12px] text-emerald-400 transition hover:bg-emerald-500/10"
                >
                  approve
                </button>
                <button onClick={undo} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-[12px] text-zinc-400 transition hover:border-[#c9854a]/50 hover:text-[#c9854a]">
                  <RotateCcw size={13} /> undo
                </button>
              </div>
            </div>

            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Facts</h2>
            <div className="overflow-hidden rounded-xl border border-zinc-800">
              {Object.entries(active.facts).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 border-b border-zinc-800/60 px-3 py-1.5 font-mono text-[12px] last:border-0">
                  <span className="w-64 shrink-0 truncate text-zinc-500">{k}</span>
                  <span className="flex-1 text-zinc-200">{String(v.value)}</span>
                  {blameInfo[k]?.found && (
                    <span className="relative shrink-0">
                      <button
                        onClick={() => setOpenBlame(openBlame === k ? null : k)}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-[#c9854a]"
                        title="blame"
                      >
                        c{blameInfo[k]!.commitSeq} · {String(v.source ?? "")}
                      </button>
                      {openBlame === k && (
                        <span className="absolute right-0 top-full z-30 mt-1 block w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 text-left shadow-xl">
                          <span className="mb-1 block text-[11px] font-medium text-[#c9854a]">blame — {k}</span>
                          <span className="block text-[10.5px] leading-4 text-zinc-400">
                            value <b className="text-zinc-200">{String(v.value)}</b>
                            {(v as { asOf?: string }).asOf ? ` · as of ${(v as { asOf?: string }).asOf}` : ""}
                          </span>
                          <span className="mt-1 block text-[10px] text-zinc-500">
                            source: {String(v.source ?? "adviser-entered")} · commit #{blameInfo[k]!.commitSeq}
                          </span>
                          <span className="mt-0.5 block break-all font-mono text-[9.5px] text-zinc-600">
                            {blameInfo[k]!.commitHash}
                          </span>
                        </span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {gates.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  Gates {gates.filter((g) => g.status === "red").length} red · {gates.filter((g) => g.status === "amber").length} amber
                </h2>
                <div className="mb-4 grid gap-1.5 sm:grid-cols-2">
                  {gates.map((g) => (
                    <div key={g.id} className="rounded-lg border border-zinc-800 px-3 py-2">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className={`h-2 w-2 rounded-full ${g.status === "red" ? "bg-red-500" : g.status === "amber" ? "bg-amber-400" : "bg-emerald-500"}`} />
                        <span className="font-medium text-zinc-200">{g.name}</span>
                        <span className={`ml-auto text-[10px] uppercase ${g.status === "red" ? "text-red-400" : g.status === "amber" ? "text-amber-400" : "text-emerald-500"}`}>{g.status}</span>
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">{g.why.join(" · ")}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {draft && (
              <>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Draft (slot-filled, lint-checked)</h2>
                <pre className="whitespace-pre-wrap rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-[12px] leading-5 text-zinc-300">{draft}</pre>
              </>
            )}

            <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Commits</h2>
            <div className="space-y-1">
              {[...commits].reverse().map((c) => (
                <div key={c.seq} className="flex items-start gap-3 rounded-lg border border-zinc-800/70 px-3 py-2">
                  <GitCommitHorizontal size={14} className="mt-0.5 text-[#c9854a]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="font-mono text-zinc-300">#{c.seq}</span>
                      <span className="text-zinc-500">{c.kind}</span>
                      <span className="font-mono text-[10px] text-zinc-600">{c.hash}</span>
                      <span className="ml-auto text-[10px] text-zinc-600">{new Date(c.at).toLocaleTimeString()}</span>
                    </div>
                    {c.changes.length > 0 && (
                      <div className="mt-1 space-y-0.5 text-[11px]">
                        {c.changes.map((ch, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <code className="text-zinc-600">{ch.key}</code>
                            {ch.before !== undefined && (
                              <span className="text-red-400/70 line-through">{JSON.stringify(ch.before)}</span>
                            )}
                            <span className="text-zinc-600">→</span>
                            <span className={ch.after === undefined ? "text-red-400/70 line-through" : "text-emerald-400/80"}>
                              {ch.after === undefined ? "(removed)" : JSON.stringify(ch.after)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
