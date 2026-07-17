"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import type { ForensicsData, ForensicRow } from "@/lib/forensics";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";

const RED = "#ef4444", AMBER = "#f59e0b", GREEN = "#22c55e", MUTE = "var(--text-4)";

// Beneish: higher = more manipulation-like (worse). >−1.78 high, >−2.22 elevated.
const mColor = (r: ForensicRow) => (r.mFlag === "high" ? RED : r.mFlag === "elevated" ? AMBER : r.mScore == null ? MUTE : "var(--text-2)");
// Altman: <1.81 distress, 1.81–2.99 grey, >2.99 safe.
const zColor = (r: ForensicRow) => (r.zZone === "distress" ? RED : r.zZone === "grey" ? AMBER : r.zZone === "safe" ? GREEN : MUTE);
// Piotroski: 0–9, higher is stronger.
const fColor = (f: number | null) => (f == null ? MUTE : f >= 7 ? GREEN : f <= 2 ? RED : "var(--text-2)");
// Sloan accruals: higher positive = lower quality.
const aColor = (a: number | null) => (a == null ? MUTE : a > 0.1 ? RED : a > 0.05 ? AMBER : a < 0 ? GREEN : "var(--text-2)");

const f2 = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const fPct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "" : ""}${(n * 100).toFixed(1)}%`);

type SortKey = "concern" | "mscore" | "zscore" | "fscore" | "accruals";
type Tab = "all" | "manipulation" | "distress" | "weak" | "accruals";

const TAB_MATCH: Record<Exclude<Tab, "all">, (r: ForensicRow) => boolean> = {
  manipulation: (r) => r.mFlag === "high" || r.mFlag === "elevated",
  distress: (r) => r.zZone === "distress",
  weak: (r) => r.fScore != null && r.fScore <= 2,
  accruals: (r) => r.accruals != null && r.accruals > 0.1,
};
const TAB_LABEL: Record<Exclude<Tab, "all">, string> = {
  manipulation: "Manipulation risk", distress: "Distress", weak: "Weak (F≤2)", accruals: "High accruals",
};

export default function ForensicsView({ universe, data, known }: { universe: string; data: ForensicsData; known: string[] }) {
  const [sort, setSort] = useState<SortKey>("concern");
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const knownSet = useMemo(() => new Set(known), [known]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of Object.keys(TAB_MATCH) as Exclude<Tab, "all">[]) c[k] = data.rows.filter(TAB_MATCH[k]).length;
    return c;
  }, [data.rows]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    // Each column sorts in its "most concerning first" direction; nulls always sink to the bottom.
    const lo = 1e9, hi = -1e9;
    const key = (r: ForensicRow): number =>
      sort === "mscore" ? (r.mScore ?? hi)               // highest M (most manipulation-like) first
        : sort === "zscore" ? -(r.zScore ?? lo)          // lowest Z (most distress) first
          : sort === "fscore" ? -(r.fScore ?? lo)        // lowest F (weakest) first
            : sort === "accruals" ? (r.accruals ?? hi)   // highest accruals (worst quality) first
              : r.flags.length * 100 + (r.mScore ?? hi); // concern: most flags, then most manipulation-like
    return data.rows
      .filter((r) => (tab === "all" || TAB_MATCH[tab as Exclude<Tab, "all">](r)) && (!ql || r.symbol.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql)))
      .sort((a, b) => key(b) - key(a));
  }, [data.rows, sort, tab, q]);

  const TB = (a: boolean) => "rounded-md px-2 py-1 text-[11px] font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const SH = (k: SortKey, label: string, tip: string, term?: string) => (
    <th className="cursor-pointer px-2 py-2 text-right font-medium hover:text-[var(--text)]" onClick={() => setSort(k)} title={tip}>
      <span className={sort === k ? "text-[var(--accent)]" : ""}>{label}{sort === k ? " ↓" : ""}</span>{term ? <InfoDot term={term} /> : null}
    </th>
  );

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Forensics &amp; Quality</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Earnings-quality red flags from the SEC filings — manipulation, distress, strength, and accruals — for {data.rows.length} names · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>Four classic forensic scorecards, one row per company — all computed straight from SEC filings, nothing estimated.</b> Each is a <i>screen</i>, not a verdict: a flag means look closer, not that anything is wrong.</p>
        <p><b>Beneish M</b> reads eight signs of earnings manipulation (receivables ballooning faster than sales, margins slipping, accruals building). Above −2.22 is the classic manipulator threshold; higher is more suspect. <b>Altman Z</b> gauges bankruptcy distress — above 2.99 safe, below 1.81 distress; it&apos;s calibrated on manufacturers so it reads low for asset-light software/services, and it&apos;s blank for banks &amp; insurers where it doesn&apos;t apply. <b>Piotroski F</b> is a 0–9 tally of whether the fundamentals improved year-over-year (9 = firing on all cylinders, 0–2 = deteriorating). <b>Accruals</b> (Sloan) is the share of profit not backed by cash — high positive readings historically mean lower-quality, mean-reverting earnings.</p>
        <p><b>Grounded:</b> every figure is trailing-twelve-months from the company&apos;s own XBRL filings, current year vs one year prior. A name with a missing input shows a blank for that score, never a guessed number. US filers only. Decision-support, not advice — and never a solitary reason to short a stock.</p>
      </HowToRead>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setTab("all")} className={TB(tab === "all")}>All <span className="text-[var(--text-4)]">{data.rows.length}</span></button>
          {(Object.keys(TAB_MATCH) as Exclude<Tab, "all">[]).filter((k) => counts[k]).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={TB(tab === k)}>{TAB_LABEL[k]} <span className="text-[var(--text-4)]">{counts[k]}</span></button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              {SH("mscore", "Beneish M", "Earnings-manipulation score — higher is more manipulation-like. Above −2.22 flags a likely manipulator.", "Beneish M-score")}
              {SH("zscore", "Altman Z", "Bankruptcy-distress score — below 1.81 distress, above 2.99 safe. Blank for financials.", "Altman Z-score")}
              {SH("fscore", "Piotroski F", "Fundamental-strength scorecard 0–9 — higher is stronger.", "Piotroski F-score")}
              {SH("accruals", "Accruals", "Sloan accruals: (net income − operating cash flow) ÷ assets. Higher positive = lower earnings quality.", "Sloan accruals")}
              <th className="cursor-pointer px-3 py-2 font-medium hover:text-[var(--text)]" onClick={() => setSort("concern")} title="Sort by most red flags"><span className={sort === "concern" ? "text-[var(--accent)]" : ""}>Flags{sort === "concern" ? " ↓" : ""}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2 whitespace-nowrap">
                  {knownSet.has(r.symbol)
                    ? <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                    : <span className="font-semibold text-[var(--text-2)]">{r.symbol}</span>}
                  <span className="ml-2 hidden text-[11px] text-[var(--text-4)] sm:inline">{r.name.length > 24 ? r.name.slice(0, 24) + "…" : r.name}</span>
                </td>
                <td className="px-2 py-2 text-[11px] text-[var(--text-4)] whitespace-nowrap">{r.sector}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums" style={{ color: mColor(r) }} title={r.asOf ? `TTM as of ${r.asOf}` : undefined}>{f2(r.mScore)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums" style={{ color: zColor(r) }}>{f2(r.zScore)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums" style={{ color: fColor(r.fScore) }}>{r.fScore == null ? "—" : `${r.fScore}/9`}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: aColor(r.accruals) }}>{fPct(r.accruals)}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {r.flags.map((fl) => (
                      <span key={fl} className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: AMBER, background: `color-mix(in oklab, ${AMBER} 15%, transparent)` }}>{fl}</span>
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
