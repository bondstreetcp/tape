"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CampaignsData, Campaign, CampaignType } from "@/lib/campaigns";
import { typeColor, typeLabel, perfColor } from "@/lib/campaigns";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pctStr = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
type TypeF = "all" | CampaignType;

export default function CampaignsView({ universe, data }: { universe: string; data: CampaignsData }) {
  const [typeF, setTypeF] = useState<TypeF>("all");
  const [q, setQ] = useState("");

  const campaigns = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.campaigns.filter((c) => {
      if (typeF !== "all" && c.type !== typeF) return false;
      if (ql && !(c.ticker || "").toLowerCase().includes(ql) && !c.company.toLowerCase().includes(ql) && !c.campaigner.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.campaigns, typeF, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of data.campaigns) c[x.type] = (c[x.type] || 0) + 1;
    return c;
  }, [data.campaigns]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Activism &amp; Short Campaigns</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Who&apos;s publicly pressuring or betting against a company — <b style={{ color: typeColor("activist") }}>activist stakes</b> (13D <InfoDot term="13D" />), <b style={{ color: typeColor("proxy-fight") }}>proxy fights</b> (DEFC14A/DFAN14A), and <b style={{ color: typeColor("short") }}>short reports</b> — with the AI-extracted ask/allegation and the stock since. {data.campaigns.length} campaigns · {data.scanned} filings scanned · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setTypeF("all")} className={TB(typeF === "all")}>All</button>
          <button onClick={() => setTypeF("activist")} className={TB(typeF === "activist")} title="Schedule 13D — a >5% stake filed with intent to influence">Activist ({counts["activist"] || 0})</button>
          <button onClick={() => setTypeF("proxy-fight")} className={TB(typeF === "proxy-fight")} title="Contested proxy solicitations">Proxy ({counts["proxy-fight"] || 0})</button>
          <button onClick={() => setTypeF("short")} className={TB(typeF === "short")} title="Published short-seller reports">Short ({counts["short"] || 0})</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, company, or campaigner…" className="w-56 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{campaigns.length} of {data.campaigns.length}</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span className="text-[var(--text-4)]">A public-disclosure tracker (SEC EDGAR + published reports), not advice. &ldquo;Since&rdquo; = the stock&apos;s return from the filing/report date to now — for shorts, a positive number means the stock rose (the short is offside so far).</span>
      </div>

      {data.campaigns.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No campaigns ingested yet — this fills on the nightly run.</div>
      ) : (
        <div className="space-y-2.5">{campaigns.map((c) => <CampaignCard key={c.id} c={c} universe={universe} />)}</div>
      )}
    </main>
  );
}

function CampaignCard({ c, universe }: { c: Campaign; universe: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in oklab, ${typeColor(c.type)} 16%, transparent)`, color: typeColor(c.type) }}>{typeLabel(c.type)}</span>
        {c.ticker ? (
          <Link href={`/u/${universe}/stock/${c.ticker}`} className="text-sm font-semibold text-[var(--accent)] hover:underline">{c.ticker}</Link>
        ) : null}
        <span className="text-[13px] text-[var(--text-2)]">{c.company}</span>
        {c.perf?.sincePct != null && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[12px]" style={{ color: perfColor(c.perf.sincePct) }} title="stock return since the filing/report">{pctStr(c.perf.sincePct)} since</span>}
        <span className="ml-auto text-[12px] text-[var(--text-4)]">{dateLabel(c.date)}</span>
      </div>
      <div className="text-[13px] text-[var(--text)]"><b className="text-[var(--text-2)]">{c.campaigner}</b> <span className="text-[var(--text-3)]">· {c.ask}</span></div>
      {c.summary && <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-4)]">{c.summary}</p>}
      <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--text-4)]">
        <span>{c.form}</span>
        {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{c.type === "short" ? "Read the report ↗" : "View filing ↗"}</a>}
      </div>
    </div>
  );
}
