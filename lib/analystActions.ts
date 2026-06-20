import YahooFinance from "yahoo-finance2";
import { loadSnapshot } from "./data";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
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
  const snap = await loadSnapshot(universe);
  if (!snap) return [];
  const top = [...snap.stocks].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, topN);
  const cutoff = Date.now() - days * 86_400_000;
  const out: AnalystAction[] = [];
  await pool(top, 8, async (s) => {
    try {
      const r: any = await yf.quoteSummary(s.symbol, { modules: ["upgradeDowngradeHistory"] as any }, { validateResult: false });
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
  return out.slice(0, 250);
}
