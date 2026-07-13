/**
 * Builds data/signal-log.json — the Signal Track Record's forward-accumulating log. Each nightly run:
 *   1. rebuilds every idea board with the SAME lib builders its page uses (logger == board by
 *      construction — the 2026-07-07 earningsTrade lesson: never compute the same signal twice),
 *   2. logs a new event for each name that APPEARED on a board since the last run (30d re-log cooldown;
 *      the very first run per signal seeds the whole board, flagged `seed`),
 *   3. fills any due 1w/1m/3m marks (entry-anchored calendar horizons) with today's snapshot price +
 *      the S&P 500 close as the benchmark leg.
 * FORWARD-ONLY: the file only ever grows; the script aborts rather than write fewer events than it
 * read (history is unrebuildable). Runs in the FULL nightly AFTER confluence/warnings are refreshed.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { loadSnapshot } from "../lib/data";
import { buildSmartMoney } from "../lib/smartMoney";
import { buildSmartMoneySell } from "../lib/smartMoneySell";
import { buildSqueeze } from "../lib/shortSqueeze";
import { buildRevisions, type EstimatesFile } from "../lib/revisions";
import { buildLeaders } from "../lib/leaders";
import { buildInsiderBuys, type InsidersFile } from "../lib/insiders";
import { fuseVolGamma } from "../lib/volGamma";
import { buildPositioning } from "../lib/positioning";
import { loadSuperInvestors } from "../lib/superinvestors";
import { loadCongress } from "../lib/congress";
import {
  pickNewEntries, applyDueMarks, SIGNAL_KEYS, type MemberInput, type SignalEvent, type SignalKey,
  type SignalLogFile,
} from "../lib/signalLog";
import type { Snapshot } from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "signal-log.json");

const readJson = async <T,>(f: string): Promise<T | null> =>
  fsp.readFile(path.join(DATA, f), "utf8").then((s) => JSON.parse(s) as T).catch(() => null);

// Board universe: the broadest US snapshot (same chain the insiders page uses) — the builders run on
// ONE universe's stocks. Prices/context, though, come from the UNION of every US snapshot: some board
// names live outside the Russell 3000 (e.g. MELI is S&P 500 but foreign-incorporated, so not Russell)
// and would otherwise be silently dropped from the log for lack of an entry price.
const US_UNIVERSES = ["russell3000", "broad1500", "russell1000", "sp1500", "sp500", "nasdaq100"] as const;

async function loadBroadUs(): Promise<Snapshot | null> {
  for (const u of US_UNIVERSES) {
    const snap = await loadSnapshot(u);
    if (snap?.stocks?.length) return snap;
  }
  return null;
}

async function loadUsUnion(): Promise<Map<string, any>> {
  const by = new Map<string, any>(); // first snapshot wins per symbol (broadest first)
  for (const u of US_UNIVERSES) {
    const snap = await loadSnapshot(u).catch(() => null);
    for (const s of snap?.stocks ?? []) if (s?.symbol && !by.has(s.symbol)) by.set(s.symbol, s);
  }
  return by;
}

// Today's S&P 500 close — the benchmark leg stored on every entry and mark. Null on failure (events
// still log; move-direction grading just skips them).
async function spxClose(): Promise<number | null> {
  try {
    const ch: any = await yf.chart("^GSPC", { period1: new Date(Date.now() - 10 * 86_400_000), interval: "1d" } as any, { validateResult: false });
    const closes = (ch?.quotes || []).map((q: any) => q?.close).filter((c: any) => typeof c === "number" && c > 0);
    return closes.length ? closes[closes.length - 1] : null;
  } catch {
    return null;
  }
}

const cap = <T,>(xs: T[], n: number) => xs.slice(0, n);

async function main() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const snap = await loadBroadUs();
  if (!snap?.stocks?.length) { console.error("signal-log: no US snapshot — aborting."); process.exit(1); }
  const stocks = snap.stocks as any[];
  const union = await loadUsUnion();
  const ctxBy = new Map(stocks.map((s) => [s.symbol, s] as const)); // board-universe context (builders)
  const priceBy = new Map([...union.values()].filter((s) => s.price > 0).map((s) => [s.symbol, s.price] as const));

  // ── Rebuild every board exactly as its page does ────────────────────────────────────────────────
  const [confluence, warnings, estimates, insidersFile, si, cong, gamma, cone, flow, spx] = await Promise.all([
    readJson<{ names?: any[] }>("confluence.json"),
    readJson<{ names?: any[] }>("warnings.json"),
    readJson<EstimatesFile>("estimates.json"),
    readJson<InsidersFile>("insiders.json"),
    loadSuperInvestors(),
    loadCongress(),
    readJson<{ rows?: any[] }>("gamma-board.json"),
    readJson<{ rows?: any[] }>("vol-cone.json"),
    readJson<{ entries?: any[] }>("options-flow.json"),
    spxClose(),
  ]);

  const m = (r: { symbol: string; name?: string; sector?: string | null }, score?: number | null, note?: string, tags?: string[]): MemberInput =>
    ({ symbol: r.symbol, name: r.name || r.symbol, sector: r.sector ?? union.get(r.symbol)?.sector ?? null, score: score ?? null, note, ...(tags?.length ? { tags } : {}) });

  const membership: Partial<Record<SignalKey, MemberInput[]>> = {};
  // Artifact-backed boards: the file IS the board (already floored/sorted by its refresh script).
  // Their kinds ride along as TAGS so the record can attribute performance per stacked signal.
  // ⚠ The cap MUST cover the engines' BOARD_MAX (60) — a lower cap silently un-logs the board's tail
  // (ranks 41-60 never graded, no since-flagged line, entry prices mis-based when a name climbs in),
  // breaking the "logger == card" doctrine and the boards' "appearances are logged" claim.
  if (confluence?.names?.length) membership.confluence = cap(confluence.names, 60).map((n) => m(n, n.score, `${(n.kinds || []).length} signals`, n.kinds));
  if (warnings?.names?.length) membership.warnings = cap(warnings.names, 60).map((n) => m(n, n.score, `${(n.kinds || []).length} signals`, n.kinds));
  // Page-load-computed boards: same builders, same inputs, the board's own headline ranking.
  if (si) {
    membership.smartmoney = cap(buildSmartMoney(si, cong, ctxBy), 25).map((n) => m(n, n.score, `${n.investors.length} buyers`));
    membership.distribution = cap(buildSmartMoneySell(si, ctxBy), 25).map((n) => m(n, n.score, `${n.exitedN} exited / ${n.trimmedN} trimmed`));
  }
  if (estimates) {
    membership.squeeze = cap(buildSqueeze(estimates, stocks as any).rows, 25).map((r) => m(r, r.score));
    membership.revisions = cap(buildRevisions(estimates, stocks as any).rows, 25).map((r) => m(r, r.score));
  }
  membership.leaders = cap(buildLeaders(stocks as any).filter((r) => r.breakout), 25).map((r) => m(r, r.rs, "breakout"));
  if (insidersFile) membership.insiders = cap(buildInsiderBuys(insidersFile, stocks as any).rows, 25).map((r: any) => m(r, r.clusterScore ?? null, `${r.buyers} buyers`));
  if (gamma?.rows?.length && cone?.rows?.length) {
    const fused = fuseVolGamma(gamma.rows as any, cone.rows as any).filter((r) => r.setup === "coiled");
    fused.sort((a, b) => (b.springScore ?? -1) - (a.springScore ?? -1));
    membership.coiled = cap(fused, 25).map((r) => m(r as any, r.springScore != null ? Math.round(r.springScore) : null, "coiled"));
  }
  if (flow?.entries?.length) {
    // Catalyst feeds don't affect lean/OTM premiums, so the membership criterion is identical without
    // them. Ranked exactly like the board's own lenses: Bullish = OTM CALL premium desc, Bearish = OTM
    // PUT premium desc (NOT dirPrem, where the other side's premium could boost a name's rank).
    const rows = buildPositioning(flow.entries as any, {}, Date.now());
    membership["positioning-bull"] = cap(rows.filter((r) => r.lean === "calls").sort((a, b) => b.otmCallPrem - a.otmCallPrem), 20)
      .map((r) => m({ symbol: r.symbol, name: r.name }, null, `$${(r.otmCallPrem / 1e6).toFixed(1)}M OTM calls`));
    membership["positioning-bear"] = cap(rows.filter((r) => r.lean === "puts").sort((a, b) => b.otmPutPrem - a.otmPutPrem), 20)
      .map((r) => m({ symbol: r.symbol, name: r.name }, null, `$${(r.otmPutPrem / 1e6).toFixed(1)}M OTM puts`));
  }

  // ── Load the existing log (forward-only). A file that EXISTS but doesn't parse is a partial write
  // or corrupted hydration — abort loudly rather than treat it as a first run and seed OVER history.
  let existing: SignalLogFile | null = null;
  try {
    const raw = await fsp.readFile(FILE, "utf8").catch(() => null);
    if (raw != null) existing = JSON.parse(raw) as SignalLogFile;
  } catch {
    console.error("signal-log: data/signal-log.json exists but is unreadable — refusing to overwrite history. Restore it (R2/NAS) or delete it deliberately to re-seed.");
    process.exit(1);
  }
  const events: SignalEvent[] = existing?.events ?? [];
  const lastMembership = existing?.lastMembership ?? {};
  const lastSeen = existing?.lastSeen ?? {};
  const priorCount = events.length;

  // ── Log new appearances ─────────────────────────────────────────────────────────────────────────
  let newN = 0, skippedNoPrice = 0;
  for (const signal of SIGNAL_KEYS) {
    const current = membership[signal];
    if (!current) continue; // feed missing tonight → keep lastMembership so a one-night gap doesn't re-seed
    for (const { member, seed } of pickNewEntries(signal, current, lastMembership[signal], lastSeen[signal], events, todayISO)) {
      const entryPrice = priceBy.get(member.symbol);
      if (!(entryPrice && entryPrice > 0)) { skippedNoPrice++; continue; }
      events.push({
        id: `${signal}|${member.symbol}|${todayISO}`,
        signal, symbol: member.symbol, name: member.name, sector: member.sector ?? null,
        date: todayISO, entryPrice, spxEntry: spx,
        score: member.score ?? null, note: member.note,
        ...(member.tags?.length ? { tags: member.tags } : {}), ...(seed ? { seed: true } : {}), marks: {},
      });
      newN++;
    }
    // Record ONLY priced members: an unpriced name must keep looking "new" so it logs the first night
    // a price appears (recording it would block it forever). lastSeen anchors the flicker guard.
    const priced = current.filter((x) => (priceBy.get(x.symbol) ?? 0) > 0);
    lastMembership[signal] = priced.map((x) => x.symbol);
    const seenMap = (lastSeen[signal] ??= {});
    for (const x of priced) seenMap[x.symbol] = todayISO;
  }

  // ── Fill due marks ──────────────────────────────────────────────────────────────────────────────
  const filled = applyDueMarks(events, priceBy, spx, todayISO);

  if (events.length < priorCount) { console.error(`signal-log: would SHRINK ${priorCount} → ${events.length} — aborting.`); process.exit(1); }

  const out: SignalLogFile = {
    generatedAt: new Date().toISOString(),
    since: existing?.since ?? todayISO,
    events,
    lastMembership,
    lastSeen,
  };
  await fsp.writeFile(FILE, JSON.stringify(out));

  const perSignal = SIGNAL_KEYS.map((k) => `${k}:${membership[k]?.length ?? "—"}`).join(" ");
  console.log(`signal-log: ${events.length} events (+${newN} new, ${filled} marks filled${skippedNoPrice ? `, ${skippedNoPrice} skipped no-price` : ""}) · spx ${spx ?? "n/a"}`);
  console.log(`  membership → ${perSignal}`);
}

main().catch((e) => { console.error("signal-log:", String(e?.message || e)); process.exit(1); });
