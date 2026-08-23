/**
 * Staples Scanner — one-shot FIRST-RUN BACKFILL. Run this ONCE on the NAS (the box that holds
 * OPENROUTER_API_KEY, the LAKE_S3_* R2 creds, and VERCEL_DEPLOY_HOOK) after dropping the biweekly
 * NielsenIQ scan PDFs into the top-level staples-scans/ folder. It extracts them, ships the derived
 * JSON to R2, and triggers a Vercel deploy — so the /staples-scanner board + the earnings/desk-note
 * tie-ins go live immediately, instead of waiting for the next nightly full tick.
 *
 *   npm run backfill-staples               # hydrate → extract → upload → deploy
 *   npm run backfill-staples -- --no-hydrate   # skip the R2 re-pull (only if data/ is already current)
 *   FORCE=1 npm run backfill-staples       # re-extract every PDF (not just new ones)
 *
 * WHY hydrate first (the default): data-to-r2 ships the WHOLE data/ tree. If data/ were stale/partial
 * we'd clobber the live tree. Re-pulling the current published tree first (data-from-r2, which touches
 * only data/ — never the top-level staples-scans/ PDFs) guarantees we add staples to a COMPLETE tree.
 * Pass --no-hydrate only right after a successful tick, when you know data/ is already current.
 *
 * Fails BEFORE anything ships if there are no PDFs or no LLM configured (the extractor would otherwise
 * silently no-op and we'd deploy an empty board). The R2/deploy creds are validated by the sub-steps.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { llmConfigured } from "../lib/llm";

// Load .env.local for local/manual runs (the NAS + CI inject the vars directly).
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* env provided directly */ }

const SCAN_DIR = process.env.STAPLES_SCAN_DIR || join(process.cwd(), "staples-scans");
const OUT = join(process.cwd(), "data", "staples-scanner.json");
const noHydrate = process.argv.includes("--no-hydrate");

const run = (cmd: string) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: "inherit" }); };
const rowsIn = (p: string): number => {
  try { return (JSON.parse(readFileSync(p, "utf8")).reports ?? []).reduce((a: number, r: any) => a + (r.rows?.length ?? 0), 0); }
  catch { return 0; }
};

async function main() {
  // ── Preconditions (fail loud, fail early — before we hydrate/upload anything) ──
  const pdfs = existsSync(SCAN_DIR) ? readdirSync(SCAN_DIR).filter((f) => /\.pdf$/i.test(f)) : [];
  if (!pdfs.length) {
    console.error(`✗ No PDFs in ${SCAN_DIR}.\n  Drop the biweekly NielsenIQ scan PDFs there first (that folder is the watched folder — top-level, outside data/), then re-run.`);
    process.exit(1);
  }
  if (!(await llmConfigured())) {
    console.error("✗ No LLM configured (OPENROUTER_API_KEY). The extractor needs it to read the PDFs — aborting before anything ships.");
    process.exit(1);
  }
  console.log(`Staples backfill: ${pdfs.length} PDF(s) in ${SCAN_DIR}${noHydrate ? " · --no-hydrate" : ""}.`);
  const before = rowsIn(OUT);

  // ── 1. Hydrate the current published tree so we re-ship a COMPLETE data/ (touches only data/) ──
  if (!noHydrate) run("npm run data-from-r2");

  // ── 2. Extract the PDFs → data/staples-scanner.json ──
  run("npm run refresh-staples-scanner");
  const after = rowsIn(OUT);
  if (!existsSync(OUT) || after === 0) {
    console.error("✗ Extractor produced no rows in data/staples-scanner.json — aborting before upload (won't ship an empty board).");
    process.exit(1);
  }
  console.log(`✓ Extracted → ${after} rows${before ? ` (was ${before})` : ""}.`);

  // ── 3. Upload the whole data/ tree (now including staples-scanner.json) to R2 ──
  run("npm run data-to-r2");

  // ── 4. Trigger a Vercel deploy so the fresh R2 tree goes live (same hook the nightly uses) ──
  const hook = process.env.VERCEL_DEPLOY_HOOK;
  if (hook) {
    const status = await fetch(hook, { method: "POST" }).then((r) => r.status).catch(() => 0);
    console.log(status && status < 400 ? `✓ Vercel deploy hook → HTTP ${status}` : `⚠ Vercel deploy hook → ${status || "failed"} (R2 is updated; trigger a deploy manually if this didn't fire).`);
  } else {
    console.log("⚠ VERCEL_DEPLOY_HOOK not set — R2 is updated, but you'll need to trigger a deploy manually for it to go live.");
  }
  console.log("\n✓ Staples backfill complete — the board + tie-ins will reflect the scans after the deploy finishes.");
}

main().catch((e) => { console.error(e); process.exit(1); });
