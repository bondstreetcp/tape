/**
 * Fast top-up: re-fetches only Yahoo quotes (batched) and patches each universe
 * snapshot with valuation fields (trailingPE/forwardPE/priceToBook/dividendYield)
 * without re-pulling 5 years of price history. Run with:
 *   npx tsx scripts/patch-fundamentals.ts
 * (A normal `npm run refresh-data` also fills these going forward.)
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import type { Snapshot } from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const qnum = (v: any): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const snaps: Record<string, Snapshot> = {};
  const allSyms = new Set<string>();
  for (const u of UNIVERSES) {
    const raw = await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8");
    snaps[u.id] = JSON.parse(raw) as Snapshot;
    for (const st of snaps[u.id].stocks) allSyms.add(st.symbol);
  }
  const symbols = [...allSyms];
  console.log(`Fetching quotes for ${symbols.length} symbols…`);
  const qmap = new Map<string, any>();
  for (const part of chunk(symbols, 50)) {
    try {
      const qs = (await yf.quote(part, {}, { validateResult: false })) as any[];
      for (const q of qs) if (q?.symbol) qmap.set(q.symbol, q);
    } catch {
      for (const sym of part) {
        try {
          const q = await yf.quote(sym, {}, { validateResult: false });
          if (q?.symbol) qmap.set(q.symbol, q);
        } catch {
          /* skip */
        }
      }
    }
  }
  console.log(`  got ${qmap.size}/${symbols.length} quotes`);

  for (const u of UNIVERSES) {
    const s = snaps[u.id];
    let patched = 0;
    for (const st of s.stocks) {
      const q = qmap.get(st.symbol);
      if (!q) continue;
      st.trailingPE = qnum(q.trailingPE);
      st.forwardPE = qnum(q.forwardPE);
      st.priceToBook = qnum(q.priceToBook);
      st.dividendYield = qnum(q.trailingAnnualDividendYield);
      st.fiftyDayAverage = qnum(q.fiftyDayAverage);
      st.twoHundredDayAverage = qnum(q.twoHundredDayAverage);
      patched++;
    }
    await fs.writeFile(
      path.join(DATA_DIR, u.id, "snapshot.json"),
      JSON.stringify(s),
    );
    console.log(`  ${u.id}: patched ${patched}/${s.stocks.length}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
