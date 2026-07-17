"use client";
import { useState } from "react";
import HowToRead from "./HowToRead";
import InfoDot from "./InfoDot";
import type { SignalGridFile, GridFamilyStat, GridCellStat } from "@/lib/signalGrid";
import { fmtDate } from "@/lib/format";

const UP = "#22c55e", DOWN = "#ef4444";
const pp = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);
const edgeColor = (v: number | null | undefined) => (v == null ? "var(--text-4)" : v > 0.25 ? UP : v < -0.25 ? DOWN : "var(--text-3)");
/** A CI that straddles zero means "indistinguishable from noise" — say it in the colour too. */
const ciStraddles = (ci: [number, number] | null) => !ci || (ci[0] <= 0 && ci[1] >= 0);

function Verdict({ f }: { f: GridFamilyStat }) {
  const wf = f.walkForward;
  // THREE states, not two. "Noise" is a measured finding (we tested the knob and it did nothing);
  // a missing walk-forward means we never measured it at all. Asserting the former for the latter
  // would fabricate the one result this board exists to earn.
  const measured = !!wf;
  const noise = measured && ciStraddles(wf!.ci);
  const beats = measured && !noise && f.defaultEdgeWf != null && wf!.edge > f.defaultEdgeWf;
  const head = !measured ? "Not enough data to judge" : noise ? "Noise — keep the default" : beats ? "Tuning pays" : "Keep the default";
  const cls = !measured || noise ? "border-[var(--border)] bg-[var(--surface-2)]" : beats ? "border-[#22c55e]/40 bg-[#22c55e]/5" : "border-[#f59e0b]/40 bg-[#f59e0b]/5";
  return (
    <div className={"rounded-lg border px-3 py-2 text-[12px] leading-snug text-[var(--text-2)] " + cls}>
      <span className="font-semibold text-[var(--text)]">{head}:</span> {f.verdict}
    </div>
  );
}

function Cells({ f }: { f: GridFamilyStat }) {
  const best = f.bestLabel;
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full min-w-[560px] text-left text-[12px]">
        <thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-wide text-[var(--text-4)]">
          <tr>
            <th className="px-3 py-1.5 font-medium">Setting</th>
            <th className="px-2 py-1.5 text-right font-medium">Picks</th>
            <th className="px-2 py-1.5 text-right font-medium">1m edge</th>
            <th className="px-2 py-1.5 text-right font-medium">95% CI<InfoDot term="Bootstrap CI" /></th>
            <th className="px-2 py-1.5 text-right font-medium">Hit</th>
            <th className="px-2 py-1.5 text-right font-medium">n</th>
          </tr>
        </thead>
        <tbody>
          {f.cells.map((c: GridCellStat) => (
            <tr key={c.paramLabel} className="border-b border-[var(--border)] last:border-0">
              <td className="px-3 py-1.5 whitespace-nowrap">
                <span className="tabular-nums text-[var(--text-2)]">{c.paramLabel}</span>
                {c.isDefault && <span className="ml-1.5 rounded bg-[var(--accent-soft)] px-1 py-0.5 text-[9px] font-semibold text-[var(--accent)]">SHIPPED</span>}
                {c.paramLabel === best && <span className="ml-1.5 rounded bg-[var(--surface-hover)] px-1 py-0.5 text-[9px] font-semibold text-[var(--text-4)]" title="Best in hindsight — not an achievable edge">HINDSIGHT BEST</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-4)]">{c.avgPicks}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: edgeColor(c.edge.m1) }}>{pp(c.edge.m1)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[11px]" style={{ color: ciStraddles(c.ci) ? "var(--text-4)" : "var(--text-2)" }}>
                {c.ci ? `${pp(c.ci[0])} … ${pp(c.ci[1])}` : "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{c.hit == null ? "—" : `${(c.hit * 100).toFixed(0)}%`}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-4)]">{c.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SignalGrid({ grid }: { grid: SignalGridFile }) {
  const [uIdx, setUIdx] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const u = grid.universes[uIdx];
  if (!u) return null;
  const TB = (a: boolean) => "rounded-md px-2 py-1 text-[11px] font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <section>
      <HowToRead>
        <p><b>The question:</b> every signal ships with a setting someone chose (top 25 names, RSI below 30…). Was that setting <i>right</i>, or would a different one have done better? This sweeps {grid.cellsPerUniverse} settings per universe and grades all of them the same way the backtest grades the live signals.</p>
        <p><b>Read the walk-forward number, not the best cell.</b> <b>Shipped</b> is the setting the live board uses. <b>Hindsight best</b> is the winner with the benefit of knowing the future — pick the max of {grid.cellsPerUniverse} cells and you get a flattering number <i>even when every cell is pure noise</i>, so it is never achievable. <b>Walk-forward</b> is the honest one: at each rebalance it picks the setting that led over the previous 12 rebalances — using only data that existed then — and applies it forward. It is measured against the shipped default over <i>exactly the same rebalances</i>, so the comparison is like-for-like.</p>
        <p><b>If walk-forward doesn&apos;t beat shipped, the knob is noise and the answer is &quot;keep the default&quot;</b> — that&apos;s a real result. A confidence interval spanning zero means the same thing: the edge can&apos;t be told apart from luck. CIs are a seeded 1,000-resample bootstrap of the mean per-rebalance edge, so they don&apos;t drift between nightly runs.</p>
      </HowToRead>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {grid.universes.map((x, i) => (
            <button key={x.universe} onClick={() => setUIdx(i)} className={TB(i === uIdx)}>{x.universe}</button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--text-4)]">
          {u.names} names · {u.rebalances} monthly rebalances · {u.start} → {u.end}
          {u.asOf && <span title="When this universe was last recomputed"> · as of {fmtDate(u.asOf)}</span>}
        </span>
      </div>

      <div className="space-y-3">
        {u.families.map((f) => {
          const wf = f.walkForward;
          const isOpen = open === f.key;
          return (
            <div key={f.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--text)]">{f.label}</h3>
                  <p className="mt-0.5 max-w-2xl text-[11px] text-[var(--text-4)]">{f.desc}</p>
                </div>
                <button onClick={() => setOpen(isOpen ? null : f.key)} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text)]">
                  {isOpen ? "Hide" : `All ${f.cells.length} settings`}
                </button>
              </div>

              <div className="mb-2 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Shipped ({f.defaultLabel})</div>
                  {/* NEVER fall back to the full-sample defaultEdge here — the caption below promises
                      the walk-forward's window, so a foreign-window number would make the tile lie. */}
                  <div className="tabular-nums text-[15px] font-semibold" style={{ color: edgeColor(f.defaultEdgeWf) }}>{pp(f.defaultEdgeWf)}<span className="ml-0.5 text-[10px] font-normal text-[var(--text-4)]">pp</span></div>
                  <div className="text-[9px] text-[var(--text-4)]">{f.defaultEdgeWf != null ? "same window as walk-fwd" : `not scorable on that window · ${pp(f.defaultEdge)}pp full-sample`}</div>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Hindsight best</div>
                  <div className="tabular-nums text-[15px] font-semibold text-[var(--text-3)]">{pp(f.bestEdge)}<span className="ml-0.5 text-[10px] font-normal text-[var(--text-4)]">pp</span></div>
                  <div className="text-[9px] text-[var(--text-4)]">{f.bestLabel} · not achievable</div>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Walk-forward<InfoDot term="Walk-forward" /></div>
                  <div className="tabular-nums text-[15px] font-semibold" style={{ color: wf && !ciStraddles(wf.ci) ? edgeColor(wf.edge) : "var(--text-4)" }}>{wf ? pp(wf.edge) : "—"}<span className="ml-0.5 text-[10px] font-normal text-[var(--text-4)]">pp</span></div>
                  <div className="text-[9px] text-[var(--text-4)]">{wf?.ci ? `CI ${pp(wf.ci[0])} … ${pp(wf.ci[1])}` : "—"}{wf ? ` · ${wf.switches} switch${wf.switches === 1 ? "" : "es"}` : ""}</div>
                </div>
              </div>

              <Verdict f={f} />
              {isOpen && <div className="mt-2"><Cells f={f} /></div>}
            </div>
          );
        })}
      </div>

      <details className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-2)]">Method &amp; honest caveats</summary>
        <ul className="mt-2 space-y-1.5">
          {grid.method.map((m, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-snug text-[var(--text-3)]">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-4)]" aria-hidden />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
