"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import type { FusedRow, Setup } from "@/lib/volGamma";
import { nearFlipPct } from "@/lib/volGamma";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const pv = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const SETUP: Record<Setup, { label: string; c: string; hint: string }> = {
  coiled: { label: "Coiled", c: "#22c55e", hint: "Cheap realized vol + a dealer accelerant (short γ or on the flip) — buy optionality" },
  pinned: { label: "Pinned", c: "#60a5fa", hint: "Quiet + dealers long gamma, away from the flip — dampened, sell premium" },
  blown: { label: "Blown", c: "#f59e0b", hint: "RV already at the top of its cone + dealers short gamma — being amplified" },
  none: { label: "—", c: "var(--text-4)", hint: "" },
};

// Where current 21d RV sits between its cone min & max (green = coiled/low, red = blown/high).
function ConeBar({ r }: { r: FusedRow }) {
  if (r.min20 == null || r.max20 == null || r.cur20 == null || r.max20 <= r.min20) return <span className="text-[var(--text-4)]">—</span>;
  const pos = Math.max(0, Math.min(100, ((r.cur20 - r.min20) / (r.max20 - r.min20)) * 100));
  const c = r.pct20 == null ? "var(--text-4)" : r.pct20 <= 25 ? "#22c55e" : r.pct20 >= 75 ? "#ef4444" : "#f59e0b";
  return (
    <div className="relative h-3.5 w-full min-w-[80px] rounded bg-[var(--bg)]" title={`RV ${pv(r.cur20)} · cone ${pv(r.min20)}–${pv(r.max20)} · ${r.pct20?.toFixed(0)}th pct`}>
      <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--surface)]" style={{ left: `${pos}%`, background: c }} />
    </div>
  );
}

const FILTERS: { key: Setup | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "coiled", label: "Coiled springs" },
  { key: "pinned", label: "Pinned / quiet" },
  { key: "blown", label: "Blown + amplified" },
];

export default function CoiledSpringsView({ universe, rows, generatedAt }: { universe: string; rows: FusedRow[]; generatedAt: string | null }) {
  const [filter, setFilter] = useState<Setup | "all">("all");
  const counts = useMemo(() => {
    const m: Record<string, number> = { coiled: 0, pinned: 0, blown: 0 };
    for (const r of rows) if (r.setup !== "none") m[r.setup]++;
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const r = filter === "all" ? rows : rows.filter((x) => x.setup === filter);
    return [...r].sort((a, b) => (b.springScore ?? -1) - (a.springScore ?? -1));
  }, [rows, filter]);

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Coiled Springs</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Where cheap realized vol meets a dealer-gamma accelerant. A <b style={{ color: SETUP.coiled.c }}>coiled spring</b> <InfoDot term="Coiled spring" /> = realized vol near the <b>bottom of its own cone</b> (options cheap vs history) AND dealers positioned to <b>amplify</b> the next move (short gamma, or spot on the flip). Joins the Dealer Gamma Board × the Realized-Vol Cone. {rows.length} names · {generatedAt ? fmtDateTime(generatedAt) : "—"}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5 text-[12px]">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-md border px-2.5 py-1 ${filter === f.key ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>
            {f.label}{f.key !== "all" && counts[f.key] != null ? <span className="ml-1 text-[var(--text-4)]">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>

      {!shown.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          {rows.length ? (filter === "coiled" ? "No coiled springs right now — no name is at the bottom of its vol cone with a dealer accelerant. (Try All.)" : "No names in this setup right now.") : "Populates once both the gamma board and the vol cone have run on the nightly."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Setup</th>
                <th className="px-2 py-2 text-right font-medium">Score</th>
                <th className="px-2 py-2 font-medium" style={{ minWidth: 90 }}>RV in cone</th>
                <th className="px-2 py-2 text-right font-medium">RV %ile</th>
                <th className="px-2 py-2 text-right font-medium">RV 21d</th>
                <th className="px-2 py-2 font-medium">Dealer γ</th>
                <th className="px-2 py-2 text-right font-medium">Δflip</th>
                <th className="px-3 py-2 text-right font-medium">P/C</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const su = SETUP[r.setup];
                const near = nearFlipPct(r.distToFlipPct, 3);
                const gc = r.regime === "short" ? "#f59e0b" : "#22c55e";
                return (
                  <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2">
                      <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                      <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                    </td>
                    <td className="px-2 py-2">
                      {r.setup === "none" ? <span className="text-[var(--text-4)]">—</span> : <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: su.c, background: `color-mix(in oklab, ${su.c} 15%, transparent)` }} title={su.hint}>{su.label}</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-[var(--text-2)]">{r.springScore == null ? "—" : Math.round(r.springScore)}</td>
                    <td className="px-2 py-2"><ConeBar r={r} /></td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.pct20 == null ? "var(--text-4)" : r.pct20 <= 25 ? "#22c55e" : r.pct20 >= 75 ? "#ef4444" : "var(--text-3)" }}>{r.pct20 == null ? "—" : `${r.pct20.toFixed(0)}%`}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{pv(r.cur20)}</td>
                    <td className="px-2 py-2"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: gc, background: `color-mix(in oklab, ${gc} 15%, transparent)` }}>{r.regime === "short" ? "short" : "long"}</span></td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: near ? gc : "var(--text-3)", fontWeight: near ? 600 : 400 }} title={near ? "Spot on the gamma flip — a small move flips the regime" : ""}>{r.distToFlipPct == null ? "—" : `${r.distToFlipPct >= 0 ? "+" : ""}${r.distToFlipPct.toFixed(1)}%`}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.pcRatio ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        Score = coiled-ness (100 − RV percentile) + a short-gamma bonus (+25) + a flip-proximity bonus (+25 within ±3%). <b style={{ color: SETUP.coiled.c }}>Coiled</b> = RV ≤25th pct + short γ or on the flip (buy cheap optionality); <b style={{ color: SETUP.pinned.c }}>Pinned</b> = quiet + long γ away from the flip (dampened, sell premium); <b style={{ color: SETUP.blown.c }}>Blown</b> = RV ≥75th pct + short γ (already amplified). Realized cone from the price series; dealer gamma is the naive EOD-OI model — decision support, not a signal. US options only.
      </p>
    </main>
  );
}
