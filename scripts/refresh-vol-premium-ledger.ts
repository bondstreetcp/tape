/**
 * VRP capture ledger — the forward track record for /vol-dislocation's rich-vol picks.
 *
 * Nightly, from feeds that already exist (ZERO new option fetches):
 *   1. OPEN — freeze the top liquid rich-vol picks from vol-dislocation.json (the ATM IV you'd sell),
 *      skipping names with an open position or one closed inside the cooldown.
 *   2. CLOSE — for opens that have aged MATURE_TD trading days, read realized vol from vol-cone.json
 *      (cur20 = the 20-td RV that printed over ~the holding window) and score capturedVolPts.
 *   3. DISCARD — opens past MAX_HOLD_TD with no vol-cone RV (delisted/halted/acquired) are ungradeable.
 *
 * Forward-only: a file that EXISTS but won't parse aborts rather than seeding OVER history. Dates are
 * anchored to the SOURCE feed's own stamp (vol-dislocation generatedAt), never a wall clock — the
 * calendar-square doctrine. Writes data/vol-premium-ledger.json (write-guarded).
 */
import { promises as fsp } from "fs";
import path from "path";
import { writeFeedGuarded } from "../lib/feedGuard";
import type { VolDisData } from "../lib/volDislocation";
import {
  pickSellCandidates,
  bizDaysBetween,
  calDaysBetween,
  capturedVolPts,
  computeStats,
  coneFreshEnough,
  maturityDecision,
  RELOG_COOLDOWN_DAYS,
  CLOSED_CAP,
  type VpLedgerFile,
  type VpOpen,
  type VpClosed,
} from "../lib/volPremiumLedger";

const DATA = path.join(process.cwd(), "data");
const FILE = "vol-premium-ledger.json";
const readJson = async <T,>(f: string): Promise<T | null> =>
  fsp.readFile(path.join(DATA, f), "utf8").then((s) => JSON.parse(s) as T).catch(() => null);

async function main() {
  const disloc = await readJson<VolDisData>("vol-dislocation.json");
  if (!disloc?.rows?.length) {
    console.error("vol-premium-ledger: no data/vol-dislocation.json — run `npm run refresh-vol-dislocation` first.");
    process.exit(1);
  }
  // vol-cone gives per-name realized vol; cur20 (20-td RV) is the holding-window read. Store the RAW
  // value — the glitch-low floor (a flat/halted series) is applied in maturityDecision (single source).
  const cone = await readJson<{ generatedAt?: string; rows?: { symbol: string; cur20?: number | null }[] }>("vol-cone.json");
  const rvBy = new Map<string, number>();
  for (const r of cone?.rows ?? []) if (r.symbol && r.cur20 != null) rvBy.set(r.symbol, r.cur20);

  // The pick's timestamp IS the source feed's stamp — one calendar anchor for entry and aging.
  const today = (disloc.generatedAt || new Date().toISOString()).slice(0, 10);

  // The realized-vol feed and the aging clock are SEPARATE feeds that fail independently, and a failed
  // refresh leaves a STALE file (feed-guard doctrine). If the cone's stamp is far from `today`, cur20's
  // window doesn't cover [entry, maturity] — so grade NOTHING this run and let matured opens wait in the
  // grace window for a night when a fresh cone is present (findings 1/2/10).
  const coneOk = !!cone?.generatedAt && coneFreshEnough(cone.generatedAt.slice(0, 10), today);

  // Load existing ledger. A file that EXISTS but can't be read/parsed = corrupted hydration or a
  // transient fd/IO error (the NAS runs under camera-stack contention) → ABORT, never seed over the
  // unrebuildable history. Only a genuine ENOENT (first run) is allowed to proceed with no prior.
  let existing: VpLedgerFile | null = null;
  let raw: string | null = null;
  try {
    raw = await fsp.readFile(path.join(DATA, FILE), "utf8");
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      console.error(`vol-premium-ledger: data/${FILE} exists but is unreadable (${e?.code ?? e}) — refusing to overwrite history. Restore it (R2/NAS) or delete it deliberately to re-seed.`);
      process.exit(1);
    }
  }
  if (raw != null) {
    try {
      existing = JSON.parse(raw) as VpLedgerFile;
    } catch {
      console.error(`vol-premium-ledger: data/${FILE} exists but does not parse — refusing to overwrite history. Restore it (R2/NAS) or delete it deliberately to re-seed.`);
      process.exit(1);
    }
  }
  const prevOpen: VpOpen[] = existing?.open ?? [];
  const closed: VpClosed[] = existing?.closed ?? [];

  // ── CLOSE / DISCARD / DEFER matured opens (decision is the pure, tested maturityDecision) ──────────
  const stillOpen: VpOpen[] = [];
  let closedNow = 0, discarded = 0, deferred = 0;
  for (const o of prevOpen) {
    const td = bizDaysBetween(o.entryDate, today);
    const rv = rvBy.get(o.symbol);
    switch (maturityDecision(td, coneOk, rv)) {
      case "hold-immature":
        stillOpen.push(o);
        break;
      case "discard-overhold":
        discarded++; // window no longer overlaps the hold — ungradeable
        break;
      case "grade": {
        const cap = capturedVolPts(o.atmIVEntry, rv!); // "grade" ⟹ rv is usable
        closed.push({ ...o, maturedDate: today, rvRealized: rv!, capturedVolPts: cap, capturedFrac: cap / o.atmIVEntry, won: cap > 0 });
        closedNow++;
        break;
      }
      case "defer":
        stillOpen.push(o); // matured, in [MATURE, MAX_HOLD] but cone stale / no usable RV — wait
        if (!coneOk) deferred++;
        break;
    }
  }

  // ── OPEN new picks (cooldown: no open dup, none closed inside the window) ─────────────────────────
  const openSyms = new Set(stillOpen.map((o) => o.symbol));
  const lastClose = new Map<string, string>();
  for (const c of closed) {
    const prev = lastClose.get(c.symbol);
    if (!prev || c.maturedDate > prev) lastClose.set(c.symbol, c.maturedDate);
  }
  let openedNow = 0;
  for (const r of pickSellCandidates(disloc.rows)) {
    if (openSyms.has(r.symbol)) continue;
    const lc = lastClose.get(r.symbol);
    if (lc && calDaysBetween(lc, today) < RELOG_COOLDOWN_DAYS) continue;
    stillOpen.push({
      symbol: r.symbol, name: r.name, sector: r.sector, entryDate: today,
      atmIVEntry: r.atmIV, rvolEntry: r.rvol, ivPremiumEntry: r.ivPremium, pctileEntry: r.pctile, priceEntry: r.price,
    });
    openSyms.add(r.symbol);
    openedNow++;
  }

  // Bound the closed history (newest kept) — but NEVER evict a close still inside the cooldown window.
  // The cooldown map is rebuilt from the PERSISTED `closed` each run, so dropping a recent close would
  // let that name re-open early (findings 8/9/11). In-cooldown closes are the newest, so this only
  // widens the file in an extreme high-turnover regime; it makes cooldown correctness independent of CAP.
  closed.sort((a, b) => (a.maturedDate < b.maturedDate ? 1 : a.maturedDate > b.maturedDate ? -1 : 0));
  const closedKept = closed.filter((c, i) => i < CLOSED_CAP || calDaysBetween(c.maturedDate, today) < RELOG_COOLDOWN_DAYS);

  const out: VpLedgerFile = {
    generatedAt: new Date().toISOString(),
    open: stillOpen.sort((a, b) => b.pctileEntry - a.pctileEntry),
    closed: closedKept,
    stats: computeStats(closedKept),
  };

  const w = await writeFeedGuarded(FILE, out);
  if (!w.written) { console.error(`refresh-vol-premium-ledger: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  const s = out.stats;
  console.log(
    `vol-premium-ledger: +${openedNow} opened, ${closedNow} closed, ${discarded} discarded` +
    (deferred ? `, ${deferred} deferred (cone stale — ${cone?.generatedAt?.slice(0, 10) ?? "missing"} vs ${today})` : "") +
    ` · ${out.open.length} open / ${closedKept.length} closed` +
    (s ? ` · hit ${(s.hitRate * 100).toFixed(0)}% · median captured ${(s.medianCaptured * 100).toFixed(1)} vol-pts` : " · (grading accrues)"),
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
