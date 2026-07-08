export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

// Per-currency display rules. `sym` is the price symbol (prefix unless `suffix`);
// `dec` overrides decimals; `cap` overrides the symbol for large amounts. UK quotes
// are a special case: prices are in pence (GBp → "p" suffix) but market caps are in
// pounds (£), so GBp carries cap:"£".
const CURRENCIES: Record<string, { sym: string; suffix?: boolean; dec?: number; cap?: string }> = {
  USD: { sym: "$" },
  EUR: { sym: "€" },
  GBP: { sym: "£" },
  GBp: { sym: "p", suffix: true, cap: "£" },
  JPY: { sym: "¥", dec: 0 },
  KRW: { sym: "₩", dec: 0 },
  CAD: { sym: "C$" },
  CHF: { sym: "CHF " },
  HKD: { sym: "HK$" },
  MXN: { sym: "Mex$" },
};
const curOf = (c?: string) => CURRENCIES[c || "USD"] ?? CURRENCIES.USD;

/** Currency symbol used for big amounts (market cap) in a currency. */
export function currencyPrefix(currency = "USD"): string {
  const c = curOf(currency);
  return c.cap ?? (c.suffix ? "" : c.sym);
}

export function fmtMarketCap(v: number | null | undefined, currency = "USD"): string {
  if (!v || Number.isNaN(v)) return "—";
  const sym = currencyPrefix(currency);
  const a = Math.abs(v);
  if (a >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${v.toFixed(0)}`;
}

/** Bare formatted number (no currency symbol), 2 decimals by default. */
export function fmtPrice(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

/** A price with its currency symbol, e.g. "$134.14", "€499.25", "2,993.50p". */
export function fmtMoney(v: number | null | undefined, currency = "USD", dec?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const c = curOf(currency);
  const num = fmtPrice(v, dec ?? c.dec ?? 2);
  return c.suffix ? `${num}${c.sym}` : `${c.sym}${num}`;
}

/** Standard user-facing date: "Jul 1, 2026" (pass {year:false} for "Jul 1" in space-tight cells).
 *  A bare YYYY-MM-DD is a CALENDAR DATE: it's pinned to UTC so it can't render one day early in US
 *  browsers (JS parses it as UTC midnight, and local formatting shifts it back). Timestamps and Date
 *  objects are moments in time and keep local rendering. */
export function fmtDate(d: string | number | Date, opts?: { year?: boolean }): string {
  try {
    const bareDay = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
    const dt = d instanceof Date ? d : new Date(bareDay ? d + "T00:00:00Z" : d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(bareDay ? { timeZone: "UTC" } : {}), ...(opts?.year === false ? {} : { year: "numeric" }) });
  } catch {
    return String(d);
  }
}

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Freshness stamp for a nightly-generated feed: the GENERATION date (pass an ISO `generatedAt`),
 * rendered in US-Eastern (the market day). Use for an "as of <date>" on feeds that rebuild nightly so
 * a fresh feed shows a CURRENT date — instead of printing a lookback-window start (e.g. the Morning
 * Desk Note's overnight "since Jul 1"), which reads as stale even right after a rebuild. ET, not UTC,
 * so a note written ~6–8pm ET doesn't render as "tomorrow" to a US reader. Returns "" on a bad value.
 */
export function fmtFresh(isoGeneratedAt: string): string {
  try {
    const dt = new Date(isoGeneratedAt);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  } catch {
    return "";
  }
}
