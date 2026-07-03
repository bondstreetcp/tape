import { NextRequest, NextResponse } from "next/server";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// LLM-emitted tickers rendered as /stock/ links must pass an IDENTITY check — a real-but-wrong
// symbol (model says "Foxconn", emits TGT) would send users to another company's financials, cached
// for a day. Keep the ticker only when a universe snapshot knows it AND its name overlaps the
// node's name; otherwise blank the ticker (the entity still shows, just unlinked).
let symToName: Map<string, string> | null = null;
async function knownSymbols(): Promise<Map<string, string>> {
  if (symToName) return symToName;
  const m = new Map<string, string>();
  for (const u of Object.keys(UNIVERSE_BY_ID)) {
    const snap = await loadSnapshot(u).catch(() => null);
    for (const r of snap?.stocks ?? []) if (r.symbol && !m.has(r.symbol)) m.set(r.symbol, String(r.name || "").toLowerCase());
  }
  symToName = m;
  return m;
}
const nameMatches = (nodeName: string, snapName: string): boolean => {
  const toks = nodeName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !["corp", "corporation", "company", "holdings", "group", "inc", "technologies"].includes(t));
  return toks.length === 0 || toks.some((t) => snapName.includes(t));
};

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
    const known = await knownSymbols();
    const node = (a: unknown) =>
      (Array.isArray(a) ? a : [])
        .filter((x: any) => x && typeof x.name === "string" && x.name.trim())
        .map((x: any) => {
          const nm = String(x.name).trim().slice(0, 60);
          let tk = typeof x.ticker === "string" ? x.ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 8) : "";
          const snapName = tk ? known.get(tk) : undefined;
          if (tk && (snapName === undefined || !nameMatches(nm, snapName))) tk = ""; // unknown or identity-mismatched → unlink
          return { name: nm, ticker: tk, note: typeof x.note === "string" ? x.note.trim().slice(0, 160) : "" };
        })
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
