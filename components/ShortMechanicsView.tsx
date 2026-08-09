"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import WatchStar from "./WatchStar";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate } from "@/lib/format";
import type { ShortMechFile, ShortMechRow } from "@/lib/shortMechanics";

// /short-mechanics — the two free official short-side files Tape didn't have: FINRA daily short
// VOLUME % (activity, not interest) and SEC fails-to-deliver (delivery pressure). Distinct from the
// borrow fee and the squeeze composite.

type Sort = "shortvol" | "trend" | "ftd";
const bn = (v: number | null) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v}`);

export default function ShortMechanicsView({ universe, data }: { universe: string; data: ShortMechFile }) {
  const [sort, setSort] = useState<Sort>("shortvol");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const ql = q.trim().toUpperCase();
    let r = data.rows;
    if (ql) r = r.filter((x) => x.symbol.includes(ql) || x.name.toUpperCase().includes(ql));
    const by: Record<Sort, (a: ShortMechRow, b: ShortMechRow) => number> = {
      shortvol: (a, b) => (b.latestShortVolPct ?? -1) - (a.latestShortVolPct ?? -1),
      trend: (a, b) => (b.shortVolTrendPp ?? -1e9) - (a.shortVolTrendPp ?? -1e9),
      ftd: (a, b) => (b.ftdUsd ?? -1) - (a.ftdUsd ?? -1),
    };
    return [...r].sort(by[sort]).slice(0, 300);
  }, [data.rows, sort, q]);

  const Btn = ({ k, label }: { k: Sort; label: string }) => (
    <button onClick={() => setSort(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${sort === k ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{label}</button>
  );

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Short Mechanics"
        desc="The plumbing of short selling from the official free files: how much of each day's reported volume was executed short (FINRA), and how many shares failed to deliver (SEC). These are distinct from the borrow fee and the squeeze score — short VOLUME is daily activity (not the twice-monthly short-interest position), and fails-to-deliver flag settlement/hard-to-borrow pressure. Decision-support, not advice."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
        <span className="text-[var(--text-4)]">sort:</span>
        <Btn k="shortvol" label="Short-volume %" />
        <Btn k="trend" label="Shorting picking up" />
        <Btn k="ftd" label="Fails-to-deliver $" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ticker…" className="ml-2 w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[12px] outline-none focus:border-[var(--border-strong)]" />
        <span className="ml-auto text-[11px] text-[var(--text-4)]">short-vol to {data.shortVolAsOf ?? "—"} · FTD {data.ftdAsOf ?? "—"} · {data.rows.length} names</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">
                Short-vol % <InfoDot text="The most recent day's short-sale volume as a % of that day's reported volume (FINRA consolidated). This is short ACTIVITY on the day, NOT short interest as a % of float — a name can print high short-volume without a large short position." />
              </th>
              <th className="px-3 py-2 text-right">{data.windowDays}d avg</th>
              <th className="px-3 py-2 text-right">
                Trend <InfoDot text="Latest day minus the window average, in percentage points. Positive = shorting is picking up relative to its recent norm." />
              </th>
              <th className="px-3 py-2 text-right">
                Fails-to-deliver <InfoDot text="Dollar value of shares that failed to settle in the latest SEC semi-monthly file (fails × price). Persistent large fails flag hard-to-borrow / settlement pressure — an input to squeeze dynamics, not a position measure." />
              </th>
              <th className="px-3 py-2 text-right">FTD chg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                <td className="px-3 py-2">
                  <WatchStar symbol={r.symbol} compact />
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                  <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline">{r.name.slice(0, 34)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {r.latestShortVolPct == null ? <span className="text-[var(--text-4)]">—</span> : (
                    <span className={r.latestShortVolPct >= 60 ? "font-semibold text-[#f59e0b]" : "text-[var(--text-2)]"}>{r.latestShortVolPct}%</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.shortVolPct == null ? "—" : `${r.shortVolPct}%`}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {r.shortVolTrendPp == null ? <span className="text-[var(--text-4)]">—</span> : (
                    <span className={r.shortVolTrendPp > 0 ? "text-[#ef4444]" : "text-[var(--text-4)]"}>{r.shortVolTrendPp > 0 ? "+" : ""}{r.shortVolTrendPp}pp</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{bn(r.ftdUsd)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {r.ftdChangePct == null ? <span className="text-[var(--text-4)]">—</span> : (
                    <span className={r.ftdChangePct > 0 ? "text-[#ef4444]" : "text-[#22c55e]"}>{r.ftdChangePct > 0 ? "+" : ""}{r.ftdChangePct}%</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        FINRA short-volume is reported executions, not short interest; %&gt;100 artifacts are clamped. FTD is twice-monthly and settlement-dated (it lags). Top 300 shown. Sources: FINRA Reg SHO, SEC fails-to-deliver. Not investment advice.
      </p>
    </main>
  );
}
