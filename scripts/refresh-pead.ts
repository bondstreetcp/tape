/**
 * Builds data/pead.json — post-earnings drift. For each name that reported in the last ~12 days (earnings
 * dates from guidance.json's history), measure the earnings-day GAP (first-session reaction) and the DRIFT
 * since, from the LOCAL daily series (no fetch). Names still drifting the gap's way = PEAD momentum.
 * Pure transform. Run AFTER refresh-guidance in the nightly FULL job.
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot, loadSymbolSeries } from "../lib/data";
import type { GuidanceData } from "../lib/guidance";
import type { PeadRow, PeadData } from "../lib/pead";

const DATA = path.join(process.cwd(), "data");
const MIN_DAYS = 1, MAX_DAYS = 12;

async function main() {
  const graw = await fs.readFile(path.join(DATA, "guidance.json"), "utf8").catch(() => null);
  if (!graw) {
    console.error("pead: no data/guidance.json — run `npm run refresh-guidance` first.");
    process.exit(1);
  }
  const g = JSON.parse(graw) as GuidanceData;
  const snap = await loadSnapshot("russell3000");
  const look = new Map<string, any>();
  for (const s of snap?.stocks || []) look.set(s.symbol, s);

  const now = Date.now();
  const rows: PeadRow[] = [];
  for (const sym of Object.keys(g.byTicker || {})) {
    const h = g.byTicker[sym].history?.[0];
    if (!h?.date) continue;
    // A real print reports EPS (or at least guides). A corporate-action 8-K in the guidance feed
    // (e.g. HON's 2026-06-29 spinoff release: reportedEps null) is NOT an earnings event — without
    // this gate it puts a name on the drift board that never reported.
    if (h.reportedEps == null && h.nextQEpsLow == null && h.nextQEpsHigh == null) continue;
    const rd = Date.parse(h.date);
    if (Number.isNaN(rd)) continue;
    const daysSince = Math.round((now - rd) / 86_400_000);
    if (!(daysSince >= MIN_DAYS && daysSince <= MAX_DAYS)) continue;

    const series = await loadSymbolSeries(sym);
    const daily = (series?.daily || [])
      .map((d: any) => (Array.isArray(d) ? { t: d[0], c: d[1] } : { t: d.t, c: d.c }))
      .filter((x: any) => Number.isFinite(x.t) && Number.isFinite(x.c) && x.c > 0)
      .sort((a: any, b: any) => a.t - b.t);
    if (daily.length < 5) continue;

    // The announcement's own trading session (first close ON/AFTER the filing date).
    const idx = daily.findIndex((x: any) => x.t >= rd);
    if (idx < 1 || idx + 1 >= daily.length) continue; // need a prior close AND a session after the filing day
    // guidance stores only the DATE (no 8-K acceptance hour), so — like the proven lib/earningsReaction —
    // take the LARGER-magnitude of [filing-day move] vs [next-day move] as the reaction. That captures a
    // before-open report (reaction = the filing session) OR an after-close one (reaction = the next session).
    const moveOn = daily[idx].c / daily[idx - 1].c - 1;
    const moveNext = daily[idx + 1].c / daily[idx].c - 1;
    const useOn = Math.abs(moveOn) >= Math.abs(moveNext);
    const reactIdx = useOn ? idx : idx + 1;
    if (reactIdx >= daily.length - 1) continue; // need ≥1 session AFTER the reaction to measure any drift
    const gap = useOn ? moveOn : moveNext;
    const last = daily[daily.length - 1].c;
    const drift = last / daily[reactIdx].c - 1;
    if (!Number.isFinite(gap) || !Number.isFinite(drift) || gap === 0) continue;

    const s = look.get(sym);
    rows.push({
      symbol: sym,
      name: s?.name || sym,
      sector: s?.sector || "—",
      price: s?.price ?? last,
      reportedAt: h.date.slice(0, 10),
      daysSince,
      gapPct: +(gap * 100).toFixed(1),
      driftPct: +(drift * 100).toFixed(1),
      continuation: Math.sign(drift) === Math.sign(gap),
      reportedEps: h.reportedEps ?? null,
    });
  }

  // Continuation (PEAD momentum) first, by strongest drift; then the faders.
  rows.sort((a, b) => {
    if (a.continuation !== b.continuation) return a.continuation ? -1 : 1;
    return Math.abs(b.driftPct) - Math.abs(a.driftPct);
  });

  const out: PeadData = { generatedAt: new Date().toISOString(), scanned: rows.length, rows };
  await fs.writeFile(path.join(DATA, "pead.json"), JSON.stringify(out));
  const cont = rows.filter((r) => r.continuation).length;
  console.log(`pead: ${rows.length} recent reporters · ${cont} drifting in the gap direction (PEAD momentum), ${rows.length - cont} fading.`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
