"use client";

import { useMemo, type ReactNode } from "react";

/**
 * Lightweight markdown renderer for chat bubbles — supports headings, bold,
 * italic, inline code, code fences, bullet/numbered lists, tables, and
 * blockquotes. Deliberately dependency-free to keep the chat bundle small.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key} className="rounded bg-black/[0.06] dark:bg-white/10 px-1 py-0.5 text-[0.85em] font-mono">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const link = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      nodes.push(
        <a key={key} href={link?.[2] ?? "#"} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {link?.[1] ?? token}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const lines = (content ?? "").replace(/\r\n/g, "\n").split("\n");
    const out: ReactNode[] = [];
    let i = 0;
    let key = 0;

    const flushTable = (): ReactNode | null => {
      // gather | a | b | rows starting at i
      const rows: string[][] = [];
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        const cells = lines[j].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        j++;
      }
      if (rows.length < 1) return null;
      const [head, ...body] = rows;
      const node = (
        <div key={`t${key++}`} className="my-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr>{head.map((h, hi) => <th key={hi} className="px-2.5 py-1.5 text-left font-semibold">{renderInline(h, `th${hi}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((c, ci) => <td key={ci} className="px-2.5 py-1.5 tabular-nums">{renderInline(c, `td${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j;
      return node;
    };

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*\|.*\|\s*$/.test(line)) {
        const node = flushTable();
        if (node) {
          out.push(node);
          continue;
        }
      }
      if (/^\s*```/.test(line)) {
        const code: string[] = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++; // closing fence
        out.push(
          <pre key={`c${key++}`} className="my-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100">
            <code>{code.join("\n")}</code>
          </pre>,
        );
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        out.push(
          <p key={`h${key++}`} className="mt-3 mb-1 text-sm font-semibold first:mt-0">
            {renderInline(h[2], `hh${key}`)}
          </p>,
        );
        i++;
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote: string[] = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push(
          <blockquote key={`q${key++}`} className="my-2 border-l-2 border-current/25 pl-3 italic opacity-90">
            {renderInline(quote.join(" "), `qq${key}`)}
          </blockquote>,
        );
        continue;
      }
      if (/^\s*[-*•]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
        out.push(
          <ul key={`u${key++}`} className="my-1.5 list-disc space-y-1 pl-5">
            {items.map((it, ii) => <li key={ii}>{renderInline(it, `ul${key}-${ii}`)}</li>)}
          </ul>,
        );
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
        out.push(
          <ol key={`o${key++}`} className="my-1.5 list-decimal space-y-1 pl-5">
            {items.map((it, ii) => <li key={ii}>{renderInline(it, `ol${key}-${ii}`)}</li>)}
          </ol>,
        );
        continue;
      }
      if (!line.trim()) {
        i++;
        continue;
      }
      // paragraph — merge consecutive plain lines
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*([-*•]\s|\d+[.)]\s|#{1,4}\s|>|\||```)/.test(lines[i])
      ) {
        para.push(lines[i++]);
      }
      out.push(
        <p key={`p${key++}`} className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0">
          {renderInline(para.join("\n"), `pp${key}`)}
        </p>,
      );
    }
    return out;
  }, [content]);

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
