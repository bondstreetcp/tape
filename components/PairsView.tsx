import Link from "next/link";
import type { PairsData, PairRow, DecoupledRow } from "@/lib/pairs";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

// Static (server-rendered) tables — already ranked. No client state needed.

function zColor(z: number): string {
  const a = Math.abs(z);
  return a >= 3 ? "#ef4444" : a >= 2.5 ? "#f59e0b" : "#eab308";
}

function StretchedRow({ universe, p }: { universe: string; p: PairRow }) {
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

function DecoupledRowUI({ universe, d }: { universe: string; d: DecoupledRow }) {
  // `broke` = the leg that actually MOVED most over the recent window (computed in lib/pairs from the
  // per-leg return, not the spread sign) — the likely catalyst name. brokeMovePct carries direction.
  const up = d.brokeMovePct >= 0;
  const stock = (s: string) => (
    <Link href={`/u/${universe}/stock/${s}`} className="font-semibold text-[var(--accent)] hover:underline">{s}</Link>
  );
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">{stock(d.a)}<span className="text-[var(--text-4)]">/</span>{stock(d.b)}</div>
        <div className="max-w-[220px] truncate text-[11px] text-[var(--text-4)]">{d.nameA} / {d.nameB}</div>
      </td>
      <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{d.sector}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums">
        <span className="text-[var(--text-3)]">{d.corrLong.toFixed(2)}</span>
        <span className="text-[var(--text-4)]"> → </span>
        <span className="font-semibold text-[#ef4444]">{d.corrShort.toFixed(2)}</span>
      </td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-[#f59e0b]">−{d.drop.toFixed(2)}</td>
      <td className="px-2 py-2 text-[12px]">
        <span className="text-[var(--text-4)]">broke away: </span>
        <span className="font-medium text-[var(--text-2)]">{d.broke}</span>
        <span className="font-mono tabular-nums" style={{ color: up ? "#22c55e" : "#ef4444" }}> {up ? "+" : ""}{d.brokeMovePct.toFixed(0)}%</span>
      </td>
      <td className="px-3 py-2 text-right">
        <Link href={`/u/${universe}/ratio?a=${d.a}&b=${d.b}`} className="text-[11px] text-[var(--accent)] hover:underline">chart →</Link>
      </td>
    </tr>
  );
}

export default function PairsView({ universe, data }: { universe: string; data: PairsData }) {
  const pairs = data.pairs ?? [];
  const decoupled = data.decoupled ?? [];
  return (
    <main className="mx-auto max-w-[75rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Pairs — relative value &amp; decoupling</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            A universe-wide (<b>Russell 3000</b>, most-liquid names per sector) same-sector scan of every price pair, split into two signals: <b>stretched</b> pairs whose ratio is wide but historically mean-reverts (a convergence setup), and <b>decoupled</b> pairs that moved together for a year and just broke apart (a single-name catalyst tell). {data.scanned} names scanned · {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <h2 className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wide text-[var(--text-3)]">Stretched — mean-reversion setups</h2>
      {!pairs.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">
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
              {pairs.map((p, i) => <StretchedRow key={p.a + p.b + i} universe={universe} p={p} />)}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-wide text-[var(--text-3)]">Decoupled — a correlation that just broke</h2>
      {!decoupled.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">
          Nothing decoupled right now — a pair only shows when it was tightly correlated over the past year and its last-month correlation collapsed.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Pair</th>
                <th className="px-2 py-2 font-medium">Sector</th>
                <th className="px-2 py-2 text-right font-medium">Corr (1y → 1m)</th>
                <th className="px-2 py-2 text-right font-medium">Break</th>
                <th className="px-2 py-2 font-medium">Broke away (1m move)</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {decoupled.map((d, i) => <DecoupledRowUI key={d.a + d.b + i} universe={universe} d={d} />)}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        <b>Stretched:</b> spread = log(A) − β·log(B), β the OLS hedge ratio; z is the current spread vs its ~1-year mean/σ, and the trade shorts the rich leg / longs the cheap one, betting the spread reverts (half-life = OU reversion speed). <b>Decoupled:</b> two names whose daily-return correlation was high over the trailing year but collapsed over the last ~month — the relationship broke, usually because ONE leg had a catalyst (guidance, M&amp;A, a downgrade). The &quot;broke away&quot; name is the leg that actually moved most (with its move %), so it&apos;s a research tell — check that name&apos;s news/filings — not a convergence trade. Decoupled pairs are held OUT of the stretched list (a broken relationship isn&apos;t a convergence setup); stale/halted series are excluded so the break is genuinely recent. US single-stock only. Research / decision-support, not investment advice.
      </p>
    </main>
  );
}
