"use client";
import { useState } from "react";
import {
  type EnergyData, type EnergySeries, ENERGY_GROUP_ORDER, ENERGY_TOOLTIPS,
  fmtEnergy, fmtChange, fmtPct, changeColor, buildDraw, tintColor,
} from "@/lib/energy";

function Spark({ points }: { points: [string, number][] }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 116, H = 28, pad = 2;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => (max === min ? H / 2 : pad + (1 - (v - min) / (max - min)) * (H - 2 * pad));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <path d={d} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

function Info({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((o) => !o)}
        className="ml-1 grid h-3.5 w-3.5 place-items-center rounded-full border border-[var(--border-strong)] text-[9px] leading-none text-[var(--text-4)] hover:text-[var(--text-2)]"
        aria-label="What is this?"
      >i</button>
      {open && (
        <span className="absolute left-1/2 top-5 z-20 w-60 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[11px] font-normal normal-case leading-snug text-[var(--text-2)] shadow-xl">{text}</span>
      )}
    </span>
  );
}

function Card({ s }: { s: EnergySeries }) {
  const isPrice = s.group === "Prices";
  const isInv = s.group === "Inventories";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center text-[12px] font-semibold text-[var(--text)]">
            <span className="truncate" title={s.label}>{s.label}</span>
            <Info text={ENERGY_TOOLTIPS[s.key]} />
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold leading-none tabular-nums text-[var(--text)]">{fmtEnergy(s.latest, s.unit)}</span>
            <span className="text-[10px] text-[var(--text-4)]">{s.unit}</span>
          </div>
        </div>
        <Spark points={s.history} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        {isPrice && (
          <>
            <span><b className="text-[var(--text-4)]">WoW</b> <span className="tabular-nums" style={{ color: s.signMode ? changeColor(s.wowPct, s.signMode) : tintColor(s.wowPct) }}>{fmtPct(s.wowPct)}</span></span>
            <span><b className="text-[var(--text-4)]">YoY</b> <span className="tabular-nums" style={{ color: s.signMode ? changeColor(s.yoyPct, s.signMode) : tintColor(s.yoyPct) }}>{fmtPct(s.yoyPct)}</span></span>
          </>
        )}
        {isInv && (
          <>
            <span title="Week-over-week change in the inventory level">
              <b className="text-[var(--text-4)]">{buildDraw(s.wow)}</b>{" "}
              <span className="tabular-nums" style={{ color: s.wow == null ? "var(--text-3)" : s.wow > 0 ? "#f59e0b" : "#22c55e" }}>{fmtChange(s.wow, s.unit)}</span>
            </span>
            {s.vsSeasonalPct != null && (
              <span title="Level vs the ~5-year average for this time of year">
                <b className="text-[var(--text-4)]">vs 5-yr</b>{" "}
                <span className="tabular-nums" style={{ color: s.vsSeasonalPct < -5 ? "#f59e0b" : "var(--text-3)" }}>{fmtPct(s.vsSeasonalPct)}</span>
              </span>
            )}
          </>
        )}
        {!isPrice && !isInv && (
          <>
            <span><b className="text-[var(--text-4)]">WoW</b> <span className="tabular-nums" style={{ color: changeColor(s.wow, s.signMode) }}>{fmtChange(s.wow, s.unit)}</span></span>
            <span><b className="text-[var(--text-4)]">YoY</b> <span className="tabular-nums" style={{ color: changeColor(s.yoyPct, s.signMode) }}>{fmtPct(s.yoyPct)}</span></span>
          </>
        )}
      </div>
    </div>
  );
}

export default function EnergyPanel({ data }: { data: EnergyData | null }) {
  if (!data || !data.series.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">
        Building the energy board — populates on the next nightly refresh.
      </div>
    );
  }
  const asOf = data.asOf ? new Date(data.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const hasEia = data.series.some((s) => s.source === "EIA");
  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--text-3)]">
        The oil &amp; gas complex as a real-economy read — benchmark &amp; retail <b className="text-[var(--text-2)]">prices</b>, the EIA weekly <b className="text-[var(--text-2)]">inventory</b> build/draw vs its seasonal norm, and <b className="text-[var(--text-2)]">supply &amp; demand</b> (production, refinery runs, and product supplied = implied demand). {asOf ? `As of ${asOf}.` : ""}
      </p>
      <div className="space-y-4">
        {ENERGY_GROUP_ORDER.map((g) => {
          const rows = data.series.filter((s) => s.group === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{g}</div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map((s) => <Card key={s.key} s={s} />)}
              </div>
            </div>
          );
        })}
      </div>
      {!hasEia && (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-3 text-[12px] leading-relaxed text-[var(--text-3)]">
          <b className="text-[var(--text-2)]">The EIA weekly balance is pending.</b> Inventories (crude / gasoline / distillate / nat-gas storage) and supply &amp; demand (production, refinery utilization, implied demand) fill in once a free{" "}
          <a href="https://www.eia.gov/opendata/register.php" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">EIA_API_KEY</a> is set on the data box + as a GitHub Actions secret. Prices above are live and need no key.
        </div>
      )}
      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        Sources: prices from FRED (St. Louis Fed, keyless); the weekly balance from the U.S. EIA (Weekly Petroleum Status Report &amp; Natural Gas Storage Report). Inventory build/draw and level vs the ~5-yr seasonal norm are the standard reads. Decision-support, not investment advice.
      </p>
    </div>
  );
}
