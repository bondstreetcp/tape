"use client";
import { useEffect, useMemo, useState } from "react";
import type { QuarterPoint } from "@/lib/financials";

// Margins & revenue-growth trend, by quarter. Two y-axes: margins (gross + EBIT) on the
// left, revenue YoY growth on the right (different scales, growth can go negative). Toggle
// between spot-quarter figures and trailing-12-month (TTM, smooths seasonality). Deep
// quarterly history from SEC EDGAR (~10yr) with a Yahoo fallback (~5yr) — same source as
// the Shares chart, fetched from /api/quarterly-fundamentals.

const GM = "#34d399"; // gross margin (emerald)
const OM = "#60a5fa"; // EBIT / operating margin (blue)
const GR = "#f59e0b"; // revenue YoY growth (amber)

const RANGES: [string, number][] = [["5Y", 5], ["10Y", 10], ["Max", 0]];
const pctL = (f: number) => `${(f * 100).toFixed(0)}%`;
const pct1 = (f: number) => `${(f * 100).toFixed(1)}%`;
const pctS = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;
const qLabel = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return `Q${Math.floor(((m || 1) - 1) / 3) + 1} '${String(y).slice(2)}`;
};

interface Pt { date: string; gm: number | null; om: number | null; g: number | null }

export default function MarginsChart({ symbol }: { symbol: string }) {
  const [raw, setRaw] = useState<QuarterPoint[] | null>(null);
  const [mode, setMode] = useState<"ttm" | "spot">("ttm");
  const [years, setYears] = useState(10);
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    let on = true;
    setRaw(null);
    fetch(`/api/quarterly-fundamentals/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (on) setRaw(Array.isArray(d?.quarters) ? d.quarters : []); })
      .catch(() => { if (on) setRaw([]); });
    return () => { on = false; };
  }, [symbol]);

  // Derive margins + revenue growth per quarter, spot or trailing-12-month.
  const all = useMemo<Pt[]>(() => {
    const q = raw ?? [];
    const sum4 = (end: number, k: keyof QuarterPoint) => {
      if (end < 3) return null;
      let s = 0;
      for (let j = end - 3; j <= end; j++) { const v = q[j][k]; if (typeof v !== "number") return null; s += v; }
      return s;
    };
    return q.map((_, i) => {
      let rev: number | null, gp: number | null, oi: number | null, revPrev: number | null;
      if (mode === "ttm") {
        rev = sum4(i, "rev"); gp = sum4(i, "gp"); oi = sum4(i, "oi"); revPrev = sum4(i - 4, "rev");
      } else {
        rev = q[i].rev; gp = q[i].gp; oi = q[i].oi; revPrev = i >= 4 ? q[i - 4].rev : null;
      }
      const gm = gp != null && rev != null && rev > 0 ? gp / rev : null;
      const om = oi != null && rev != null && rev > 0 ? oi / rev : null;
      const g = revPrev != null && revPrev > 0 && rev != null ? rev / revPrev - 1 : null;
      return { date: q[i].date, gm, om, g };
    });
  }, [raw, mode]);

  // Apply the time window.
  const win = useMemo(() => {
    if (all.length < 2 || years === 0) return all;
    const cutoff = Date.parse(all[all.length - 1].date) - years * 365 * 86_400_000;
    const w = all.filter((p) => Date.parse(p.date) >= cutoff);
    return w.length >= 2 ? w : all;
  }, [all, years]);

  if (raw == null) return <Shell><div className="py-10 text-center text-xs text-[var(--text-3)]">Loading…</div></Shell>;

  const mVals = win.flatMap((p) => [p.gm, p.om]).filter((v): v is number => v != null);
  const gVals = win.map((p) => p.g).filter((v): v is number => v != null);
  if (mVals.length < 2 && gVals.length < 2)
    return <Shell><div className="py-10 text-center text-xs text-[var(--text-3)]">Not enough quarterly history for {symbol}.</div></Shell>;

  const W = 760, H = 300, ML = 48, MR = 50, MT = 16, MB = 40;
  const n = win.length;
  const x = (i: number) => ML + (n === 1 ? 0.5 : i / (n - 1)) * (W - ML - MR);

  // Left axis = margins; right axis = growth (always includes 0).
  const padDom = (vals: number[], extra: number[] = []): [number, number] => {
    const a = [...vals, ...extra];
    let lo = Math.min(...a), hi2 = Math.max(...a);
    const pad = (hi2 - lo) * 0.12 || Math.abs(hi2) * 0.1 || 0.02;
    return [lo - pad, hi2 + pad];
  };
  const [mMin, mMax] = mVals.length ? padDom(mVals) : [0, 1];
  const [gMin, gMax] = gVals.length ? padDom(gVals, [0]) : [-0.1, 0.1];
  const yL = (v: number) => MT + (1 - (v - mMin) / (mMax - mMin || 1)) * (H - MT - MB);
  const yR = (v: number) => MT + (1 - (v - gMin) / (gMax - gMin || 1)) * (H - MT - MB);

  const path = (get: (p: Pt) => number | null, yScale: (v: number) => number) => {
    let d = "", pen = false;
    win.forEach((p, i) => {
      const v = get(p);
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${yScale(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const ticks = (lo: number, hi2: number) => [lo, (lo + hi2) / 2, hi2];
  const every = Math.max(1, Math.ceil(n / 9));
  const TB = (active: boolean) =>
    "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors " +
    (active ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const hp = hi != null ? win[hi] : null;

  return (
    <Shell>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-[var(--text-2)]">Margins &amp; growth <span className="font-normal text-[var(--text-4)]">· by quarter</span></h3>
          <Legend color={GM} label="Gross margin" />
          <Legend color={OM} label="EBIT margin" />
          <Legend color={GR} label="Rev YoY" dash />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            <button onClick={() => setMode("spot")} className={TB(mode === "spot")} title="Each quarter on its own">Spot Q</button>
            <button onClick={() => setMode("ttm")} className={TB(mode === "ttm")} title="Trailing 12 months — smooths seasonality">TTM</button>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {RANGES.map(([lab, yr]) => (
              <button key={lab} onClick={() => setYears(yr)} className={TB(years === yr)}>{lab}</button>
            ))}
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHi(null)}>
        {/* left axis (margins) gridlines + labels */}
        {mVals.length > 0 && ticks(mMin, mMax).map((v, i) => (
          <g key={"l" + i}>
            <line x1={ML} x2={W - MR} y1={yL(v)} y2={yL(v)} stroke="var(--surface-hover)" />
            <text x={ML - 5} y={yL(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{pctL(v)}</text>
          </g>
        ))}
        {/* right axis (growth) labels + zero line */}
        {gVals.length > 0 && ticks(gMin, gMax).map((v, i) => (
          <text key={"r" + i} x={W - MR + 5} y={yR(v) + 3} textAnchor="start" fontSize={10} fill={GR}>{pctL(v)}</text>
        ))}
        {gVals.length > 0 && gMin < 0 && gMax > 0 && (
          <line x1={ML} x2={W - MR} y1={yR(0)} y2={yR(0)} stroke={GR} strokeOpacity={0.35} strokeDasharray="4 3" />
        )}

        {/* series */}
        <path d={path((p) => p.g, yR)} fill="none" stroke={GR} strokeWidth={1.6} strokeDasharray="4 3" />
        <path d={path((p) => p.gm, yL)} fill="none" stroke={GM} strokeWidth={1.9} />
        <path d={path((p) => p.om, yL)} fill="none" stroke={OM} strokeWidth={1.9} />

        {/* x labels */}
        {win.map((p, i) => (i % every === 0 || i === n - 1 ? (
          <text key={"x" + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--text-4)">{qLabel(p.date)}</text>
        ) : null))}

        {/* hover guide + markers + tooltip */}
        {hp && (
          <>
            <line x1={x(hi!)} x2={x(hi!)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
            {hp.gm != null && <circle cx={x(hi!)} cy={yL(hp.gm)} r={3} fill={GM} />}
            {hp.om != null && <circle cx={x(hi!)} cy={yL(hp.om)} r={3} fill={OM} />}
            {hp.g != null && <circle cx={x(hi!)} cy={yR(hp.g)} r={3} fill={GR} />}
            {(() => {
              const boxW = 124, boxH = 64, leftSide = x(hi!) > W - MR - boxW - 6;
              const tx = leftSide ? x(hi!) - boxW - 8 : x(hi!) + 8;
              return (
                <g transform={`translate(${tx},${MT})`}>
                  <rect width={boxW} height={boxH} rx={6} fill="var(--bg)" stroke="var(--border)" />
                  <text x={9} y={16} fontSize={11} fontWeight={600} fill="var(--text-2)">{qLabel(hp.date)}</text>
                  <text x={9} y={32} fontSize={10} fill={GM}>Gross {hp.gm != null ? pct1(hp.gm) : "—"}</text>
                  <text x={9} y={46} fontSize={10} fill={OM}>EBIT {hp.om != null ? pct1(hp.om) : "—"}</text>
                  <text x={9} y={59} fontSize={10} fill={GR}>Rev YoY {hp.g != null ? pctS(hp.g) : "—"}</text>
                </g>
              );
            })()}
          </>
        )}

        {/* hover hit areas (one per quarter) */}
        {win.map((_, i) => {
          const half = (W - ML - MR) / Math.max(1, n - 1) / 2;
          return <rect key={"h" + i} x={x(i) - half} y={MT} width={half * 2} height={H - MT - MB} fill="transparent" onMouseEnter={() => setHi(i)} />;
        })}
      </svg>

      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-4)]">
        {mode === "ttm" ? "Trailing-12-month figures (last 4 quarters) — smooths seasonality." : "Each fiscal quarter on its own — note the seasonal zig-zag."}{" "}
        Rev YoY compares to the year-ago {mode === "ttm" ? "TTM" : "quarter"}. Deep quarterly history from SEC EDGAR where available (else Yahoo, ~5yr); margins omitted for issuers that don&apos;t report gross profit (e.g. banks).
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">{children}</section>;
}
function Legend({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-[var(--text-3)]">
      <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash ? "3 2" : undefined} /></svg>
      {label}
    </span>
  );
}
