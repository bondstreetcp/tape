/**
 * Builds data/earnings-preview-log.json — the ACCURACY track record for the desk's predicted prints.
 *
 * Two passes each night (the refresh-trade-log pattern):
 *  1. LOG forecasts. For US names reporting within ~7 days, assemble the SAME context the live AI
 *     preview uses (lib/earningsPreview) and record the model's OWN predicted print — predicted EPS,
 *     beat/miss call vs consensus, reaction direction, confidence, and its checkable qualitative
 *     calls. FLASH-tier: ~dozens of names/night at ~20x below PRO cost. One rec per name per print.
 *  2. SETTLE. Once a logged name has reported, CODE grades the numeric calls: actual EPS from the
 *     stats surprises, the beat/miss direction from the reaction feed's surprise, the 1-day move from
 *     the same reaction feed ("code verifies, models propose" — the model never grades itself).
 *     Qualitative calls are recorded, displayed, and left to human judgment.
 *
 *  Forward-only: a forecast is only honest if it was logged BEFORE the print — nothing is backfilled.
 *
 * Run: npm run refresh-preview-log. Wired into the nightly FULL refresh.
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { cachedStats } from "../lib/companyCache";
import { getEarningsReactions } from "../lib/earningsReaction";
import { assemblePreviewContext, predictPrint } from "../lib/earningsPreview";
import { llmConfigured } from "../lib/llm";
import { gradeEps, actualDirection, gradeReaction, type PreviewLogData, type PreviewRec } from "../lib/earningsPreviewLog";

const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "earnings-preview-log.json");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const WINDOW = 7; // log forecasts for names reporting within this many days (fresher context than the 12d trade window)
const MIN_MKTCAP = 1e9;
const CAP = Number(process.env.PREVIEW_LOG_CAP || 60); // most new forecasts per run (FLASH-tier, but each carries a full quant assembly)
const KEEP = 500;
const DAY = 86_400_000;

async function mapPool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await fn(items[i], i); } catch { out[i] = null as any; }
      }
    }),
  );
  return out;
}

async function main() {
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  if (!(await llmConfigured())) {
    // An LLM-less box can't forecast — but the feed is REGISTERED in the freshness monitor, and a
    // permanently-missing file reads as red and gates the deploy. Leave an existing log untouched;
    // seed an honest empty one only when nothing exists yet (legitimately empty ≠ broken).
    const exists = await fsp.access(FILE).then(() => true, () => false);
    if (!exists) await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, recs: [] } satisfies PreviewLogData));
    console.log(`preview-log: no LLM configured — skipping${exists ? " (prior log stands)" : " (seeded an empty log)"}.`);
    return;
  }

  const existing: PreviewLogData = await fsp
    .readFile(FILE, "utf8")
    .then((s) => JSON.parse(s) as PreviewLogData)
    .catch(() => ({ generatedAt: nowISO, recs: [] as PreviewRec[] }));
  const byId = new Map<string, PreviewRec>(existing.recs.map((r) => [r.id, r]));
  // Same-print dedup across DATE JITTER: Yahoo shifts an AMC print's date across a UTC day boundary
  // night-to-night, which would mint a second id for the same print. Treat any existing rec for the
  // symbol within ±3d as the same print.
  const samePrint = (sym: string, e: number) =>
    [...byId.values()].some((r) => r.symbol === sym && Math.abs(Date.parse(r.earningsDate) - e) <= 3 * DAY);

  // ── 1. LOG forecasts for upcoming reporters ──
  const seen = new Set<string>();
  const pool: any[] = [];
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni);
    if (!snap) continue;
    for (const s of snap.stocks) {
      if (seen.has(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e) || e <= now) continue; // never log a forecast after the event
      const days = Math.round((e - now) / DAY);
      if (days < 0 || days > WINDOW) continue;
      if (!(s.marketCap > MIN_MKTCAP)) continue;
      const id = `${s.symbol}-${new Date(e).toISOString().slice(0, 10)}`;
      if (byId.has(id) || samePrint(s.symbol, e)) { seen.add(s.symbol); continue; } // already forecast this print (incl. date jitter)
      seen.add(s.symbol);
      pool.push({ ...s, _days: days, _e: e, _id: id });
    }
  }
  pool.sort((a, b) => a._days - b._days); // soonest reporters first — they'd otherwise age out un-forecast
  const work = pool.slice(0, CAP);
  console.log(`${pool.length} un-forecast US names report within ${WINDOW}d → predicting ${work.length} (FLASH)`);

  let logged = 0, guarded = 0;
  await mapPool(work, 4, async (s) => {
    const eIso = new Date(s._e).toISOString();
    const c = await assemblePreviewContext(s.symbol, eIso).catch(() => null);
    if (!c) return;
    // FORWARD-ONLY guard: the snapshot's "upcoming" date can be a stale ESTIMATE while the real print
    // already landed (the documented KRUS drift) — in which case the just-filed release is sitting in
    // this very context and a "forecast" would be graded with the answer in hand. Companies don't
    // report twice in 10 days: a fresh 8-K event this recent means the upcoming date is bogus — skip.
    const lastEv = c.quant?.events?.[0]?.date;
    if (lastEv && now - Date.parse(lastEv) < 10 * DAY) { guarded++; return; }
    const p = await predictPrint(c).catch(() => null);
    if (!p) return;
    const rec: PreviewRec = {
      id: s._id,
      symbol: s.symbol,
      name: s.name,
      sector: s.sector || undefined,
      loggedAt: nowISO,
      earningsDate: s.earningsDate,
      consEps: c.consEps,
      consRevB: c.consRevB != null ? +c.consRevB.toFixed(3) : null,
      predEps: p.predEps != null ? +p.predEps.toFixed(2) : null,
      predRevB: p.predRevB != null ? +p.predRevB.toFixed(3) : null,
      vsConsensus: p.vsConsensus,
      reactionDir: p.reactionDir,
      confidence: p.confidence,
      calls: p.calls,
      status: "awaiting_print",
    };
    byId.set(rec.id, rec);
    logged++;
  });
  console.log(`logged ${logged} new forecasts${guarded ? ` (${guarded} skipped — a fresh print says their "upcoming" date is stale)` : ""}`);

  // ── 2. SETTLE — grade forecasts whose print has landed ──
  const open = [...byId.values()].filter((r) => r.status === "awaiting_print" && Number.isFinite(Date.parse(r.earningsDate)) && now >= Date.parse(r.earningsDate));
  let settled = 0, invalidated = 0;
  await mapPool(open, 4, async (rec) => {
    const eT = Date.parse(rec.earningsDate);
    // The reaction feed is the settlement source: the print matched within ±5d, with the surprise
    // (the beat/miss actual) and the completed 1-day move. Returns nothing while the reaction session
    // is still open, so a partial-day move is never frozen in.
    const reactions = await getEarningsReactions(rec.symbol, 8).catch(() => []);
    let rx: (typeof reactions)[number] | null = null, gap = Infinity;
    for (const r of reactions) { const g = Math.abs(Date.parse(r.date) - eT); if (g < gap) { gap = g; rx = r; } }
    if (!rx || gap > 5 * DAY) return; // not reported per the feed yet — try again next run
    // HONESTY CHECK (belt to the log-time guard's braces): if the print this rec matches was FILED
    // before the forecast was logged, the "forecast" was made with the answer available — a stale
    // snapshot date slipped through. Deleting it is the only honest outcome; grading it would launder
    // hindsight into the accuracy record. Code-verifiable, so it can't be argued with.
    if (Date.parse(rx.date) < Date.parse(rec.loggedAt)) { byId.delete(rec.id); invalidated++; return; }
    // Actual EPS from the stats surprises. `quarter` is the QUARTER-END date, and the report lands
    // 25-90d AFTER it (annual prints at the long end) — so match DIRECTIONALLY: the latest quarter-end
    // at/before the print, within 110d. A symmetric ±45d window silently never graded late reporters.
    const stats = await cachedStats(rec.symbol).catch(() => null);
    let actualEps: number | null = null, bestT = -Infinity;
    for (const s of stats?.surprises ?? []) {
      const t = Date.parse(s.quarter);
      if (!Number.isFinite(t) || s.actual == null) continue;
      if (t <= eT + DAY && eT - t <= 110 * DAY && t > bestT) { bestT = t; actualEps = s.actual; }
    }
    const eps = gradeEps(rec.predEps, actualEps);
    const dir = actualDirection(rx.surprise);
    const actualMovePct = rx.move != null ? +(rx.move * 100).toFixed(2) : null;
    const reactionHit = gradeReaction(rec.reactionDir, actualMovePct);
    const dirHit = dir != null ? rec.vsConsensus === dir : null;
    // Settle only when something is actually GRADABLE — Yahoo's surprise/actuals can lag the reaction
    // by days, and freezing an all-null "settled" rec would exclude it from the record forever. Keep
    // retrying nightly; give up (settle with whatever we have) two weeks past the print.
    const gradable = eps != null || dirHit != null || reactionHit != null;
    if (!gradable && now - eT < 14 * DAY) return;
    rec.actualEps = actualEps;
    rec.actualSurprise = rx.surprise;
    rec.actualMovePct = actualMovePct;
    rec.epsHit = eps?.hit ?? null;
    rec.epsErrPct = eps?.errPct != null ? +eps.errPct.toFixed(1) : null;
    rec.dirHit = dirHit;
    rec.reactionHit = reactionHit;
    rec.settledAt = nowISO;
    rec.status = "settled";
    settled++;
  });
  console.log(`settled ${settled} forecasts against actuals${invalidated ? ` · INVALIDATED ${invalidated} (print predated the forecast — stale snapshot date)` : ""}`);

  // ── prune + write (read-merge-write: the log never loses prior recs on a partial run) ──
  const all = [...byId.values()].sort((a, b) => Date.parse(b.earningsDate) - Date.parse(a.earningsDate));
  const recs = all.slice(0, KEEP);
  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, recs } satisfies PreviewLogData));

  const done = recs.filter((r) => r.status === "settled");
  const dirG = done.filter((r) => r.dirHit != null);
  console.log(`\nwrote ${recs.length} recs (${recs.length - done.length} awaiting, ${done.length} graded; direction ${dirG.filter((r) => r.dirHit).length}/${dirG.length}).`);
  for (const r of recs.slice(0, 8)) {
    const tag = r.status === "settled" ? `eps ${r.predEps ?? "?"}→${r.actualEps ?? "?"} ${r.epsHit == null ? "" : r.epsHit ? "✓" : "✗"} · dir ${r.vsConsensus} ${r.dirHit == null ? "" : r.dirHit ? "✓" : "✗"} · rx ${r.reactionDir} ${r.reactionHit == null ? "—" : r.reactionHit ? "✓" : "✗"}` : "awaiting";
    console.log(`  ${r.symbol.padEnd(6)} ${r.earningsDate.slice(0, 10)} ${tag}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
