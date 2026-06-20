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

  const load = () => {
    if (data === "loading") return;
    setData("loading");
    fetch(`/api/redline/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d: Redline) => setData(d))
      .catch(() => setData(null));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722]">
      <div className="flex items-center justify-between gap-3 border-b border-[#2a2e39] px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[#aab2c5]">10-K Risk Factors — what changed</span>
          <span className="ml-2 text-[11px] text-[#5b6478]">year-over-year redline</span>
        </div>
        {data == null && (
          <button onClick={load} className="shrink-0 text-xs text-[#60a5fa] hover:underline">
            Compare latest two 10-Ks
          </button>
        )}
      </div>

      {data === "loading" && (
        <div className="px-4 py-4 text-xs text-[#8b93a7]">Diffing the two most recent annual reports… (a few seconds)</div>
      )}

      {data && data !== "loading" && (
        <div className="px-4 py-3">
          {data.available ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-semibold text-[#e6e9f0]">FY{yr(data.fromDate)} → FY{yr(data.toDate)}</span>
                <span><b className="text-[#22c55e]">+{data.added}</b> <span className="text-[#8b93a7]">new</span></span>
                <span><b className="text-[#ef4444]">−{data.removed}</b> <span className="text-[#8b93a7]">removed</span></span>
                <span className="text-[#8b93a7]">~{data.reworded} reworded</span>
                <span className="ml-auto text-[11px]">
                  <a href={data.fromUrl ?? "#"} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">old ↗</a>
                  {" · "}
                  <a href={data.toUrl ?? "#"} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">new ↗</a>
                </span>
              </div>
              {data.note && <div className="mb-2 text-[11px] text-[#5b6478]">{data.note}</div>}
              {data.added === 0 && data.removed === 0 ? (
                <div className="py-3 text-xs text-[#8b93a7]">No substantive additions or removals — only reworded language.</div>
              ) : (
                <div className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
                  {data.blocks.map((b, i) =>
                    b.type === "gap" ? (
                      <div key={i} className="py-1 text-center text-[10px] text-[#3a4150]">⋯ {b.count} unchanged ⋯</div>
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
            <div className="text-xs text-[#8b93a7]">
              {data.note || "Couldn't generate a redline."}
              {(data.fromUrl || data.toUrl) && (
                <div className="mt-2">
                  {data.fromUrl && (
                    <a href={data.fromUrl} target="_blank" rel="noreferrer" className="mr-3 text-[#60a5fa] hover:underline">
                      Older 10-K{data.fromDate ? ` (${data.fromDate})` : ""} ↗
                    </a>
                  )}
                  {data.toUrl && (
                    <a href={data.toUrl} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">
                      Newer 10-K{data.toDate ? ` (${data.toDate})` : ""} ↗
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
