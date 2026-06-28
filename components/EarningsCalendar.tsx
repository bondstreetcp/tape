"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import { fmtMarketCap, fmtPct, fmtDateTime } from "@/lib/format";
import { trendColor } from "@/lib/color";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { useWatchlist } from "@/lib/watchlist";
import UniverseSwitcher from "./UniverseSwitcher";

const RANGES = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
];

function timing(iso: string): { label: string; color: string } {
  const h = new Date(iso).getUTCHours();
  if (h > 0 && h < 14) return { label: "Before open", color: "#fbbf24" };
  if (h >= 19) return { label: "After close", color: "#60a5fa" };
  return { label: "TBD", color: "var(--text-3)" };
}

// Order within a day when sorting by session: before-open (BMO) → after-close (AMC) → unknown.
function sessionRank(iso: string): number {
  const h = new Date(iso).getUTCHours();
  if (h > 0 && h < 14) return 0;
  if (h >= 19) return 1;
  return 2;
}

const SORTS = [
  { id: "session", label: "Session" },
  { id: "mktcap", label: "Mkt cap" },
  { id: "alpha", label: "A–Z" },
] as const;
type SortMode = (typeof SORTS)[number]["id"];

function dayLabel(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function EarningsCalendar({
  universe,
  stocks,
  generatedAt,
}: {
  universe: string;
  stocks: StockRow[];
  generatedAt: string;
}) {
  const router = useRouter();
  const { has, toggle } = useWatchlist();
  const [days, setDays] = useState(14);
  const [watchOnly, setWatchOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("session");
  const intl = !!UNIVERSE_BY_ID[universe]?.international; // before/after-open timing is US-centric

  const groups = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const lo = start.getTime();
    const hi = Date.now() + days * 86_400_000;
    const byDate = new Map<string, StockRow[]>();
    for (const s of stocks) {
      if (!s.earningsDate) continue;
      const t = new Date(s.earningsDate).getTime();
      if (t < lo || t > hi) continue;
      if (watchOnly && !has(s.symbol)) continue;
      const d = s.earningsDate.slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(s);
    }
    const byCap = (a: StockRow, b: StockRow) => (b.marketCap || 0) - (a.marketCap || 0);
    const byAlpha = (a: StockRow, b: StockRow) => a.symbol.localeCompare(b.symbol);
    // Session (default): group before-open then after-close, biggest first within each block.
    // Intl timing is US-centric/unreliable, so there it falls back to market cap. Mkt cap / A–Z
    // sort the whole day's list without grouping.
    const cmp =
      sortMode === "mktcap" ? byCap
      : sortMode === "alpha" ? byAlpha
      : (a: StockRow, b: StockRow) => {
          if (!intl) { const r = sessionRank(a.earningsDate!) - sessionRank(b.earningsDate!); if (r) return r; }
          return byCap(a, b);
        };
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => ({ date, rows: rows.sort(cmp) }));
  }, [stocks, days, watchOnly, has, sortMode, intl]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings Calendar</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            {total} {UNIVERSE_BY_ID[universe]?.short ?? universe} names reporting · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UniverseSwitcher current={universe} />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-3)]">
            <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="accent-[var(--accent)]" />
            ★ Watchlist only
          </label>
          <div className="inline-flex items-center gap-1">
            <span className="text-[11px] text-[var(--text-4)]">Sort</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSortMode(s.id)}
                  title={s.id === "session" ? "Group before-open, then after-close" : s.id === "mktcap" ? "Largest market cap first" : "Alphabetical by ticker"}
                  className={"rounded-md px-2.5 py-1 " + (sortMode === s.id ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={"rounded-md px-2.5 py-1 " + (days === r.days ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          {watchOnly ? "No watchlist names report in this window." : "No upcoming earnings in this window."}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.date} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2">
                <span className="text-sm font-semibold text-[var(--text)]">{dayLabel(g.date)}</span>
                <span className="text-xs text-[var(--text-3)]">{g.rows.length} {g.rows.length === 1 ? "report" : "reports"}</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {g.rows.map((s) => {
                    const tm = timing(s.earningsDate!);
                    return (
                      <tr
                        key={s.symbol}
                        onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`)}
                        className="cursor-pointer border-b border-[var(--divider)] transition-colors last:border-0 hover:bg-[var(--surface-hover)]"
                      >
                        <td className="w-8 px-2 py-1.5 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggle(s.symbol); }}
                            title="Watch"
                            style={{ color: has(s.symbol) ? "#fbbf24" : "var(--border-strong)" }}
                          >
                            ★
                          </button>
                        </td>
                        <td className="px-2 py-1.5 font-mono font-semibold">{s.symbol}</td>
                        <td className="max-w-[16rem] truncate px-2 py-1.5 text-[var(--text-2)]">{s.name}</td>
                        <td className="px-2 py-1.5 text-xs" style={{ color: intl ? "var(--text-3)" : tm.color }}>
                          {intl ? (s.earningsEstimate ? "Est. date" : "Reports") : `${tm.label}${s.earningsEstimate ? " · est" : ""}`}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]" title="Market cap">{fmtMarketCap(s.marketCap)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]" title="Forward annual EPS estimate">
                          {s.epsForward != null ? `$${s.epsForward.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: trendColor(s.returns.ytd) }} title="Year-to-date price return">
                          {fmtPct(s.returns.ytd, 1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-4)]">
        Dates &amp; timing (before open / after close) from Yahoo; "est" = unconfirmed estimated date. EPS = forward annual consensus.
      </p>
    </main>
  );
}
