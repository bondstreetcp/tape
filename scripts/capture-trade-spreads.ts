/**
 * Market-hours spread capture — the coverage fix for the liquidity screen.
 *
 * The nightly logger (refresh-trade-log) runs after hours (~01:00 UTC) when option books are thin
 * and one-sided, so it captures a two-sided quote on only ~1 in 6 plays — leaving most of the
 * sell-vol queue with no liquidity read. This step runs on the INTRADAY tick and, once per day per
 * play, re-fetches each awaiting-print play's chain during US market hours (when every liquid name
 * has a real two-sided market) and re-measures the spread on the play's exact strikes. Writes
 * `liveSpreadPct` (fresh mid vs crossed) + `spreadCapturedAt`; effectiveSpreadPct then prefers it
 * over the sparse after-hours number everywhere (chip, tier, wide-spread flag, tradeable sort).
 *
 * Does NOT touch entryCredit/entryCreditCrossed — the play still GRADES on its logged entry; this
 * only measures liquidity. Idempotent per calendar day (re-captures on a new day as the chain
 * fills in toward the print). No-op outside market hours. Run: npm run capture-trade-spreads.
 */
import { promises as fsp } from "fs";
import path from "path";
import { getOptions } from "../lib/options";
import { netCredit, crossedCredit, computeRiskFlags, type TradeLogData, type TradeRec, type TradeLeg } from "../lib/tradeLog";

const FILE = path.join(process.cwd(), "data", "trade-log.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** US market hours as a UTC window: 14:00–20:00 covers ~10:00–16:00 ET (EDT) / ~09:00–15:00 (EST),
 *  the settled mid-session where spreads are honest — not the open/close auctions. */
function inMarketHours(d: Date): boolean {
  const dow = d.getUTCDay();
  const h = d.getUTCHours();
  return dow >= 1 && dow <= 5 && h >= 14 && h < 20;
}

/** Re-price the play's legs from a fresh chain: mid = (bid+ask)/2, keep bid/ask for the crossed calc.
 *  Returns null unless EVERY leg has a two-sided quote on its strike (a half-book read is fiction). */
function freshLegs(rec: TradeRec, calls: { strike: number; bid: number | null; ask: number | null }[], puts: typeof calls): TradeLeg[] | null {
  const out: TradeLeg[] = [];
  for (const leg of rec.legs) {
    const book = leg.type === "C" ? calls : puts;
    const o = book.find((x) => x.strike === leg.strike);
    if (!o || o.bid == null || o.ask == null || !(o.bid > 0) || !(o.ask > 0)) return null;
    out.push({ ...leg, premium: +((o.bid + o.ask) / 2).toFixed(4), bid: o.bid, ask: o.ask });
  }
  return out;
}

async function main() {
  const now = new Date();
  if (!inMarketHours(now) && !process.env.FORCE_CAPTURE) {
    console.log("capture-spreads: outside US market hours — skip");
    return;
  }
  let data: TradeLogData;
  try { data = JSON.parse(await fsp.readFile(FILE, "utf8")); } catch {
    console.log("capture-spreads: no trade-log.json — nothing to capture");
    return;
  }
  const today = now.toISOString().slice(0, 10);
  const due = data.recs.filter(
    (r) => r.status === "awaiting_print" && Array.isArray(r.legs) && r.legs.length > 0 && (r.spreadCapturedAt ?? "").slice(0, 10) !== today,
  );
  if (!due.length) { console.log("capture-spreads: nothing due (all pre-print plays captured today)"); return; }

  let captured = 0, twoSided = 0;
  for (const rec of due) {
    if (!rec.expiry) continue;
    const chain = await getOptions(rec.symbol, rec.expiry).catch(() => null);
    await sleep(150); // pace the options endpoint
    rec.spreadCapturedAt = now.toISOString(); // stamp the attempt so a dead chain doesn't retry all day
    captured++;
    if (!chain || chain.selected !== rec.expiry) { rec.liveSpreadPct = null; continue; }
    const fresh = freshLegs(rec, chain.calls, chain.puts);
    if (!fresh) { rec.liveSpreadPct = null; continue; } // one-sided even intraday — genuinely illiquid
    const mid = netCredit(fresh);
    const xc = crossedCredit(fresh);
    if (xc == null || !(Math.abs(mid) > 0)) { rec.liveSpreadPct = null; continue; }
    rec.liveSpreadPct = +((mid - xc) / Math.abs(mid)).toFixed(4);
    rec.riskFlags = computeRiskFlags(rec); // re-derive wide-spread off the live read
    twoSided++;
  }
  data.generatedAt = now.toISOString();
  await fsp.writeFile(FILE, JSON.stringify(data));
  console.log(`capture-spreads: re-measured ${captured} pre-print plays · ${twoSided} got a live two-sided read (${captured - twoSided} still one-sided/illiquid)`);
}

main().catch((e) => { console.error("capture-trade-spreads failed:", e); process.exit(1); });
