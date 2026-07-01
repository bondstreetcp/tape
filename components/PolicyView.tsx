"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { PolicyData, PolicyItem, PolicyKind } from "@/lib/policy";
import { impactColor, kindColor, kindLabel, fmtAmt } from "@/lib/policy";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
type KindF = "all" | PolicyKind;

export default function PolicyView({ universe, data }: { universe: string; data: PolicyData }) {
  const [kindF, setKindF] = useState<KindF>("all");
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.items.filter((i) => {
      if (kindF !== "all" && i.kind !== kindF) return false;
      if (ql && !i.tickers.some((t) => t.ticker.toLowerCase().includes(ql)) && !i.title.toLowerCase().includes(ql) && !(i.recipient || "").toLowerCase().includes(ql) && !i.agency.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.items, kindF, q]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const x of data.items) c[x.kind] = (c[x.kind] || 0) + 1; return c; }, [data.items]);
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Policy &amp; Contracts</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            <b style={{ color: kindColor("rule") }}>Federal rules</b> (tariffs, EPA, drug-pricing, FAA, FTC) mapped to the companies they hit, and large government <b style={{ color: kindColor("contract") }}>contract awards</b> mapped to the public contractor that won them. {data.items.length} items · {data.scanned} scanned · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setKindF("all")} className={TB(kindF === "all")}>All</button>
          <button onClick={() => setKindF("contract")} className={TB(kindF === "contract")}>Contracts ({counts["contract"] || 0})</button>
          <button onClick={() => setKindF("rule")} className={TB(kindF === "rule")}>Rules ({counts["rule"] || 0})</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, agency, or keyword…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{items.length} of {data.items.length}</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Sources: Federal Register + USAspending.gov. Rule→company mapping is a directional signal (AI-inferred), not a precise read. Not advice.
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No policy items ingested yet — this fills on the nightly run.</div>
      ) : (
        <div className="space-y-2.5">{items.map((i) => <PolicyCard key={i.id} i={i} universe={universe} />)}</div>
      )}
    </main>
  );
}

function PolicyCard({ i, universe }: { i: PolicyItem; universe: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in oklab, ${kindColor(i.kind)} 16%, transparent)`, color: kindColor(i.kind) }}>{kindLabel(i.kind)}</span>
        {i.tickers.map((t) => (
          <Link key={t.ticker} href={`/u/${universe}/stock/${t.ticker}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-semibold hover:underline" style={{ background: `color-mix(in oklab, ${impactColor(t.impact)} 14%, transparent)`, color: impactColor(t.impact) }} title={`${t.impact} for the stock`}>{t.ticker}</Link>
        ))}
        {i.amount != null && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[12px] text-[#22c55e]">{fmtAmt(i.amount)}</span>}
        <span className="ml-auto text-[11px] text-[var(--text-4)]">{dateLabel(i.date)}</span>
      </div>
      <p className="text-[13px] text-[var(--text)]">{i.summary}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-[var(--text-4)]">
        {i.agency && <span className="max-w-[280px] truncate">{i.agency}</span>}
        {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{i.kind === "contract" ? "USAspending ↗" : "Federal Register ↗"}</a>}
      </div>
    </div>
  );
}
