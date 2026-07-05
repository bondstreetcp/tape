"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { computePortfolio, scenarioPnL, parsePositions, type NameData } from "@/lib/portfolio";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

const STORE_KEY = "tape.portfolio.positions";
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

  // Restore saved book on mount; persist on every edit after.
  const hydrated = useRef(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw != null) setText(raw); } catch { /* ignore */ }
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try { localStorage.setItem(STORE_KEY, text); } catch { /* ignore */ }
  }, [text]);

  const positions = useMemo(() => parsePositions(text), [text]);
  const symbolsKey = useMemo(() => [...new Set(positions.map((p) => p.symbol))].sort().join(","), [positions]);

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
  const stats = useMemo(() => computePortfolio(positions, dataMap), [positions, dataMap]);
  const hasBook = stats.holdings.length > 0;
  const effN = stats.concentration.hhi > 0 ? 1 / stats.concentration.hhi : 0; // effective # of names
  const netPctGross = stats.gross ? (stats.net / stats.gross) * 100 : 0;

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
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-[var(--text-4)]">
            Prices from the latest US snapshot; betas are 5-yr weekly-equivalent vs the S&amp;P 500. International tickers aren&apos;t priced here. Research tool, not advice.
          </p>
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
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Gross" value={money(stats.gross)} sub="Σ |value|" />
                <Stat label="Net" value={signMoney(stats.net)} sub={`${pct(netPctGross, 0)} of gross`} color={pos(stats.net) ? "#22c55e" : "#ef4444"} />
                <Stat label="Long" value={money(stats.longValue)} color="#22c55e" />
                <Stat label="Short" value={money(stats.shortValue)} color="#ef4444" />
                <Stat label="Net β" value={stats.beta == null ? "—" : stats.beta.toFixed(2)} sub={stats.betaCoverage < 0.999 ? `${Math.round(stats.betaCoverage * 100)}% covered` : "per $ gross"} color={stats.beta != null && stats.beta < 0 ? "#ef4444" : undefined} />
                <Stat label={`Return (${tf.toUpperCase()})`} value={pct(stats.ret)} color={stats.ret == null ? undefined : pos(stats.ret) ? "#22c55e" : "#ef4444"} />
              </div>

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
                        <span className="font-mono text-sm tabular-nums" style={{ color: c }}>({pct(r.pct)})</span>
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
                        <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: pos(h.value) ? "var(--text-2)" : "#ef4444" }}>{signMoney(h.value)}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{(h.weight * 100).toFixed(1)}%</td>
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
