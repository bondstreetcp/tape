"use client";
/** Lobbying board (/lobbying): who spends on Washington, on which bills, where those bills stand,
 *  and whether Congress members trade the same names. Spend renders as TWO columns because the two
 *  disclosure bases are not summable (in-house EXPENSES often already include the hired firms'
 *  INCOME). Every ticker row exists only because a disclosed client name passed the strict
 *  resolver — unresolved clients are counted in the meta line, never guessed onto the board. */
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { unwrapClientName, type LobbyingFile } from "@/lib/lobbying";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import WatchStar from "./WatchStar";
import { fmtDate } from "@/lib/format";

const SHOW_ROWS = 150;
const SHOW_BILLS = 40;

const usd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : v > 0 ? `$${v}` : "—";

export default function LobbyingView({ universe, data }: { universe: string; data: LobbyingFile }) {
  const rows = data.rows.slice(0, SHOW_ROWS);
  const billTitle = new Map(data.bills.map((b) => [b.id, b.title || b.label]));
  return (
    <main className="mx-auto max-w-[76rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-[13px] text-[var(--text-4)] hover:text-[var(--text)]">
        ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
      </Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Lobbying"
        desc="Lobbying Disclosure Act filings joined three ways: disclosed clients resolved to tickers (strict name rules — ambiguity is refused, unresolved clients are counted, never guessed), bill numbers lifted from the activity text by a tested extractor and joined to keyless GovInfo status, and Congress members' trades in the same names alongside. In-house and hired-firm spend stay separate columns — the disclosure bases overlap, so summing them double-counts. Decision-support, not advice."
      />
      <div className="mb-3 text-[11px] text-[var(--text-4)]">
        {data.filingsResolved.toLocaleString()} filings resolved to {data.rows.length.toLocaleString()} tickers ·{" "}
        {data.clientsUnresolved.toLocaleString()} filings refused/unmatched
        {data.healedOut > 0 && ` · ${data.healedOut.toLocaleString()} healed out by resolver upgrades`}
        {data.amendmentsCollapsed > 0 && ` · ${data.amendmentsCollapsed.toLocaleString()} amendments collapsed`} · posted{" "}
        {fmtDate(data.postedFrom)} – {fmtDate(data.postedTo)} · Congress {data.congress} · {fmtDate(data.generatedAt.slice(0, 10))}
        {data.tradesAsOf && ` · trades joined as of ${fmtDate(data.tradesAsOf.slice(0, 10))}`}
        {data.rows.length > SHOW_ROWS && ` · showing top ${SHOW_ROWS} by spend`}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2 text-right">Filings <InfoDot text="LDA filings this year whose disclosed client resolved to this ticker (incl. subsidiaries filing under their own names)." /></th>
              <th className="px-3 py-2 text-right">Own spend <InfoDot text="EXPENSES from the company's own in-house registrant filings — usually the fullest picture of total lobbying outlay (often includes outside firms). Not summable with the next column." /></th>
              <th className="px-3 py-2 text-right">Via firms <InfoDot text="INCOME reported by hired lobbying firms for this client. A company with no in-house registration shows only this. Not summable with Own spend." /></th>
              <th className="px-3 py-2">Bills lobbied <InfoDot text="Bill numbers lifted from the filings' activity descriptions (tested extractor; mis-cited bills that don't exist in this Congress are dropped). Hover a chip for the bill title." /></th>
              <th className="px-3 py-2 text-right">Congress trades <InfoDot text="STOCK Act trades in this name from the /congress feed: buys − sells (distinct members). The join, not a causal claim." /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <WatchStar symbol={r.ticker} compact />
                    <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">
                      {r.ticker}
                    </Link>
                  </span>
                  <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline" title={r.clients.join(" · ")}>
                    {(r.name || unwrapClientName(r.clients[0] || "")).slice(0, 34)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.filings}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(r.spendInHouse)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(r.spendHired)}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {r.bills.slice(0, 5).map((b) => (
                      <span key={b.id} title={billTitle.get(b.id)} className="rounded border border-[var(--border)] px-1 py-0.5 text-[11px] text-[var(--text-3)]">
                        {b.label}
                      </span>
                    ))}
                    {r.billCount > 5 && <span className="text-[11px] text-[var(--text-4)]">+{r.billCount - 5}</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.trades ? (
                    <span title={`~${usd(r.trades.notional)} bracket-midpoint notional`}>
                      <span className="text-[var(--pos)]">{r.trades.buys}B</span> / <span className="text-[var(--neg)]">{r.trades.sells}S</span>
                      <span className="ml-1 text-[11px] text-[var(--text-4)]">({r.trades.members})</span>
                    </span>
                  ) : (
                    <span className="text-[var(--text-4)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-8 text-[15px] font-semibold text-[var(--text)]">
        Contested bills <InfoDot text="Bills ranked by how many distinct resolved tickers lobby them — a rough map of where corporate attention concentrates. Status is the bill's latest recorded action from GovInfo." />
        {data.bills.length > SHOW_BILLS && (
          <span className="ml-2 text-[11px] font-normal text-[var(--text-4)]">showing {SHOW_BILLS} of {data.bills.length}</span>
        )}
      </h2>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Policy area</th>
              <th className="px-3 py-2">Latest action</th>
              <th className="px-3 py-2">Lobbied by</th>
            </tr>
          </thead>
          <tbody>
            {data.bills.slice(0, SHOW_BILLS).map((b) => (
              <tr key={b.id} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                <td className="px-3 py-2 font-mono whitespace-nowrap">{b.label}</td>
                <td className="px-3 py-2 max-w-[26rem]"><span className="line-clamp-2">{b.title}</span></td>
                <td className="px-3 py-2 text-[12px] text-[var(--text-3)]">{b.policyArea || "—"}</td>
                <td className="px-3 py-2 text-[12px]">
                  {b.latestActionDate && <span className="text-[var(--text-4)]">{fmtDate(b.latestActionDate)} · </span>}
                  <span className="text-[var(--text-3)]">{(b.latestAction || "—").slice(0, 90)}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {b.tickers.slice(0, 8).map((t) => (
                      <Link key={t} href={`/u/${universe}/stock/${encodeURIComponent(t)}`} className="font-mono text-[12px] text-[var(--text-2)] hover:text-[var(--accent)]">
                        {t}
                      </Link>
                    ))}
                    {b.tickerCount > 8 && <span className="text-[11px] text-[var(--text-4)]">+{b.tickerCount - 8}</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 max-w-4xl text-[11px] text-[var(--text-4)]">
        Quarterly LDA disclosures lag the activity they report; amounts are as filed and rounded by registrants. A bill chip means the filing
        NAMED that bill — it says nothing about the position taken. Not investment advice.
      </p>
    </main>
  );
}
