import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { buildPositioning } from "@/lib/positioning";

// Per-symbol slice of the Positioning Radar for the stock page's Options tab. Rolls up the same
// options-flow tape + catalyst feeds the /positioning board uses (buildPositioning), then returns just
// this name's row. Lazy (client-fetched only when the Options tab opens) so the stock page's own render
// stays light. Returns { error } when the name has no notable flow today — the widget then hides.
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const read = (f: string): Promise<any> =>
  fsp.readFile(path.join(process.cwd(), "data", f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  try {
    const [flow, earnings, biotech, investorDays] = await Promise.all([
      read("options-flow.json"),
      read("earnings-move.json"),
      read("biotech-catalysts.json"),
      read("catalyst-vol.json"),
    ]);
    if (!flow?.entries?.length) return NextResponse.json({ error: "no flow" }, { headers: { "Cache-Control": "public, s-maxage=300" } });
    const rows = buildPositioning(
      flow.entries,
      { earnings: earnings?.rows, biotech: biotech?.items, investorDays: investorDays?.rows },
      Date.now(),
    );
    const row = rows.find((r) => r.symbol === sym) ?? null;
    if (!row) return NextResponse.json({ error: "no positioning" }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
    return NextResponse.json({ row, generatedAt: flow.generatedAt ?? null }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
