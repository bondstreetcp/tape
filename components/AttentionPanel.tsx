"use client";
import Link from "next/link";
import { type AttentionData, type AttnItem, ATTN_GROUP_ORDER, fmtViews, fmtPct, spikeRead, pctColor } from "@/lib/attention";

function Spark({ points }: { points: [string, number][] }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 116, H = 28, pad = 2;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => (max === min ? H / 2 : pad + (1 - (v - min) / (max - min)) * (H - 2 * pad));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <path d={d} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

function Card({ it, universe }: { it: AttnItem; universe: string }) {
  const sp = spikeRead(it.spikeZ);
  const spiking = (it.spikeZ ?? 0) >= 1;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" style={spiking ? { borderColor: `${sp.color}66` } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-[var(--text)]" title={it.label}>{it.label}</span>
            {it.ticker && (
              <Link href={`/u/${universe}/stock/${it.ticker}`} className="shrink-0 rounded bg-[var(--surface-2)] px-1 py-0.5 text-[9px] font-semibold text-[var(--text-3)] hover:text-[var(--accent)]">{it.ticker}</Link>
            )}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold leading-none tabular-nums text-[var(--text)]">{fmtViews(it.latest)}</span>
            <span className="text-[10px] text-[var(--text-4)]">views/day</span>
          </div>
        </div>
        <Spark points={it.history} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${sp.color}22`, color: sp.color }}>{sp.label}{it.spikeZ != null ? ` · ${it.spikeZ > 0 ? "+" : ""}${it.spikeZ.toFixed(1)}σ` : ""}</span>
        <span><b className="text-[var(--text-4)]">WoW</b> <span className="tabular-nums" style={{ color: pctColor(it.wowPct) }}>{fmtPct(it.wowPct)}</span></span>
      </div>
    </div>
  );
}

export default function AttentionPanel({ data, universe = "sp500" }: { data: AttentionData | null; universe?: string }) {
  if (!data || !data.items.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">
        Building the attention board — populates on the next nightly refresh.
      </div>
    );
  }
  const asOf = data.asOf ? new Date(data.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--text-3)]">
        Public attention as a demand proxy — daily <b className="text-[var(--text-2)]">Wikipedia pageviews</b> for the names people are looking up, and a few economic-anxiety topics. The <b className="text-[var(--text-2)]">spike</b> score is this week&apos;s views vs the trailing ~90-day norm: a surge means a name (or a worry) has jumped into the public eye. {asOf ? `As of ${asOf}.` : ""}
      </p>
      <div className="space-y-4">
        {ATTN_GROUP_ORDER.map((g) => {
          const rows = data.items.filter((it) => it.group === g).sort((a, b) => (b.spikeZ ?? -9) - (a.spikeZ ?? -9));
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{g}</div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map((it) => <Card key={it.key} it={it} universe={universe} />)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        Source: Wikimedia Pageviews API (English Wikipedia, all-access, all-agents) — free &amp; keyless. Pageviews are an attention/interest proxy, a free stand-in for search-interest demand; they don&apos;t measure sales. A spike can be good news or bad — read it with the tape. Decision-support, not investment advice.
      </p>
    </div>
  );
}
