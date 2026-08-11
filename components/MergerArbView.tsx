"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import WatchStar from "./WatchStar";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate } from "@/lib/format";
import { daysUntil } from "@/lib/calendar";
import type { MergerArbFile, MergerArbRow } from "@/lib/mergerArb";

// /merger-arb — live cash-merger spreads from definitive proxies. Deal price vs current price =
// the annualized return for holding to close; the risk is the deal breaking.

type Sort = "annualized" | "spread" | "close";
type SizeF = "all" | "sub500" | "sub1b";
const SIZE_CAP: Record<SizeF, number> = { all: Infinity, sub500: 500e6, sub1b: 1e9 };
const dealMoney = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : `$${Math.round(v / 1e3)}K`;

export default function MergerArbView({ universe, data }: { universe: string; data: MergerArbFile }) {
  const [sort, setSort] = useState<Sort>("annualized");
  const [sizeF, setSizeF] = useState<SizeF>("all");
  const rows = useMemo(() => {
    const by: Record<Sort, (a: MergerArbRow, b: MergerArbRow) => number> = {
      annualized: (a, b) => (b.annualizedPct ?? -1e9) - (a.annualizedPct ?? -1e9),
      spread: (a, b) => (b.spreadPct ?? -1e9) - (a.spreadPct ?? -1e9),
      close: (a, b) => (a.expectedClose || "9999").localeCompare(b.expectedClose || "9999"),
    };
    // Size filter: a null dealValue (Yahoo omitted shares) is "unknown size" — shown, never hidden.
    const cap = SIZE_CAP[sizeF];
    const filtered = sizeF === "all" ? data.rows : data.rows.filter((r) => r.dealValue == null || r.dealValue < cap);
    return [...filtered].sort(by[sort]);
  }, [data.rows, sort, sizeF]);
  const anySize = useMemo(() => data.rows.some((r) => r.dealValue != null), [data.rows]);

  const Btn = ({ k, label }: { k: Sort; label: string }) => (
    <button onClick={() => setSort(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${sort === k ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{label}</button>
  );
  const SzBtn = ({ k, label }: { k: SizeF; label: string }) => (
    <button onClick={() => setSizeF(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${sizeF === k ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{label}</button>
  );

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Merger Arbitrage"
        desc="Live cash deals with a signed definitive agreement (from the target's merger proxy), ranked by the annualized return of holding to close. The spread — deal price minus current price — is what the market pays you to carry deal-break risk, and it's an edge a small account can work where institutions can't be bothered. Deal prices are extracted from the filing and code-verified against its text. Decision-support, not advice; read the deal before acting."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
        <span className="text-[var(--text-4)]">sort:</span>
        <Btn k="annualized" label="Annualized return" />
        <Btn k="spread" label="Gross spread" />
        <Btn k="close" label="Soonest close" />
        {anySize && (
          <>
            <span className="ml-2 text-[var(--text-4)]">size:</span>
            <SzBtn k="all" label="All" />
            <SzBtn k="sub500" label="<$500M" />
            <SzBtn k="sub1b" label="<$1B" />
            <InfoDot text="Deal equity value = cash price × shares outstanding. Sub-$500M deals sit below the arb funds' minimum size, so their spreads stay wider — the size-locked edge. Deals where Yahoo omitted share count show '—' and are kept, not hidden." />
          </>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-4)]">{rows.length}{sizeF !== "all" ? ` of ${data.rows.length}` : ""} live cash deals · {data.scanned} proxies scanned ({data.spacs} SPACs dropped) · {fmtDate(data.generatedAt)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Acquirer</th>
              <th className="px-3 py-2 text-right">Deal</th>
              <th className="px-3 py-2 text-right">Size <InfoDot text="Deal equity value (cash price × shares outstanding). ◆ marks a sub-$500M deal — below where arb funds bother, so the spread runs wider. '—' = Yahoo omitted shares." /></th>
              <th className="px-3 py-2 text-right">Spot</th>
              <th className="px-3 py-2 text-right">
                Spread <InfoDot text="Deal cash price minus the current price, as a %. A positive spread is the gross return if the deal closes at terms; a negative spread means the stock trades ABOVE the deal price — the market is pricing a bump or a competing bid." />
              </th>
              <th className="px-3 py-2 text-right">
                Annualized <InfoDot text="The spread scaled to a yearly rate by the days to the expected close (or a conservative 120-day default when the filing states no date). This is the arb ranking — but it ignores deal-break risk, which is the whole game." />
              </th>
              <th className="px-3 py-2">Close</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.expectedClose ? daysUntil(r.expectedClose) : null;
              return (
                <tr key={r.url} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <WatchStar symbol={r.ticker} compact />
                      <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.ticker}</Link>
                    </span>
                    <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline">{r.name.slice(0, 26)}</span>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-[var(--text-3)]">{r.acquirer.slice(0, 28)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-[var(--text-2)]">{r.cashPerShare == null ? "—" : `$${r.cashPerShare.toFixed(2)}`}<span className="ml-1 text-[10px] text-[var(--text-4)]">cash</span></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-3)]" title={r.dealValue != null && r.dealValue < 500e6 ? "Sub-$500M — below arb-fund minimum size" : undefined}>
                    {r.dealValue != null && r.dealValue < 500e6 && <span className="mr-0.5 text-[#22c55e]">◆</span>}{dealMoney(r.dealValue)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{r.spot == null ? "—" : `$${r.spot.toFixed(2)}`}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {r.spreadPct == null ? <span className="text-[var(--text-4)]">—</span> : <span className={r.spreadPct >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>{r.spreadPct >= 0 ? "+" : ""}{r.spreadPct}%</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums font-semibold">
                    {r.annualizedPct == null ? <span className="text-[var(--text-4)]">—</span> : <span className={r.annualizedPct >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>{r.annualizedPct >= 0 ? "+" : ""}{r.annualizedPct}%</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[var(--text-3)]">{r.expectedClose ? <>{fmtDate(r.expectedClose)}{d != null && d >= 0 && <span className="ml-1 text-[10px] text-[var(--text-4)]">{d}d</span>}</> : <span className="text-[var(--text-4)]">est.</span>}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-[12px] text-[var(--text-4)]" title={r.note ?? undefined}>{r.note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Annualized return ignores deal-break risk — a wide spread usually means the market doubts the close (regulatory, financing, a shareholder vote). Stock-for-stock deals have no fixed cash target and are excluded. Read the proxy. Not investment advice.
      </p>
    </main>
  );
}
