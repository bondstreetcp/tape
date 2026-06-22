import { NextRequest, NextResponse } from "next/server";
import { askConfigured, gatherContext, askGemini } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AI head-to-head verdict across 2–5 user-picked tickers (the Compare Stocks view).
// Gathers each company's context pack, then asks the model for a ranked, opinionated
// read — better business vs better value, with a bull/bear on each. Extends the two-name
// /api/ai-compare to N names.
export async function POST(req: NextRequest) {
  if (!askConfigured()) return NextResponse.json({ configured: false });
  let body: { symbols?: string[]; names?: string[] } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const seen = new Set<string>();
  const picks: { symbol: string; name: string }[] = [];
  (body.symbols || []).forEach((s, i) => {
    const sym = decodeURIComponent(String(s)).toUpperCase().trim();
    if (sym && !seen.has(sym)) { seen.add(sym); picks.push({ symbol: sym, name: body.names?.[i] || sym }); }
  });
  const sel = picks.slice(0, 5);
  if (sel.length < 2) return NextResponse.json({ configured: true, error: "Pick at least two different companies to compare." });

  try {
    const ctxs = await Promise.all(sel.map((p) => gatherContext(p.symbol, p.name)));
    const names = ctxs.map((c) => c.name);
    const list = names.join(", ");
    const combined = ctxs.map((c) => `=== DATA: ${c.name} ===\n${c.text}`).join("\n\n");
    const question =
      `Give a sharp, opinionated head-to-head verdict on these ${sel.length} companies: ${list}. ` +
      `Rank and compare them explicitly — don't hedge. Use clean markdown with exactly these sections:\n\n` +
      `**Snapshot** — one crisp sentence per company: what it does and its headline financial profile.\n\n` +
      `**Bull & bear** — for EACH company, a sub-heading with its ticker, then a one-line bull case and a one-line bear case.\n\n` +
      `**Better business** — which has the strongest economics (gross/operating margins, returns on capital, growth durability, competitive moat) and why; rank them.\n\n` +
      `**Better value** — which is most attractively priced *relative to* its growth and quality right now, and why; flag anything that looks expensive for what you get.\n\n` +
      `**Bottom line** — the overall take: which looks best-positioned and for what kind of investor, plus the 1–2 key swing factors to watch from here.\n\n` +
      `Cite specific numbers from the data (margins, growth, P/E, ROIC, leverage). Weave in current developments from the web where they change the picture.`;
    const result = await askGemini(question, { name: list, text: combined });
    return NextResponse.json({ configured: true, answer: result?.answer ?? null, sources: result?.sources ?? [] });
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: String(e?.message || e).slice(0, 200) });
  }
}
