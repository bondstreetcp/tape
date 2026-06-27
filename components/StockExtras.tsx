"use client";
import { useEffect, useState } from "react";
import { fmtMoney } from "@/lib/format";
import { borrowTier, type BorrowInfo } from "@/lib/borrow";

interface Reaction { date: string; reactionDate: string; move: number | null; surprise: number | null }
interface RatingChange { firm: string; action: string; fromGrade: string; toGrade: string; targetTo: number | null; targetFrom: number | null; date: string }
interface Ratings {
  consensus: string | null; mean: number | null; numAnalysts: number | null;
  targetMean: number | null; targetHigh: number | null; targetLow: number | null;
  price: number | null; changes: RatingChange[];
}

const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const col = (v: number | null | undefined) => (v == null ? undefined : v >= 0 ? "#22c55e" : "#ef4444");

function actionMeta(a: string) {
  switch (a) {
    case "up": return { label: "Upgrade", color: "#22c55e" };
    case "down": return { label: "Downgrade", color: "#ef4444" };
    case "init": return { label: "Initiate", color: "#60a5fa" };
    case "reit": return { label: "Reiterate", color: "var(--text-3)" };
    case "main": return { label: "Maintain", color: "var(--text-3)" };
    default: return { label: a || "Update", color: "var(--text-3)" };
  }
}

export default function StockExtras({ symbol, currency = "USD" }: { symbol: string; currency?: string }) {
  return (
    <div className="space-y-3">
      <AnalystRatings symbol={symbol} currency={currency} />
      <BorrowPanel symbol={symbol} />
      <EarningsReactions symbol={symbol} />
    </div>
  );
}

const usd = (v: number | null | undefined, cur = "USD") => (v == null ? "—" : fmtMoney(v, cur, v < 10 ? 2 : 0));

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-2)]">{title}</h3>
      {children}
    </section>
  );
}
const Muted = ({ children }: { children: React.ReactNode }) => <div className="py-2 text-xs text-[var(--text-3)]">{children}</div>;

function EarningsReactions({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Reaction[] | null | "err">(null);
  useEffect(() => {
    let a = true;
    setData(null);
    fetch(`/api/earnings-reaction/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.reactions || []))
      .catch(() => a && setData("err"));
    return () => { a = false; };
  }, [symbol]);
  return (
    <Card title="Earnings — next-day stock reaction">
      {data == null ? (
        <Muted>Loading…</Muted>
      ) : data === "err" || !data.length ? (
        <Muted>No earnings history found.</Muted>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--text-3)]">
              <th className="py-1 text-left font-medium">Reported</th>
              <th className="py-1 text-right font-medium">EPS surprise</th>
              <th className="py-1 text-right font-medium">Next-day move</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e, i) => (
              <tr key={i} className="border-t border-[var(--divider)]">
                <td className="py-1 text-left tabular-nums text-[var(--text-2)]">{e.date}</td>
                <td className="py-1 text-right tabular-nums" style={{ color: col(e.surprise) }}>
                  {e.surprise == null ? "—" : pct(e.surprise)}
                </td>
                <td className="py-1 text-right font-semibold tabular-nums" style={{ color: col(e.move) }}>{pct(e.move)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Array.isArray(data) && data.length > 0 && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--text-4)]">
          EPS surprise comes from Yahoo (≈ last 4 reported quarters); “—” = not published for older dates. The next-day move is computed from price history, so it reaches further back.
        </p>
      )}
    </Card>
  );
}

function AnalystRatings({ symbol, currency = "USD" }: { symbol: string; currency?: string }) {
  const [data, setData] = useState<Ratings | null | "err">(null);
  useEffect(() => {
    let a = true;
    setData(null);
    fetch(`/api/ratings/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.ratings || "err"))
      .catch(() => a && setData("err"));
    return () => { a = false; };
  }, [symbol]);

  return (
    <Card title="Analyst ratings & price targets">
      {data == null ? (
        <Muted>Loading…</Muted>
      ) : data === "err" || !data.changes.length ? (
        <Muted>No recent rating changes.</Muted>
      ) : (
        <>
          {/* consensus header — Bloomberg ANR-style summary */}
          {(data.consensus || data.targetMean != null) && (
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
              {data.consensus && (
                <span className="text-[var(--text-3)]">
                  Consensus <span className="font-semibold capitalize text-[var(--text)]">{data.consensus.replace(/_/g, " ")}</span>
                  {data.numAnalysts != null ? <span className="text-[var(--text-4)]"> · {data.numAnalysts} analysts</span> : null}
                </span>
              )}
              {data.targetMean != null && (
                <span className="text-[var(--text-3)]">
                  Avg target <span className="font-semibold text-[var(--text)]">{usd(data.targetMean, currency)}</span>
                  {data.price ? <span className="font-medium" style={{ color: col(data.targetMean / data.price - 1) }}> ({pct(data.targetMean / data.price - 1)} vs {usd(data.price, currency)})</span> : null}
                </span>
              )}
              {data.targetLow != null && data.targetHigh != null && (
                <span className="text-[var(--text-4)]">Range {usd(data.targetLow, currency)}–{usd(data.targetHigh, currency)}</span>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-xs">
              <thead>
                <tr className="text-[var(--text-3)]">
                  <th className="py-1 pr-2 text-left font-medium">Date</th>
                  <th className="py-1 pr-2 text-left font-medium">Firm</th>
                  <th className="py-1 pr-2 text-left font-medium">Action</th>
                  <th className="py-1 pr-2 text-left font-medium">Rating</th>
                  <th className="py-1 text-right font-medium">Price target</th>
                </tr>
              </thead>
              <tbody>
                {data.changes.map((c, i) => {
                  const m = actionMeta(c.action);
                  const ratingChanged = c.fromGrade && c.toGrade && c.fromGrade !== c.toGrade;
                  const ptChanged = c.targetFrom != null && c.targetTo != null && c.targetFrom !== c.targetTo;
                  return (
                    <tr key={i} className="border-t border-[var(--divider)] align-top">
                      <td className="py-1.5 pr-2 tabular-nums text-[var(--text-3)] whitespace-nowrap">{c.date}</td>
                      <td className="py-1.5 pr-2 text-[var(--text-2)]">{c.firm}</td>
                      <td className="py-1.5 pr-2 font-medium whitespace-nowrap" style={{ color: m.color }}>{m.label}</td>
                      <td className="py-1.5 pr-2 text-[var(--text-2)] whitespace-nowrap">
                        {ratingChanged ? (
                          <span><span className="text-[var(--text-4)]">{c.fromGrade}</span> → <span className="font-medium text-[var(--text)]">{c.toGrade}</span></span>
                        ) : (
                          <span className="font-medium text-[var(--text)]">{c.toGrade || "—"}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                        {c.targetTo == null && c.targetFrom == null ? (
                          <span className="text-[var(--text-4)]">—</span>
                        ) : ptChanged ? (
                          <span>
                            <span className="text-[var(--text-4)]">{usd(c.targetFrom, currency)}</span>{" "}
                            <span style={{ color: col((c.targetTo ?? 0) - (c.targetFrom ?? 0)) }}>→ {usd(c.targetTo, currency)}</span>
                          </span>
                        ) : (
                          <span className="font-medium text-[var(--text)]">{usd(c.targetTo ?? c.targetFrom, currency)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">
            Firm-level ratings &amp; price targets via Yahoo/Refinitiv. Individual analyst names aren&apos;t in the free feed.
          </p>
        </>
      )}
    </Card>
  );
}

const borrowShares = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`);

function Sparkline({ pts, color = "#60a5fa" }: { pts: number[]; color?: string }) {
  if (pts.length < 2) return null;
  const w = 132, h = 26, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const d = pts
    .map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 3) - 1.5).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

function BorrowPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<BorrowInfo | null | "err">(null);
  useEffect(() => {
    let a = true;
    setData(null);
    fetch(`/api/borrow/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.borrow || "err"))
      .catch(() => a && setData("err"));
    return () => { a = false; };
  }, [symbol]);

  // Silent until resolved — borrow data is US-only, so we don't flash an empty card on intl names.
  if (!data || data === "err") return null;
  const tier = borrowTier(data.fee);
  const fees = data.series.map((p) => p.fee);
  const loF = fees.length ? Math.min(...fees) : data.fee;
  const hiF = fees.length ? Math.max(...fees) : data.fee;
  return (
    <Card title="Short borrow (IBKR)">
      <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
        <div>
          <div className="text-[11px] text-[var(--text-4)]">Borrow fee</div>
          <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: tier.color }}>{data.fee.toFixed(2)}%</div>
          <div className="text-[11px] font-medium" style={{ color: tier.color }}>{tier.label}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--text-4)]">Shares available</div>
          <div className="font-mono text-lg font-semibold tabular-nums text-[var(--text)]">{borrowShares(data.available)}</div>
          {data.rebate != null && <div className="text-[11px] text-[var(--text-3)]">rebate {data.rebate.toFixed(2)}%</div>}
        </div>
        {fees.length > 1 && (
          <div>
            <div className="mb-0.5 text-[11px] text-[var(--text-4)]">Fee · last {fees.length}d</div>
            <Sparkline pts={fees} color={tier.color} />
            <div className="text-[10px] tabular-nums text-[var(--text-4)]">{loF.toFixed(2)}–{hiF.toFixed(2)}%</div>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
        Interactive Brokers securities-lending availability &amp; annualized fee via{" "}
        <a href={`https://www.iborrowdesk.com/report/${encodeURIComponent(data.symbol)}`} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">IBorrowDesk</a>
        {data.updated ? <> · as of {data.updated.slice(0, 10)}</> : null}
        {data.stale ? <span className="text-[#f59e0b]"> · availability stale</span> : null}. A high fee or thin availability means the stock is expensive or hard to short.
      </p>
    </Card>
  );
}
