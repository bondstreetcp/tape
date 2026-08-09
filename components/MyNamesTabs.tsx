"use client";
import { useState, type ReactNode } from "react";

type Tab = "ledger" | "quotes" | "radar";

// Sub-tabs for My Names — the monitoring leg consolidated (2026-08 UX pass #6): the Change Ledger
// (what changed), Quotes (the watchlist table), and Radar (forward catalysts on the union). Same
// CSS-toggle pattern as DailyDeskTabs: all panes render once, switching is instant, ?tab= deep-links.
export default function MyNamesTabs({ initial, ledger, quotes, radar }: { initial?: string; ledger: ReactNode; quotes: ReactNode; radar?: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initial === "quotes" ? "quotes" : initial === "radar" && radar ? "radar" : "ledger");
  const pick = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "ledger") u.searchParams.delete("tab");
      else u.searchParams.set("tab", t);
      window.history.replaceState(null, "", u.toString());
    } catch { /* cosmetic */ }
  };
  const TB = (a: boolean) =>
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
    (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
        <button onClick={() => pick("ledger")} className={TB(tab === "ledger")} title="Everything that changed in your names since you last looked">Ledger</button>
        <button onClick={() => pick("quotes")} className={TB(tab === "quotes")} title="The watchlist quotes table">Quotes</button>
        {radar && <button onClick={() => pick("radar")} className={TB(tab === "radar")} title="Forward catalysts on your names, soonest first">Radar</button>}
      </div>
      <div className={tab === "ledger" ? "" : "hidden"}>{ledger}</div>
      <div className={tab === "quotes" ? "" : "hidden"}>{quotes}</div>
      {radar && <div className={tab === "radar" ? "" : "hidden"}>{radar}</div>}
    </div>
  );
}
