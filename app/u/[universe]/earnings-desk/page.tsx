import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import InfoDot from "@/components/InfoDot";
import HowToRead from "@/components/HowToRead";
import { fmtDateTime } from "@/lib/format";
import type { VolDisData } from "@/lib/volDislocation";
import type { TradeDeskData } from "@/lib/tradeIdeas";
import { sideColor, sideLabel } from "@/lib/tradeIdeas";
import type { PeadData } from "@/lib/pead";
import type { GuidanceBoardData } from "@/lib/guidanceBoard";
import type { EmData, EmRow } from "@/components/EarningsWeekView";

export const dynamic = "force-dynamic";

const read = <T,>(f: string): Promise<T | null> =>
  fsp.readFile(path.join(process.cwd(), "data", f), "utf8").then((s) => JSON.parse(s) as T).catch(() => null);

// One shared palette across every widget.
const RED = "#ef4444", GREEN = "#22c55e", BLUE = "#60a5fa", AMBER = "#f59e0b", ZINC = "var(--text-4)";
const reliable = (r: EmRow) => r.histN != null && r.histN >= 3 && r.richness != null;

function Pill({ t, c }: { t: string; c: string }) {
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 15%, transparent)` }}>{t}</span>;
}
function DPill({ d }: { d: number }) {
  const c = d <= 2 ? AMBER : "var(--text-4)";
  return <span className="rounded px-1 py-0.5 text-[10px] font-mono font-semibold tabular-nums" style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)` }}>d{d}</span>;
}
function Widget({ title, tip, links, note, children }: { title: string; tip?: string; links: { label: string; href: string }[]; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold text-[var(--text)]">{title}{tip && <> <InfoDot text={tip} /></>}</h2>
        <span className="flex shrink-0 gap-2 text-[11px]">
          {links.map((l) => <Link key={l.href} href={l.href} className="text-[var(--accent)] hover:underline">{l.label} →</Link>)}
        </span>
      </div>
      <div className="flex-1">{children}</div>
      {note && <div className="mt-2 border-t border-[var(--divider)] pt-1.5 text-[11px] text-[var(--text-4)]">{note}</div>}
    </div>
  );
}
const Empty = ({ t }: { t: string }) => <div className="py-4 text-center text-[12px] text-[var(--text-4)]">{t}</div>;
// Column headers for the widget tables — the bare-number rows needed labels to be readable.
// A "<"-prefixed label left-aligns (for text columns); everything after the first defaults right.
const TH = ({ cols }: { cols: string[] }) => (
  <thead>
    <tr className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">
      {cols.map((c, i) => {
        const left = i === 0 || c.startsWith("<");
        return <th key={i} className={"pb-1 font-medium " + (i === 0 ? "" : "pl-2 ") + (left ? "text-left" : "text-right")}>{c.replace(/^</, "")}</th>;
      })}
    </tr>
  </thead>
);

export default async function EarningsDeskPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Earnings Season Desk" relPath="/earnings-desk" />;
  const u = (p: string) => `/u/${universe}${p}`;

  const [em, ti, vd, pead, gb, cv] = await Promise.all([
    read<EmData>("earnings-move.json"),
    read<TradeDeskData>("trade-ideas.json"),
    read<VolDisData>("vol-dislocation.json"),
    read<PeadData>("pead.json"),
    read<GuidanceBoardData>("guidance-board.json"),
    read<{ generatedAt?: string; rows?: any[] }>("catalyst-vol.json"),
  ]);

  const asOf = [em, ti, vd, pead, gb, cv].map((d) => (d as any)?.generatedAt).filter(Boolean).sort()[0] as string | undefined;

  // ── HERO: this week's prints (0–7d) + a season read-out over the full window ──
  const emRows = em?.rows ?? [];
  const upcoming = emRows.filter((r) => r.daysToEarnings != null && r.daysToEarnings >= 0 && r.impliedMovePct != null);
  const hero = [...upcoming]
    .filter((r) => r.daysToEarnings <= 7)
    .sort((a, b) => a.daysToEarnings - b.daysToEarnings || Math.abs((b.richness ?? 1) - 1) - Math.abs((a.richness ?? 1) - 1))
    .slice(0, 6);
  const heroSyms = new Set(hero.map((r) => r.symbol));
  const richN = upcoming.filter((r) => reliable(r) && (r.richness as number) >= 1.15).length;
  const cheapN = upcoming.filter((r) => reliable(r) && (r.richness as number) <= 0.85).length;
  const nSoon = upcoming.filter((r) => r.daysToEarnings <= 7).length;
  const fattest = [...upcoming].filter(reliable).sort((a, b) => (b.richness as number) - (a.richness as number))[0];
  const richPill = (r?: number | null) => (r == null ? null : r >= 1.15 ? { t: "RICH", c: RED } : r <= 0.85 ? { t: "CHEAP", c: GREEN } : { t: "FAIR", c: ZINC });

  // ── widget datasets ──
  const ideas = [...(ti?.ideas ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const volRows = (vd?.rows ?? [])
    .filter((r) => r.earningsDriven && !r.illiquid && !heroSyms.has(r.symbol))
    .sort((a, b) => b.ivPremium - a.ivPremium)
    .slice(0, 8);
  const sellRows = emRows.filter((r) => r.daysToEarnings != null && r.daysToEarnings <= 16 && reliable(r)).sort((a, b) => (b.richness as number) - (a.richness as number)).slice(0, 4);
  const buyRows = emRows.filter((r) => r.daysToEarnings != null && r.daysToEarnings <= 16 && reliable(r)).sort((a, b) => (a.richness as number) - (b.richness as number)).slice(0, 3);
  const peadRows = [...(pead?.rows ?? [])].sort((a, b) => (a.continuation === b.continuation ? Math.abs(b.driftPct) - Math.abs(a.driftPct) : a.continuation ? -1 : 1)).slice(0, 5);
  const sand = (gb?.rows ?? []).filter((r) => r.tag === "sandbagger").sort((a, b) => (a.daysToEarnings ?? 999) - (b.daysToEarnings ?? 999)).slice(0, 4);
  const cutsCount = (gb?.rows ?? []).filter((r) => r.action === "cut").length;
  // priced rows only — the feed keeps unpriced calendar placeholders (mirrors CatalystVolView).
  const catRows = (cv?.rows ?? []).filter((r: any) => r.ratio != null && r.impliedMovePct != null && r.baselineMovePct != null).sort((a: any, b: any) => a.ratio - b.ratio).slice(0, 4);
  const mv = (x: number | null | undefined) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}%`);
  const mvColor = (x: number) => (x > 0 ? GREEN : x < 0 ? RED : ZINC);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={u("")} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings Season Desk</h1>
          <p className="mt-0.5 text-[13px] text-[var(--text-3)]">Everything that matters for earnings season, in one place — the calendar, where the options are mispriced into each print, who&apos;s still drifting, and the standing setups.</p>
        </div>
        <div className="text-right text-[11px] text-[var(--text-4)]">
          {ti?.weekOf && <div>week of {ti.weekOf}</div>}
          {asOf && <div>as of {fmtDateTime(asOf)}</div>}
        </div>
      </div>

      <HowToRead title="New to this desk? What the numbers mean">
        <p>Every widget here is a digest of a full board (the link in its corner opens it). The core number everywhere is the <b>implied move</b>: the at-the-money straddle price ÷ the stock price at the expiry bracketing the report — the move the options market charges for the print, read from the live chain.</p>
        <p>That gets compared to the stock&apos;s <b>historical move</b> (its average absolute earnings-day move over past prints). The ratio is the verdict: <b style={{ color: RED }}>rich ≥1.15×</b> (options overpay the typical move — sell premium) or <b style={{ color: GREEN }}>cheap ≤0.85×</b> (the move costs less than the name usually delivers — buy it).</p>
        <p><b>d-chips</b> = trading days until the report. Hover any ⓘ or column header for the exact formula behind that widget. All signals are computed by code from the chain and filings; the AI Trade Desk only narrates.</p>
      </HowToRead>

      {/* ── HERO ── */}
      <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold text-[var(--text)]">This week&apos;s prints</h2>
          <Link href={u("/earnings-week")} className="text-[11px] text-[var(--accent)] hover:underline">full calendar →</Link>
        </div>
        {emRows.length ? (
          <div className="mb-2 text-[12px] text-[var(--text-3)]">
            <b className="text-[var(--text)]">{nSoon}</b> report in the next 5 sessions · <b style={{ color: RED }}>{richN}</b> options-rich (sell) · <b style={{ color: GREEN }}>{cheapN}</b> cheap (buy)
            {fattest && <> · fattest edge <Link href={u(`/stock/${fattest.symbol}?tab=earnings`)} className="font-semibold text-[var(--accent)] hover:underline">{fattest.symbol}</Link> ±{fattest.impliedMovePct.toFixed(1)}% vs ~{(fattest.histAvgMovePct ?? 0).toFixed(1)}%</>}
          </div>
        ) : null}
        {hero.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {hero.map((r) => {
              const rp = richPill(reliable(r) ? r.richness : null);
              return (
                <Link key={r.symbol} href={u(`/stock/${r.symbol}?tab=earnings`)} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 hover:border-[var(--border-strong)]">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-[var(--accent)]">{r.symbol}</span>
                    <DPill d={r.daysToEarnings} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] tabular-nums text-[var(--text-2)]">±{r.impliedMovePct.toFixed(1)}% <span className="text-[var(--text-4)]">vs ±{(r.histAvgMovePct ?? 0).toFixed(1)}%</span></div>
                  <div className="mt-1 flex items-center gap-1">
                    {rp ? <Pill t={rp.t} c={rp.c} /> : <span className="text-[10px] text-[var(--text-4)]">n{r.histN ?? 0}</span>}
                    {!reliable(r) && <span title="fewer than 3 prior prints — low-confidence" className="h-1.5 w-1.5 rounded-full" style={{ background: AMBER }} />}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <Empty t={emRows.length ? "No reporters in the next 7 days." : "The earnings calendar populates on the nightly refresh."} />
        )}
      </div>

      {/* ── widget grid ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* AI Trade Desk */}
        <Widget title="AI Trade Desk — this week's picks" links={[{ label: "see all", href: u("/trade-desk") }]}>
          {ideas.length ? (
            <div className="space-y-1.5">
              {ideas.map((i) => (
                <div key={i.symbol} className="flex items-center gap-2 text-[12px]" title={i.thesis || undefined}>
                  <Link href={u(`/stock/${i.symbol}`)} className="w-12 shrink-0 font-semibold text-[var(--accent)] hover:underline">{i.symbol}</Link>
                  <Pill t={sideLabel(i.side)} c={sideColor(i.side)} />
                  {i.trap && <span title="may just be pricing a known event" style={{ color: AMBER }}>⚠</span>}
                  <span className="flex-1 truncate text-[var(--text-3)]" title={i.stat}>{i.structure}</span>
                  {i.conviction && <span className="shrink-0 text-[10px] font-semibold uppercase" style={{ color: i.conviction === "high" ? GREEN : i.conviction === "medium" ? AMBER : ZINC }}>{i.conviction}</span>}
                </div>
              ))}
            </div>
          ) : <Empty t="AI ideas populate on the nightly refresh." />}
        </Widget>

        {/* Vol Dislocation (IV/RV + skew + term merged) */}
        <Widget
          title="Vol into the print — rich/cheap · skew · term"
          tip="IV/RV = at-the-money implied vol ÷ 20-day realized vol. Above ~1.6× the options are pricing far more movement than the stock delivers (sell premium); skew ▲ = puts bid (crash hedging), ▾ = calls bid; 'crush' = front-month IV far above back (backwardated — event loaded)."
          links={[{ label: "vol", href: u("/vol-dislocation") }, { label: "skew", href: u("/skew") }, { label: "term", href: u("/term-structure") }]}
        >
          {volRows.length ? (
            <table className="w-full text-left text-[12px]">
              <TH cols={["Ticker", "to print", "IV/RV", "skew", "term"]} />
              <tbody>
                {volRows.map((r) => (
                  <tr key={r.symbol} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1"><Link href={u(`/stock/${r.symbol}`)} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="py-1 text-right"><DPill d={r.daysToEarnings ?? 0} /></td>
                    <td className="py-1 text-right font-mono tabular-nums font-semibold" style={{ color: r.ivPremium >= 1.6 ? RED : "var(--text-2)" }}>{r.ivPremium.toFixed(2)}×</td>
                    <td className="py-1 pl-2 text-center" title="skew: put-bid ▲ / call-bid ▾">{r.skew == null ? <span className="text-[var(--text-4)]">–</span> : r.skew >= 0.1 ? <span style={{ color: RED }}>▲</span> : r.skew < 0 ? <span style={{ color: GREEN }}>▾</span> : <span className="text-[var(--text-4)]">·</span>}</td>
                    <td className="py-1 pl-1 text-right">{r.termCrush != null && r.termCrush > 1.3 ? <span title="backwardated — front IV rich" style={{ color: AMBER }} className="text-[10px] font-semibold">crush</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty t="The vol feed populates on the nightly refresh." />}
        </Widget>

        {/* Sell premium (rich) */}
        <Widget
          title="Sell premium — richest into the print"
          tip="Implied = the options' expected earnings move (ATM straddle price ÷ stock price, at the expiry bracketing the report). Hist = the stock's average absolute post-earnings move over its past prints. Rich× = implied ÷ hist — above ~1.15× the market is paying more for the move than the stock historically delivers."
          links={[{ label: "earnings", href: u("/earnings-week") }]}
        >
          {sellRows.length ? (
            <table className="w-full text-left text-[12px]">
              <TH cols={["Ticker", "implied", "hist", "rich", "days"]} />
              <tbody>
                {sellRows.map((r) => (
                  <tr key={r.symbol} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1"><Link href={u(`/stock/${r.symbol}?tab=earnings`)} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.impliedMovePct.toFixed(1)}%</td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text-4)]">±{(r.histAvgMovePct ?? 0).toFixed(1)}%</td>
                    <td className="py-1 pl-2 text-right"><Pill t={`${(r.richness as number).toFixed(1)}×`} c={RED} /></td>
                    <td className="py-1 pl-1 text-right"><DPill d={r.daysToEarnings as number} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty t="No rich-vol reporters in window." />}
        </Widget>

        {/* Buy the move (cheap) */}
        <Widget
          title="Buy the move — cheapest into the print"
          tip="Same math as Sell premium, other tail: implied move (ATM straddle ÷ spot) UNDER the stock's own historical earnings move (ratio ≤ ~0.85×) — the options are cheap relative to how much this name usually moves on the print."
          links={[{ label: "earnings", href: u("/earnings-week") }]}
        >
          {buyRows.length ? (
            <table className="w-full text-left text-[12px]">
              <TH cols={["Ticker", "implied", "hist", "cheap", "days"]} />
              <tbody>
                {buyRows.map((r) => (
                  <tr key={r.symbol} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1"><Link href={u(`/stock/${r.symbol}?tab=earnings`)} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.impliedMovePct.toFixed(1)}%</td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text-4)]">±{(r.histAvgMovePct ?? 0).toFixed(1)}%</td>
                    <td className="py-1 pl-2 text-right"><Pill t={`${(r.richness as number).toFixed(1)}×`} c={GREEN} /></td>
                    <td className="py-1 pl-1 text-right"><DPill d={r.daysToEarnings as number} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty t="No cheap-vol reporters in window." />}
        </Widget>

        {/* PEAD */}
        <Widget
          title="Still drifting — post-earnings"
          tip="Names that reported in the last 12 days. Day-1 = the earnings-day reaction; Drift = the move from the reaction close to the latest close. ✓ = the drift continues the reaction's direction (the classic PEAD setup); ✗ = fading it."
          links={[{ label: "see all", href: u("/pead") }]}
        >
          {peadRows.length ? (
            <table className="w-full text-left text-[12px]">
              <TH cols={["Ticker", "when", "day-1", "drift", "cont."]} />
              <tbody>
                {peadRows.map((r) => (
                  <tr key={r.symbol} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1"><Link href={u(`/stock/${r.symbol}?tab=earnings`)} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="py-1 text-right text-[11px] text-[var(--text-4)]">{r.daysSince}d ago</td>
                    <td className="py-1 text-right font-mono tabular-nums" style={{ color: mvColor(r.gapPct) }} title="earnings-day reaction">{mv(r.gapPct)}</td>
                    <td className="py-1 text-right font-mono tabular-nums font-semibold" style={{ color: mvColor(r.driftPct) }} title="drift since">{mv(r.driftPct)}</td>
                    <td className="py-1 pl-2 text-center">{r.continuation ? <span style={{ color: GREEN }} title="drift confirms the gap">✓</span> : <span style={{ color: ZINC }} title="fading">✗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty t="No active post-earnings drift." />}
        </Widget>

        {/* Sandbaggers */}
        <Widget
          title="Sandbaggers — guide low, beat"
          tip="Companies that systematically guide below what they then report (beats / total guided quarters, from their own 8-K guidance history). A sandbagger with a print coming up tends to 'surprise' again; the action chip shows their latest guidance move."
          links={[{ label: "see all", href: u("/guidance") }]}
          note={cutsCount ? `+${cutsCount} guidance cuts flagged this cycle` : undefined}
        >
          {sand.length ? (
            <table className="w-full text-left text-[12px]">
              <TH cols={["Ticker", "days", "beats", "guide"]} />
              <tbody>
                {sand.map((r) => (
                  <tr key={r.symbol} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1"><Link href={u(`/stock/${r.symbol}?tab=earnings`)} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="py-1 text-right">{r.daysToEarnings != null && r.daysToEarnings >= 0 ? <DPill d={r.daysToEarnings} /> : <span className="text-[11px] text-[var(--text-4)]">—</span>}</td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text-2)]" title="beats its own guide">{r.beats}/{r.total}</td>
                    <td className="py-1 pl-2 text-right">{r.action && r.action !== "none" ? <Pill t={r.action} c={r.action === "raise" ? GREEN : r.action === "cut" ? RED : ZINC} /> : <span className="text-[11px] text-[var(--text-4)]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty t="No sandbagger patterns flagged." />}
        </Widget>

        {/* Catalyst vol */}
        <Widget
          title="Cheap options into a scheduled event"
          tip="Known dated catalysts (investor days, analyst days) where the straddle to just past the event (implied) prices LESS movement than the stock's normal baseline over the same span — cheap optionality into a binary date."
          links={[{ label: "see all", href: u("/catalyst-vol") }]}
        >
          {catRows.length ? (
            <table className="w-full text-left text-[12px]">
              <TH cols={["Ticker", "<event", "days", "implied vs base", ""]} />
              <tbody>
                {catRows.map((r: any) => (
                  <tr key={r.ticker} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1"><Link href={u(`/stock/${r.ticker}`)} className="font-semibold text-[var(--accent)] hover:underline">{r.ticker}</Link></td>
                    <td className="py-1 text-[11px] text-[var(--text-3)]">{r.eventType}</td>
                    <td className="py-1 text-right text-[11px] text-[var(--text-4)]">{r.daysToEvent}d</td>
                    <td className="py-1 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.impliedMovePct?.toFixed(0)}% <span className="text-[var(--text-4)]">vs {r.baselineMovePct?.toFixed(0)}%</span></td>
                    <td className="py-1 pl-2 text-right">{r.ratio != null && r.ratio < 0.8 ? <Pill t="CHEAP" c={GREEN} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty t="No scheduled-event vol dislocations right now." />}
        </Widget>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        A curated digest of the earnings/options screeners — each panel links to the full board. Signals are code-detected from the options chain + filings (vendor IV treated as junk); the AI Trade Desk narrates but never invents a number. Research / decision-support, not investment advice.
      </p>
    </main>
  );
}
