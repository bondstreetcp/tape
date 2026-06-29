"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { discountColor, type HoldcoNav } from "@/lib/holdco";

const ccySym = (c: string) => ({ EUR: "€", USD: "$", GBP: "£", SEK: "kr ", JPY: "¥", CAD: "C$", ZAR: "R" } as Record<string, string>)[c] || c + " ";
const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const moneyM = (v: number | null, ccy: string) => (v == null ? "—" : `${v < 0 ? "−" : ""}${ccySym(ccy)}${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.abs(v).toFixed(0) + "M"}`);
const RANGES: [string, number][] = [["1Y", 1], ["2Y", 2], ["3Y", 3], ["Max", 0]];
const DAY = 86_400_000;

export default function HoldcoDetailView({ h, universe }: { h: HoldcoNav; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [years, setYears] = useState(0);
  const cur = h.currency;

  const pts = useMemo(() => {
    const cutoff = years ? Date.now() - years * 366 * DAY : 0;
    return h.history
      .filter((x) => Date.parse(x[0]) >= cutoff)
      .map(([d, nav, price]) => ({ t: Date.parse(d), nav, price, disc: nav ? (price / nav - 1) * 100 : 0 }));
  }, [h.history, years]);

  const col = discountColor(h.discount);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}/holdco-nav`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Holdco NAV tracker</Link>
      <div className="mt-1" />
      <PageHeader title={h.name} desc={`Look-through NAV vs. the share price — the "basket" (sum of its stakes + private assets − net debt) against what the market pays for the holdco. The gap is the discount/premium; watch it widen and narrow. ${uname} · ${h.ticker}.`} />

      {/* headline stats */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Discount", val: pct(h.discount), color: col, big: true },
          { label: "NAV / share", val: h.navPerShare == null ? "—" : `${ccySym(cur)}${h.navPerShare}` },
          { label: "Price", val: h.price == null ? "—" : `${ccySym(cur)}${h.price}` },
          { label: "z-score", val: h.z1y == null ? "—" : `${h.z1y}`, color: h.stretched ? "#22c55e" : "var(--text)" },
          { label: "Mark-to-mkt", val: h.coveragePct == null ? "—" : `${h.coveragePct}%` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">{s.label}</div>
            <div className={"mt-0.5 font-bold tabular-nums " + (s.big ? "text-2xl" : "text-base")} style={{ color: s.color || "var(--text)" }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-end gap-1">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {RANGES.map(([l, yr]) => <button key={l} onClick={() => setYears(yr)} className={"rounded-md px-2 py-1 text-xs font-medium transition-colors " + (years === yr ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{l}</button>)}
        </div>
      </div>

      {pts.length < 2 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--text-3)]">No history for this holdco yet — run the nightly refresh.</div>
      ) : (
        <>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-1 flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[var(--accent)]" /> NAV / share (basket)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-[var(--text-2)]" /> Share price</span>
              <span className="ml-auto text-[var(--text-4)]">{ccySym(cur)} per share</span>
            </div>
            <BasketChart pts={pts} cur={cur} discountUp={(h.discount ?? 0) < 0} />
          </section>

          <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-1 text-sm font-semibold text-[var(--text-2)]">Discount / premium to NAV over time</div>
            <DiscountChart pts={pts} />
          </section>
        </>
      )}

      {/* constituents */}
      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--text-2)]">Look-through basket · {moneyM(h.navM, cur)} NAV</div>
        <table className="w-full text-xs">
          <tbody>
            {h.stakes.map((s) => (
              <tr key={s.ticker} className="border-b border-[var(--divider)] last:border-0">
                <td className="py-1.5 text-[var(--text-2)]">{s.name} <span className="font-mono text-[10px] text-[var(--text-4)]">{s.ticker}</span></td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-3)]">{moneyM(s.valueM, cur)}</td>
                <td className="w-32 py-1.5 pl-3">
                  <div className="h-2 w-full overflow-hidden rounded bg-[var(--bg)]"><div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${Math.max(2, Math.min(100, s.pctOfNav ?? 0))}%` }} /></div>
                </td>
                <td className="w-10 py-1.5 pl-2 text-right tabular-nums text-[var(--text-4)]">{s.pctOfNav != null ? `${s.pctOfNav}%` : "—"}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5 text-[var(--text-4)]">Other / private / cash (static, {h.asOf})</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-4)]">{moneyM(h.otherNavM, cur)}</td>
              <td colSpan={2} className="py-1.5 pl-2 text-right text-[var(--text-4)]">net {h.netDebtM <= 0 ? "cash" : "debt"} {moneyM(Math.abs(h.netDebtM), cur)}</td>
            </tr>
          </tbody>
        </table>
        {h.note && <p className="mt-2.5 text-[11px] leading-snug text-[var(--text-4)]">{h.note}</p>}
        <p className="mt-1.5 text-[10px] text-[var(--text-4)]">Stake prices + FX live; net debt / private NAV / share counts are estimates — verify against the holdco&apos;s NAV statement. Not investment advice.</p>
      </section>
    </main>
  );
}

interface Pt { t: number; nav: number; price: number; disc: number }

function BasketChart({ pts, cur, discountUp }: { pts: Pt[]; cur: string; discountUp: boolean }) {
  const W = 880, H = 320, ML = 52, MR = 14, MT = 14, MB = 24;
  const minT = pts[0].t, maxT = pts[pts.length - 1].t;
  const vals = pts.flatMap((p) => [p.nav, p.price]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x = (t: number) => ML + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const navPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.nav).toFixed(1)}`).join("");
  const pricePath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`).join("");
  // shaded gap between nav (top) and price = the discount
  const area = navPath + " " + pts.slice().reverse().map((p) => `L${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ") + " Z";
  const yTicks = [hi, (lo + hi) / 2, lo];
  const yrs: number[] = [];
  for (let yr = new Date(minT).getUTCFullYear(); yr <= new Date(maxT).getUTCFullYear(); yr++) yrs.push(yr);
  const gapColor = discountUp ? "#22c55e" : "#ef4444";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" />
          <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{ccySym(cur)}{v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(v < 20 ? 1 : 0)}</text>
        </g>
      ))}
      {yrs.map((yr) => { const tx = x(Date.parse(`${yr}-01-01`)); return tx >= ML && tx <= W - MR ? <text key={yr} x={tx} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-4)">{yr}</text> : null; })}
      <path d={area} fill={gapColor} fillOpacity={0.1} stroke="none" />
      <path d={navPath} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      <path d={pricePath} fill="none" stroke="var(--text-2)" strokeWidth={1.8} />
    </svg>
  );
}

function DiscountChart({ pts }: { pts: Pt[] }) {
  const W = 880, H = 150, ML = 52, MR = 14, MT = 12, MB = 22;
  const minT = pts[0].t, maxT = pts[pts.length - 1].t;
  const vals = pts.map((p) => p.disc);
  let lo = Math.min(...vals, 0), hi = Math.max(...vals, 0);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = (t: number) => ML + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.disc).toFixed(1)}`).join("");
  const area = path + ` L${x(maxT).toFixed(1)} ${y(0).toFixed(1)} L${x(minT).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const cur = pts[pts.length - 1].disc;
  const color = cur < 0 ? "#22c55e" : "#ef4444";
  const yTicks = [hi, 0, lo].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--text-4)" : "var(--surface-hover)"} strokeOpacity={v === 0 ? 0.5 : 1} strokeDasharray={v === 0 ? "4 3" : undefined} />
          <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{v >= 0 ? "+" : ""}{v.toFixed(0)}%</text>
        </g>
      ))}
      <path d={area} fill={color} fillOpacity={0.12} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
    </svg>
  );
}
