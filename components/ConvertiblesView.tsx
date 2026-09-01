"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { convertibleValue, volEdge, convertCarry, convertVolFromPrice, type ConvertiblesData, type ConvertibleTerms, type ConvertibleRow } from "@/lib/convertible";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const R = 0.04;
const DAY = 86_400_000;
type Sort = "filed" | "edge" | "size";

// Convertible & Capped-Call Watch — recent convertible-note issuance with the vol-desk read: the implied
// ISSUE vol vs the stock's listed IV (the long-convert / short-stock cheapness signal), live moneyness,
// and the conversion-price + capped-call-cap dilution levels. Built on lib/convertible (component model).
export default function ConvertiblesView({ universe, data }: { universe: string; data: ConvertiblesData }) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<Sort>("filed");
  const [cheapOnly, setCheapOnly] = useState(false);
  const [q, setQ] = useState("");
  const [face, setFace] = useState(100000); // convertible position (face $) — sizes the short-stock hedge
  const [expanded, setExpanded] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({}); // observed convert prices you enter (per 100), by CUSIP/ticker
  const [book, setBook] = useState<Record<string, number>>({}); // sleeve: held converts (key → face $)
  const [now] = useState(() => Date.now()); // mount-stable clock — keeps the rows/sleeve memos from recomputing every render (time-to-maturity doesn't meaningfully move within a session)
  useEffect(() => {
    try {
      const f = Number(localStorage.getItem("tape.convFace")); if (f > 0) setFace(f);
      const m = JSON.parse(localStorage.getItem("tape.convMarks") || "{}"); if (m && typeof m === "object") setMarks(m);
      const b = JSON.parse(localStorage.getItem("tape.convBook") || "{}");
      if (b && typeof b === "object") {
        // Prune holds for converts no longer in the scan (aged past the 180d window) so a stale key can't
        // linger un-removable in localStorage or silently drop from the sleeve. Skip when rows are empty
        // (a failed / cache-miss load) so we never wipe a book we simply couldn't match. Mirrors holdKeyOf.
        const valid = new Set(data.rows.map((r) => r.cusip || r.ticker || r.filingUrl + r.ticker));
        const clean = data.rows.length ? (Object.fromEntries(Object.entries(b).filter(([k]) => valid.has(k))) as Record<string, number>) : (b as Record<string, number>);
        setBook(clean);
        if (data.rows.length && Object.keys(clean).length !== Object.keys(b).length) { try { localStorage.setItem("tape.convBook", JSON.stringify(clean)); } catch { /* ignore */ } }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: reconcile against the initially-loaded rows; re-running on data changes would clobber in-session face/marks edits
  }, []);
  const setMark = (k: string, v: string) => setMarks((prev) => { const n = { ...prev, [k]: v }; try { localStorage.setItem("tape.convMarks", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const persistBook = (n: Record<string, number>) => { setBook(n); try { localStorage.setItem("tape.convBook", JSON.stringify(n)); } catch { /* ignore */ } };
  const toggleHold = (k: string) => persistBook((() => { const n = { ...book }; if (n[k] != null) delete n[k]; else n[k] = face; return n; })());

  const symKey = useMemo(() => [...new Set(data.rows.map((r) => r.ticker).filter(Boolean))].sort().join(","), [data.rows]);
  useEffect(() => {
    if (!symKey) return;
    let alive = true;
    fetch(`/api/quote?symbols=${encodeURIComponent(symKey)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; const m: Record<string, number> = {}; for (const qq of d.quotes || []) if (qq?.symbol && typeof qq.price === "number") m[String(qq.symbol).toUpperCase()] = qq.price; setPrices(m); })
      .catch(() => { /* live parity degrades to the issue reference price */ });
    return () => { alive = false; };
  }, [symKey]);

  const rows = useMemo(() => {
    const enriched = data.rows.map((r) => {
      const S = (r.ticker && prices[r.ticker]) || r.refPrice || null;
      const my = r.maturity ? Math.max(0.05, (Date.parse(r.maturity) - now) / (365.25 * DAY)) : r.maturityYears;
      const vol = r.listedIV ?? r.issueVol ?? 0.5; // value/delta at the more current listed IV where we have it
      const terms: ConvertibleTerms = { ticker: r.ticker, conversionPrice: r.conversionPrice, coupon: r.coupon, maturityYears: my, par: r.par, refPrice: r.refPrice, premium: r.premium };
      const live = S && my > 0 ? convertibleValue(terms, S, vol, R, r.creditSpread, r.dividendYield ?? 0) : null;
      const edge = r.issueVol != null && r.listedIV != null ? volEdge(r.issueVol, r.listedIV) : null;
      // Carry: coupon collected − (borrow fee + dividend) on the short, scaled by the hedge notional.
      const hedgeFrac = live && S ? (live.delta * S) / r.par : null;
      const carry = r.borrowFee != null && hedgeFrac != null ? convertCarry(r.coupon, hedgeFrac, r.borrowFee, r.dividendYield ?? 0) : null;
      return { r, S, live, edge, carry };
    });
    const ql = q.trim().toLowerCase();
    const out = enriched.filter((x) => {
      if (cheapOnly && x.edge?.verdict !== "cheap") return false;
      if (ql && !x.r.ticker.toLowerCase().includes(ql) && !x.r.issuer.toLowerCase().includes(ql)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "edge") return (a.edge?.ratio ?? 99) - (b.edge?.ratio ?? 99); // cheapest issue-vol/listed first
      if (sort === "size") return (b.r.sizeMM ?? 0) - (a.r.sizeMM ?? 0);
      return b.r.filedDate.localeCompare(a.r.filedDate);
    });
    return out;
  }, [data.rows, prices, sort, cheapOnly, q, now]);

  // Sleeve aggregation — the held positions (any filter), their book-level greeks + the drawdown stress.
  const holdKeyOf = (r: ConvertibleRow) => r.cusip || r.ticker || r.filingUrl + r.ticker;
  const sleeve = useMemo(() => {
    const held = data.rows.filter((r) => book[holdKeyOf(r)] != null);
    if (!held.length) return null;
    let notional = 0, shortUsd = 0, shortShares = 0, vega = 0, carry = 0, softNotional = 0, creditPnl = 0, priced = 0;
    for (const r of held) {
      const face = book[holdKeyOf(r)];
      const S = (r.ticker && prices[r.ticker]) || r.refPrice || null;
      const my = r.maturity ? Math.max(0.05, (Date.parse(r.maturity) - now) / (365.25 * DAY)) : r.maturityYears;
      const vol = r.listedIV ?? r.issueVol ?? 0.5;
      const terms: ConvertibleTerms = { ticker: r.ticker, conversionPrice: r.conversionPrice, coupon: r.coupon, maturityYears: my, par: r.par, refPrice: r.refPrice, premium: r.premium };
      const live = S && my > 0 ? convertibleValue(terms, S, vol, R, r.creditSpread, r.dividendYield ?? 0) : null;
      if (!live || !S) continue; // can't price → excluded from every book figure below (the "N priced" caption flags the gap)
      priced++;
      notional += face;
      if (r.credit && (r.credit.tier === "soft" || r.credit.tier === "distressed")) softNotional += face;
      const bonds = r.par > 0 ? face / r.par : 0;
      shortShares += bonds * live.delta;
      shortUsd += bonds * live.delta * S;
      vega += bonds * live.vega;
      const c = r.borrowFee != null ? convertCarry(r.coupon, (live.delta * S) / r.par, r.borrowFee, r.dividendYield ?? 0) : null;
      if (c) carry += c.net * face;
      creditPnl -= bonds * live.bondFloor * Math.min(my, 8) * 0.01; // +100bp × duration (capped) — bond floor falls
    }
    const volDownPnl = vega * -5; // vol −5 pts: long vega loses
    return { count: held.length, priced, notional, shortUsd, shortShares, vega, carry, softNotional, volDownPnl, creditPnl, stressPnl: volDownPnl + creditPnl };
  }, [data.rows, book, prices, now]);

  const cheapN = data.rows.filter((r) => r.issueVol != null && r.listedIV != null && volEdge(r.issueVol, r.listedIV).verdict === "cheap").length;
  const cappedN = data.rows.filter((r) => r.cappedCallCap != null).length;
  const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
  const usd = (x: number | null | undefined, d = 0) => (x == null ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: d })}`);
  const edgeColor = (v: "cheap" | "fair" | "rich") => (v === "cheap" ? "#22c55e" : v === "rich" ? "#ef4444" : "var(--text-3)");
  // Borrow tightness from the annualized fee (%). IB floor ~0.25% = general collateral (easy).
  const borrowTier = (feePct: number) => (feePct >= 20 ? { label: "very HTB", color: "#ef4444" } : feePct >= 5 ? { label: "HTB", color: "#f59e0b" } : feePct >= 1 ? { label: "moderate", color: "var(--text-2)" } : { label: "easy", color: "#22c55e" });
  const creditMeta = (t: "solid" | "adequate" | "soft" | "distressed") => (t === "solid" ? { c: "#22c55e" } : t === "adequate" ? { c: "var(--text-2)" } : t === "soft" ? { c: "#f59e0b" } : { c: "#ef4444" });
  const SortTh = ({ k, children, cls = "" }: { k: Sort; children: React.ReactNode; cls?: string }) => (
    <th className={"px-2 py-2 font-medium " + cls}><button onClick={() => setSort(k)} className={"hover:text-[var(--text)] " + (sort === k ? "text-[var(--text)]" : "")}>{children}{sort === k ? " ↓" : ""}</button></th>
  );

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Convertible &amp; Capped-Call Watch</h1>
          <p className="mt-1 max-w-4xl text-[13px] text-[var(--text-3)]">
            Recent convertible-note issuance — the AI/tech capex is being funded here. The vol read: the <b>implied issue vol</b> <InfoDot text="The vol the convertible priced its embedded equity call at — backed out from the note pricing at par at issue, using a component model (bond floor + call) with an ESTIMATED credit spread. The cheap/rich-vs-listed read is far more robust than the absolute level." /> the note priced at vs the stock&apos;s <b>listed option IV</b> — converts issued <b style={{ color: "#22c55e" }}>below</b> listed vol are the classic long-convert / short-stock edge. Plus the conversion-price &amp; <b>capped-call cap</b> <InfoDot text="Many issuers buy a capped call / call spread alongside the notes to raise the effective conversion price and cap dilution. The cap is a real level — the dealers who sold it sit short gamma up there." /> dilution levels. {cheapN} cheap-vs-listed · {cappedN} with a capped call · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {sleeve && (
        <div className="mb-4 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)", background: "var(--surface)" }}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold">Your convert sleeve <span className="text-[11px] font-normal text-[var(--text-4)]">· {sleeve.count} position{sleeve.count > 1 ? "s" : ""}{sleeve.priced < sleeve.count ? ` · ${sleeve.priced} priced` : ""}</span></span>
            <button onClick={() => persistBook({})} className="text-[11px] text-[var(--text-4)] hover:text-[var(--text-2)]">clear</button>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
            <div><div className="text-[11px] text-[var(--text-4)]">Notional</div><div className="font-mono text-[15px] font-semibold text-[var(--text)]">${(sleeve.notional / 1e6).toFixed(1)}M</div></div>
            <div><div className="text-[11px] text-[var(--text-4)]">Short hedge</div><div className="font-mono text-[15px] font-semibold text-[#ef4444]">${(sleeve.shortUsd / 1e6).toFixed(1)}M</div><div className="text-[10px] text-[var(--text-4)]">{Math.round(sleeve.shortShares).toLocaleString()} sh</div></div>
            <div><div className="text-[11px] text-[var(--text-4)]" title="$ P&L per +1 vol point — you're long the embedded calls">Net vega</div><div className="font-mono text-[15px] font-semibold text-[#22c55e]">+${Math.round(sleeve.vega).toLocaleString()}<span className="text-[10px] font-normal text-[var(--text-4)]">/vol pt</span></div></div>
            <div><div className="text-[11px] text-[var(--text-4)]">Carry</div><div className="font-mono text-[15px] font-semibold" style={{ color: sleeve.carry >= 0 ? "#22c55e" : "#ef4444" }}>{sleeve.carry >= 0 ? "+" : "−"}${Math.abs(Math.round(sleeve.carry)).toLocaleString()}<span className="text-[10px] font-normal text-[var(--text-4)]">/yr</span></div></div>
            <div><div className="text-[11px] text-[var(--text-4)]" title="Share of notional in soft/distressed-credit issuers — a weak-floor concentration">Soft credit</div><div className="font-mono text-[15px] font-semibold" style={{ color: sleeve.notional > 0 && sleeve.softNotional / sleeve.notional > 0.3 ? "#f59e0b" : "var(--text-2)" }}>{sleeve.notional > 0 ? Math.round((sleeve.softNotional / sleeve.notional) * 100) : 0}%</div></div>
            <div className="min-w-[240px] rounded-lg bg-[var(--surface-2)] px-3 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Stress · vol −5 / credit +100bp</div>
              <div className="font-mono text-[15px] font-semibold text-[#ef4444]">−${Math.abs(Math.round(sleeve.stressPnl)).toLocaleString()}</div>
              <div className="text-[10px] text-[var(--text-4)]">vega −${Math.abs(Math.round(sleeve.volDownPnl)).toLocaleString()} + credit −${Math.abs(Math.round(sleeve.creditPnl)).toLocaleString()} — the classic convert-arb drawdown</div>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-4)]">Delta-hedged → net equity delta ≈ 0 (the short offsets it); you&apos;re long vega + gamma, paid by carry, exposed to credit. A sector selloff hits these together (credit widens + vol spikes + stocks fall) — the drawdown. Model-based; the ＋/✓ on each row adds/removes at your position size.</p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text-2)]" title="Only notes whose implied issue vol is below the stock's listed option vol">
          <input type="checkbox" checked={cheapOnly} onChange={(e) => setCheapOnly(e.target.checked)} /> cheap vs listed only
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or issuer…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]" title="Your convertible position in face value — sizes the short-stock hedge in the table and per-row detail">Position $<input type="number" step={10000} value={face} onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setFace(v); try { localStorage.setItem("tape.convFace", String(v)); } catch { /* ignore */ } }} className="w-28 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-right tabular-nums outline-none" /></label>
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} notes · click a row for the hedge</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Terms are LLM-extracted from the offering 8-K/424B; the issue vol is a component-model back-out with an <b>estimated</b> credit spread (softest input — the cheap/rich signal is more robust than the level). There is no live convertible price feed, so this is the issue-vol read, <b>not</b> a live arb spread. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[1480px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Issuer</th>
              <SortTh k="filed">Priced</SortTh>
              <SortTh k="size" cls="text-right">Size</SortTh>
              <th className="px-2 py-2 text-right font-medium">Coupon</th>
              <th className="px-2 py-2 text-right font-medium">Conv. price</th>
              <th className="px-2 py-2 text-right font-medium" title="Conversion premium above the reference price at issue">Prem.</th>
              <th className="px-2 py-2 text-right font-medium" title="Implied vol the note priced at (component-model back-out)">Issue vol</th>
              <th className="px-2 py-2 text-right font-medium" title="Stock's current listed ATM option IV">Listed IV</th>
              <SortTh k="edge">Edge</SortTh>
              <th className="px-2 py-2 text-right font-medium" title="Conversion value (ratio × current price) as % of par — where the note sits now">Parity</th>
              <th className="px-2 py-2 text-right font-medium" title="Delta — shares to short per $1,000 bond to stay delta-neutral (hover a row for equity-sensitivity)">Δ /bond</th>
              <th className="px-2 py-2 text-right font-medium" title="Shares to short for your position (face ÷ par × delta), and the dollar short">Short hedge</th>
              <th className="px-2 py-2 text-right font-medium" title="Annualized stock-borrow fee on the short leg — HTB names cost a lot to short and can be recalled">Borrow</th>
              <th className="px-2 py-2 text-right font-medium" title="Net carry % of notional: coupon − (borrow fee + dividend) × hedge fraction. Negative = the position bleeds while you wait">Carry</th>
              <th className="px-2 py-2 text-right font-medium" title="Issuer credit-quality proxy — how solid the bond floor is (net cash/debt, cash runway, leverage). Soft/distressed = the floor can fall on credit, not just the stock">Credit</th>
              <th className="px-2 py-2 text-right font-medium" title="Capped-call cap — the effective dilution ceiling the issuer bought">Capped cap</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, S, live, edge, carry }) => {
              const key = r.filingUrl + r.ticker;
              const open = expanded === key;
              const bonds = r.par > 0 ? face / r.par : 0;
              const shortSh = live && S ? bonds * live.delta : null;
              const shortUsd = shortSh != null && S ? shortSh * S : null;
              return (
              <Fragment key={key}>
              <tr onClick={() => setExpanded(open ? null : key)} className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <span className="mr-1 inline-block w-2 text-[10px] text-[var(--text-4)]">{open ? "▾" : "▸"}</span>
                  {r.ticker ? <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-[var(--accent)] hover:underline">{r.ticker}</Link> : <span className="font-semibold text-[var(--text-2)]">{r.issuer.slice(0, 18)}</span>}
                  <div className="max-w-[190px] truncate text-[11px] text-[var(--text-4)]">{r.issuer}</div>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-[12px] text-[var(--text-3)]">{r.filedDate}<div className="text-[10px] text-[var(--text-4)]">{r.maturity ? `→ ${r.maturity.slice(0, 7)}` : `${r.maturityYears.toFixed(1)}y`}</div></td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{r.sizeMM != null ? (r.sizeMM >= 1000 ? `$${(r.sizeMM / 1000).toFixed(2)}B` : `$${r.sizeMM.toFixed(0)}M`) : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{pct(r.coupon, 2)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{usd(r.conversionPrice, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{r.premium != null ? pct(r.premium, 0) : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold text-[var(--text-2)]">{pct(r.issueVol)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{pct(r.listedIV)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: edge ? edgeColor(edge.verdict) : "var(--text-4)" }} title={edge ? `issue vol ${(edge.ratio).toFixed(2)}× listed` : "listed IV not available for this name"}>{edge ? edge.verdict : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: live ? (live.moneyness === "in-the-money" ? "#22c55e" : live.moneyness === "busted" ? "#60a5fa" : "var(--text-2)") : "var(--text-4)" }} title={live ? `${live.moneyness}${S ? ` · at $${S.toFixed(2)}` : ""}` : undefined}>{live ? `${Math.round((live.parity / r.par) * 100)}%` : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]" title={live ? `~${Math.round(live.equitySensitivity * 100)}% equity-like · Γ ${live.gamma.toFixed(2)} sh/bond per $1` : undefined}>{live ? live.delta.toFixed(2) : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[#ef4444]">{shortSh != null ? <span title={`short ${Math.round(shortSh).toLocaleString()} sh @ $${(S as number).toFixed(2)}`}>{Math.round(shortSh).toLocaleString()}<div className="text-[10px] text-[var(--text-4)]">{usd(shortUsd)}</div></span> : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.borrowFee != null ? (() => { const feePct = r.borrowFee * 100; const t = borrowTier(feePct); return <span style={{ color: t.color }} title={`${t.label}${r.borrowAvailable != null ? ` · ${r.borrowAvailable.toLocaleString()} sh available` : ""}${r.borrowStale ? " · stale" : ""}`}>{feePct < 1 ? feePct.toFixed(2) : feePct.toFixed(1)}%</span>; })() : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: carry == null ? "var(--text-4)" : carry.net >= 0 ? "#22c55e" : "#ef4444" }} title={carry ? `coupon +${(carry.couponYield * 100).toFixed(1)}% − borrow ${(carry.borrowDrag * 100).toFixed(1)}%${carry.divDrag > 0 ? ` − div ${(carry.divDrag * 100).toFixed(1)}%` : ""}` : "needs borrow + a live price"}>{carry ? `${carry.net >= 0 ? "+" : ""}${(carry.net * 100).toFixed(1)}%` : "—"}</td>
                <td className="px-2 py-2 text-right text-[12px] font-medium">{r.credit ? <span style={{ color: creditMeta(r.credit.tier).c }} title={`${r.credit.netDebt != null ? (r.credit.netDebt < 0 ? "net cash" : "net debt $" + (r.credit.netDebt / 1e9).toFixed(1) + "B") : "debt n/a"}${r.credit.runwayYears != null ? ` · ${r.credit.runwayYears.toFixed(1)}y runway` : r.credit.burning ? " · burning" : " · FCF+"}`}>{r.credit.tier}</span> : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.cappedCallCap != null ? "#a855f7" : "var(--text-4)" }} title={r.cappedCallCap != null ? "Effective dilution ceiling from the issuer's capped call — dealers who sold it are short gamma here" : "no capped call disclosed"}>{r.cappedCallCap != null ? usd(r.cappedCallCap, 0) : "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap text-right text-[11px]">
                  <button onClick={(e) => { e.stopPropagation(); toggleHold(r.cusip || r.ticker || key); }} className={"mr-2 " + (book[r.cusip || r.ticker || key] != null ? "font-semibold text-[#22c55e]" : "text-[var(--text-4)] hover:text-[var(--text-2)]")} title={book[r.cusip || r.ticker || key] != null ? "In your sleeve — click to remove" : "Add to your sleeve at your position size"}>{book[r.cusip || r.ticker || key] != null ? "✓ held" : "+ hold"}</button>
                  {r.ticker && <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}?tab=options`} onClick={(e) => e.stopPropagation()} className="text-[var(--accent)] hover:underline" title="Options & gamma on the underlying">options</Link>}
                  <a href={r.filingUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-2 text-[var(--text-4)] hover:text-[var(--text-2)]" title="The offering filing">8-K</a>
                </td>
              </tr>
              {open && (
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <td colSpan={17} className="px-4 py-3">
                    {live && S ? (
                      <>
                      <div className="grid gap-x-8 gap-y-3 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">The delta hedge</div>
                          <div className="mt-1 text-[13px] text-[var(--text-2)]">Long <b>{Math.round(bonds).toLocaleString()}</b> bonds ({usd(face)} face) → short <b className="text-[#ef4444]">{Math.round(shortSh as number).toLocaleString()} shares</b> ({usd(shortUsd)}).</div>
                          <div className="mt-1 text-[11px] text-[var(--text-4)]">Δ <b>{live.delta.toFixed(2)}</b> sh/bond neutralizes the convert&apos;s equity sensitivity (~{Math.round(live.equitySensitivity * 100)}% at ${(S as number).toFixed(2)}). Rebalance the short as the stock moves.</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Gamma — the engine</div>
                          <div className="mt-1 text-[13px] text-[var(--text-2)]">Γ <b>{(bonds * live.gamma).toFixed(1)}</b> sh per $1 move · a ±1% move shifts the hedge ~<b>{Math.round(bonds * live.gamma * (S as number) * 0.01).toLocaleString()}</b> sh (buy low / sell high).</div>
                          <div className="mt-1 text-[11px] text-[var(--text-4)]">You&apos;re long that gamma; the vol edge pays for it — issue {pct(r.issueVol)} vs listed {pct(r.listedIV)}{edge ? ` (${edge.verdict})` : ""}.</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">The note</div>
                          <div className="mt-1 text-[13px] text-[var(--text-3)]">Bond floor ~{Math.round((live.bondFloor / r.par) * 100)}% of par · parity {Math.round((live.parity / r.par) * 100)}% · {live.moneyness}. Conv ${r.conversionPrice}{r.cappedCallCap != null ? ` · capped to $${r.cappedCallCap}` : ""}.</div>
                          <div className="mt-1 text-[11px] text-[var(--text-4)]">Credit spread est. {pct(r.creditSpread, 1)} (softest input). No live convert price — the hedge is model-based, so treat share counts as a guide.</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Carry &amp; borrow</div>
                          {carry ? (
                            <>
                              <div className="mt-1 text-[13px]" style={{ color: carry.net >= 0 ? "#22c55e" : "#ef4444" }}>Net carry <b>{carry.net >= 0 ? "+" : ""}{(carry.net * 100).toFixed(1)}%</b>/yr <span className="text-[11px] text-[var(--text-4)]">= coupon +{(carry.couponYield * 100).toFixed(1)}% − borrow {(carry.borrowDrag * 100).toFixed(1)}%{carry.divDrag > 0 ? ` − div ${(carry.divDrag * 100).toFixed(1)}%` : ""}</span></div>
                              <div className="mt-1 text-[11px] text-[var(--text-4)]">Borrow fee {r.borrowFee != null ? (r.borrowFee * 100).toFixed(2) + "%" : "—"}{r.borrowFee != null && r.borrowFee * 100 >= 5 ? <b className="text-[#f59e0b]"> — hard to borrow; confirm the locate &amp; recall risk before shorting</b> : ""}{r.borrowAvailable != null ? ` · ${r.borrowAvailable.toLocaleString()} sh available` : ""}.{carry.net < 0 ? " Negative carry — you bleed waiting for convergence." : ""}</div>
                            </>
                          ) : <div className="mt-1 text-[11px] text-[var(--text-4)]">No borrow data for this name yet (populates nightly); carry needs the borrow fee + a live price.</div>}
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Bond-floor credit</div>
                          {r.credit ? (() => {
                            const cr = r.credit;
                            const my = r.maturity ? (Date.parse(r.maturity) - now) / (365.25 * DAY) : r.maturityYears;
                            const refiRisk = cr.runwayYears != null && cr.runwayYears < my;
                            return (
                              <>
                                <div className="mt-1 text-[13px]"><b style={{ color: creditMeta(cr.tier).c }}>{cr.tier}</b> <span className="text-[11px] text-[var(--text-4)]">{cr.netDebt != null ? (cr.netDebt < 0 ? `net cash $${(Math.abs(cr.netDebt) / 1e9).toFixed(1)}B` : `net debt $${(cr.netDebt / 1e9).toFixed(1)}B`) : "debt n/a"}{cr.ndToMcap != null ? ` · ${cr.ndToMcap.toFixed(2)}× mkt cap` : ""}{cr.burning ? (cr.runwayYears != null ? ` · ${cr.runwayYears.toFixed(1)}y cash runway` : " · burning cash") : " · FCF-positive"}</span></div>
                                <div className="mt-1 text-[11px] text-[var(--text-4)]">{refiRisk ? <b className="text-[#f59e0b]">Runway ({(cr.runwayYears as number).toFixed(1)}y) &lt; maturity ({my.toFixed(1)}y) — refinancing risk; the floor leans on capital-markets access.</b> : "The bond floor is your downside protection — a weaker credit lets it fall on credit, not just the stock."}</div>
                              </>
                            );
                          })() : <div className="mt-1 text-[11px] text-[var(--text-4)]">No issuer credit data yet (populates nightly).</div>}
                        </div>
                      </div>
                      <div className="mt-3 border-t border-[var(--divider)] pt-2" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const markKey = r.cusip || r.ticker || key;
                          const markStr = marks[markKey] ?? "";
                          const obsPct = markStr && Number(markStr) > 0 ? Number(markStr) : null;
                          const modelPct = (live.value / r.par) * 100;
                          const richCheap = obsPct != null ? obsPct - modelPct : null;
                          const my2 = r.maturity ? Math.max(0.05, (Date.parse(r.maturity) - now) / (365.25 * DAY)) : r.maturityYears;
                          const terms2: ConvertibleTerms = { ticker: r.ticker, conversionPrice: r.conversionPrice, coupon: r.coupon, maturityYears: my2, par: r.par, refPrice: r.refPrice, premium: r.premium };
                          const mktVol = obsPct != null ? convertVolFromPrice(terms2, S as number, (obsPct / 100) * r.par, R, r.creditSpread, r.dividendYield ?? 0) : null;
                          return (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Live mark</span>
                              {r.cusip ? <span className="font-mono text-[11px] text-[var(--text-3)]">CUSIP {r.cusip} <a href={`https://www.google.com/search?q=${encodeURIComponent(r.cusip + " bond price trace")}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">look up ↗</a></span> : <span className="text-[11px] text-[var(--text-4)]">CUSIP not disclosed — look it up by issuer + coupon</span>}
                              <label className="flex items-center gap-1 text-[var(--text-3)]">price <input type="number" step={0.5} value={markStr} onChange={(e) => setMark(markKey, e.target.value)} placeholder={modelPct.toFixed(1)} className="w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-right tabular-nums outline-none" /><span className="text-[10px] text-[var(--text-4)]">/100</span></label>
                              {obsPct != null ? (
                                <>
                                  <span style={{ color: (richCheap as number) <= 0 ? "#22c55e" : "#ef4444" }}><b>{(richCheap as number) >= 0 ? "+" : ""}{(richCheap as number).toFixed(1)} pts</b> vs model ({modelPct.toFixed(1)}) — {(richCheap as number) <= 0 ? "cheap (the arb)" : "rich"}</span>
                                  {mktVol != null && r.listedIV != null && <span className="text-[var(--text-3)]">market vol <b style={{ color: mktVol < r.listedIV ? "#22c55e" : "var(--text-2)" }}>{(mktVol * 100).toFixed(0)}%</b> vs listed {(r.listedIV * 100).toFixed(0)}%</span>}
                                </>
                              ) : <span className="text-[11px] text-[var(--text-4)]">enter the observed price for the live rich/cheap + market-implied vol</span>}
                            </div>
                          );
                        })()}
                      </div>
                      </>
                    ) : <div className="text-[12px] text-[var(--text-4)]">No live price for {r.ticker || r.issuer} — can&apos;t size the hedge (conversion price ${r.conversionPrice}, {r.maturity ?? `${r.maturityYears.toFixed(1)}y`}).</div>}
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={17} className="px-3 py-8 text-center text-[var(--text-4)]">{data.rows.length ? "No notes match." : "No convertible issuance ingested yet — the nightly scan populates this."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
