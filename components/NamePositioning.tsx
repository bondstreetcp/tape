"use client";
import { useEffect, useState } from "react";
import InfoDot from "./InfoDot";
import { POS_CATALYST_META, type PositioningRow } from "@/lib/positioning";

const money = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}mn`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}k`;
  return `$${a.toFixed(0)}`;
};
const leanMeta = (l: PositioningRow["lean"]) =>
  l === "calls" ? { label: "call-leaning", color: "#22c55e" } : l === "puts" ? { label: "put-leaning", color: "#ef4444" } : { label: "two-way", color: "var(--text-3)" };

function Stat({ label, value, color, tip }: { label: string; value: string; color?: string; tip?: string }) {
  return (
    <div className="min-w-[80px]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">{label}{tip && <InfoDot text={tip} />}</div>
      <div className="font-mono text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

// Per-name slice of the Positioning Radar for the Options tab: today's option flow rolled up for this
// name — net call vs put premium, the directional (OTM) lean, new positioning (vol > OI), and the dated
// catalyst it's being positioned into. Self-fetches /api/positioning/[symbol]; renders nothing (returns
// null) while loading or when the name has no notable flow today, so most pages just don't show it.
export default function NamePositioning({ symbol }: { symbol: string }) {
  const [d, setD] = useState<{ row: PositioningRow } | "loading" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setD("loading");
    fetch(`/api/positioning/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setD(j && !j.error && j.row ? j : "error"); })
      .catch(() => alive && setD("error"));
    return () => { alive = false; };
  }, [symbol]);

  if (d === "loading" || d === "error") return null; // no notable flow for this name today → stay hidden

  const r = d.row;
  const lean = leanMeta(r.lean);
  const cat = r.catalyst ? POS_CATALYST_META[r.catalyst.kind] : null;
  const callPctW = r.totalPrem > 0 ? (r.callPrem / r.totalPrem) * 100 : 50;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          Options positioning<InfoDot text="Today's single-stock option FLOW rolled up for this name — net call vs put premium, the directional (OTM) lean, and how much is NEW positioning (volume > open interest). Shows only when this name traded notable flow today." />{" "}
          <span className="font-normal" style={{ color: lean.color }}>· {lean.label}</span>
        </h3>
        {cat && r.catalyst && (
          <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `${cat.color}22`, color: cat.color }} title={`${r.catalyst.label} in ${r.catalyst.daysTo}d${r.catalyst.impliedMovePct != null ? ` · implied ±${r.catalyst.impliedMovePct.toFixed(1)}%` : ""} — flow is positioning into this event`}>
            {cat.label} · {r.catalyst.daysTo}d
          </span>
        )}
      </div>

      <div className="mb-2">
        <div className="mb-0.5 flex justify-between text-[11px] tabular-nums">
          <span style={{ color: "#22c55e" }}>calls {money(r.callPrem)}</span>
          <span className="text-[var(--text-4)]">{money(r.totalPrem)} total</span>
          <span style={{ color: "#ef4444" }}>puts {money(r.putPrem)}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-[var(--bg)]">
          <div className="h-full bg-[#22c55e]/70" style={{ width: `${callPctW}%` }} />
          <div className="h-full bg-[#ef4444]/70" style={{ width: `${100 - callPctW}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat label="OTM calls" value={money(r.otmCallPrem)} color="#22c55e" tip="OTM call premium — directional / leverage upside bets (excludes ITM delta-one)." />
        <Stat label="OTM puts" value={money(r.otmPutPrem)} color="#ef4444" tip="OTM put premium — downside / hedging bets." />
        <Stat label="New (vol>OI)" value={money(r.unusualPrem)} tip="Premium in contracts where today's volume exceeded open interest — fresh positioning, not rolls." />
        <Stat label="Contracts" value={`${r.contractsN}`} tip={`${r.strikesN} strike${r.strikesN === 1 ? "" : "s"} · ${r.expiriesN} expir${r.expiriesN === 1 ? "y" : "ies"}${r.nearDte != null ? ` · soonest ${r.nearDte}dte` : ""}`} />
      </div>

      {r.topContracts.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-4)]">Biggest tickets</div>
          <div className="space-y-0.5">
            {r.topContracts.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono tabular-nums" style={{ color: c.type === "call" ? "#22c55e" : "#ef4444" }}>{c.type === "call" ? "C" : "P"} ${c.strike}</span>
                <span className="font-mono tabular-nums text-[var(--text-4)]">{c.dte != null ? `${c.dte}dte` : c.expiry || ""}</span>
                {c.otm && <span className="text-[10px] text-[var(--text-4)]">OTM</span>}
                {c.unusual && <span className="rounded bg-[var(--surface-2)] px-1 text-[10px] text-[#f59e0b]">new</span>}
                <span className="ml-auto font-mono tabular-nums text-[var(--text-3)]">{money(c.premium)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] text-[var(--text-4)]">
        Single-stock option flow rolled up per name; OTM premium = directional bets (ITM delta-one excluded from the lean). New = today&apos;s volume &gt; open interest. A positioning read, not a signal.
      </p>
    </div>
  );
}
