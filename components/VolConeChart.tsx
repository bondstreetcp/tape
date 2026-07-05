"use client";
import { useState, useEffect, useMemo } from "react";
import type { ConeBand } from "@/lib/volCone";
import InfoDot from "./InfoDot";

// The realized-vol CONE with the live implied-vol term structure overlaid: is the option pricing vol above
// or below where this name's realized vol has actually lived, tenor by tenor? Realized cone from the stored
// series (/api/vol-cone); the IV term points are passed in (the Options tab already fetched them).

const CW = 520, CH = 210, ML = 34, MR = 10, MT = 24, MB = 22;
const CAL = 365 / 252; // trading days → calendar days
const pctv = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const HLABEL: Record<number, string> = { 10: "2w", 21: "1m", 63: "3m", 126: "6m", 252: "1y" };

type IvPt = { dte: number; atmIV: number | null };

export default function VolConeChart({ symbol, ivTerm }: { symbol: string; ivTerm: IvPt[] | null }) {
  const [bands, setBands] = useState<ConeBand[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let off = false;
    setBands(null); setErr(false);
    fetch(`/api/vol-cone/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (off) return; if (Array.isArray(d?.bands) && d.bands.length) setBands(d.bands); else setErr(true); })
      .catch(() => { if (!off) setErr(true); });
    return () => { off = true; };
  }, [symbol]);

  const iv = useMemo(() => (ivTerm ?? []).filter((p) => p.atmIV != null && p.atmIV > 0 && p.dte >= 5 && p.dte <= 420) as { dte: number; atmIV: number }[], [ivTerm]);

  if (err) return null; // no history → hide the whole section (parent shows nothing)
  if (!bands) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="py-6 text-center text-xs text-[var(--text-3)]">Loading realized-vol cone…</div></div>;

  const cal = (h: number) => h * CAL;
  const xs = bands.map((b) => cal(b.h)).concat(iv.map((p) => p.dte));
  const dMin = Math.min(...bands.map((b) => cal(b.h)));
  const dMax = Math.max(cal(bands[bands.length - 1].h), ...iv.map((p) => p.dte), dMin + 1);
  const vals = bands.flatMap((b) => [b.min, b.max, b.cur ?? b.med]).concat(iv.map((p) => p.atmIV)).filter((v): v is number => v != null);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = (vMax - vMin) * 0.12 || 0.02;
  vMin = Math.max(0, vMin - pad); vMax += pad;

  const lx = (d: number) => Math.log(Math.max(1, d));
  const X = (d: number) => ML + ((lx(d) - lx(dMin)) / (lx(dMax) - lx(dMin) || 1)) * (CW - ML - MR);
  const Y = (v: number) => MT + (1 - (v - vMin) / (vMax - vMin || 1)) * (CH - MT - MB);

  const area = (top: (b: ConeBand) => number, bot: (b: ConeBand) => number) => {
    let d = "";
    bands.forEach((b, i) => { d += `${i ? "L" : "M"}${X(cal(b.h)).toFixed(1)} ${Y(top(b)).toFixed(1)}`; });
    for (let i = bands.length - 1; i >= 0; i--) d += `L${X(cal(bands[i].h)).toFixed(1)} ${Y(bot(bands[i])).toFixed(1)}`;
    return d + "Z";
  };
  const poly = (get: (b: ConeBand) => number | null) => {
    let d = "";
    for (const b of bands) { const v = get(b); if (v == null) continue; d += `${d ? "L" : "M"}${X(cal(b.h)).toFixed(1)} ${Y(v).toFixed(1)}`; }
    return d;
  };
  const ivPath = (() => { let d = ""; for (const p of iv.slice().sort((a, b) => a.dte - b.dte)) d += `${d ? "L" : "M"}${X(p.dte).toFixed(1)} ${Y(p.atmIV).toFixed(1)}`; return d; })();

  // Headline: 1-month (≈21 trading-day) IV vs the 21d realized cone.
  const b21 = bands.find((b) => b.h === 21);
  const iv30 = iv.length ? iv.reduce((a, b) => (Math.abs(b.dte - 30) < Math.abs(a.dte - 30) ? b : a)).atmIV : null;
  const ratio = b21?.med != null && b21.med > 0 && iv30 != null ? iv30 / b21.med : null;
  const verdict = ratio == null ? null : ratio >= 1.15 ? { t: "rich", c: "#f59e0b" } : ratio <= 0.9 ? { t: "cheap", c: "#22c55e" } : { t: "fair", c: "var(--text-3)" };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-[var(--text-2)]">Realized-vol cone <InfoDot term="Realized vol cone" /> · vs implied</span>
        {verdict && (
          <span className="text-[11px] text-[var(--text-4)]">
            1m implied <span className="font-mono text-[var(--text-2)]">{pctv(iv30)}</span> vs realized median <span className="font-mono text-[var(--text-2)]">{pctv(b21?.med)}</span> → <span className="font-semibold" style={{ color: verdict.c }}>{verdict.t}</span>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" style={{ height: "auto" }}>
        {/* y grid */}
        {[0, 0.5, 1].map((f, i) => { const v = vMin + f * (vMax - vMin); return (
          <g key={i}>
            <line x1={ML} x2={CW - MR} y1={Y(v)} y2={Y(v)} stroke="var(--surface-hover)" />
            <text x={ML - 4} y={Y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-4)">{(v * 100).toFixed(0)}%</text>
          </g>
        ); })}
        {/* cone: min→max (light), p25→p75 (darker), median */}
        <path d={area((b) => b.max, (b) => b.min)} fill="var(--accent)" opacity={0.1} />
        <path d={area((b) => b.p75, (b) => b.p25)} fill="var(--accent)" opacity={0.18} />
        <path d={poly((b) => b.med)} fill="none" stroke="var(--text-4)" strokeWidth={1.2} strokeDasharray="4 3" />
        {/* current realized vol */}
        <path d={poly((b) => b.cur)} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
        {bands.map((b) => b.cur == null ? null : <circle key={b.h} cx={X(cal(b.h))} cy={Y(b.cur)} r={2.4} fill="var(--accent)" />)}
        {/* implied vol term structure overlay */}
        {ivPath && <path d={ivPath} fill="none" stroke="#f59e0b" strokeWidth={1.8} />}
        {iv.map((p, i) => <circle key={i} cx={X(p.dte)} cy={Y(p.atmIV)} r={2.4} fill="#f59e0b" />)}
        {/* x labels at the horizon anchors */}
        {bands.map((b) => <text key={b.h} x={X(cal(b.h))} y={CH - 5} textAnchor="middle" fontSize={8} fill="var(--text-4)">{HLABEL[b.h] ?? `${b.h}d`}</text>)}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-4)]">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[var(--accent)] opacity-30" /> realized range (min–max, 25–75)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[var(--accent)]" /> current realized</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#f59e0b]" /> implied (ATM by tenor)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 border-t border-dashed border-[var(--text-4)]" /> median</span>
      </div>
    </div>
  );
}
