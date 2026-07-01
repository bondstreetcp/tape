"use client";
import Link from "next/link";
import type { IpoEvent } from "@/lib/ipoMonitor";
import { fmtSize, perfColor } from "@/lib/ipoMonitor";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function IpoDetailView({ universe, event }: { universe: string; event: IpoEvent }) {
  const e = event;
  const kindLabel = e.kind === "upcoming" ? "Upcoming IPO" : e.kind === "ipo" ? "Recent IPO" : "IPO · lockup approaching";
  const kindColor = e.kind === "upcoming" ? "#a78bfa" : e.kind === "ipo" ? "#22c55e" : "#f59e0b";
  const s = e.summary;

  const Fact = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-[15px] font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</div>
      {children}
    </section>
  );

  return (
    <main className="mx-auto max-w-[52rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}/ipos`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← IPOs &amp; Lockups</Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <h1 className="text-2xl font-bold">{e.company}</h1>
        {e.ticker && <span className="font-mono text-lg text-[var(--accent)]">{e.ticker}</span>}
        <span className="rounded px-2 py-0.5 text-[12px] font-semibold" style={{ background: `color-mix(in oklab, ${kindColor} 16%, transparent)`, color: kindColor }}>{kindLabel}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-4">
        <Fact label={e.kind === "upcoming" ? "Filed" : "IPO date"} value={dateLabel(e.ipoDate)} />
        <Fact label={e.kind === "upcoming" ? "Proposed price" : "Offer price"} value={e.priceUsd != null ? `$${e.priceUsd}` : "—"} />
        <Fact label="Deal size" value={fmtSize(e.sizeUsdM)} />
        <Fact label="Exchange" value={e.exchange || "—"} />
        {e.kind !== "upcoming" && <Fact label="Since IPO" value={e.sinceIpoPct == null ? "—" : `${e.sinceIpoPct >= 0 ? "+" : ""}${e.sinceIpoPct.toFixed(1)}%`} color={perfColor(e.sinceIpoPct)} />}
        {e.kind === "lockup" && e.lockupDate && <Fact label="Lockup expiry" value={`${dateLabel(e.lockupDate)}${e.daysToLockup != null ? ` (${e.daysToLockup >= 0 ? "in " + e.daysToLockup + "d" : -e.daysToLockup + "d ago"})` : ""}`} />}
        {s?.sector && <Fact label="Sector" value={s.sector} />}
      </div>

      {s?.underwriters && s.underwriters.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Underwriters / book-runners</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.underwriters.map((u, i) => (
              <span key={i} className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[12.5px] text-[var(--text-2)]">{u}</span>
            ))}
          </div>
        </div>
      )}

      {s ? (
        <div className="mt-4 space-y-3">
          <Section title="What the company does"><p className="text-[14px] leading-relaxed text-[var(--text-2)]">{s.business}</p></Section>
          {s.financials && <Section title="Financials"><p className="text-[13px] leading-relaxed text-[var(--text-2)]">{s.financials}</p></Section>}
          {s.useOfProceeds && <Section title="Use of proceeds"><p className="text-[13px] leading-relaxed text-[var(--text-2)]">{s.useOfProceeds}</p></Section>}
          {s.risks.length > 0 && (
            <Section title="Key risks">
              <ul className="space-y-1">{s.risks.map((r, i) => <li key={i} className="flex gap-1.5 text-[13px] text-[var(--text-3)]"><span className="text-[#ef4444]">▸</span>{r}</li>)}</ul>
            </Section>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-[13px] text-[var(--text-3)]">No prospectus summary on file yet — it&apos;s generated on the nightly run.</div>
      )}

      <div className="mt-4 text-[12px] text-[var(--text-4)]">
        {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">Read the SEC prospectus ↗</a>}
        <span> · AI summary of the S-1 / 424B4 prospectus — decision support, not advice.</span>
      </div>
    </main>
  );
}
