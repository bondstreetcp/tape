/**
 * Builds data/guidance-board.json — the cross-sectional Guidance Credibility board. Joins guidance.json
 * (LLM-extracted standing guides + actual-vs-guide history) with the Russell 3000 snapshot (name / sector /
 * price / next-earnings) and tags each name sandbagger / over-promiser / steady from its beat-its-own-guide
 * record. Pure transform — NO fetches. Run AFTER refresh-guidance in the nightly FULL job.
 */
import { writeFeedGuarded } from "../lib/feedGuard";
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { beatGuide, type GuidanceData } from "../lib/guidance";
import { guidanceTag, type GuidanceBoardRow, type GuidanceBoardData } from "../lib/guidanceBoard";

const DATA = path.join(process.cwd(), "data");

async function main() {
  const raw = await fs.readFile(path.join(DATA, "guidance.json"), "utf8").catch(() => null);
  if (!raw) {
    console.error("guidance-board: no data/guidance.json — run `npm run refresh-guidance` first.");
    process.exit(1);
  }
  const g = JSON.parse(raw) as GuidanceData;
  const snap = await loadSnapshot("russell3000");
  const look = new Map<string, any>();
  for (const s of snap?.stocks || []) look.set(s.symbol, s);

  const now = Date.now();
  const rows: GuidanceBoardRow[] = [];
  for (const sym of Object.keys(g.byTicker || {})) {
    const s = look.get(sym);
    if (!s) continue; // no snapshot row → no name/sector/price to show
    const t = g.byTicker[sym];
    const g0 = t.guides?.[0];
    if (!g0) continue; // no standing guide
    const bg = beatGuide(t.history);
    const de = s.earningsDate && !Number.isNaN(Date.parse(s.earningsDate)) ? Math.round((Date.parse(s.earningsDate) - now) / 86_400_000) : null;
    rows.push({
      symbol: sym,
      name: s.name,
      sector: s.sector || "—",
      price: s.price ?? null,
      period: g0.period,
      action: g0.action,
      revLowM: g0.revLowM,
      revHighM: g0.revHighM,
      epsLow: g0.epsLow,
      epsHigh: g0.epsHigh,
      confidence: g0.confidence,
      updated: t.updated,
      sourceUrl: t.source?.url ?? null,
      sourceForm: t.source?.form ?? null,
      beats: bg?.beats ?? null,
      total: bg?.total ?? null,
      avgVsGuide: bg?.avgVsGuide ?? null,
      tag: guidanceTag(bg?.beats ?? null, bg?.total ?? null, bg?.avgVsGuide ?? null),
      nextEarnings: s.earningsDate ?? null,
      daysToEarnings: de,
    });
  }

  // Names WITH a track record first (by beat-rate desc), then by most-recent guide.
  rows.sort((a, b) => {
    const at = a.total ? 1 : 0, bt = b.total ? 1 : 0;
    if (at !== bt) return bt - at;
    if (a.total && b.total) {
      const ar = a.beats! / a.total, br = b.beats! / b.total;
      if (ar !== br) return br - ar;
    }
    return (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0);
  });

  const out: GuidanceBoardData = { generatedAt: g.generatedAt || new Date().toISOString(), scanned: rows.length, rows };
  // Guarded: a vendor-outage night must leave the prior board stale, not blank (see lib/feedGuard).
  const w = await writeFeedGuarded("guidance-board.json", out);
  if (!w.written) { console.error(`refresh-guidance-board: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  const sand = rows.filter((r) => r.tag === "sandbagger").length,
    over = rows.filter((r) => r.tag === "over-promiser").length,
    tr = rows.filter((r) => r.total).length;
  console.log(`guidance-board: ${rows.length} rows · ${tr} with a track record (${sand} sandbaggers, ${over} over-promisers).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
