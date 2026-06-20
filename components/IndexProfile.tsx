"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StockRow } from "@/lib/types";
import type { IndexMeta } from "@/lib/indices";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import IndexChart from "./IndexChart";
import Treemap from "./Treemap";
import TimeframeSelector from "./TimeframeSelector";

export default function IndexProfile({
  universe,
  meta,
  constituents,
}: {
  universe: string;
  meta: IndexMeta;
  constituents: StockRow[];
}) {
  const router = useRouter();
  const [tf, setTf] = usePersistedTimeframe(null, "1y");
  const linkedUniverse = meta.universe && UNIVERSE_BY_ID[meta.universe] ? UNIVERSE_BY_ID[meta.universe] : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <Link href={`/u/${universe}/market`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Markets</Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{meta.name}</h1>
          <span className="font-mono text-sm text-[var(--text-4)]">{meta.symbol}</span>
        </div>
      </header>

      <IndexChart symbol={meta.symbol} name={meta.name} />

      {meta.about && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="mb-1 text-sm font-semibold text-[var(--text-2)]">About</h2>
          <p className="text-sm leading-relaxed text-[var(--text-2)]">{meta.about}</p>
        </section>
      )}

      {linkedUniverse && (
        <Link
          href={`/u/${meta.universe}`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#2563eb]/50 bg-[#2563eb]/15 px-3 py-2 text-sm font-medium text-[#93c5fd] transition-colors hover:bg-[#2563eb]/25"
        >
          ⊞ Explore the {linkedUniverse.name} constituent heatmap →
        </Link>
      )}

      {constituents.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-2)]">Constituents · {constituents.length} names</h2>
            <TimeframeSelector value={tf} onChange={setTf} />
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2">
            <Treemap
              stocks={constituents}
              tf={tf}
              filter="all"
              threshold={2}
              selected={null}
              onSelect={(s) => { if (s) router.push(`/u/${universe}/stock/${encodeURIComponent(s)}`); }}
              groupBy="sector"
            />
          </div>
          <p className="mt-2 text-center text-xs text-[var(--text-3)]">Sized by market cap, colored by return. Click a tile to open the stock.</p>
        </section>
      )}

      <p className="mt-4 text-[11px] text-[var(--text-4)]">Index level via Yahoo (daily). {meta.symbol === "^DJI" ? "The Dow is price-weighted; the heatmap sizes members by market cap for legibility." : ""}</p>
    </main>
  );
}
