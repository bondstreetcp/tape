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
import { type Entry, norm, parseIWV, qualifyConstituentRows, toRows } from "./iwv";

interface SourceCfg {
  name: string;
  /** Tried in order; the first URL that yields a usable constituent table wins. A list rather than a
   *  string because these are articles other people edit: Wikipedia SPLITS a long page's table into
   *  its own "List of …" article without leaving a redirect at the section, which is exactly how the
   *  Nasdaq-100 source died (see below). A second candidate turns that from an outage into a no-op. */
  urls: string[];
  symbolCol: number;
  nameCol: number;
  sectorCol: number; // -1 = not present (classify later)
  industryCol: number;
}

const SOURCES: Record<string, SourceCfg> = {
  sp500: {
    name: "S&P 500",
    urls: ["https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"],
    symbolCol: 0,
    nameCol: 1,
    sectorCol: 2,
    industryCol: 3,
  },
  sp400: {
    name: "S&P 400",
    urls: ["https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"],
    symbolCol: 0,
    nameCol: 1,
    sectorCol: 2,
    industryCol: 3,
  },
  sp600: {
    name: "S&P 600",
    urls: ["https://en.wikipedia.org/wiki/List_of_S%26P_600_companies"],
    symbolCol: 0,
    nameCol: 1,
    sectorCol: 2,
    industryCol: 3,
  },
  russell1000: {
    name: "Russell 1000",
    // ⚠ SAME SPLIT AS NASDAQ-100 (see below). The constituents table was moved off
    // /wiki/Russell_1000_Index into its own "List of Russell 1000 companies" article, leaving the index
    // page with only the all-time-highs and annual-returns tables — a clean HTTP 200 with ZERO
    // constituent rows (observed 2026-08-16). The split-out list is the source now; the index page is
    // kept as a second candidate in case the tables are ever re-merged. Both share the same column
    // layout: Company | Symbol | GICS Sector | GICS Sub-Industry.
    urls: [
      "https://en.wikipedia.org/wiki/List_of_Russell_1000_companies",
      "https://en.wikipedia.org/wiki/Russell_1000_Index",
    ],
    symbolCol: 1,
    nameCol: 0,
    sectorCol: 2,
    industryCol: 3,
  },
  nasdaq100: {
    name: "Nasdaq-100",
    // ⚠ THE COMPONENTS TABLE MOVED. Until mid-2026 the constituent list lived in a "Components"
    // section of /wiki/Nasdaq-100; it was split out into its own article and the section deleted, so
    // the old URL still returns HTTP 200 with four wikitables — all-time highs, annual returns and two
    // milestone tables — and NOT ONE of them is a constituent list. That is the whole failure: a live
    // page, a clean 200, and zero rows. Note the capitalisation: the components article is "NASDAQ-100"
    // where the index article is "Nasdaq-100", and Wikipedia titles are case-sensitive past the first
    // letter, so the obvious guess 404s. The old URL is kept as a second candidate — it costs one
    // request only when the first has already failed, and covers a re-merge.
    urls: [
      "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies",
      "https://en.wikipedia.org/wiki/Nasdaq-100",
    ],
    symbolCol: 0,
    nameCol: 1,
    sectorCol: -1, // page uses ICB, not GICS — classify via cross-reference
    industryCol: -1,
  },
};

/** Pull candidate rows out of one wikitable, or null if it isn't a constituent table. The judgment —
 *  members vs the index-CHANGES table that shares the page and the "Ticker" header — lives in
 *  qualifyConstituentRows so it can be unit-tested; this half is just the DOM. */
function tableRows($: cheerio.CheerioAPI, tb: any, cfg: SourceCfg): Entry[] | null {
  const headers = $(tb)
    .find("th")
    .map((_, th) => $(th).text().trim())
    .get()
    .join(" | ");
  if (!(/Ticker|Symbol/i.test(headers) && /GICS|ICB|Sector|Subsector/i.test(headers))) return null;
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
  const q = qualifyConstituentRows(rows);
  if (!q) return null; // the index-changes table, or something worse
  // The table qualified, so the stragglers are junk rows inside a good table (a footnote, a "TBD"
  // placeholder, a mid-table subheading) rather than a misread column. Drop them — loudly, because
  // silently is how a symbol that can never quote gets quoted every night forever.
  if (q.dropped.length)
    console.warn(`  ⚠ ${cfg.name}: dropped ${q.dropped.length} non-ticker row(s): ${q.dropped.slice(0, 6).join(", ")}`);
  return q.kept;
}

async function parseSource(cfg: SourceCfg): Promise<Entry[]> {
  // Every dead end is recorded rather than thrown on, so that when this breaks again the nightly log
  // says WHY — which URL, which tables were on it, what their headers were. Diagnosing the 2026-06-29
  // breakage needed a throwaway scraper written by hand because "only parsed 0 rows" says nothing
  // about whether the page 404'd, moved its table, or renamed a column.
  const why: string[] = [];
  for (const url of cfg.urls) {
    let html: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (sp-screener)" } });
      if (!res.ok) { why.push(`${url} → HTTP ${res.status}`); continue; }
      html = await res.text();
    } catch (e: any) {
      why.push(`${url} → ${String(e?.message || e).slice(0, 60)}`);
      continue;
    }
    const $ = cheerio.load(html);
    const tables = $("table.wikitable").toArray();
    let best: Entry[] = [];
    for (const tb of tables) {
      const rows = tableRows($, tb, cfg);
      if (rows && rows.length > best.length) best = rows;
    }
    if (best.length >= 50) {
      console.log(`  ${cfg.name}: ${best.length}${cfg.urls.indexOf(url) ? ` (fallback URL)` : ""}`);
      return best;
    }
    const hdrs = tables
      .map((tb) => $(tb).find("th").map((_, th) => $(th).text().trim()).get().slice(0, 4).join("/"))
      .filter(Boolean);
    why.push(
      `${url} → ${best.length} rows from ${tables.length} wikitable(s) [${hdrs.join(" ; ").slice(0, 200)}]`,
    );
  }
  throw new Error(`${cfg.name}: no usable constituent table — ${why.join(" | ")}`);
}

/** The list currently on disk, or null when there isn't one (first run) / it's unreadable. */
async function readPrior(dir: string, id: string): Promise<Entry[] | null> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8"));
    return Array.isArray(j) ? (j as Entry[]) : null;
  } catch {
    return null;
  }
}

/** Refuse a rebuild that would drop more than this share of the prior list — see the write loop. */
const MAX_SHRINK = 0.4;

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
  const blocked: string[] = []; // universes whose rebuild parsed but failed the churn guard below

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
    // Diff against the list already on disk. Two jobs, both of which exist because this script now runs
    // UNATTENDED every night instead of being invoked by a human who reads its output:
    //
    //  1. The churn guard. A 50-row floor and a ticker-shaped table are not enough to prove a scrape is
    //     RIGHT — a half-rendered page or a vandalised table can clear both and still be missing a third
    //     of the index, and the write would be silent and permanent. Real turnover is nowhere near this:
    //     S&P annual churn is ~5%, the Nasdaq-100 December reconstitution swaps ~10 names. Losing 40% of
    //     the prior list is not a reconstitution, so refuse it and keep the file that is already there.
    //  2. The drift line. The disease this whole change treats is a list that stops moving without
    //     anyone noticing, and "nasdaq100: 103 (+2/-2)" in the nightly log is what makes a FROZEN list
    //     visible — a run that writes the identical set every night for a month is the symptom.
    const prior = await readPrior(dir, id);
    let drift = "";
    if (prior?.length) {
      const now = new Set(list.map((e) => e.symbol));
      const was = new Set(prior.map((e) => e.symbol));
      const dropped = prior.filter((e) => !now.has(e.symbol));
      const added = list.filter((e) => !was.has(e.symbol));
      if (dropped.length / prior.length > MAX_SHRINK) {
        console.error(
          `  ⚠ ${id} NOT written: the new list drops ${dropped.length}/${prior.length} names ` +
            `(${((dropped.length / prior.length) * 100).toFixed(0)}%, max ${MAX_SHRINK * 100}%) — that is a broken ` +
            `source, not a reconstitution. Keeping the existing list. Dropped e.g. ${dropped.slice(0, 8).map((e) => e.symbol).join(", ")}`,
        );
        blocked.push(id);
        continue;
      }
      drift =
        added.length || dropped.length
          ? ` (+${added.length}/-${dropped.length}${added.length ? ` — added ${added.slice(0, 5).map((e) => e.symbol).join(", ")}` : ""}${dropped.length ? `; dropped ${dropped.slice(0, 5).map((e) => e.symbol).join(", ")}` : ""})`
          : " (unchanged)";
    }
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(list, null, 1));
    const missing = list.filter((e) => !e.sector).length;
    console.log(
      `${id}: ${list.length}${drift}${missing ? ` (${missing} need Yahoo classification)` : ""}`,
    );
  }
  if (failed.length || blocked.length) {
    // Everything that COULD be rebuilt has been written above; the skipped universes keep their prior
    // file. Exit non-zero so a scheduled run surfaces instead of looking like a clean pass — a silent
    // partial success here is what let the lists sit frozen for a month.
    //
    // ⚠ NON-FATAL BY CONTRACT, and both schedulers are set up to honour that: refresh-data.yml marks
    // this step continue-on-error like every other refresh step, and run-tick counts it as one failed
    // step out of ~70 (it only aborts a tick above `fails > plan.length / 2`). A stale index list is a
    // thing to fix this week, not a reason to skip tonight's deploy of otherwise-good market data.
    const parts = [
      failed.length ? `${failed.length} source(s) failed: ${failed.join(", ")}` : "",
      blocked.length ? `${blocked.length} universe(s) refused by the churn guard: ${blocked.join(", ")}` : "",
    ].filter(Boolean);
    console.error(`\n⚠ ${parts.join(" · ")}. Those universes kept their previous list. Re-run once the source is back.`);
    process.exitCode = 1;
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
