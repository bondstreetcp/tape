"use client";
import { useEffect, useState } from "react";
import { currencyPrefix } from "@/lib/format";

interface Row { name: string; values: (number | null)[] }
interface Breakdown { title: string; periods: string[]; rows: Row[]; total: (number | null)[] | null }
interface Segments { asOf: string; form: string; url: string; product: Breakdown | null; geographic: Breakdown | null }

const fmtB = (v: number | null, currency?: string) => {
  if (v == null) return "—";
  const sym = currencyPrefix(currency);
  return v >= 1000 ? `${sym}${(v / 1000).toFixed(1)}B` : `${sym}${v.toFixed(0)}M`;
};

export default function SegmentsPanel({ symbol, currency }: { symbol: string; currency?: string }) {
  const [data, setData] = useState<Segments | "loading" | "err" | null>("loading");
  useEffect(() => {
    let a = true;
    setData("loading");
    fetch(`/api/segments/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.segments || "err"))
      .catch(() => a && setData("err"));
    return () => { a = false; };
  }, [symbol]);

  if (data === "loading" || data === "err" || !data) return null; // hide unless we have it
  if (!data.product && !data.geographic) return null;
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {data.product && <Card b={data.product} subtitle="by product / service" url={data.url} currency={currency} />}
      {data.geographic && <Card b={data.geographic} subtitle="by segment / geography" url={data.url} currency={currency} />}
    </div>
  );
}

function Card({ b, subtitle, url, currency }: { b: Breakdown; subtitle: string; url: string; currency?: string }) {
  const rows = b.rows
    .map((r) => ({ name: r.name, latest: r.values[0] ?? null, prior: r.values[1] ?? null }))
    .filter((r) => r.latest != null)
    .sort((a, z) => (z.latest || 0) - (a.latest || 0));
  if (rows.length < 2) return null;
  const total = (b.total?.[0] ?? rows.reduce((s, r) => s + (r.latest || 0), 0)) || 1;
  const max = Math.max(...rows.map((r) => r.latest || 0), 1);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">
          Revenue {subtitle} {b.periods[0] && <span className="font-normal text-[var(--text-4)]">· FY{b.periods[0]}</span>}
        </h3>
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] text-[var(--accent)] hover:underline">10-K ↗</a>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const pct = (r.latest! / total) * 100;
          const yoy = r.prior && r.prior > 0 ? (r.latest! / r.prior - 1) * 100 : null;
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-[var(--text-2)]">{r.name}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-[var(--text)]">{fmtB(r.latest, currency)}</span> <span className="text-[var(--text-3)]">{pct.toFixed(0)}%</span>
                  {yoy != null && (
                    <span style={{ color: yoy >= 0 ? "#22c55e" : "#ef4444" }}> {yoy >= 0 ? "+" : ""}{yoy.toFixed(0)}%</span>
                  )}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-[var(--bg)]">
                <div className="h-1.5 rounded bg-[var(--accent)]" style={{ width: `${(r.latest! / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
