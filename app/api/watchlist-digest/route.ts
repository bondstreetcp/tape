import { NextRequest, NextResponse } from "next/server";
import { askConfigured, askGemini } from "@/lib/ask";
import { getNews } from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mv = (v: number | null | undefined) => (v == null ? null : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

interface Item { symbol: string; name?: string; chg1d?: number | null; chgWk?: number | null; earnings?: string | null }

export async function POST(req: NextRequest) {
  if (!askConfigured()) return NextResponse.json({ configured: false });
  let body: { items?: Item[] } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (!items.length) return NextResponse.json({ configured: true, error: "Your watchlist is empty." });

  try {
    const enriched = await Promise.all(
      items.map(async (it) => {
        const news = await getNews(it.name || it.symbol, 3).catch(() => []);
        return { ...it, heads: news.slice(0, 2).map((n: any) => `${n.title} (${n.publisher})`) };
      }),
    );
    const lines = enriched.map((it) => {
      const moves = [mv(it.chg1d) && `${mv(it.chg1d)} today`, mv(it.chgWk) && `${mv(it.chgWk)} wk`].filter(Boolean).join(", ");
      const earn = it.earnings ? `; earnings ${String(it.earnings).slice(0, 10)}` : "";
      const heads = it.heads.length ? ` — ${it.heads.join("; ")}` : "";
      return `${it.symbol} (${it.name}): ${moves || "flat"}${earn}${heads}`;
    });
    const ctx = lines.join("\n");
    const question =
      `Write a tight, scannable daily digest of the watchlist in the data above. ` +
      `Lead with the biggest movers and WHY (tie each to the headlines/events; use the web to clarify anything ambiguous), ` +
      `flag any names with earnings coming up soon, and note any shared themes across the names. ` +
      `Be specific and skip names that did nothing notable. Use brief markdown. Don't give buy/sell advice.`;
    const result = await askGemini(question, { name: "your watchlist", text: ctx });
    return NextResponse.json({ configured: true, digest: result?.answer ?? null, sources: result?.sources ?? [], count: items.length });
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: String(e?.message || e).slice(0, 200) });
  }
}
