import { NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/data";
import { getNews, pickHeadlines } from "@/lib/news";
import { detectRecentReport } from "@/lib/preannounce";
import { loadCatalystOverlay } from "@/lib/catalystOverlay";
import { pool } from "@/lib/edgar";
import { memo } from "@/lib/memoCache";
import { normalizeSyms, orderWire, type WatchlistWireData, type WireName } from "@/lib/watchlistWire";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The watchlist is client-side state (localStorage / per-user table), so the server can't bake this
// nightly — the client sends its symbols and this route joins them against what the server knows:
// snapshot rows (name + 1d move), the freshest dated headlines, the results-8-K "reported" fact,
// and the live catalyst flag. Everything degrades per-name; one dead vendor never blanks the wire.

const WINDOW_DAYS = 3; // a morning wire cares about the last ~3 sessions (weekend-inclusive)

async function broadUs(): Promise<Snapshot | null> {
  for (const u of ["russell3000", "broad1500", "russell1000", "sp1500", "sp500"]) {
    const s = await loadSnapshot(u).catch(() => null);
    if (s?.stocks?.length) return s;
  }
  return null;
}

export async function GET(req: Request) {
  const syms = normalizeSyms(new URL(req.url).searchParams.get("syms") ?? "");
  if (!syms.length) return NextResponse.json({ generatedAt: new Date().toISOString(), names: [] } satisfies WatchlistWireData, { headers: { "Cache-Control": "no-store" } });

  // 10-min memo keyed on the exact symbol set — repeat desk visits are free; two users sharing a
  // watchlist share the compute. Only cached when at least one name resolved (never pin a failure).
  const key = `wlwire:${[...syms].sort().join(",")}`;
  const data = await memo(
    key,
    600_000,
    async (): Promise<WatchlistWireData> => {
      const now = Date.now();
      const [snap, overlay] = await Promise.all([broadUs(), loadCatalystOverlay().catch(() => null)]);
      const bySym = new Map((snap?.stocks ?? []).map((s) => [s.symbol, s]));
      const names = await pool(syms, 6, async (sym): Promise<WireName> => {
        const row = bySym.get(sym);
        const [newsRaw, reported] = await Promise.all([
          getNews(row?.name || sym, 30).catch(() => []),
          detectRecentReport(sym, now).catch(() => null),
        ]);
        const picked = pickHeadlines(newsRaw, { nowMs: now, windowDays: WINDOW_DAYS, limit: 3 });
        // pickHeadlines returns {title,date} (the selection doctrine); join back for publisher/link.
        const headlines = picked.map((p) => {
          const src = newsRaw.find((n) => n.title === p.title);
          return { title: p.title, date: p.date, publisher: src?.publisher ?? "", link: src?.link ?? null };
        });
        const flag = overlay?.flagFor(sym) ?? null;
        return {
          symbol: sym,
          name: row?.name ?? null,
          pct1d: row?.returns?.["1d"] ?? null,
          reported,
          catalyst: flag ? { kind: flag.kind, headline: flag.headline, date: flag.date } : null,
          headlines,
        };
      });
      return { generatedAt: new Date().toISOString(), names: orderWire(names.filter(Boolean)) };
    },
    { cacheIf: (v) => v.names.length > 0 },
  );

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
