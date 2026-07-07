"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import type { VolConeData, VolConeFeedRow } from "@/lib/volCone";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";

const vpct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const COIL = "#22c55e"; // quiet / coiled (RV low in own history)
const BLOWN = "#ef4444"; // blown out (RV high)
const coneColor = (p: number | null) => (p == null ? "var(--text-4)" : p <= 25 ? COIL : p >= 75 ? BLOWN : "#f59e0b");

type Sort = "coiled" | "blown" | "expanding" | "contracting" | "highRv";
const SORTS: { key: Sort; label: string }[] = [
  { key: "coiled", label: "Coiled (low in cone)" },
  { key: "blown", label: "Blown out (high)" },
  { key: "expanding", label: "Vol expanding" },
  { key: "contracting", label: "Vol contracting" },
  { key: "highRv", label: "Highest RV" },
];

// The "position in cone" bar: min→max range, a median tick, and a marker at current RV.
function ConeBar({ r }: { r: VolConeFeedRow }) {
  if (r.min20 == null || r.max20 == null || r.cur20 == null || r.max20 <= r.min20) return <span className="text-[var(--text-4)]">—</span>;
  const span = r.max20 - r.min20;
  const pos = Math.max(0, Math.min(100, ((r.cur20 - r.min20) / span) * 100));
  const medPos = r.med20 == null ? null : Math.max(0, Math.min(100, ((r.med20 - r.min20) / span) * 100));
  const c = coneColor(r.pct20);
  return (
    <div className="relative h-4 w-full min-w-[90px] rounded bg-[var(--bg)]" title={`min ${vpct(r.min20)} · med ${vpct(r.med20)} · max ${vpct(r.max20)} · now ${vpct(r.cur20)} (${r.pct20?.toFixed(0)}th pct)`}>
      <div className="absolute inset-y-0 left-0 rounded bg-[var(--border-strong)]/40" style={{ width: "100%" }} />
      {medPos != null && <div className="absolute top-0 h-4 w-px bg-[var(--text-4)]" style={{ left: `${medPos}%` }} />}
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--surface)]" style={{ left: `${pos}%`, background: c }} />
    </div>
  );
}

function TermBadge({ s }: { s: number | null }) {
  if (s == null) return <span className="text-[var(--text-4)]">—</span>;
  const pct = (s * 100).toFixed(0);
  if (s > 0.15) return <span className="font-mono text-[11px] text-[#ef4444]" title="Short-horizon RV above long — vol expanding (recent shock)">▲ +{pct}%</span>;
  if (s < -0.15) return <span className="font-mono text-[11px] text-[#22c55e]" title="Short-horizon RV below long — vol contracting (calming)">▼ {pct}%</span>;
  return <span className="font-mono text-[11px] text-[var(--text-4)]" title="Short ≈ long horizon RV">≈ {pct}%</span>;
}

function Row({ universe, r }: { universe: string; r: VolConeFeedRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
      <td className="px-3 py-2">
        <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
        <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
      </td>
      <td className="hidden px-2 py-2 text-[12px] text-[var(--text-3)] sm:table-cell">{r.sector}</td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-[var(--text-2)]">{vpct(r.cur20)}</td>
      <td className="px-2 py-2"><ConeBar r={r} /></td>
      <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: coneColor(r.pct20) }} title="Where current 21-day RV sits in this name's own history">{r.pct20 == null ? "—" : `${r.pct20.toFixed(0)}%`}</td>
      <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)] md:table-cell">{vpct(r.cur63)}</td>
      <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)] md:table-cell">{vpct(r.cur252)}</td>
      <td className="px-3 py-2 text-right"><TermBadge s={r.termSlope} /></td>
    </tr>
  );
}

export default function VolConeView({ universe, data }: { universe: string; data: VolConeData }) {
  const [sort, setSort] = useState<Sort>("coiled");
  const all = data.rows ?? [];

  const rows = useMemo(() => {
    const r = all.filter((x) => x.pct20 != null);
    switch (sort) {
      case "blown": return [...r].sort((a, b) => (b.pct20 ?? 0) - (a.pct20 ?? 0));
      case "expanding": return [...r].sort((a, b) => (b.termSlope ?? -9) - (a.termSlope ?? -9));
      case "contracting": return [...r].sort((a, b) => (a.termSlope ?? 9) - (b.termSlope ?? 9));
      case "highRv": return [...r].sort((a, b) => (b.cur20 ?? 0) - (a.cur20 ?? 0));
      default: return [...r].sort((a, b) => (a.pct20 ?? 999) - (b.pct20 ?? 999)); // coiled
    }
  }, [all, sort]);

  return (
    <main className="mx-auto max-w-[82rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Realized-Vol Cone</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Where each name&apos;s <b>current</b> realized volatility <InfoDot term="Realized vol cone" /> sits inside its <b>own</b> historical range. <b style={{ color: COIL }}>Bottom of the cone</b> = historically quiet (coiled — cheap gamma / breakout risk); <b style={{ color: BLOWN }}>top</b> = blown out (mean-reversion / sell premium). The dot marks today; the tick is the median. {rows.length} names · {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What this measures:</b> each stock&apos;s volatility is compared only to <b>its own history</b> — 10/21/63/126/252-day realized vol vs the full range those horizons have spanned in the past (the &quot;cone&quot;). No cross-stock comparison, so a sleepy utility and a meme name each get judged against themselves.</p>
        <p><b>The percentile</b> is where today&apos;s 21-day realized vol sits in that history: <b style={{ color: COIL }}>0–25th</b> = about as quiet as this name ever gets (coiled — options tend to be cheap right before regime changes); <b style={{ color: BLOWN }}>75–100th</b> = blown out (vol tends to mean-revert — premium selling territory).</p>
        <p><b>Default sort is &quot;coiled first&quot;</b> — lowest percentile at the top. The other tabs re-sort by blown-out, vol expanding/contracting (term slope), or highest raw vol.</p>
        <p><b>The mini-cone graphic:</b> the dot is today, the tick is the median, the band is the historical min→max. A dot hugging the bottom of its band with a rising term slope is the classic pre-breakout compression.</p>
      </HowToRead>

      <div className="mb-2 flex flex-wrap gap-1 text-[12px]">
        {SORTS.map((s) => (
          <button key={s.key} onClick={() => setSort(s.key)} className={`rounded-md border px-2 py-1 ${sort === s.key ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}>{s.label}</button>
        ))}
      </div>

      {!rows.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          {all.length ? "No names in this universe have enough price history yet." : "No vol-cone data yet — populates on the nightly refresh (pure local math off the price series)."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">Sector</th>
                <th className="px-2 py-2 text-right font-medium">RV 21d</th>
                <th className="px-2 py-2 font-medium" style={{ minWidth: 110 }}>Position in cone</th>
                <th className="px-2 py-2 text-right font-medium">Pct<InfoDot term="Realized vol cone" /></th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">RV 63d</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">RV 1y</th>
                <th className="px-3 py-2 text-right font-medium">Term</th>
              </tr>
            </thead>
            <tbody>{rows.slice(0, 400).map((r) => <Row key={r.symbol} universe={universe} r={r} />)}</tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        Annualized close-to-close realized vol over 10/21/63/126/252 trading days; the &ldquo;cone&rdquo; is the min→max range of each horizon&apos;s rolling RV across the name&apos;s full stored history, with today marked. <b>Term</b> = 21d ÷ 126d − 1 (▲ expanding after a recent shock, ▼ contracting/calming). Realized only — no options/implied vol. Works for every universe. Showing the top {Math.min(400, rows.length)}.
      </p>
    </main>
  );
}
