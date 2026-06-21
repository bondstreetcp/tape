/**
 * Market-wide options flow scanner. Fetches the front-expiry options chain for every
 * S&P 500 name, keeps contracts with meaningful dollar premium traded today, and writes
 * the top flows to data/options-flow.json (read by the Flow page). Run with:
 *   npx tsx scripts/build-flow.ts            (sp500)
 *   npx tsx scripts/build-flow.ts nasdaq100
 */
import fs from "fs";
import path from "path";
import { getOptions } from "../lib/options";

const MIN_PREMIUM = 250_000; // $ value traded today (volume × mid × 100)
const MIN_VOL = 200;
const TOP = 250;
const CONCURRENCY = 5;

const universe = process.argv[2] || "sp500";
const root = process.cwd();

interface Row { symbol: string; name: string; price: number; returns?: Record<string, number | null> }

function loadStocks(): Row[] {
  const p = path.join(root, "data", universe, "snapshot.json");
  if (!fs.existsSync(p)) throw new Error(`No snapshot for ${universe}`);
  return JSON.parse(fs.readFileSync(p, "utf8")).stocks as Row[];
}

const mid = (o: { bid: number | null; ask: number | null; last: number | null }) =>
  o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o.last ?? 0;

async function main() {
  const stocks = loadStocks();
  const meta = new Map(stocks.map((s) => [s.symbol, s]));
  const symbols = stocks.map((s) => s.symbol);
  const entries: any[] = [];
  let done = 0, withOpts = 0;

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (sym) => {
        try {
          const chain = await getOptions(sym);
          if (!chain.calls.length && !chain.puts.length) return;
          withOpts++;
          const m = meta.get(sym)!;
          const dte = chain.selected
            ? Math.round((new Date(chain.selected + "T00:00:00Z").getTime() - Date.now()) / 86_400_000)
            : null;
          for (const [type, opts] of [["call", chain.calls], ["put", chain.puts]] as const) {
            for (const o of opts) {
              const vol = o.vol ?? 0;
              const oi = o.oi ?? 0;
              const px = mid(o);
              const premium = vol * px * 100;
              if (vol < MIN_VOL || premium < MIN_PREMIUM) continue;
              entries.push({
                symbol: sym,
                name: m.name,
                underlying: chain.underlying ?? m.price,
                chgPct: m.returns?.["1d"] ?? null,
                type,
                strike: o.strike,
                expiry: chain.selected,
                dte,
                vol,
                oi,
                volOI: oi > 0 ? vol / oi : null,
                premium: Math.round(premium),
                iv: o.iv,
                mid: Math.round(px * 100) / 100,
                unusual: vol > Math.max(oi, MIN_VOL), // today's volume exceeds open interest
              });
            }
          }
        } catch {
          /* no options / fetch error → skip */
        }
      }),
    );
    done += batch.length;
    process.stderr.write(`\r  ${done}/${symbols.length} scanned · ${entries.length} flows`);
    await new Promise((r) => setTimeout(r, 120));
  }

  entries.sort((a, b) => b.premium - a.premium);
  const top = entries.slice(0, TOP);
  const callPremium = entries.filter((e) => e.type === "call").reduce((s, e) => s + e.premium, 0);
  const putPremium = entries.filter((e) => e.type === "put").reduce((s, e) => s + e.premium, 0);

  const out = {
    generatedAt: new Date().toISOString(),
    universe,
    scanned: symbols.length,
    withOptions: withOpts,
    totalFlows: entries.length,
    callPremium,
    putPremium,
    entries: top,
  };
  fs.writeFileSync(path.join(root, "data", "options-flow.json"), JSON.stringify(out));
  process.stderr.write("\n");
  console.log(`Wrote ${top.length} flows (of ${entries.length} unusual; ${withOpts}/${symbols.length} had options). Call/Put premium: $${(callPremium / 1e6).toFixed(0)}M / $${(putPremium / 1e6).toFixed(0)}M`);
}

main();
