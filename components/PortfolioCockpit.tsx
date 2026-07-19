"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { computePortfolio, scenarioPnL, parsePositions, mergePositions, stressScenarios, type NameData } from "@/lib/portfolio";
import { computeFactorTilts, computeCrowding, FACTOR_META, type FactorKey, type PairCorr } from "@/lib/factors";
import { computePortfolioRisk, type AlignedReturns } from "@/lib/portfolioRisk";
import { buildHedge } from "@/lib/hedge";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import UniverseSwitcher from "./UniverseSwitcher";
import MyBookTabs from "./MyBookTabs";
import InfoDot from "./InfoDot";

const STORE_KEY = "tape.portfolio.positions";
const AUM_KEY = "tape.portfolio.aum"; // account equity — persisted apart from the book
const BASIS_KEY = "tape.portfolio.basis"; // "$" | "%"
const WHATIF_KEY = "tape.portfolio.whatif"; // proposed trades (delta book) for the what-if sim
const EXAMPLE = `AAPL 100
MSFT 60
NVDA 40
JPM 80
XOM 120
KO 200
# shorts are negative
TSLA -50`;

const money = (n: number): string => {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const signMoney = (n: number): string => (n > 0 ? "+" : "") + money(n);
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const px = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
// Exposure as a % of account equity (AUM). Signed like its $ counterpart; |frac|×100.
const pctAum = (frac: number | null | undefined, signed: boolean): string =>
  frac == null ? "—" : `${signed ? (frac >= 0 ? "+" : "−") : ""}${Math.abs(frac * 100).toFixed(0)}%`;
const ymd = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

const SHOCKS = [-10, -5, -2, 2, 5, 10];
const pos = (n: number) => n >= 0;

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-4)]">{sub}</div>}
    </div>
  );
}

export default function PortfolioCockpit({ universe }: { universe: string }) {
  const [text, setText] = useState("");
  const [tf, setTf] = useState<TimeframeKey>("ytd");
  const [resp, setResp] = useState<{ data: Record<string, NameData>; missing: string[]; asOf: string | null }>({ data: {}, missing: [], asOf: null });
  const [loading, setLoading] = useState(false);
  const [shock, setShock] = useState(-5);
  const [aumText, setAumText] = useState(""); // account equity ($); blank = read in dollars
  const [showPct, setShowPct] = useState(false); // $ vs % of AUM
  const [whatIf, setWhatIf] = useState(false); // show the what-if trade panel
  const [whatIfText, setWhatIfText] = useState(""); // proposed trades (SYMBOL SHARES; signed)

  // Restore saved book + equity + basis on mount; persist each on edit after.
  const hydrated = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY); if (raw != null) setText(raw);
      const savedAum = localStorage.getItem(AUM_KEY); if (savedAum != null) setAumText(savedAum);
      setShowPct(localStorage.getItem(BASIS_KEY) === "%");
      const savedWi = localStorage.getItem(WHATIF_KEY); if (savedWi) { setWhatIfText(savedWi); setWhatIf(true); }
    } catch { /* ignore */ }
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(WHATIF_KEY, whatIfText); } catch { /* ignore */ }
  }, [whatIfText]);
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(STORE_KEY, text); } catch { /* ignore */ }
  }, [text]);
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(AUM_KEY, aumText); } catch { /* ignore */ }
  }, [aumText]);
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(BASIS_KEY, showPct ? "%" : "$"); } catch { /* ignore */ }
  }, [showPct]);

  const positions = useMemo(() => parsePositions(text), [text]);
  const whatIfPositions = useMemo(() => parsePositions(whatIfText), [whatIfText]);
  const afterPositions = useMemo(() => mergePositions(positions, whatIfPositions), [positions, whatIfPositions]);
  const whatIfActive = whatIf && whatIfPositions.length > 0;
  // Fetch price/beta/series for the UNION of current + proposed names, so the after-book prices and
  // its predicted risk are fully computable even for a brand-new hedge instrument.
  const symbolsKey = useMemo(
    () => [...new Set([...positions, ...whatIfPositions].map((p) => p.symbol))].sort().join(","),
    [positions, whatIfPositions],
  );

  // Debounced fetch of per-name price/sector/beta/return whenever the book (or timeframe) changes.
  useEffect(() => {
    if (!symbolsKey) { setResp({ data: {}, missing: [], asOf: null }); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/portfolio?symbols=${encodeURIComponent(symbolsKey)}&tf=${tf}`).then((x) => x.json());
        if (!cancelled) setResp({ data: r.data || {}, missing: r.missing || [], asOf: r.asOf || null });
      } catch { if (!cancelled) setResp({ data: {}, missing: [], asOf: null }); }
      if (!cancelled) setLoading(false);
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [symbolsKey, tf]);

  const dataMap = useMemo(() => new Map(Object.entries(resp.data)), [resp.data]);
  const aum = useMemo(() => {
    const n = Number(aumText.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [aumText]);
  const stats = useMemo(() => computePortfolio(positions, dataMap, aum), [positions, dataMap, aum]);
  const statsAfter = useMemo(() => computePortfolio(afterPositions, dataMap, aum), [afterPositions, dataMap, aum]);
  const hasBook = stats.holdings.length > 0;
  const effN = stats.concentration.hhi > 0 ? 1 / stats.concentration.hhi : 0; // effective # of names
  const netPctGross = stats.gross ? (stats.net / stats.gross) * 100 : 0;
  const ep = stats.exposurePct;
  const pctMode = showPct && ep != null; // % view is only active with a usable AUM
  // A stat card's value: % of AUM in pct-mode, else dollars (signed where it matters).
  const cardVal = (dollar: number | null, frac: number | null | undefined, signed: boolean): string =>
    pctMode ? pctAum(frac, signed) : dollar == null ? "—" : signed ? signMoney(dollar) : money(dollar);

  // --- Risk decomposition (factor tilts + correlation) — a heavier, separately-fetched read. ---
  // Send priced names ordered by |exposure| desc (holdings are pre-sorted) so if the server caps the
  // list it keeps the most material positions; fall back to the raw symbol set before prices load.
  const riskSymbolsKey = useMemo(() => {
    const syms = new Set<string>([...stats.holdings, ...statsAfter.holdings].map((h) => h.symbol));
    return syms.size ? [...syms].sort().join(",") : symbolsKey;
  }, [stats.holdings, statsAfter.holdings, symbolsKey]);
  const [risk, setRisk] = useState<{ factors: Record<string, Record<FactorKey, number | null>>; corr: PairCorr[]; aligned: AlignedReturns | null; cappedFrom: number | null; cap: number | null }>({ factors: {}, corr: [], aligned: null, cappedFrom: null, cap: null });
  const [riskLoading, setRiskLoading] = useState(false);
  useEffect(() => {
    if (!riskSymbolsKey) { setRisk({ factors: {}, corr: [], aligned: null, cappedFrom: null, cap: null }); return; }
    let cancelled = false;
    setRiskLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/portfolio/risk?symbols=${encodeURIComponent(riskSymbolsKey)}`).then((x) => x.json());
        if (!cancelled) setRisk({ factors: r.factors || {}, corr: r.corr || [], aligned: r.aligned ?? null, cappedFrom: r.cappedFrom ?? null, cap: r.cap ?? null });
      } catch { if (!cancelled) setRisk({ factors: {}, corr: [], aligned: null, cappedFrom: null, cap: null }); }
      if (!cancelled) setRiskLoading(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [riskSymbolsKey]);

  const tilts = useMemo(
    () => computeFactorTilts(stats.holdings.map((h) => ({ value: h.value, factors: risk.factors[h.symbol] }))),
    [stats.holdings, risk.factors],
  );
  const crowding = useMemo(
    () => computeCrowding(stats.holdings.map((h) => ({ symbol: h.symbol, value: h.value })), risk.corr),
    [stats.holdings, risk.corr],
  );
  const anyFactor = tilts.some((t) => t.coverage > 0);

  // --- Predicted risk from the holdings' own return history (client-side; sizes never leave the browser). ---
  const portRisk = useMemo(
    () => (risk.aligned ? computePortfolioRisk(stats.holdings.map((h) => ({ symbol: h.symbol, value: h.value })), risk.aligned, { aum }) : null),
    [stats.holdings, risk.aligned, aum],
  );
  const riskBase = aum ?? stats.gross; // % denominator for the risk figures (AUM if set, else gross)
  const pctOf = (d: number): string => (riskBase ? `${((d / riskBase) * 100).toFixed(1)}% of ${aum ? "AUM" : "gross"}` : "");
  const riskContribOf = useMemo(() => new Map((portRisk?.contributions ?? []).map((c) => [c.symbol, c.pctRisk])), [portRisk]);

  // --- What-if: the after-trade book's risk + factor tilts (for the before → after comparison). ---
  const portRiskAfter = useMemo(
    () => (whatIfActive && risk.aligned ? computePortfolioRisk(statsAfter.holdings.map((h) => ({ symbol: h.symbol, value: h.value })), risk.aligned, { aum }) : null),
    [whatIfActive, statsAfter.holdings, risk.aligned, aum],
  );
  const tiltsAfter = useMemo(
    () => computeFactorTilts(statsAfter.holdings.map((h) => ({ value: h.value, factors: risk.factors[h.symbol] }))),
    [statsAfter.holdings, risk.factors],
  );
  const momentumOf = (ts: { key: FactorKey; tilt: number }[]) => ts.find((t) => t.key === "momentum")?.tilt ?? 0;
  const cmpRows = useMemo(() => {
    if (!whatIfActive) return [] as { label: string; before: string; after: string; delta: string; color: string }[];
    const rows: { label: string; before: string; after: string; delta: string; color: string }[] = [];
    const push = (label: string, b: number, a: number, fmt: (x: number) => string, lowerSafer: boolean | null) => {
      const d = a - b;
      const color = Math.abs(d) < 1e-9 || lowerSafer == null ? "var(--text-3)"
        : lowerSafer ? (d < 0 ? "#22c55e" : "#ef4444") : (d < 0 ? "#ef4444" : "#22c55e");
      rows.push({ label, before: fmt(b), after: fmt(a), delta: (d >= 0 ? "+" : "−") + fmt(Math.abs(d)), color });
    };
    push("Gross", stats.gross, statsAfter.gross, money, true);
    push("Net", stats.net, statsAfter.net, (x) => money(x), null);
    push("Beta-adj net", stats.betaDollar ?? 0, statsAfter.betaDollar ?? 0, (x) => money(x), null);
    if (portRisk && portRiskAfter) {
      push("Predicted vol (ann.)", portRisk.volAnnDollar, portRiskAfter.volAnnDollar, money, true);
      push("VaR 95% (1d)", portRisk.var95Dollar, portRiskAfter.var95Dollar, money, true);
    }
    push("Top-name conc.", stats.concentration.top1, statsAfter.concentration.top1, (x) => `${(x * 100).toFixed(0)}%`, true);
    push("Momentum tilt", momentumOf(tilts), momentumOf(tiltsAfter), (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}σ`, null);
    return rows;
  }, [whatIfActive, stats, statsAfter, portRisk, portRiskAfter, tilts, tiltsAfter]);

  // --- Suggested hedge basket: flatten market β (exact) + the largest style tilts (first-order). ---
  const hedge = useMemo(() => buildHedge(tilts, stats.betaDollar, stats.gross), [tilts, stats.betaDollar, stats.gross]);
  const stress = useMemo(() => stressScenarios(stats), [stats]);

  const uni = UNIVERSE_BY_ID[universe];

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uni?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Portfolio Risk Cockpit</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Type your book (one <span className="font-mono">SYMBOL SHARES</span> per line; negatives = shorts) and get live <b>gross/net exposure</b> <InfoDot term="Gross exposure" />, <b>sector tilts</b>, <b>concentration</b> <InfoDot term="HHI concentration" />, portfolio <b>beta</b> <InfoDot term="Beta" />, and a <b>market-shock</b> P&amp;L. Nothing leaves your browser — the book is saved locally.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <MyBookTabs universe={universe} current="/portfolio" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ---- Input ---- */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold">Your positions</span>
              <div className="flex gap-1.5 text-[11px]">
                <button onClick={() => setText(EXAMPLE)} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-3)] hover:text-[var(--text)]">Example</button>
                <button onClick={() => setText("")} className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-3)] hover:text-[var(--text)]">Clear</button>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={"AAPL 100\nMSFT 60\nTSLA -50   (short)"}
              className="h-56 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 font-mono text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-4)] focus:border-[var(--accent)]/60"
            />
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--text-4)]">
              <span>{positions.length ? `${positions.length} position${positions.length === 1 ? "" : "s"}` : "one SYMBOL SHARES per line"}</span>
              {loading && <span>pricing…</span>}
            </div>
            {resp.missing.length > 0 && (
              <p className="mt-1.5 text-[11px] text-[#f59e0b]">Not found (US names only): {resp.missing.join(", ")}</p>
            )}
            <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
              <label className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[var(--text-3)]">Account equity</span>
                <span className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg)] focus-within:border-[var(--accent)]/60">
                  <span className="pl-2 text-[12px] text-[var(--text-4)]">$</span>
                  <input
                    value={aumText}
                    onChange={(e) => setAumText(e.target.value)}
                    inputMode="decimal"
                    placeholder="250,000"
                    aria-label="Account equity in dollars"
                    className="w-24 bg-transparent px-1.5 py-1 text-right font-mono text-[13px] tabular-nums outline-none placeholder:text-[var(--text-4)]"
                  />
                </span>
              </label>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-4)]">
                The divisor for % of AUM (net market value + cash). Add cash your broker file doesn&apos;t print. Leave blank to read the book in dollars.
              </p>
            </div>
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-[var(--text-4)]">
            Prices from the latest US snapshot; betas are 5-yr weekly-equivalent vs the S&amp;P 500. International tickers aren&apos;t priced here. Research tool, not advice.
          </p>
          <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <button onClick={() => setWhatIf((v) => !v)} className="flex w-full items-center justify-between text-[13px] font-semibold">
              <span>What-if · simulate trades</span>
              <span className="text-[var(--text-4)]">{whatIf ? "▾" : "▸"}</span>
            </button>
            {whatIf && (
              <>
                <textarea
                  value={whatIfText}
                  onChange={(e) => setWhatIfText(e.target.value)}
                  spellCheck={false}
                  placeholder={"NVDA 50   buy\nSPY -100  short a hedge\nAAPL -50  trim"}
                  className="mt-2 h-24 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 font-mono text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-4)] focus:border-[var(--accent)]/60"
                />
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-4)]">
                  Same <span className="font-mono">SYMBOL SHARES</span> format — signed deltas (buy +, trim/short −). A before → after comparison appears on the right; new names get priced too.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ---- Analytics ---- */}
        <div>
          {!hasBook ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
              Enter positions on the left (or hit <button onClick={() => setText(EXAMPLE)} className="text-[var(--accent)] underline">Example</button>) to see exposure, concentration, beta &amp; a market-shock scenario.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Exposure summary */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">Exposure</span>
                  <div className="flex items-center gap-2">
                    {pctMode && <span className="text-[11px] text-[var(--text-4)]">% of {money(stats.aum!)} equity</span>}
                    <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-[11px] font-semibold">
                      <button onClick={() => setShowPct(false)}
                        className={`px-2 py-0.5 ${!showPct ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text-4)] hover:text-[var(--text-2)]"}`}>$</button>
                      <button onClick={() => setShowPct(true)} disabled={!aum}
                        title={aum ? "Show as % of account equity" : "Enter account equity below to enable"}
                        className={`border-l border-[var(--border)] px-2 py-0.5 ${pctMode ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text-4)] hover:text-[var(--text-2)]"} disabled:cursor-not-allowed disabled:opacity-40`}>% AUM</button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                  <Stat label="Gross" value={cardVal(stats.gross, ep?.gross, false)} sub="Σ |value|" />
                  <Stat label="Net" value={cardVal(stats.net, ep?.net, true)} sub={`${pct(netPctGross, 0)} of gross`} color={pos(stats.net) ? "#22c55e" : "#ef4444"} />
                  <Stat label="Long" value={cardVal(stats.longValue, ep?.long, false)} color="#22c55e" />
                  <Stat label="Short" value={cardVal(stats.shortValue, ep?.short, true)} color="#ef4444" />
                  <Stat label="Beta-adj net" value={cardVal(stats.betaDollar, ep?.betaAdj, true)} sub="Σ value·β" color={stats.betaDollar != null && stats.betaDollar < 0 ? "#ef4444" : undefined} />
                  <Stat label="Net β" value={stats.beta == null ? "—" : stats.beta.toFixed(2)} sub={stats.betaCoverage < 0.999 ? `${Math.round(stats.betaCoverage * 100)}% covered` : "per $ gross"} color={stats.beta != null && stats.beta < 0 ? "#ef4444" : undefined} />
                  <Stat label={`Return (${tf.toUpperCase()})`} value={pct(stats.ret)} color={stats.ret == null ? undefined : pos(stats.ret) ? "#22c55e" : "#ef4444"} />
                </div>
              </div>

              {/* What-if: before → after */}
              {whatIfActive && (
                <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--surface)] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-semibold">What-if <span className="text-[11px] font-normal text-[var(--text-4)]">— {whatIfPositions.length} trade{whatIfPositions.length === 1 ? "" : "s"}, before → after</span></span>
                    <button onClick={() => setWhatIfText("")} className="text-[11px] text-[var(--text-4)] hover:text-[var(--text-2)]">reset</button>
                  </div>
                  <table className="w-full text-[12px]">
                    <thead className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                      <tr><th className="py-1 text-left font-medium">Metric</th><th className="text-right font-medium">Before</th><th className="text-right font-medium">After</th><th className="pl-3 text-right font-medium">Δ</th></tr>
                    </thead>
                    <tbody>
                      {cmpRows.map((r) => (
                        <tr key={r.label} className="border-t border-[var(--border)]">
                          <td className="py-1 text-[var(--text-3)]">{r.label}</td>
                          <td className="text-right font-mono tabular-nums text-[var(--text-3)]">{r.before}</td>
                          <td className="text-right font-mono tabular-nums text-[var(--text-2)]">{r.after}</td>
                          <td className="pl-3 text-right font-mono tabular-nums" style={{ color: r.color }}>{r.delta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {portRisk && !portRiskAfter && (
                    <p className="mt-2 text-[11px] text-[var(--text-4)]">Predicted vol / VaR after the trade update once the new name&apos;s history loads.</p>
                  )}
                  {statsAfter.missing.filter((m) => !stats.missing.includes(m)).length > 0 && (
                    <p className="mt-1 text-[11px] text-[#f59e0b]">Proposed name not priced: {statsAfter.missing.filter((m) => !stats.missing.includes(m)).join(", ")}</p>
                  )}
                </div>
              )}

              {/* Predicted risk — from the holdings' own return history */}
              {portRisk && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">Predicted risk</span>
                    <span className="text-[11px] text-[var(--text-4)]">
                      {riskLoading ? "measuring…" : `historical sim · ${portRisk.nDays}d${portRisk.coverage < 0.999 ? ` · ${Math.round(portRisk.coverage * 100)}% covered` : ""}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                    <Stat label="Volatility (ann.)" value={portRisk.volAnnPct != null ? pct(portRisk.volAnnPct * 100, 0) : money(portRisk.volAnnDollar)} sub={`${money(portRisk.volAnnDollar)}/yr`} />
                    <Stat label="VaR 95% (1d)" value={money(portRisk.var95Dollar)} sub={pctOf(portRisk.var95Dollar)} color="#ef4444" />
                    <Stat label="VaR 99% (1d)" value={money(portRisk.var99Dollar)} sub={pctOf(portRisk.var99Dollar)} color="#ef4444" />
                    <Stat label="Exp. shortfall" value={money(portRisk.es95Dollar)} sub="avg worst 5%" color="#ef4444" />
                    <Stat label="Worst day" value={signMoney(portRisk.worstDayDollar)} sub={portRisk.worstDayDate ? ymd(portRisk.worstDayDate) : "—"} color="#ef4444" />
                    <Stat label="Diversification" value={pct(portRisk.diversificationBenefit * 100, 0)} sub="risk cut vs lockstep" color="#22c55e" />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
                    Applies the last {portRisk.nDays} trading days of your holdings&apos; joint returns to today&apos;s book. VaR = the loss a 1‑in‑20 (95%) / 1‑in‑100 (99%) day wouldn&apos;t exceed; shortfall = the average of the worst 5% of days. {aum ? "% figures are of account equity." : "Add account equity for % figures (now % of gross)."}
                  </p>
                </div>
              )}

              {/* Market-shock scenario */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">Market-shock scenario <InfoDot term="Beta" /></span>
                  <span className="text-[11px] text-[var(--text-4)]">estimated via Σ position·β·move</span>
                </div>
                {(() => {
                  const r = scenarioPnL(stats, shock);
                  const c = pos(r.dollar) ? "#22c55e" : "#ef4444";
                  return (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm text-[var(--text-3)]">If the S&amp;P moves</span>
                        <span className="font-mono text-lg font-semibold tabular-nums" style={{ color: pos(shock) ? "#22c55e" : "#ef4444" }}>{shock > 0 ? "+" : ""}{shock}%</span>
                        <span className="text-sm text-[var(--text-3)]">→ your book</span>
                        <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: c }}>{signMoney(r.dollar)}</span>
                        <span className="font-mono text-sm tabular-nums" style={{ color: c }}>({pctMode ? pctAum(r.dollar / stats.aum!, true) : pct(r.pct)})</span>
                      </div>
                      <input
                        type="range" min={-15} max={15} step={0.5} value={shock}
                        onChange={(e) => setShock(Number(e.target.value))}
                        className="mt-3 w-full accent-[var(--accent)]"
                      />
                      <div className="mt-2 grid grid-cols-6 gap-1.5">
                        {SHOCKS.map((s) => {
                          const d = scenarioPnL(stats, s).dollar;
                          return (
                            <button key={s} onClick={() => setShock(s)}
                              className={`rounded-md border px-1 py-1.5 text-center transition-colors ${s === shock ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] hover:border-[var(--border-strong)]"}`}>
                              <div className="font-mono text-[11px] font-semibold" style={{ color: pos(s) ? "#22c55e" : "#ef4444" }}>{s > 0 ? "+" : ""}{s}%</div>
                              <div className="font-mono text-[11px] tabular-nums" style={{ color: pos(d) ? "#22c55e" : "#ef4444" }}>{signMoney(d)}</div>
                            </button>
                          );
                        })}
                      </div>
                      {stats.betaCoverage < 0.999 && (
                        <p className="mt-2 text-[11px] text-[var(--text-4)]">Covers the {Math.round(stats.betaCoverage * 100)}% of gross with a known beta; unbetaed names contribute $0.</p>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Historical stress */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-semibold">Historical stress</span>
                  <span className="text-[11px] text-[var(--text-4)]">beta-propagated · first-order</span>
                </div>
                <div className="grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
                  {stress.map((s) => (
                    <div key={s.name} className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] py-1" title={s.note}>
                      <span className="text-[12px] text-[var(--text-3)]">{s.name} <span className="text-[10px] text-[var(--text-4)]">{s.marketMovePct > 0 ? "+" : ""}{s.marketMovePct}%</span></span>
                      <span className="whitespace-nowrap text-right font-mono text-[12px] tabular-nums" style={{ color: s.dollar >= 0 ? "#22c55e" : "#ef4444" }}>
                        {signMoney(s.dollar)}{riskBase ? <span className="ml-1 text-[10px] text-[var(--text-4)]">{((s.dollar / riskBase) * 100).toFixed(0)}%</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
                  Each holding&apos;s beta applied to the index move{stats.betaCoverage < 0.999 ? ` (${Math.round(stats.betaCoverage * 100)}% of gross has a beta)` : ""}; % is of {aum ? "AUM" : "gross"}. Real crises expand betas and rotate factors, so treat these as a first-order guide, not a forecast.
                </p>
              </div>

              {/* Sector tilts + concentration */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="mb-2 text-[13px] font-semibold">Sector exposure <span className="text-[11px] font-normal text-[var(--text-4)]">(net, % of gross)</span></div>
                  <div className="space-y-1.5">
                    {stats.bySector.map((s) => {
                      const w = s.weight * 100;
                      return (
                        <div key={s.sector} className="flex items-center gap-2 text-[12px]">
                          <span className="w-28 shrink-0 truncate text-[var(--text-3)]" title={s.sector}>{s.sector}</span>
                          <div className="relative h-4 flex-1 rounded bg-[var(--bg)]">
                            <div className="absolute top-0 h-4 rounded" style={{ background: pos(w) ? "#22c55e" : "#ef4444", opacity: 0.7, width: `${Math.min(100, Math.abs(w))}%`, left: pos(w) ? "50%" : undefined, right: pos(w) ? undefined : "50%" }} />
                            <div className="absolute left-1/2 top-0 h-4 w-px bg-[var(--border-strong)]" />
                          </div>
                          <span className="w-14 shrink-0 text-right font-mono tabular-nums" style={{ color: pos(w) ? "#22c55e" : "#ef4444" }}>{pct(w, 0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="mb-2 text-[13px] font-semibold">Concentration <InfoDot term="HHI concentration" /></div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="font-mono text-lg font-semibold tabular-nums">{pct(stats.concentration.top1 * 100, 0)}</div><div className="text-[11px] text-[var(--text-4)]">top name</div></div>
                    <div><div className="font-mono text-lg font-semibold tabular-nums">{pct(stats.concentration.top5 * 100, 0)}</div><div className="text-[11px] text-[var(--text-4)]">top 5</div></div>
                    <div><div className="font-mono text-lg font-semibold tabular-nums">{effN ? effN.toFixed(1) : "—"}</div><div className="text-[11px] text-[var(--text-4)]">eff. # names</div></div>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">
                    &ldquo;Effective # names&rdquo; = 1/HHI — a book this concentrated behaves like {effN ? effN.toFixed(1) : "—"} equal-weight positions. Fractions of gross exposure.
                  </p>
                </div>
              </div>

              {/* Risk decomposition: factor tilts + crowding + hedge */}
              {risk.cappedFrom && (
                <p className="rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-2 text-[12px] text-[#f59e0b]">
                  Factor tilts &amp; crowding cover your {risk.cap} largest positions — your book has {risk.cappedFrom} names. (Exposure, beta &amp; the shock scenario above still cover the whole book.)
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Factor tilts */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[13px] font-semibold">Factor tilts <InfoDot term="Factor tilt" /></span>
                    <span className="text-[11px] text-[var(--text-4)]">{riskLoading ? "scoring…" : "σ vs Russell 1000"}</span>
                  </div>
                  {!anyFactor ? (
                    <p className="py-6 text-center text-[12px] text-[var(--text-4)]">{riskLoading ? "Scoring the book against the universe…" : "No US names to score — factor tilts cover US holdings only."}</p>
                  ) : (
                    <div className="space-y-1">
                      {tilts.map((t) => {
                        const meta = FACTOR_META.find((f) => f.key === t.key)!;
                        const w = Math.min(50, (Math.abs(t.tilt) / 2.5) * 50); // ±2.5σ = full half-width
                        const c = t.tilt >= 0 ? "var(--accent)" : "#f59e0b";
                        const faded = t.coverage < 0.001;
                        return (
                          <div key={t.key} className={`flex items-center gap-2 text-[12px] ${faded ? "opacity-40" : ""}`} title={meta.hint + (t.coverage < 0.999 && t.coverage > 0 ? ` · ${Math.round(t.coverage * 100)}% covered` : "")}>
                            <span className="w-20 shrink-0 text-[var(--text-3)]">{t.label}</span>
                            <div className="relative h-4 flex-1 rounded bg-[var(--bg)]">
                              <div className="absolute top-0 h-4 rounded" style={{ background: c, opacity: 0.75, width: `${w}%`, left: t.tilt >= 0 ? "50%" : `${50 - w}%` }} />
                              <div className="absolute left-1/2 top-0 h-4 w-px bg-[var(--border-strong)]" />
                            </div>
                            <span className="w-12 shrink-0 text-right font-mono tabular-nums" style={{ color: faded ? "var(--text-4)" : c }}>{faded ? "—" : `${t.tilt >= 0 ? "+" : ""}${t.tilt.toFixed(2)}`}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
                    Gross-weighted, short-aware exposure of the book to each factor, in standard deviations vs the Russell 1000. +σ = tilted toward that factor; a long/short book nets. Bars fade when a factor isn&apos;t covered.
                  </p>
                </div>

                {/* Crowding / correlation + hedge */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] font-semibold">Crowding <InfoDot term="Crowding" /></span>
                      <span className="text-[11px] text-[var(--text-4)]">daily-return correlation</span>
                    </div>
                    {crowding.avgCorr == null ? (
                      <p className="py-4 text-center text-[12px] text-[var(--text-4)]">{riskLoading ? "Correlating holdings…" : "Need ≥2 US names with price history to read crowding."}</p>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: crowding.avgCorr >= 0.6 ? "#ef4444" : crowding.avgCorr >= 0.35 ? "#f59e0b" : "#22c55e" }}>{crowding.avgCorr.toFixed(2)}</span>
                          <span className="text-[12px] text-[var(--text-3)]">avg pairwise ρ — {crowding.avgCorr >= 0.6 ? "names move together (hidden concentration)" : crowding.avgCorr >= 0.35 ? "moderately correlated" : "well diversified"}</span>
                        </div>
                        {crowding.topPairs.length > 0 && (
                          <div className="mt-2.5">
                            <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-4)]">Most-correlated pairs</div>
                            <div className="space-y-1">
                              {crowding.topPairs.slice(0, 5).map((p) => (
                                <div key={p.a + p.b} className="flex items-center gap-2 text-[12px]">
                                  <span className="w-24 shrink-0 font-mono text-[var(--text-2)]">{p.a}·{p.b}</span>
                                  <div className="relative h-2.5 flex-1 rounded bg-[var(--bg)]">
                                    <div className="absolute left-0 top-0 h-2.5 rounded" style={{ width: `${Math.max(0, Math.min(100, p.r * 100))}%`, background: p.r >= 0.6 ? "#ef4444" : "#f59e0b", opacity: 0.8 }} />
                                  </div>
                                  <span className="w-10 shrink-0 text-right font-mono tabular-nums text-[var(--text-3)]">{p.r.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] font-semibold">Suggested hedge <InfoDot term="Beta-neutral hedge" /></span>
                      <span className="text-[11px] text-[var(--text-4)]">flatten β + top tilts</span>
                    </div>
                    {hedge.length === 0 ? (
                      <p className="text-[12px] text-[var(--text-4)]">{stats.beta == null ? "No betas available for this book." : "Book is already ≈ market- and style-neutral."}</p>
                    ) : (
                      <>
                        <div className="space-y-1">
                          {hedge.map((l) => (
                            <div key={l.etf} className="flex items-center gap-2 text-[12px]">
                              <span className={`w-11 shrink-0 rounded px-1 text-center text-[10px] font-semibold ${l.action === "Short" ? "bg-[#ef4444]/15 text-[#ef4444]" : "bg-[#22c55e]/15 text-[#22c55e]"}`}>{l.action}</span>
                              <span className="w-12 shrink-0 font-mono font-semibold text-[var(--accent)]">{l.etf}</span>
                              <span className="w-20 shrink-0 text-right font-mono tabular-nums text-[var(--text-2)]">{money(l.notional)}</span>
                              <span className="truncate text-[var(--text-4)]" title={l.name}>cuts {l.cuts}{l.exact ? "" : " ≈"}</span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
                          Market leg is exact (Σ value·β of SPY). Style legs are first-order (a factor ETF ≈ +1σ on its factor) — a starting basket to cut your biggest bets, not an optimizer&apos;s answer.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Holdings */}
              <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center justify-between px-4 pt-3">
                  <span className="text-[13px] font-semibold">Holdings</span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-[var(--text-4)]">return:</span>
                    {TIMEFRAMES.filter((t) => t.key !== "1d").map((t) => (
                      <button key={t.key} onClick={() => setTf(t.key)} className={`rounded px-1.5 py-0.5 ${tf === t.key ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text-4)] hover:text-[var(--text-2)]"}`}>{t.label}</button>
                    ))}
                  </div>
                </div>
                <table className="mt-2 w-full min-w-[720px] text-left text-[13px]">
                  <thead className="border-y border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Symbol</th>
                      <th className="px-2 py-2 font-medium">Sector</th>
                      <th className="px-2 py-2 text-right font-medium">Shares</th>
                      <th className="px-2 py-2 text-right font-medium">Price</th>
                      <th className="px-2 py-2 text-right font-medium">Value</th>
                      <th className="px-2 py-2 text-right font-medium">Weight</th>
                      <th className="px-2 py-2 text-right font-medium" title="Share of the book's total risk (variance) — can exceed weight for a volatile/correlated name, or go negative for a diversifier">% Risk</th>
                      <th className="px-2 py-2 text-right font-medium">β</th>
                      <th className="px-3 py-2 text-right font-medium">{tf.toUpperCase()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.holdings.map((h) => (
                      <tr key={h.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                        <td className="px-3 py-2">
                          <Link href={`/u/${universe}/stock/${h.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{h.symbol}</Link>
                          {h.value < 0 && <span className="ml-1 rounded bg-[#ef4444]/15 px-1 text-[9px] font-semibold text-[#ef4444]">SHORT</span>}
                          <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{h.name}</div>
                        </td>
                        <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{h.sector ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{h.shares.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{px(h.price)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: pos(h.value) ? "var(--text-2)" : "#ef4444" }}>{pctMode ? pctAum(h.value / stats.aum!, true) : signMoney(h.value)}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{(h.weight * 100).toFixed(1)}%</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">
                          {(() => { const rc = riskContribOf.get(h.symbol); return rc == null ? "—" : `${rc < 0 ? "−" : ""}${Math.abs(rc * 100).toFixed(0)}%`; })()}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{typeof h.beta === "number" ? h.beta.toFixed(2) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: h.ret == null ? "var(--text-4)" : pos(h.ret) ? "#22c55e" : "#ef4444" }}>{pct(h.ret ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
