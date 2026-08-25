"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";
import { inflectionColor, growthColor, fmtPct, scanHistoryFor, type StaplesScannerData, type ScanRow, type ScanLevel, type Inflection, type ScanPoint } from "@/lib/staplesScanner";

type FlatRow = ScanRow & { segment: string; source: string; periodEnd: string };
type SortKey = "label" | "segment" | "category" | "l2w" | "l4w" | "l12w" | "l52w" | "volume" | "priceMix" | "shareDeltaBps" | "inflection";

const infRank = (i: Inflection) => (i === "accelerating" ? 3 : i === "stable" ? 2 : i === "decelerating" ? 1 : 0);
const getVal = (r: FlatRow, k: SortKey): number | string | null => {
  switch (k) {
    case "label": return r.label;
    case "segment": return r.segment;
    case "category": return r.category;
    case "l2w": return r.dollar.l2w ?? null;
    case "l4w": return r.dollar.l4w ?? null;
    case "l12w": return r.dollar.l12w ?? null;
    case "l52w": return r.dollar.l52w ?? null;
    case "volume": return r.volume ?? null;
    case "priceMix": return r.priceMix ?? null;
    case "shareDeltaBps": return r.shareDeltaBps ?? null;
    case "inflection": return infRank(r.inflection ?? null);
  }
};

const LEVELS: { key: ScanLevel; label: string }[] = [
  { key: "company", label: "Companies" },
  { key: "category", label: "Categories" },
  { key: "brand", label: "Brands" },
];

// Tiny line chart for the trend panels — a zero baseline, an accent line, and green/red dots per point.
function MiniLine({ pts, labels, width = 230, height = 46 }: { pts: (number | null | undefined)[]; labels: string[]; width?: number; height?: number }) {
  const vals = pts.filter((v): v is number => v != null);
  if (!vals.length) return <div className="py-3 text-[11px] text-[var(--text-4)]">no data</div>;
  const pad = (Math.max(...vals, 0) - Math.min(...vals, 0)) * 0.15 || 1;
  const lo = Math.min(...vals, 0) - pad, hi = Math.max(...vals, 0) + pad;
  const n = pts.length, ML = 6, MR = 6, MT = 6, MB = 13;
  const x = (i: number) => (n <= 1 ? width / 2 : ML + (i / (n - 1)) * (width - ML - MR));
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (height - MT - MB);
  const drawn = pts.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  const path = drawn.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} className="tabular-nums">
      <line x1={ML} x2={width - MR} y1={y(0)} y2={y(0)} stroke="var(--text-4)" strokeOpacity={0.3} strokeDasharray="2 2" />
      {drawn.length > 1 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
      {drawn.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.4} fill={p.v >= 0 ? "#22c55e" : "#ef4444"} />)}
      {labels.map((l, i) => <text key={i} x={x(i)} y={height - 3} fontSize={8} fill="var(--text-4)" textAnchor="middle">{l}</text>)}
    </svg>
  );
}

// Inline momentum sparkline for the table — the 52w→2w window trajectory, colored by direction
// (accelerating = green, decelerating = red), so the inflection reads at a glance without expanding.
function Spark({ pts }: { pts: (number | null | undefined)[] }) {
  const drawn = pts.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  if (drawn.length < 2) return <span className="text-[11px] text-[var(--text-4)]">—</span>;
  const vals = drawn.map((p) => p.v);
  const w = 72, h = 22, ML = 3, MR = 4, MT = 4, MB = 4;
  const pad = (Math.max(...vals, 0) - Math.min(...vals, 0)) * 0.15 || 1;
  const lo = Math.min(...vals, 0) - pad, hi = Math.max(...vals, 0) + pad;
  const n = pts.length;
  const x = (i: number) => ML + (i / (n - 1)) * (w - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (h - MT - MB);
  const path = drawn.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const last = drawn[drawn.length - 1];
  const slope = last.v - drawn[0].v; // recent window vs long-run → the acceleration direction
  const col = slope > 0.2 ? "#22c55e" : slope < -0.2 ? "#ef4444" : "var(--text-3)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="inline-block align-middle" role="img" aria-label="momentum">
      <line x1={ML} x2={w - MR} y1={y(0)} y2={y(0)} stroke="var(--text-4)" strokeOpacity={0.25} />
      <path d={path} fill="none" stroke={col} strokeWidth={1.4} />
      <circle cx={x(last.i)} cy={y(last.v)} r={2} fill={col} />
    </svg>
  );
}

// Per-entity trend panel: momentum WITHIN the latest read (52w→2w) + the cross-report series (accrues).
function ScanTrend({ history, row }: { history: ScanPoint[]; row: FlatRow }) {
  const latest = history.length ? history[history.length - 1] : null;
  const d = latest?.dollar ?? row.dollar;
  const series = history.filter((h) => h.dollar.l4w != null);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Momentum — this read (long → recent window)</div>
        <MiniLine pts={[d.l52w, d.l12w, d.l4w, d.l2w]} labels={["52w", "12w", "4w", "2w"]} />
        <div className="mt-1 text-[11px] text-[var(--text-4)]">L4w <b style={{ color: growthColor(d.l4w) }}>{fmtPct(d.l4w)}</b> vs L12w <b style={{ color: growthColor(d.l12w) }}>{fmtPct(d.l12w)}</b> — {row.inflection ?? "trend n/a"}. Sloping up left→right = accelerating demand.</div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Over time — L4wk $ growth by report</div>
        {series.length >= 2 ? (
          <>
            <MiniLine pts={series.map((h) => h.dollar.l4w)} labels={series.map((h) => (h.periodEnd || "").slice(5))} />
            <div className="mt-1 text-[11px] text-[var(--text-4)]">{series.length} biweekly reads · thru {series.at(-1)?.periodEnd}</div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-[11px] leading-relaxed text-[var(--text-4)]">
            One read so far ({latest?.periodEnd ?? row.periodEnd}). The trend line fills in as each biweekly NielsenIQ scan is added — the history accrues automatically.
          </div>
        )}
      </div>
    </div>
  );
}

export default function StaplesScannerView({ universe, data }: { universe: string; data: StaplesScannerData }) {
  const reports = data.reports ?? [];
  // Flatten to the LATEST row per (level + name + category), tagged with its report's segment/source/period.
  const flat = useMemo(() => {
    const best = new Map<string, FlatRow>();
    for (const rep of reports) {
      for (const row of rep.rows ?? []) {
        const key = `${row.level}|${(row.ticker || row.label).toUpperCase()}|${row.category.toLowerCase()}`;
        const cur = best.get(key);
        if (!cur || (rep.periodEnd || "") > cur.periodEnd) best.set(key, { ...row, segment: rep.segment, source: rep.source, periodEnd: rep.periodEnd });
      }
    }
    return [...best.values()];
  }, [reports]);

  const segments = useMemo(() => ["All", ...Array.from(new Set(flat.map((r) => r.segment).filter(Boolean))).sort()], [flat]);
  const [seg, setSeg] = useState("All");
  const [openKey, setOpenKey] = useState<string | null>(null); // expanded row → trend-over-time panel
  const [level, setLevel] = useState<ScanLevel>("company");
  const [sortKey, setSortKey] = useState<SortKey>("l4w");
  const [dir, setDir] = useState<1 | -1>(-1);
  const onSort = (k: SortKey) => {
    if (sortKey === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setDir(k === "label" || k === "segment" || k === "category" ? 1 : -1); }
  };
  const thBtn = "cursor-pointer select-none hover:text-[var(--text)]";
  const Arrow = ({ k }: { k: SortKey }) => (sortKey === k ? <span className="ml-0.5 text-[var(--accent)]">{dir === 1 ? "▲" : "▼"}</span> : null);

  const rows = useMemo(() => {
    const r = flat.filter((x) => x.level === level && (seg === "All" || x.segment === seg));
    return [...r].sort((a, b) => {
      const va = getVal(a, sortKey), vb = getVal(b, sortKey);
      if (typeof va === "string" || typeof vb === "string") return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;  // nulls last
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [flat, level, seg, sortKey, dir]);

  const latest = reports.map((r) => r.periodEnd).filter(Boolean).sort().at(-1);
  const sources = Array.from(new Set(reports.map((r) => r.source).filter((s) => s && s !== "—")));
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const Trend = ({ i }: { i: Inflection }) => (i ? <span className="font-medium" style={{ color: inflectionColor(i) }}>{i === "accelerating" ? "▲ accel" : i === "decelerating" ? "▼ decel" : "≈ stable"}</span> : <span className="text-[var(--text-4)]">—</span>);

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Staples Scanner</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            US retail <b>demand &amp; share</b> for consumer staples <InfoDot text="NielsenIQ point-of-sale $ sales growth, volume/price split, and dollar-share moves across L2wk/L4wk/L12wk/L52wk windows — a ~2-week-lagged leading read on each name's quarter. Extracted from the biweekly sell-side scan notes; derived figures only." /> — $ sales growth, volume/price, and share momentum over 2/4/12/52-week windows. A leading read on the quarter, ahead of the print. {latest ? `Data thru ${latest} · ` : ""}{reports.length} notes{sources.length ? ` · ${sources.join(", ")}` : ""} · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What this is:</b> the biweekly NielsenIQ retail-scanner reads that sell-side desks publish, distilled into one tracker. Each row is a category, a company (manufacturer), or a brand, with its US point-of-sale <b>$ sales growth</b> over the trailing 2 / 4 / 12 / 52 weeks.</p>
        <p><b>The signal is the inflection, not the level.</b> A name accelerating (L4w &gt; L12w) into its print tends to beat and get rewarded; a decelerating one is the setup for a miss/guide-down. Pair it with <b>share Δ</b> (are they winning or losing the category) and the category rollup (which staples pockets are hot vs rolling over).</p>
        <p><b>Volume vs price/mix:</b> volume-led growth is healthier than price-led (pricing eventually laps). Watch names holding sales up purely on price with volumes falling.</p>
        <p className="text-[var(--text-4)]">Derived from licensed sell-side scans (NielsenIQ) — figures only, internal use. Nielsen covers tracked brick-and-mortar channels, not all e-commerce, so it understates some premium/online-skewed names. Research, not advice.</p>
      </HowToRead>

      {data.summary && data.summary.headline && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> AI desk read
            {data.summary.periodEnd && <span className="font-normal normal-case text-[var(--text-4)]">· data thru {data.summary.periodEnd}</span>}
          </div>
          <p className="text-[15px] font-semibold leading-snug text-[var(--text)]">{data.summary.headline}</p>
          {data.summary.points.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px] leading-snug text-[var(--text-2)]">
              {data.summary.points.map((p, i) => <li key={i} className="flex gap-2"><span className="shrink-0 text-[var(--accent)]">▸</span> <span>{p}</span></li>)}
            </ul>
          )}
          <p className="mt-2 text-[10.5px] text-[var(--text-4)]">AI summary of the scans below — decision-support, not advice.</p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {segments.map((s) => <button key={s} onClick={() => setSeg(s)} className={TB(seg === s)}>{s}</button>)}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {LEVELS.map((l) => <button key={l.key} onClick={() => setLevel(l.key)} className={TB(level === l.key)}>{l.label}</button>)}
        </div>
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} rows</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          {reports.length
            ? "No rows for this segment / level."
            : "No scans extracted yet — drop the biweekly Nielsen PDFs in the watched folder and run npm run refresh-staples-scanner."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className={"px-3 py-2 font-medium " + thBtn} onClick={() => onSort("label")}>{level === "category" ? "Category" : "Name"}<Arrow k="label" /></th>
                <th className={"hidden px-2 py-2 font-medium sm:table-cell " + thBtn} onClick={() => onSort("segment")}>Segment<Arrow k="segment" /></th>
                {level !== "category" && <th className={"hidden px-2 py-2 font-medium md:table-cell " + thBtn} onClick={() => onSort("category")}>Category<Arrow k="category" /></th>}
                <th className={"px-2 py-2 text-right font-medium " + thBtn} onClick={() => onSort("l2w")}>$ 2w<Arrow k="l2w" /></th>
                <th className={"px-2 py-2 text-right font-medium " + thBtn} onClick={() => onSort("l4w")}>$ 4w<Arrow k="l4w" /></th>
                <th className={"px-2 py-2 text-right font-medium " + thBtn} onClick={() => onSort("l12w")}>$ 12w<Arrow k="l12w" /></th>
                <th className={"hidden px-2 py-2 text-right font-medium lg:table-cell " + thBtn} onClick={() => onSort("l52w")}>$ 52w<Arrow k="l52w" /></th>
                <th className={"hidden px-2 py-2 text-right font-medium lg:table-cell " + thBtn} onClick={() => onSort("volume")}>Vol<Arrow k="volume" /></th>
                <th className={"hidden px-2 py-2 text-right font-medium lg:table-cell " + thBtn} onClick={() => onSort("priceMix")}>Px/mix<Arrow k="priceMix" /></th>
                <th className={"px-2 py-2 text-right font-medium " + thBtn} onClick={() => onSort("shareDeltaBps")}>Share Δ<InfoDot text="y/y dollar-share change, basis points. + = gaining share." /><Arrow k="shareDeltaBps" /></th>
                <th className="hidden px-2 py-2 text-center font-medium md:table-cell">Momentum<InfoDot text="The 52w→12w→4w→2w $-growth trajectory. Sloping up left→right = accelerating demand into the print; down = decelerating." /></th>
                <th className={"px-3 py-2 font-medium " + thBtn} onClick={() => onSort("inflection")}>Trend<InfoDot text="Accelerating / stable / decelerating — L4wk vs L12wk (or as the note states it). The tradeable signal into a print." /><Arrow k="inflection" /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rowKey = `${r.level}|${r.ticker || r.label}|${r.category}`;
                const open = openKey === rowKey;
                return (
                <Fragment key={`${rowKey}-${i}`}>
                <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setOpenKey(open ? null : rowKey)} className="shrink-0 text-[10px] text-[var(--text-4)] hover:text-[var(--text)]" title="Trend over time" aria-label="Toggle trend">{open ? "▾" : "▸"}</button>
                      {r.ticker
                        ? <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} className="font-semibold text-[var(--accent)] hover:underline">{r.label}</Link>
                        : <span className="font-medium text-[var(--text-2)]">{r.label}</span>}
                      {r.ticker && <span className="font-mono text-[10px] text-[var(--text-4)]">{r.ticker}</span>}
                    </div>
                    {r.note && <div className="max-w-[280px] truncate text-[11px] text-[var(--text-4)]" title={r.note}>{r.note}</div>}
                  </td>
                  <td className="hidden px-2 py-2 text-[12px] text-[var(--text-4)] sm:table-cell">{r.segment}</td>
                  {level !== "category" && <td className="hidden px-2 py-2 text-[12px] text-[var(--text-3)] md:table-cell">{r.category}</td>}
                  <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: growthColor(r.dollar.l2w) }}>{fmtPct(r.dollar.l2w)}</td>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: growthColor(r.dollar.l4w) }}>{fmtPct(r.dollar.l4w)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: growthColor(r.dollar.l12w) }}>{fmtPct(r.dollar.l12w)}</td>
                  <td className="hidden px-2 py-2 text-right font-mono tabular-nums lg:table-cell" style={{ color: growthColor(r.dollar.l52w) }}>{fmtPct(r.dollar.l52w)}</td>
                  <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)] lg:table-cell">{fmtPct(r.volume)}</td>
                  <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)] lg:table-cell">{fmtPct(r.priceMix)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.shareDeltaBps == null ? "var(--text-4)" : r.shareDeltaBps >= 0 ? "#22c55e" : "#ef4444" }}>{r.shareDeltaBps == null ? "—" : `${r.shareDeltaBps >= 0 ? "+" : ""}${r.shareDeltaBps}bp`}</td>
                  <td className="hidden px-2 py-2 text-center md:table-cell"><Spark pts={[r.dollar.l52w, r.dollar.l12w, r.dollar.l4w, r.dollar.l2w]} /></td>
                  <td className="px-3 py-2 text-[12px]"><Trend i={r.inflection ?? null} /></td>
                </tr>
                {open && (
                  <tr className="bg-[var(--surface-2)]">
                    <td colSpan={12} className="px-3 pb-4 pt-1">
                      <ScanTrend history={scanHistoryFor(data, r.level, r.ticker || r.label, r.category)} row={r} />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
