/**
 * Builds the constituent list for every index universe and writes one file per
 * universe to data/constituents/<id>.json.
 *
 *   sp500        — S&P 500            (Wikipedia, GICS)
 *   nasdaq100    — Nasdaq-100         (Wikipedia tickers; GICS via cross-reference)
 *   russell1000  — Russell 1000       (Wikipedia, GICS)
 *   sp1500       — S&P 500 + 400 + 600 (Wikipedia, GICS) — broad large/mid/small cap
 *
 * Run with:  npm run fetch-constituents
 * (The true Russell 3000 holdings aren't available from free sources, so the
 *  broad "S&P 1500" stands in for it.)
 */
import { promises as fs } from "fs";
import path from "path";
import * as cheerio from "cheerio";

interface Entry {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
}

interface SourceCfg {
  name: string;
  url: string;
  symbolCol: number;
  nameCol: number;
  sectorCol: number; // -1 = not present (classify later)
  industryCol: number;
}

const SOURCES: Record<string, SourceCfg> = {
  sp500: {
    name: "S&P 500",
    url: "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    symbolCol: 0,
    nameCol: 1,
    sectorCol: 2,
    industryCol: 3,
  },
  sp400: {
    name: "S&P 400",
    url: "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies",
    symbolCol: 0,
    nameCol: 1,
    sectorCol: 2,
    industryCol: 3,
  },
  sp600: {
    name: "S&P 600",
    url: "https://en.wikipedia.org/wiki/List_of_S%26P_600_companies",
    symbolCol: 0,
    nameCol: 1,
    sectorCol: 2,
    industryCol: 3,
  },
  russell1000: {
    name: "Russell 1000",
    url: "https://en.wikipedia.org/wiki/Russell_1000_Index",
    symbolCol: 1,
    nameCol: 0,
    sectorCol: 2,
    industryCol: 3,
  },
  nasdaq100: {
    name: "Nasdaq-100",
    url: "https://en.wikipedia.org/wiki/Nasdaq-100",
    symbolCol: 0,
    nameCol: 1,
    sectorCol: -1, // page uses ICB, not GICS — classify via cross-reference
    industryCol: -1,
  },
};

function norm(sym: string): string {
  return sym
    .trim()
    .toUpperCase()
    .replace(/\./g, "-")
    .replace(/[^A-Z0-9-]/g, "");
}

async function parseSource(cfg: SourceCfg): Promise<Entry[]> {
  const res = await fetch(cfg.url, {
    headers: { "User-Agent": "Mozilla/5.0 (sp-screener)" },
  });
  if (!res.ok) throw new Error(`${cfg.name} HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  let best: Entry[] = [];
  $("table.wikitable").each((_, tb) => {
    const headers = $(tb)
      .find("th")
      .map((_, th) => $(th).text().trim())
      .get()
      .join(" | ");
    if (!(/Ticker|Symbol/i.test(headers) && /GICS|ICB|Sector|Subsector/i.test(headers)))
      return;
    const need = Math.max(cfg.symbolCol, cfg.nameCol, cfg.sectorCol, cfg.industryCol);
    const rows: Entry[] = [];
    $(tb)
      .find("tbody tr")
      .each((_, tr) => {
        const tds = $(tr).find("td");
        if (tds.length <= need) return;
        const cell = (i: number) => (i >= 0 ? $(tds[i]).text().trim() : "");
        const symbol = norm(cell(cfg.symbolCol));
        if (!symbol) return;
        rows.push({
          symbol,
          name: cell(cfg.nameCol),
          sector: cell(cfg.sectorCol),
          industry: cell(cfg.industryCol),
        });
      });
    if (rows.length > best.length) best = rows;
  });
  if (best.length < 50)
    throw new Error(`${cfg.name}: only parsed ${best.length} rows`);
  console.log(`  ${cfg.name}: ${best.length}`);
  return best;
}

async function main() {
  console.log("Fetching constituent lists…");
  const [sp500, sp400, sp600, r1000, ndx] = await Promise.all([
    parseSource(SOURCES.sp500),
    parseSource(SOURCES.sp400),
    parseSource(SOURCES.sp600),
    parseSource(SOURCES.russell1000),
    parseSource(SOURCES.nasdaq100),
  ]);

  // Global GICS classification map (sp500 last = highest priority).
  const gics = new Map<string, { sector: string; industry: string; name: string }>();
  for (const list of [r1000, sp600, sp400, sp500]) {
    for (const e of list) {
      if (e.sector)
        gics.set(e.symbol, {
          sector: e.sector,
          industry: e.industry || "Other",
          name: e.name,
        });
    }
  }

  const classify = (e: Entry): Entry => {
    const g = gics.get(e.symbol);
    return {
      symbol: e.symbol,
      name: e.name || g?.name || e.symbol,
      sector: e.sector || g?.sector || "",
      industry: e.industry || g?.industry || "",
    };
  };

  const dedupe = (arr: Entry[]): Entry[] => {
    const m = new Map<string, Entry>();
    for (const e of arr.map(classify)) if (!m.has(e.symbol)) m.set(e.symbol, e);
    return [...m.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  };

  const universes: Record<string, Entry[]> = {
    sp500: dedupe(sp500),
    nasdaq100: dedupe(ndx),
    russell1000: dedupe(r1000),
    sp1500: dedupe([...sp500, ...sp400, ...sp600]),
  };

  const dir = path.join(process.cwd(), "data", "constituents");
  await fs.mkdir(dir, { recursive: true });
  for (const [id, list] of Object.entries(universes)) {
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(list, null, 1));
    const missing = list.filter((e) => !e.sector).length;
    console.log(
      `${id}: ${list.length}${missing ? ` (${missing} need Yahoo classification)` : ""}`,
    );
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
