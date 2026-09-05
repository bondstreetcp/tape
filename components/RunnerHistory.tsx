import type { TickHistory, TickReport, TickEntry } from "@/lib/tickHistory";
import { tickVerdict, summarizeTick, dayCells, TICK_HISTORY_DAYS } from "@/lib/tickHistory";

/**
 * The runner's last thirty days on the status page: a day strip (worst tick per ET day), the last
 * dozen ticks with their failed steps, and the errors the last tick swallowed on purpose. Before this
 * the only record of a tick was data/tick-report.json — one tick, overwritten hourly — so a step that
 * failed every night at 23:00 and passed every hour after was invisible by morning.
 *
 * Rendered inside StatusView (a client component), so this imports only the PURE tick-history helpers.
 */

const GREEN = "#22c55e", AMBER = "#f59e0b", RED = "#ef4444";
const COLOR: Record<"ok" | "partial" | "broken" | "none", string> = { ok: GREEN, partial: AMBER, broken: RED, none: "var(--border)" };
const LABEL: Record<"ok" | "partial" | "broken", string> = { ok: "clean", partial: "partial", broken: "broken" };

// Pinned locale + zone: the server (UTC) and the browser must render the same string (hydration).
const fmtEt = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDayEt = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const fmtMins = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m < 10 ? m.toFixed(1) : Math.round(m)}m`);

export default function RunnerHistory({ history, latest }: { history: TickHistory | null; latest: TickReport | null }) {
  const ticks: TickEntry[] = history?.ticks?.length ? history.ticks : latest ? [summarizeTick(latest)] : [];
  if (!ticks.length) return null;

  const newest = [...ticks].sort((a, b) => b.at.localeCompare(a.at));
  const last = newest[0];
  const lastVerdict = tickVerdict(last);
  const cells = dayCells(ticks, TICK_HISTORY_DAYS);
  const recent = newest.slice(0, 12);
  const windowFails = ticks.filter((t) => t.fails > 0).length;
  // what the LAST tick swallowed, by step — the counts lib/scriptKit.swallow printed at exit
  const swallowed = (latest?.steps ?? [])
    .filter((s) => s.suppressed && Object.keys(s.suppressed).length)
    .map((s) => ({ step: s.name, items: Object.entries(s.suppressed!).sort((a, b) => b[1] - a[1]) }));

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold text-[var(--text)]">
          Runner — last {TICK_HISTORY_DAYS} days
          <span className="ml-2 font-normal text-[var(--text-4)]">
            {ticks.length} tick{ticks.length === 1 ? "" : "s"} · {windowFails === 0 ? "none with a failed step" : `${windowFails} with a failed step`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[lastVerdict] }} aria-hidden />
          <span className="font-medium" style={{ color: COLOR[lastVerdict] }}>last tick {LABEL[lastVerdict]}</span>
          <span className="text-[var(--text-3)]">
            {last.mode} · {fmtEt(last.at)} ET · {last.total - last.fails}/{last.total} steps · {fmtMins(last.mins)}
          </span>
        </div>
      </div>

      {/* one cell per ET day, oldest left */}
      <div className="mb-3 flex gap-[3px]" aria-label="tick outcomes by day">
        {cells.map((c) => (
          <div
            key={c.day}
            className="h-4 min-w-0 flex-1 rounded-[3px]"
            style={{ background: COLOR[c.verdict], opacity: c.verdict === "none" ? 0.5 : 1 }}
            title={c.verdict === "none" ? `${fmtDayEt(c.day)} · no ticks recorded` : `${fmtDayEt(c.day)} · ${c.ticks} tick${c.ticks === 1 ? "" : "s"} · ${c.fails} failed step${c.fails === 1 ? "" : "s"}`}
          />
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-2 py-1.5 font-medium">When (ET)</th>
              <th className="px-2 py-1.5 font-medium">Mode</th>
              <th className="px-2 py-1.5 text-right font-medium">Steps</th>
              <th className="px-2 py-1.5 text-right font-medium" title="errors the steps swallowed on purpose">Suppressed</th>
              <th className="px-2 py-1.5 text-right font-medium">Took</th>
              <th className="px-2 py-1.5 font-medium">Failed steps</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => {
              const v = tickVerdict(t);
              return (
                <tr key={t.at} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-2 py-1.5 font-mono tabular-nums text-[var(--text-2)]">{fmtEt(t.at)}</td>
                  <td className="px-2 py-1.5 text-[var(--text-3)]">{t.mode}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums" style={{ color: COLOR[v] }}>{t.total - t.fails}/{t.total}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[var(--text-3)]">{t.suppressed || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[var(--text-3)]">{fmtMins(t.mins)}</td>
                  <td className="px-2 py-1.5 text-[var(--text-4)]">{t.failed.length ? t.failed.map((f) => `${f.name} (exit ${f.exit})`).join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {swallowed.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-3 text-[12.5px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Errors the last tick swallowed on purpose</div>
          <div className="text-[var(--text-3)]">
            {swallowed.map((s) => (
              <div key={s.step} className="truncate" title={s.items.map(([k, n]) => `${k} ×${n}`).join(", ")}>
                <span className="text-[var(--text-2)]">{s.step}</span>
                <span className="text-[var(--text-4)]"> — {s.items.slice(0, 4).map(([k, n]) => `${k} ×${n}`).join(", ")}{s.items.length > 4 ? ", …" : ""}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[11.5px] text-[var(--text-4)]">A step can exit clean every night while every fetch inside it fails; these counts are how that shows.</div>
        </div>
      )}
    </div>
  );
}
