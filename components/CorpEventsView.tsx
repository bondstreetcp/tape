"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CorpEventsData, CorpEvent, CorpEventType } from "@/lib/corpEvents";
import { typeColor, typeLabel, perfColor } from "@/lib/corpEvents";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pctStr = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
type TypeF = "all" | CorpEventType;
const TYPES: CorpEventType[] = ["buyback", "strategic-alt", "spin-off", "split", "leadership"];

export default function CorpEventsView({ universe, data }: { universe: string; data: CorpEventsData }) {
  const [typeF, setTypeF] = useState<TypeF>("all");
  const [q, setQ] = useState("");

  const events = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.events.filter((e) => {
      if (typeF !== "all" && e.type !== typeF) return false;
      if (ql && !(e.ticker || "").toLowerCase().includes(ql) && !e.company.toLowerCase().includes(ql) && !e.headline.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.events, typeF, q]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const x of data.events) c[x.type] = (c[x.type] || 0) + 1; return c; }, [data.events]);
  const TB = (a: boolean) => "rounded-md px-2 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Corporate Events</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The one-off catalysts from SEC 8-Ks — <b style={{ color: typeColor("buyback") }}>buybacks</b>, <b style={{ color: typeColor("strategic-alt") }}>strategic alternatives</b>, <b style={{ color: typeColor("spin-off") }}>spin-offs</b>, <b style={{ color: typeColor("split") }}>splits</b>, and <b style={{ color: typeColor("leadership") }}>CEO/CFO changes</b> — AI-extracted, with the stock since. {data.events.length} events · {data.scanned} filings scanned · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setTypeF("all")} className={TB(typeF === "all")}>All</button>
          {TYPES.map((t) => <button key={t} onClick={() => setTypeF(t)} className={TB(typeF === t)}>{typeLabel(t)} ({counts[t] || 0})</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, company, keyword…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{events.length} of {data.events.length}</span>
      </div>

      {data.events.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No events ingested yet — this fills on the nightly run.</div>
      ) : (
        <div className="space-y-2">{events.map((e) => <EventCard key={e.id} e={e} universe={universe} />)}</div>
      )}
    </main>
  );
}

function EventCard({ e, universe }: { e: CorpEvent; universe: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in oklab, ${typeColor(e.type)} 16%, transparent)`, color: typeColor(e.type) }}>{typeLabel(e.type)}</span>
        {e.ticker && <Link href={`/u/${universe}/stock/${e.ticker}`} className="text-sm font-semibold text-[var(--accent)] hover:underline">{e.ticker}</Link>}
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{e.headline}</span>
        {e.sincePct != null && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[12px]" style={{ color: perfColor(e.sincePct) }} title="stock since the filing">{pctStr(e.sincePct)}</span>}
        <span className="text-[11px] text-[var(--text-4)]">{dateLabel(e.date)}</span>
        {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">8-K ↗</a>}
      </div>
    </div>
  );
}
