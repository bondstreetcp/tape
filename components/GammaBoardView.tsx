"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import type { GammaBoardData, GammaBoardRow, GammaSort } from "@/lib/gammaBoard";
import { rankGammaBoard, nearFlip } from "@/lib/gammaBoard";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";

const gex = (n: number): string => {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${a.toFixed(0)}`;
};
const SHORT = "#f59e0b", LONG = "#22c55e"; // short gamma amplifies (amber), long gamma dampens (green)

const SORTS: { key: GammaSort; label: string }[] = [
  { key: "gross", label: "Biggest" },
  { key: "short", label: "Most short γ" },
  { key: "flip", label: "Nearest flip" },
  { key: "pcHigh", label: "Put-heavy" },
  { key: "pcLow", label: "Call-heavy" },
];

function MarketTile({ row }: { row: GammaBoardRow }) {
  const c = row.regime === "short" ? SHORT : LONG;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{row.symbol}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 15%, transparent)` }}>{row.regime === "short" ? "SHORT γ" : "LONG γ"}</span>
      </div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums" style={{ color: c }}>{gex(row.totalGex)}<span className="text-[11px] font-normal text-[var(--text-4)]">/1%</span></div>
      <div className="text-[11px] text-[var(--text-4)]">
        spot {row.spot} · flip {row.flip ?? "—"}{row.distToFlipPct != null && <span style={nearFlip(row) ? { color: c, fontWeight: 600 } : undefined}> ({row.distToFlipPct >= 0 ? "+" : ""}{row.distToFlipPct.toFixed(1)}%)</span>}
      </div>
    </div>
  );
}

function Row({ universe, r }: { universe: string; r: GammaBoardRow }) {
  const c = r.regime === "short" ? SHORT : LONG;
  const nf = nearFlip(r);
  const isEtf = r.sector === "Index ETF";
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
      <td className="px-3 py-2">
        {isEtf ? <span className="font-semibold">{r.symbol}</span> : <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>}
        <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
      </td>
      <td className="px-2 py-2">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 15%, transparent)` }}>{r.regime === "short" ? "short" : "long"}</span>
      </td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: c }} title="Net dealer gamma per 1% move — short (−) amplifies, long (+) dampens">{gex(r.totalGex)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]" title="Total gamma to hedge per 1% move — positioning size">{gex(r.grossGex)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.spot}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.flip ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: nf ? c : "var(--text-3)", fontWeight: nf ? 600 : 400 }} title={nf ? "Spot sits on the gamma-flip — a small move flips the dealer-hedging regime" : ""}>
        {r.distToFlipPct == null ? "—" : `${r.distToFlipPct >= 0 ? "+" : ""}${r.distToFlipPct.toFixed(1)}%`}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.pcRatio == null ? "var(--text-4)" : r.pcRatio >= 1.3 ? SHORT : r.pcRatio <= 0.7 ? LONG : "var(--text-3)" }} title="Put ÷ call open interest — ≥1.3 put-heavy (amber), ≤0.7 call-heavy (green)">{r.pcRatio ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-[#22c55e]">{r.callWall?.strike ?? "—"}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-[#ef4444]">{r.putWall?.strike ?? "—"}</td>
    </tr>
  );
}

export default function GammaBoardView({ universe, data }: { universe: string; data: GammaBoardData }) {
  const [sort, setSort] = useState<GammaSort>("gross");
  const [shortOnly, setShortOnly] = useState(false);
  const [flipOnly, setFlipOnly] = useState(false);

  const all = data.rows ?? [];
  const spx = all.find((r) => r.symbol === "SPY");
  const qqq = all.find((r) => r.symbol === "QQQ");

  const rows = useMemo(() => {
    let r = all;
    if (shortOnly) r = r.filter((x) => x.regime === "short");
    if (flipOnly) r = r.filter((x) => nearFlip(x));
    return rankGammaBoard(r, sort);
  }, [all, sort, shortOnly, flipOnly]);

  return (
    <main className="mx-auto max-w-[85rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Dealer Gamma Board</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Where options dealers are positioned across the most-optioned names. <b style={{ color: SHORT }}>Short gamma</b> <InfoDot term="Gamma exposure" /> = dealers chase price → moves <b>amplified</b> (trend/breakout risk); <b style={{ color: LONG }}>long gamma</b> = they fade price → moves <b>dampened / pinned</b>. Spot near the <b>flip</b> <InfoDot term="Gamma flip" /> = a small move flips the regime. {all.length} names · {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What&apos;s here:</b> the dealer-gamma (GEX) read for the most-optioned US names. <b>Net γ</b> is the dollar gamma dealers must hedge per 1% move — negative (short) means their hedging <b>chases</b> price and amplifies moves; positive (long) means they fade price and dampen moves. <b>Gross γ</b> is total positioning size regardless of sign.</p>
        <p><b>Flip / Δflip:</b> the spot level where net dealer gamma crosses zero, and how far spot sits from it (% of spot). Near 0 = the name sits on the regime boundary, where a small move flips dealer hedging from dampening to amplifying.</p>
        <p><b>P/C</b> is put ÷ call open interest — <span style={{ color: SHORT }}>≥1.3 put-heavy</span> (hedged/defensive) and <span style={{ color: LONG }}>≤0.7 call-heavy</span> (speculative) are color-coded. <b>Call/put walls</b> are the biggest-OI strikes — they often act as magnets or resistance/support into expiry.</p>
      </HowToRead>

      {(spx || qqq) && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:max-w-md">
          {spx && <MarketTile row={spx} />}
          {qqq && <MarketTile row={qqq} />}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 text-[12px]">
          {SORTS.map((s) => (
            <button key={s.key} onClick={() => setSort(s.key)} className={`rounded-md border px-2 py-1 ${sort === s.key ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{s.label}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-3 text-[12px] text-[var(--text-3)]">
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} className="accent-[var(--accent)]" /> Short γ only</label>
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={flipOnly} onChange={(e) => setFlipOnly(e.target.checked)} className="accent-[var(--accent)]" /> Near flip (±3%)</label>
        </div>
      </div>

      {!rows.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          {all.length ? "No names match the filter." : "No gamma data yet — populates on the nightly refresh (scans live option chains)."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Regime</th>
                <th className="px-2 py-2 text-right font-medium">Net γ<span className="normal-case">/1%</span></th>
                <th className="px-2 py-2 text-right font-medium">Gross γ</th>
                <th className="px-2 py-2 text-right font-medium">Spot</th>
                <th className="px-2 py-2 text-right font-medium">Flip</th>
                <th className="px-2 py-2 text-right font-medium" title="Distance from spot to the zero-gamma flip level (% of spot) — near 0 = on the regime boundary">Δflip</th>
                <th className="px-2 py-2 text-right font-medium">P/C <InfoDot term="Put/call ratio" /></th>
                <th className="px-2 py-2 text-right font-medium">Call wall <InfoDot term="Call wall" /></th>
                <th className="px-3 py-2 text-right font-medium">Put wall <InfoDot term="Put wall" /></th>
              </tr>
            </thead>
            <tbody>{rows.map((r) => <Row key={r.symbol} universe={universe} r={r} />)}</tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        The "naive" dealer model: dealers assumed long call gamma / short put gamma; GEX = Γ·OI·100·S²·1% summed over the nearest {""}
        expiries within ±40% of spot, from end-of-day open interest (IV solved from the mid). Real dealer books net across venues and expiries — this is a positioning <b>heuristic</b>, decision support, not a signal. US options only.
      </p>
    </main>
  );
}
