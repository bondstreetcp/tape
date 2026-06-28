"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { StockRow } from "@/lib/types";
import { fmtPct, fmtMarketCap } from "@/lib/format";
import { currencyOf } from "@/lib/universes";
import AiCompare from "./AiCompare";
import { trendColor } from "@/lib/color";

interface Col {
  key: string;
  label: string;
  get: (s: StockRow) => number | string | null;
  fmt: (v: any) => string;
  color?: (v: any) => string | undefined;
  num: boolean;
  align: "left" | "right";
  median?: boolean; // include in the median row
}

const r1 = (v: any) => (v == null ? "—" : (v as number).toFixed(1));
const yld = (v: any) => (v == null ? "—" : `${((v as number) * 100).toFixed(2)}%`);

function median(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  if (!nums.length) return null;
  const m = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[m] : (nums[m - 1] + nums[m]) / 2;
}

export default function PeerComparison({
  universe,
  symbol,
  name,
  peers,
  peerGroup,
}: {
  universe: string;
  symbol: string;
  name: string;
  peers: StockRow[];
  peerGroup: string | null;
}) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState("cap");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const currency = currencyOf(universe);

  const columns: Col[] = useMemo(
    () => [
      { key: "symbol", label: "Symbol", get: (s) => s.symbol, fmt: (v) => v, num: false, align: "left" },
      { key: "name", label: "Name", get: (s) => s.name, fmt: (v) => v, num: false, align: "left" },
      { key: "cap", label: "Mkt Cap", get: (s) => s.marketCap, fmt: (v) => fmtMarketCap(v, currency), num: true, align: "right", median: true },
      { key: "ytd", label: "YTD", get: (s) => s.returns.ytd, fmt: (v) => fmtPct(v, 1), color: trendColor, num: true, align: "right", median: true },
      { key: "y1", label: "1Y", get: (s) => s.returns["1y"], fmt: (v) => fmtPct(v, 1), color: trendColor, num: true, align: "right", median: true },
      { key: "pe", label: "P/E", get: (s) => s.trailingPE ?? null, fmt: r1, num: true, align: "right", median: true },
      { key: "fpe", label: "Fwd P/E", get: (s) => s.forwardPE ?? null, fmt: r1, num: true, align: "right", median: true },
      { key: "pb", label: "P/B", get: (s) => s.priceToBook ?? null, fmt: r1, num: true, align: "right", median: true },
      { key: "yld", label: "Div Yld", get: (s) => s.dividendYield ?? null, fmt: yld, num: true, align: "right", median: true },
      { key: "high", label: "% fr High", get: (s) => s.pctFromHigh, fmt: (v) => fmtPct(v, 1), color: trendColor, num: true, align: "right", median: true },
    ],
    [currency],
  );

  const medians = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const c of columns) if (c.median) m[c.key] = median(peers.map((p) => c.get(p) as number | null));
    return m;
  }, [columns, peers]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey) ?? columns[0];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...peers].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (col.num) {
        const na = va as number | null;
        const nb = vb as number | null;
        if (na == null && nb == null) return 0;
        if (na == null) return 1;
        if (nb == null) return -1;
        return (na - nb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [peers, columns, sortKey, sortDir]);

  const onSort = (key: string, num: boolean) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(num ? "desc" : "asc");
    }
  };

  if (peers.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
        No peer data available.
      </div>
    );
  }

  return (
    <div>
      <AiCompare symbol={symbol} name={name} peers={peers} />
      <p className="mb-3 text-sm text-[var(--text-3)]">
        {symbol} vs {peers.length - 1} peers in{" "}
        <span className="text-[var(--text-2)]">{peerGroup}</span> · valuation &amp;
        performance from the snapshot · click a row to open
      </p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key, c.num)}
                  className={
                    "cursor-pointer select-none px-3 py-2 font-medium whitespace-nowrap hover:text-[var(--text)] " +
                    (c.align === "right" ? "text-right" : "text-left")
                  }
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1 text-[var(--accent)]">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--text-3)]">
              {columns.map((c, i) => (
                <td key={c.key} className={"px-3 py-1.5 whitespace-nowrap " + (c.align === "right" ? "text-right tabular-nums" : "text-left")}>
                  {i === 0 ? "Peer median" : c.median ? c.fmt(medians[c.key]) : ""}
                </td>
              ))}
            </tr>
            {sorted.map((s) => {
              const isCompany = s.symbol === symbol;
              return (
                <tr
                  key={s.symbol}
                  onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}/financials`)}
                  className={
                    "cursor-pointer border-b border-[var(--divider)] transition-colors hover:bg-[var(--surface-hover)] " +
                    (isCompany ? "bg-[var(--surface-3)]" : "")
                  }
                >
                  {columns.map((c) => {
                    const v = c.get(s);
                    return (
                      <td
                        key={c.key}
                        className={
                          "px-3 py-1.5 whitespace-nowrap " +
                          (c.align === "right" ? "text-right tabular-nums " : "text-left ") +
                          (c.key === "symbol" ? "font-mono font-semibold " : c.key === "name" ? "max-w-[14rem] truncate text-[var(--text-2)] " : "") +
                          (isCompany ? "text-[#93c5fd]" : "")
                        }
                        style={c.color && !isCompany ? { color: c.color(v) } : undefined}
                      >
                        {c.key === "symbol" && isCompany ? `★ ${c.fmt(v)}` : c.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
