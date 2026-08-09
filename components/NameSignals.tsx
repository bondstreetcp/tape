"use client";
import Link from "next/link";
import { SIGNAL_META, type SignalKey } from "@/lib/signalLog";
import InfoDot from "./InfoDot";

// "Signals on this name" — the stock page's board-membership strip (2026-08 workflow-sharpening
// #4). Landing here from the Idea Inbox used to LOSE the "why it surfaced" context; this strip
// restores it in both directions: which boards carry the name RIGHT NOW, when it arrived, and the
// board's own graded 1-month edge. Server-computed from the same signal log /signal-record grades
// (no fetch here — the page passes the rows); renders nothing when no board carries the name.

export interface NameSignal {
  signal: SignalKey;
  onBoard: boolean; // in the board's membership at the last nightly run
  arrived: string | null; // YYYY-MM-DD of the most recent (non-seed) arrival, if inside ~90d
  m1Edge: number | null; // the board's graded 1-month direction-adjusted edge vs SPX (null = unproven)
}

export default function NameSignals({ universe, signals }: { universe: string; signals: NameSignal[] }) {
  if (!signals.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Signals on this name</span>
      <InfoDot text="The idea boards currently carrying this name (from the same nightly log /signal-record grades), with each arrival date and the board's graded 1-month edge vs the S&P. Decision-support, not a rating." />
      {signals.map((s) => {
        const meta = SIGNAL_META[s.signal];
        return (
          <Link
            key={s.signal}
            href={`/u/${universe}${meta.path}`}
            title={`${meta.desc}${s.arrived ? ` · arrived ${s.arrived}` : ""}${s.m1Edge != null ? ` · board's 1m edge ${s.m1Edge >= 0 ? "+" : ""}${s.m1Edge.toFixed(1)}% (graded)` : " · record still maturing"}`}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium hover:underline"
            style={{ color: meta.color, background: `color-mix(in oklab, ${meta.color} 13%, transparent)` }}
          >
            {meta.label}
            {s.arrived && <span className="opacity-75"> · {s.arrived.slice(5)}</span>}
          </Link>
        );
      })}
    </div>
  );
}
