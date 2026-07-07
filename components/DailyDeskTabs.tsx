"use client";
import { useState, type ReactNode } from "react";

type Tab = "brief" | "wire";

// Sub-tabs for the Daily Desk: the AI desk brief and the Reuters news wire as separate views.
// Both slots are rendered (server-rendered brief keeps its markup; the self-fetching Briefing
// keeps its loaded state) and toggled with CSS, so switching tabs is instant and never refetches.
// The tab is mirrored to ?tab= so the wire view is deep-linkable (old /briefing bookmarks land there).
export default function DailyDeskTabs({ initial, brief, wire }: { initial?: string; brief: ReactNode; wire: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initial === "wire" ? "wire" : "brief");
  const pick = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "wire") u.searchParams.set("tab", "wire");
      else u.searchParams.delete("tab");
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
      </div>
      <div className={tab === "brief" ? "" : "hidden"}>{brief}</div>
      <div className={tab === "wire" ? "" : "hidden"}>{wire}</div>
    </div>
  );
}
