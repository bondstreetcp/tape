"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OptionsFlow, FlowEntry } from "@/lib/optionsFlow";
import { fmtDateTime } from "@/lib/format";

const prem = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
const num = (v: number) => v.toLocaleString("en-US");
const expLabel = (e: string | null, dte: number | null) => {
  if (!e) return "—";
  const d = new Date(e + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return dte != null ? `${d} · ${dte}d` : d;
};

type SortKey = "premium" | "vol" | "volOI";

export default function FlowView({ flow, universe }: { flow: OptionsFlow; universe: string }) {
  const router = useRouter();
  const [type, setType] = useState<"all" | "call" | "put">("all");
  const [unusualOnly, setUnusualOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("premium");

  const rows = useMemo(() => {
    let r = flow.entries.filter((e) => (type === "all" || e.type === type) && (!unusualOnly || e.unusual));
    r = [...r].sort((a, b) => {
      if (sort === "premium") return b.premium - a.premium;
      if (sort === "vol") return b.vol - a.vol;
      return (b.volOI ?? 0) - (a.volOI ?? 0);
    });
    return r.slice(0, 120);
  }, [flow.entries, type, unusualOnly, sort]);

  const total = flow.callPremium + flow.putPremium;
  const callPct = total > 0 ? (flow.callPremium / total) * 100 : 50;
  const sentiment = callPct >= 60 ? { t: "Call-heavy — bullish flow", c: "#22c55e" } : callPct <= 40 ? { t: "Put-heavy — bearish/hedging flow", c: "#ef4444" } : { t: "Balanced flow", c: "var(--text-2)" };

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Options Flow</h1>
        <p className="mt-1 text-xs text-[var(--text-3)]">
          Largest options trades across the S&amp;P 500 by premium · {flow.totalFlows.toLocaleString()} unusual flows from {flow.withOptions} optionable names · as of {fmtDateTime(flow.generatedAt)}
        </p>
      </header>

      {/* call vs put sentiment */}
      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold" style={{ color: sentiment.c }}>{sentiment.t}</span>
          <span className="text-[var(--text-3)]">
            <span className="text-[#22c55e]">Calls {prem(flow.callPremium)}</span> · <span className="text-[#ef4444]">Puts {prem(flow.putPremium)}</span>
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--bg)]">
          <div className="bg-[#22c55e]" style={{ width: `${callPct}%` }} />
          <div className="bg-[#ef4444]" style={{ width: `${100 - callPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--text-4)]">
          <span>{callPct.toFixed(0)}% calls</span>
          <span>{(100 - callPct).toFixed(0)}% puts</span>
        </div>
      </section>

      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {(["all", "call", "put"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={"rounded-md px-2.5 py-1 capitalize transition-colors " + (type === t ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>
              {t === "all" ? "All" : t + "s"}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-3)]">
          <input type="checkbox" checked={unusualOnly} onChange={(e) => setUnusualOnly(e.target.checked)} className="accent-[#f59e0b]" />
          Unusual only (vol &gt; OI)
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--text-3)]">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm outline-none">
            <option value="premium">Premium $</option>
            <option value="vol">Volume</option>
            <option value="volOI">Vol / OI</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="text-[var(--text-3)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-3 py-2 text-left font-medium">Ticker</th>
              <th className="px-3 py-2 text-center font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Strike</th>
              <th className="px-3 py-2 text-left font-medium">Expiry</th>
              <th className="px-3 py-2 text-right font-medium">Volume</th>
              <th className="px-3 py-2 text-right font-medium">OI</th>
              <th className="px-3 py-2 text-right font-medium">Vol/OI</th>
              <th className="px-3 py-2 text-right font-medium">Premium</th>
              <th className="px-3 py-2 text-right font-medium">IV</th>
              <th className="px-3 py-2 text-right font-medium">Underlying</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <Row key={i} e={e} onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(e.symbol)}?tab=options`)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Premium = today&apos;s contract volume × mid price × 100 (dollar value traded). <span className="font-semibold text-[#f59e0b]">Amber Vol/OI</span> = volume exceeded open interest (new positioning). Front-expiry chains via Yahoo; refresh with <span className="font-mono">npm run refresh-flow</span>.
      </p>
    </main>
  );
}

function Row({ e, onClick }: { e: FlowEntry; onClick: () => void }) {
  const up = (e.chgPct ?? 0) >= 0;
  return (
    <tr onClick={onClick} className="cursor-pointer border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
      <td className="px-3 py-1.5">
        <span className="font-mono font-semibold">{e.symbol}</span>
        <span className="ml-2 hidden text-[11px] text-[var(--text-4)] lg:inline">{e.name.slice(0, 22)}</span>
      </td>
      <td className="px-3 py-1.5 text-center">
        <span className={"rounded px-1.5 py-0.5 text-[11px] font-semibold " + (e.type === "call" ? "bg-[#22c55e]/15 text-[#22c55e]" : "bg-[#ef4444]/15 text-[#ef4444]")}>
          {e.type.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{e.strike}</td>
      <td className="px-3 py-1.5 text-left text-[var(--text-2)]">{expLabel(e.expiry, e.dte)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{num(e.vol)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-3)]">{num(e.oi)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={e.unusual ? { color: "#f59e0b", fontWeight: 600 } : undefined} title={e.unusual ? "Volume exceeds open interest" : undefined}>
        {e.volOI == null ? "—" : `${e.volOI.toFixed(1)}×`}
      </td>
      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{prem(e.premium)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-3)]">{e.iv == null ? "—" : `${(e.iv * 100).toFixed(0)}%`}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {e.underlying == null ? "—" : `$${e.underlying.toFixed(2)}`}
        {e.chgPct != null && <span className="ml-1 text-[11px]" style={{ color: up ? "#22c55e" : "#ef4444" }}>{up ? "+" : ""}{e.chgPct.toFixed(1)}%</span>}
      </td>
    </tr>
  );
}
