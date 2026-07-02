"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { IpoData, IpoEvent, IpoKind } from "@/lib/ipoMonitor";
import { perfColor, fmtSize } from "@/lib/ipoMonitor";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pctStr = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const slug = (e: IpoEvent) => e.ticker || e.id; // upcoming filings may not have a ticker yet

export default function IpoMonitorView({ universe, data }: { universe: string; data: IpoData }) {
  const [tab, setTab] = useState<IpoKind>("upcoming");
  const rows = useMemo(() => data.events.filter((e) => e.kind === tab), [data.events, tab]);
  const counts = useMemo(() => ({
    upcoming: data.events.filter((e) => e.kind === "upcoming").length,
    ipo: data.events.filter((e) => e.kind === "ipo").length,
    lockup: data.events.filter((e) => e.kind === "lockup").length,
  }), [data.events]);
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">IPOs &amp; Lockups</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The IPO pipeline (S-1 filings), recent listings, and the <b>lockup-expiry calendar</b> <InfoDot term="Lockup" /> — each with an AI summary of the prospectus. From SEC filings. {data.events.length} events · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setTab("upcoming")} className={TB(tab === "upcoming")}>Upcoming IPOs ({counts.upcoming})</button>
          <button onClick={() => setTab("ipo")} className={TB(tab === "ipo")}>Recent IPOs ({counts.ipo})</button>
          <button onClick={() => setTab("lockup")} className={TB(tab === "lockup")}>Lockups ({counts.lockup})</button>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        {tab === "upcoming"
          ? "Companies that filed an S-1/F-1 to go public — the pipeline. Not yet trading; a proposed ticker may not be assigned. Click a row for the AI prospectus summary."
          : tab === "ipo"
            ? "Newly-listed companies (424B4 final prospectus). “Since IPO” is the return from the offer price. Click for the prospectus summary."
            : "A lockup expiry lets early holders sell for the first time — a supply overhang, especially on names that ran up post-IPO. Lockups assume the standard ~180 days; actual terms vary. Not advice."}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">Nothing here yet — fills on the nightly run.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">{tab === "upcoming" ? "Company" : "Ticker"}</th>
                <th className="px-2 py-2 font-medium">{tab === "upcoming" ? "Filed" : "IPO date"}</th>
                <th className="px-2 py-2 font-medium">Sector</th>
                <th className="px-2 py-2 text-right font-medium">{tab === "upcoming" ? "Proposed" : "Offer"}</th>
                <th className="px-2 py-2 text-right font-medium">Size</th>
                {tab !== "upcoming" && <th className="px-2 py-2 text-right font-medium">Since IPO</th>}
                {tab === "lockup" && <th className="px-2 py-2 font-medium">Lockup expiry</th>}
                <th className="px-2 py-2 font-medium">Underwriters</th>
                <th className="px-2 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}/ipos/${slug(e)}`} className="font-semibold text-[var(--accent)] hover:underline">{e.ticker || e.company}</Link>
                    <div className="max-w-[190px] truncate text-[11px] text-[var(--text-4)]">{e.ticker ? e.company : e.exchange || "—"}{e.exchange && e.ticker ? ` · ${e.exchange}` : ""}</div>
                    {e.summary?.business && <div className="mt-0.5 max-w-[320px] truncate text-[11px] text-[var(--text-3)]" title={e.summary.business}>{e.summary.business}</div>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-[var(--text-3)]">{dateLabel(e.ipoDate)}</td>
                  <td className="px-2 py-2 text-[12px] text-[var(--text-4)]">{e.summary?.sector || "—"}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{e.priceUsd != null ? `$${e.priceUsd}` : "—"}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{fmtSize(e.sizeUsdM)}</td>
                  {tab !== "upcoming" && <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: perfColor(e.sinceIpoPct) }}>{pctStr(e.sinceIpoPct)}</td>}
                  {tab === "lockup" && (
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="text-[var(--text-2)]">{e.lockupDate ? dateLabel(e.lockupDate) : "—"}</span>
                      {e.daysToLockup != null && <b className="ml-1" style={{ color: e.daysToLockup >= 0 && e.daysToLockup < 14 ? "#f59e0b" : "var(--text-4)" }}>{e.daysToLockup >= 0 ? `in ${e.daysToLockup}d` : `${-e.daysToLockup}d ago`}</b>}
                    </td>
                  )}
                  <td className="px-2 py-2 text-[12px] text-[var(--text-4)]">
                    {e.summary?.underwriters?.length
                      ? <div className="max-w-[210px] truncate" title={e.summary.underwriters.join(", ")}>{e.summary.underwriters.join(", ")}</div>
                      : "—"}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap"><Link href={`/u/${universe}/ipos/${slug(e)}`} className="text-[11px] text-[var(--accent)] hover:underline">Details →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
