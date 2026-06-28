// Smart-Money Radar — who's quietly accumulating. Cross-references super-investor 13F
// initiations/adds with Congress net-buying to surface the names informed buyers are building,
// and flags those being bought ON WEAKNESS ("buying the dip"). Pure/client-safe: the page loads
// the snapshots (server) and hands them here. No LLM — it's a transparent follow-the-money board.

import type { SuperInvestorsData } from "./superinvestors";
import type { CongressData } from "./congress";

export interface SmartBuyer {
  manager: string;
  action: "initiated" | "added";
  deltaPct: number | null;
}
export interface SmartMoneyName {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  retYtd: number | null;
  pctFromHigh: number | null;
  investors: SmartBuyer[]; // super-investors who added/initiated last quarter
  congress: { buys: number; sells: number; members: number } | null; // net Congress buying (≤150d)
  score: number;
  buyingDip: boolean; // accumulated while down YTD or well off its highs
}

interface Ctx { name?: string; sector?: string | null; marketCap?: number | null; price?: number | null; returns?: Record<string, number | null>; pctFromHigh?: number | null }

export function buildSmartMoney(
  si: SuperInvestorsData | null,
  cong: CongressData | null,
  ctxBy: Map<string, Ctx>,
  opts: { congressDays?: number } = {},
): SmartMoneyName[] {
  const congressDays = opts.congressDays ?? 150;

  // 13F initiations + adds, per ticker
  const byTicker = new Map<string, { investors: SmartBuyer[]; cong: { buys: number; sells: number; members: Set<string> } | null }>();
  const slot = (t: string) => {
    let e = byTicker.get(t);
    if (!e) { e = { investors: [], cong: null }; byTicker.set(t, e); }
    return e;
  };
  for (const inv of si?.investors || []) {
    for (const b of inv.newBuys || []) if (b.ticker) slot(b.ticker).investors.push({ manager: inv.manager, action: "initiated", deltaPct: null });
    for (const a of inv.topAdds || []) if (a.ticker) slot(a.ticker).investors.push({ manager: inv.manager, action: "added", deltaPct: a.deltaPct ?? null });
  }

  // Congress net buyers over the window
  const cutoff = Date.now() - congressDays * 86_400_000;
  for (const tr of cong?.trades || []) {
    if (!tr.ticker || Date.parse(tr.txDate) < cutoff) continue;
    const e = slot(tr.ticker);
    if (!e.cong) e.cong = { buys: 0, sells: 0, members: new Set() };
    if (tr.type === "buy") e.cong.buys++;
    else if (tr.type === "sell") e.cong.sells++;
    e.cong.members.add(tr.member);
  }

  const out: SmartMoneyName[] = [];
  for (const [symbol, e] of byTicker) {
    const congNet = e.cong && e.cong.buys > e.cong.sells && e.cong.buys >= 2
      ? { buys: e.cong.buys, sells: e.cong.sells, members: e.cong.members.size }
      : null;
    // De-dupe investors (one entry per manager, prefer "initiated")
    const seen = new Map<string, SmartBuyer>();
    for (const b of e.investors) {
      const prev = seen.get(b.manager);
      if (!prev || (b.action === "initiated" && prev.action === "added")) seen.set(b.manager, b);
    }
    const investors = [...seen.values()];
    if (!investors.length && !congNet) continue; // no informed buying → drop

    const c = ctxBy.get(symbol);
    const retYtd = c?.returns?.["ytd"] ?? null;
    const pctFromHigh = c?.pctFromHigh ?? null;
    const initiations = investors.filter((i) => i.action === "initiated").length;
    let score = initiations * 2 + investors.filter((i) => i.action === "added").length * 1.2;
    if (investors.length >= 2) score += 1;
    if (congNet) score += Math.min(congNet.buys - congNet.sells, 6) * 0.5 + (congNet.members >= 2 ? 0.5 : 0);
    const buyingDip = (investors.length > 0 || !!congNet) && ((retYtd != null && retYtd < 0) || (pctFromHigh != null && pctFromHigh <= -15));
    if (buyingDip) score += 0.8;

    out.push({
      symbol,
      name: c?.name || symbol,
      sector: c?.sector ?? null,
      marketCap: c?.marketCap ?? null,
      price: c?.price ?? null,
      retYtd,
      pctFromHigh,
      investors: investors.sort((a, b) => (a.action === b.action ? 0 : a.action === "initiated" ? -1 : 1)),
      congress: congNet,
      score: Math.round(score * 10) / 10,
      buyingDip,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.investors.length - a.investors.length || (b.marketCap ?? 0) - (a.marketCap ?? 0));
}
