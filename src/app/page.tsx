"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, PanelRight, Send, Square, Trash2 } from "lucide-react";
import { useChatStream } from "@/components/chat/useChatStream";
import { Markdown } from "@/components/chat/Markdown";
import { SourceChips } from "@/components/chat/SourceChips";
import { StepsTimeline } from "@/components/chat/StepsTimeline";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { Workbench } from "@/components/workbench/Workbench";

const LS_SESSION = "pramaan:session";
const LS_MODEL = "pramaan:model";

export default function Page() {
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"chat" | "research">("chat");
  const [modelKey, setModelKey] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(true);
  const [history, setHistory] = useState<{ role: string; content: string; bridge: string | null }[]>([]);
  const { turns, busy, send, stop, clear, filesVersion } = useChatStream();
  const bottomRef = useRef<HTMLDivElement>(null);

  // init session + persisted model
  useEffect(() => {
    let sid = localStorage.getItem(LS_SESSION);
    if (!sid) {
      sid = `s-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(LS_SESSION, sid);
    }
    void Promise.resolve().then(() => {
      setSessionId(sid);
      setModelKey(localStorage.getItem(LS_MODEL) ?? "");
    });
    void fetch(`/api/chat?sessionId=${sid}`)
      .then((r) => r.json())
      .then((d: { messages: { role: string; content: string; bridge: string | null }[] }) =>
        setHistory(d.messages),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const onModel = useCallback((k: string) => {
    setModelKey(k);
    localStorage.setItem(LS_MODEL, k);
  }, []);

  const submit = () => {
    const msg = input.trim();
    if (!msg || busy || !sessionId) return;
    setInput("");
    setHistory([]);
    void send({ sessionId, message: msg, mode, modelKey: modelKey || undefined });
  };

  const newChat = () => {
    const sid = `s-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LS_SESSION, sid);
    setSessionId(sid);
    setHistory([]);
    clear();
  };

  const lastTurn = turns.at(-1);
  const changedThisTurn = lastTurn?.fileChanges ?? [];

  return (
    <div className="flex h-dvh bg-[#0a0a0b] text-zinc-200">
      {/* left rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-zinc-800 bg-[#0d0d0f] transition-transform md:static md:translate-x-0 ${railOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="font-serif text-[22px] italic text-zinc-100">Pramaan</span>
          <span className="rounded bg-[#c9854a]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#c9854a]">
            Plan PR
          </span>
        </div>
        <button
          onClick={newChat}
          className="mx-3 mb-3 rounded-lg border border-zinc-700 px-3 py-2 text-[13px] text-zinc-300 transition hover:border-[#c9854a]/60 hover:text-[#c9854a]"
        >
          + New chat
        </button>
        <nav className="flex-1 space-y-1 px-3 text-[13px]">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Workspace
          </div>
          <RailItem label="Research chat" active />
          <RailItem label="Plan PR review" badge="phase 80" />
          <RailItem label="Policies" badge="phase 90" />
          <div className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Session
          </div>
          <div className="truncate px-1 font-mono text-[11px] text-zinc-600">{sessionId}</div>
        </nav>
        <div className="border-t border-zinc-800 p-3 text-[10px] leading-4 text-zinc-600">
          Synthetic demo data only.
          <br />
          No client-facing output without adviser approval.
        </div>
      </aside>
      {railOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setRailOpen(false)} />
      )}

      {/* center */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <button onClick={() => setRailOpen(true)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 md:hidden">
            <Menu size={16} />
          </button>
          <div className="flex rounded-full border border-zinc-800 p-0.5 text-[12px]">
            {(["chat", "research"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 transition ${mode === m ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {m === "chat" ? "Chat" : "Research"}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ModelPicker value={modelKey} onChange={onModel} />
            <button
              onClick={() => setBenchOpen(!benchOpen)}
              className={`hidden rounded p-1.5 transition md:block ${benchOpen ? "text-[#c9854a]" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <PanelRight size={16} />
            </button>
          </div>
        </div>

        {/* messages */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6">
            {history.length === 0 && turns.length === 0 && (
              <EmptyState onPick={(m) => setInput(m)} />
            )}
            {history.map((m, i) => (
              <div key={i} className="mb-6">
                {m.role === "user" ? (
                  <div className="mb-1 text-[13px] font-medium text-[#c9854a]">You</div>
                ) : (
                  <div className="mb-1 text-[13px] font-medium text-zinc-500">Pramaan</div>
                )}
                <Markdown text={m.content} />
                {m.bridge && (
                  <div className="mt-2 rounded-lg border border-[#c9854a]/20 bg-[#c9854a]/5 px-3 py-2 text-[12px] text-zinc-400">
                    ↪ {m.bridge}
                  </div>
                )}
              </div>
            ))}
            {turns.map((t) => (
              <TurnView key={t.id} turn={t} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* input */}
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-zinc-700 bg-[#131316] p-2 focus-within:border-[#c9854a]/50">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Ask anything — typos fine, Hinglish fine…"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none placeholder:text-zinc-600"
            />
            {busy ? (
              <button onClick={stop} className="rounded-xl bg-zinc-800 p-2 text-zinc-300" title="stop">
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!input.trim()}
                className="rounded-xl bg-[#c9854a] p-2 text-black transition disabled:opacity-40"
                title="send"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </main>

      {/* workbench */}
      {benchOpen && (
        <aside className="hidden w-[340px] shrink-0 border-l border-zinc-800 bg-[#0d0d0f] md:block">
          <Workbench
            sessionId={sessionId}
            filesVersion={filesVersion}
            changedThisTurn={changedThisTurn}
          />
        </aside>
      )}
      {/* mobile workbench sheet */}
      <div className="fixed inset-x-0 bottom-0 z-40 max-h-[45dvh] border-t border-zinc-800 bg-[#0d0d0f] md:hidden">
        <MobileBench sessionId={sessionId} filesVersion={filesVersion} changed={changedThisTurn} />
      </div>
    </div>
  );
}

function RailItem({ label, active, badge }: { label: string; active?: boolean; badge?: string }) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${active ? "bg-zinc-800/70 text-zinc-100" : "text-zinc-500"}`}
    >
      <span>{label}</span>
      {badge && (
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-600">
          {badge}
        </span>
      )}
    </div>
  );
}

function TurnView({ turn }: { turn: import("@/components/chat/useChatStream").Turn }) {
  const live = !turn.done;
  return (
    <div className="mb-8">
      <div className="mb-1 text-[13px] font-medium text-[#c9854a]">You</div>
      <p className="mb-4 text-[15px] leading-7 text-zinc-200">{turn.userText}</p>
      <div className="mb-1 text-[13px] font-medium text-zinc-500">Pramaan</div>
      {turn.steps.length > 1 || turn.toolCalls.length > 0 ? (
        <StepsTimeline steps={turn.steps} toolCalls={turn.toolCalls} live={live} />
      ) : null}
      {turn.error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-[13px] text-red-300">
          {turn.error}
        </div>
      ) : (
        <>
          <Markdown text={turn.text} />
          {live && !turn.text && (
            <span className="inline-block h-4 w-2 animate-pulse bg-[#c9854a]/70" />
          )}
          {live && turn.text && <span className="inline-block h-3.5 w-1.5 animate-pulse bg-zinc-500" />}
        </>
      )}
      <SourceChips sources={turn.sources} cited={turn.cited.length ? turn.cited : turn.sources.map((s) => s.n)} />
      {turn.bridge && turn.done && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#c9854a]/20 bg-[#c9854a]/5 px-3 py-2 text-[12.5px] text-zinc-400">
          <span className="text-[#c9854a]">↪</span>
          <span>{turn.bridge}</span>
        </div>
      )}
      {turn.telemetry && turn.done && (
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-zinc-600">
          <span>{turn.telemetry.provider}/{turn.telemetry.model}</span>
          <span>ttft {turn.telemetry.ttftMs}ms</span>
          <span>{turn.telemetry.tokensOut} tok</span>
          {turn.telemetry.hedged && <span>hedged</span>}
          {turn.telemetry.retries > 0 && <span>{turn.telemetry.retries} retries</span>}
        </div>
      )}
    </div>
  );
}

function MobileBench({
  sessionId,
  filesVersion,
  changed,
}: {
  sessionId: string;
  filesVersion: number;
  changed: import("@/components/chat/useChatStream").FileChangeEv[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2 text-[12px] text-zinc-400"
      >
        <span>Workbench {changed.length ? `· ${changed.length} changed` : ""}</span>
        <span>{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className="max-h-[38dvh] overflow-hidden">
          <Workbench sessionId={sessionId} filesVersion={filesVersion} changedThisTurn={changed} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (m: string) => void }) {
  const examples = [
    "mutal fnd direct vs regulr diff kya hai",
    "SEBI RIA fee rules — latest position",
    "save a 3-row csv of large, mid, small cap fund examples",
    "explain SIP vs lumpsum for a 23-year-old",
  ];
  return (
    <div className="py-16 text-center">
      <div className="font-serif text-[34px] italic text-zinc-300">Pramaan</div>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-zinc-500">
        Research copilot inside Plan PR — cited answers, a live workbench, and a
        plan-review layer on top. Try:
      </p>
      <div className="mx-auto mt-6 grid max-w-lg gap-2">
        {examples.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e)}
            className="rounded-xl border border-zinc-800 px-4 py-2.5 text-left text-[13px] text-zinc-400 transition hover:border-[#c9854a]/40 hover:text-zinc-200"
          >
            {e}
          </button>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-zinc-600">
        <Trash2 size={11} /> nothing is real client data — everything is synthetic
      </div>
    </div>
  );
}
