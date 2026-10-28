"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PolicyData {
  gates: { id: string; name: string }[];
  bannedPhrases: string[];
  assumptions: Record<string, unknown> | null;
  policySummary: Record<string, unknown>;
  customRules: { id: string; name: string; enabled: boolean; when: unknown; then: { status: string; message: string } }[];
  quarantine: { key: string; reason: string; at: string }[];
  universe: { schemeCode: string; amfiName: string; category: string; fields: string[] }[];
}
interface DryRow { persona: string; label: string; fires: boolean; wouldEmit: string }

export default function PolicyPage() {
  const [d, setD] = useState<PolicyData | null>(null);
  const [ruleJson, setRuleJson] = useState(`{
  "schema": "custom_rule_v1",
  "id": "retiree_equity_cap",
  "name": "Retiree equity cap",
  "when": { "field": "age", "op": ">=", "value": 60 },
  "then": { "status": "amber", "message": "Age 60+ plans: review equity share manually" },
  "enabled": false
}`);
  const [dry, setDry] = useState<{ rows?: DryRow[]; error?: string; enabled?: boolean; ms?: number } | null>(null);

  const load = () => void fetch("/api/policy").then((r) => r.json()).then(setD);
  useEffect(load, []);

  const toggleQuarantine = async (schemeCode: string, field: string, on: boolean) => {
    await fetch("/api/quarantine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemeCode, field, action: on ? "clear" : "set", reason: "source page missing (challenge)" }),
    });
    load();
  };

  const compileRule = async (enable: boolean) => {
    setDry(null);
    let rule: unknown;
    try {
      rule = JSON.parse(ruleJson);
    } catch {
      setDry({ error: "not valid JSON" });
      return;
    }
    const res = await fetch("/api/rules/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule, enable }),
    });
    const j = await res.json();
    setDry(res.ok ? { rows: j.table, enabled: j.enabled, ms: j.dryRunMs } : { error: j.detail ?? j.error });
    if (j.enabled) load();
  };

  if (!d) return <div className="p-8 text-zinc-500">loading…</div>;
  const qkeys = new Set(d.quarantine.map((q) => q.key));

  return (
    <div className="min-h-screen bg-[#0b0b0d] p-6 text-zinc-200">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Policy pack</h1>
            <p className="text-sm text-zinc-500">gates, thresholds, banned phrases, quarantine, custom rules</p>
          </div>
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← console</Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* gates */}
          <section className="rounded-xl border border-zinc-800 bg-[#0f0f11] p-4">
            <h2 className="mb-2 text-[13px] font-semibold">Gates ({d.gates.length} + custom)</h2>
            <ul className="space-y-1 text-[12px]">
              {d.gates.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <code className="w-44 text-zinc-500">{g.id}</code>
                  <span>{g.name}</span>
                </li>
              ))}
              {d.customRules.filter((r) => r.enabled).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <code className="w-44 text-zinc-500">custom_{r.id}</code>
                  <span>{r.name}</span>
                </li>
              ))}
            </ul>
            <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Banned phrases</h3>
            <div className="flex flex-wrap gap-1.5">
              {d.bannedPhrases.map((b) => (
                <span key={b} className="rounded-full border border-red-900/50 bg-red-950/30 px-2 py-0.5 text-[10.5px] text-red-300">{b}</span>
              ))}
            </div>
          </section>

          {/* assumptions */}
          <section className="rounded-xl border border-zinc-800 bg-[#0f0f11] p-4">
            <h2 className="mb-2 text-[13px] font-semibold">Assumptions (explicit, owner-tagged)</h2>
            <pre className="max-h-72 overflow-auto rounded bg-black/40 p-3 text-[10.5px] leading-4 text-zinc-400">
              {JSON.stringify(d.assumptions, null, 2)}
            </pre>
          </section>

          {/* quarantine */}
          <section className="rounded-xl border border-zinc-800 bg-[#0f0f11] p-4">
            <h2 className="mb-1 text-[13px] font-semibold">Missing-page challenge</h2>
            <p className="mb-3 text-[11px] text-zinc-500">
              Hide a source page → its field flips to <code>unavailable</code> everywhere (I2), never a substitute.
            </p>
            <div className="max-h-64 space-y-1 overflow-auto text-[11.5px]">
              {d.universe.flatMap((f) =>
                f.fields.map((fld) => {
                  const key = `${f.schemeCode}.${fld}`;
                  const flagged = qkeys.has(key);
                  return (
                    <div key={key} className="flex items-center justify-between rounded px-1.5 py-1 odd:bg-white/[0.02]">
                      <span className={flagged ? "text-amber-400 line-through" : "text-zinc-300"}>
                        {f.amfiName.split(" ").slice(0, 3).join(" ")} · <code>{fld}</code>
                      </span>
                      <button
                        onClick={() => void toggleQuarantine(f.schemeCode, fld, flagged)}
                        className={`rounded px-2 py-0.5 text-[10px] ${flagged ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
                      >
                        {flagged ? "quarantined — restore" : "hide page"}
                      </button>
                    </div>
                  );
                }),
              )}
            </div>
          </section>

          {/* rule compiler */}
          <section className="rounded-xl border border-zinc-800 bg-[#0f0f11] p-4">
            <h2 className="mb-1 text-[13px] font-semibold">Add a gate (rule compiler)</h2>
            <p className="mb-2 text-[11px] text-zinc-500">
              zod-validated DSL → dry-run on all 6 personas → enable only on your confirmation.
            </p>
            <textarea
              value={ruleJson}
              onChange={(e) => setRuleJson(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-zinc-800 bg-black/40 p-2 font-mono text-[11px] leading-4 outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button onClick={() => void compileRule(false)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[11.5px] hover:bg-zinc-700">
                validate + dry-run
              </button>
              <button onClick={() => void compileRule(true)} className="rounded-lg bg-[#c9854a] px-3 py-1.5 text-[11.5px] text-black">
                dry-run + enable
              </button>
            </div>
            {dry?.error && <p className="mt-2 text-[11.5px] text-red-400">{dry.error}</p>}
            {dry?.rows && (
              <table className="mt-3 w-full text-left text-[11px]">
                <thead>
                  <tr className="text-zinc-500"><th>persona</th><th>fires?</th><th>emits</th></tr>
                </thead>
                <tbody>
                  {dry.rows.map((r) => (
                    <tr key={r.persona} className="border-t border-zinc-800">
                      <td className="py-1 text-zinc-400">{r.persona}</td>
                      <td className={r.fires ? "text-amber-400" : "text-zinc-600"}>{r.fires ? "yes" : "no"}</td>
                      <td className="text-zinc-500">{r.wouldEmit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {dry?.enabled && <p className="mt-2 text-[11.5px] text-emerald-400">enabled — it now runs in every plan pipeline</p>}
            {dry?.ms !== undefined && <p className="mt-1 text-[10px] text-zinc-600">dry-run {dry.ms}ms</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
