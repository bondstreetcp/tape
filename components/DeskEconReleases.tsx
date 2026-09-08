"use client";
import type { EconEvent } from "@/lib/econCalendar";

/**
 * "What's printing this week" strip for the top of the Daily Desk. Answers the wake-up question — is there a
 * big macro number today? — with CPI / PPI / jobs / PCE front-and-center (2026-09-08 review, @13:27). Data:
 * lib/econCalendar (exact on the FRED-key path, else a typical-schedule approximation flagged ≈); consensus
 * estimates are attached upstream (ForexFactory) when we have one. Client component so "Today/Tomorrow" is
 * relative to the viewer. Renders nothing when there's nothing in the window.
 */
const HIGH = new Set(["CPI", "PPI", "Jobs report (NFP)", "PCE / personal income", "GDP", "Retail sales"]);

export default function DeskEconReleases({ events }: { events: EconEvent[] }) {
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const rows = (events ?? [])
    .map((e) => {
      const [y, m, d] = e.date.split("-").map(Number);
      const diff = Math.round((new Date(y, m - 1, d).getTime() - todayMid) / 86_400_000);
      const label = diff <= 0 ? "Today" : diff === 1 ? "Tomorrow" : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
      return { e, diff, dayLabel: label };
    })
    .filter((r) => r.diff >= 0 && r.diff <= 7)
    .sort((a, b) => a.diff - b.diff || (HIGH.has(b.e.label) ? 1 : 0) - (HIGH.has(a.e.label) ? 1 : 0));
  if (!rows.length) return null;
  const hasToday = rows.some((r) => r.diff === 0);

  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-2)]">
          Economic releases <span className="font-normal text-[var(--text-4)]">— {hasToday ? "today & the week ahead" : "the week ahead"}</span>
        </h2>
        <span className="text-[11px] text-[var(--text-4)]">{hasToday ? "" : "nothing today · "}next 7 days</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r, i) => {
          const today = r.diff === 0;
          const high = HIGH.has(r.e.label);
          return (
            <span
              key={i}
              title={`${r.e.name}${r.e.approx ? " · approximate (typical schedule)" : ""}${r.e.estimate ? ` · consensus ${r.e.estimate.forecast}` : ""}`}
              className={
                "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] " +
                (today
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--bg)]")
              }
            >
              <span className={"font-semibold tabular-nums " + (today ? "text-[var(--accent)]" : "text-[var(--text-4)]")}>{r.dayLabel}</span>
              <span className={high ? "font-semibold text-[var(--text)]" : "text-[var(--text-2)]"}>{r.e.label}</span>
              {r.e.approx && <span className="text-[10px] text-[var(--text-4)]" title="Approximate — typical release date">≈</span>}
              {r.e.estimate && (
                <span className="rounded bg-[var(--surface-2)] px-1 text-[10px] font-semibold text-[var(--accent)]" title={`Consensus for "${r.e.estimate.title}" — via ForexFactory`}>
                  cons {r.e.estimate.forecast}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}
