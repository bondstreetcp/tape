/**
 * One-off study: backtest the "~50% share-register turnover = the bottom" spinoff heuristic.
 *
 * For each historical spinoff (2020-2024, full post-spin windows):
 *   - cross50: first day cumulative volume since spin ≥ 50% of shares outstanding
 *   - trough: the lowest close in the first 12 months post-spin
 *   - Did the trough come at/before the cross? How much drawdown remained AFTER the cross?
 *   - Buy-at-spin vs buy-at-cross, both marked at month 12.
 *
 * CAVEATS (printed with results): shares outstanding is TODAY'S count (Yahoo has no historical
 * shares — buyback-heavy names run "fast" clocks); acquired/delisted spincos drop out
 * (survivorship); turnover counts double-handled shares. Heuristic-grade, not academic.
 * Run: npx tsx scripts/backtest-spinoff-turnover.ts
 */
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;

// US spinoffs 2020-2024 (first regular-way date, ± a few days is fine — bars start at the date).
const HIST: { t: string; d: string; from: string }[] = [
  { t: "CARR", d: "2020-04-03", from: "UTX" },
  { t: "OTIS", d: "2020-04-03", from: "UTX" },
  { t: "VNT", d: "2020-10-09", from: "FTV" },
  { t: "VTRS", d: "2020-11-16", from: "PFE (spin-merge)" },
  { t: "OGN", d: "2021-06-03", from: "MRK" },
  { t: "GXO", d: "2021-08-02", from: "XPO" },
  { t: "JXN", d: "2021-09-13", from: "PRU plc" },
  { t: "SLVM", d: "2021-10-01", from: "IP" },
  { t: "KD", d: "2021-11-04", from: "IBM" },
  { t: "CEG", d: "2022-02-02", from: "EXC" },
  { t: "ZIMV", d: "2022-03-01", from: "ZBH" },
  { t: "EMBC", d: "2022-04-01", from: "BDX" },
  { t: "ESAB", d: "2022-04-05", from: "Colfax" },
  { t: "WBD", d: "2022-04-11", from: "T (spin-merge)" },
  { t: "RXO", d: "2022-11-01", from: "XPO" },
  { t: "GEHC", d: "2023-01-04", from: "GE" },
  { t: "CXT", d: "2023-04-03", from: "CR" },
  { t: "KNF", d: "2023-06-01", from: "MDU" },
  { t: "PHIN", d: "2023-07-03", from: "BWA" },
  { t: "FTRE", d: "2023-07-03", from: "LH" },
  { t: "VLTO", d: "2023-10-02", from: "DHR" },
  { t: "KLG", d: "2023-10-02", from: "K" },
  { t: "VSTS", d: "2023-10-02", from: "ARMK" },
  { t: "VYX", d: "2023-10-16", from: "NCR" },
  { t: "NATL", d: "2023-10-16", from: "NCR" },
  { t: "WS", d: "2023-12-01", from: "WOR" },
  { t: "SOLV", d: "2024-04-01", from: "MMM" },
  { t: "GEV", d: "2024-04-02", from: "GE" },
  { t: "AMTM", d: "2024-09-30", from: "J (RMT)" },
  { t: "ECG", d: "2024-11-01", from: "MDU" },
];

interface Bar { t: number; close: number; vol: number }
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const pctf = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

async function main() {
  const rows: any[] = [];
  for (const s of HIST) {
    try {
      const spinT = Date.parse(s.d);
      const ch: any = await yf.chart(s.t, { period1: new Date(spinT - 3 * DAY), interval: "1d" } as any, { validateResult: false });
      const bars: Bar[] = (ch?.quotes || []).filter((q: any) => q?.close != null && q.date && new Date(q.date).getTime() >= spinT).map((q: any) => ({ t: new Date(q.date).getTime(), close: q.close, vol: q.volume ?? 0 }));
      if (bars.length < 260) { console.log(`  ${s.t}: only ${bars.length} bars — skipped`); continue; }
      const q: any = await yf.quote(s.t, {}, { validateResult: false });
      const shares = q?.sharesOutstanding > 0 ? q.sharesOutstanding : null;
      if (!shares) { console.log(`  ${s.t}: no shares outstanding — skipped`); continue; }

      // day-1 junk-tick guard: base = median of first 3 closes
      const base = [...bars.slice(0, 3).map((b) => b.close)].sort((a, b) => a - b)[1];

      // sweep several turnover thresholds — 50% may fire too early in the modern churn regime
      const TH = [0.5, 1.0, 1.5, 2.0];
      const crossAt: Record<string, number> = {};
      let cum = 0;
      bars.forEach((b, i) => { cum += b.vol; for (const th of TH) { const k = String(th); if (crossAt[k] === undefined && cum >= th * shares) crossAt[k] = i; } });
      const crossIdx = crossAt["0.5"] ?? -1;

      const yr = bars.slice(0, 252);
      let lowIdx = 0; yr.forEach((b, i) => { if (b.close < yr[lowIdx].close) lowIdx = i; });
      const crossed = crossIdx >= 0 && crossIdx < 252;
      const out: any = { t: s.t, from: s.from, daysToCross: crossed ? crossIdx : null, lowIdx, troughAtOrBeforeCross: crossed ? lowIdx <= crossIdx + 10 : null };
      // per-threshold: days-to-cross, trough-before?, remaining drawdown, +6m fwd
      out.th = {};
      for (const th of [0.5, 1.0, 1.5, 2.0]) {
        const ci = crossAt[String(th)];
        if (ci === undefined || ci >= 252 || !bars[ci]) { out.th[th] = null; continue; }
        const px = bars[ci].close;
        const after = bars.slice(ci, ci + 252);
        out.th[th] = {
          days: ci,
          troughBefore: lowIdx <= ci + 10,
          ddAfter: Math.min(...after.map((b) => b.close)) / px - 1,
          fwd6: bars[ci + 126] ? bars[ci + 126].close / px - 1 : null,
        };
      }
      if (crossed) {
        const cPx = bars[crossIdx].close;
        const after = bars.slice(crossIdx, crossIdx + 252);
        out.ddAfterCross = Math.min(...after.map((b) => b.close)) / cPx - 1;
        out.ddToTrough = yr[lowIdx].close / base - 1; // total spin→trough drawdown for context
        out.fwd6FromCross = bars[crossIdx + 126] ? bars[crossIdx + 126].close / cPx - 1 : null;
        out.buyAtSpin12 = bars[252] ? bars[252].close / base - 1 : null;
        out.buyAtCross12 = bars[252] && crossIdx < 252 ? bars[252].close / cPx - 1 : null;
      }
      rows.push(out);
      console.log(`  ${s.t.padEnd(5)} (${s.from.padEnd(14)}) cross50 ${crossed ? `day ${crossIdx}` : "never<12m"} · trough day ${lowIdx} (${pctf(yr[lowIdx].close / base - 1)}) ${crossed ? `· after-cross DD ${pctf(out.ddAfterCross)} · 6m-fwd ${out.fwd6FromCross != null ? pctf(out.fwd6FromCross) : "—"}` : ""}`);
      await new Promise((r) => setTimeout(r, 200));
    } catch (e: any) {
      console.log(`  ${s.t}: ERR ${String(e?.message).slice(0, 60)} — skipped (delisted?)`);
    }
  }

  const c = rows.filter((r) => r.daysToCross != null);
  console.log(`\n══ AGGREGATE (n=${rows.length}, crossed 50% within 12m: ${c.length}) ══`);
  console.log(`median days to 50% cross:            ${median(c.map((r) => r.daysToCross))} trading days`);
  console.log(`trough AT/BEFORE cross (+10d tol):   ${c.filter((r) => r.troughAtOrBeforeCross).length}/${c.length} (${((c.filter((r) => r.troughAtOrBeforeCross).length / c.length) * 100).toFixed(0)}%)`);
  console.log(`median FURTHER drawdown after cross: ${pctf(median(c.map((r) => r.ddAfterCross)))}   (vs median spin→trough ${pctf(median(c.map((r) => r.ddToTrough)))})`);
  const f6 = c.filter((r) => r.fwd6FromCross != null);
  console.log(`median +6m return from the cross:    ${pctf(median(f6.map((r) => r.fwd6FromCross)))}  (${f6.filter((r) => r.fwd6FromCross > 0).length}/${f6.length} positive)`);
  const both = c.filter((r) => r.buyAtSpin12 != null && r.buyAtCross12 != null);
  console.log(`to month-12: buy-at-SPIN median ${pctf(median(both.map((r) => r.buyAtSpin12)))}  vs  buy-at-CROSS median ${pctf(median(both.map((r) => r.buyAtCross12)))}  (cross better in ${both.filter((r) => r.buyAtCross12 > r.buyAtSpin12).length}/${both.length})`);
  console.log(`\n══ THRESHOLD SWEEP (is 50% too early in the modern churn regime?) ══`);
  console.log(`threshold | n crossed<12m | median days | trough at/before | median further DD | median +6m (pos%)`);
  for (const th of [0.5, 1.0, 1.5, 2.0]) {
    const x = rows.map((r) => r.th?.[th]).filter(Boolean);
    if (!x.length) { console.log(`  ${(th * 100).toFixed(0)}%: none crossed`); continue; }
    const f = x.filter((v: any) => v.fwd6 != null);
    console.log(
      `  ${String(th * 100).padStart(4)}%   |      ${String(x.length).padStart(2)}       |    ${String(Math.round(median(x.map((v: any) => v.days)))).padStart(3)}      |      ${((x.filter((v: any) => v.troughBefore).length / x.length) * 100).toFixed(0).padStart(3)}%        |      ${pctf(median(x.map((v: any) => v.ddAfter))).padStart(6)}       |  ${pctf(median(f.map((v: any) => v.fwd6)))} (${((f.filter((v: any) => v.fwd6 > 0).length / f.length) * 100).toFixed(0)}%)`,
    );
  }
  console.log(`\nCaveats: TODAY'S share count (buyback names run fast clocks); survivorship (delisted spincos excluded); volume double-counts round trips.`);
}

main();
