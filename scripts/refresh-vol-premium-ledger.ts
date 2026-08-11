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
  MATURE_TD,
  MAX_HOLD_TD,
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
  // vol-cone gives per-name realized vol; cur20 (20-td RV) is the holding-window read.
  const cone = await readJson<{ rows?: { symbol: string; cur20?: number | null }[] }>("vol-cone.json");
  const rvBy = new Map<string, number>();
  for (const r of cone?.rows ?? []) if (r.symbol && r.cur20 != null && r.cur20 > 0) rvBy.set(r.symbol, r.cur20);

  // The pick's timestamp IS the source feed's stamp — one calendar anchor for entry and aging.
  const today = (disloc.generatedAt || new Date().toISOString()).slice(0, 10);

  // Load existing ledger. Exists-but-unreadable = corrupted hydration → abort, never seed over history.
  let existing: VpLedgerFile | null = null;
  try {
    const raw = await fsp.readFile(path.join(DATA, FILE), "utf8").catch(() => null);
    if (raw != null) existing = JSON.parse(raw) as VpLedgerFile;
  } catch {
    console.error(`vol-premium-ledger: data/${FILE} exists but is unreadable — refusing to overwrite history. Restore it (R2/NAS) or delete it deliberately to re-seed.`);
    process.exit(1);
  }
  const prevOpen: VpOpen[] = existing?.open ?? [];
  const closed: VpClosed[] = existing?.closed ?? [];

  // ── CLOSE / DISCARD matured opens ────────────────────────────────────────────────────────────────
  const stillOpen: VpOpen[] = [];
  let closedNow = 0, discarded = 0;
  for (const o of prevOpen) {
    const td = bizDaysBetween(o.entryDate, today);
    if (td < MATURE_TD) { stillOpen.push(o); continue; }
    const rv = rvBy.get(o.symbol);
    if (rv != null) {
      const cap = capturedVolPts(o.atmIVEntry, rv);
      closed.push({ ...o, maturedDate: today, rvRealized: rv, capturedVolPts: cap, capturedFrac: cap / o.atmIVEntry, won: cap > 0 });
      closedNow++;
    } else if (td <= MAX_HOLD_TD) {
      stillOpen.push(o); // matured but no RV yet — give it a grace window before giving up
    } else {
      discarded++; // ungradeable (dropped out of vol-cone) — discard rather than invent a number
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

  // Bound the closed history (newest kept).
  closed.sort((a, b) => (a.maturedDate < b.maturedDate ? 1 : a.maturedDate > b.maturedDate ? -1 : 0));
  const closedKept = closed.slice(0, CLOSED_CAP);

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
    `vol-premium-ledger: +${openedNow} opened, ${closedNow} closed, ${discarded} discarded · ` +
    `${out.open.length} open / ${closedKept.length} closed` +
    (s ? ` · hit ${(s.hitRate * 100).toFixed(0)}% · median captured ${(s.medianCaptured * 100).toFixed(1)} vol-pts` : " · (grading accrues)"),
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
