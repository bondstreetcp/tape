import { NextResponse } from "next/server";
import { getMacroCached } from "@/lib/macroData";

// Economic series for the compare-chart overlay, from the committed macro snapshot
// (FRED is blocked from serverless, so we don't fetch it live here).
export const revalidate = 3600;

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    const m = await getMacroCached();
    // Prefer the indicator history (~5 years); fall back to the release history.
    const ind = m.indicators?.find((i) => i.key === key);
    let hist: [string, number][] | undefined = ind?.history;
    if (!hist || !hist.length) hist = m.releases?.[key]?.history;
    if (!hist || !hist.length) return NextResponse.json({ daily: [], intraday: [] });
    const daily = hist
      .map(([d, v]) => ({ t: Date.parse(d), c: v }))
      .filter((p) => Number.isFinite(p.t) && typeof p.c === "number");
    return NextResponse.json({ daily, intraday: [] });
  } catch {
    return NextResponse.json({ daily: [], intraday: [] });
  }
}
