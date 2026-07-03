/**
 * Data-freshness gate. Reads every registered feed + universe snapshot (lib/dataFreshness) and prints
 * a status table; exits 1 if any feed is STALE / MISSING / EMPTY / UNREADABLE.
 *
 *   npm run check-freshness            # fail the process on any problem (CI gate)
 *   npm run check-freshness -- --warn  # report only, always exit 0 (intraday / local eyeballing)
 *
 * Wired into the nightly workflow as the ONE step allowed to fail the job (every refresh step is
 * continue-on-error, so a silently-dead feed only shows up here). See lib/dataFreshness for the
 * registry + how the thresholds are calibrated.
 */
import { checkFreshness, FAILING, type FreshResult } from "../lib/dataFreshness";

const ICON: Record<string, string> = { ok: "  ok  ", stale: " STALE", missing: "MISSING", empty: " EMPTY", unreadable: "UNREAD" };

function line(r: FreshResult): string {
  const age = r.ageHours == null ? "  —  " : `${r.ageHours}h`.padStart(7);
  const cnt = r.count == null ? "" : `n=${r.count}`;
  return `  [${ICON[r.status]}] ${r.label.padEnd(30)} ${age}  ${cnt.padEnd(9)} ${r.detail}`;
}

async function main() {
  const warnOnly = process.argv.includes("--warn");
  const rep = await checkFreshness();

  const bad = rep.results.filter((r) => FAILING.includes(r.status));
  const good = rep.results.filter((r) => !FAILING.includes(r.status));

  console.log(`\nData freshness — checked ${rep.checkedAt}\n`);
  if (bad.length) {
    console.log(`  ── ${bad.length} PROBLEM${bad.length > 1 ? "S" : ""} ──`);
    for (const r of bad) console.log(line(r));
    console.log("");
  }
  for (const r of good) console.log(line(r));
  console.log(`\n${rep.results.length} feeds · ${good.length} ok · ${bad.length} failing\n`);

  if (bad.length && !warnOnly) {
    console.error(`FRESHNESS CHECK FAILED — ${bad.length} feed(s) stale/missing/empty. See above.`);
    process.exit(1);
  }
  if (bad.length) console.warn(`(--warn) ${bad.length} feed(s) failing, but not exiting non-zero.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
