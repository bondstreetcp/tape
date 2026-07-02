"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import type { SmartMoneyName } from "@/lib/smartMoney";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");

type Tab = "all" | "dip" | "13f" | "congress";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dip", label: "Buying the dip" },
  { id: "13f", label: "Super-investors (13F)" },
  { id: "congress", label: "Congress" },
];

export default function SmartMoneyView({ names, universe, asOf, limit = 80 }: { names: SmartMoneyName[]; universe: string; asOf: string | null; limit?: number }) {
  const [tab, setTab] = useState<Tab>("all");
  const filtered = useMemo(
    () => names.filter((n) => (tab === "all" ? true : tab === "dip" ? n.buyingDip : tab === "13f" ? n.investors.length > 0 : !!n.congress)).slice(0, limit),
    [names, tab, limit],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Smart-Money Radar"
        desc="Who's quietly accumulating — names where super-investors initiated or added last quarter (13F) and/or members of Congress are net buyers. The ⤓ dip badge flags names being bought while they're down. Follow-the-money, not advice."
      />

      <div className="mb-4 inline-flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={"rounded-md px-2.5 py-1 transition-colors " + (tab === t.id ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3 text-xs text-[var(--text-4)]">{filtered.length} names{asOf ? ` · 13F as of latest filings · ${asOf}` : ""}</div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No matches for these filters — try loosening them.</div>
      )}
      <ul className="space-y-2.5">
        {filtered.map((n) => (
          <li key={n.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-xs font-bold text-[var(--accent)]" title="Conviction score">{n.score}</span>
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{n.symbol}</Link>
                  <span className="truncate text-sm text-[var(--text-3)]">{n.name}</span>
                  {n.buyingDip && <span className="rounded-full bg-[rgba(34,197,94,.14)] px-1.5 py-0.5 text-[10px] font-semibold text-[#22c55e]">⤓ buying the dip</span>}
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-4)]">{n.sector || "—"} · {money(n.marketCap)}</div>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div className="tabular-nums" style={{ color: col(n.retYtd) }}>{pct(n.retYtd)} <span className="text-[var(--text-4)]">YTD</span></div>
                <div className="tabular-nums text-[var(--text-3)]">{pct(n.pctFromHigh)} <span className="text-[var(--text-4)]">vs high</span></div>
              </div>
            </div>

            {n.investors.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {n.investors.map((b, i) => (
                  <span key={i} className="rounded-full bg-[rgba(167,139,250,.14)] px-2 py-0.5 text-[11px] font-medium text-[#a78bfa]">
                    {b.manager} {b.action === "initiated" ? "initiated" : `added${b.deltaPct ? ` +${Math.round(b.deltaPct)}%` : ""}`}
                  </span>
                ))}
              </div>
            )}
            {n.congress && (
              <div className="mt-1.5 text-[11px] text-[#60a5fa]">
                ● Congress: {n.congress.buys} buys vs {n.congress.sells} sells · {n.congress.members} member{n.congress.members > 1 ? "s" : ""} (150d)
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
