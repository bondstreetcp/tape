/**
 * Snapshot the FRED macro data to data/macro.json so the Macro page reads a
 * committed file instead of fetching ~19 FRED series live at request time
 * (which fails from some serverless hosts). Run: `npm run refresh-macro`.
 */
import fs from "node:fs";
import path from "node:path";
import { getMacro } from "../lib/fred";

// tsx doesn't auto-load .env.local — read it so FRED_API_KEY reaches getMacro().
for (const f of [".env.local", ".env"]) {
  try {
    for (const ln of fs.readFileSync(path.join(process.cwd(), f), "utf8").split(/\r?\n/)) {
      const m = ln.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* optional */ }
}

const OUT = path.join(process.cwd(), "data", "macro.json");

/** Usable counts in a macro payload — the same two numbers the guard reasons about. */
const counts = (m: any) => ({
  curve: (m?.curve ?? []).filter((c: any) => c?.now != null).length,
  inds: (m?.indicators ?? []).filter((i: any) => i?.value != null).length,
});

(async () => {
  const m = await getMacro();
  const { curve: curvePts, inds } = counts(m);

  // Don't overwrite good data with a degraded fetch. Two gates, because the absolute floor alone has a
  // hole: a healthy build is ~11 curve / 17 indicators, so `< 3` only catches near-total failure and a
  // night returning 5/5 would silently ship a half-empty macro page.
  //   • floor   — nothing usable at all (also the bootstrap case: no prior to compare against)
  //   • collapse — materially thinner than what's already on disk ⇒ the FETCH degraded, not the Fed
  // Only compare when the prior itself was healthy, so a bad file can't lock out its own recovery.
  let prev: { curve: number; inds: number } | null = null;
  try { prev = counts(JSON.parse(fs.readFileSync(OUT, "utf8"))); } catch { /* no prior → floor only */ }

  const belowFloor = curvePts < 3 || inds < 3;
  const collapsed =
    !!prev && prev.curve >= 3 && prev.inds >= 3 &&
    (curvePts < prev.curve * 0.7 || inds < prev.inds * 0.7);

  if (belowFloor || collapsed) {
    console.error(
      `FRED returned too little (${curvePts} curve pts, ${inds} indicators` +
        `${prev ? `; on disk: ${prev.curve}/${prev.inds}` : ""}) — not overwriting data/macro.json. ` +
        `It will read as STALE, which is honest; a half-empty macro page is not.`,
    );
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify(m));
  console.log(`wrote data/macro.json: ${curvePts} curve points, ${inds} indicators, asOf ${m.asOf}`);
})();
