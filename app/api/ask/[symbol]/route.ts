import { NextRequest, NextResponse } from "next/server";
import { askConfigured, gatherContext, askGemini } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") || "").trim();
  const name = p.get("name") || symbol;
  if (!askConfigured()) return NextResponse.json({ configured: false });
  if (!q) return NextResponse.json({ configured: true, answer: null, error: "Ask a question." });
  try {
    const ctx = await gatherContext(decodeURIComponent(symbol).toUpperCase(), name);
    const answer = await askGemini(q, ctx);
    return NextResponse.json({ configured: true, answer });
  } catch (e: any) {
    return NextResponse.json({ configured: true, answer: null, error: String(e?.message || e).slice(0, 200) });
  }
}
