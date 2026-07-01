"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { IpoData, IpoEvent } from "@/lib/ipoMonitor";
import { perfColor, fmtSize } from "@/lib/ipoMonitor";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pctStr = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
type Tab = "lockup" | "ipo";

export default function IpoMonitorView({ universe, data }: { universe: string; data: IpoData }) {
  const [tab, setTab] = useState<Tab>("lockup");
  const rows = useMemo(() => data.events.filter((e) => e.kind === tab), [data.events, tab]);
  const counts = useMemo(() => ({ lockup: data.events.filter((e) => e.kind === "lockup").length, ipo: data.events.filter((e) => e.kind === "ipo").length }), [data.events]);
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[76rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">IPOs &amp; Lockups</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Recent IPOs and the <b>lockup-expiry calendar</b> (IPO + ~180 days) — when insiders/VCs can first sell and supply hits the stock. From SEC 424B4 prospectuses. {data.events.length} events · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setTab("lockup")} className={TB(tab === "lockup")}>Upcoming lockups ({counts.lockup})</button>
          <button onClick={() => setTab("ipo")} className={TB(tab === "ipo")}>Recent IPOs ({counts.ipo})</button>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        {tab === "lockup"
          ? "A lockup expiry lets early holders sell for the first time — a supply overhang that often pressures the stock, especially on names that ran up post-IPO (high “since IPO”). Lockup dates assume the standard ~180 days; actual terms vary. Not advice."
          : "Newly-listed companies (424B4 final prospectus). “Since IPO” is the return from the offer price. Index add/deletes need a separate S&P/Russell source and aren't shown here."}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No {tab === "lockup" ? "upcoming lockups" : "recent IPOs"} yet — fills on the nightly run.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">IPO date</th>
                <th className="px-2 py-2 text-right font-medium">Offer</th>
                <th className="px-2 py-2 text-right font-medium">Size</th>
                <th className="px-2 py-2 text-right font-medium">Since IPO</th>
                {tab === "lockup" && <th className="px-2 py-2 font-medium">Lockup expiry</th>}
                <th className="px-2 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}/stock/${e.ticker}`} className="font-semibold text-[var(--accent)] hover:underline">{e.ticker}</Link>
                    <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{e.company}{e.exchange ? ` · ${e.exchange}` : ""}</div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-[var(--text-3)]">{dateLabel(e.ipoDate)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{e.priceUsd != null ? `$${e.priceUsd}` : "—"}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{fmtSize(e.sizeUsdM)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: perfColor(e.sinceIpoPct) }}>{pctStr(e.sinceIpoPct)}</td>
                  {tab === "lockup" && (
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="text-[var(--text-2)]">{e.lockupDate ? dateLabel(e.lockupDate) : "—"}</span>
                      {e.daysToLockup != null && <b className="ml-1" style={{ color: e.daysToLockup >= 0 && e.daysToLockup < 14 ? "#f59e0b" : "var(--text-4)" }}>{e.daysToLockup >= 0 ? `in ${e.daysToLockup}d` : `${-e.daysToLockup}d ago`}</b>}
                    </td>
                  )}
                  <td className="px-2 py-2">{e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">424B4 ↗</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
