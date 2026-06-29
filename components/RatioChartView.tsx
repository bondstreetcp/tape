"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { LoadingState } from "./Spinner";
import { UNIVERSE_BY_ID } from "@/lib/universes";

// Ratio / spread chart — plot one security against another over time: A÷B (relative strength),
// A−B (spread), or the ratio rebased to 100 (relative outperformance). Both legs are fetched live
// from /api/ohlc for ANY Yahoo symbol (incl. indices like ^GSPC, ETFs like SPY/GLD), aligned by
// calendar day, and reduced to a single derived line.

type Mode = "ratio" | "spread" | "rebased";
const MODES: { key: Mode; label: string }[] = [
  { key: "ratio", label: "Ratio · A ÷ B" },
  { key: "spread", label: "Spread · A − B" },
  { key: "rebased", label: "Rebased · 100" },
];
const RANGES: [string, number][] = [["6M", 0.5], ["1Y", 1], ["2Y", 2], ["3Y", 3], ["5Y", 5], ["10Y", 10]];
const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const clean = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 12);

interface Bar { t: number; c: number }
async function fetchDaily(sym: string): Promise<Bar[]> {
  const r = await fetch(`/api/ohlc/${encodeURIComponent(sym)}?years=25`).then((x) => x.json());
  return (r?.daily || []).filter((b: any) => b && b.c != null).map((b: any) => ({ t: b.t, c: b.c }));
}

export default function RatioChartView({ universe }: { universe: string }) {
  const [a, setA] = useState("NVDA");
  const [b, setB] = useState("SPY");
  const [aIn, setAIn] = useState("NVDA");
  const [bIn, setBIn] = useState("SPY");
  const [mode, setMode] = useState<Mode>("rebased");
  const [years, setYears] = useState(1);
  const [data, setData] = useState<Record<string, Bar[] | "err">>({});
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    for (const s of [a, b]) {
      if (data[s]) continue;
      fetchDaily(s).then((d) => setData((p) => ({ ...p, [s]: d.length ? d : "err" }))).catch(() => setData((p) => ({ ...p, [s]: "err" })));
    }
  }, [a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => { const na = clean(aIn), nb = clean(bIn); if (na) setA(na); if (nb) setB(nb); };
  const swap = () => { setA(b); setB(a); setAIn(b); setBIn(a); };

  const aBars = data[a], bBars = data[b];
  const loading = !aBars || !bBars;
  const err = aBars === "err" || bBars === "err";

  const pts = useMemo(() => {
    if (!Array.isArray(aBars) || !Array.isArray(bBars)) return [];
    const mb = new Map(bBars.map((x) => [dayKey(x.t), x.c]));
    const aligned: { t: number; ca: number; cb: number }[] = [];
    for (const x of aBars) { const cb = mb.get(dayKey(x.t)); if (cb != null && cb !== 0 && x.c) aligned.push({ t: x.t, ca: x.c, cb }); }
    const cut = Date.now() - years * 366 * DAY;
    const win = aligned.filter((p) => p.t >= cut);
    const base = win[0];
    return win
      .map((p) => {
        let v: number | null;
        if (mode === "ratio") v = p.ca / p.cb;
        else if (mode === "spread") v = p.ca - p.cb;
        else v = base ? (p.ca / p.cb) / (base.ca / base.cb) * 100 : null;
        return { t: p.t, v: v as number, ca: p.ca, cb: p.cb };
      })
      .filter((p) => p.v != null && Number.isFinite(p.v));
  }, [aBars, bBars, mode, years]);

  const fmt = (v: number) => (mode === "rebased" ? v.toFixed(1) : mode === "spread" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(3));
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader title="Ratio & Spread Charts" desc="Plot one security against another over time — relative strength (A÷B), a spread (A−B), or the ratio rebased to 100. Any Yahoo symbol works, including indices (^GSPC, ^IXIC) and ETFs (SPY, GLD, TLT). Decision-support, not advice." />

      {/* inputs */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Numerator (A)</span>
          <input value={aIn} onChange={(e) => setAIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-sm uppercase text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
        </label>
        <button onClick={swap} title="Swap A/B" className="mb-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text)]">⇄</button>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Denominator (B)</span>
          <input value={bIn} onChange={(e) => setBIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-sm uppercase text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
        </label>
        <button onClick={apply} className="mb-1 rounded-md bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Plot</button>
      </div>

      {/* mode + range toggles */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {MODES.map((m) => <button key={m.key} onClick={() => setMode(m.key)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (mode === m.key ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{m.label}</button>)}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {RANGES.map(([l, yr]) => <button key={l} onClick={() => setYears(yr)} className={"rounded-md px-2 py-1 text-xs font-medium transition-colors " + (years === yr ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{l}</button>)}
        </div>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-1 text-sm font-semibold text-[var(--text-2)]">
          <span className="font-mono text-[var(--accent)]">{a}</span> {mode === "spread" ? "−" : "÷"} <span className="font-mono text-[var(--accent)]">{b}</span>
          <span className="ml-2 text-xs font-normal text-[var(--text-4)]">{MODES.find((m) => m.key === mode)!.label}</span>
        </div>
        {loading ? (
          <LoadingState className="py-16" />
        ) : err ? (
          <div className="py-16 text-center text-xs text-[var(--text-3)]">Couldn&apos;t load {aBars === "err" ? a : ""}{aBars === "err" && bBars === "err" ? " and " : ""}{bBars === "err" ? b : ""} — check the symbol(s).</div>
        ) : pts.length < 2 ? (
          <div className="py-16 text-center text-xs text-[var(--text-3)]">No overlapping history for {a} and {b} in this window.</div>
        ) : (
          <Chart pts={pts} mode={mode} fmt={fmt} a={a} b={b} hi={hi} setHi={setHi} />
        )}
      </section>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Daily closes aligned by calendar day. Rebased = the ratio set to 100 at the start of the window (reads as A&apos;s relative performance vs B). Live from Yahoo via /api/ohlc — not investment advice.</p>
    </main>
  );
}

function Chart({ pts, mode, fmt, a, b, hi, setHi }: { pts: { t: number; v: number; ca: number; cb: number }[]; mode: Mode; fmt: (v: number) => string; a: string; b: string; hi: number | null; setHi: (i: number | null) => void }) {
  const DAYC = 86_400_000;
  const W = 880, H = 360, ML = 56, MR = 16, MT = 16, MB = 26;
  const minT = pts[0].t, maxT = pts[pts.length - 1].t;
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals, ...(mode === "spread" ? [0] : [])), hiV = Math.max(...vals, ...(mode === "spread" ? [0] : []));
  if (mode === "rebased") { lo = Math.min(lo, 100); hiV = Math.max(hiV, 100); }
  const pad = (hiV - lo) * 0.08 || Math.abs(hiV) * 0.05 || 1;
  lo -= pad; hiV += pad;
  const x = (t: number) => ML + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hiV - lo || 1)) * (H - MT - MB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const area = `${path} L ${x(maxT).toFixed(1)} ${y(lo).toFixed(1)} L ${x(minT).toFixed(1)} ${y(lo).toFixed(1)} Z`;
  const yTicks = [hiV, (lo + hiV) / 2, lo];
  const yrs: number[] = [];
  for (let yr = new Date(minT).getUTCFullYear(); yr <= new Date(maxT).getUTCFullYear(); yr++) yrs.push(yr);
  const hp = hi != null ? pts[hi] : null;
  const refLine = mode === "rebased" ? 100 : mode === "spread" ? 0 : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHi(null)}>
      <defs>
        <linearGradient id="ratiofill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={"y" + i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" />
          <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{fmt(v)}</text>
        </g>
      ))}
      {refLine != null && lo < refLine && hiV > refLine && <line x1={ML} x2={W - MR} y1={y(refLine)} y2={y(refLine)} stroke="var(--text-4)" strokeOpacity={0.5} strokeDasharray="4 3" />}
      {yrs.map((yr) => { const tx = x(Date.parse(`${yr}-01-01`)); return tx >= ML && tx <= W - MR ? <text key={yr} x={tx} y={H - 7} textAnchor="middle" fontSize={9} fill="var(--text-4)">{yr}</text> : null; })}
      <path d={area} fill="url(#ratiofill)" stroke="none" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      {hp && (
        <>
          <line x1={x(hp.t)} x2={x(hp.t)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
          <circle cx={x(hp.t)} cy={y(hp.v)} r={3.5} fill="var(--accent)" />
          {(() => {
            const boxW = 150, boxH = 60, left = x(hp.t) > W - MR - boxW - 6;
            return (
              <g transform={`translate(${left ? x(hp.t) - boxW - 8 : x(hp.t) + 8},${MT})`}>
                <rect width={boxW} height={boxH} rx={6} fill="var(--bg)" stroke="var(--border)" />
                <text x={9} y={15} fontSize={11} fontWeight={600} fill="var(--text-2)">{new Date(hp.t).toISOString().slice(0, 10)}</text>
                <text x={9} y={32} fontSize={12} fontWeight={600} fill="var(--accent)">{fmt(hp.v)}</text>
                <text x={9} y={48} fontSize={10} fill="var(--text-4)">{a} {hp.ca.toFixed(2)} · {b} {hp.cb.toFixed(2)}</text>
              </g>
            );
          })()}
        </>
      )}
      {pts.map((p, i) => {
        const half = (W - ML - MR) / Math.max(1, pts.length - 1) / 2;
        return <rect key={i} x={x(p.t) - half} y={MT} width={Math.max(1, half * 2)} height={H - MT - MB} fill="transparent" onMouseEnter={() => setHi(i)} />;
      })}
    </svg>
  );
}
