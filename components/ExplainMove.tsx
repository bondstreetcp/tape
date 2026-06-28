"use client";
import { useEffect, useState } from "react";
import type { Returns } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import MarkdownLite from "./MarkdownLite";

const fmtMove = (r: number | null) => (r == null ? null : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`);

// Per-timeframe phrasing: the button verb, the prompt's window phrase, and whether
// it's a "long" window (→ ask about trajectory/re-rating, not a single-day catalyst).
const W: Record<TimeframeKey, { btn: string; phrase: string; long: boolean }> = {
  "1d": { btn: "today's move", phrase: "today", long: false },
  "1w": { btn: "this week's move", phrase: "over the past week", long: false },
  "3m": { btn: "the 3-month move", phrase: "over the past 3 months", long: false },
  "6m": { btn: "the 6-month move", phrase: "over the past 6 months", long: true },
  ytd: { btn: "the year-to-date move", phrase: "year-to-date", long: true },
  "1y": { btn: "the 1-year move", phrase: "over the past year", long: true },
  "3y": { btn: "the 3-year move", phrase: "over the past 3 years", long: true },
  "5y": { btn: "the 5-year move", phrase: "over the past 5 years", long: true },
};

export default function ExplainMove({ symbol, name, returns, tf = "3m" }: { symbol: string; name: string; returns: Returns; tf?: TimeframeKey }) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const win = W[tf] ?? W["3m"];

  // The explanation is window-specific — reset it when the chart timeframe changes so
  // a 1Y answer never lingers under a 6M chart.
  useEffect(() => { setAnswer(null); setError(null); setLoading(false); }, [tf]);

  const run = () => {
    if (loading) return;
    setLoading(true); setError(null); setAnswer(null);
    const sel = fmtMove(returns?.[tf] ?? null);
    const selPhrase = sel ? `${sel} ${win.phrase}` : `roughly flat ${win.phrase}`;
    // Short-term context for longer windows — "what's happening right now" on top of the period move.
    const ctxParts: string[] = [];
    if (tf !== "1d" && tf !== "1w") {
      const d1 = fmtMove(returns?.["1d"] ?? null); if (d1) ctxParts.push(`${d1} today`);
      const w1 = fmtMove(returns?.["1w"] ?? null); if (w1) ctxParts.push(`${w1} this past week`);
    }
    const ctx = ctxParts.length ? ` (recently ${ctxParts.join(", ")})` : "";
    const drivers = win.long
      ? "the earnings & revenue trajectory, margin trend, any multiple re-rating, the secular/thematic narrative, major analyst-view shifts, and notable M&A or regulatory events"
      : "earnings or guidance, analyst rating/price-target changes, product/regulatory/legal news, or M&A";
    const q =
      `Explain what's driven ${name}'s (${symbol}) share price ${win.phrase}: it's ${selPhrase}${ctx}. ` +
      `Identify the main drivers over THIS specific period — ${drivers} — and how much is simply sector/market beta versus company-specific. ` +
      `Cite specific dated developments. If over this window the stock mostly tracked its sector or the broad market rather than anything idiosyncratic, say so plainly` +
      (win.long ? " and note where it now sits in its longer-term trend." : ".");
    fetch(`/api/ask/${encodeURIComponent(symbol)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, name, history: [] }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLoading(false);
        if (d.configured === false) setError("Add a GEMINI_API_KEY to enable this.");
        else if (d.answer) { setAnswer(d.answer); setSources(d.sources || []); }
        else setError(d.error || "Couldn't explain the move.");
      })
      .catch(() => { setLoading(false); setError("Something went wrong reaching the AI."); });
  };

  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {!answer && !loading && !error && (
        <button onClick={run} className="flex items-center gap-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)]">
          <span className="text-base">🔍</span> Explain {win.btn}
          <span className="text-[11px] font-normal text-[var(--text-4)]">— AI reads the news over this window &amp; ties it to the price</span>
        </button>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Reading what drove {name} {win.phrase} and tying it to the price action…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#ef4444]">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-[var(--text-4)] hover:text-[var(--text)]">✕</button>
        </div>
      )}
      {answer && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-2)]">What drove {symbol} {win.phrase}</span>
            <button onClick={run} className="text-[11px] text-[var(--text-4)] hover:text-[var(--text)]">↻ refresh</button>
          </div>
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]">
            <MarkdownLite text={answer} />
          </div>
          {sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sources.map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noreferrer" title={s.title} className="max-w-[220px] truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--accent)] hover:border-[var(--border-strong)]">{s.title} ↗</a>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">AI-generated from current news &amp; web search · not investment advice.</p>
        </div>
      )}
    </section>
  );
}
