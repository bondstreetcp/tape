"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import { KIND_META, type CatalystEvent, type CatalystKind } from "@/lib/catalystCalendar";
import UniverseSwitcher from "./UniverseSwitcher";

const KINDS: CatalystKind[] = ["earnings", "investor-day", "biotech", "lockup"];
const HORIZONS = [
  { label: "2 weeks", d: 14 },
  { label: "1 month", d: 31 },
  { label: "3 months", d: 93 },
] as const;

function KindTag({ k }: { k: CatalystKind }) {
  const m = KIND_META[k];
  return <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: m.color, background: `color-mix(in oklab, ${m.color} 15%, transparent)` }}>{m.label}</span>;
}

/** Format an ISO date as e.g. "Mon Jul 13". */
function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : iso;
}

export default function CalendarView({
  universe,
  events,
  generatedAt,
}: {
  universe: string;
  events: CatalystEvent[];
  generatedAt: string;
}) {
  const [kinds, setKinds] = useState<Set<CatalystKind>>(new Set(KINDS));
  const [horizon, setHorizon] = useState(31);
  const toggle = (k: CatalystKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next.size ? next : new Set(KINDS); // never leave all off
    });

  const filtered = useMemo(
    () => events.filter((e) => e.daysTo <= horizon && kinds.has(e.kind)),
    [events, horizon, kinds],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, CatalystEvent[]>();
    for (const e of filtered) (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of events) if (e.daysTo <= horizon) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [events, horizon]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[70rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Catalyst Calendar</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every upcoming dated catalyst on one timeline — earnings, investor/analyst days, clinical readouts, and IPO lockup expiries — pulled from the app&apos;s event feeds. {fmtDateTime(generatedAt)}.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {HORIZONS.map((h) => <button key={h.d} onClick={() => setHorizon(h.d)} className={TB(horizon === h.d)}>{h.label}</button>)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => {
            const on = kinds.has(k), m = KIND_META[k];
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                className="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
                style={on
                  ? { color: m.color, borderColor: m.color, background: `color-mix(in oklab, ${m.color} 12%, transparent)` }
                  : { color: "var(--text-4)", borderColor: "var(--border)" }}
              >
                {m.label} <span className="tabular-nums opacity-70">{counts[k] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {!byDate.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
          No catalysts in this window. Widen the horizon or the event filters — feeds fill on the nightly refresh.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {byDate.map(([date, evs]) => (
            <div key={date}>
              <div className="mb-1.5 flex items-baseline gap-2 border-b border-[var(--divider)] pb-1">
                <h2 className="text-[13px] font-bold text-[var(--text)]">{fmtDay(date)}</h2>
                <span className="text-[11px] text-[var(--text-4)]">{evs[0].daysTo === 0 ? "today" : `in ${evs[0].daysTo}d`}</span>
                <span className="ml-auto text-[11px] text-[var(--text-4)]">{evs.length} event{evs.length > 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {evs.map((e, i) => (
                  <div key={e.ticker + e.kind + i} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <KindTag k={e.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <Link href={`/u/${universe}/stock/${e.ticker}`} className="font-semibold text-[var(--accent)] hover:underline">{e.ticker}</Link>
                        <span className="truncate text-[12px] text-[var(--text-4)]">{e.company}</span>
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-3)]">
                        {e.label}{e.detail ? ` · ${e.detail}` : ""}
                      </div>
                    </div>
                    {e.url && <a href={e.url} target="_blank" rel="noreferrer" title="Source" className="shrink-0 text-[11px] text-[var(--text-4)] hover:text-[var(--accent)]">↗</a>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-4)]">
        Aggregated from the Earnings Move, Catalyst Vol, Biotech Catalysts, and IPO/Lockup feeds — US-listed names. Dates are the best available (earnings dates can be estimates; biotech uses the trial&apos;s primary-completion date). Research / decision-support, not investment advice.
      </p>
    </main>
  );
}
