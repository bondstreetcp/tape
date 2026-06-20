"use client";
import { useEffect, useState } from "react";

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

export default function StockExtras({ symbol }: { symbol: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <EarningsReactions symbol={symbol} />
      <AnalystActions symbol={symbol} />
    </div>
  );
}

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
    </Card>
  );
}

function AnalystActions({ symbol }: { symbol: string }) {
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
    <Card title="Recent analyst actions">
      {data == null ? (
        <Muted>Loading…</Muted>
      ) : data === "err" || !data.changes.length ? (
        <Muted>No recent rating changes.</Muted>
      ) : (
        <>
          {(data.consensus || data.targetMean != null) && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-3)]">
              {data.consensus && (
                <span>
                  Consensus <span className="font-semibold capitalize text-[var(--text)]">{data.consensus.replace(/_/g, " ")}</span>
                </span>
              )}
              {data.numAnalysts != null && <span>· {data.numAnalysts} analysts</span>}
              {data.targetMean != null && (
                <span>
                  · avg target <span className="font-semibold text-[var(--text)]">${data.targetMean.toFixed(0)}</span>
                  {data.price ? <span style={{ color: col(data.targetMean / data.price - 1) }}> ({pct(data.targetMean / data.price - 1)})</span> : null}
                </span>
              )}
            </div>
          )}
          <div className="space-y-0.5">
            {data.changes.map((c, i) => {
              const m = actionMeta(c.action);
              return (
                <div key={i} className="flex items-center gap-2 border-t border-[var(--divider)] py-1 text-xs">
                  <span className="w-[64px] shrink-0 tabular-nums text-[var(--text-3)]">{c.date}</span>
                  <span className="flex-1 truncate text-[var(--text-2)]">{c.firm}</span>
                  <span className="shrink-0 font-medium" style={{ color: m.color }}>{m.label}</span>
                  <span className="w-[118px] shrink-0 truncate text-right text-[var(--text-3)]">
                    {c.toGrade || ""}
                    {c.targetTo != null ? ` · $${c.targetTo.toFixed(0)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
