"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import { BADGE_META, type BuybackData, type BuybackRow, type BuybackBadge } from "@/lib/buybacks";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";

const UP = "#22c55e", DOWN = "#ef4444";
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const usd = (n: number | null): string => {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
};
// Net share-count change is the truth serum: negative (shrinking) is GOOD, positive (diluting) is bad.
const netColor = (v: number | null) => (v == null ? "var(--text-4)" : v <= -0.005 ? UP : v >= 0.005 ? DOWN : "var(--text-3)");

type SortKey = "total" | "buyback" | "net" | "accel";

export default function BuybacksView({ universe, data, known }: { universe: string; data: BuybackData; known: string[] }) {
  const [sort, setSort] = useState<SortKey>("total");
  const [badge, setBadge] = useState<BuybackBadge | "all">("all");
  const [q, setQ] = useState("");
  const knownSet = useMemo(() => new Set(known), [known]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const key = (r: BuybackRow): number =>
      sort === "total" ? (r.totalYield ?? -1)
        : sort === "buyback" ? (r.buybackYield ?? -1)
          : sort === "net" ? -(r.netShareChangePct ?? 1) // most-shrinking first
            : (r.buybackAccel ?? -1);
    return data.rows
      .filter((r) => (badge === "all" || r.badges.includes(badge)) && (!ql || r.symbol.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql)))
      .sort((a, b) => key(b) - key(a));
  }, [data.rows, sort, badge, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of data.rows) for (const b of r.badges) c[b] = (c[b] ?? 0) + 1;
    return c;
  }, [data.rows]);

  const TB = (a: boolean) => "rounded-md px-2 py-1 text-[11px] font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const SH = (k: SortKey, label: string, tip: string) => (
    <th className="cursor-pointer px-2 py-2 text-right font-medium hover:text-[var(--text)]" onClick={() => setSort(k)} title={tip}>
      <span className={sort === k ? "text-[var(--accent)]" : ""}>{label}{sort === k ? " ↓" : ""}</span>
    </th>
  );

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Buyback &amp; Capital Return</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            How much of its value each S&amp;P 500 company hands back — and whether the buyback is <i>real</i>. {data.rows.length} names · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>The number that matters:</b> a big buyback yield means nothing if the share count isn&apos;t actually falling. Plenty of companies spend billions on repurchases just to soak up the stock they hand employees — the count stays flat and you get nothing per share. <b>Net Δ shares</b> is the truth serum: green (negative) = the count really shrank and your slice of the company grew; red (positive) = the buyback is losing to dilution.</p>
        <p><b>Total yield</b> = buyback yield + dividend yield — the classic shareholder-yield factor, the total cash return as a % of market value. <b>Accel</b> compares the latest quarter&apos;s repurchase pace to the trailing-year run-rate (&gt;1 = ramping up). <b>Payout ÷ FCF</b> flags names returning more than they earn (funded from the balance sheet or debt — watch sustainability).</p>
        <p><b>Grounded:</b> every figure comes straight from the company&apos;s SEC filings (XBRL) — repurchase and dividend cash from the cash-flow statement, share count from the cover/EPS disclosures. Nothing is estimated. Trailing-twelve-months where the quarters are cleanly filed, else the latest full fiscal year (see the &quot;as of&quot; date). US filers only. Decision-support, not advice.</p>
      </HowToRead>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setBadge("all")} className={TB(badge === "all")}>All</button>
          {(Object.keys(BADGE_META) as BuybackBadge[]).filter((b) => b !== "no-buyback" && counts[b]).map((b) => (
            <button key={b} onClick={() => setBadge(b)} className={TB(badge === b)} title={BADGE_META[b].blurb}>
              {BADGE_META[b].label} <span className="text-[var(--text-4)]">{counts[b]}</span>
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[920px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              {SH("total", "Total yield", "Buyback yield + dividend yield — total cash returned as a % of market value")}
              {SH("buyback", "Buyback", "Trailing-12-mo repurchases ÷ market cap")}
              <th className="px-2 py-2 text-right font-medium">Div<InfoDot text="Trailing dividend yield (from the quote)." /></th>
              {SH("net", "Net Δ shares", "Year-over-year change in shares outstanding. NEGATIVE (green) = the count is really shrinking; positive (red) = the buyback is losing to dilution.")}
              <th className="px-2 py-2 text-right font-medium">Buyback $<InfoDot text="Cash spent on repurchases over the trailing year (TTM where cleanly filed, else latest fiscal year)." /></th>
              {SH("accel", "Accel", "Latest quarter's repurchase pace ÷ the trailing-year run-rate. >1 = ramping up.")}
              <th className="px-2 py-2 text-right font-medium">Pay/FCF<InfoDot text="(Buybacks + dividends) ÷ free cash flow, annual basis. >1 = returning more than it earns." /></th>
              <th className="px-2 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  {knownSet.has(r.symbol)
                    ? <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                    : <span className="font-semibold text-[var(--text-2)]">{r.symbol}</span>}
                  <span className="ml-2 hidden text-[11px] text-[var(--text-4)] sm:inline">{r.name.length > 26 ? r.name.slice(0, 26) + "…" : r.name}</span>
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-[var(--text)]">{pct(r.totalYield)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{pct(r.buybackYield)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{pct(r.dividendYield)}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums" style={{ color: netColor(r.netShareChangePct) }} title={r.asOf ? `as of ${r.asOf}` : undefined}>
                  {r.netShareChangePct == null ? "—" : `${r.netShareChangePct > 0 ? "+" : ""}${pct(r.netShareChangePct)}`}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{usd(r.buybackTtm)}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: r.buybackAccel != null && r.buybackAccel >= 1.25 && r.buybackTtm ? "#a78bfa" : "var(--text-3)" }}>{r.buybackAccel != null ? `${r.buybackAccel.toFixed(2)}×` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: r.payoutToFcf != null && r.payoutToFcf > 1.15 ? "#f59e0b" : "var(--text-3)" }}>{r.payoutToFcf != null ? `${r.payoutToFcf.toFixed(2)}×` : "—"}</td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap gap-1">
                    {r.badges.filter((b) => b !== "no-buyback").map((b) => (
                      <span key={b} className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: BADGE_META[b].color, background: `color-mix(in oklab, ${BADGE_META[b].color} 15%, transparent)` }} title={BADGE_META[b].blurb}>{BADGE_META[b].label}</span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
