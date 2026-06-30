"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { BuzzRow } from "@/lib/apewisdom";

const pctCol = (v: number | null) => (v == null ? "var(--text-4)" : v >= 0 ? "#22c55e" : "#ef4444");
const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`);
type Sort = "mentions" | "surge" | "climbers";
const SORTS: { key: Sort; label: string; hint: string }[] = [
  { key: "mentions", label: "Most mentioned", hint: "raw 24h Reddit mention count" },
  { key: "surge", label: "Surging", hint: "biggest % jump in mentions vs 24h ago" },
  { key: "climbers", label: "Climbing", hint: "biggest jump up the leaderboard vs 24h ago" },
];

export default function RedditBuzzView({ rows, universe, asOf }: { rows: BuzzRow[]; universe: string; asOf: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [sort, setSort] = useState<Sort>("mentions");
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    const f = q.trim().toUpperCase();
    let r = f ? rows.filter((x) => x.ticker.includes(f) || x.name.toUpperCase().includes(f)) : rows;
    r = [...r].sort((a, b) =>
      sort === "surge" ? (b.mentionChangePct ?? -1e9) - (a.mentionChangePct ?? -1e9)
        : sort === "climbers" ? (b.rankChange ?? -1e9) - (a.rankChange ?? -1e9)
          : b.mentions - a.mentions);
    return r.slice(0, 200);
  }, [rows, sort, q]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader title="Reddit Buzz" desc="What retail is talking about — mention counts across r/wallstreetbets, r/stocks, r/investing and more (via ApeWisdom). This is ATTENTION, not sentiment: a high or fast-rising count means the crowd is watching, not that they're bullish. Decision-support, not advice." />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {SORTS.map((s) => <button key={s.key} title={s.hint} onClick={() => setSort(s.key)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (sort === s.key ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{s.label}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter name / ticker…" className="w-52 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Company</th>
              <th className="px-3 py-2 text-right font-medium" title="Reddit mentions, trailing 24h">Mentions</th>
              <th className="px-3 py-2 text-right font-medium" title="Change in mentions vs 24h ago">24h Δ</th>
              <th className="px-3 py-2 text-right font-medium" title="Rank change vs 24h ago (↑ = climbing)">Rank Δ</th>
              <th className="px-3 py-2 text-right font-medium" title="Upvotes on those mentions">Upvotes</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.ticker} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2 tabular-nums text-[var(--text-4)]">{r.rank}</td>
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.ticker}`} className="font-medium text-[var(--text)] hover:text-[var(--accent)]">{r.name}</Link>
                  <div className="text-[10px] text-[var(--text-4)]"><span className="font-mono">{r.ticker}</span>{r.sector ? ` · ${r.sector}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--text)]">{r.mentions.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: pctCol(r.mentionChangePct) }}>{fmtPct(r.mentionChangePct)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.rankChange == null ? "var(--text-4)" : r.rankChange > 0 ? "#22c55e" : r.rankChange < 0 ? "#ef4444" : "var(--text-4)" }}>
                  {r.rankChange == null || r.rankChange === 0 ? "—" : `${r.rankChange > 0 ? "▲" : "▼"}${Math.abs(r.rankChange)}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-3)]">{r.upvotes.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!view.length && <div className="py-12 text-center text-sm text-[var(--text-3)]">No buzz data — run the nightly refresh.</div>}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">{rows.length} tickers with Reddit buzz; showing the top 200 by the selected sort. Mentions/upvotes from ApeWisdom (r/wallstreetbets, r/stocks, r/investing, r/options…). A spike in mentions is a crowding/volatility flag, not a buy signal. As of {asOf}.</p>
    </main>
  );
}
