import { NextRequest, NextResponse } from "next/server";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Supply-chain / customer-supplier map (FactSet RKD / Bloomberg SPLC-style). LLM-generated from the
// model's knowledge of the company's value chain, with public tickers where the entity is listed so
// the read-throughs are clickable. Button-triggered; cached a day (relationships change slowly).
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const name = req.nextUrl.searchParams.get("name") || sym;
  if (!(await llmConfigured())) return NextResponse.json({ configured: false });
  try {
    const SYSTEM =
      "Map a company's supply chain the way FactSet's Revere (RKD) or Bloomberg SPLC would. Using your knowledge of the company's value chain, return: " +
      "'customers' — who buys its products/services (end-customers or major named accounts), each with a public 'ticker' if listed (else '') and a one-line 'note'; " +
      "'suppliers' — who it depends on for inputs/components/services, with ticker + note; " +
      "'concentration' — one line on any customer or supplier concentration risk (e.g. a single customer that's a large % of revenue), or note if it's diversified; " +
      "'readThrough' — one line: whose results to watch as a read-through for THIS company (and vice versa). " +
      "Prefer LISTED companies (give the US ticker) so the links are useful. Be accurate — if you're unsure a relationship is real, OMIT it rather than guess. Return 4-8 customers and 4-8 suppliers where known. " +
      NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"customers": [{"name": string, "ticker": string, "note": string}], "suppliers": [{"name": string, "ticker": string, "note": string}], "concentration": string, "readThrough": string}';
    const out = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nCompany: ${name} (ticker ${sym}).`, { maxTokens: 3000, model: PRO_MODEL, reasoningEffort: "low" });
    if (!out || (!(Array.isArray(out.customers) && out.customers.length) && !(Array.isArray(out.suppliers) && out.suppliers.length))) {
      return NextResponse.json({ configured: true, available: false });
    }
    const node = (a: unknown) =>
      (Array.isArray(a) ? a : [])
        .filter((x: any) => x && typeof x.name === "string" && x.name.trim())
        .map((x: any) => ({ name: String(x.name).trim().slice(0, 60), ticker: typeof x.ticker === "string" ? x.ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 8) : "", note: typeof x.note === "string" ? x.note.trim().slice(0, 160) : "" }))
        .slice(0, 10);
    return NextResponse.json(
      {
        configured: true,
        available: true,
        customers: node(out.customers),
        suppliers: node(out.suppliers),
        concentration: typeof out.concentration === "string" ? out.concentration.trim() : "",
        readThrough: typeof out.readThrough === "string" ? out.readThrough.trim() : "",
      },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ configured: true, available: false, error: String(e?.message || e).slice(0, 200) });
  }
}
