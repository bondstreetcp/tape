"use client";
import { useEffect, useMemo, useState } from "react";

interface Opt {
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  vol: number | null;
  oi: number | null;
  iv: number | null;
  itm: boolean;
}
interface OptionChain {
  underlying: number | null;
  expirations: string[];
  selected: string | null;
  calls: Opt[];
  puts: Opt[];
}

const px = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const iv = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const big = (v: number | null) => {
  if (v == null) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v}`;
};

export default function OptionsChain({ symbol }: { symbol: string }) {
  const [data, setData] = useState<OptionChain | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [allStrikes, setAllStrikes] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    const url = `/api/options/${encodeURIComponent(symbol)}${expiry ? `?date=${expiry}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (!expiry && d.selected) setExpiry(d.selected);
        if (d.error) setErr(d.error);
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [symbol, expiry]);

  const rows = useMemo(() => {
    if (!data) return [];
    const callBy = new Map(data.calls.map((c) => [c.strike, c]));
    const putBy = new Map(data.puts.map((p) => [p.strike, p]));
    const strikes = [...new Set([...callBy.keys(), ...putBy.keys()])].sort((a, b) => a - b);
    const u = data.underlying ?? 0;
    let atm = 0, best = Infinity;
    strikes.forEach((s, i) => { const d = Math.abs(s - u); if (d < best) { best = d; atm = i; } });
    let list = strikes.map((s, i) => ({ strike: s, call: callBy.get(s) || null, put: putBy.get(s) || null, isAtm: i === atm }));
    if (!allStrikes) {
      const lo = Math.max(0, atm - 18);
      list = list.slice(lo, atm + 19);
    }
    return list;
  }, [data, allStrikes]);

  const atmIv = useMemo(() => {
    const a = rows.find((r) => r.isAtm);
    const vals = [a?.call?.iv, a?.put?.iv].filter((v): v is number => v != null);
    return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
  }, [rows]);

  const dte = useMemo(() => {
    if (!expiry) return null;
    return Math.round((new Date(expiry + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
  }, [expiry]);

  if (loading && !data) {
    return <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">Loading options chain…</div>;
  }
  if (!data || (data.expirations.length === 0 && data.calls.length === 0)) {
    return (
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
        No listed options for {symbol}.{err && <div className="mt-1 text-[11px] text-[#5b6478]">{err}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-[#8b93a7]">Expiry</span>
          <select
            value={expiry ?? ""}
            onChange={(e) => setExpiry(e.target.value)}
            className="rounded-lg border border-[#2a2e39] bg-[#131722] px-2 py-1 text-sm outline-none focus:border-[#3a4256]"
          >
            {data.expirations.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        {dte != null && <span className="text-[#8b93a7]">{dte}d to expiry</span>}
        {data.underlying != null && (
          <span className="text-[#aab2c5]">Underlying <span className="font-mono font-semibold text-[#e6e9f0]">${data.underlying.toFixed(2)}</span></span>
        )}
        {atmIv != null && <span className="text-[#aab2c5]">ATM IV <span className="font-semibold text-[#e6e9f0]">{iv(atmIv)}</span></span>}
        <button onClick={() => setAllStrikes((v) => !v)} className="ml-auto text-xs text-[#60a5fa] hover:underline">
          {allStrikes ? "Show near-the-money" : "Show all strikes"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#2a2e39] bg-[#131722]">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-[#2a2e39] text-[#8b93a7]">
              <th colSpan={6} className="bg-[#0f2a1a]/30 px-2 py-1.5 text-center font-semibold text-[#22c55e]">CALLS</th>
              <th className="px-2 py-1.5 text-center font-semibold">Strike</th>
              <th colSpan={6} className="bg-[#2a1414]/30 px-2 py-1.5 text-center font-semibold text-[#ef4444]">PUTS</th>
            </tr>
            <tr className="border-b border-[#2a2e39] text-[10px] text-[#5b6478]">
              {["OI", "Vol", "IV", "Bid", "Ask", "Last"].map((h) => <th key={"c" + h} className="px-2 py-1 text-right font-medium">{h}</th>)}
              <th className="px-2 py-1 text-center font-medium"></th>
              {["Last", "Bid", "Ask", "IV", "Vol", "OI"].map((h) => <th key={"p" + h} className="px-2 py-1 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.strike} className={"border-b border-[#1f2430] " + (r.isAtm ? "bg-[#10182a]" : "")}>
                <Cell v={big(r.call?.oi ?? null)} itm={r.call?.itm} />
                <Cell v={big(r.call?.vol ?? null)} itm={r.call?.itm} />
                <Cell v={iv(r.call?.iv ?? null)} itm={r.call?.itm} />
                <Cell v={px(r.call?.bid ?? null)} itm={r.call?.itm} />
                <Cell v={px(r.call?.ask ?? null)} itm={r.call?.itm} />
                <Cell v={px(r.call?.last ?? null)} itm={r.call?.itm} bold />
                <td className={"px-2 py-1 text-center font-mono font-semibold tabular-nums " + (r.isAtm ? "text-[#93c5fd]" : "text-[#e6e9f0]")}>
                  {r.strike}
                </td>
                <Cell v={px(r.put?.last ?? null)} itm={r.put?.itm} bold />
                <Cell v={px(r.put?.bid ?? null)} itm={r.put?.itm} />
                <Cell v={px(r.put?.ask ?? null)} itm={r.put?.itm} />
                <Cell v={iv(r.put?.iv ?? null)} itm={r.put?.itm} />
                <Cell v={big(r.put?.vol ?? null)} itm={r.put?.itm} />
                <Cell v={big(r.put?.oi ?? null)} itm={r.put?.itm} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#5b6478]">
        In-the-money contracts shaded · ATM row highlighted · OI = open interest · IV = implied volatility. Quotes via Yahoo (may be delayed).
      </p>
    </div>
  );
}

function Cell({ v, itm, bold }: { v: string; itm?: boolean; bold?: boolean }) {
  return (
    <td
      className={"px-2 py-1 text-right tabular-nums " + (bold ? "font-semibold text-[#e6e9f0] " : "text-[#aab2c5] ")}
      style={itm ? { background: "#1a2030" } : undefined}
    >
      {v}
    </td>
  );
}
