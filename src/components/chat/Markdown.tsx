"use client";

import React from "react";

/**
 * Minimal markdown: headings, bold, italic, inline code, code blocks,
 * lists, links, horizontal rules. No external deps (GIGO-safe).
 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  const out: React.ReactNode[] = [];
  blocks.forEach((block, bi) => {
    if (bi % 2 === 1) {
      // code block
      const firstNl = block.indexOf("\n");
      const code = firstNl >= 0 ? block.slice(firstNl + 1) : block;
      out.push(
        <pre key={bi} className="my-3 overflow-x-auto rounded-lg bg-black/50 p-3 text-[12px] leading-5">
          <code>{code.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }
    const lines = block.split("\n");
    let list: string[] | null = null;
    const flushList = (key: string) => {
      if (list?.length) {
        out.push(
          <ul key={key} className="my-2 list-disc space-y-1 pl-6">
            {list.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ul>,
        );
      }
      list = null;
    };
    lines.forEach((line, li) => {
      const key = `${bi}-${li}`;
      const h = /^(#{1,4})\s+(.*)/.exec(line);
      const liM = /^\s*[-*•]\s+(.*)/.exec(line);
      const num = /^\s*\d+[.)]\s+(.*)/.exec(line);
      if (liM || num) {
        (list ??= []).push((liM ?? num)![1]!);
        return;
      }
      flushList(key);
      if (h) {
        const level = h[1]!.length;
        const Tag = (`h${Math.min(level + 1, 4)}`) as "h2";
        out.push(
          <Tag key={key} className="mb-1 mt-4 font-semibold text-zinc-100 first:mt-0">
            {inline(h[2]!)}
          </Tag>,
        );
      } else if (/^\s*---+\s*$/.test(line)) {
        out.push(<hr key={key} className="my-3 border-zinc-800" />);
      } else if (line.trim()) {
        out.push(
          <p key={key} className="my-2 leading-7">
            {inline(line)}
          </p>,
        );
      }
    });
    flushList(`${bi}-end`);
  });
  return <div className="text-[15px] text-zinc-200">{out}</div>;
}

function inline(text: string): React.ReactNode {
  // **bold** *italic* `code` [link](url)
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={k++} className="font-semibold text-zinc-100">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      parts.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={k++} className="rounded bg-zinc-800 px-1 py-0.5 text-[13px] text-amber-200/90">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      parts.push(
        <a key={k++} href={lm[2]} target="_blank" rel="noreferrer" className="text-[#c9854a] underline decoration-[#c9854a]/40 underline-offset-2">
          {lm[1]}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
