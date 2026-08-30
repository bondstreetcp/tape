/**
 * CLIENT-SAFE types + pure logic for the Wheel Tracker's cross-book "Manage now" queue. The tracker
 * knows each open short leg (a sold put waiting for assignment, or a covered call) — its strike + expiry.
 * Given the live underlying price, `wheelAlert` turns one position into a prioritized management flag:
 * expired / in-the-money (assignment risk) / roll window / near-the-strike (pin) / on-track. No fetch,
 * no Date coupling in tests (pass `nowMs`). The tracker fetches prices in one batch /api/quote call and
 * renders the queue sorted by severity. Decision support, not advice.
 */
export type Leg = "idle" | "put" | "shares" | "call";
export interface WheelPos {
  id: string;
  symbol: string;
  leg: Leg;
  shares: number;
  costBasis: number | null;
  premium: number;
  note: string;
  callStrike?: number | null;
  callExpiry?: string;
  putStrike?: number | null; // NEW: the sold-put's strike (the wheel's entry leg)
  putExpiry?: string; // NEW
}

export type ShortSide = "call" | "put";
export interface WheelAlert {
  side: ShortSide;
  strike: number;
  expiry: string;
  dte: number;
  price: number | null;
  moneynessPct: number | null; // signed %: >0 = the strike is IN the money (assignment side), <0 = OTM cushion
  severity: 0 | 1 | 2 | 3; // 3 act now · 2 roll · 1 watch · 0 on track
  flag: string;
  detail: string;
  action: string;
}

const DAY = 86_400_000;

/** The open SHORT option leg (with strike + expiry) this position carries, or null (idle / bare shares /
 *  a leg missing its strike-expiry details). */
export function shortLegOf(pos: WheelPos): { side: ShortSide; strike: number; expiry: string } | null {
  if (pos.leg === "call" && pos.callStrike != null && pos.callExpiry) return { side: "call", strike: pos.callStrike, expiry: pos.callExpiry };
  if (pos.leg === "put" && pos.putStrike != null && pos.putExpiry) return { side: "put", strike: pos.putStrike, expiry: pos.putExpiry };
  return null;
}

export function wheelAlert(pos: WheelPos, price: number | null, nowMs: number = Date.now()): WheelAlert | null {
  const leg = shortLegOf(pos);
  if (!leg) return null;
  const dte = Math.round((Date.parse(leg.expiry + "T00:00:00Z") - nowMs) / DAY);
  // moneyness on the ASSIGNMENT side: a short call is ITM when price > strike; a short put when price < strike.
  const itmPct = price == null ? null : leg.side === "call" ? ((price - leg.strike) / leg.strike) * 100 : ((leg.strike - price) / leg.strike) * 100;
  const itm = itmPct != null && itmPct > 0;
  const nearStrike = itmPct != null && Math.abs(itmPct) <= 2;
  const call = leg.side === "call";

  let severity: WheelAlert["severity"], flag: string, detail: string, action: string;
  if (dte < 0) {
    severity = 3; flag = "Expired";
    detail = `${leg.side} expired ${-dte}d ago`;
    action = itm ? (call ? "shares likely called away — reconcile the leg" : "likely assigned the shares — reconcile the leg") : "expired worthless — start the next leg";
  } else if (itm && dte <= 3) {
    severity = 3; flag = "ITM into expiry";
    detail = `${leg.side} ${itmPct!.toFixed(1)}% in the money, ${dte}d left`;
    action = call ? "roll up-and-out, or accept the call-away" : "roll down-and-out, or take assignment";
  } else if (itm) {
    severity = 2; flag = "In the money";
    detail = `${leg.side} ${itmPct!.toFixed(1)}% ITM, ${dte}d`;
    action = "watch — roll if it stays ITM toward expiry";
  } else if (dte <= 7) {
    severity = 2; flag = "Roll window";
    detail = `${dte}d to expiry${itmPct != null ? `, ${Math.abs(itmPct).toFixed(1)}% OTM` : ""}`;
    action = "roll to the next cycle to keep collecting";
  } else if (nearStrike && dte <= 14) {
    severity = 1; flag = "Near the strike";
    detail = `${Math.abs(itmPct!).toFixed(1)}% from the strike, ${dte}d`;
    action = "watch for a pin or breach into expiry";
  } else {
    severity = 0; flag = "On track";
    detail = itmPct != null ? `${Math.abs(itmPct).toFixed(1)}% OTM, ${dte}d` : `${dte}d to expiry`;
    action = "let it ride";
  }
  return { side: leg.side, strike: leg.strike, expiry: leg.expiry, dte, price, moneynessPct: itmPct, severity, flag, detail, action };
}

export const SEVERITY_META: Record<number, { label: string; color: string }> = {
  3: { label: "Act now", color: "#ef4444" },
  2: { label: "Roll", color: "#f59e0b" },
  1: { label: "Watch", color: "#eab308" },
  0: { label: "On track", color: "#22c55e" },
};
