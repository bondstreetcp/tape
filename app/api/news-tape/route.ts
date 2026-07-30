import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { cachedFile } from "@/lib/jsonCache";
import { summariseTape, type TapeItem } from "@/lib/newsTape";

/**
 * The news tape's read endpoint. The page shell is static; freshness lives here, because the archive
 * is rewritten every few minutes and an ISR window would pin a stale render for its whole duration.
 *
 * ⚠ COST DISCIPLINE IS THE POINT OF THIS FILE. A live-updating tape is precisely the shape that took
 * the site offline once — a poller plus a dynamic endpoint burned through the Vercel Fluid-CPU
 * allowance. Three things keep it cheap, and none of them are optional:
 *
 *   1. `cachedFile` keys on mtime+size, so the 20k-row archive is parsed ONCE per data refresh, not
 *      once per request. Data written in place is picked up with no restart.
 *   2. The response is BOUNDED (`limit`, hard-capped) — never the whole archive.
 *   3. The client polls through usePolledFetch, which stops dead while the tab is hidden.
 *
 * Filtering runs over the in-memory array: a few hundred microseconds against 20k rows, versus the
 * JSON.parse that step 1 already eliminated.
 */
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "news-tape.json");
const MAX_LIMIT = 500;

interface TapeFile {
  generatedAt: string;
  latencyNote?: string;
  sourcesOk?: number;
  items: TapeItem[];
}

export async function GET(req: NextRequest) {
  const file = await cachedFile<TapeFile>(FILE, (raw) => JSON.parse(raw) as TapeFile);
  if (!file?.items?.length) {
    return NextResponse.json({ generatedAt: null, items: [], total: 0, note: "tape not built yet" });
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit") || 150)));
  const symbols = (sp.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const kinds = (sp.get("kinds") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const category = (sp.get("category") || "").trim();
  const q = (sp.get("q") || "").trim().toLowerCase();
  const since = sp.get("since");
  // Promo rows are archived but excluded by default — see isPromo. `includePromo=1` opts back in.
  const includePromo = sp.get("includePromo") === "1";
  // `taggedOnly` is the "just my market" view: rows we could attribute to a listed issuer.
  const taggedOnly = sp.get("taggedOnly") === "1";

  const symSet = new Set(symbols);
  const kindSet = new Set(kinds);

  const filtered = file.items.filter((i) => {
    if (!includePromo && i.kind === "promo") return false;
    if (taggedOnly && !i.symbol) return false;
    if (symSet.size && (!i.symbol || !symSet.has(i.symbol))) return false;
    if (kindSet.size && !kindSet.has(i.kind)) return false;
    if (category && i.category !== category) return false;
    if (since && i.at <= since) return false;
    if (q && !(i.headline.toLowerCase().includes(q) || (i.symbol || "").toLowerCase().includes(q))) return false;
    return true;
  });

  // Counts describe the FILTERED set the caller asked about, but `archiveTotal` reports the whole
  // archive so the UI can say "showing 150 of 18,402" rather than implying the tape is 150 rows long.
  const summary = summariseTape(filtered, Date.now());

  return NextResponse.json({
    generatedAt: file.generatedAt,
    latencyNote: file.latencyNote ?? null,
    sourcesOk: file.sourcesOk ?? null,
    archiveTotal: file.items.length,
    matched: filtered.length,
    ...summary,
    items: filtered.slice(0, limit),
  });
}
