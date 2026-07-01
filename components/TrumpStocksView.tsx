"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { TrumpStocksData, TrumpStockPost, Stance } from "@/lib/trumpStocks";
import { summarize, stanceColor, perfColor } from "@/lib/trumpStocks";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const GREEN = "#22c55e", RED = "#ef4444";

type StanceF = "all" | "bullish" | "bearish";

export default function TrumpStocksView({ universe, data }: { universe: string; data: TrumpStocksData }) {
  const [stanceF, setStanceF] = useState<StanceF>("all");
  const [q, setQ] = useState("");

  const stats = useMemo(() => summarize(data.posts), [data.posts]);
  const posts = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.posts.filter((p) => {
      if (stanceF !== "all" && !p.tickers.some((t) => t.stance === stanceF)) return false;
      if (ql && !p.tickers.some((t) => t.ticker.toLowerCase().includes(ql) || t.company.toLowerCase().includes(ql)) && !p.excerpt.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.posts, stanceF, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const Stat = ({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) => (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-4)]">{sub}</div>}
    </div>
  );

  const wr = stats.bullHitRate;

  return (
    <main className="mx-auto max-w-[70rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Trump&apos;s Stock Calls</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Just the Truth Social posts where the President names a specific public company — the political noise filtered out — with how the stock has moved since. {data.posts.length} calls · {data.scanned} posts scanned · {data.source} · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {stats.bullN > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-4">
          <Stat label="Stock calls" value={`${stats.nCalls}`} sub={`${stats.nPosts} posts`} />
          <Stat label="Bullish → up since" value={wr == null ? "—" : `${(wr * 100).toFixed(0)}%`} color={wr == null ? undefined : wr >= 0.5 ? GREEN : RED} sub={`${stats.bullUp}/${stats.bullN} of his bullish mentions`} />
          <Stat label="Avg since (bullish)" value={pct(stats.avgBullSince)} color={perfColor(stats.avgBullSince)} sub="mean return from the post" />
          <Stat label="Source" value="Truth Social" sub="@realDonaldTrump" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b style={{ color: GREEN }}>Bullish</b> = he praises / endorses / a helpful deal · <b style={{ color: RED }}>Bearish</b> = he attacks / threatens</span>
        <span><b className="text-[var(--text-2)]">Since</b> = the stock&apos;s return from the post to now (also 1d / 1w / 1m)</span>
        <span className="text-[var(--text-4)]">Public posts, filtered by AI — a mention tracker, not advice.</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setStanceF("all")} className={TB(stanceF === "all")}>All</button>
          <button onClick={() => setStanceF("bullish")} className={TB(stanceF === "bullish")}>Bullish</button>
          <button onClick={() => setStanceF("bearish")} className={TB(stanceF === "bearish")}>Bearish</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{posts.length} of {data.posts.length}</span>
      </div>

      {data.posts.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          <div className="text-[var(--text-2)]">No stock mentions in the recent window.</div>
          <div className="mx-auto mt-1 max-w-md text-[13px]">This watches @realDonaldTrump&apos;s Truth Social and surfaces only the posts that name a public company (like his DELL / INTC calls) — everything else is filtered out. It populates as he posts. {data.scanned > 0 ? `${data.scanned} recent posts scanned, none stock-relevant.` : ""}</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {posts.map((p) => <PostCard key={p.id} p={p} universe={universe} />)}
        </div>
      )}
    </main>
  );
}

function PostCard({ p, universe }: { p: TrumpStockPost; universe: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {p.tickers.map((t) => (
          <Link key={t.ticker} href={`/u/${universe}/stock/${t.ticker}`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-semibold hover:underline" style={{ background: `color-mix(in oklab, ${stanceColor(t.stance)} 16%, transparent)`, color: stanceColor(t.stance) }} title={`${t.company} · ${t.stance}`}>
            {t.ticker}
            <span className="text-[10px] uppercase opacity-70">{t.stance}</span>
            {t.perf?.sincePct != null && <span className="font-mono text-[13px]" style={{ color: perfColor(t.perf.sincePct) }}>{pct(t.perf.sincePct)}</span>}
          </Link>
        ))}
        <span className="ml-auto text-[12px] text-[var(--text-4)]">{dateLabel(p.date)}</span>
      </div>
      <p className="text-[13px] leading-snug text-[var(--text-2)]">&ldquo;{p.excerpt}&rdquo;</p>
      {p.rationale && <p className="mt-1 text-[12px] text-[var(--text-4)]">{p.rationale}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-4)]">
        {p.tickers.some((t) => t.perf) && (
          <span className="font-mono">
            {p.tickers.map((t) => t.perf && (
              <span key={t.ticker} className="mr-3">{t.ticker}: since <b style={{ color: perfColor(t.perf.sincePct) }}>{pct(t.perf.sincePct)}</b> · 1d {pct(t.perf.d1Pct)} · 1w {pct(t.perf.w1Pct)} · 1m {pct(t.perf.m1Pct)}</span>
            ))}
          </span>
        )}
        {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-[var(--accent)] hover:underline">View post ↗</a>}
      </div>
    </div>
  );
}
