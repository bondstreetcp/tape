import { NextRequest, NextResponse } from "next/server";
import { askConfigured, gatherContext, askGemini } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AI head-to-head: gather each company's context pack, then ask the model to compare
// them across the standard dimensions.
export async function POST(req: NextRequest) {
  if (!askConfigured()) return NextResponse.json({ configured: false });
  let body: { symbols?: string[]; names?: string[] } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const symbols = (body.symbols || []).slice(0, 2).map((s) => decodeURIComponent(s).toUpperCase());
  const names = body.names || [];
  if (symbols.length < 2 || symbols[0] === symbols[1]) {
    return NextResponse.json({ configured: true, error: "Pick two different companies to compare." });
  }
  try {
    const ctxs = await Promise.all(symbols.map((s, i) => gatherContext(s, names[i] || s)));
    const a = ctxs[0].name, b = ctxs[1].name;
    const combined = ctxs.map((c) => `=== DATA: ${c.name} ===\n${c.text}`).join("\n\n");
    const question =
      `Compare ${a} and ${b} head-to-head. Use clear markdown sections: ` +
      `**Businesses** (what each does and how they overlap or differ), ` +
      `**Growth & margins** (with the numbers), ` +
      `**Valuation** (which is cheaper relative to its growth and quality, and why), ` +
      `**Balance sheet & risk**, and ` +
      `**Bottom line** (which looks better-positioned and for what kind of investor, plus the key swing factors). ` +
      `Be specific and balanced; reference current developments from the web where relevant.`;
    const result = await askGemini(question, { name: `${a} vs ${b}`, text: combined });
    return NextResponse.json({ configured: true, answer: result?.answer ?? null, sources: result?.sources ?? [] });
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: String(e?.message || e).slice(0, 200) });
  }
}
