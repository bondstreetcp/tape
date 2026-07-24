/**
 * Catalyst overlay — names with a LIVE disclosed strategic-alternatives / spin-off event, from the
 * nightly corp-events board. ONE derivation shared by the earnings-prep card (via computeQuant), the
 * nightly trade logger, and anything else that must know "is elevated IV here priced EVENT risk?".
 *
 * Extracted from scripts/refresh-trade-log.ts (2026-07-24, Sam): the flag used to be a display-only
 * annotation on logged plays; now it also WITHHOLDS the short-vol Play (lib/earningsTrade.tradeIdea) —
 * "implied rich vs realized" is a mispricing read, and when a known binary is why vol is bid, selling
 * it is selling event insurance at a price the market set on purpose. That required the lookup to live
 * where BOTH consumers reach it, and it cannot go in lib/corpEvents (client-imported) or lib/tradeLog
 * (client-safe by mandate) — both would drag fs into the client bundle.
 *
 * Server-only (fs). Best-effort: a missing corp-events.json just means no flags.
 */
import { promises as fsp } from "fs";
import path from "path";
import { eventResolved, classRoot, type CorpEventsData } from "@/lib/corpEvents";

export interface CatalystFlag {
  kind: "strategic-alt" | "spin-off";
  headline: string;
  date: string; // YYYY-MM-DD disclosure date
}

export interface CatalystOverlay {
  /** Exact ticker first, then the share-class root (BF-A event → BF-B lookup). */
  flagFor: (sym: string) => CatalystFlag | undefined;
  size: number;
}

const CATALYST_KINDS = new Set<string>(["strategic-alt", "spin-off"]);
const CATALYST_WINDOW_D = 120; // strategic reviews run months; older than this is likely resolved/stale
const DAY = 86_400_000;

export async function loadCatalystOverlay(nowMs: number = Date.now()): Promise<CatalystOverlay> {
  const byTicker = new Map<string, CatalystFlag>();
  try {
    const ce = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "corp-events.json"), "utf8")) as CorpEventsData;
    for (const ev of ce.events || []) {
      if (!ev.ticker || !CATALYST_KINDS.has(ev.type)) continue;
      const t = Date.parse(ev.date);
      if (!Number.isFinite(t) || nowMs - t > CATALYST_WINDOW_D * DAY) continue;
      const key = ev.ticker.toUpperCase();
      const prev = byTicker.get(key);
      if (!prev || t > Date.parse(prev.date)) {
        byTicker.set(key, { kind: ev.type as CatalystFlag["kind"], headline: ev.headline, date: ev.date.slice(0, 10) });
      }
    }
  } catch { /* board missing on this box — no flags */ }
  // Drop tickers whose MOST RECENT event reads RESOLVED (completed spin / concluded review / signed
  // deal). Filter AFTER most-recent selection: an older "announced" event must not resurrect a ticker
  // whose spin has since completed (the MIDD case).
  for (const [k, v] of byTicker) if (eventResolved(v.headline)) byTicker.delete(k);
  // Alias each surviving flag under its share-class ROOT: EDGAR stores the first-listed class (BF-A)
  // while snapshots trade the other (BF-B); exact key wins at lookup, roots are the fallback.
  for (const [k, v] of [...byTicker]) {
    const root = classRoot(k);
    if (root !== k) {
      const prev = byTicker.get(root);
      if (!prev || Date.parse(v.date) > Date.parse(prev.date)) byTicker.set(root, v);
    }
  }
  return {
    flagFor: (sym: string) => byTicker.get(sym.toUpperCase()) ?? byTicker.get(classRoot(sym)),
    size: byTicker.size,
  };
}
