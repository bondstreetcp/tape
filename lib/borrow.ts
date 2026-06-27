// Stock borrow availability & fee from IBorrowDesk — Interactive Brokers' securities-lending
// feed. Fetched live per stock page (borrow data moves intraday and only matters for the name
// you're viewing, so there's no snapshot). US listings only; intl tickers won't resolve.

export interface BorrowPoint {
  date: string;
  fee: number; // annualized borrow fee, %
  available: number; // shares available to borrow
}
export interface BorrowInfo {
  symbol: string;
  name: string | null;
  fee: number; // latest borrow fee, % annualized (IB floor ≈ 0.25 = easy / general collateral)
  available: number; // latest shares available to borrow
  rebate: number | null; // latest rebate rate, %
  marketCap: number | null;
  updated: string | null;
  stale: boolean; // IBorrowDesk flags availability as stale
  realTime: boolean;
  series: BorrowPoint[]; // recent daily fee/availability — for a sparkline + range
}

const HOST = "https://www.iborrowdesk.com/api/ticker/"; // the apex 301-redirects; hit www directly
// Non-US suffixes (our intl universes + majors). IBorrowDesk only covers US listings, so skip the
// fetch for these. US class shares (BRK.B / BRK.A) have single-letter suffixes and pass through.
const NON_US = /\.(PA|AS|L|DE|SW|TO|MX|KS|KQ|T|HK|MI|MC|F|SS|SZ|AX|NZ|SI|TW|SA|BR|VI|ST|HE|CO|OL|NS|BO)$/i;

export async function getBorrow(symbol: string): Promise<BorrowInfo | null> {
  const s = decodeURIComponent(symbol).trim().toUpperCase();
  if (!s || NON_US.test(s)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(HOST + encodeURIComponent(s), {
      headers: { "User-Agent": "Tape research (stock-chart-screener)", Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!j || j.errors || !Array.isArray(j.daily) || !j.daily.length) return null;
    const daily: any[] = j.daily;
    const last = daily[daily.length - 1];
    const series: BorrowPoint[] = daily
      .slice(-90)
      .map((d) => ({ date: d.date, fee: Number(d.fee) || 0, available: Number(d.available) || 0 }));
    return {
      symbol: j.symbol || s,
      name: j.name || null,
      fee: Number(j.latest_fee ?? last?.fee) || 0,
      available: Number(j.latest_available ?? last?.available) || 0,
      rebate: last?.rebate != null ? Number(last.rebate) : null,
      marketCap: j.latest_market_cap != null ? Number(j.latest_market_cap) : null,
      updated: j.updated || j.country_updated || last?.date || null,
      stale: !!j.available_stale,
      realTime: !!j.real_time,
      series,
    };
  } catch {
    return null; // network / abort / parse — treat as no data
  } finally {
    clearTimeout(timer);
  }
}

// Borrow-tightness tiers. IB's floor fee is ~0.25%; general-collateral (easy-to-borrow) names sit
// near it. Specials (hard-to-borrow) command higher fees and thin availability.
export function borrowTier(fee: number): { label: string; color: string } {
  if (fee >= 20) return { label: "Very hard to borrow", color: "#ef4444" };
  if (fee >= 5) return { label: "Hard to borrow", color: "#f59e0b" };
  if (fee >= 1) return { label: "Moderate", color: "#eab308" };
  return { label: "Easy to borrow", color: "#22c55e" };
}
