import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import PageHeader from "@/components/PageHeader";
import InfoDot from "@/components/InfoDot";
import EmptyState from "@/components/EmptyState";
import { fmtDate } from "@/lib/format";
import { daysUntil } from "@/lib/calendar";
import type { TendersFile } from "@/lib/tenders";

export const revalidate = 600;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const money = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);

// /tenders — live tender offers with the odd-lot lens. The edge this board exists for: offers that
// grant <100-share holders priority acceptance without proration, a term institutions structurally
// cannot use. Episodic by nature — months can pass between clean odd-lot setups, and the empty state
// says so instead of pretending.
export default async function TendersPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await fs
    .readFile(path.join(process.cwd(), "data", "tenders.json"), "utf8")
    .then((s) => JSON.parse(s) as TendersFile)
    .catch(() => null);
  if (!data) return <EmptyState universe={universe} title="Tender Offers" note="Builds on the nightly refresh once the EDGAR scan has run." />;
  if (!data.rows.length)
    return (
      <EmptyState
        universe={universe}
        title="Tender Offers"
        note={`No live listed tender offers right now — the scan saw ${data.scanned} filings in the last ${data.windowDays} days, but they were unlisted-fund repurchases or already expired. Listed tenders (and especially odd-lot-priority ones) are episodic: a handful a quarter is normal.`}
      />
    );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Tender Offers"
        desc="Live SC TO-I / SC TO-T tender offers on listed tickers, scanned nightly from EDGAR with terms extracted and then code-verified against the filing text. The column that matters here is odd-lot priority: many tenders accept holders of fewer than 100 shares in full, ahead of proration — a term written to shed small holders that institutions structurally cannot use. Decision-support, not advice."
      />

      <div className="mb-3 text-[11px] text-[var(--text-4)]">
        {data.rows.length} live offer{data.rows.length > 1 ? "s" : ""} · scanned {data.scanned} filings over {data.windowDays}d ({data.unlisted} unlisted-fund repurchases skipped) · {fmtDate(data.generatedAt)}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">
                Offer <InfoDot text="The stated purchase price. Dutch-auction tenders show the LOW end of the range — the conservative bound; the final price is set by the auction and can land anywhere in it." />
              </th>
              <th className="px-3 py-2">Spot</th>
              <th className="px-3 py-2">
                Premium <InfoDot text="Low offer vs the live quote. A large premium usually means the market is pricing real completion risk (conditions, financing) — read the conditions column, not just this number." />
              </th>
              <th className="px-3 py-2">
                Odd-lot <InfoDot text="✓ = the filing grants holders of fewer than 100 shares priority acceptance without proration (detected in the filing text). This is the small-account edge: 99 shares bought below the offer and tendered into the priority. Verify the exact terms in the filing before acting." />
              </th>
              <th className="px-3 py-2">
                Per odd-lot <InfoDot text="(low offer − spot) × 99 shares — the maximum value of one odd-lot position if the offer completes at the low price, before fees. Only meaningful when odd-lot priority is granted." />
              </th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Conditions</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const d = r.expiresAt ? daysUntil(r.expiresAt) : null;
              return (
                <tr key={`${r.ticker}-${r.form}`} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold text-[var(--text)]">{r.ticker}</span>
                    <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline">{r.name.slice(0, 36)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[var(--text-3)]">{r.form === "SC TO-I" ? "self-tender" : "third-party"}{r.offerType === "dutch" ? " · dutch" : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--text-2)]">
                    {money(r.priceUsd)}
                    {r.priceHighUsd != null && <span className="text-[var(--text-4)]">–{money(r.priceHighUsd).slice(1)}</span>}
                    {!r.verified && r.priceUsd != null && <span className="ml-1 text-[10px] text-[#f59e0b]" title="price could not be verified verbatim in the filing text">?</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-2)]">{money(r.spot)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.premiumPct == null ? <span className="text-[var(--text-4)]">—</span> : (
                      <span className={r.premiumPct >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>{r.premiumPct >= 0 ? "+" : ""}{r.premiumPct.toFixed(1)}%</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.oddLotPriority ? <span className="font-semibold text-[#22c55e]">✓</span> : <span className="text-[var(--text-4)]">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-[var(--text-2)]">{r.oddLotPriority && r.oddLotValueUsd != null ? `$${r.oddLotValueUsd}` : <span className="text-[var(--text-4)]">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-2)]">
                    {r.expiresAt ? <>{fmtDate(r.expiresAt)}{d != null && d >= 0 && <span className="ml-1 text-[11px] text-[var(--text-4)]">{d === 0 ? "today" : `${d}d`}</span>}</> : "—"}
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-[12px] text-[var(--text-4)]" title={r.conditions ?? undefined}>{r.conditions ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">filing ↗</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Offers can be amended, extended, or withdrawn; Dutch finals can land anywhere in the range; a fat premium is usually priced completion risk. Read the filing before acting — this board finds and verifies terms, it does not judge deals. Not investment advice.
      </p>
    </main>
  );
}
