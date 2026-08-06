"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate } from "@/lib/format";
import type { GovContractsFile, GovContractRow } from "@/lib/govContracts";

// /gov-contracts — federal contract-award momentum per government-exposed public company. Obligations
// are a hard, forward-looking revenue read months ahead of the earnings that report them.

type Sort = "ttm" | "yoy" | "latest";

const bn = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`);

function Spark({ points }: { points: { q: string; amount: number; partial?: boolean }[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.amount), 1);
  const w = 74, h = 20, dx = w / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * dx).toFixed(1)},${(h - (p.amount / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label="quarterly obligations trend">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export default function GovContractsView({ universe, data }: { universe: string; data: GovContractsFile }) {
  const [sort, setSort] = useState<Sort>("yoy");
  const rows = useMemo(() => {
    const by: Record<Sort, (a: GovContractRow, b: GovContractRow) => number> = {
      ttm: (a, b) => b.ttmObligated - a.ttmObligated,
      yoy: (a, b) => (b.yoyPct ?? -1e9) - (a.yoyPct ?? -1e9),
      latest: (a, b) => b.latestQuarterAmount - a.latestQuarterAmount,
    };
    return [...data.rows].sort(by[sort]);
  }, [data.rows, sort]);

  const Btn = ({ k, label }: { k: Sort; label: string }) => (
    <button onClick={() => setSort(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${sort === k ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{label}</button>
  );

  return (
    <main className="mx-auto max-w-[76rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Government Contracts"
        desc="Federal contract-award momentum for government-exposed public companies, from USAspending.gov (the public federal-spending record). Contract obligations are a hard, public read on a company's government revenue — and they land months before the earnings that report them. The roster is a hand-verified map of names to their federal recipient identity, so a row is real or it isn't shown. Decision-support, not advice."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
        <span className="text-[var(--text-4)]">sort:</span>
        <Btn k="yoy" label="YoY momentum" />
        <Btn k="ttm" label="Trailing-12mo $" />
        <Btn k="latest" label="Latest quarter" />
        <span className="ml-auto text-[11px] text-[var(--text-4)]">{data.rows.length} of {data.rosterSize} roster names · {fmtDate(data.generatedAt)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2 text-right">
                Trailing 12mo <InfoDot text="Total federal contract dollars OBLIGATED to this company in the last four fiscal quarters (definitive contracts + task/delivery orders). Obligations are money the government has committed — a leading read on recognized revenue." />
              </th>
              <th className="px-3 py-2 text-right">
                YoY <InfoDot text="Trailing-12mo obligations vs the four quarters before that. Rising obligations flag a growing federal backlog; falling ones a shrinking one — ahead of the earnings that report it." />
              </th>
              <th className="px-3 py-2">Trend (8q)</th>
              <th className="px-3 py-2 text-right">Latest qtr</th>
              <th className="px-3 py-2">Top agencies (12mo)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.ticker}</Link>
                  <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline">{r.name}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{bn(r.ttmObligated)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {r.yoyPct == null ? <span className="text-[var(--text-4)]">—</span> : (
                    <span className={r.yoyPct >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>{r.yoyPct >= 0 ? "+" : ""}{r.yoyPct}%</span>
                  )}
                </td>
                <td className="px-3 py-2"><Spark points={r.quarters} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{bn(r.latestQuarterAmount)}<span className="ml-1 text-[10px] text-[var(--text-4)]">{r.latestQuarter}</span></td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.topAgencies.slice(0, 3).map((a) => (
                      <span key={a.name} className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]" title={`${a.name}: ${bn(a.amount)}`}>{a.name}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Obligations ≠ revenue and ≠ new bookings — a large IDV ceiling can obligate in lumps. Read the trend, not a single quarter. Source: USAspending.gov. Not investment advice.
      </p>
    </main>
  );
}
