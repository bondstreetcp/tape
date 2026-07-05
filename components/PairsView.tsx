import Link from "next/link";
import type { PairsData, PairRow } from "@/lib/pairs";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

// Static (server-rendered) table — already ranked by |z|. No client state needed.

function zColor(z: number): string {
  const a = Math.abs(z);
  return a >= 3 ? "#ef4444" : a >= 2.5 ? "#f59e0b" : "#eab308";
}

function Row({ universe, p }: { universe: string; p: PairRow }) {
  // z>0 ⇒ spread high ⇒ A rich vs B ⇒ short A / long B (bet the spread narrows). z<0 ⇒ the reverse.
  const rich = p.z > 0 ? p.a : p.b;
  const cheap = p.z > 0 ? p.b : p.a;
  const stock = (s: string) => (
    <Link href={`/u/${universe}/stock/${s}`} className="font-semibold text-[var(--accent)] hover:underline">{s}</Link>
  );
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">{stock(p.a)}<span className="text-[var(--text-4)]">/</span>{stock(p.b)}</div>
        <div className="max-w-[220px] truncate text-[11px] text-[var(--text-4)]">{p.nameA} / {p.nameB}</div>
      </td>
      <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{p.sector}</td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: zColor(p.z) }}>{p.z > 0 ? "+" : ""}{p.z.toFixed(2)}</td>
      <td className="px-2 py-2 text-[12px]">
        <span className="font-medium text-[#22c55e]">Long {cheap}</span>
        <span className="text-[var(--text-4)]"> · </span>
        <span className="font-medium text-[#ef4444]">Short {rich}</span>
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{p.halfLifeDays != null ? `${p.halfLifeDays.toFixed(0)}d` : "—"}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{p.corr.toFixed(2)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{p.beta.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">
        <Link href={`/u/${universe}/ratio?a=${p.a}&b=${p.b}`} className="text-[11px] text-[var(--accent)] hover:underline">chart →</Link>
      </td>
    </tr>
  );
}

export default function PairsView({ universe, data }: { universe: string; data: PairsData }) {
  const pairs = data.pairs ?? [];
  return (
    <main className="mx-auto max-w-[75rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Pairs — relative value</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Same-sector S&amp;P 500 pairs whose price ratio is <b>stretched</b> and historically <b>mean-reverts</b> — the classic relative-value setup. For each pair we fit a hedge ratio, form the log-price spread, and report how far it&apos;s stretched (<b>z-score</b> <InfoDot term="Z-score" />), how fast it snaps back (<b>half-life</b> <InfoDot term="Half-life" />), and the return <b>correlation</b>. Ranked by |z|. {data.scanned} names scanned · {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {!pairs.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          No stretched pairs right now — populates on the nightly refresh. A pair only shows when it&apos;s correlated, mean-reverting (2–60d half-life), and ≥2σ stretched.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Pair</th>
                <th className="px-2 py-2 font-medium">Sector</th>
                <th className="px-2 py-2 text-right font-medium">Spread z<InfoDot term="Z-score" /></th>
                <th className="px-2 py-2 font-medium">Mean-reversion trade</th>
                <th className="px-2 py-2 text-right font-medium">Half-life<InfoDot term="Half-life" /></th>
                <th className="px-2 py-2 text-right font-medium">Corr</th>
                <th className="px-2 py-2 text-right font-medium">Hedge β<InfoDot term="Hedge ratio" /></th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => <Row key={p.a + p.b + i} universe={universe} p={p} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        Spread = log(A) − β·log(B), β the OLS hedge ratio. z is the current spread vs its ~1-year mean/σ; the trade shorts the rich leg and longs the cheap one, betting the spread reverts (half-life = OU reversion speed). Cointegration isn&apos;t re-tested each session, so a &quot;stretched&quot; pair can also mean the relationship broke — check the ratio chart + the fundamentals. US single-stock only. Research / decision-support, not investment advice.
      </p>
    </main>
  );
}
