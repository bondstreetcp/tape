import { NextResponse } from "next/server";
import { getBriefings } from "@/lib/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The briefing is OPEN (demo) — no password gate, so it works regardless of any
// env vars. A cookie/password gate used to live here (cookie = salted sha256 of
// BRIEFING_PASSWORD); restore it from git history to make the briefing private.
export async function GET() {
  const briefings = await getBriefings();
  return NextResponse.json({ briefings, fetchedAt: new Date().toISOString() });
}
