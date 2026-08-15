"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import type { IdeaInbox, IdeaRow } from "@/lib/ideaInbox";
import UniverseSwitcher from "./UniverseSwitcher";
import WatchStar from "./WatchStar";
import InfoDot from "./InfoDot";

// Idea Inbox view — arrivals fused by name, board-record-weighted. The chips ARE the explanation:
// which board flagged it, how long ago, and what that board's graded word is worth. One-click ☆
// hands a name to My Names monitoring — the workflow handoff the boards never had.

type DirF = "all" | "bullish" | "bearish" | "move" | "contested";
const DIR_BADGE: Record<Exclude<DirF, "all">, { label: string; cls: string }> = {
  bullish: { label: "Bullish", cls: "bg-[#22c55e]/15 text-[#22c55e]" },
  bearish: { label: "Bearish", cls: "bg-[#ef4444]/15 text-[#ef4444]" },
  move: { label: "Big move", cls: "bg-[#2dd4bf]/15 text-[#2dd4bf]" },
  contested: { label: "Contested", cls: "bg-[#f59e0b]/18 text-[#f59e0b]" },
};

export default function IdeaInboxView({ universe, inbox, generatedAt }: { universe: string; inbox: IdeaInbox; generatedAt: string }) {
  const [windowF, setWindowF] = useState<3 | 7 | 14>(7);
  const [dirF, setDirF] = useState<DirF>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return inbox.rows.filter((r) => {
      // The window toggle keeps a row while its FRESHEST arrival is inside the window (the score
      // stays the server's 14d computation — the toggle narrows attention, it doesn't re-rank).
      if ((r.arrivals[0]?.daysAgo ?? 99) > windowF) return false;
      if (dirF !== "all" && r.direction !== dirF) return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [inbox.rows, windowF, dirF, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const proven = inbox.weights.filter((w) => w.n > 0).sort((a, b) => b.weight - a.weight);

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Idea Inbox</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            What just <b>arrived</b> across the idea boards, fused by name — each board&apos;s vote weighted by its own graded record on <Link href={`/u/${universe}/signal-record`} className="text-[var(--accent)] hover:underline">/signal-record</Link> (edge vs the S&amp;P at the board&apos;s own best horizon; unproven boards get a small neutral weight). Star a name to hand it to <Link href={`/u/${universe}/my-names`} className="text-[var(--accent)] hover:underline">My Names</Link> monitoring. As of {fmtDateTime(generatedAt)} · decision-support, not advice.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-4)]">
        <span className="font-semibold uppercase tracking-wide">Board weights</span>
        <InfoDot text="Each board's direction-adjusted edge vs the S&P at its own BEST horizon (1w/1m/3m — the horizon where its measured edge is strongest; a fast board like Revisions earns its edge inside 1-2 weeks, a slow one compounds to a month). Negative records floor at zero; boards without ~15 graded picks at any horizon get a neutral 0.5." />
        {proven.length > 0 ? (
          proven.map((w) => (
            <span key={w.signal} title={`${w.n} graded picks at the ${w.horizon ?? "?"} horizon`}>
              <span style={{ color: w.color }}>{w.label}</span> {w.weight.toFixed(1)}
              {w.horizon && <span className="text-[var(--text-4)]">@{w.horizon}</span>}
            </span>
          ))
        ) : (
          <span>all boards still maturing — arrivals count equally (neutral 0.5) until a board has ~15 graded picks at some horizon; the weights differentiate on their own as <Link href={`/u/${universe}/signal-record`} className="text-[var(--accent)] hover:underline">the record</Link> fills.</span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {([3, 7, 14] as const).map((d) => <button key={d} onClick={() => setWindowF(d)} className={TB(windowF === d)}>{d}d</button>)}
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {(["all", "bullish", "bearish", "move", "contested"] as DirF[]).map((d) => (
            <button key={d} onClick={() => setDirF(d)} className={TB(dirF === d)}>{d === "all" ? "All" : DIR_BADGE[d].label}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} name{rows.length !== 1 ? "s" : ""} · fresh arrivals ≤{windowF}d</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          No board arrivals inside this window — widen it, or check back after tonight&apos;s run.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r: IdeaRow) => {
            const badge = DIR_BADGE[r.direction as Exclude<DirF, "all">];
            return (
              <div key={r.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <WatchStar symbol={r.symbol} compact />
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono text-sm font-bold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <span className="max-w-[18rem] truncate text-xs text-[var(--text-3)]">{r.name}</span>
                  {r.sector && <span className="text-[11px] text-[var(--text-4)]">{r.sector}</span>}
                  {badge && <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + badge.cls}>{badge.label}</span>}
                  <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-[var(--text-2)]" title="Sum of each arrival's board weight × freshness (newer counts more)">{r.score.toFixed(1)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {r.arrivals.map((a, i) => (
                    <Link key={i} href={`/u/${universe}${a.path}`} title={`Appeared ${a.date}${a.note ? ` · ${a.note}` : ""} · board weight ${a.weight.toFixed(1)}`}
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium hover:underline"
                      style={{ color: a.color, background: `color-mix(in oklab, ${a.color} 13%, transparent)` }}>
                      {a.label} · {a.daysAgo === 0 ? "today" : `${a.daysAgo}d`}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-[var(--text-4)]">
        An &quot;arrival&quot; is a name newly appearing on a board, from the same log /signal-record grades — flicker-guarded (a one-night dip off a board doesn&apos;t re-count) and logged before the outcome is known. Contested = bullish and bearish boards flagged the same name; that disagreement is itself worth a look.
      </p>
    </main>
  );
}
