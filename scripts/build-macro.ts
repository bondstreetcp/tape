/**
 * Snapshot the FRED macro data to data/macro.json so the Macro page reads a
 * committed file instead of fetching ~19 FRED series live at request time
 * (which fails from some serverless hosts). Run: `npm run refresh-macro`.
 */
import fs from "node:fs";
import path from "node:path";
import { getMacro } from "../lib/fred";

(async () => {
  const m = await getMacro();
  const curvePts = m.curve.filter((c) => c.now != null).length;
  const inds = m.indicators.filter((i) => i.value != null).length;
  if (curvePts < 3 || inds < 3) {
    console.error(`FRED returned too little (${curvePts} curve pts, ${inds} indicators) — not overwriting data/macro.json`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(process.cwd(), "data", "macro.json"), JSON.stringify(m));
  console.log(`wrote data/macro.json: ${curvePts} curve points, ${inds} indicators, asOf ${m.asOf}`);
})();
