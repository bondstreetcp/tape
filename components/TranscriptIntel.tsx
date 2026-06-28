"use client";
import { useState } from "react";

interface CallPoint {
  date: string | null;
  quarter: string;
  url: string;
  words: number;
  keyword: Record<string, number>;
  pos: number;
  neg: number;
  unc: number;
  tone: number;
}
interface Intel {
  available: boolean;
  symbol: string;
  keywords: string[];
  calls: CallPoint[];
  note?: string;
}

const DEFAULT = "AI, demand, pricing, margins, China, tariff, guidance, macro";

export default function TranscriptIntel({ symbol, name }: { symbol: string; name?: string }) {
  const [data, setData] = useState<Intel | "loading" | null>(null);
  const [kw, setKw] = useState(DEFAULT);

  const load = (keywords: string) => {
    setData("loading");
    const u = new URLSearchParams({ name: name || symbol, keywords });
    fetch(`/api/transcript-intel/${encodeURIComponent(symbol)}?${u.toString()}`)
      .then((r) => r.json())
      .then((d: Intel) => setData(d))
      .catch(() => setData(null));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[var(--text-2)]">Earnings-call intelligence</span>
          <span className="ml-2 text-[11px] text-[var(--text-4)]">theme mentions &amp; tone across recent calls</span>
        </div>
        {data == null && (
          <button onClick={() => load(kw)} className="shrink-0 text-xs text-[var(--accent)] hover:underline">
            Analyze recent calls
          </button>
        )}
      </div>

      {data === "loading" && (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">Reading the last several earnings calls… (a few seconds)</div>
      )}

      {data && data !== "loading" && (
        <div className="px-4 py-3">
          {!data.available || data.calls.length < 2 ? (
            <div className="text-xs text-[var(--text-3)]">{data.note || "Not enough transcripts to chart a trend."}</div>
          ) : (
            <>
              <form
                onSubmit={(e) => { e.preventDefault(); load(kw); }}
                className="mb-3 flex flex-wrap items-center gap-2"
              >
                <input
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  className="min-w-[220px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
                  placeholder="comma-separated themes, e.g. AI, pricing, China"
                />
                <button type="submit" className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--text-2)] hover:border-[var(--border-strong)]">
                  Update
                </button>
              </form>

              <ToneTrend calls={data.calls} />
              <KeywordHeatmap calls={data.calls} keywords={data.keywords} />
              <p className="mt-2 text-[10px] text-[var(--text-4)]">
                Tone = (positive − negative words) ÷ (positive + negative), finance-specific lexicon. Mentions are raw
                counts per call. Source: The Motley Fool transcripts.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToneTrend({ calls }: { calls: CallPoint[] }) {
  const H = 34;
  return (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-medium text-[var(--text-3)]">Management tone</div>
      <div className="flex items-end gap-2">
        {calls.map((c, i) => {
          const up = c.tone >= 0;
          const h = Math.max(2, Math.min(1, Math.abs(c.tone)) * H);
          return (
            <a key={i} href={c.url} target="_blank" rel="noreferrer" className="group flex flex-1 flex-col items-center" title={`tone ${c.tone.toFixed(2)} · ${c.pos} positive / ${c.neg} negative`}>
              <div className="flex h-[34px] w-full max-w-[42px] flex-col justify-end">
                <div className="flex flex-col justify-end" style={{ height: H }}>
                  <div className="w-full rounded-t" style={{ height: h, background: up ? "#22c55e" : "#ef4444" }} />
                </div>
              </div>
              <div className="mt-1 font-mono text-[10px] tabular-nums" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                {c.tone >= 0 ? "+" : ""}{c.tone.toFixed(2)}
              </div>
              <div className="mt-0.5 max-w-[52px] truncate text-[9px] text-[var(--text-4)] group-hover:text-[var(--text-3)]">{c.quarter}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function KeywordHeatmap({ calls, keywords }: { calls: CallPoint[]; keywords: string[] }) {
  const maxOf: Record<string, number> = {};
  for (const k of keywords) maxOf[k] = Math.max(1, ...calls.map((c) => c.keyword[k] || 0));
  return (
    <div className="overflow-x-auto">
      <div className="mb-1 text-[11px] font-medium text-[var(--text-3)]">Theme mentions per call</div>
      <table className="w-full min-w-[420px] border-collapse text-xs">
        <thead>
          <tr className="text-[var(--text-3)]">
            <th className="py-1 pr-2 text-left font-medium">Theme</th>
            {calls.map((c, i) => (
              <th key={i} className="px-1 py-1 text-center font-medium">
                <div className="text-[10px] text-[var(--text-2)]">{c.quarter}</div>
              </th>
            ))}
            <th className="pl-2 text-right font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((k) => {
            const first = calls[0]?.keyword[k] || 0;
            const last = calls[calls.length - 1]?.keyword[k] || 0;
            const arrow = last > first * 1.2 ? "↑" : last < first * 0.8 ? "↓" : "→";
            const ac = arrow === "↑" ? "#22c55e" : arrow === "↓" ? "#ef4444" : "var(--text-3)";
            return (
              <tr key={k} className="border-t border-[var(--divider)]">
                <td className="py-1 pr-2 text-left text-[var(--text-2)]">{k}</td>
                {calls.map((c, i) => {
                  const v = c.keyword[k] || 0;
                  const intensity = v / maxOf[k];
                  return (
                    <td key={i} className="px-1 py-1 text-center">
                      <span
                        className="inline-block min-w-[26px] rounded px-1 py-0.5 tabular-nums"
                        style={{
                          background: v ? `rgba(96,165,250,${0.12 + intensity * 0.5})` : "transparent",
                          color: v ? "var(--text)" : "var(--border-strong)",
                        }}
                      >
                        {v}
                      </span>
                    </td>
                  );
                })}
                <td className="pl-2 text-right font-semibold tabular-nums" style={{ color: ac }}>{arrow}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
