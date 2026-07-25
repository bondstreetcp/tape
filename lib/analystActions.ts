import { yahoo } from "./yahooClient";
import { loadSnapshot } from "./data";

const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v?.raw ?? null);

export interface AnalystAction {
  symbol: string;
  name: string;
  firm: string;
  action: string; // up | down | main | init | reit
  fromGrade: string;
  toGrade: string;
  targetFrom: number | null;
  targetTo: number | null;
  date: string;
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        await fn(items[k]);
      }
    }),
  );
}

/** Recent analyst rating changes across the largest names in a universe. */
export async function getAnalystActions(universe: string, topN = 140, days = 45): Promise<AnalystAction[]> {
  return (await getAnalystActionsDetailed(universe, topN, days)).actions;
}

/**
 * Same scan, but reporting COVERAGE — how many of the per-symbol fetches actually succeeded.
 *
 * Each of the ~140 quoteSummary calls swallows its own error (below), which is right for a display
 * feed but means a partial outage is indistinguishable from a quiet week: a 429 storm thins the
 * result to a handful of names and still returns a perfectly well-formed array. That matters now
 * that the route CACHES this for an hour — without a coverage signal it would pin a throttled scan
 * and quietly show an almost-empty board until the TTL expired. (Yahoo 429s are not even retried:
 * lib/yahooClient treats them as non-recoverable, since retrying a rate-limit just deepens it.)
 */
export async function getAnalystActionsDetailed(
  universe: string,
  topN = 140,
  days = 45,
): Promise<{ actions: AnalystAction[]; ok: number; attempted: number }> {
  const snap = await loadSnapshot(universe);
  if (!snap) return { actions: [], ok: 0, attempted: 0 };
  const top = [...snap.stocks].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, topN);
  const cutoff = Date.now() - days * 86_400_000;
  const out: AnalystAction[] = [];
  let ok = 0;
  await pool(top, 8, async (s) => {
    try {
      const r: any = await yahoo.quoteSummary(s.symbol, { modules: ["upgradeDowngradeHistory"] as any }, { validateResult: false });
      ok++; // the FETCH succeeded — a name with no recent actions still counts as covered
      for (const h of r.upgradeDowngradeHistory?.history || []) {
        const d = h.epochGradeDate ? new Date(h.epochGradeDate).getTime() : 0;
        if (!d || d < cutoff) continue;
        if (!h.firm) continue;
        out.push({
          symbol: s.symbol,
          name: s.name,
          firm: h.firm,
          action: String(h.action || ""),
          fromGrade: h.fromGrade || "",
          toGrade: h.toGrade || "",
          targetFrom: num(h.priorPriceTarget),
          targetTo: num(h.currentPriceTarget),
          date: new Date(d).toISOString().slice(0, 10),
        });
      }
    } catch {
      /* skip */
    }
  });
  out.sort((a, b) => b.date.localeCompare(a.date));
  return { actions: out.slice(0, 250), ok, attempted: top.length };
}
