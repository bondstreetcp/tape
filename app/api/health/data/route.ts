import { NextResponse } from "next/server";
import { checkFreshness } from "@/lib/dataFreshness";

// Live data-freshness health for the running deployment — the same registry the CI gate uses
// (lib/dataFreshness), surfaced over HTTP so an external uptime monitor can watch it. Returns 503
// (not 200) when any feed is stale/missing/empty, so a probe flags a degraded deploy. Never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const rep = await checkFreshness();
    return NextResponse.json(rep, { status: rep.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
