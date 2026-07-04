"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { VolDisData } from "@/lib/volDislocation";
import { premColor, premVerdict } from "@/lib/volDislocation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type F = "back" | "contango" | "all";

// termCrush = front-tenor IV ÷ back-tenor IV. >1 = BACKWARDATED (front richer than back — event-loaded;
// the calendar seller's setup: sell the rich front, own the back). <1 = CONTANGO (front cheaper than back,
// the normal upward term structure; a reverse-calendar / own-the-front lean).
const setupOf = (tc: number): { t: string; c: string } =>
  tc >= 1.1 ? { t: "front IV rich — sell front / calendar", c: "#f59e0b" } : tc <= 0.95 ? { t: "front cheap vs back — own front / reverse", c: "#14b8a6" } : { t: "flat term structure", c: "var(--text-3)" };
const tcColor = (tc: number) => (tc >= 1.1 ? "#f59e0b" : tc <= 0.95 ? "#14b8a6" : "var(--text-2)");

export default function TermStructureView({ universe, data }: { universe: string; data: VolDisData }) {
  const [f, setF] = useState<F>("back");
  const [q, setQ] = useState("");

  const base = useMemo(() => data.rows.filter((r) => !r.illiquid && r.termCrush != null), [data.rows]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const rs = base.filter((r) => {
      const tc = r.termCrush as number;
      if (f === "back" && !(tc >= 1.1)) return false;
      if (f === "contango" && !(tc <= 0.95)) return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
    return [...rs].sort((a, b) => {
      const ta = a.termCrush as number, tb = b.termCrush as number;
      if (f === "back") return tb - ta; // most backwardated first
      if (f === "contango") return ta - tb; // steepest contango first
      return Math.abs(tb - 1) - Math.abs(ta - 1);
    });
  }, [base, f, q]);

  const backN = base.filter((r) => (r.termCrush as number) >= 1.1).length;
  const contangoN = base.filter((r) => (r.termCrush as number) <= 0.95).length;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Term structure — front vs back IV, calendar setups</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Front-tenor IV ÷ back-tenor IV <InfoDot term="Term crush" />. Above 1 = <b style={{ color: "#f59e0b" }}>backwardated</b> — the near-dated options are richer than the longer ones (event-loaded); the classic <b>calendar</b> <InfoDot term="Calendar spread" /> seller&apos;s setup (sell the rich front, own the back). Below 1 = <b style={{ color: "#14b8a6" }}>contango</b>, the normal upward term structure. {backN} backwardated · {contangoN} contango · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("back")} className={TB(f === "back")} title="Front IV richer than back — event-loaded, sell-front calendars">Backwardated ({backN})</button>
          <button onClick={() => setF("contango")} className={TB(f === "contango")} title="Front cheaper than back — normal upward term">Contango ({contangoN})</button>
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Term crush = ~1-month IV ÷ ~3-month IV, solved nightly from the chain. Steep backwardation is usually an EVENT (earnings/catalyst inside the front) — near-earnings names are flagged, and a calendar there is really an event trade. The <span style={{ color: "#f59e0b" }}>⚡</span> tag is an AI headline read. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium">ATM IV<InfoDot term="ATM" /></th>
              <th className="px-2 py-2 text-right font-medium" title="front-tenor IV ÷ back-tenor IV; >1 = backwardated">Term<InfoDot term="Term crush" /></th>
              <th className="px-2 py-2 font-medium">Setup</th>
              <th className="px-2 py-2 text-right font-medium" title="ATM IV ÷ realized vol">IV / RV<InfoDot term="IV / RV" /></th>
              <th className="px-2 py-2 whitespace-nowrap font-medium">Next earnings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tc = r.termCrush as number;
              const su = setupOf(tc);
              return (
                <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                    <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                    {r.catalyst && (
                      <div className="mt-0.5 max-w-[180px] truncate text-[11px]" style={{ color: r.catalyst.kind === "event" ? "#f59e0b" : "var(--text-4)" }} title={`AI read of recent headlines (${Math.round(r.catalyst.confidence * 100)}% conf)`}>⚡ {r.catalyst.text}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{pct(r.atmIV)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: tcColor(tc) }}>{tc.toFixed(2)}×</td>
                  <td className="px-2 py-2 text-[12px] font-medium" style={{ color: su.c }}>{su.t}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: premColor(r.ivPremium) }} title={premVerdict(r.ivPremium)}>{r.ivPremium.toFixed(2)}×</td>
                  <td className="px-2 py-2 whitespace-nowrap text-[11px]">
                    {r.earningsDriven && r.daysToEarnings != null ? <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-4)]" title="Reports inside the front expiry — the backwardation is this event">earnings {r.daysToEarnings}d</span> : r.daysToEarnings != null && r.daysToEarnings >= 0 ? <span className="text-[var(--text-4)]">{r.daysToEarnings}d</span> : <span className="text-[var(--text-4)]">—</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--text-4)]">No names match.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
