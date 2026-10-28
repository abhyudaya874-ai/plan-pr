"use client";

import { useRef, useState } from "react";

export default function DevChat() {
  const [msg, setMsg] = useState("whts 2+2");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [modelKey, setModelKey] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef("");

  async function send() {
    if (!sessionRef.current) {
      sessionRef.current = `dev-${Math.random().toString(36).slice(2, 10)}`;
    }
    setBusy(true);
    setLog((l) => [...l, `>>> ${msg}`]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionRef.current,
          message: msg,
          mode: "chat",
          ...(modelKey ? { modelKey } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setLog((l) => [...l, `HTTP ${res.status}`]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of raw.split("\n")) {
            if (line.startsWith("data:")) {
              setLog((l) => [...l, line.slice(5).trim()]);
            }
          }
        }
      }
    } catch (e) {
      setLog((l) => [...l, `ABORTED/ERR ${String(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-6 font-mono text-xs">
      <h1 className="text-base font-bold">/dev/chat — raw SSE</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && void send()}
        />
        <input
          className="w-48 rounded border border-zinc-700 bg-transparent px-2 py-1"
          value={modelKey}
          onChange={(e) => setModelKey(e.target.value)}
          placeholder="modelKey (optional)"
        />
        <button
          className="rounded bg-white px-3 py-1 text-black disabled:opacity-50"
          onClick={() => void send()}
          disabled={busy}
        >
          send
        </button>
        <button
          className="rounded border border-zinc-700 px-3 py-1"
          onClick={() => abortRef.current?.abort()}
          disabled={!busy}
        >
          stop
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded border border-zinc-800 p-3 leading-5">
        {log.join("\n")}
      </pre>
    </main>
  );
}
