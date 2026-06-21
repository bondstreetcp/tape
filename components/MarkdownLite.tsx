import React from "react";

// Minimal markdown renderer for AI answers — headers, **bold**, `code`, and bullet
// lists. Deliberately tiny (no dependency); the model's output is simple markdown.
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold text-[var(--text)]">{m[1]}</strong>);
    else if (m[2] != null) out.push(<code key={`${keyBase}-${i++}`} className="rounded bg-[var(--surface-3)] px-1 py-0.5 font-mono text-[12px]">{m[2]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl <= 2 ? "mb-1 mt-3 text-sm font-bold text-[var(--text)] first:mt-0" : "mb-0.5 mt-2 text-[13px] font-semibold text-[var(--text)] first:mt-0";
      blocks.push(<div key={key} className={cls}>{inline(h[2], `h${key}`)}</div>);
      key++; i++; continue;
    }

    if (/^[-*•]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key} className="my-1 ml-4 list-disc space-y-0.5">
          {items.map((it, j) => <li key={j}>{inline(it, `l${key}-${j}`)}</li>)}
        </ul>,
      );
      key++; continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (!lt || /^(#{1,4})\s/.test(lt) || /^[-*•]\s/.test(lt)) break;
      para.push(lt);
      i++;
    }
    blocks.push(<p key={key} className="my-1 leading-relaxed first:mt-0">{inline(para.join(" "), `p${key}`)}</p>);
    key++;
  }
  return <div>{blocks}</div>;
}
