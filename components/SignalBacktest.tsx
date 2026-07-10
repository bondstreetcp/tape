"use client";
import { BT_HORIZONS, type BacktestFile, type BtSignal } from "@/lib/signalBacktest";
import { fmtDate } from "@/lib/format";
import HowToRead from "./HowToRead";

// The historical companion to the live Signal Track Record: price-reconstructible signals replayed
// monthly over ~5 years of stored series. Edges are in PERCENTAGE POINTS vs the same-day equal-weight
// pool (selection skill, not market timing) — different plumbing than the live record's vs-S&P edge,
// and labeled as such.

const UP = "#22c55e", DOWN = "#ef4444";
const pp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp`;
const edgeColor = (v: number | null | undefined) => (v == null ? "var(--text-4)" : v > 0.2 ? UP : v < -0.2 ? DOWN : "var(--text-3)");

function Spark({ curve }: { curve: BtSignal["curve"] }) {
  if (curve.length < 3) return <span className="text-[10px] text-[var(--text-4)]">—</span>;
  const W = 120, H = 28;
  const vals = curve.map((c) => c.cum);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const x = (i: number) => (i / (curve.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const d = curve.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(c.cum).toFixed(1)}`).join("");
  const up = vals[vals.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-[120px]" aria-label="cumulative 1-month edge">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
      <path d={d} fill="none" stroke={up ? UP : DOWN} strokeWidth={1.4} />
    </svg>
  );
}

export default function SignalBacktest({ bt }: { bt: BacktestFile }) {
  return (
    <div>
      <HowToRead>
        <p><b>What&apos;s here:</b> the live record only starts on the day logging began — this panel asks &quot;what WOULD these boards have done?&quot; by replaying the price-computable ones over the stored daily series: membership recomputed at each month-end close exactly as the live rule would have, then graded 1 week / 1 month / 3 months forward.</p>
        <p><b>Edge</b> here is the picks&apos; average forward return minus the <i>same day&apos;s equal-weight pool average</i>, in percentage points — pure stock selection, with market direction cancelled out. <b>Hit</b> is the share of picks that beat that day&apos;s pool median.</p>
        <p><b>Honest limits</b> — read these before believing any number:</p>
        <ul className="list-disc space-y-1 pl-5">
          {bt.method.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      </HowToRead>

      <div className="mb-2 text-[12px] text-[var(--text-3)]">
        {bt.rebalances} monthly rebalances · {fmtDate(bt.start)} → {fmtDate(bt.end)} · {bt.names} S&amp;P 500 names (today&apos;s membership) · generated {fmtDate(bt.generatedAt.slice(0, 10))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[880px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Signal</th>
              <th className="px-2 py-2 text-right font-medium" title="Average names selected per rebalance">Picks</th>
              {BT_HORIZONS.map((h) => (
                <th key={h.key} className="px-2 py-2 text-right font-medium" title={`${h.bars} trading days forward: edge vs the equal-weight pool · share of picks beating the pool median`}>{h.label} edge · hit</th>
              ))}
              <th className="px-2 py-2 font-medium" title="Cumulative 1-month edge across all rebalances (percentage points, not compounded)">Cumulative 1m edge</th>
            </tr>
          </thead>
          <tbody>
            {bt.signals.map((s) => (
              <tr key={s.key} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <div className="font-semibold text-[var(--text)]">{s.label}</div>
                  <div className="max-w-[300px] text-[11px] leading-snug text-[var(--text-4)]">{s.desc}</div>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{s.avgPicks}</td>
                {BT_HORIZONS.map((h) => {
                  const hz = s.horizons[h.key];
                  return (
                    <td key={h.key} className="px-2 py-2 text-right font-mono tabular-nums">
                      {hz ? (
                        <span title={`picks avg ${pp(hz.avg).replace("pp", "%")} vs pool ${pp(hz.poolAvg).replace("pp", "%")} · n=${hz.n}`}>
                          <b style={{ color: edgeColor(hz.edge) }}>{pp(hz.edge)}</b>
                          <span className="text-[var(--text-4)]"> · {Math.round(hz.hit * 100)}%</span>
                          <span className="text-[10px] text-[var(--text-4)]"> n{hz.n}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-4)]">too few obs</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2"><Spark curve={s.curve} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
        Boards that depend on options, positioning, estimates or filings history we didn&apos;t store (Confluence, Squeeze, Coiled Springs, Warnings…) can&apos;t be replayed without look-ahead — they accrue honestly in the Live record tab instead. Decision-support, not advice.
      </p>
    </div>
  );
}
