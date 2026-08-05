/**
 * Cross-sector lead-lag — THE WALK-FORWARD GATE, built and run BEFORE any board exists.
 *
 * The funda-gap audit ranked this build #2 with the explicit warning that it is "the one that can
 * legitimately fail — lead-lag in liquid US equities is mostly overfit; build the walk-forward gate
 * BEFORE the board, gate on the CALENDAR not the array index, and be willing not to ship." This
 * script IS that gate. The verdict rule is pre-committed (bottom of this header) so the outcome
 * can't be argued with after the numbers exist.
 *
 * DESIGN — the three disciplines that keep this honest:
 *  1. RESIDUALIZE. Raw next-day cross-correlation in equities is dominated by market beta — a naive
 *     discovery "finds" that everything leads everything through SPY. Each name's daily return is
 *     residualized against same-day SPY (beta fit on the discovery window only), and both the leader
 *     signal and the follower response are residuals.
 *  2. CALENDAR FOLDS. Six overlapping folds, each = 2 years of discovery + the NEXT 6 months of
 *     test, stepped by 6 months (2021→2026). Window boundaries are DATES, never array offsets — the
 *     known walk-forward leak trap in this repo.
 *  3. A NULL. The same selected pairs and rules, with leader-event dates shifted +21 trading days
 *     inside the test window — preserves event counts and vol clustering while destroying causality.
 *     The strategy must beat its own placebo, not just zero.
 *
 * Discovery per fold: top-800 dollar-ADV names, ordered cross-sector pairs, corr(residL[t],
 * residF[t+1]) with n≥300; same-day |corr| < 0.35 (same-factor twins out); top 50 by |t-stat|.
 * Test per fold: leader residual move >1.5σ (σ from discovery) on day t → position follower at
 * t+1 close for one day, direction sign(move)×sign(discovered corr); score the follower's residual
 * next-day return in that direction.
 *
 * PRE-COMMITTED VERDICT: SHIP only if the pooled per-event residual edge ≥ +10bp AND ≥4 of 6 folds
 * are positive AND the strategy's pooled edge exceeds the null's by ≥5bp. Anything less = KILL,
 * documented, board not built.
 *
 *   npx tsx scripts/eval-lead-lag.ts
 */
import { promises as fsp } from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "data");
const TOP_ADV = 800;
const MIN_OBS = 300;
const SAMEDAY_CAP = 0.35;
const TOP_PAIRS = 50;
const SIGMA_TRIGGER = 1.5;
const NULL_SHIFT = 21; // trading days

const FOLDS: { d0: string; d1: string; t0: string; t1: string }[] = [
  { d0: "2021-02-01", d1: "2023-01-31", t0: "2023-02-01", t1: "2023-07-31" },
  { d0: "2021-08-01", d1: "2023-07-31", t0: "2023-08-01", t1: "2024-01-31" },
  { d0: "2022-02-01", d1: "2024-01-31", t0: "2024-02-01", t1: "2024-07-31" },
  { d0: "2022-08-01", d1: "2024-07-31", t0: "2024-08-01", t1: "2025-01-31" },
  { d0: "2023-02-01", d1: "2025-01-31", t0: "2025-02-01", t1: "2025-07-31" },
  { d0: "2023-08-01", d1: "2025-07-31", t0: "2025-08-01", t1: "2026-01-31" },
];

async function loadSeries(sym: string): Promise<Map<string, number> | null> {
  try {
    const j = JSON.parse(await fsp.readFile(path.join(DATA, "series", "symbols", `${sym}.json`), "utf8"));
    const out = new Map<string, number>();
    for (const [t, p] of j.daily as [number, number][]) if (p > 0) out.set(new Date(t).toISOString().slice(0, 10), p);
    return out.size > 700 ? out : null;
  } catch { return null; }
}

function logRets(px: Map<string, number>, axis: string[]): Float64Array {
  const out = new Float64Array(axis.length).fill(NaN);
  let prev: number | null = null;
  for (let i = 0; i < axis.length; i++) {
    const p = px.get(axis[i]);
    if (p != null && prev != null) {
      const r = Math.log(p / prev);
      out[i] = Math.abs(r) > 0.5 ? NaN : r; // split-junk guard (series are not split-adjusted)
    }
    if (p != null) prev = p;
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const adv: Record<string, number> = JSON.parse(await fsp.readFile(path.join(DATA, "adv.json"), "utf8")).adv;
  const snap = JSON.parse(await fsp.readFile(path.join(DATA, "russell3000", "snapshot.json"), "utf8"));
  const sector = new Map<string, string>((snap.stocks as any[]).map((s) => [s.symbol, s.etf || s.sector || "?"]));

  const spy = await loadSeries("SPY");
  if (!spy) throw new Error("no SPY series");
  const axis = [...spy.keys()].sort();
  const iOf = new Map(axis.map((d, i) => [d, i]));
  const spyR = logRets(spy, axis);

  const candidates = Object.entries(adv)
    .filter(([s]) => s !== "SPY" && sector.has(s))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_ADV + 100)
    .map(([s]) => s);
  const rets = new Map<string, Float64Array>();
  for (const s of candidates) {
    const px = await loadSeries(s);
    if (px) rets.set(s, logRets(px, axis));
    if (rets.size >= TOP_ADV) break;
  }
  const syms = [...rets.keys()];
  console.log(`lead-lag gate: ${syms.length} names on a ${axis.length}-day axis (${axis[0]} → ${axis[axis.length - 1]}) · ${((Date.now() - t0) / 1000).toFixed(0)}s to load`);

  const foldSummaries: { edgeBp: number; nullBp: number; events: number; pairsTested: number }[] = [];

  for (const fold of FOLDS) {
    const dA = iOf.get(axis.find((d) => d >= fold.d0)!)!;
    const dB = iOf.get([...axis].reverse().find((d) => d <= fold.d1)!)!;
    const tA = iOf.get(axis.find((d) => d >= fold.t0)!)!;
    const tB = iOf.get([...axis].reverse().find((d) => d <= fold.t1)!)!;

    // Residualize vs SPY with discovery-window betas ONLY (no test-window information).
    const resid = new Map<string, Float64Array>();
    const sigma = new Map<string, number>();
    for (const s of syms) {
      const r = rets.get(s)!;
      let sxy = 0, sxx = 0, n = 0;
      for (let i = dA; i <= dB; i++) if (!Number.isNaN(r[i]) && !Number.isNaN(spyR[i])) { sxy += r[i] * spyR[i]; sxx += spyR[i] * spyR[i]; n++; }
      if (n < MIN_OBS) continue;
      const beta = sxx > 0 ? sxy / sxx : 0;
      const e = new Float64Array(axis.length).fill(NaN);
      for (let i = dA; i <= tB; i++) if (!Number.isNaN(r[i]) && !Number.isNaN(spyR[i])) e[i] = r[i] - beta * spyR[i];
      let sv = 0, nv = 0;
      for (let i = dA; i <= dB; i++) if (!Number.isNaN(e[i])) { sv += e[i] * e[i]; nv++; }
      resid.set(s, e);
      sigma.set(s, Math.sqrt(sv / Math.max(1, nv)));
    }
    const rs = [...resid.keys()];

    // Discovery: ordered cross-sector pairs, corr(residL[t], residF[t+1]) over the discovery window.
    type Cand = { L: string; F: string; r: number; t: number };
    let best: Cand[] = [];
    const consider = (c: Cand) => {
      if (best.length < TOP_PAIRS) { best.push(c); best.sort((a, b) => Math.abs(b.t) - Math.abs(a.t)); return; }
      if (Math.abs(c.t) > Math.abs(best[best.length - 1].t)) { best[best.length - 1] = c; best.sort((a, b) => Math.abs(b.t) - Math.abs(a.t)); }
    };
    for (const L of rs) {
      const eL = resid.get(L)!;
      for (const F of rs) {
        if (L === F || sector.get(L) === sector.get(F)) continue;
        const eF = resid.get(F)!;
        let sxy = 0, sxx = 0, syy = 0, sx = 0, sy = 0, n = 0;
        let cxy = 0, cn = 0; // same-day, for the twin cap
        for (let i = dA; i < dB; i++) {
          const a = eL[i], b = eF[i + 1];
          if (!Number.isNaN(a) && !Number.isNaN(b)) { sxy += a * b; sxx += a * a; syy += b * b; sx += a; sy += b; n++; }
          const b0 = eF[i];
          if (!Number.isNaN(a) && !Number.isNaN(b0)) { cxy += a * b0; cn++; }
        }
        if (n < MIN_OBS) continue;
        const cov = sxy / n - (sx / n) * (sy / n);
        const vL = sxx / n - (sx / n) ** 2, vF = syy / n - (sy / n) ** 2;
        if (vL <= 0 || vF <= 0) continue;
        const r = cov / Math.sqrt(vL * vF);
        const sameDay = cn > 50 ? cxy / cn / Math.sqrt((sxx / n) * (syy / n)) : 0;
        if (Math.abs(sameDay) > SAMEDAY_CAP) continue;
        const t = (r * Math.sqrt(n - 2)) / Math.sqrt(Math.max(1e-12, 1 - r * r));
        consider({ L, F, r, t });
      }
    }

    // OOS test + the shifted-date null on the SAME pairs.
    let sum = 0, nEv = 0, nullSum = 0, nullN = 0;
    for (const p of best) {
      const eL = resid.get(p.L)!, eF = resid.get(p.F)!;
      const sd = sigma.get(p.L)! * SIGMA_TRIGGER;
      for (let i = tA; i < tB - 1; i++) {
        const a = eL[i];
        if (Number.isNaN(a) || Math.abs(a) < sd) continue;
        const dir = Math.sign(a) * Math.sign(p.r);
        const f = eF[i + 1];
        if (!Number.isNaN(f)) { sum += dir * f; nEv++; }
        // Null: same event, follower response read NULL_SHIFT trading days later (causality broken).
        const j = i + 1 + NULL_SHIFT;
        if (j < tB) { const fn = eF[j]; if (!Number.isNaN(fn)) { nullSum += dir * fn; nullN++; } }
      }
    }
    const edgeBp = nEv ? (sum / nEv) * 1e4 : 0;
    const nullBp = nullN ? (nullSum / nullN) * 1e4 : 0;
    foldSummaries.push({ edgeBp: +edgeBp.toFixed(1), nullBp: +nullBp.toFixed(1), events: nEv, pairsTested: best.length });
    console.log(
      `fold ${fold.d0}→${fold.d1} | test ${fold.t0}→${fold.t1}: pairs ${best.length}, events ${nEv}, edge ${edgeBp.toFixed(1)}bp/event (null ${nullBp.toFixed(1)}bp) | top pair ${best[0]?.L}→${best[0]?.F} r=${best[0]?.r.toFixed(2)} t=${best[0]?.t.toFixed(1)}`,
    );
  }

  // ── THE PRE-COMMITTED VERDICT ──
  const totEv = foldSummaries.reduce((a, f) => a + f.events, 0);
  const pooled = foldSummaries.reduce((a, f) => a + f.edgeBp * f.events, 0) / Math.max(1, totEv);
  const pooledNull = foldSummaries.reduce((a, f) => a + f.nullBp * f.events, 0) / Math.max(1, totEv);
  const posFolds = foldSummaries.filter((f) => f.edgeBp > 0).length;
  console.log(`\n══ VERDICT ══`);
  console.log(`pooled edge ${pooled.toFixed(1)}bp/event over ${totEv} events · null ${pooledNull.toFixed(1)}bp · positive folds ${posFolds}/6`);
  const ship = pooled >= 10 && posFolds >= 4 && pooled - pooledNull >= 5;
  console.log(ship
    ? "SHIP: the gate passed — build the board on these rules."
    : "KILL: the walk-forward gate failed the pre-committed rule (edge ≥ +10bp/event, ≥4/6 folds positive, ≥5bp over the null). Do not build the board; document the negative result.");
}

main().catch((e) => { console.error("eval-lead-lag:", String(e?.message || e)); process.exit(1); });
