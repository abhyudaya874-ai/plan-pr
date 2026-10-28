"use client";

import { useState } from "react";

const STR = {
  en: {
    approvedBy: "Approved by",
    fingerprint: "fingerprint",
    disclosure:
      "Direct plans only. AI-assisted draft reviewed by a SEBI-registered Investment Adviser. Illustrative projections, not a return guarantee. Approval ≠ client trade consent; no execution in this app.",
    trace:
      "Every figure in this document traces to a verified field or deterministic calculation. Approval is adviser plan sign-off — not trade consent.",
    teach: "Teach-back — did this plan land?",
    teachQs: [
      "What are the two biggest actions in this plan?",
      "What happens to this plan if your facts change?",
      "Who approved this document and what does that approval NOT cover?",
    ],
    langBtn: "हिंदी",
  },
  hi: {
    approvedBy: "स्वीकृत",
    fingerprint: "फ़िंगरप्रिंट",
    disclosure:
      "केवल डायरेक्ट प्लान। SEBI-पंजीकृत निवेश सलाहकार द्वारा समीक्षित AI-सहायता से बना मसौदा। अनुमानित प्रोजेक्शन, रिटर्न की गारंटी नहीं। स्वीकृति ≠ ट्रेड की सहमति; इस ऐप में कोई निष्पादन नहीं।",
    trace:
      "इस दस्तावेज़ का हर आंकड़ा किसी सत्यापित फ़ील्ड या निर्धारित गणना से जुड़ा है। स्वीकृति सलाहकार की योजना-स्वीकृति है — ट्रेड की सहमति नहीं।",
    teach: "समझने की जाँच — क्या यह योजना समझ आई?",
    teachQs: [
      "इस योजना में सबसे बड़ी दो कार्रवाइयाँ क्या हैं?",
      "यदि आपके तथ्य बदलें तो इस योजना का क्या होगा?",
      "यह दस्तावेज़ किसने स्वीकृत किया और इस स्वीकृति में क्या शामिल नहीं है?",
    ],
    langBtn: "English",
  },
} as const;

export function ClientView({
  draft,
  receipt,
}: {
  draft: string;
  receipt: { approvedBy: string; at: string; contentHash: string };
}) {
  const [lang, setLang] = useState<"en" | "hi">("en");
  const s = STR[lang];
  return (
    <>
      <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-[12px] text-emerald-800">
        <span>
          {s.approvedBy} {receipt.approvedBy} · {new Date(receipt.at).toLocaleString()} ·{" "}
          {s.fingerprint} <code className="font-mono">{receipt.contentHash.slice(0, 16)}</code>
        </span>
        <button
          onClick={() => setLang(lang === "en" ? "hi" : "en")}
          className="rounded border border-emerald-400 px-2 py-0.5 text-[11px] hover:bg-emerald-100"
        >
          {s.langBtn}
        </button>
      </div>
      <article className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        {/* draft numbers are slot-locked; the language toggle swaps chrome only */}
        <pre className="whitespace-pre-wrap font-sans text-[14px] leading-7 text-zinc-800">{draft}</pre>
      </article>
      <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 text-[12px] font-semibold text-zinc-700">{s.teach}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-zinc-600">
          {s.teachQs.map((q, i) => (
            <li key={i}>{q} <span className="text-[10px] uppercase text-zinc-400">(informational — not consent)</span></li>
          ))}
        </ol>
      </section>
      <p className="mt-4 text-[11px] leading-5 text-zinc-500">{s.disclosure}</p>
      <p className="mt-2 text-[11px] text-zinc-400">{s.trace}</p>
    </>
  );
}
