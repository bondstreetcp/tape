"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SECTORS } from "@/lib/sectors";
import HowToRead from "./HowToRead";

const BENCH = "SPY";
const WINDOW = 60; // trading days for the relative-strength ratio
const MOM = 10; // days for relative-strength momentum
const TAIL = 6; // trajectory points
const STEP = 5; // ~weekly spacing for the tail

type Series = [number, number][]; // [t, close]
interface Pt { etf: string; name: string; x: number; y: number; tail: { x: number; y: number }[] }

const quad = (x: number, y: number) =>
  x >= 100
    ? y >= 100 ? { name: "Leading", color: "#22c55e" } : { name: "Weakening", color: "#f59e0b" }
    : y >= 100 ? { name: "Improving", color: "#60a5fa" } : { name: "Lagging", color: "#ef4444" };

/** Simplified Relative Rotation Graph of the 11 SPDR sectors vs SPY:
 *  x = relative strength (sector/SPY over ~60d), y = its 10-day momentum. */
export default function SectorRotation({ universe }: { universe: string }) {
  const [series, setSeries] = useState<Record<string, Series>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const syms = [BENCH, ...SECTORS.map((s) => s.etf)];
    Promise.all(
      syms.map((sym) =>
        fetch(`/api/ohlc/${encodeURIComponent(sym)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => [sym, ((d?.daily || []) as any[]).map((b) => [b.t, b.c] as [number, number])] as const)
          .catch(() => [sym, [] as Series] as const),
      ),
    ).then((rows) => { if (alive) { setSeries(Object.fromEntries(rows)); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const pts = useMemo<Pt[]>(() => {
    const bench = series[BENCH];
    if (!bench || bench.length < WINDOW + MOM + STEP * TAIL) return [];
    const bm = new Map(bench.map(([t, c]) => [t, c]));
    const out: Pt[] = [];
    for (const sec of SECTORS) {
      const s = series[sec.etf];
      if (!s) continue;
      const rs: number[] = [];
      for (const [t, c] of s) { const b = bm.get(t); if (b) rs.push(c / b); }
      const n = rs.length;
      if (n < WINDOW + MOM + STEP * (TAIL - 1) + 1) continue;
      const ratioAt = (i: number) => (rs[i - WINDOW] ? (rs[i] / rs[i - WINDOW]) * 100 : 100);
      const momAt = (i: number) => { const a = ratioAt(i), b = ratioAt(i - MOM); return b ? (a / b) * 100 : 100; };
      const tail: { x: number; y: number }[] = [];
      for (let k = TAIL - 1; k >= 0; k--) {
        const i = n - 1 - k * STEP;
        if (i - WINDOW - MOM >= 0) tail.push({ x: ratioAt(i), y: momAt(i) });
      }
      if (!tail.length) continue;
      const last = tail[tail.length - 1];
      out.push({ etf: sec.etf, name: sec.name, x: last.x, y: last.y, tail });
    }
    return out;
  }, [series]);

  const allX = pts.flatMap((p) => p.tail.map((t) => t.x));
  const allY = pts.flatMap((p) => p.tail.map((t) => t.y));
  const xr = Math.max(1, 100 - Math.min(...allX, 100), Math.max(...allX, 100) - 100) + 0.4;
  const yr = Math.max(1, 100 - Math.min(...allY, 100), Math.max(...allY, 100) - 100) + 0.4;
  const X0 = 100 - xr, X1 = 100 + xr, Y0 = 100 - yr, Y1 = 100 + yr;
  const W = 480, H = 440, M = 38;
  const sx = (x: number) => M + ((x - X0) / (X1 - X0)) * (W - 2 * M);
  const sy = (y: number) => H - M - ((y - Y0) / (Y1 - Y0)) * (H - 2 * M);
  const cx = sx(100), cy = sy(100);
  const ranked = [...pts].sort((a, b) => b.x - a.x);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Home</Link>
        <h1 className="mt-1 text-2xl font-bold">Sector Rotation (RRG)</h1>
        <p className="mt-1 text-xs text-[var(--text-3)]">11 SPDR sectors vs SPY — relative strength (x) and its momentum (y). Sectors rotate clockwise: Improving → Leading → Weakening → Lagging.</p>
      </header>

      <HowToRead>
        <p>This is a <b>Relative Rotation Graph (RRG)</b> — a map of which S&amp;P sectors are leading or lagging the market, and which way each is heading.</p>
        <p><b>X-axis (RS-Ratio):</b> the sector&apos;s price relative to SPY over the last ~60 trading days, scaled so <b>100 = moving with the market</b>. Right of center = outperforming; left = lagging.</p>
        <p><b>Y-axis (RS-Momentum):</b> the 10-day rate of change of that relative strength. Above center = the outperformance is <i>accelerating</i>; below = fading.</p>
        <p><b>Quadrants:</b> <b style={{ color: "#22c55e" }}>Leading</b> (strong &amp; strengthening) → <b style={{ color: "#f59e0b" }}>Weakening</b> (strong but fading) → <b style={{ color: "#ef4444" }}>Lagging</b> (weak &amp; weakening) → <b style={{ color: "#60a5fa" }}>Improving</b> (weak but turning up). Sectors tend to rotate clockwise; the tail behind each dot is its last ~6 weeks of travel.</p>
        <p><b>How to use it:</b> favor Leading/Improving sectors, go light on Weakening/Lagging — context for positioning, not a standalone signal. Click a row to open that sector&apos;s constituents.</p>
      </HowToRead>

      {loading ? (
        <div className="py-20 text-center text-sm text-[var(--text-3)]">Computing rotation…</div>
      ) : pts.length === 0 ? (
        <div className="py-20 text-center text-sm text-[var(--text-3)]">Not enough data to compute rotation.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[480px_1fr]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
              <rect x={cx} y={M} width={W - M - cx} height={cy - M} fill="#22c55e" opacity={0.06} />
              <rect x={cx} y={cy} width={W - M - cx} height={H - M - cy} fill="#f59e0b" opacity={0.06} />
              <rect x={M} y={cy} width={cx - M} height={H - M - cy} fill="#ef4444" opacity={0.06} />
              <rect x={M} y={M} width={cx - M} height={cy - M} fill="#60a5fa" opacity={0.06} />
              <line x1={cx} y1={M} x2={cx} y2={H - M} stroke="var(--border-strong)" strokeDasharray="3 3" />
              <line x1={M} y1={cy} x2={W - M} y2={cy} stroke="var(--border-strong)" strokeDasharray="3 3" />
              <text x={W - M - 4} y={M + 12} textAnchor="end" fontSize={10} fontWeight={700} fill="#22c55e">LEADING</text>
              <text x={W - M - 4} y={H - M - 5} textAnchor="end" fontSize={10} fontWeight={700} fill="#f59e0b">WEAKENING</text>
              <text x={M + 4} y={H - M - 5} fontSize={10} fontWeight={700} fill="#ef4444">LAGGING</text>
              <text x={M + 4} y={M + 12} fontSize={10} fontWeight={700} fill="#60a5fa">IMPROVING</text>
              <text x={W / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--text-4)">RS-Ratio →</text>
              {pts.map((p) => {
                const q = quad(p.x, p.y);
                const path = p.tail.map((t, i) => `${i ? "L" : "M"}${sx(t.x).toFixed(1)} ${sy(t.y).toFixed(1)}`).join("");
                return (
                  <g key={p.etf}>
                    <path d={path} fill="none" stroke={q.color} strokeWidth={1.3} strokeOpacity={0.55} />
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={q.color} />
                    <text x={sx(p.x) + 6} y={sy(p.y) + 3} fontSize={9} fontWeight={700} fill="var(--text)" stroke="var(--surface)" strokeWidth={2.2} paintOrder="stroke">{p.etf}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--text-3)]">
                  <th className="px-3 py-2 text-left font-medium">Sector</th>
                  <th className="px-3 py-2 text-right font-medium">RS-Ratio</th>
                  <th className="px-3 py-2 text-right font-medium">RS-Mom</th>
                  <th className="px-3 py-2 text-right font-medium">Quadrant</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((p) => {
                  const q = quad(p.x, p.y);
                  return (
                    <tr key={p.etf} className="border-b border-[var(--divider)] last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/u/${universe}/sector/${p.etf.toLowerCase()}`} className="hover:underline">
                          <span className="font-mono text-[var(--text-3)]">{p.etf}</span> {p.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: p.x >= 100 ? "#22c55e" : "#ef4444" }}>{p.x.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: p.y >= 100 ? "#22c55e" : "#ef4444" }}>{p.y.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: q.color, background: q.color + "1a" }}>{q.name}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">RS-Ratio = sector price relative to SPY over ~60 trading days (100 = in line with the market); RS-Momentum = the 10-day change in RS-Ratio. Tails trace the last ~6 weeks. A simplified Relative Rotation Graph — for context, not a signal.</p>
    </main>
  );
}
