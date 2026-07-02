"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { discountColor, discountStats, type HoldcoNav } from "@/lib/holdco";

type Xref = Record<string, { slug: string; name: string; discount: number | null }>;

const ccySym = (c: string) => ({ EUR: "€", USD: "$", GBP: "£", SEK: "kr ", JPY: "¥", CAD: "C$", ZAR: "R" } as Record<string, string>)[c] || c + " ";
const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const moneyM = (v: number | null, ccy: string) => (v == null ? "—" : `${v < 0 ? "−" : ""}${ccySym(ccy)}${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.abs(v).toFixed(0) + "M"}`);
const RANGES: [string, number][] = [["1Y", 1], ["2Y", 2], ["3Y", 3], ["Max", 0]];
const DAY = 86_400_000;

export default function HoldcoDetailView({ h, universe, xref = {} }: { h: HoldcoNav; universe: string; xref?: Xref }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [years, setYears] = useState(0);
  const [hov, setHov] = useState<number | null>(null); // shared hover index across both charts
  const cur = h.currency;
  const ds = useMemo(() => discountStats(h.history), [h.history]);

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

      {/* cheap vs own history — percentile + multi-window z */}
      {ds.pctile != null && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-3)]">
          <span className="text-[var(--text-4)]">Cheap vs own history:</span>
          <span><b style={{ color: ds.pctile <= 15 ? "#22c55e" : ds.pctile >= 85 ? "#ef4444" : "var(--text)" }}>{ds.pctile.toFixed(0)}ᵗʰ percentile</b> <span className="text-[var(--text-4)]">of its 3yr discount range</span></span>
          {ds.z6m != null && <span>z <b style={{ color: ds.z6m <= -1 ? "#22c55e" : "var(--text-2)" }}>{ds.z6m >= 0 ? "+" : ""}{ds.z6m.toFixed(1)}</b> 6m</span>}
          {ds.z1y != null && <span>z <b style={{ color: ds.z1y <= -1 ? "#22c55e" : "var(--text-2)" }}>{ds.z1y >= 0 ? "+" : ""}{ds.z1y.toFixed(1)}</b> 1y</span>}
          {ds.z3y != null && <span>z <b style={{ color: ds.z3y <= -1 ? "#22c55e" : "var(--text-2)" }}>{ds.z3y >= 0 ? "+" : ""}{ds.z3y.toFixed(1)}</b> 3y</span>}
        </div>
      )}

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
            <BasketChart pts={pts} cur={cur} discountUp={(h.discount ?? 0) < 0} hov={hov} setHov={setHov} />
          </section>

          <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-1 text-sm font-semibold text-[var(--text-2)]">Discount / premium to NAV over time</div>
            <DiscountChart pts={pts} cur={cur} hov={hov} setHov={setHov} />
          </section>
        </>
      )}

      {/* constituents */}
      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--text-2)]">Look-through basket · {moneyM(h.navM, cur)} NAV</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-xs">
          <tbody>
            {h.stakes.map((s) => {
              const dd = xref[s.ticker];
              return (
              <tr key={s.ticker} className="border-b border-[var(--divider)] last:border-0">
                <td className="py-1.5 text-[var(--text-2)]">{s.name} <span className="font-mono text-[10px] text-[var(--text-4)]">{s.ticker}</span>
                  {dd && dd.slug !== h.slug && dd.discount != null && (
                    <Link href={`/u/${universe}/holdco-nav/${dd.slug}`} className="ml-1.5 rounded-full bg-[#22c55e1a] px-1.5 py-px text-[9px] font-medium text-[#22c55e] hover:underline" title={`${dd.name} is itself a tracked holdco trading at ${dd.discount.toFixed(0)}% to its own NAV — a double discount: this stake is already marked at a discounted price`}>↳ double discount · {dd.discount >= 0 ? "+" : ""}{dd.discount.toFixed(0)}% own NAV</Link>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-3)]">{moneyM(s.valueM, cur)}</td>
                <td className="w-32 py-1.5 pl-3">
                  <div className="h-2 w-full overflow-hidden rounded bg-[var(--bg)]"><div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${Math.max(2, Math.min(100, s.pctOfNav ?? 0))}%` }} /></div>
                </td>
                <td className="w-10 py-1.5 pl-2 text-right tabular-nums text-[var(--text-4)]">{s.pctOfNav != null ? `${s.pctOfNav}%` : "—"}</td>
              </tr>
              );
            })}
            <tr>
              <td className="py-1.5 text-[var(--text-4)]">Other / private / cash (static, {h.asOf})</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-4)]">{moneyM(h.otherNavM, cur)}</td>
              <td colSpan={2} className="py-1.5 pl-2 text-right text-[var(--text-4)]">net {h.netDebtM <= 0 ? "cash" : "debt"} {moneyM(Math.abs(h.netDebtM), cur)}</td>
            </tr>
          </tbody>
        </table></div>
        {h.note && <p className="mt-2.5 text-[11px] leading-snug text-[var(--text-4)]">{h.note}</p>}
        <p className="mt-1.5 text-[10px] text-[var(--text-4)]">Stake prices + FX live; net debt / private NAV / share counts are estimates — verify against the holdco&apos;s NAV statement. Not investment advice.</p>
      </section>
    </main>
  );
}

interface Pt { t: number; nav: number; price: number; disc: number }
type HoverProps = { hov: number | null; setHov: (i: number | null) => void };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function xTicks(minT: number, maxT: number, n = 5): { t: number; label: string }[] {
  if (maxT === minT) return [{ t: minT, label: "" }];
  const out: { t: number; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = minT + (maxT - minT) * (i / (n - 1));
    const d = new Date(t);
    out.push({ t, label: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` });
  }
  return out;
}
// Transparent per-point hit-targets that drive the shared hover index.
function HoverLayer({ pts, x, ML, MR, MT, MB, W, H, setHov }: { pts: Pt[]; x: (t: number) => number; ML: number; MR: number; MT: number; MB: number; W: number; H: number; setHov: (i: number | null) => void }) {
  const half = (W - ML - MR) / Math.max(1, pts.length - 1) / 2;
  return <>{pts.map((p, i) => <rect key={i} x={x(p.t) - half} y={MT} width={Math.max(1, half * 2)} height={H - MT - MB} fill="transparent" onMouseEnter={() => setHov(i)} />)}</>;
}

function BasketChart({ pts, cur, discountUp, hov, setHov }: { pts: Pt[]; cur: string; discountUp: boolean } & HoverProps) {
  const W = 880, H = 320, ML = 52, MR = 14, MT = 14, MB = 26;
  const minT = pts[0].t, maxT = pts[pts.length - 1].t;
  const vals = pts.flatMap((p) => [p.nav, p.price]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x = (t: number) => ML + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const navPath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.nav).toFixed(1)}`).join("");
  const pricePath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`).join("");
  const area = navPath + " " + pts.slice().reverse().map((p) => `L${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ") + " Z";
  const yTicks = [hi, (lo + hi) / 2, lo];
  const gapColor = discountUp ? "#22c55e" : "#ef4444";
  const hp = hov != null && hov < pts.length ? pts[hov] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHov(null)}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" />
          <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{ccySym(cur)}{v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(v < 20 ? 1 : 0)}</text>
        </g>
      ))}
      {/* x-axis */}
      <line x1={ML} x2={W - MR} y1={H - MB} y2={H - MB} stroke="var(--border)" />
      {xTicks(minT, maxT).map((t, i) => <text key={i} x={x(t.t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize={9} fill="var(--text-4)">{t.label}</text>)}
      <path d={area} fill={gapColor} fillOpacity={0.1} stroke="none" />
      <path d={navPath} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      <path d={pricePath} fill="none" stroke="var(--text-2)" strokeWidth={1.8} />
      {hp && (
        <>
          <line x1={x(hp.t)} x2={x(hp.t)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
          <circle cx={x(hp.t)} cy={y(hp.nav)} r={3.5} fill="var(--accent)" />
          <circle cx={x(hp.t)} cy={y(hp.price)} r={3.5} fill="var(--text-2)" />
          {(() => {
            const boxW = 172, boxH = 76, left = x(hp.t) > W - MR - boxW - 6;
            return (
              <g transform={`translate(${left ? x(hp.t) - boxW - 8 : x(hp.t) + 8},${MT})`}>
                <rect width={boxW} height={boxH} rx={6} fill="var(--bg)" stroke="var(--border)" />
                <text x={9} y={16} fontSize={11} fontWeight={600} fill="var(--text-2)">{new Date(hp.t).toISOString().slice(0, 10)}</text>
                <text x={9} y={33} fontSize={11} fill="var(--text-3)"><tspan fill="var(--accent)" fontSize={13}>●</tspan> NAV/sh {ccySym(cur)}{hp.nav.toFixed(2)}</text>
                <text x={9} y={49} fontSize={11} fill="var(--text-3)"><tspan fill="var(--text-2)" fontSize={13}>●</tspan> Price {ccySym(cur)}{hp.price.toFixed(2)}</text>
                <text x={9} y={67} fontSize={11} fontWeight={600} fill={hp.disc < 0 ? "#22c55e" : "#ef4444"}>{hp.disc >= 0 ? "+" : ""}{hp.disc.toFixed(1)}% {hp.disc < 0 ? "discount" : "premium"}</text>
              </g>
            );
          })()}
        </>
      )}
      <HoverLayer pts={pts} x={x} ML={ML} MR={MR} MT={MT} MB={MB} W={W} H={H} setHov={setHov} />
    </svg>
  );
}

function DiscountChart({ pts, cur, hov, setHov }: { pts: Pt[]; cur: string } & HoverProps) {
  const W = 880, H = 160, ML = 52, MR = 14, MT = 12, MB = 24;
  const minT = pts[0].t, maxT = pts[pts.length - 1].t;
  const vals = pts.map((p) => p.disc);
  // ±1σ "normal range" band over the visible window — makes 'stretched' legible at a glance.
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  let lo = Math.min(...vals, mean - sd, 0), hi = Math.max(...vals, mean + sd, 0);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const x = (t: number) => ML + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.disc).toFixed(1)}`).join("");
  const area = path + ` L${x(maxT).toFixed(1)} ${y(0).toFixed(1)} L${x(minT).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const color = pts[pts.length - 1].disc < 0 ? "#22c55e" : "#ef4444";
  const yTicks = [hi, 0, lo].filter((v, i, a) => a.indexOf(v) === i);
  const hp = hov != null && hov < pts.length ? pts[hov] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHov(null)}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--text-4)" : "var(--surface-hover)"} strokeOpacity={v === 0 ? 0.5 : 1} strokeDasharray={v === 0 ? "4 3" : undefined} />
          <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{v >= 0 ? "+" : ""}{v.toFixed(0)}%</text>
        </g>
      ))}
      {xTicks(minT, maxT).map((t, i) => <text key={i} x={x(t.t)} y={H - 7} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize={9} fill="var(--text-4)">{t.label}</text>)}
      {/* ±1σ normal-range band + median — current line below the band = stretched */}
      <rect x={ML} y={y(mean + sd)} width={W - ML - MR} height={Math.max(0, y(mean - sd) - y(mean + sd))} fill="var(--text-4)" fillOpacity={0.1} />
      <line x1={ML} x2={W - MR} y1={y(mean)} y2={y(mean)} stroke="var(--text-4)" strokeOpacity={0.6} strokeDasharray="2 3" />
      <text x={W - MR - 2} y={y(mean + sd) - 3} textAnchor="end" fontSize={8.5} fill="var(--text-4)">±1σ normal range (mean {mean.toFixed(0)}%)</text>
      <path d={area} fill={color} fillOpacity={0.12} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
      {hp && (
        <>
          <line x1={x(hp.t)} x2={x(hp.t)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
          <circle cx={x(hp.t)} cy={y(hp.disc)} r={3} fill={hp.disc < 0 ? "#22c55e" : "#ef4444"} />
          <text x={x(hp.t) > W - 70 ? x(hp.t) - 6 : x(hp.t) + 6} y={y(hp.disc) - 6} textAnchor={x(hp.t) > W - 70 ? "end" : "start"} fontSize={11} fontWeight={600} fill={hp.disc < 0 ? "#22c55e" : "#ef4444"}>{hp.disc >= 0 ? "+" : ""}{hp.disc.toFixed(1)}%</text>
        </>
      )}
      <HoverLayer pts={pts} x={x} ML={ML} MR={MR} MT={MT} MB={MB} W={W} H={H} setHov={setHov} />
    </svg>
  );
}
