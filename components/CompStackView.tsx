"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import WatchStar from "./WatchStar";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { sgn, type CompStackAnalysis, type CompStackRow, type StackPoint } from "@/lib/compStack";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${sgn(v, d)}%`);
const rng = (lo: number | null | undefined, hi: number | null | undefined, d = 1) => (lo == null || hi == null ? "—" : lo === hi ? `${sgn(lo, d)}%` : `${sgn(lo, d)} to ${sgn(hi, d)}%`);
const col = (v: number | null | undefined) => (v == null ? "var(--text-4)" : v >= 0 ? "#22c55e" : "#ef4444");
const shiftColor = (tag: "decel" | "flat" | "accel" | undefined) => (tag === "decel" ? "#f59e0b" : tag === "accel" ? "#22c55e" : "var(--text-3)");
const money = (m: number) => (m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${m.toFixed(0)}M`);

type Sort = "read" | "stack" | "comp" | "shift";
const SORTS: { key: Sort; label: string; hint: string }[] = [
  { key: "read", label: "Guide read", hint: "names with a fresh comp guide first — the most embedded 2-yr-stack deceleration at the top" },
  { key: "shift", label: "Stack shift", hint: "guide-implied change in the 2-yr stack vs the quarter just reported (most acceleration first)" },
  { key: "stack", label: "2-yr stack", hint: "the just-reported quarter's stack (this comp + the one it laps)" },
  { key: "comp", label: "Latest comp", hint: "highest latest comparable-sales %" },
];
const isRestaurant = (r: CompStackRow) => /restaurant/i.test(r.industry);

function ReadPill({ a }: { a: CompStackAnalysis }) {
  if (a.guideStatus === "stale") return <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-4)]" title="The comp outlook hasn't been re-read from the latest release yet">guide pending</span>;
  if (!a.read || a.stackShift == null) return <span className="text-[var(--text-4)]">—</span>;
  const label = a.read.tag === "decel" ? "decel" : a.read.tag === "accel" ? "accel" : "holds";
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: shiftColor(a.read.tag), background: "var(--surface-2)" }} title={a.read.text}>
      {label} <span className="font-normal tabular-nums">{sgn(a.stackShift)} pts</span>
    </span>
  );
}

function PointRow({ p, latest }: { p: StackPoint; latest: boolean }) {
  const ranged = p.kind !== "actual" && p.compLow != null && p.compHigh != null && p.compLow !== p.compHigh;
  return (
    <tr className={"border-b border-[var(--divider)] last:border-0 " + (p.kind !== "actual" ? "bg-[var(--surface-2)]" : "")}>
      <td className="px-2 py-1 text-left">
        <span className={latest ? "font-semibold text-[var(--text)]" : "text-[var(--text-2)]"}>{p.label}</span>
        {p.kind !== "actual" && <span className="ml-1 rounded bg-[var(--surface-2)] px-1 py-px text-[9px] font-medium uppercase tracking-wide text-[var(--text-4)]">{p.kind}</span>}
      </td>
      <td className="px-2 py-1 text-right tabular-nums" style={{ color: col(p.comp) }}>{ranged ? rng(p.compLow, p.compHigh) : pct(p.comp)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-[var(--text-3)]">{pct(p.lap)}</td>
      <td className="px-2 py-1 text-right font-medium tabular-nums text-[var(--text-2)]">{ranged ? rng(p.stackLow, p.stackHigh) : pct(p.stack)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-[var(--text-4)]">{p.weight == null ? "" : `${(p.weight * 100).toFixed(0)}%`}</td>
    </tr>
  );
}

function Detail({ r, universe }: { r: CompStackRow; universe: string }) {
  const a = r.analysis;
  const hist = a.history.slice(-6);
  const fyTag = a.fiscal.fy != null ? `FY${String(a.fiscal.fy).slice(-2)}` : "the fiscal year";
  return (
    <div className="grid gap-4 px-3 py-3 text-[12.5px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-2 py-1 text-left font-medium">Quarter</th>
              <th className="px-2 py-1 text-right font-medium" title="Actual comp, or the guided / implied range">Comp</th>
              <th className="px-2 py-1 text-right font-medium" title="The comp this quarter laps (a year earlier)">Laps</th>
              <th className="px-2 py-1 text-right font-medium" title="Comp + the comp it laps">2-yr stack</th>
              <th className="px-2 py-1 text-right font-medium" title={a.weightSource === "revenue" ? "Share of the fiscal year, by prior-year quarterly revenue" : "Share of the fiscal year (equal — no revenue history)"}>Wt</th>
            </tr>
          </thead>
          <tbody>
            {hist.map((p, i) => <PointRow key={`h${i}`} p={p} latest={i === hist.length - 1} />)}
            {a.remaining.map((p, i) => <PointRow key={`r${i}`} p={p} latest={false} />)}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 text-[var(--text-2)]">
        {a.read && (
          <p className="leading-snug"><b style={{ color: shiftColor(a.read.tag) }}>{a.read.tag === "decel" ? "Embeds deceleration." : a.read.tag === "accel" ? "Assumes acceleration." : "Holds the stack."}</b> {a.read.text}</p>
        )}
        {a.fyGuide && (
          <p className="leading-snug">
            <b>{a.fyGuide.label || fyTag} comp guide</b> {rng(a.fyGuide.low, a.fyGuide.high, 0)}
            {a.fyGuide.priorLow != null && a.fyGuide.priorHigh != null && <span className="text-[var(--text-4)]"> (prior {rng(a.fyGuide.priorLow, a.fyGuide.priorHigh, 0)})</span>}
            {a.ytdComp != null && <span className="text-[var(--text-4)]"> · YTD blended {pct(a.ytdComp)}{a.ytdCompStated != null ? ` (stated ${pct(a.ytdCompStated)})` : ""}</span>}
          </p>
        )}
        {a.implied && (
          <p className="leading-snug"><b>Implied for {a.implied.quarters.join(" + ")}:</b> {rng(a.implied.low, a.implied.high)} comp (mid {pct(a.implied.mid)}) — what the FY guide leaves after the reported quarters{a.nextQGuide ? " and the guided quarter" : ""}.</p>
        )}
        {a.piecesFy && (
          <p className="leading-snug"><b>Pieces add to</b> {rng(a.piecesFy.low, a.piecesFy.high)} for {fyTag}{a.fyGuide ? ` vs the ${rng(a.fyGuide.low, a.fyGuide.high, 0)} guide` : ""} — nothing left to solve.</p>
        )}
        {a.holdStack && (
          <p className="leading-snug">
            <b>To hold the {pct(a.holdStack.stack)} stack:</b> {a.holdStack.comps.map((c) => `${c.label} ${pct(c.comp)}`).join(" · ")}
            {a.holdStack.fyComp != null && <span> → {fyTag} comp {pct(a.holdStack.fyComp)}{a.holdStack.vsGuideMid != null ? <span style={{ color: col(a.holdStack.vsGuideMid) }}> ({sgn(a.holdStack.vsGuideMid)} pts vs the guide midpoint)</span> : null}</span>}
          </p>
        )}
        {a.revenueCheck && (
          <p className="leading-snug text-[var(--text-3)]">
            <b className="text-[var(--text-2)]">$ cross-check:</b> the FY net-sales guide leaves {money(a.revenueCheck.revLowM)}–{money(a.revenueCheck.revHighM)} for {a.revenueCheck.quarters.join(" + ")} vs {money(a.revenueCheck.lyRevM)} a year ago → {rng(a.revenueCheck.growthLow, a.revenueCheck.growthHigh)} growth (comps + new units).
          </p>
        )}
        {a.notes.map((n, i) => <p key={i} className="text-[11px] leading-snug text-[var(--text-4)]">{n}</p>)}
        <p className="text-[11px] text-[var(--text-4)]">
          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">latest comp filing ↗</a>
          {r.guideUrl && <> · <a href={r.guideUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">outlook release ↗</a></>}
          {" · "}<Link href={`/u/${universe}/stock/${r.ticker}?tab=earnings`} className="hover:text-[var(--accent)]">earnings prep →</Link>
        </p>
      </div>
    </div>
  );
}

export default function CompStackView({ rows, universe, asOf }: { rows: CompStackRow[]; universe: string; asOf: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [sort, setSort] = useState<Sort>("read");
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "guided" | "retail" | "restaurants">("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const guidedN = useMemo(() => rows.filter((r) => r.analysis.read).length, [rows]);

  const view = useMemo(() => {
    const f = q.trim().toUpperCase();
    let r = rows;
    if (scope === "guided") r = r.filter((x) => x.analysis.read);
    else if (scope === "restaurants") r = r.filter(isRestaurant);
    else if (scope === "retail") r = r.filter((x) => !isRestaurant(x));
    if (f) r = r.filter((x) => x.ticker.includes(f) || x.name.toUpperCase().includes(f) || x.industry.toUpperCase().includes(f));
    if (sort === "read") return r; // the board's default order (lib/compStack: guided first, most decel first)
    return [...r].sort((a, b) =>
      sort === "shift" ? (b.analysis.stackShift ?? -99) - (a.analysis.stackShift ?? -99)
        : sort === "stack" ? (b.analysis.latest.stack ?? -99) - (a.analysis.latest.stack ?? -99)
          : (b.analysis.latest.comp ?? -99) - (a.analysis.latest.comp ?? -99));
  }, [rows, sort, q, scope]);

  const toggle = (t: string) => setOpen((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const chip = (on: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (on ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader title="2-Yr Comp Stack Analyzer" desc="What each retailer's and restaurant's comp GUIDE implies for the two-year stack (this comp + the one it laps) over the rest of its fiscal year: the guided quarter's stack straight from the guide, the un-guided quarters back-solved from the full-year comp guide, and the comps it would take to simply hold the just-reported stack — i.e. how much the guide leaves on the table if momentum holds. Computed in code from the disclosed comp history and the release's own outlook; decision-support, not advice." universe={universe}>
        <Link href={`/u/${universe}/comps`} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-3)] hover:text-[var(--text)]">Comps Board →</Link>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {SORTS.map((s) => <button key={s.key} title={s.hint} onClick={() => setSort(s.key)} className={chip(sort === s.key)}>{s.label}</button>)}
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            <button onClick={() => setScope("all")} className={chip(scope === "all")} title="Every name with a stackable comp series">All</button>
            <button onClick={() => setScope("guided")} className={chip(scope === "guided")} title="Only names whose latest release carried a numeric comp outlook">With guide ({guidedN})</button>
            <button onClick={() => setScope("retail")} className={chip(scope === "retail")}>Retail</button>
            <button onClick={() => setScope("restaurants")} className={chip(scope === "restaurants")}>Restaurants</button>
          </div>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter name / ticker / industry…" className="w-56 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2 text-left font-medium">Company</th>
              <th className="px-3 py-2 text-right font-medium" title="Latest quarterly comparable-sales %">Comp</th>
              <th className="px-3 py-2 text-right font-medium" title="Latest comp + the comp it laps a year earlier">2-yr stack</th>
              <th className="px-3 py-2 text-right font-medium" title="The guided upcoming quarter: its comp range → its 2-yr stack range">Next Q guide → stack</th>
              <th className="px-3 py-2 text-right font-medium" title="What the full-year comp guide implies for the un-guided remainder of the year → its 2-yr stack">Rest of year implied → stack</th>
              <th className="px-3 py-2 text-right font-medium" title="Full-year comparable-sales guide (and the prior outlook when the release shows one)">FY guide</th>
              <th className="px-3 py-2 text-right font-medium" title="Guide-implied change in the 2-yr stack vs the quarter just reported, in points">Read</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const a = r.analysis;
              const g = a.remaining.find((p) => p.kind === "guided");
              const imp = a.implied ? a.remaining.filter((p) => p.kind === "implied") : [];
              const isOpen = open.has(r.ticker);
              return (
                <Fragment key={r.ticker}>
                  <tr className="cursor-pointer border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]" onClick={() => toggle(r.ticker)}>
                    <td className="px-3 py-2">
                      <WatchStar symbol={r.ticker} compact />
                      <Link href={`/u/${universe}/stock/${r.ticker}?tab=statements`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--text)] hover:text-[var(--accent)]">{r.name}</Link>
                      <div className="text-[10px] text-[var(--text-4)]"><span className="font-mono">{r.ticker}</span> · {r.industry}{r.region !== "US" ? <span className="ml-1 rounded bg-[var(--surface-2)] px-1 py-px text-[9px] font-medium text-[var(--text-3)]">{r.region}</span> : null}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      <span className="font-semibold" style={{ color: col(a.latest.comp) }}>{pct(a.latest.comp)}</span>
                      <div className="text-[10px] text-[var(--text-4)]">{a.latest.label}{a.latest.lap != null ? ` · laps ${pct(a.latest.lap)}` : ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-[var(--text-2)]">{pct(a.latest.stack)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {g ? <><span style={{ color: col(g.comp) }}>{rng(g.compLow, g.compHigh, 0)}</span><span className="text-[var(--text-4)]"> → </span><span className="text-[var(--text-2)]">{rng(g.stackLow, g.stackHigh)}</span><div className="text-[10px] text-[var(--text-4)]">{g.label} · laps {pct(g.lap)}</div></> : <span className="text-[var(--text-4)]">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {imp.length && a.implied ? <><span style={{ color: col(a.implied.mid) }}>{rng(a.implied.low, a.implied.high)}</span><span className="text-[var(--text-4)]"> → </span><span className="text-[var(--text-2)]">{imp.length === 1 ? rng(imp[0].stackLow, imp[0].stackHigh) : rng(imp[imp.length - 1].stackLow, imp[imp.length - 1].stackHigh)}</span><div className="text-[10px] text-[var(--text-4)]">{a.implied.quarters.join(" + ")}{imp.length > 1 ? " · stack shown for the last" : ""}</div></> : a.piecesFy ? <span className="text-[11px] text-[var(--text-4)]">pieces add to {rng(a.piecesFy.low, a.piecesFy.high)}</span> : <span className="text-[var(--text-4)]">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {a.fyGuide ? <><span className="text-[var(--text-2)]">{rng(a.fyGuide.low, a.fyGuide.high, 0)}</span>{a.fyGuide.priorLow != null && a.fyGuide.priorHigh != null && <div className="text-[10px] text-[var(--text-4)]">was {rng(a.fyGuide.priorLow, a.fyGuide.priorHigh, 0)}</div>}</> : <span className="text-[var(--text-4)]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right"><ReadPill a={a} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[var(--divider)] bg-[var(--bg)]">
                      <td colSpan={7} className="p-0"><Detail r={r} universe={universe} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!view.length && <div className="py-12 text-center text-sm text-[var(--text-3)]">{rows.length ? "No names match." : "No stackable comp series yet — the dataset is still backfilling."}</div>}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        {rows.length} names with a stackable comp series · {guidedN} with a numeric comp outlook in their latest release. Stacks are additive (this comp + the comp it laps). The full-year comp is approximated as the quarterly comps weighted by the prior year&apos;s quarterly revenue (equal weights where no revenue history is on file), so an implied quarter is good to about ±1 pt. Each name&apos;s metric is its own company-defined comp — compare trends and direction, not levels across names. Click a row for the quarter table, the hold-the-stack path and the $ cross-check. As of {asOf}.
      </p>
    </main>
  );
}
