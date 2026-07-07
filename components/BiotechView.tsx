"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { BiotechData, BioCatalyst } from "@/lib/biotech";
import { statusColor, statusLabel, daysToReadout } from "@/lib/biotech";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const dateLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
type KindF = "all" | BioCatalyst["statusKind"];
type SortK = "readout" | "recent";

export default function BiotechView({ universe, data }: { universe: string; data: BiotechData }) {
  const [kindF, setKindF] = useState<KindF>("all");
  const [sort, setSort] = useState<SortK>("readout");
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const arr = data.items.filter((i) => {
      if (kindF !== "all" && i.statusKind !== kindF) return false;
      if (ql && !i.ticker.toLowerCase().includes(ql) && !i.company.toLowerCase().includes(ql) && !i.condition.toLowerCase().includes(ql) && !i.drug.toLowerCase().includes(ql)) return false;
      return true;
    });
    if (sort === "recent") return arr.slice().sort((a, b) => Date.parse(b.lastUpdate || "0") - Date.parse(a.lastUpdate || "0"));
    // readout: upcoming (soonest future) first, then most-recent past
    return arr.slice().sort((a, b) => {
      const da = daysToReadout(a.primaryCompletion), db = daysToReadout(b.primaryCompletion);
      const ka = da == null ? 1e9 : da >= 0 ? da : 1e6 - da, kb = db == null ? 1e9 : db >= 0 ? db : 1e6 - db;
      return ka - kb;
    });
  }, [data.items, kindF, sort, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Biotech Catalysts</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            A binary-event radar — recent status changes on Phase 2/3 industry trials from ClinicalTrials.gov (enrollment done, completed, terminated), plus announced FDA action dates (PDUFA) <InfoDot term="PDUFA" /> and Complete Response Letters <InfoDot term="CRL" /> from company 8-Ks, mapped to the public ticker with the event clock. {data.items.length} catalysts · {data.scanned} trials scanned · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setKindF("all")} className={TB(kindF === "all")}>All</button>
          <button onClick={() => setKindF("enrolling-done")} className={TB(kindF === "enrolling-done")} title="Enrollment complete — readout ahead">Readout ahead</button>
          <button onClick={() => setKindF("readout")} className={TB(kindF === "readout")} title="Trial completed — topline pending">Completed</button>
          <button onClick={() => setKindF("failed")} className={TB(kindF === "failed")} title="Terminated / suspended">Failed</button>
          <button onClick={() => setKindF("pdufa")} className={TB(kindF === "pdufa")} title="Announced FDA action dates (PDUFA)">PDUFA</button>
          <button onClick={() => setKindF("crl")} className={TB(kindF === "crl")} title="Complete Response Letters — the FDA declining an application">CRL</button>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setSort("readout")} className={TB(sort === "readout")}>Soonest readout</button>
          <button onClick={() => setSort("recent")} className={TB(sort === "recent")}>Recent change</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, sponsor, drug, indication…" className="w-56 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{items.length} of {data.items.length}</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Clinical-trial status is noisy and dates are estimates — a completion/enrollment date isn&apos;t the topline-announcement date. A public-data radar, not advice.
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No catalysts ingested yet — this fills on the nightly run.</div>
      ) : (
        <div className="space-y-2.5">{items.map((i) => <BioCard key={i.id} i={i} universe={universe} />)}</div>
      )}
    </main>
  );
}

function BioCard({ i, universe }: { i: BioCatalyst; universe: string }) {
  const d = daysToReadout(i.primaryCompletion);
  const clock = d == null ? "" : d >= 0 ? `in ${d}d` : `${-d}d ago`;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Link href={`/u/${universe}/stock/${i.ticker}`} className="text-sm font-semibold text-[var(--accent)] hover:underline">{i.ticker}</Link>
        <span className="text-[13px] text-[var(--text-2)]">{i.company}</span>
        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)]">{i.phase}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in oklab, ${statusColor(i.statusKind)} 16%, transparent)`, color: statusColor(i.statusKind) }}>{statusLabel(i.statusKind)}</span>
        {i.primaryCompletion && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)]" title={i.statusKind === "pdufa" ? "FDA target action date (from the company's 8-K)" : "estimated primary-endpoint (readout) date"}>{i.statusKind === "pdufa" ? "PDUFA" : "readout"} {dateLabel(i.primaryCompletion)} {clock && <b style={{ color: d != null && d >= 0 && d < 90 ? "#f59e0b" : "var(--text-4)" }}>· {clock}</b>}</span>}
        <span className="ml-auto text-[11px] text-[var(--text-4)]">updated {dateLabel(i.lastUpdate)}</span>
      </div>
      <p className="text-[13px] text-[var(--text)]">{i.catalyst}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-[var(--text-4)]">
        {i.condition && <span>{i.condition}</span>}
        {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{i.statusKind === "pdufa" || i.statusKind === "crl" ? "SEC 8-K ↗" : "ClinicalTrials.gov ↗"}</a>}
      </div>
    </div>
  );
}
