"use client";
/** SPAC trust-value arbitrage (/spac-arb): SPACs trading below their trust redemption floor. The
 *  discount is the headline, but the board deliberately surrounds it with the context that makes it
 *  readable — trust size, shares, as-of staleness, PINK flag — because a below-trust price is more
 *  often a signal (thin float, delisting, a disliked deal) than a free lunch. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { SpacArbFile, SpacRow } from "@/lib/spacArb";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import WatchStar from "./WatchStar";
import { fmtDate } from "@/lib/format";

type Sort = "discount" | "trust" | "stale";
const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : `$${Math.round(v / 1e3)}K`);
const isPink = (ex: string | null) => !!ex && /otc|pink|expert|grey|gray/i.test(ex);

export default function SpacArbView({ universe, data }: { universe: string; data: SpacArbFile }) {
  const [sort, setSort] = useState<Sort>("discount");
  const [belowOnly, setBelowOnly] = useState(false);
  const rows = useMemo(() => {
    const by: Record<Sort, (a: SpacRow, b: SpacRow) => number> = {
      discount: (a, b) => (b.discountPct ?? -1e9) - (a.discountPct ?? -1e9),
      trust: (a, b) => b.trustUsd - a.trustUsd,
      stale: (a, b) => a.daysStale - b.daysStale,
    };
    const src = belowOnly ? data.rows.filter((r) => (r.discountPct ?? 0) > 0) : data.rows;
    return [...src].sort(by[sort]);
  }, [data.rows, sort, belowOnly]);
  const belowN = useMemo(() => data.rows.filter((r) => (r.discountPct ?? 0) > 0).length, [data.rows]);

  const Btn = ({ k, label }: { k: Sort; label: string }) => (
    <button onClick={() => setSort(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${sort === k ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{label}</button>
  );

  return (
    <main className="mx-auto max-w-[82rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="SPAC Trust Arbitrage"
        desc="Pre-deal SPACs priced against their trust-account redemption value — the cash-in-trust floor a holder can redeem for at the next vote or deadline. A price below trust is a low-risk claim institutions can't size into, but it is redemption-gated (you collect by redeeming, not selling), the trust figure is as of the last 10-Q (a redemption or extension moves it between filings), and a discount is often a signal — thin float, looming delisting, a disliked deal — not a gift. Trust-per-share is computed from the filing (trust ÷ redeemable shares), never a headline number. Decision-support, not advice; read the filings and the deadline before acting."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
        <span className="text-[var(--text-4)]">sort:</span>
        <Btn k="discount" label="Discount to trust" />
        <Btn k="trust" label="Trust size" />
        <Btn k="stale" label="Freshest filing" />
        <button onClick={() => setBelowOnly((v) => !v)} className={`ml-2 rounded-full border px-2.5 py-1 text-[11px] ${belowOnly ? "border-[#22c55e] text-[#22c55e]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>Below trust only</button>
        <span className="ml-auto text-[11px] text-[var(--text-4)]">{data.universe} SPACs in-band · {data.priced} priced · <span className="text-[#22c55e]">{belowN} below trust</span> · {fmtDate(data.generatedAt)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">SPAC</th>
              <th className="px-3 py-2 text-right">Trust / sh <InfoDot text="Trust account ÷ shares subject to redemption, from the latest 10-Q. The per-share cash you can redeem for — computed from the filing, cross-checked against the filer's own redemption-price tag." /></th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Discount <InfoDot text="(trust/sh − price) ÷ trust/sh. Positive = trading BELOW the redemption floor. Only collectable by redeeming at the next vote/deadline — not by selling in the market." /></th>
              <th className="px-3 py-2 text-right">Trust size</th>
              <th className="px-3 py-2">As of <InfoDot text="The balance-sheet date of the trust figure. A redemption or extension (filed in an 8-K, not the 10-Q) can move the trust and share count between filings — older = trust the number less." /></th>
              <th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const below = (r.discountPct ?? 0) > 0;
              return (
                <tr key={r.cik} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <WatchStar symbol={r.ticker} compact />
                      <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.ticker}</Link>
                    </span>
                    <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline">{r.name.slice(0, 30)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-2)]" title={r.ppsTag != null ? `filer's redemption tag: $${r.ppsTag.toFixed(2)}` : undefined}>${r.trustPerShare.toFixed(2)}{r.ppsMismatch && <span className="ml-0.5 text-[#f59e0b]" title="computed per-share differs >2% from the filer's tag — check the filing">≠</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{r.price == null ? <span className="text-[var(--text-4)]">—</span> : `$${r.price.toFixed(2)}`}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums font-semibold">
                    {r.discountPct == null ? <span className="text-[var(--text-4)]">—</span> : <span className={below ? "text-[#22c55e]" : "text-[#ef4444]"}>{below ? "+" : ""}{(r.discountPct * 100).toFixed(1)}%</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{usd(r.trustUsd)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[var(--text-3)]">{fmtDate(r.trustEnd)}<span className="ml-1 text-[10px] text-[var(--text-4)]">{r.daysStale}d</span></td>
                  <td className="px-3 py-2 text-[11px]">
                    {isPink(r.exchange) && <span className="mr-1 rounded bg-[color-mix(in_oklab,#f59e0b_16%,transparent)] px-1 py-0.5 font-semibold text-[#d97706]" title={`Trades ${r.exchange} — a thin OTC book with wide spreads that eat the edge`}>PINK</span>}
                    {r.daysStale > 100 && <span className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text-4)]" title="Trust figure is over a quarter old — a redemption/extension may have moved it">stale</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 max-w-4xl text-[11px] text-[var(--text-4)]">
        Low-risk, small-edge, thin-liquidity — never riskless. The floor is realized only through redemption at a vote or the liquidation deadline; horizon and IRR depend on when that lands. Trust and share counts are as of the last 10-Q. Not investment advice.
      </p>
    </main>
  );
}
