import { NextResponse } from "next/server";
import { listDocs, storeAvailable } from "@/lib/research/store";
import { actionableSignals, actionableScan } from "@/lib/research/synthesize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  → ranked deterministic signals across the whole corpus (fast, no LLM).
// POST → LLM idea-generation digest ("what's actionable and why").
export async function GET() {
  if (!storeAvailable()) return NextResponse.json({ available: false, signals: [] });
  return NextResponse.json({ available: true, signals: actionableSignals(await listDocs()) });
}

export async function POST() {
  const docs = await listDocs();
  if (!docs.length) return NextResponse.json({ error: "no documents" });
  try {
    return NextResponse.json({ digest: await actionableScan(docs) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) });
  }
}
