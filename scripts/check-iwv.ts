/**
 * Quick freshness check for the iShares IWV (Russell 3000) holdings export that feeds the
 * `russell3000` universe. Prints the "Fund Holdings as of" date + the equity count so you can
 * confirm a download is current — especially after the annual Russell reconstitution (effective
 * after the last-Friday-of-June close), when you re-download from the IWV fund page before
 * running `npm run fetch-constituents`.
 *   npm run check-iwv
 */
import { promises as fs } from "fs";
import path from "path";
import { toRows } from "./iwv";

async function main() {
  for (const fn of ["iwv-holdings.xls", "iwv-holdings.csv"]) {
    let text: string;
    try {
      text = await fs.readFile(path.join(process.cwd(), "data", fn), "utf8");
    } catch {
      continue;
    }
    const rows = toRows(text);
    const hdr = rows.findIndex((r) => r.map((x) => x.toLowerCase()).includes("ticker"));
    const meta = rows.slice(0, hdr < 0 ? 15 : hdr).map((r) => r.filter(Boolean).join(" "));
    const asof = (meta.find((m) => /holdings as of/i.test(m)) || "").trim();
    const equities = hdr < 0 ? 0 : rows.length - hdr - 1;
    console.log(`data/${fn}`);
    console.log(`  ${asof || "(Fund Holdings as-of date not found)"}`);
    console.log(`  ~${equities} equities`);
    console.log(asof ? `  → if this date is on/after the reconstitution (last Fri of June), run: npm run fetch-constituents` : "");
    return;
  }
  console.log("No data/iwv-holdings.xls (or .csv) found.");
  console.log("Download it: iShares IWV fund page → Holdings → 'Detailed Holdings and Analytics' → Download, save as data/iwv-holdings.xls");
}

main().catch((e) => { console.error(e); process.exit(1); });
