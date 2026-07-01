"use client";
import { useEffect, useMemo, useState } from "react";
import { bsPrice, straddlePrice, ivFromPrice, straddleIvFromPrice } from "@/lib/blackScholes";

// Compact strike ladder + context the route hands us from the EVENT chain.
export interface IvScenario {
  spot: number;
  atmStrike: number;
  expiry: string | null;
  dteNow: number | null; // calendar days today → expiry
  expectedCrushPct: number | null; // from the IV term structure (front vs back cycle)
  ladder: { k: number; cMid: number | null; cIV: number | null; pMid: number | null; pIV: number | null }[];
}

type Structure = "call" | "put" | "straddle";
type Mode = "print" | "expiry";
const GREEN = "#22c55e", RED = "#ef4444";
const R = 0.04; // risk-free, matches the app's other pricers

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0)}`;
const money2 = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;

export default function IvCrushScenario({
  scenario, impliedMovePct, earningsDate,
}: {
  scenario: IvScenario;
  impliedMovePct: number | null;
  earningsDate?: string | null;
}) {
  const { spot: S0, atmStrike, dteNow, ladder } = scenario;
  const strikes = useMemo(() => ladder.map((r) => r.k), [ladder]);

  const [structure, setStructure] = useState<Structure>("call");
  const [strike, setStrike] = useState<number>(atmStrike);
  const [mode, setMode] = useState<Mode>("print");
  const [crush, setCrush] = useState<number>(scenario.expectedCrushPct != null ? Math.min(80, Math.max(10, Math.round(scenario.expectedCrushPct / 5) * 5)) : 45);
  const [contracts, setContracts] = useState<number>(1);

  // default entry premium for the current structure+strike (chain mid); user can override the box.
  const defPrem = useMemo(() => {
    const row = ladder.find((r) => r.k === strike);
    if (!row) return null;
    if (structure === "call") return row.cMid;
    if (structure === "put") return row.pMid;
    return row.cMid != null && row.pMid != null ? row.cMid + row.pMid : null;
  }, [ladder, strike, structure]);

  const [premium, setPremium] = useState<string>(defPrem != null ? defPrem.toFixed(2) : "");
  // when the structure or strike changes, re-baseline the premium box to the new chain mid.
  useEffect(() => { setPremium(defPrem != null ? defPrem.toFixed(2) : ""); }, [defPrem]);
  // if the ladder changes (e.g. navigating to another ticker) and the selected strike is gone, snap to ATM.
  useEffect(() => { if (!strikes.includes(strike)) setStrike(strikes.includes(atmStrike) ? atmStrike : strikes[Math.floor(strikes.length / 2)]); }, [strikes, strike, atmStrike]);

  const entry = parseFloat(premium);
  const K = strike;
  const T0 = (dteNow ?? 30) / 365;

  // Days from today to the report; the reprice happens the MORNING AFTER, so time left = expiry − earnings.
  const daysToEarn = useMemo(() => {
    if (!earningsDate) return 1; // unknown → assume the event is imminent (1 day out)
    const d = Math.round((Date.parse(earningsDate) - Date.now()) / 86_400_000);
    return Math.min(Math.max(d, 0), (dteNow ?? d) - 0.5);
  }, [earningsDate, dteNow]);
  const T1 = mode === "expiry" ? 0 : Math.max((( dteNow ?? 30) - daysToEarn) / 365, 0.5 / 365);

  const model = useMemo(() => {
    if (!(entry > 0)) return null;
    const sigma0 = structure === "straddle" ? straddleIvFromPrice(S0, K, T0, entry, R) : ivFromPrice(structure, S0, K, T0, entry, R);
    if (sigma0 == null || sigma0 <= 0) return null;
    const priceAt = (S: number, sigma: number) => (structure === "straddle" ? straddlePrice(S, K, T1, sigma, R) : bsPrice(structure, S, K, T1, sigma, R));
    // P&L per contract (×100 sh) × #contracts, given a % move and a % IV crush.
    const pnl = (movePct: number, crushPct: number) => (priceAt(S0 * (1 + movePct / 100), sigma0 * (1 - crushPct / 100)) - entry) * 100 * contracts;
    return { sigma0, sigma1: sigma0 * (1 - crush / 100), pnl };
  }, [entry, structure, S0, K, T0, T1, crush, contracts]);

  if (!ladder.length || !(S0 > 0)) return null;

  const im = impliedMovePct ?? 8;
  const RANGE = Math.max(18, im * 1.15, Math.min(45, im * 2.3)); // x-axis half-width in % (always ≥ the implied move so the band fits)
  const moneyness = ((strike / S0 - 1) * 100);

  // ── sample the P&L-vs-move curve at the current crush ──
  const N = 121;
  const moves: number[] = [], pnls: number[] = [];
  if (model) for (let i = 0; i < N; i++) { const m = -RANGE + (2 * RANGE * i) / (N - 1); moves.push(m); pnls.push(model.pnl(m, crush)); }

  // breakevens (zero crossings) + key readouts
  const breakevens: number[] = [];
  for (let i = 1; i < pnls.length; i++) {
    const a = pnls[i - 1], b = pnls[i];
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) { const t = a / (a - b); breakevens.push(moves[i - 1] + t * (moves[i] - moves[i - 1])); }
  }
  const pnlAt = (m: number) => (model ? model.pnl(m, crush) : 0);
  const maxLossFloor = model ? -entry * 100 * contracts : 0; // long premium → max loss = the premium paid

  // Breakeven in the option's FAVORABLE direction (up for a call, down for a put, nearest for a straddle)
  // → the "you need the stock to move X% to break even" callout + the crush-trap check (below vs implied).
  const favBEs = structure === "put" ? breakevens.filter((b) => b < 0) : structure === "call" ? breakevens.filter((b) => b > 0) : breakevens;
  const beMove = favBEs.length ? favBEs.slice().sort((a, b) => Math.abs(a) - Math.abs(b))[0] : null;
  const beExceedsMove = beMove != null && Math.abs(beMove) > im; // the crush trap: priced move < your breakeven

  // ── scenario matrix: rows = moves, cols = crush levels (incl. the live slider value) ──
  const rowMoves = [-15, -10, -5, -2, 0, 2, 5, 10, 15].filter((m) => Math.abs(m) <= RANGE + 1);
  const crushCols = Array.from(new Set([0, 25, 50, 75, crush])).sort((a, b) => a - b);
  const cellMax = model ? Math.max(entry * 100 * contracts, ...rowMoves.map((m) => Math.abs(model.pnl(m, 0)))) : 1;

  // ── chart geometry ──
  const W = 600, H = 168, ML = 6, MR = 62, MT = 12, MB = 20;
  const yMax = Math.max(0, ...pnls) * 1.08 || 1;
  const yMin = Math.min(0, ...pnls, maxLossFloor) * 1.08 || -1;
  const x = (m: number) => ML + ((m + RANGE) / (2 * RANGE)) * (W - ML - MR);
  const y = (p: number) => MT + (1 - (p - yMin) / (yMax - yMin || 1)) * (H - MT - MB);
  const y0 = y(0);
  const curve = pnls.length ? "M" + moves.map((m, i) => `${x(m).toFixed(1)} ${y(pnls[i]).toFixed(1)}`).join(" L") : "";
  const area = pnls.length ? `M${x(moves[0]).toFixed(1)} ${y0.toFixed(1)} L` + moves.map((m, i) => `${x(m).toFixed(1)} ${y(pnls[i]).toFixed(1)}`).join(" L") + ` L${x(moves[moves.length - 1]).toFixed(1)} ${y0.toFixed(1)} Z` : "";
  const cid = "ivs";

  const cellColor = (p: number) => {
    const t = Math.max(-1, Math.min(1, p / (cellMax || 1)));
    return t >= 0 ? `color-mix(in oklab, ${GREEN} ${Math.round(t * 55)}%, transparent)` : `color-mix(in oklab, ${RED} ${Math.round(-t * 55)}%, transparent)`;
  };

  const SegBtn = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) => (
    <button onClick={onClick} title={title} className={"rounded-md px-2 py-0.5 text-[12px] font-medium transition-colors " + (active ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{children}</button>
  );

  return (
    <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]" title="Reprices the option with Black-Scholes at the moment after the print — the stock moves, IV crushes, and a day or two of value decays — so you can see a correct call still lose to the crush. IV is solved from the premium you enter.">
          IV-crush scenario · what the move needs to beat the vol collapse
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <SegBtn active={structure === "call"} onClick={() => setStructure("call")} title="Long call">Call</SegBtn>
          <SegBtn active={structure === "put"} onClick={() => setStructure("put")} title="Long put">Put</SegBtn>
          <SegBtn active={structure === "straddle"} onClick={() => setStructure("straddle")} title="Long straddle (call + put)">Straddle</SegBtn>
        </div>
      </div>

      {/* controls */}
      <div className="mb-2.5 flex flex-wrap items-end gap-x-4 gap-y-2 text-[12px]">
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--text-4)]">Strike</span>
          <select value={strike} onChange={(e) => setStrike(parseFloat(e.target.value))} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[13px] outline-none">
            {strikes.map((k) => (
              <option key={k} value={k}>{k}{Math.abs(k / S0 - 1) < 0.003 ? " (ATM)" : ` (${k > S0 ? "+" : ""}${((k / S0 - 1) * 100).toFixed(1)}%)`}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--text-4)]">Premium paid ($/sh)</span>
          <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1">
            <span className="text-[var(--text-4)]">$</span>
            <input type="number" step="0.05" min="0" value={premium} onChange={(e) => setPremium(e.target.value)} className="w-16 bg-transparent font-mono text-[13px] outline-none" />
          </div>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--text-4)]">Contracts</span>
          <input type="number" step="1" min="1" value={contracts} onChange={(e) => setContracts(Math.max(1, Math.round(parseFloat(e.target.value) || 1)))} className="w-14 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[13px] outline-none" />
        </label>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5" title="When to reprice: the morning after the print (some time value left + the crush), or all the way to expiry (intrinsic only).">
          <SegBtn active={mode === "print"} onClick={() => setMode("print")}>Morning after</SegBtn>
          <SegBtn active={mode === "expiry"} onClick={() => setMode("expiry")}>At expiry</SegBtn>
        </div>
      </div>

      {/* IV-crush slider — the "slider" that re-prices the whole curve live */}
      <div className="mb-2.5 flex items-center gap-3">
        <span className="whitespace-nowrap text-[12px] text-[var(--text-3)]">IV crush</span>
        <input type="range" min={0} max={85} step={5} value={crush} onChange={(e) => setCrush(parseFloat(e.target.value))} className="h-1.5 flex-1 cursor-pointer accent-[var(--accent)]" />
        <span className="w-24 text-right font-mono text-[13px]" style={{ color: crush >= 40 ? RED : "var(--text-2)" }}>
          −{crush}%{model ? <span className="text-[var(--text-4)]"> · {(model.sigma0 * 100).toFixed(0)}→{(model.sigma1 * 100).toFixed(0)}</span> : null}
        </span>
      </div>

      {!model ? (
        <div className="rounded-lg bg-[var(--surface-2)] px-3 py-3 text-[13px] text-[var(--text-3)]">Enter the premium you&apos;d pay to model the scenario. {defPrem == null ? "No usable quote for this strike — try another." : ""}</div>
      ) : (
        <>
          {/* headline read */}
          <div className="mb-2.5 rounded-lg px-3 py-2 text-[13px]" style={{ background: beExceedsMove ? `${RED}14` : "var(--surface-2)" }}>
            <span className="text-[var(--text-3)]">At a </span><b>−{crush}% crush</b>
            <span className="text-[var(--text-3)]">, you need the stock </span>
            <b style={{ color: beMove != null ? (beExceedsMove ? RED : GREEN) : "var(--text-4)" }}>{beMove != null ? `${beMove > 0 ? "+" : "−"}${Math.abs(beMove).toFixed(1)}%` : "—"}</b>
            <span className="text-[var(--text-3)]"> just to break even</span>
            {impliedMovePct != null && <span className="text-[var(--text-4)]"> — the options are pricing ±{im.toFixed(1)}%.</span>}
            {beExceedsMove && <span style={{ color: RED }}> The priced move doesn&apos;t reach your breakeven: a correct call can still bleed out.</span>}
            <span className="ml-1 text-[var(--text-4)]">Max loss {money(maxLossFloor)} (premium paid).</span>
          </div>

          {/* P&L-vs-move curve */}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
            <defs>
              <clipPath id={`${cid}p`}><rect x={0} y={MT - 2} width={W} height={Math.max(0, y0 - MT + 2)} /></clipPath>
              <clipPath id={`${cid}l`}><rect x={0} y={y0} width={W} height={Math.max(0, H - MB - y0 + 2)} /></clipPath>
            </defs>
            {/* expected-move band */}
            {impliedMovePct != null && <rect x={x(-im)} y={MT} width={x(im) - x(-im)} height={H - MT - MB} fill="var(--accent)" fillOpacity={0.08} />}
            {/* P&L fills */}
            {area && <path d={area} fill={GREEN} fillOpacity={0.16} clipPath={`url(#${cid}p)`} />}
            {area && <path d={area} fill={RED} fillOpacity={0.16} clipPath={`url(#${cid}l)`} />}
            {/* zero line + spot line */}
            <line x1={ML} x2={W - MR} y1={y0} y2={y0} stroke="var(--text-4)" strokeOpacity={0.6} strokeDasharray="3 3" />
            <line x1={x(0)} x2={x(0)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.35} />
            {/* curve */}
            {curve && <path d={curve} fill="none" stroke="var(--text)" strokeWidth={1.8} />}
            {/* breakeven dots */}
            {breakevens.map((b) => (Math.abs(b) <= RANGE ? <circle key={`be${b.toFixed(2)}`} cx={x(b)} cy={y0} r={2.6} fill="var(--text)" /> : null))}
            {/* expected-move markers */}
            {impliedMovePct != null && [im, -im].map((m, i) => (
              <g key={i}>
                <circle cx={x(m)} cy={y(pnlAt(m))} r={2.6} fill={pnlAt(m) >= 0 ? GREEN : RED} />
              </g>
            ))}
            {/* right-edge $ labels */}
            <text x={W - MR + 4} y={MT + 6} fontSize={9} fill={GREEN}>{money(Math.max(...pnls))}</text>
            <text x={W - MR + 4} y={H - MB} fontSize={9} fill={RED}>{money(Math.min(...pnls))}</text>
            <text x={W - MR + 4} y={y0 + 3} fontSize={9} fill="var(--text-4)">$0</text>
            {/* x labels */}
            <text x={x(0)} y={H - 6} fontSize={9} fill="var(--text-4)" textAnchor="middle">0%</text>
            <text x={ML} y={H - 6} fontSize={9} fill="var(--text-4)">−{RANGE.toFixed(0)}%</text>
            <text x={W - MR} y={H - 6} fontSize={9} fill="var(--text-4)" textAnchor="end">+{RANGE.toFixed(0)}%</text>
            {impliedMovePct != null && <text x={x(im)} y={H - 6} fontSize={8.5} fill="var(--accent)" textAnchor="middle">+{im.toFixed(0)}</text>}
            {impliedMovePct != null && <text x={x(-im)} y={H - 6} fontSize={8.5} fill="var(--accent)" textAnchor="middle">−{im.toFixed(0)}</text>}
          </svg>
          <div className="mt-0.5 text-center text-[11px] text-[var(--text-4)]">P&amp;L (per {contracts > 1 ? `${contracts} contracts` : "contract"}) vs stock move · {mode === "expiry" ? "held to expiry" : "morning after the print"} · shaded band = expected move</div>

          {/* scenario matrix */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[440px] text-right text-[12px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                  <th className="px-2 py-1 text-left font-medium">Move ↓ / Crush →</th>
                  {crushCols.map((c) => (
                    <th key={c} className={"px-2 py-1 font-medium " + (c === crush ? "text-[var(--accent)]" : "")}>−{c}%{c === crush ? " ◂" : ""}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowMoves.map((m) => (
                  <tr key={m} className="border-t border-[var(--divider)]">
                    <td className="px-2 py-1 text-left font-mono" style={{ color: Math.abs(m - im) < 0.5 || Math.abs(m + im) < 0.5 ? "var(--accent)" : "var(--text-3)" }}>{m > 0 ? "+" : ""}{m}%</td>
                    {crushCols.map((c) => {
                      const p = model.pnl(m, c);
                      return <td key={c} className="px-2 py-1 font-mono tabular-nums" style={{ background: cellColor(p), color: p >= 0 ? GREEN : RED }}>{money(p)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--text-4)]">
            Entry {money2(entry * 100 * contracts)} for {contracts} {structure === "straddle" ? "straddle" : structure} contract{contracts > 1 ? "s" : ""} · {strike}{moneyness ? ` (${moneyness > 0 ? "+" : ""}${moneyness.toFixed(1)}%)` : ""} · IV solved {(model.sigma0 * 100).toFixed(0)}% · reprices to {mode === "expiry" ? "expiry" : `${Math.max(0, (dteNow ?? 0) - Math.round(daysToEarn))}d left post-print`}. Green = profit, red = loss.
          </div>
        </>
      )}
    </div>
  );
}
