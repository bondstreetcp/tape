"use client";
import { useState, type ReactNode } from "react";

type Tab = "brief" | "wire" | "filings";

// Sub-tabs for the Daily Desk — the morning workflow in one place, in reading order: the AI desk
// brief, the Reuters news wire, then Overnight Filings (2026-08, Sam: "wake up in the morning —
// what has occurred overnight since you last looked at the machine"; the filings feed was a
// separate Research page and is now the third stop). All slots render (server markup kept; the
// self-fetching Briefing keeps its loaded state) and toggle with CSS, so switching is instant and
// never refetches. The tab mirrors to ?tab= so wire/filings views are deep-linkable (old /briefing
// bookmarks land on wire).
export default function DailyDeskTabs({ initial, brief, wire, filings }: { initial?: string; brief: ReactNode; wire: ReactNode; filings?: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initial === "wire" ? "wire" : initial === "filings" && filings ? "filings" : "brief");
  const pick = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "brief") u.searchParams.delete("tab");
      else u.searchParams.set("tab", t);
      window.history.replaceState(null, "", u.toString());
    } catch { /* URL update is cosmetic */ }
  };
  const TB = (a: boolean) =>
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
    (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
        <button onClick={() => pick("brief")} className={TB(tab === "brief")} title="The AI desk brief — movers, filings, options flow, analyst actions">Desk Brief</button>
        <button onClick={() => pick("wire")} className={TB(tab === "wire")} title="Reuters Morning News Call · The Day Ahead">News Wire</button>
        {filings && <button onClick={() => pick("filings")} className={TB(tab === "filings")} title="Overnight Filings — AI desk notes on new material SEC filings vs the prior comparable">Overnight Filings</button>}
      </div>
      <div className={tab === "brief" ? "" : "hidden"}>{brief}</div>
      <div className={tab === "wire" ? "" : "hidden"}>{wire}</div>
      {filings && <div className={tab === "filings" ? "" : "hidden"}>{filings}</div>}
    </div>
  );
}
