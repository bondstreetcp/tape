"use client";
import { useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { discountColor, type HoldcoNav, type HoldcoNavData } from "@/lib/holdco";

const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const moneyM = (v: number | null, ccy: string) => (v == null ? "—" : `${v < 0 ? "−" : ""}${ccySym(ccy)}${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.abs(v).toFixed(0) + "M"}`);
const ccySym = (c: string) => ({ EUR: "€", USD: "$", GBP: "£", SEK: "kr", JPY: "¥" } as Record<string, string>)[c] || c + " ";

function Spark({ hist, color }: { hist: [string, number, number][]; color: string }) {
  if (hist.length < 2) return null;
  const vals = hist.map(([, nav, price]) => (nav ? (price / nav - 1) * 100 : 0));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const W = 200, H = 36;
  const x = (i: number) => (i / (hist.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const d = hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h[1]).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

function Card({ h, universe }: { h: HoldcoNav; universe: string }) {
  const [open, setOpen] = useState(false);
  const col = discountColor(h.discount);
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link href={`/u/${universe}/holdco-nav/${h.slug}`} className="font-semibold text-[var(--text)] hover:text-[var(--accent)]">{h.name} →</Link>
            <span className="font-mono text-xs text-[var(--text-4)]">{h.ticker}</span>
            {h.stretched && <span className="rounded-full bg-[#22c55e1a] px-1.5 py-0.5 text-[10px] font-medium text-[#22c55e]">Stretched · z {h.z1y}</span>}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-4)]">
            NAV {ccySym(h.currency)}{h.navPerShare} · price {ccySym(h.currency)}{h.price} · {h.coveragePct ?? "—"}% mark-to-market
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold tabular-nums" style={{ color: col }}>{pct(h.discount)}</div>
          <div className="text-[10px] text-[var(--text-4)]">{h.discount != null && h.discount < 0 ? "discount to NAV" : "premium to NAV"}</div>
        </div>
      </div>

      <Link href={`/u/${universe}/holdco-nav/${h.slug}`} className="group mt-2 block" title="Open the full NAV-vs-price + discount-over-time chart">
        <div className="flex items-center justify-between text-[10px] text-[var(--text-4)]">
          <span>Discount history (1yr)</span>
          <span className="text-[var(--accent)] group-hover:underline">📈 Discount chart →</span>
        </div>
        <Spark hist={h.history} color={col} />
      </Link>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-4)]">
        <span>look-through NAV {moneyM(h.navM, h.currency)} · net {h.netDebtM <= 0 ? "cash" : "debt"} {moneyM(Math.abs(h.netDebtM), h.currency)} · other {moneyM(h.otherNavM, h.currency)}</span>
        <button onClick={() => setOpen((v) => !v)} className="shrink-0 text-[var(--accent)] hover:underline">{open ? "hide" : "stakes"}</button>
      </div>

      {open && (
        <div className="mt-2 border-t border-[var(--divider)] pt-2">
          <ul className="space-y-1">
            {h.stakes.map((s) => (
              <li key={s.ticker} className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="text-[var(--text-2)]">{s.name} <span className="font-mono text-[10px] text-[var(--text-4)]">{s.ticker}</span></span>
                <span className="tabular-nums text-[var(--text-3)]">{moneyM(s.valueM, h.currency)}{s.pctOfNav != null && <span className="ml-1 text-[var(--text-4)]">({s.pctOfNav}% of NAV)</span>}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-2 text-[12px] text-[var(--text-4)]">
              <span>Other / private / cash (static, {h.asOf})</span>
              <span className="tabular-nums">{moneyM(h.otherNavM, h.currency)}</span>
            </li>
          </ul>
          {h.note && <p className="mt-2 text-[11px] leading-snug text-[var(--text-4)]">{h.note}</p>}
        </div>
      )}
    </li>
  );
}

export default function HoldcoNavView({ data, universe }: { data: HoldcoNavData; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Holdco NAV / Discount Tracker"
        desc="Holding companies vs their look-through net asset value — Σ(listed stakes) + private assets − net debt, against the holdco's own price. The discount is the whole game; 'stretched' flags a discount unusually wide vs its own recent history (z ≤ −1). Same idea as the CEF Discount Hunter. Decision-support, not advice."
      />
      <ul className="space-y-3">
        {data.holdcos.map((h) => <Card key={h.slug} h={h} universe={universe} />)}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-4)]">
        Stake prices + FX fetched live; the discount history rebuilds each stake&apos;s price with current FX held constant. <strong>Net debt, private/other NAV, share counts and stake weights are SEED ESTIMATES</strong> (as of each holdco&apos;s noted date) and should be verified against the company&apos;s published NAV statement before trading — they&apos;re a clearly-editable table in <code className="rounded bg-[var(--surface-2)] px-1">lib/holdco.ts</code>. &quot;% mark-to-market&quot; = how much of NAV is live listed value vs static private/cash. As of {data.asOf}.
      </p>
    </main>
  );
}
