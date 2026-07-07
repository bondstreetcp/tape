"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { POS_CATALYST_META, rankPositioning, type PositioningRow, type PositioningSort } from "@/lib/positioning";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import HowToRead from "./HowToRead";

const fmtM = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};
const expLabel = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "");
const clock = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`);

const UP = "#22c55e", DOWN = "#ef4444", MUTED = "var(--text-4)";
const leanColor = (l: PositioningRow["lean"]) => (l === "calls" ? UP : l === "puts" ? DOWN : MUTED);
const leanLabel = (l: PositioningRow["lean"]) => (l === "calls" ? "Calls" : l === "puts" ? "Puts" : "Mixed");

type Sort = PositioningSort;
const SORTS: { key: Sort; label: string; title: string }[] = [
  { key: "premium", label: "Premium", title: "Biggest total option premium traded" },
  { key: "bullish", label: "Bullish", title: "Most OTM call premium — upside/leverage bets" },
  { key: "bearish", label: "Bearish", title: "Most OTM put premium — downside/hedging bets" },
  { key: "unusual", label: "New", title: "Most premium in contracts where today's volume exceeded open interest (new positioning)" },
  { key: "catalyst", label: "Into a catalyst", title: "Names sitting in front of a dated event first" },
];

export default function PositioningView({
  universe, rows, generatedAt, callPremium, putPremium,
}: {
  universe: string;
  rows: PositioningRow[];
  generatedAt: string;
  callPremium: number | null;
  putPremium: number | null;
}) {
  const [sort, setSort] = useState<Sort>("premium");
  const [catalystOnly, setCatalystOnly] = useState(false);
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = rows;
    if (catalystOnly) r = r.filter((x) => x.catalyst);
    if (ql) r = r.filter((x) => x.symbol.toLowerCase().includes(ql) || x.name.toLowerCase().includes(ql));
    return rankPositioning(r, sort);
  }, [rows, sort, catalystOnly, q]);

  const catalystN = useMemo(() => rows.filter((r) => r.catalyst).length, [rows]);
  const mktPC = callPremium && putPremium && callPremium > 0 ? putPremium / callPremium : null;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Positioning Radar</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The name-level read of the options-flow tape — where big directional premium is concentrating, rolled up per stock, with the dated catalyst each name is being positioned in front of.
            {" "}{rows.length} names · {catalystN} into a catalyst{mktPC != null ? ` · mkt flow P/C ${mktPC.toFixed(2)}` : ""} · {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What&apos;s here:</b> the same big option trades as the <Link href={`/u/${universe}/flow`} className="text-[var(--accent)] hover:underline">Options Flow</Link> tape, but rolled up <b>per underlying</b> into a positioning read — so you see which <i>names</i> are being bet on, not just a list of individual contracts.</p>
        <p><b>Directional (OTM) vs total:</b> the headline is total premium, but the <b>▲/▼ column is the OTM premium</b> — out-of-the-money calls (upside/leverage bets) and puts (downside/hedges). Deep-in-the-money premium is often stock-replacement or a roll (big dollars, not a view), so the OTM split is the cleaner read of conviction. <b>Lean</b> is set from the OTM premium.</p>
        <p><b>New</b> = share of the premium in contracts where today&apos;s volume exceeded open interest — i.e. genuinely new positioning rather than churn. <b>Into a catalyst</b> tags names with a dated event ahead (earnings ≤14d, PDUFA/readout ≤45d, investor day ≤30d) — flow landing in front of a known binary is the sharpest read.</p>
        <p><b>Honest limits:</b> an end-of-day snapshot of the top flows (S&amp;P 500, US options) — no intraday tape, so buyer- vs seller-initiated is <i>inferred</i>, not confirmed; a huge print can be one leg of a spread. Direction is a lean, not proof. Not advice.</p>
      </HowToRead>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {SORTS.map((s) => <button key={s.key} onClick={() => setSort(s.key)} className={TB(sort === s.key)} title={s.title}>{s.label}</button>)}
        </div>
        <button onClick={() => setCatalystOnly((v) => !v)} className={TB(catalystOnly)} title="Only names with a dated catalyst ahead">◆ Catalyst only</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{view.length} names</span>
      </div>

      {view.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No names match. Clear the filter{catalystOnly ? " or turn off Catalyst only" : ""}.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium" title="Directional lean from the OTM premium">Lean</th>
                <th className="px-2 py-2 text-right font-medium" title="Total option premium traded today (calls + puts, all strikes)">Total flow</th>
                <th className="px-2 py-2 text-right font-medium" title="OTM premium: ▲ calls (upside) / ▼ puts (downside) — the directional bets">Directional ▲/▼</th>
                <th className="px-2 py-2 text-right font-medium" title="Premium in vol>OI contracts (new positioning), and its share of total">New</th>
                <th className="px-2 py-2 font-medium">Catalyst</th>
                <th className="px-2 py-2 font-medium" title="Largest single trade">Biggest trade</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const top = r.topContracts[0];
                const cm = r.catalyst ? POS_CATALYST_META[r.catalyst.kind] : null;
                // Bar reflects the OTM (directional) split so it agrees with the Lean badge (also OTM-based)
                // and the HowToRead doctrine — NOT cpSkew, which includes ITM/delta-one premium and can point
                // the opposite way (e.g. TSLA: OTM calls dominate → "Calls", but total put $ is mostly ITM).
                const otmTotal = r.otmCallPrem + r.otmPutPrem;
                const callPct = otmTotal > 0 ? Math.round((r.otmCallPrem / otmTotal) * 100) : 50;
                return (
                  <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2">
                      <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                      <div className="max-w-[170px] truncate text-[11px] text-[var(--text-4)]" title={r.name}>{r.name}</div>
                      {r.chgPct != null && <div className="text-[11px]" style={{ color: r.chgPct >= 0 ? UP : DOWN }}>{r.chgPct >= 0 ? "+" : ""}{r.chgPct.toFixed(1)}%</div>}
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: leanColor(r.lean), background: `color-mix(in oklab, ${leanColor(r.lean)} 15%, transparent)` }}>{leanLabel(r.lean)}</span>
                      <div className="mt-1 flex h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-2)]" title={otmTotal > 0 ? `OTM premium: ${callPct}% calls / ${100 - callPct}% puts` : "no OTM directional premium (delta-one / ITM flow)"}>
                        {otmTotal > 0 ? (
                          <>
                            <div style={{ width: `${callPct}%`, background: UP }} />
                            <div style={{ width: `${100 - callPct}%`, background: DOWN }} />
                          </>
                        ) : (
                          <div style={{ width: "100%", background: "var(--text-4)", opacity: 0.35 }} />
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      <div className="font-semibold text-[var(--text)]">{fmtM(r.totalPrem)}</div>
                      <div className="text-[11px] text-[var(--text-4)]">{r.contractsN} {r.contractsN === 1 ? "trade" : "trades"} · {r.strikesN} {r.strikesN === 1 ? "strike" : "strikes"}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      <div><span style={{ color: UP }}>▲{fmtM(r.otmCallPrem)}</span></div>
                      <div><span style={{ color: DOWN }}>▼{fmtM(r.otmPutPrem)}</span></div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      <div className="text-[var(--text-2)]">{fmtM(r.unusualPrem)}</div>
                      <div className="text-[11px] text-[var(--text-4)]">{r.totalPrem > 0 ? `${Math.round((r.unusualPrem / r.totalPrem) * 100)}%` : "—"}</div>
                    </td>
                    <td className="px-2 py-2">
                      {r.catalyst && cm ? (
                        <span className="inline-flex flex-col gap-0.5">
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: cm.color, background: `color-mix(in oklab, ${cm.color} 15%, transparent)` }}>{cm.label}</span>
                          <span className="text-[11px] text-[var(--text-3)]">
                            {clock(r.catalyst.daysTo)}{r.catalyst.impliedMovePct != null ? ` · ±${r.catalyst.impliedMovePct.toFixed(0)}%` : ""}
                          </span>
                        </span>
                      ) : <span className="text-[var(--text-4)]">—</span>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-[12px]">
                      {top ? (
                        <span title={r.topContracts.map((c) => `${c.type === "call" ? "C" : "P"} ${c.strike} ${expLabel(c.expiry)} · ${fmtM(c.premium)}${c.unusual ? " (new)" : ""}`).join("\n")}>
                          <span style={{ color: top.type === "call" ? UP : DOWN }}>{top.type === "call" ? "C" : "P"} {top.strike}</span>
                          <span className="text-[var(--text-3)]"> {expLabel(top.expiry)}</span>
                          <span className="text-[var(--text-2)]"> · {fmtM(top.premium)}</span>
                          {top.unusual && <span title="new positioning (vol > OI)" style={{ color: "#f59e0b" }}> ◆</span>}
                        </span>
                      ) : <span className="text-[var(--text-4)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
