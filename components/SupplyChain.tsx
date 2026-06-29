"use client";
import { useState } from "react";
import Link from "next/link";

interface Node { name: string; ticker: string; note: string }
interface Chain { configured: boolean; available?: boolean; customers?: Node[]; suppliers?: Node[]; concentration?: string; readThrough?: string }

export default function SupplyChain({ symbol, name, universe }: { symbol: string; name?: string; universe: string }) {
  const [data, setData] = useState<Chain | "idle" | "loading">("idle");
  const run = () => {
    setData("loading");
    fetch(`/api/supply-chain/${encodeURIComponent(symbol)}?name=${encodeURIComponent(name || symbol)}`)
      .then((r) => r.json())
      .then((d: Chain) => setData(d))
      .catch(() => setData({ configured: true, available: false }));
  };
  const d = typeof data === "object" ? data : null;

  const NodeList = ({ title, nodes, color }: { title: string; nodes: Node[]; color: string }) => (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>{title}</div>
      <ul className="space-y-1.5">
        {nodes.map((nd, i) => (
          <li key={i} className="text-[12px] leading-snug">
            <span className="font-medium text-[var(--text)]">
              {nd.ticker ? <Link href={`/u/${universe}/stock/${encodeURIComponent(nd.ticker)}`} className="text-[var(--accent)] hover:underline">{nd.name}</Link> : nd.name}
              {nd.ticker && <span className="ml-1 font-mono text-[10px] text-[var(--text-4)]">{nd.ticker}</span>}
            </span>
            {nd.note && <span className="text-[var(--text-3)]"> — {nd.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[var(--text-2)]">Supply chain</span>
          <span className="ml-2 text-[11px] text-[var(--text-4)]">customers, suppliers &amp; read-throughs</span>
        </div>
        {data === "idle" && <button onClick={run} className="shrink-0 rounded-lg bg-[var(--accent-strong)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:opacity-90">Map the supply chain →</button>}
      </div>

      {data === "loading" && <div className="flex items-center gap-2 px-4 py-4 text-xs text-[var(--text-3)]"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" /> Mapping the value chain…</div>}
      {d && d.configured && d.available === false && <div className="px-4 py-4 text-xs text-[var(--text-3)]">Couldn&apos;t map the supply chain for this name.</div>}
      {d && d.configured === false && <div className="px-4 py-4 text-xs text-[var(--text-3)]">AI isn&apos;t configured.</div>}

      {d && d.available && (
        <div className="space-y-3 px-4 py-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {d.customers && d.customers.length > 0 && <NodeList title="Customers (downstream)" nodes={d.customers} color="#22c55e" />}
            {d.suppliers && d.suppliers.length > 0 && <NodeList title="Suppliers (upstream)" nodes={d.suppliers} color="#a78bfa" />}
          </div>
          {d.concentration && <p className="text-[12px] leading-snug"><span className="font-semibold text-[var(--text)]">Concentration </span><span className="text-[var(--text-2)]">{d.concentration}</span></p>}
          {d.readThrough && <p className="text-[12px] leading-snug"><span className="font-semibold text-[var(--text)]">Read-through </span><span className="text-[var(--text-2)]">{d.readThrough}</span></p>}
          <p className="text-[10px] text-[var(--text-4)]">AI-mapped from the company&apos;s known value chain — verify before relying on it. Not investment advice.</p>
        </div>
      )}
    </div>
  );
}
