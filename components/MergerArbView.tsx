import Link from "next/link";
import type { MergerArbData, ArbRow } from "@/lib/mergerArb";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

// Static (server-rendered) table — already ranked by annualized return.

const STRUCT_COLOR: Record<string, string> = { cash: "#22c55e", stock: "#60a5fa", mixed: "#a78bfa" };
const px = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const fmtDay = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—");

function Row({ universe, d }: { universe: string; d: ArbRow }) {
  // Wide positive spread ⇒ the market is pricing deal-BREAK risk; tight ⇒ near-certain; negative ⇒ a
  // higher bid is expected (or terms unknown). Color the annualized return accordingly.
  const wide = d.grossSpreadPct != null && d.grossSpreadPct > 8;
  const annColor = d.annualizedPct == null ? "var(--text-4)" : d.grossSpreadPct != null && d.grossSpreadPct < 0 ? "#ef4444" : wide ? "#f59e0b" : "#22c55e";
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
      <td className="px-3 py-2">
        <Link href={`/u/${universe}/stock/${d.targetTicker}`} className="font-semibold text-[var(--accent)] hover:underline">{d.targetTicker}</Link>
        <div className="max-w-[170px] truncate text-[11px] text-[var(--text-4)]">{d.targetName}</div>
      </td>
      <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">
        <span className="max-w-[150px] truncate">{d.acquirer}</span>
        {d.acquirerTicker && <span className="ml-1 font-mono text-[10px] text-[var(--text-4)]">{d.acquirerTicker}</span>}
      </td>
      <td className="px-2 py-2">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: STRUCT_COLOR[d.structure] ?? "var(--text-3)", background: `color-mix(in oklab, ${STRUCT_COLOR[d.structure] ?? "#888"} 15%, transparent)` }}>{d.structure}</span>
        {d.cvr && <span className="ml-1 text-[10px] text-[var(--text-4)]" title="Plus a contingent value right (unvalued upside)">+CVR</span>}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{px(d.dealValue)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{px(d.targetPrice)}</td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: d.grossSpreadPct == null ? "var(--text-4)" : d.grossSpreadPct < 0 ? "#ef4444" : wide ? "#f59e0b" : "#22c55e" }}>{pct(d.grossSpreadPct, 2)}</td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: annColor }}>{d.annualizedPct == null ? "—" : `${Math.round(d.annualizedPct)}%`}</td>
      <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[var(--text-3)]">{fmtDay(d.expectedClose)}</td>
      <td className="px-3 py-2 text-right">{d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">filing →</a>}</td>
    </tr>
  );
}

export default function MergerArbView({ universe, data }: { universe: string; data: MergerArbData }) {
  const deals = data.deals ?? [];
  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Merger Arb — pending deals &amp; spreads</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Announced US acquisitions (from SEC merger proxies) with the live arb <b>spread</b> <InfoDot term="Merger arb spread" /> — how far the target trades below the deal value — and the <b>annualized</b> return if it closes on time. Cash / fixed-exchange-ratio stock / mixed. Ranked by annualized return. {data.scanned} proxies scanned · {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {!deals.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          No pending deals extracted yet — populates on the nightly refresh (scans recent DEFM14A/PREM14A merger proxies).
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-2 py-2 font-medium">Acquirer</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 text-right font-medium">Deal / sh</th>
                <th className="px-2 py-2 text-right font-medium">Current</th>
                <th className="px-2 py-2 text-right font-medium">Spread<InfoDot term="Merger arb spread" /></th>
                <th className="px-2 py-2 text-right font-medium">Annualized</th>
                <th className="px-2 py-2 text-right font-medium">Est. close</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => <Row key={d.targetTicker + i} universe={universe} d={d} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        Deal value = cash + (exchange ratio × acquirer price); the spread is vs the target&apos;s current price, annualized by days to the estimated close. A WIDE positive spread usually means the market is pricing deal-break/regulatory risk (not free money); a negative spread hints at an expected higher bid. Terms are LLM-extracted from the filing (cash prices number-grounded) and the close date is a best estimate — <b>verify the filing</b> before trading. Stock-deal values move with the acquirer&apos;s price. US-listed targets only. Research / decision-support, not investment advice.
      </p>
    </main>
  );
}
