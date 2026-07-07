import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YahooFinance from "yahoo-finance2";
import { buildCatalystPath, type StockCatalyst } from "@/lib/catalystPath";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Per-stock Catalyst Path — merges the app's forward event feeds (earnings + implied move, biotech
// PDUFA/readouts, IPO lockups, investor days) with the name's next-earnings + ex-dividend from Yahoo
// into one forward timeline. Read-only join over existing data; no LLM. US-oriented (the feeds are US).

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = join(process.cwd(), "data");
const readJson = <T,>(f: string): T | null => {
  try { const p = join(DATA, f); return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null; } catch { return null; }
};
const iso = (d: unknown): string => {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : (Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString().slice(0, 10) : "");
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();

  // Feeds (each filtered to this ticker).
  const em = readJson<{ rows?: any[] }>("earnings-move.json")?.rows?.find((r) => r.symbol === sym) ?? null;
  const bio = (readJson<{ items?: any[] }>("biotech-catalysts.json")?.items ?? []).filter((i) => i.ticker === sym);
  const ipo = (readJson<{ events?: any[] }>("ipo-monitor.json")?.events ?? []).filter((e) => e.ticker === sym && e.lockupDate);
  const cv = (readJson<{ rows?: any[] }>("catalyst-vol.json")?.rows ?? []).filter((r) => r.ticker === sym && r.eventDate);

  // Next earnings + ex-dividend from Yahoo (one call; the earnings-move feed only covers ≤16-day reporters).
  let earnDate: string | null = em?.earningsDate ? iso(em.earningsDate) : null;
  let exDiv: { date?: string | null; amount?: number | null } | null = null;
  try {
    const qs: any = await yf.quoteSummary(sym, { modules: ["calendarEvents", "summaryDetail"] } as any).catch(() => null);
    const ce = qs?.calendarEvents;
    if (!earnDate) {
      const ed = ce?.earnings?.earningsDate;
      const first = Array.isArray(ed) ? ed[0] : ed;
      if (first) earnDate = iso(first);
    }
    if (ce?.exDividendDate) exDiv = { date: iso(ce.exDividendDate), amount: qs?.summaryDetail?.dividendRate ? qs.summaryDetail.dividendRate / 4 : null };
  } catch { /* no quote */ }

  const path: StockCatalyst[] = buildCatalystPath({
    nowMs: Date.now(),
    earnings: earnDate ? { date: earnDate, implied: em?.impliedMovePct ?? null, estimate: em?.earningsEstimate ?? false } : null,
    biotech: bio
      .filter((i) => i.statusKind === "pdufa" || i.statusKind === "readout" || i.statusKind === "enrolling-done")
      .map((i) => ({
        date: i.primaryCompletion,
        kind: i.statusKind === "pdufa" ? ("pdufa" as const) : ("biotech" as const),
        label: i.statusKind === "pdufa" ? "FDA decision (PDUFA)" : `${i.phase || "Clinical"} readout`,
        detail: [i.drug, i.condition].filter(Boolean).join(" · ") || undefined,
        url: i.url,
      })),
    lockup: ipo.length ? { date: ipo[0].lockupDate, detail: ipo[0].ipoDate ? `IPO ${iso(ipo[0].ipoDate)}` : undefined, url: ipo[0].url } : null,
    investorDays: cv.map((r) => ({ date: r.eventDate, label: r.eventType || "Investor day", implied: r.impliedMovePct ?? null, url: r.url })),
    exDiv,
  });

  return NextResponse.json({ symbol: sym, path }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" } });
}
