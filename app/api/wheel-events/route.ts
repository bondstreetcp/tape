import { NextRequest, NextResponse } from "next/server";
import { yahoo } from "@/lib/yahooClient";

// Next earnings date + ex-dividend date per symbol, for the Wheel Tracker's "Manage now" queue (an open
// short call that's ITM into an ex-div faces early assignment; any short leg spanning an earnings print
// carries event risk). /api/quote can't carry the ex-div date — it comes from Yahoo's calendarEvents
// (quoteSummary), so this fetches it per symbol (bounded to the handful in a wheel book). Dates only.
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const iso = (d: unknown): string | null => {
  const t = d instanceof Date ? d.getTime() : typeof d === "number" ? d * (d < 1e12 ? 1000 : 1) : Date.parse(String(d));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") || "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 40);
  if (!symbols.length) return NextResponse.json({ events: [] });
  const events = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const qs: any = await yahoo.quoteSummary(symbol, { modules: ["calendarEvents"] } as any).catch(() => null);
        const ce = qs?.calendarEvents;
        const ed = ce?.earnings?.earningsDate;
        const first = Array.isArray(ed) ? ed[0] : ed;
        return { symbol, earningsDate: first ? iso(first) : null, exDivDate: ce?.exDividendDate ? iso(ce.exDividendDate) : null };
      } catch {
        return { symbol, earningsDate: null, exDivDate: null };
      }
    }),
  );
  return NextResponse.json({ events }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" } });
}
