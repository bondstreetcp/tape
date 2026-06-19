"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface InsiderTx {
  date: string;
  insider: string;
  role: string;
  code: string;
  acquired: boolean;
  shares: number | null;
  price: number | null;
  value: number | null;
  kind: "buy" | "sell" | "other";
  acc: string;
}

const CODE_LABEL: Record<string, string> = {
  P: "Buy", S: "Sell", A: "Award", M: "Exercise", F: "Tax w/h",
  G: "Gift", X: "Exercise", C: "Conversion", D: "Disposed to issuer", W: "Will/Inherit",
};
const KIND_COLOR = { buy: "#22c55e", sell: "#ef4444", other: "#8b93a7" } as const;

function fmtVal(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
function fmtSh(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v}`;
}

export default function InsiderActivity({ symbol }: { symbol: string }) {
  const [series, setSeries] = useState<[number, number][] | null>(null);
  const [txns, setTxns] = useState<InsiderTx[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [cik, setCik] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // initial load: price series + first page of Form 4s
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setTxns([]);
    setOffset(0);
    fetch(`/api/series/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => alive && setSeries(s?.daily ?? null))
      .catch(() => alive && setSeries(null));
    fetch(`/api/insiders/${encodeURIComponent(symbol)}?offset=0&limit=24`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setTxns(d.transactions || []);
        setNextOffset(d.nextOffset ?? null);
        setTotal(d.totalFilings || 0);
        setCik(d.cik ?? null);
        if (d.error) setErr(d.error);
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const loadMore = useCallback(() => {
    if (nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/insiders/${encodeURIComponent(symbol)}?offset=${nextOffset}&limit=24`)
      .then((r) => r.json())
      .then((d) => {
        setTxns((prev) => [...prev, ...(d.transactions || [])]);
        setNextOffset(d.nextOffset ?? null);
        setOffset(nextOffset);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [nextOffset, loadingMore, symbol]);

  // infinite scroll sentinel
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const counts = useMemo(() => {
    let buy = 0, sell = 0, other = 0;
    for (const t of txns) (t.kind === "buy" ? (buy++) : t.kind === "sell" ? (sell++) : (other++));
    return { buy, sell, other };
  }, [txns]);

  const chart = useMemo(() => buildChart(series, txns, showOther), [series, txns, showOther]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
        Loading insider filings from SEC EDGAR…
      </div>
    );
  }

  if (!cik || (txns.length === 0 && total === 0)) {
    return (
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
        No SEC Form 4 insider filings found for {symbol}.
        {err && <div className="mt-1 text-[11px] text-[#5b6478]">{err}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Price chart with insider buy/sell markers */}
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#aab2c5]">
            Insider activity vs price{" "}
            <span className="font-normal text-[#8b93a7]">· last 5y</span>
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-[#8b93a7]">
            <span className="flex items-center gap-1"><Tri up color="#22c55e" /> Buy</span>
            <span className="flex items-center gap-1"><Tri color="#ef4444" /> Sell</span>
            <label className="flex cursor-pointer items-center gap-1 select-none">
              <input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} className="accent-[#60a5fa]" />
              grants/exercises
            </label>
          </div>
        </div>
        {chart ? (
          <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" style={{ height: "auto" }} preserveAspectRatio="none">
            {chart.yTicks.map((tk) => (
              <g key={tk.y}>
                <line x1={M.l} x2={CW - M.r} y1={tk.y} y2={tk.y} stroke="#1f2430" strokeWidth={1} />
                <text x={M.l - 6} y={tk.y + 3} textAnchor="end" fontSize={10} fill="#5b6478">{tk.label}</text>
              </g>
            ))}
            {chart.xTicks.map((tk) => (
              <text key={tk.x} x={tk.x} y={CH - 6} textAnchor="middle" fontSize={10} fill="#5b6478">{tk.label}</text>
            ))}
            <path d={chart.path} fill="none" stroke="#3a4256" strokeWidth={1.25} />
            {chart.markers.map((mk, i) => (
              <g key={i}>
                <title>{mk.tip}</title>
                {mk.kind === "other" ? (
                  <circle cx={mk.x} cy={mk.y} r={mk.r * 0.8} fill={KIND_COLOR.other} fillOpacity={0.55} />
                ) : (
                  <path d={triPath(mk.x, mk.y, mk.r, mk.kind === "buy")} fill={KIND_COLOR[mk.kind]} fillOpacity={0.9} />
                )}
              </g>
            ))}
          </svg>
        ) : (
          <div className="py-6 text-center text-xs text-[#8b93a7]">Price history unavailable for the marker overlay.</div>
        )}
      </div>

      {/* Transaction list */}
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2e39] px-4 py-2.5 text-xs text-[#8b93a7]">
          <span>
            <span className="font-semibold text-[#aab2c5]">{txns.length}</span> transactions loaded
            {" · "}
            <span className="text-[#22c55e]">{counts.buy} buys</span>{" / "}
            <span className="text-[#ef4444]">{counts.sell} sells</span>{" / "}
            {counts.other} other · from {total.toLocaleString()} Form 4 filings
          </span>
          {cik && (
            <a
              href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=40`}
              target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline"
            >
              SEC EDGAR ↗
            </a>
          )}
        </div>
        <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#131722]">
              <tr className="text-[#8b93a7]">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Insider</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Shares</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t, i) => (
                <tr key={i} className="border-t border-[#1f2430]">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-[#aab2c5]">{t.date}</td>
                  <td className="px-3 py-1.5">
                    <div className="text-[#e6e9f0]">{titleCase(t.insider)}</div>
                    <div className="text-[10px] text-[#8b93a7]">{t.role}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: KIND_COLOR[t.kind] + "22", color: KIND_COLOR[t.kind] }}
                    >
                      {CODE_LABEL[t.code] || t.code || (t.acquired ? "Acquire" : "Dispose")}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: t.acquired ? "#22c55e" : "#ef4444" }}>
                    {t.acquired ? "+" : "−"}{fmtSh(t.shares)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#aab2c5]">{t.price != null ? `$${t.price.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#aab2c5]">{fmtVal(t.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={sentinel} />
          <div className="px-4 py-3 text-center text-xs text-[#8b93a7]">
            {nextOffset != null ? (
              <button onClick={loadMore} disabled={loadingMore} className="rounded-md border border-[#2a2e39] px-3 py-1.5 hover:border-[#3a4256] disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load older filings"}
              </button>
            ) : (
              <span className="text-[#5b6478]">All structured Form 4 filings loaded (SEC EDGAR, ~2003–present).</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- chart geometry ----
const CW = 1000, CH = 280;
const M = { t: 8, r: 12, b: 22, l: 48 };

function buildChart(series: [number, number][] | null, txns: InsiderTx[], showOther: boolean) {
  if (!series || series.length < 2) return null;
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  let pMin = Infinity, pMax = -Infinity;
  for (const [, c] of series) { if (c < pMin) pMin = c; if (c > pMax) pMax = c; }
  const pad = (pMax - pMin) * 0.06 || 1;
  pMin -= pad; pMax += pad;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0 || 1)) * (CW - M.l - M.r);
  const y = (p: number) => M.t + (1 - (p - pMin) / (pMax - pMin || 1)) * (CH - M.t - M.b);

  // price path (downsample to ~500 pts)
  const step = Math.max(1, Math.floor(series.length / 500));
  let path = "";
  for (let i = 0; i < series.length; i += step) {
    const [t, c] = series[i];
    path += `${path ? "L" : "M"}${x(t).toFixed(1)} ${y(c).toFixed(1)}`;
  }

  const priceAt = (t: number): number | null => {
    if (t < t0 || t > t1) return null;
    let lo = 0, hi = series.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (series[mid][0] < t) lo = mid + 1; else hi = mid; }
    return series[lo]?.[1] ?? null;
  };

  // value scale for marker size
  let vMax = 0;
  for (const t of txns) if (t.value && t.value > vMax) vMax = t.value;
  const radius = (v: number | null) => {
    if (!v || vMax <= 0) return 3.5;
    return 3 + Math.sqrt(v / vMax) * 5; // 3..8
  };

  const markers = [] as { x: number; y: number; r: number; kind: InsiderTx["kind"]; tip: string }[];
  for (const t of txns) {
    if (t.kind === "other" && !showOther) continue;
    const tm = new Date(t.date + "T00:00:00Z").getTime();
    const p = priceAt(tm);
    if (p == null) continue;
    markers.push({
      x: x(tm), y: y(p), r: radius(t.value), kind: t.kind,
      tip: `${t.date} · ${titleCase(t.insider)} (${t.role})\n${CODE_LABEL[t.code] || t.code}: ${t.acquired ? "+" : "−"}${fmtSh(t.shares)} @ ${t.price != null ? "$" + t.price.toFixed(2) : "—"} = ${fmtVal(t.value)}`,
    });
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const p = pMin + f * (pMax - pMin);
    return { y: y(p), label: `$${p >= 100 ? p.toFixed(0) : p.toFixed(1)}` };
  });
  const startYear = new Date(t0).getUTCFullYear();
  const endYear = new Date(t1).getUTCFullYear();
  const xTicks = [] as { x: number; label: string }[];
  for (let yr = startYear + 1; yr <= endYear; yr++) {
    const tm = Date.UTC(yr, 0, 1);
    if (tm >= t0 && tm <= t1) xTicks.push({ x: x(tm), label: `'${String(yr).slice(2)}` });
  }
  return { path, markers, yTicks, xTicks };
}

function triPath(cx: number, cy: number, r: number, up: boolean): string {
  return up
    ? `M${cx} ${cy - r} L${cx + r} ${cy + r * 0.8} L${cx - r} ${cy + r * 0.8} Z`
    : `M${cx} ${cy + r} L${cx + r} ${cy - r * 0.8} L${cx - r} ${cy - r * 0.8} Z`;
}

function Tri({ up, color }: { up?: boolean; color: string }) {
  return (
    <svg width="9" height="9" viewBox="-5 -5 10 10">
      <path d={up ? "M0 -4 L4 3 L-4 3 Z" : "M0 4 L4 -3 L-4 -3 Z"} fill={color} />
    </svg>
  );
}

function titleCase(s: string): string {
  if (!s) return s;
  if (s === s.toUpperCase() || s === s.toLowerCase())
    return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}
