"use client";
import { useEffect, useMemo, useState } from "react";
import type { QuarterPoint } from "@/lib/financials";

// Margins & revenue-growth trend, by quarter — two stacked single-axis charts that share
// one fetch, the Spot/TTM + range controls, and a linked hover (point at a quarter on one
// and the same quarter highlights on the other). Top: gross + EBIT margin. Bottom: revenue
// YoY growth. Toggle spot-quarter vs trailing-12-month (TTM smooths seasonality). Deep
// quarterly history from SEC EDGAR (~10yr) with a Yahoo fallback (~5yr).

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
interface Line { key: "gm" | "om" | "g"; color: string; label: string; tip: string }

// Shared x-geometry so both panels' x-axes (and the linked hover guide) line up exactly.
const W = 760, ML = 48, MR = 16;

export default function MarginsChart({ symbol }: { symbol: string }) {
  const [raw, setRaw] = useState<QuarterPoint[] | null>(null);
  const [mode, setMode] = useState<"ttm" | "spot">("ttm");
  const [years, setYears] = useState(10);
  const [hi, setHi] = useState<number | null>(null); // hover index, shared across both panels

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

  const win = useMemo(() => {
    if (all.length < 2 || years === 0) return all;
    const cutoff = Date.parse(all[all.length - 1].date) - years * 365 * 86_400_000;
    const w = all.filter((p) => Date.parse(p.date) >= cutoff);
    return w.length >= 2 ? w : all;
  }, [all, years]);

  if (raw == null) return <Shell><div className="py-10 text-center text-xs text-[var(--text-3)]">Loading…</div></Shell>;

  // Decide which margin lines have enough real history to plot. Gross margin only shows when
  // it isn't a sparse stub (issuers like Visa that barely report gross profit get a handful of
  // recent quarters from Yahoo — misleading next to a full EBIT history); EBIT shows whenever present.
  const gmN = win.filter((p) => p.gm != null).length;
  const omN = win.filter((p) => p.om != null).length;
  const marginLines: Line[] = [];
  if (gmN >= 2 && (gmN >= 8 || gmN >= 0.4 * omN)) marginLines.push({ key: "gm", color: GM, label: "Gross margin", tip: "Gross" });
  if (omN >= 2) marginLines.push({ key: "om", color: OM, label: "EBIT margin", tip: "EBIT" });
  const hasMargins = marginLines.length > 0;
  const hasGrowth = win.filter((p) => p.g != null).length >= 2;
  if (!hasMargins && !hasGrowth)
    return <Shell><div className="py-10 text-center text-xs text-[var(--text-3)]">Not enough quarterly history for {symbol}.</div></Shell>;

  const TB = (active: boolean) =>
    "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors " +
    (active ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <Shell>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Margins &amp; growth <span className="font-normal text-[var(--text-4)]">· by quarter</span></h3>
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

      {hasMargins && (
        <Panel
          title="Operating margins"
          win={win} hi={hi} setHi={setHi} fmt={pct1} height={188} legend
          lines={marginLines}
        />
      )}
      {hasGrowth && (
        <Panel
          title={`Revenue growth · YoY${mode === "ttm" ? " (TTM)" : ""}`}
          win={win} hi={hi} setHi={setHi} fmt={pctS} height={164} includeZero
          lines={[{ key: "g", color: GR, label: "Rev YoY", tip: "Rev YoY" }]}
        />
      )}

      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-4)]">
        {mode === "ttm" ? "Trailing-12-month figures (last 4 quarters) — smooths seasonality." : "Each fiscal quarter on its own — note the seasonal zig-zag."}{" "}
        Rev YoY compares to the year-ago {mode === "ttm" ? "TTM" : "quarter"}. Deep quarterly history from SEC EDGAR where available (else Yahoo, ~5yr); margins omitted for issuers that don&apos;t report gross profit (e.g. banks).
      </p>
    </Shell>
  );
}

function Panel({ title, win, lines, fmt, includeZero, height, hi, setHi, legend }: {
  title: string; win: Pt[]; lines: Line[]; fmt: (f: number) => string;
  includeZero?: boolean; height: number; hi: number | null; setHi: (i: number | null) => void; legend?: boolean;
}) {
  const H = height, MT = 14, MB = 26;
  const n = win.length;
  const x = (i: number) => ML + (n === 1 ? 0.5 : i / (n - 1)) * (W - ML - MR);
  const vals = win.flatMap((p) => lines.map((l) => p[l.key])).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  let lo = Math.min(...vals, ...(includeZero ? [0] : []));
  let hiV = Math.max(...vals, ...(includeZero ? [0] : []));
  const pad = (hiV - lo) * 0.12 || Math.abs(hiV) * 0.1 || 0.02;
  lo -= pad; hiV += pad;
  const y = (v: number) => MT + (1 - (v - lo) / (hiV - lo || 1)) * (H - MT - MB);

  const path = (key: Line["key"]) => {
    let d = "", pen = false;
    win.forEach((p, i) => {
      const v = p[key];
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const ticks = [lo, (lo + hiV) / 2, hiV];
  const every = Math.max(1, Math.ceil(n / 9));
  const hp = hi != null ? win[hi] : null;

  return (
    <div className="mt-3">
      <div className="mb-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="text-xs font-medium text-[var(--text-3)]">{title}</span>
        {legend && lines.map((l) => <Legend key={l.key} color={l.color} label={l.label} />)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHi(null)}>
        {ticks.map((v, i) => (
          <g key={"t" + i}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" />
            <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{pctL(v)}</text>
          </g>
        ))}
        {includeZero && lo < 0 && hiV > 0 && (
          <line x1={ML} x2={W - MR} y1={y(0)} y2={y(0)} stroke="var(--text-4)" strokeOpacity={0.5} strokeDasharray="4 3" />
        )}

        {lines.map((l) => <path key={l.key} d={path(l.key)} fill="none" stroke={l.color} strokeWidth={1.9} />)}

        {win.map((p, i) => (i % every === 0 || i === n - 1 ? (
          <text key={"x" + i} x={x(i)} y={H - 7} textAnchor="middle" fontSize={9} fill="var(--text-4)">{qLabel(p.date)}</text>
        ) : null))}

        {hp && (
          <>
            <line x1={x(hi!)} x2={x(hi!)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
            {lines.map((l) => (hp[l.key] != null ? <circle key={l.key} cx={x(hi!)} cy={y(hp[l.key] as number)} r={3} fill={l.color} /> : null))}
            {(() => {
              const boxW = 116, boxH = 16 + lines.length * 14 + 6, leftSide = x(hi!) > W - MR - boxW - 6;
              const tx = leftSide ? x(hi!) - boxW - 8 : x(hi!) + 8;
              return (
                <g transform={`translate(${tx},${MT})`}>
                  <rect width={boxW} height={boxH} rx={6} fill="var(--bg)" stroke="var(--border)" />
                  <text x={9} y={15} fontSize={11} fontWeight={600} fill="var(--text-2)">{qLabel(hp.date)}</text>
                  {lines.map((l, k) => (
                    <text key={l.key} x={9} y={31 + k * 14} fontSize={10} fill={l.color}>{l.tip} {hp[l.key] != null ? fmt(hp[l.key] as number) : "—"}</text>
                  ))}
                </g>
              );
            })()}
          </>
        )}

        {win.map((_, i) => {
          const half = (W - ML - MR) / Math.max(1, n - 1) / 2;
          return <rect key={"h" + i} x={x(i) - half} y={MT} width={half * 2} height={H - MT - MB} fill="transparent" onMouseEnter={() => setHi(i)} />;
        })}
      </svg>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">{children}</section>;
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-[var(--text-3)]">
      <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2" /></svg>
      {label}
    </span>
  );
}
