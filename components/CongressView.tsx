"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CongressData, CongressTrade } from "@/lib/congress";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UniverseSwitcher from "./UniverseSwitcher";

const k = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);
const fmtAmt = (lo: number, hi: number) => (lo === hi ? `${k(lo)}+` : `${k(lo)}–${k(hi)}`);
const typeColor: Record<string, string> = { buy: "#22c55e", sell: "#ef4444", exchange: "#f59e0b" };
const dt = (s: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

export default function CongressView({ universe, data, known }: { universe: string; data: CongressData; known: string[] }) {
  const knownSet = useMemo(() => new Set(known), [known]);
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [chamber, setChamber] = useState<"all" | "Senate" | "House">("all");
  const [q, setQ] = useState("");
  const hasHouse = useMemo(() => data.trades.some((t) => t.chamber === "House"), [data.trades]);

  const tlink = (ticker: string) =>
    knownSet.has(ticker) ? (
      <Link href={`/u/${universe}/stock/${encodeURIComponent(ticker)}`} className="font-mono font-semibold text-[#60a5fa] hover:underline">{ticker}</Link>
    ) : (
      <span className="font-mono font-semibold text-[var(--text-2)]">{ticker}</span>
    );

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.trades.filter((t) => {
      if (side !== "all" && t.type !== side) return false;
      if (chamber !== "all" && t.chamber !== chamber) return false;
      if (ql && !t.ticker.toLowerCase().includes(ql) && !t.member.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.trades, side, chamber, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Congressional Trading</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            U.S. Senate &amp; House stock trades disclosed under the STOCK Act · {data.trades.length} transactions since {dt(data.since)} · amounts are disclosed brackets, filed up to ~45 days late · sources <a href="https://efdsearch.senate.gov" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">Senate eFD</a> &amp; <a href="https://disclosures-clerk.house.gov" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">House Clerk</a>
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* summary cards */}
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text-2)]">Most-traded tickers <span className="font-normal text-[var(--text-4)]">· since {dt(data.since)}</span></div>
          <div className="divide-y divide-[var(--divider)]">
            {data.topTickers.slice(0, 8).map((t) => (
              <div key={t.ticker} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
                <span className="flex items-center gap-2">{tlink(t.ticker)} <span className="max-w-[16rem] truncate text-xs text-[var(--text-3)]">{t.asset}</span></span>
                <span className="flex items-center gap-3 text-xs tabular-nums">
                  <span className="text-[#22c55e]">{t.buys}B</span><span className="text-[#ef4444]">{t.sells}S</span>
                  <span className="w-16 text-right text-[var(--text-3)]">{t.members} member{t.members !== 1 ? "s" : ""}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text-2)]">Most-active members <span className="font-normal text-[var(--text-4)]">· since {dt(data.since)}</span></div>
          <div className="divide-y divide-[var(--divider)]">
            {data.topMembers.slice(0, 8).map((m) => (
              <button key={m.member} onClick={() => setQ(m.member)} className="flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]">
                <span className="truncate font-medium">{m.member}</span>
                <span className="flex items-center gap-3 text-xs tabular-nums text-[var(--text-3)]">
                  <span>{m.trades} trades</span><span>{m.tickers} tickers</span><span className="w-12 text-right">{dt(m.lastTrade)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setSide("all")} className={TB(side === "all")}>All</button>
          <button onClick={() => setSide("buy")} className={TB(side === "buy")}>Buys</button>
          <button onClick={() => setSide("sell")} className={TB(side === "sell")}>Sells</button>
        </div>
        {hasHouse && (
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {(["all", "Senate", "House"] as const).map((c) => (
              <button key={c} onClick={() => setChamber(c)} className={TB(chamber === c)}>{c === "all" ? "Both" : c}</button>
            ))}
          </div>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Member or ticker…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} trades</span>
      </div>

      {/* trades table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              <th className="px-4 py-2 text-left font-medium">Traded</th>
              <th className="px-4 py-2 text-left font-medium">Member</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Ticker</th>
              <th className="px-4 py-2 text-left font-medium">Asset</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">Disclosed</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((t, i) => (
              <tr key={i} className="border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
                <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-[var(--text-2)]">{dt(t.txDate)}</td>
                <td className="whitespace-nowrap px-4 py-1.5"><span className={"mr-1.5 rounded px-1 py-0.5 text-[9px] font-semibold " + (t.chamber === "Senate" ? "bg-[#2563eb]/15 text-[#60a5fa]" : "bg-[#7c3aed]/15 text-[#a78bfa]")}>{t.chamber === "Senate" ? "SEN" : "REP"}</span>{t.member}</td>
                <td className="px-4 py-1.5"><span className="text-xs font-semibold uppercase" style={{ color: typeColor[t.type] }}>{t.type === "buy" ? "Buy" : t.type === "sell" ? "Sell" : "Exch"}</span></td>
                <td className="px-4 py-1.5">{tlink(t.ticker)}</td>
                <td className="max-w-[18rem] truncate px-4 py-1.5 text-[var(--text-3)]">{t.asset}</td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-[var(--text-2)]">{fmtAmt(t.amountLow, t.amountHigh)}</td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums text-[var(--text-4)]" title={`Disclosed ${t.lagDays} days after the trade`}>{dt(t.filedDate)} <span className="text-[10px]">+{t.lagDays}d</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No trades match.</div>}
        {rows.length > 400 && <div className="border-t border-[var(--border)] px-4 py-2 text-center text-xs text-[var(--text-4)]">Showing the 400 most recent of {rows.length} — narrow with the filters.</div>}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">Self-reported under the STOCK Act, parsed from Senate e-filings and e-filed House PTRs; covers U.S.-ticker stock &amp; ETF transactions only (bonds, options and non-tickered assets excluded). A minority of House filings are scanned PDFs that can&apos;t be parsed, so House coverage is partial. Not a signal of wrongdoing or a recommendation.</p>
    </main>
  );
}
