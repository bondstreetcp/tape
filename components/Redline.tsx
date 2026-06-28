"use client";
import { useState } from "react";

type Block = { type: "add" | "del"; text: string } | { type: "gap"; count: number };
interface Redline {
  available: boolean;
  section: string;
  fromDate: string | null;
  toDate: string | null;
  fromUrl: string | null;
  toUrl: string | null;
  added: number;
  removed: number;
  reworded: number;
  blocks: Block[];
  note?: string;
}

const yr = (d: string | null) => (d ? d.slice(0, 4) : "—");

export default function RedlineSection({ symbol }: { symbol: string; name?: string }) {
  const [data, setData] = useState<Redline | "loading" | null>(null);
  const [form, setForm] = useState<"10-K" | "10-Q">("10-K");

  const load = (f: "10-K" | "10-Q") => {
    setForm(f);
    setData("loading");
    fetch(`/api/redline/${encodeURIComponent(symbol)}?form=${f}`)
      .then((r) => r.json())
      .then((d: Redline) => setData(d))
      .catch(() => setData(null));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[var(--text-2)]">Risk Factors — what changed</span>
          <span className="ml-2 text-[11px] text-[var(--text-4)]">{form === "10-Q" ? "quarter over quarter" : "year over year"}</span>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5" title="Compare the two most recent filings of this type">
          {(["10-K", "10-Q"] as const).map((f) => (
            <button
              key={f}
              onClick={() => load(f)}
              className={"rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors " + (data !== null && form === f ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {data == null && (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">Pick <b>10-K</b> (annual) or <b>10-Q</b> (quarterly) to diff the Risk Factors of the two most recent filings.</div>
      )}
      {data === "loading" && (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">Diffing the two most recent {form} filings… (a few seconds)</div>
      )}

      {data && data !== "loading" && (
        <div className="px-4 py-3">
          {data.available ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-semibold text-[var(--text)]">{form === "10-Q" ? `${data.fromDate} → ${data.toDate}` : `FY${yr(data.fromDate)} → FY${yr(data.toDate)}`}</span>
                <span><b className="text-[#22c55e]">+{data.added}</b> <span className="text-[var(--text-3)]">new</span></span>
                <span><b className="text-[#ef4444]">−{data.removed}</b> <span className="text-[var(--text-3)]">removed</span></span>
                <span className="text-[var(--text-3)]">~{data.reworded} reworded</span>
                <span className="ml-auto text-[11px]">
                  <a href={data.fromUrl ?? "#"} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">old ↗</a>
                  {" · "}
                  <a href={data.toUrl ?? "#"} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">new ↗</a>
                </span>
              </div>
              {data.note && <div className="mb-2 text-[11px] text-[var(--text-4)]">{data.note}</div>}
              {data.added === 0 && data.removed === 0 ? (
                <div className="py-3 text-xs text-[var(--text-3)]">No substantive additions or removals — only reworded language.</div>
              ) : (
                <div className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
                  {data.blocks.map((b, i) =>
                    b.type === "gap" ? (
                      <div key={i} className="py-1 text-center text-[10px] text-[var(--border-strong)]">⋯ {b.count} unchanged ⋯</div>
                    ) : (
                      <div
                        key={i}
                        className={
                          "rounded border-l-2 px-2 py-1 text-[13px] leading-relaxed " +
                          (b.type === "add"
                            ? "border-[#22c55e] bg-[#0e1f15] text-[#bbf7d0]"
                            : "border-[#ef4444] bg-[#1f1113] text-[#fca5a5] line-through decoration-[#7f1d1d]")
                        }
                      >
                        {b.text}
                      </div>
                    ),
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-[var(--text-3)]">
              {data.note || "Couldn't generate a redline."}
              {(data.fromUrl || data.toUrl) && (
                <div className="mt-2">
                  {data.fromUrl && (
                    <a href={data.fromUrl} target="_blank" rel="noreferrer" className="mr-3 text-[var(--accent)] hover:underline">
                      Older {form}{data.fromDate ? ` (${data.fromDate})` : ""} ↗
                    </a>
                  )}
                  {data.toUrl && (
                    <a href={data.toUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                      Newer {form}{data.toDate ? ` (${data.toDate})` : ""} ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
