"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CefData, Cef, CefGroup } from "@/lib/cef";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const GROUPS: ("All" | CefGroup)[] = ["All", "Fixed Income", "Alternatives", "Equity", "Allocation", "Other"];
const REGIONS: ("All" | "US" | "UK")[] = ["All", "US", "UK"];
const pc = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "" : ""}${v.toFixed(d)}%`);
const sx = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const curSym = (c: string) => (c === "GBP" ? "£" : c === "USD" ? "$" : c === "EUR" ? "€" : `${c} `);
const money = (v: number, c: string) => `${curSym(c)}${v.toFixed(2)}`;
const capf = (m: number | null, c: string) => (m == null ? "—" : `${curSym(c)}${m >= 1000 ? `${(m / 1000).toFixed(1)}B` : `${m.toFixed(0)}M`}`);
// discount (negative) = cheap = green; premium (positive) = rich = red
const discColor = (d: number) => (d <= -0.5 ? "#22c55e" : d >= 0.5 ? "#ef4444" : "var(--text-3)");
const zColor = (z: number | null) => (z == null ? "var(--text-3)" : z <= -1 ? "#22c55e" : z >= 1 ? "#ef4444" : "var(--text-3)");

type SortKey = "discount" | "z1y" | "distRate" | "leverage" | "mktCapM" | "disc52w" | "ticker";
interface Col { id: string; label: string; align: "left" | "right"; sort?: SortKey; get: (f: Cef) => number | string | null; render: (f: Cef) => React.ReactNode; }

export default function CefScreenerView({ universe, data }: { universe: string; data: CefData }) {
  const [region, setRegion] = useState<"All" | "US" | "UK">("All");
  const [group, setGroup] = useState<"All" | CefGroup>("All");
  const [cat, setCat] = useState<string>("All");
  const [q, setQ] = useState("");
  const [minDisc, setMinDisc] = useState(0); // show funds at >= this discount (0 = all)
  const [stretched, setStretched] = useState(false); // z1y <= -1
  const [sort, setSort] = useState<SortKey>("discount");
  const [dir, setDir] = useState<1 | -1>(1); // 1 = asc (most-discounted first for `discount`)

  const inGroup = useMemo(
    () => data.funds.filter((f) => (region === "All" || f.region === region) && (group === "All" || f.group === group)),
    [data.funds, group, region],
  );

  // "which asset class is out of favor" — per-category averages within the active group
  const catStats = useMemo(() => {
    const m = new Map<string, { n: number; disc: number; z: number; zc: number; yld: number; yc: number }>();
    for (const f of inGroup) {
      const e = m.get(f.category) || { n: 0, disc: 0, z: 0, zc: 0, yld: 0, yc: 0 };
      e.n++; e.disc += f.discount;
      if (f.z1y != null) { e.z += f.z1y; e.zc++; }
      if (f.distRate != null) { e.yld += f.distRate; e.yc++; }
      m.set(f.category, e);
    }
    return [...m.entries()]
      .map(([category, e]) => ({ category, n: e.n, avgDisc: e.disc / e.n, avgZ: e.zc ? e.z / e.zc : null, avgYld: e.yc ? e.yld / e.yc : null }))
      .sort((a, b) => a.avgDisc - b.avgDisc);
  }, [inGroup]);

  const cats = useMemo(() => ["All", ...catStats.map((c) => c.category)], [catStats]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = inGroup.filter((f) => {
      if (cat !== "All" && f.category !== cat) return false;
      if (ql && !f.ticker.toLowerCase().includes(ql) && !f.name.toLowerCase().includes(ql)) return false;
      if (minDisc > 0 && !(f.discount <= -minDisc)) return false;
      if (stretched && !(f.z1y != null && f.z1y <= -1)) return false;
      return true;
    });
    const col = COLS.find((c) => c.sort === sort)!;
    r = [...r].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * dir;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
    return r;
  }, [inGroup, cat, q, minDisc, stretched, sort, dir]);

  const onSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(k === "ticker" ? 1 : k === "distRate" || k === "mktCapM" ? -1 : 1); }
  };

  return (
    <main className="mx-auto max-w-[88rem] px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">Closed-End Fund Screener</h1>
        <p className="mt-1 text-xs text-[var(--text-3)]">
          {data.funds.length} closed-end funds &amp; investment trusts (US + UK) · hunting discounts to NAV (price below the value of the assets) ·
          data from <a href="https://www.cefconnect.com" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">CEF Connect</a> &amp; <a href="https://www.theaic.co.uk" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">Morningstar/AIC</a>
        </p>
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {REGIONS.map((r) => (
            <button key={r} onClick={() => setRegion(r)}
              className={"rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " + (region === r ? "bg-[#7c3aed] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{r === "All" ? "US + UK" : r}</button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {GROUPS.map((g) => (
            <button key={g} onClick={() => { setGroup(g); setCat("All"); }}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (group === g ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{g}</button>
          ))}
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs outline-none">
          {cats.map((c) => <option key={c} value={c}>{c === "All" ? "All categories" : c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name…" className="w-40 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
          Min discount
          <select value={minDisc} onChange={(e) => setMinDisc(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs outline-none">
            {[0, 5, 10, 15, 20].map((v) => <option key={v} value={v}>{v === 0 ? "any" : `${v}%+`}</option>)}
          </select>
        </label>
        <button onClick={() => setStretched((s) => !s)} title="Discount at least 1 std wider than the fund's own 1-yr norm"
          className={"rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors " + (stretched ? "border-[#22c55e]/50 bg-[#22c55e]/10 text-[#22c55e]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")}>
          Stretched vs history (z ≤ −1)
        </button>
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} funds</span>
      </div>

      {/* which asset class is out of favor */}
      {catStats.length > 1 && (
        <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text-2)]">Average discount by asset class — which is out of favor</div>
          <div className="flex gap-2 overflow-x-auto p-3">
            {catStats.slice(0, 10).map((c) => (
              <button key={c.category} onClick={() => setCat(c.category === cat ? "All" : c.category)}
                className={"shrink-0 rounded-lg border px-3 py-2 text-left transition-colors " + (cat === c.category ? "border-[#2563eb] bg-[var(--surface-hover)]" : "border-[var(--border)] hover:bg-[var(--surface-hover)]")}>
                <div className="text-[11px] text-[var(--text-3)]">{c.category}</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-base font-semibold tabular-nums" style={{ color: discColor(c.avgDisc) }}>{c.avgDisc.toFixed(1)}%</span>
                  <span className="text-[10px] text-[var(--text-4)]">{c.n} funds · z {sx(c.avgZ)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* fund table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              {COLS.map((c) => (
                <th key={c.id} onClick={() => c.sort && onSort(c.sort)}
                  className={"select-none whitespace-nowrap px-3 py-2 font-medium " + (c.sort ? "cursor-pointer hover:text-[var(--text)] " : "") + (c.align === "right" ? "text-right" : "text-left")}>
                  {c.label}{c.sort && sort === c.sort && <span className="ml-0.5 text-[#60a5fa]">{dir === 1 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={`${f.region}:${f.ticker}`} className="border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
                {COLS.map((c) => (
                  <td key={c.id} className={"whitespace-nowrap px-3 py-1.5 " + (c.align === "right" ? "text-right tabular-nums" : "text-left")}>
                    {c.render(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No funds match these filters.</div>}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Discount = price vs NAV (negative = trading below asset value). Z-score = how far today&apos;s discount sits from the fund&apos;s own trailing-1yr average (≤ −1 = unusually cheap). UK investment-trust NAV is derived from the published premium/discount; the z-score and leverage columns are US-only for now. Prices shown in each fund&apos;s native currency. Distribution rates aren&apos;t guaranteed and can include return of capital. Not investment advice.
      </p>
    </main>
  );
}

const COLS: Col[] = [
  { id: "ticker", label: "Ticker", align: "left", sort: "ticker", get: (f) => f.ticker, render: (f) => <a href={f.region === "UK" ? `https://finance.yahoo.com/quote/${encodeURIComponent(f.ticker)}.L` : `https://www.cefconnect.com/fund/${f.ticker}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-[#60a5fa] hover:underline">{f.ticker}</a> },
  { id: "region", label: "Mkt", align: "left", get: (f) => f.region, render: (f) => <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + (f.region === "US" ? "bg-[#2563eb]/15 text-[#60a5fa]" : "bg-[#7c3aed]/15 text-[#a78bfa]")}>{f.region}</span> },
  { id: "name", label: "Name", align: "left", get: (f) => f.name, render: (f) => <span className="block max-w-[14rem] truncate text-[var(--text-2)]" title={f.name}>{f.name}</span> },
  { id: "category", label: "Category", align: "left", get: (f) => f.category, render: (f) => <span className="text-xs text-[var(--text-3)]">{f.category}</span> },
  { id: "discount", label: "Disc/Prem", align: "right", sort: "discount", get: (f) => f.discount, render: (f) => <span className="font-semibold" style={{ color: discColor(f.discount) }}>{f.discount >= 0 ? "+" : ""}{f.discount.toFixed(1)}%</span> },
  { id: "z1y", label: "Z 1Y", align: "right", sort: "z1y", get: (f) => f.z1y, render: (f) => <span style={{ color: zColor(f.z1y) }}>{sx(f.z1y)}</span> },
  { id: "disc52w", label: "52w Avg", align: "right", sort: "disc52w", get: (f) => f.disc52w, render: (f) => <span className="text-[var(--text-3)]">{pc(f.disc52w)}</span> },
  { id: "distRate", label: "Distr Yld", align: "right", sort: "distRate", get: (f) => f.distRate, render: (f) => <span className="text-[var(--text)]">{pc(f.distRate)}</span> },
  { id: "leverage", label: "Lev", align: "right", sort: "leverage", get: (f) => f.leverage, render: (f) => <span className="text-[var(--text-3)]">{pc(f.leverage, 0)}</span> },
  { id: "price", label: "Price", align: "right", get: (f) => f.price, render: (f) => <span className="text-[var(--text-3)]">{money(f.price, f.currency)}</span> },
  { id: "nav", label: "NAV", align: "right", get: (f) => f.nav, render: (f) => <span className="text-[var(--text-3)]">{money(f.nav, f.currency)}</span> },
  { id: "mktcap", label: "Mkt Cap", align: "right", sort: "mktCapM", get: (f) => f.mktCapM, render: (f) => <span className="text-[var(--text-3)]">{capf(f.mktCapM, f.currency)}</span> },
];
