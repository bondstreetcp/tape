"use client";
import Link from "next/link";
import type { DispersionData } from "@/lib/dispersion";
import { corrRead } from "@/lib/dispersion";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export default function DispersionView({ universe, data }: { universe: string; data: DispersionData | null }) {
  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Dispersion — index vol vs single-name vol</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The index&apos;s implied vol (VIX) vs the <b>cap-weighted average</b> of its heavyweights&apos; single-name IV. When single names price much more vol than the index — a wide spread / <b>low implied correlation</b> <InfoDot term="Implied correlation" /> — the market is paying for lots of idiosyncratic movement; the classic <b>dispersion</b> trade sells index vol and buys the components. {data ? `Top ${data.coverage} S&P names by cap · ${fmtDateTime(data.generatedAt)}` : ""}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {!data ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">
          The dispersion read builds on the nightly options fetch — check back after the next refresh.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Index IV (VIX)" value={pct(data.indexIV)} sub="30-day SPX implied" />
            <Metric label="Single-name IV" value={pct(data.singleNameIV)} sub={`cap-weighted, n=${data.n}`} />
            <Metric label="Vol spread" value={`${data.spread >= 0 ? "+" : ""}${(data.spread * 100).toFixed(1)} pts`} sub="single − index" color={data.spread >= 0 ? "#f59e0b" : "#14b8a6"} />
            <Metric label="Implied correlation" value={data.impliedCorr != null ? pct(data.impliedCorr, 0) : "—"} sub="σ²index ÷ (Σwσ)²" info="Implied correlation" />
          </div>

          <div className="mb-4 rounded-xl border px-4 py-3 text-[13px]" style={{ borderColor: `color-mix(in oklab, ${corrRead(data.impliedCorr).c} 40%, var(--border))`, background: `color-mix(in oklab, ${corrRead(data.impliedCorr).c} 8%, transparent)` }}>
            <b style={{ color: corrRead(data.impliedCorr).c }}>{corrRead(data.impliedCorr).t}</b>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Cap-weighted IV by sector</div>
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                  <tr><th className="py-1 font-medium">Sector</th><th className="py-1 text-right font-medium">IV</th><th className="py-1 text-right font-medium">Names</th><th className="py-1 text-right font-medium">Cap %</th></tr>
                </thead>
                <tbody>
                  {data.sectors.map((s) => (
                    <tr key={s.sector} className="border-t border-[var(--divider)]">
                      <td className="py-1 text-[12px] text-[var(--text-2)]">{s.sector}</td>
                      <td className="py-1 text-right font-mono tabular-nums font-semibold text-[var(--text)]">{pct(s.wIV, 0)}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-[var(--text-4)]">{s.n}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-[var(--text-4)]">{(s.capPct * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Highest single-name IV (the vol drivers)</div>
              <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-6">
                {data.topNames.map((n) => (
                  <div key={n.symbol} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link href={`/u/${universe}/stock/${n.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{n.symbol}</Link>
                    <span className="truncate text-[11px] text-[var(--text-4)]">{n.sector}</span>
                    <span className="font-mono tabular-nums font-semibold text-[var(--text-2)]">{pct(n.atmIV, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
            Index IV = VIX (SPX 30-day). Single-name IV = the ~1-month ATM IV solved from the chain (vendor IV treated as junk) for the top {data.coverage} S&P names by market cap, cap-weighted — an approximation of the index members (not exact index weights), so the implied correlation is a regime read, not a desk-exact number. Decision support, not advice.
          </p>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, sub, color, info }: { label: string; value: string; sub: string; color?: string; info?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">{label}{info && <InfoDot term={info} />}</div>
      <div className="mt-0.5 font-mono text-xl font-bold tabular-nums" style={{ color: color || "var(--text)" }}>{value}</div>
      <div className="text-[10px] text-[var(--text-4)]">{sub}</div>
    </div>
  );
}
