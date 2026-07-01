/** Client-safe alert types + display maps, shared by the rule UI, the bell, and the evaluator. */
export type AlertKind = "price" | "event" | "earnings" | "signal";

export interface AlertRule {
  id: string;
  symbol: string | null; // null = applies to the whole watchlist
  kind: AlertKind;
  params: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface AlertEvent {
  id: string;
  rule_id: string | null;
  symbol: string | null;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  fired_at: string;
  read_at: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  price: "Price",
  event: "Filing / event",
  earnings: "Earnings",
  signal: "Signal",
};

export const KIND_COLOR: Record<string, string> = {
  price: "#22c55e",
  event: "#a78bfa",
  earnings: "#f59e0b",
  signal: "#38bdf8",
};

/** price-rule params: { above?: number; below?: number; pct?: number } — fire when last crosses a
 *  level or moves ±pct on the day. earnings: { daysBefore: number }. event: { types: string[] }.
 *  signal: { kind: 'cheap10y'|'rs_breakout'|'short_squeeze' }. Kept loose (jsonb) so rules evolve. */
