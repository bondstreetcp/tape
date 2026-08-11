import Link from "next/link";
import type { VpLedgerFile } from "@/lib/volPremiumLedger";
import { MATURE_TD } from "@/lib/volPremiumLedger";
import { fmtDate } from "@/lib/format";

const vp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`; // vol points
const iv = (x: number) => `${(x * 100).toFixed(0)}%`;

/**
 * The forward track record for this board's rich-vol picks, graded on the short-vol axis (IV sold vs
 * realized printed) — NOT price direction. Renders the accruing state before any pick matures, then the
 * hit rate + captured stats once grades land. Honest by construction: capturedVolPts is idealized and
 * pre-cost, so the HIT RATE is the headline and the blow-ups are shown, not hidden.
 */
export default function VpLedgerPanel({ universe, ledger }: { universe: string; ledger: VpLedgerFile | null }) {
  if (!ledger) return null;
  const { open, closed, stats } = ledger;
  const recent = closed.slice(0, 8);

  return (
    <details className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)]" open={!!stats}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="text-sm font-semibold text-[var(--text)]">Does selling the rich-vol decile pay?</span>
        <span className="text-[11px] text-[var(--text-4)]">— the forward VRP-capture ledger</span>
        {stats ? (
          <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
            <span className={stats.hitRate >= 0.5 ? "text-[#22c55e]" : "text-[#ef4444]"}>
              <b>{(stats.hitRate * 100).toFixed(0)}%</b> hit
            </span>
            <span className="text-[var(--text-3)]">
              med <b style={{ color: stats.medianCaptured >= 0 ? "#22c55e" : "#ef4444" }}>{vp(stats.medianCaptured)}</b> vol-pts
            </span>
            <span className="hidden text-[var(--text-4)] sm:inline">n={stats.n}</span>
          </span>
        ) : (
          <span className="ml-auto text-xs text-[var(--text-4)]">grading accrues →</span>
        )}
      </summary>

      <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-2)]">
        <p className="mb-3 text-[var(--text-3)]">
          Each night the {open.length ? <b className="text-[var(--text-2)]">top {open.length}</b> : "top"} liquid, non-earnings <b className="text-[var(--text-2)]">rich-vol</b> picks are frozen at
          the ATM IV you&apos;d have <b className="text-[var(--text-2)]">sold</b>; {MATURE_TD} trading days later they&apos;re graded against the realized
          vol that actually printed. A premium seller wins when <b className="text-[var(--text-2)]">IV&nbsp;sold &gt; realized</b> — regardless of
          which way the stock went. Rich vol is often rich for a <i>reason</i> (a catalyst the earnings filter
          can&apos;t see); this ledger measures whether the decile pays anyway.
        </p>

        {stats ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Hit rate" value={`${(stats.hitRate * 100).toFixed(0)}%`} sub="IV sold > realized" good={stats.hitRate >= 0.5} />
              <Stat label="Median captured" value={`${vp(stats.medianCaptured)} pts`} sub="annualized vol" good={stats.medianCaptured >= 0} />
              <Stat label="Premium kept" value={`${(stats.medianCapturedFrac * 100).toFixed(0)}%`} sub="of IV sold, median" good={stats.medianCapturedFrac >= 0} />
              <Stat label="Graded" value={`${stats.n}`} sub="closed picks" />
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[560px] text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-left text-[var(--text-4)]">
                    <th className="px-2.5 py-1.5 font-medium">Recent grades</th>
                    <th className="px-2 py-1.5 text-right font-medium">Frozen</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="ATM IV you'd have sold">IV sold</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Realized vol that printed over the holding window">RV printed</th>
                    <th className="px-2.5 py-1.5 text-right font-medium" title="IV sold − realized printed (idealized vol points, pre-cost)">Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={`${c.symbol}-${c.entryDate}`} className="border-b border-[var(--divider)] last:border-0">
                      <td className="px-2.5 py-1.5">
                        <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{c.symbol}</Link>
                        <span className="ml-1.5 text-[var(--text-4)]">{c.won ? "✓" : "✕"}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-4)]">{fmtDate(c.entryDate)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{iv(c.atmIVEntry)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{iv(c.rvRealized)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums font-semibold" style={{ color: c.capturedVolPts >= 0 ? "#22c55e" : "#ef4444" }}>{vp(c.capturedVolPts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {stats.worst[0] && stats.worst[0].capturedVolPts < 0 && (
              <p className="mt-2 text-[11px] text-[var(--text-4)]">
                Biggest blow-up: <span className="font-mono text-[var(--text-3)]">{stats.worst[0].symbol}</span> gave back{" "}
                <b className="text-[#ef4444]">{vp(stats.worst[0].capturedVolPts)}</b> vol-pts ({fmtDate(stats.worst[0].entryDate)}) — realized blew past the implied. That&apos;s the tail the hit rate already prices in.
              </p>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text-3)]">
            <b className="text-[var(--text-2)]">{open.length} picks frozen{open[0]?.entryDate ? ` ${fmtDate(open[0].entryDate)}` : ""}.</b> First grades land in ~{MATURE_TD} trading days —
            the ledger is forward-only, so the track record builds from here.
          </p>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-4)]">
          <b className="text-[var(--text-3)]">Captured</b> = IV sold − realized printed, in annualized vol points — the <i>idealized</i>,
          delta-hedged straddle seller&apos;s edge. It is an upper bound: real fills sell at the bid (not mid),
          hedge discretely, and carry gamma/vega path, so live P&amp;L captures less. Read the <b className="text-[var(--text-3)]">hit rate</b> as
          the honest signal. Not investment advice.
        </p>
      </div>
    </details>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="text-base font-bold tabular-nums" style={good === undefined ? { color: "var(--text)" } : { color: good ? "#22c55e" : "#ef4444" }}>{value}</div>
      <div className="text-[10px] text-[var(--text-4)]">{sub}</div>
    </div>
  );
}
