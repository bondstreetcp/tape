/**
 * Builds the constituent list for every index universe and writes one file per
 * universe to data/constituents/<id>.json.
 *
 *   sp500        — S&P 500            (Wikipedia, GICS)
 *   nasdaq100    — Nasdaq-100         (Wikipedia tickers; GICS via cross-reference)
 *   russell1000  — Russell 1000       (Wikipedia, GICS)
 *   sp1500       — S&P 500 + 400 + 600 (Wikipedia, GICS) — broad large/mid/small cap
 *   russell3000  — optional; built only if data/iwv-holdings.csv (an iShares IWV
 *                  holdings export) is present. See scripts/iwv.ts for the source.
 *
 * Run with:  npm run fetch-constituents
 */
import { promises as fs } from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { type Entry, norm, parseIWV, toRows } from "./iwv";

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
  // ⚠ allSettled, NOT all. These are scrapes of pages we do not control, and under Promise.all a
  // SINGLE broken source aborted the whole script — every universe, including the ones that parsed
  // perfectly. Observed 2026-07-30: Nasdaq-100 returned 0 rows and took the Russell 3000 rebuild down
  // with it, which is why the constituent lists on disk had been frozen since June while the site
  // quietly ran on them. One dead page must cost one universe, not all of them.
  const settled = await Promise.allSettled([
    parseSource(SOURCES.sp500),
    parseSource(SOURCES.sp400),
    parseSource(SOURCES.sp600),
    parseSource(SOURCES.russell1000),
    parseSource(SOURCES.nasdaq100),
  ]);
  const NAMES = ["sp500", "sp400", "sp600", "russell1000", "nasdaq100"];
  const got = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`  ⚠ ${NAMES[i]} FAILED: ${String(r.reason?.message || r.reason).slice(0, 120)}`);
    return null;
  });
  const [sp500, sp400, sp600, r1000, ndx] = got;
  const failed = NAMES.filter((_, i) => got[i] == null);

  // Global GICS classification map (sp500 last = highest priority).
  const gics = new Map<string, { sector: string; industry: string; name: string }>();
  for (const list of [r1000, sp600, sp400, sp500].filter(Boolean) as Entry[][]) {
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

  // A universe is written ONLY when every source it derives from parsed. A composite built from a
  // missing leg would be a truncated list that looks complete — the failure mode this whole file
  // exists to avoid — so an unbuildable universe simply keeps the file already on disk.
  const universes: Record<string, Entry[]> = {};
  if (sp500) universes.sp500 = dedupe(sp500);
  if (ndx) universes.nasdaq100 = dedupe(ndx);
  if (r1000) universes.russell1000 = dedupe(r1000);
  if (sp500 && sp400 && sp600) universes.sp1500 = dedupe([...sp500, ...sp400, ...sp600]);

  // Optional real Russell 3000 — only if an iShares IWV holdings file is present
  // (data/iwv-holdings.xls SpreadsheetML, or .csv).
  let iwvText: string | null = null;
  let iwvFrom = "";
  for (const fn of ["iwv-holdings.xls", "iwv-holdings.csv"]) {
    try {
      iwvText = await fs.readFile(path.join(process.cwd(), "data", fn), "utf8");
      iwvFrom = fn;
      break;
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
  }
  // Liquid US names EXCLUDED from every index our lists derive from, appended to the broadest
  // universe so the app still covers them. LEVI: FTSE Russell's 5%-voting-rights floor keeps
  // Levi Strauss (family-controlled class B votes) out of the Russell indexes entirely (like SNAP
  // pre-2023), and it isn't in the S&P 1500 lists we pull — so a $6B household name was invisible
  // to EVERY board (found 2026-07-10 when it reported earnings and wasn't on the earnings screen).
  const US_EXTRAS: Entry[] = [
    { symbol: "LEVI", name: "Levi Strauss & Co.", sector: "Consumer Discretionary", industry: "Apparel, Accessories & Luxury Goods" },
  ];

  // The IWV file carries iShares' own coarse sector, and `gics` is what upgrades it to a real GICS
  // label — which decides the sector-ETF mapping, and a row with no ETF is DROPPED by build-data.
  // So rebuilding the Russell 3000 against a half-populated classification map would quietly shrink
  // the universe. Require the map to be healthy first; otherwise keep the list already on disk.
  if (iwvText && gics.size < 1000) {
    console.warn(`  ⚠ Russell 3000 NOT rebuilt: GICS map only has ${gics.size} entries (sources failed: ${failed.join(", ") || "none"}) — keeping the existing list rather than shipping one with degraded sectors.`);
    iwvText = null;
  }
  if (iwvText) {
    try {
      const r3000 = parseIWV(toRows(iwvText), gics);
      const m = new Map<string, Entry>();
      for (const e of r3000) if (!m.has(e.symbol)) m.set(e.symbol, e);
      for (const e of US_EXTRAS) if (!m.has(e.symbol)) m.set(e.symbol, e);
      universes.russell3000 = [...m.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
      console.log(`  Russell 3000: ${universes.russell3000.length} (from ${iwvFrom} + ${US_EXTRAS.length} index-excluded extras)`);
    } catch (e: any) {
      console.warn(`  Russell 3000 skipped: ${e.message}`);
    }
  }

  const dir = path.join(process.cwd(), "data", "constituents");
  await fs.mkdir(dir, { recursive: true });
  for (const [id, list] of Object.entries(universes)) {
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(list, null, 1));
    const missing = list.filter((e) => !e.sector).length;
    console.log(
      `${id}: ${list.length}${missing ? ` (${missing} need Yahoo classification)` : ""}`,
    );
  }
  if (failed.length) {
    // Everything that COULD be rebuilt has been written above; the skipped universes keep their prior
    // file. Exit non-zero so a scheduled run surfaces instead of looking like a clean pass — a silent
    // partial success here is what let the lists sit frozen for a month.
    console.error(`\n⚠ ${failed.length} source(s) failed: ${failed.join(", ")}. Universes derived from them kept their previous list. Re-run once the source is back.`);
    process.exitCode = 1;
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
