import Link from "next/link";
import InfoDot from "./InfoDot";
import { loadBoardRecord } from "@/lib/boardRecord";
import { HORIZONS, type SignalKey } from "@/lib/signalLog";

// The receipts, on the board making the claim. Every idea board's picks are already logged and
// graded nightly against the S&P (/signal-record); this strip surfaces THAT board's own numbers
// where a visitor actually is — the funda-gap #1 asymmetry: competitors pitch ideas, we grade ours
// in public. Server component: pages pass it into their View's `record` slot (rendered under the
// PageHeader), so the client Views never touch the filesystem.
//
// Honest by construction: renders nothing until the board has at least one graded horizon (a new
// board shows no fake zeros), n is always shown, and the strip links to the full scorecard rather
// than summarizing selectively.

const pct = (v: number | null | undefined, signed = true) =>
  v == null ? "—" : `${signed && v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

const WIN_WORD: Record<string, string> = {
  bullish: "up",
  bearish: "down",
  move: "moved more than the S&P",
};

export default async function BoardTrackRecord({ universe, signal }: { universe: string; signal: SignalKey | SignalKey[] }) {
  const rows = await loadBoardRecord(signal);
  const graded = rows.filter((r) => Object.values(r.summary.horizons).some((h) => h && h.n > 0));
  if (!graded.length) return null;

  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
      {graded.map((r) => {
        const hs = HORIZONS.map((h) => ({ ...h, s: r.summary.horizons[h.key] })).filter((h) => h.s && h.s.n > 0);
        return (
          <div key={r.signal} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-relaxed">
            <span className="flex items-center gap-1.5 font-semibold text-[var(--text-2)]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
              This board&apos;s record
              {graded.length > 1 && <span className="font-normal text-[var(--text-4)]">({r.label})</span>}
              <InfoDot
                text={`Every night this board's picks are logged and later graded at each horizon. "Hit" = the pick went ${WIN_WORD[r.direction]}; "vs S&P" = its return minus the S&P over the same window. Grading code is shared with the Signal Track Record page, so the numbers can't diverge.`}
              />
            </span>
            {hs.map(({ key, label, s }) => (
              <span key={key} className="text-[var(--text-3)]">
                <span className="text-[var(--text-4)]">{label}:</span>{" "}
                <span className="font-medium text-[var(--text-2)]">{s!.hitRate == null ? "—" : `${Math.round(s!.hitRate * 100)}% hit`}</span>
                {s!.avgExcess != null && <> · {pct(s!.avgExcess)} vs S&P</>}
                <span className="text-[var(--text-4)]"> (n={s!.n})</span>
              </span>
            ))}
            <Link href={`/u/${universe}/signal-record`} className="ml-auto whitespace-nowrap text-[var(--accent)] hover:underline">
              Full record →
            </Link>
          </div>
        );
      })}
    </section>
  );
}
