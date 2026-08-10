"use client";
/** Value-chain board (/chains): one hand-written chain at a time, layers stacked in supply-chain
 *  ORDER with per-layer sourced economics. Every non-seed member states the gate that admitted it
 *  (visible per-layer "expanded via" line — hover isn't available on touch); refused-ambiguous
 *  names and seeds missing from the cache are printed per chain, not hidden. Thin medians (n<3)
 *  render muted so a one-company "median" can't borrow the authority of a real one. */
import { useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ValueChainsFile, ChainLayerRow, ChainMember } from "@/lib/valueChains";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import WatchStar from "./WatchStar";
import { fmtDate } from "@/lib/format";

const COLLAPSE_AT = 14;

const pct = (v: number | null, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
const pp = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}pp`);
const mcap = (v: number) =>
  v >= 9.995e11 ? `$${(v / 1e12).toFixed(1)}T`
  : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : "<$1M";

function Stat({ label, value, n, info }: { label: string; value: string; n?: number; info: string }) {
  const thin = n != null && n < 3; // a median of 1-2 members is an anecdote — mute it
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">
        {label} <InfoDot text={info} />
      </span>
      <span className={`text-[13px] font-semibold ${thin ? "text-[var(--text-4)]" : "text-[var(--text)]"}`}>
        {value}
        {n != null && <span className="ml-1 font-normal text-[10px] text-[var(--text-4)]">n={n}</span>}
      </span>
    </div>
  );
}

function MemberChip({ m, universe }: { m: ChainMember; universe: string }) {
  const provenance = m.source === "seed" ? "Hand-picked seed" : `Admitted by ${m.source}: ${m.via}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] ${
        m.source === "seed" ? "border-[var(--border)]" : "border-dashed border-[var(--border)]"
      }`}
      title={`${m.name || m.symbol} · ${provenance}${m.gm != null ? ` · GM ${pct(m.gm)}` : ""}`}
    >
      <WatchStar symbol={m.symbol} compact />
      <Link
        href={`/u/${universe}/stock/${encodeURIComponent(m.symbol)}`}
        className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]"
      >
        {m.symbol}
      </Link>
      {m.mcap != null && <span className="text-[10px] text-[var(--text-4)]">{mcap(m.mcap)}</span>}
    </span>
  );
}

/** Visible provenance (hover tooltips don't exist on touch): which gates expanded this layer. */
function gateSummary(members: ChainMember[]): string | null {
  const counts = new Map<string, number>();
  for (const m of members) if (m.source !== "seed" && m.via) counts.set(m.via, (counts.get(m.via) || 0) + 1);
  if (!counts.size) return null;
  return [...counts.entries()].map(([via, n]) => `${via} (${n})`).join(" · ");
}

function LayerCard({ layer, universe, last }: { layer: ChainLayerRow; universe: string; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? layer.members : layer.members.slice(0, COLLAPSE_AT);
  const hidden = layer.members.length - shown.length;
  const e = layer.econ;
  const gates = gateSummary(layer.members);
  return (
    <div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[15px] font-semibold text-[var(--text)]">{layer.name}</h3>
          <span className="text-[12px] text-[var(--text-3)]">{layer.role}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Gross margin" value={pct(e.gmMedian)} n={e.gmN} info="Median TTM gross margin across layer members (Yahoo stats). n = members with the stat; muted when n<3." />
          <Stat label="GM YoY" value={pp(e.gmYoYpp)} n={e.gmYoYN} info="Median change in ANNUAL gross margin, latest fiscal year vs prior, in percentage points. Abstains for members without two comparable fiscal years; muted when n<3." />
          <Stat label="Op margin" value={pct(e.opMedian)} n={e.opN} info="Median TTM operating margin." />
          <Stat label="ROA" value={pct(e.roaMedian)} n={e.roaN} info="Median TTM return on assets — capital productivity comparable across layers with different leverage." />
          <Stat label="Rev growth" value={pct(e.rgMedian)} n={e.rgN} info="Median TTM revenue growth (YoY)." />
          <Stat label="Cap HHI" value={e.hhi == null ? "—" : String(e.hhi)} n={e.mcapN} info="Market-cap Herfindahl within the layer (0–10,000; above ~2,500 = concentrated). n = members with a market cap — the rest are invisible to this stat." />
          <Stat label="Layer cap" value={e.totalMcap ? mcap(e.totalMcap) : "—"} n={e.mcapN} info="Combined market cap of the n members that have one — a member missing its cap is missing from this sum. Size of the prize, not a quality signal." />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {shown.map((m) => <MemberChip key={m.symbol} m={m} universe={universe} />)}
          {hidden > 0 && (
            <button onClick={() => setExpanded(true)} className="rounded-md px-1.5 py-0.5 text-[12px] text-[var(--text-4)] hover:text-[var(--text)]">
              +{hidden} more
            </button>
          )}
        </div>
        {gates && <div className="mt-2 text-[11px] text-[var(--text-4)]">Expanded via: {gates}</div>}
        {layer.missingSeeds.length > 0 && (
          <div className="mt-1 text-[11px] text-[var(--text-4)]">Seeds not in the company cache: {layer.missingSeeds.join(", ")}</div>
        )}
      </div>
      {!last && <div className="my-1 text-center text-[var(--text-4)]" aria-hidden>↓</div>}
    </div>
  );
}

export default function ValueChainsView({ universe, data }: { universe: string; data: ValueChainsFile }) {
  // Key, not object: a snapshot ChainRow would keep rendering stale layers if the payload refreshes.
  const [activeKey, setActiveKey] = useState(data.chains[0]?.key);
  const active = data.chains.find((c) => c.key === activeKey) ?? data.chains[0];
  return (
    <main className="mx-auto max-w-[76rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-[13px] text-[var(--text-4)] hover:text-[var(--text)]">
        ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
      </Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Value Chains"
        desc="Hand-written supply chains rendered as ordered layers, upstream to downstream, with sourced economics per layer — median margins, capital productivity and market-cap concentration, each with its n. Membership is seeds plus exact-industry or description-anchor matches; each layer lists the gates that expanded it, and ambiguous fits are refused rather than guessed. No lead-lag claims — a walk-forward test killed that leg honestly. Decision-support, not advice."
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {data.chains.map((c) => (
          <button
            key={c.key}
            onClick={() => setActiveKey(c.key)}
            className={`rounded-lg border px-2.5 py-1 text-[13px] transition-colors ${
              active.key === c.key
                ? "border-[var(--border-strong)] bg-[var(--surface)] font-semibold text-[var(--text)]"
                : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="mb-3 text-[11px] text-[var(--text-4)]">
        {active.blurb} · {active.layers.reduce((a, l) => a + l.econ.n, 0)} member rows across {active.layers.length} layers (a name serving
        two rungs appears in both) · {active.ambiguous.length} refused as ambiguous · {fmtDate(data.generatedAt)} · scanned{" "}
        {data.usScanned.toLocaleString()} US names ({data.described.toLocaleString()} with descriptions)
      </div>
      <div className="max-w-4xl">
        {active.layers.map((l, i) => (
          <LayerCard key={`${active.key}:${l.key}`} layer={l} universe={universe} last={i === active.layers.length - 1} />
        ))}
      </div>
      {active.ambiguous.length > 0 && (
        <p className="mt-3 max-w-4xl text-[11px] text-[var(--text-4)]">
          Refused as ambiguous (matched multiple layers): {active.ambiguous.map((a) => a.symbol).join(", ")} — a name that fits two rungs gets neither.
        </p>
      )}
      <p className="mt-2 max-w-4xl text-[11px] text-[var(--text-4)]">
        Layer order and rosters are hand-written, reviewable definitions (lib/valueChains.ts) — solid-border chips are seeds, dashed chips were
        admitted by the industry or description gates listed under each layer. Medians hide dispersion; hover a chip for its own gross margin. Not investment advice.
      </p>
    </main>
  );
}
