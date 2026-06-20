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
    const result = await askGemini(q, ctx);
    return NextResponse.json({ configured: true, answer: result?.answer ?? null, sources: result?.sources ?? [] });
  } catch (e: any) {
    return NextResponse.json({ configured: true, answer: null, error: String(e?.message || e).slice(0, 200) });
  }
}

// POST carries the prior Q&A so the model can answer follow-up questions in context.
export async function POST(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!askConfigured()) return NextResponse.json({ configured: false });
  let body: { q?: string; name?: string; history?: { q: string; a: string }[] } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const q = (body.q || "").trim();
  const name = body.name || symbol;
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!q) return NextResponse.json({ configured: true, answer: null, error: "Ask a question." });
  try {
    const ctx = await gatherContext(decodeURIComponent(symbol).toUpperCase(), name);
    const result = await askGemini(q, ctx, history);
    return NextResponse.json({ configured: true, answer: result?.answer ?? null, sources: result?.sources ?? [] });
  } catch (e: any) {
    return NextResponse.json({ configured: true, answer: null, error: String(e?.message || e).slice(0, 200) });
  }
}
