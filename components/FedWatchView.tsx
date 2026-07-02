"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { FedWatchData, FedItem, Bias, FedKind } from "@/lib/fedWatch";
import { biasColor, biasLabel, kindLabel, currentStance } from "@/lib/fedWatch";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
type KindF = "all" | "statement" | "speech";

export default function FedWatchView({ universe, data }: { universe: string; data: FedWatchData }) {
  const [kindF, setKindF] = useState<KindF>("all");
  const [biasF, setBiasF] = useState<Bias | "all">("all");
  const stance = useMemo(() => currentStance(data.items), [data.items]);

  const items = useMemo(() => data.items.filter((i) => {
    if (kindF === "statement" && !(i.kind === "statement" || i.kind === "minutes" || i.kind === "beige-book")) return false;
    if (kindF === "speech" && i.kind !== "speech") return false;
    if (biasF !== "all" && i.bias !== biasF) return false;
    return true;
  }), [data.items, kindF, biasF]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const st = stance.statement, tal = stance.speechTally;

  return (
    <main className="mx-auto max-w-[70rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Fed Watch</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            FOMC statements &amp; minutes, Fed-speaker speeches, and the Beige Book — read by AI and scored <b style={{ color: biasColor("hawkish") }}>hawkish</b> ↔ <b style={{ color: biasColor("dovish") }}>dovish</b> <InfoDot term="Hawkish / dovish" />, with what changed. The policy narrative next to your FRED numbers. {data.items.length} items · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {st && (
        <div className="mb-4 rounded-xl border bg-[var(--accent-soft)] p-4" style={{ borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)" }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Latest FOMC · {dateLabel(st.date)}</span>
            <span className="rounded px-2 py-0.5 text-sm font-bold" style={{ background: `color-mix(in oklab, ${biasColor(st.bias)} 18%, transparent)`, color: biasColor(st.bias) }}>{biasLabel(st.bias)}</span>
            <span className="text-[12px] text-[var(--text-4)]">recent speeches: <b style={{ color: biasColor("hawkish") }}>{tal.hawkish}H</b> / <b style={{ color: biasColor("dovish") }}>{tal.dovish}D</b> / {tal.neutral}N</span>
          </div>
          <p className="mt-1.5 text-[14px] text-[var(--text)]">{st.headline}</p>
          {st.whatChanged && <p className="mt-1 text-[13px] text-[var(--text-3)]"><b className="text-[var(--text-2)]">What changed:</b> {st.whatChanged}</p>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setKindF("all")} className={TB(kindF === "all")}>All</button>
          <button onClick={() => setKindF("statement")} className={TB(kindF === "statement")}>Statements</button>
          <button onClick={() => setKindF("speech")} className={TB(kindF === "speech")}>Speeches</button>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setBiasF("all")} className={TB(biasF === "all")}>Any</button>
          <button onClick={() => setBiasF("hawkish")} className={TB(biasF === "hawkish")} style={biasF === "hawkish" ? undefined : { color: biasColor("hawkish") }}>Hawkish</button>
          <button onClick={() => setBiasF("dovish")} className={TB(biasF === "dovish")} style={biasF === "dovish" ? undefined : { color: biasColor("dovish") }}>Dovish</button>
        </div>
        <span className="ml-auto text-xs text-[var(--text-4)]">{items.length} of {data.items.length}</span>
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No Fed communications ingested yet — this fills on the nightly run.</div>
      ) : (
        <div className="space-y-2.5">{items.map((i) => <FedCard key={i.id} i={i} />)}</div>
      )}
    </main>
  );
}

function FedCard({ i }: { i: FedItem }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in oklab, ${biasColor(i.bias)} 16%, transparent)`, color: biasColor(i.bias) }}>{biasLabel(i.bias)}</span>
        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)]">{kindLabel(i.kind)}</span>
        <span className="text-[13px] font-medium text-[var(--text)]">{i.title}</span>
        <span className="ml-auto text-[12px] text-[var(--text-4)]">{dateLabel(i.date)}</span>
      </div>
      <p className="text-[13px] leading-snug text-[var(--text-2)]">{i.headline}</p>
      {i.whatChanged && <p className="mt-1 text-[12px] text-[var(--text-3)]"><b className="text-[var(--text-2)]">What changed:</b> {i.whatChanged}</p>}
      {i.points.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {i.points.map((p, k) => <li key={k} className="flex gap-1.5 text-[12px] text-[var(--text-3)]"><span className="text-[var(--text-4)]">·</span>{p}</li>)}
        </ul>
      )}
      {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[12px] text-[var(--accent)] hover:underline">Read at federalreserve.gov ↗</a>}
    </div>
  );
}
