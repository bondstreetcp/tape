"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { LoadingState } from "./Spinner";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { compileFormula, type Series } from "@/lib/formula";

// Ratio / spread / formula chart — plot one security against another over time: A÷B (relative
// strength), A−B (spread), the ratio rebased to 100, OR an arbitrary FORMULA (e.g. MDT − 0.19 MMED
// for the implied stub value of core Medtronic ex its MiniMed stake). Every referenced leg is fetched
// live from /api/ohlc for ANY Yahoo symbol (indices ^GSPC, ETFs SPY/GLD), aligned by calendar day.

type Mode = "ratio" | "spread" | "rebased" | "formula";
const MODES: { key: Mode; label: string }[] = [
  { key: "ratio", label: "Ratio · A ÷ B" },
  { key: "spread", label: "Spread · A − B" },
  { key: "rebased", label: "Rebased · 100" },
  { key: "formula", label: "Formula ƒ(x)" },
];
const EXAMPLES = ["MDT - 0.19 MMED", "MA / SPY", "0.5 AAPL + 0.5 MSFT", "GOOGL - 0.11 SPOT"];
const RANGES: [string, number][] = [["6M", 0.5], ["1Y", 1], ["2Y", 2], ["3Y", 3], ["5Y", 5], ["10Y", 10]];
const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const clean = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 12);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function xTicks(minT: number, maxT: number, n = 5): { t: number; label: string }[] {
  if (maxT === minT) return [{ t: minT, label: "" }];
  return Array.from({ length: n }, (_, i) => {
    const t = minT + (maxT - minT) * (i / (n - 1));
    const d = new Date(t);
    return { t, label: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` };
  });
}

interface Bar { t: number; c: number }
interface Pt { t: number; v: number; ca?: number; cb?: number }
async function fetchDaily(sym: string): Promise<Bar[]> {
  const r = await fetch(`/api/ohlc/${encodeURIComponent(sym)}?years=25`).then((x) => x.json());
  return (r?.daily || []).filter((b: any) => b && b.c != null).map((b: any) => ({ t: b.t, c: b.c }));
}

export default function RatioChartView({ universe }: { universe: string }) {
  const [a, setA] = useState("NVDA");
  const [b, setB] = useState("SPY");
  const [aIn, setAIn] = useState("NVDA");
  const [bIn, setBIn] = useState("SPY");
  const [formula, setFormula] = useState("MDT - 0.19 MMED");
  const [formulaIn, setFormulaIn] = useState("MDT - 0.19 MMED");
  const [mode, setMode] = useState<Mode>("rebased");
  const [years, setYears] = useState(1);
  const [data, setData] = useState<Record<string, Bar[] | "err">>({});
  const [hi, setHi] = useState<number | null>(null);

  // The compiled formula (when in formula mode) — its tickers drive what we fetch.
  const compiled = useMemo(() => {
    if (mode !== "formula") return null;
    try { return { c: compileFormula(formula), err: null as string | null }; }
    catch (e: any) { return { c: null, err: String(e?.message || e) }; }
  }, [mode, formula]);

  const need = useMemo(() => (mode === "formula" ? compiled?.c?.tickers ?? [] : [a, b]), [mode, compiled, a, b]);

  useEffect(() => {
    for (const s of need) {
      if (data[s]) continue;
      fetchDaily(s).then((d) => setData((p) => ({ ...p, [s]: d.length ? d : "err" }))).catch(() => setData((p) => ({ ...p, [s]: "err" })));
    }
  }, [need]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (mode === "formula") { setFormula(formulaIn.trim()); return; }
    const na = clean(aIn), nb = clean(bIn); if (na) setA(na); if (nb) setB(nb);
  };
  const swap = () => { setA(b); setB(a); setAIn(b); setBIn(a); };

  // Loading / error state, per mode.
  const need0 = need;
  const missing = need0.filter((t) => !data[t]);
  const failed = need0.filter((t) => data[t] === "err");
  const loading = mode === "formula" ? (!!compiled?.c && missing.length > 0) : (!data[a] || !data[b]);
  const compileErr = mode === "formula" ? compiled?.err : null;

  const pts = useMemo<Pt[]>(() => {
    const cut = Date.now() - years * 366 * DAY;
    if (mode === "formula") {
      if (!compiled?.c) return [];
      const sd = new Map<string, Series>();
      for (const tk of compiled.c.tickers) {
        const bars = data[tk];
        if (!Array.isArray(bars)) return [];
        sd.set(tk, new Map(bars.map((x) => [dayKey(x.t), x.c])));
      }
      let res: Series;
      try { res = compiled.c.evaluate(sd); } catch { return []; }
      return [...res.entries()]
        .map(([k, v]) => ({ t: Date.parse(k + "T00:00:00Z"), v }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= cut)
        .sort((x, y) => x.t - y.t);
    }
    const aBars = data[a], bBars = data[b];
    if (!Array.isArray(aBars) || !Array.isArray(bBars)) return [];
    const mb = new Map(bBars.map((x) => [dayKey(x.t), x.c]));
    const aligned: { t: number; ca: number; cb: number }[] = [];
    for (const x of aBars) { const cb = mb.get(dayKey(x.t)); if (cb != null && cb !== 0 && x.c) aligned.push({ t: x.t, ca: x.c, cb }); }
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
  }, [mode, data, a, b, formula, compiled, years]);

  const fmt = (v: number) =>
    mode === "rebased" ? v.toFixed(1)
      : mode === "spread" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}`
        : mode === "formula" ? (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3))
          : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(3);
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const title = mode === "formula" ? formula : `${a} ${mode === "spread" ? "−" : "÷"} ${b}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader title="Ratio, Spread & Formula Charts" desc="Plot one security against another over time — relative strength (A÷B), a spread (A−B), the ratio rebased to 100, or any FORMULA (e.g. MDT − 0.19 MMED = the implied value of core Medtronic ex its MiniMed stake). Any Yahoo symbol works, including indices (^GSPC) and ETFs (SPY, GLD). Decision-support, not advice." />

      {/* mode toggle */}
      <div className="mb-3 inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
        {MODES.map((m) => <button key={m.key} onClick={() => setMode(m.key)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (mode === m.key ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{m.label}</button>)}
      </div>

      {/* inputs — formula box OR A/B pickers */}
      {mode === "formula" ? (
        <div className="mb-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Formula — any +, −, ×, ÷ of tickers &amp; numbers</span>
              <input value={formulaIn} onChange={(e) => setFormulaIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="MDT - 0.19 MMED" spellCheck={false}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-sm uppercase text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
            </label>
            <button onClick={apply} className="mb-0 rounded-md bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Plot</button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Examples</span>
            {EXAMPLES.map((ex) => <button key={ex} onClick={() => { setFormulaIn(ex); setFormula(ex); }} className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text)]">{ex}</button>)}
          </div>
        </div>
      ) : (
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
      )}

      {/* range toggle */}
      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {RANGES.map(([l, yr]) => <button key={l} onClick={() => setYears(yr)} className={"rounded-md px-2 py-1 text-xs font-medium transition-colors " + (years === yr ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{l}</button>)}
        </div>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-1 truncate text-sm font-semibold text-[var(--text-2)]">
          <span className="font-mono text-[var(--accent)]">{title}</span>
          <span className="ml-2 text-xs font-normal text-[var(--text-4)]">{MODES.find((m) => m.key === mode)!.label}</span>
        </div>
        {compileErr ? (
          <div className="py-16 text-center text-xs text-[#ef4444]">{compileErr}</div>
        ) : loading ? (
          <LoadingState className="py-16" />
        ) : failed.length ? (
          <div className="py-16 text-center text-xs text-[var(--text-3)]">Couldn&apos;t load {failed.join(", ")} — check the symbol(s).</div>
        ) : pts.length < 2 ? (
          <div className="py-16 text-center text-xs text-[var(--text-3)]">No overlapping history in this window.</div>
        ) : (
          <Chart pts={pts} mode={mode} fmt={fmt} a={a} b={b} hi={hi} setHi={setHi} />
        )}
      </section>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Daily closes aligned by calendar day. Formula mode evaluates any +, −, ×, ÷ of Yahoo tickers &amp; numbers over the overlap of their histories — e.g. a spinoff &quot;stub&quot; like MDT − 0.19 MMED. Live from Yahoo via /api/ohlc — not investment advice.</p>
    </main>
  );
}

function Chart({ pts, mode, fmt, a, b, hi, setHi }: { pts: Pt[]; mode: Mode; fmt: (v: number) => string; a: string; b: string; hi: number | null; setHi: (i: number | null) => void }) {
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
  const hp = hi != null ? pts[hi] : null;
  const refLine = mode === "rebased" ? 100 : mode === "spread" || mode === "formula" ? 0 : null;

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
      <line x1={ML} x2={W - MR} y1={H - MB} y2={H - MB} stroke="var(--border)" />
      {xTicks(minT, maxT).map((t, i) => <text key={i} x={x(t.t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize={9} fill="var(--text-4)">{t.label}</text>)}
      <path d={area} fill="url(#ratiofill)" stroke="none" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      {hp && (
        <>
          <line x1={x(hp.t)} x2={x(hp.t)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
          <circle cx={x(hp.t)} cy={y(hp.v)} r={3.5} fill="var(--accent)" />
          {(() => {
            const hasLegs = hp.ca != null && hp.cb != null;
            const boxW = 150, boxH = hasLegs ? 60 : 44, left = x(hp.t) > W - MR - boxW - 6;
            return (
              <g transform={`translate(${left ? x(hp.t) - boxW - 8 : x(hp.t) + 8},${MT})`}>
                <rect width={boxW} height={boxH} rx={6} fill="var(--bg)" stroke="var(--border)" />
                <text x={9} y={15} fontSize={11} fontWeight={600} fill="var(--text-2)">{new Date(hp.t).toISOString().slice(0, 10)}</text>
                <text x={9} y={32} fontSize={12} fontWeight={600} fill="var(--accent)">{fmt(hp.v)}</text>
                {hasLegs && <text x={9} y={48} fontSize={10} fill="var(--text-4)">{a} {hp.ca!.toFixed(2)} · {b} {hp.cb!.toFixed(2)}</text>}
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
