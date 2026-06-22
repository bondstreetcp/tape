"use client";
import type { StockRow } from "@/lib/types";

// "How good is this business, relative to its peers?" — grades the company's returns,
// margins, cash generation and leverage against its sector/sub-industry peers as
// percentile ranks, plus a composite 0–100 quality score. Pure client component: the
// stock page already hands FinancialsView the peer set (with each peer's `fund` metrics),
// so no extra fetch.

type Dir = "hi" | "lo";
interface Metric { key: keyof NonNullable<StockRow["fund"]>; label: string; dir: Dir; fmt: (v: number) => string }

const pf = (v: number) => `${(v * 100).toFixed(1)}%`;
const lev = (v: number) => (v <= 0 ? "net cash" : `${v.toFixed(1)}×`);

const METRICS: Metric[] = [
  { key: "roic", label: "ROIC", dir: "hi", fmt: pf },
  { key: "roe", label: "ROE", dir: "hi", fmt: pf },
  { key: "grossMargin", label: "Gross margin", dir: "hi", fmt: pf },
  { key: "opMargin", label: "Operating margin", dir: "hi", fmt: pf },
  { key: "fcfYield", label: "FCF yield", dir: "hi", fmt: pf },
  { key: "netDebtEbitda", label: "Net debt / EBITDA", dir: "lo", fmt: lev },
];

const band = (p: number) => (p >= 67 ? "#22c55e" : p >= 34 ? "#eab308" : "#ef4444");
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export default function QualityScorecard({ row, peers, peerGroup }: { row: StockRow | null; peers: StockRow[]; peerGroup: string | null }) {
  if (!row?.fund) return null;

  // comparison set = peers + self, deduped by symbol
  const bySym = new Map<string, StockRow>();
  for (const s of [row, ...peers]) if (!bySym.has(s.symbol)) bySym.set(s.symbol, s);
  const set = [...bySym.values()];

  const rows = METRICS.map((m) => {
    const raw = row.fund?.[m.key];
    const myVal = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const vals = set.map((s) => s.fund?.[m.key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    let pct: number | null = null, med: number | null = null;
    if (myVal != null && vals.length >= 5) {
      const beats = vals.filter((v) => (m.dir === "hi" ? myVal > v : myVal < v)).length;
      pct = (beats / (vals.length - 1)) * 100; // share of peers this name beats → percentile
      med = median(vals);
    }
    return { ...m, myVal, pct, med };
  });

  const scored = rows.filter((r) => r.pct != null);
  const score = scored.length ? Math.round(scored.reduce((a, r) => a + (r.pct as number), 0) / scored.length) : null;
  const scoreLabel =
    score == null ? "" : score >= 80 ? "Exceptional" : score >= 60 ? "Strong" : score >= 40 ? "Average" : score >= 20 ? "Below average" : "Weak";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-2)]">Quality scorecard</h3>
          <p className="text-[11px] text-[var(--text-4)]">vs {peerGroup ?? "sector"} · {set.length} peers · percentile rank</p>
        </div>
        {score != null && (
          <div className="text-right leading-none">
            <div className="text-2xl font-bold tabular-nums" style={{ color: band(score) }}>
              {score}<span className="text-sm font-normal text-[var(--text-4)]"> / 100</span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium" style={{ color: band(score) }}>{scoreLabel}</div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex items-center gap-3"
            title={r.pct != null ? `${Math.round(r.pct)}th percentile · peer median ${r.fmt(r.med as number)}` : "too few peers to rank"}
          >
            <span className="w-36 shrink-0 truncate text-xs text-[var(--text-3)]">{r.label}</span>
            <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--text)]">{r.myVal == null ? "—" : r.fmt(r.myVal)}</span>
            <div className="relative h-1.5 flex-1 rounded-full bg-[var(--surface-hover)]">
              <div className="absolute top-[-2px] h-[10px] w-px bg-[var(--border-strong)]" style={{ left: "50%" }} title="peer median" />
              {r.pct != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, r.pct)}%`, background: band(r.pct) }} />}
            </div>
            <span
              className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums"
              style={{ color: r.pct == null ? "var(--text-4)" : band(r.pct) }}
            >
              {r.pct == null ? "—" : Math.round(r.pct)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-4)]">
        Percentile vs {set.length} {peerGroup ?? "sector"} peers — higher = better (leverage inverted: less debt ranks higher). The faint tick is the peer median; the score is the average percentile. Annual fundamentals.
      </p>
    </section>
  );
}
