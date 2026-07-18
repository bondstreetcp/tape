import { NextResponse } from "next/server";
import { yahoo } from "@/lib/yahooClient";


// Cache 5 min — this drives a banner, it doesn't need to be tick-by-tick.
export const revalidate = 300;

const SYMS = ["^GSPC", "^IXIC", "^DJI", "^VIX"];

/** A data-driven market-stress signal: fires only on real moves (sharp index
 *  moves or a volatility spike), with quantified, actionable text — replacing the
 *  old headline-regex "alert" that wasn't tied to anything actionable. */
export async function GET() {
  try {
    const qs = (await yahoo.quote(SYMS, {}, { validateResult: false })) as any[];
    const m = new Map<string, { price: number; pct: number | null }>();
    for (const q of qs) {
      if (q?.symbol && typeof q.regularMarketPrice === "number") {
        m.set(q.symbol, { price: q.regularMarketPrice, pct: q.regularMarketChangePercent ?? null });
      }
    }
    const eq: [string, { price: number; pct: number | null }][] = [];
    for (const [sym, name] of [["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^DJI", "Dow"]] as const) {
      const q = m.get(sym);
      if (q && q.pct != null) eq.push([name, q]);
    }
    const vix = m.get("^VIX");

    // Only flag genuine stress — a sharp sell-off or a real volatility spike. No
    // "watch"/"risk-on rally" noise on ordinary days (the banner stays hidden).
    let level: "alert" | null = null;
    let head = "";
    if (eq.length) {
      const worst = Math.min(...eq.map(([, q]) => q.pct!));
      if (worst <= -1.5) { level = "alert"; head = "Risk-off"; }
    }
    if (vix != null && (vix.price >= 30 || (vix.pct ?? 0) >= 20)) { level = "alert"; if (!head) head = "Volatility spike"; }

    if (!level) return NextResponse.json({ level: null });

    const bits: string[] = [];
    for (const [name, q] of eq) bits.push(`${name} ${q.pct! >= 0 ? "+" : ""}${q.pct!.toFixed(1)}%`);
    if (vix) bits.push(`VIX ${vix.price.toFixed(1)}${vix.pct != null ? ` (${vix.pct >= 0 ? "+" : ""}${vix.pct.toFixed(0)}%)` : ""}`);

    return NextResponse.json({ level, head, text: bits.join("  ·  "), asOf: new Date().toISOString() });
  } catch {
    return NextResponse.json({ level: null });
  }
}
