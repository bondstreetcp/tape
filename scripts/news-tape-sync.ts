/**
 * Move data/news-tape.json between the compute container and R2 as ONE small object.
 *
 *   npx tsx scripts/news-tape-sync.ts pull    # R2 → data/news-tape.json  (before the refresh)
 *   npx tsx scripts/news-tape-sync.ts push    # data/news-tape.json → R2  (after the refresh)
 *
 * WHY THIS EXISTS INSTEAD OF USING data-to-r2 / data-from-r2
 * --------------------------------------------------------------------------------------------------
 * The normal pipeline ships the whole data tree as a single tarball. That is right for a nightly, and
 * completely wrong at a five-minute cadence: it would download and re-upload every feed on the site
 * 288 times a day to move one file, and each round trip is another chance to hit the "hydrate the
 * prior tree before upload" clobber that cost us the 07-04 data loss.
 *
 * ⚠ THE PULL IS NOT OPTIONAL AND MUST NOT BE SKIPPED AS AN OPTIMISATION. The tape is an append-only
 * archive whose ONLY copy lives in this object — the wires expose ~20 items each and forget the rest,
 * so a poll that merges onto an empty local file does not just lose that tick, it silently truncates
 * the entire history to whatever the wires happen to be showing right now. The refresh merges onto
 * whatever `pull` put on disk, so pull → refresh → push is a single indivisible sequence.
 *
 * Failure semantics follow the feed-guard doctrine — degrade to stale, never to empty:
 *   · pull fails  → leave whatever is on disk and exit 0. The refresh then merges onto the local copy;
 *                   worst case we re-append rows we already had, which the id-dedupe absorbs.
 *   · pull 404s   → first ever run. Exit 0 with an empty disk state; the archive starts here.
 *   · push fails  → exit 1. The tick is genuinely broken and the next one must not treat it as done.
 *
 * Stored gzipped: the payload is highly repetitive JSON text and compresses ~5:1, which is the
 * difference between a few megabytes and a few hundred kilobytes on every tick.
 */
import { promises as fs } from "fs";
import path from "path";
import { gzipSync, gunzipSync } from "zlib";
import { putObject, getObject, r2Configured } from "../lib/r2";

const KEY = "site-data/news-tape.json.gz";
const FILE = path.join(process.cwd(), "data", "news-tape.json");

async function pull() {
  const buf = await getObject(KEY);
  const json = gunzipSync(buf);
  // Parse before writing: a truncated or corrupt object must not overwrite a good local archive.
  const parsed = JSON.parse(json.toString("utf8")) as { items?: unknown[] };
  if (!Array.isArray(parsed.items)) throw new Error("object has no items array");
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, json);
  console.log(`news-tape-sync: pulled ${parsed.items.length} rows (${(buf.length / 1024).toFixed(0)} KB gz)`);
}

async function push() {
  const raw = await fs.readFile(FILE);
  const parsed = JSON.parse(raw.toString("utf8")) as { items?: unknown[] };
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error("refusing to push an empty tape");
  const gz = gzipSync(raw, { level: 6 });
  await putObject(KEY, gz, "application/gzip");
  console.log(`news-tape-sync: pushed ${parsed.items.length} rows (${(raw.length / 1e6).toFixed(2)} MB → ${(gz.length / 1024).toFixed(0)} KB gz)`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== "pull" && cmd !== "push") {
    console.error("usage: news-tape-sync.ts <pull|push>");
    process.exit(2);
  }
  if (!r2Configured()) {
    // Local dev and any box without R2 creds: the archive is simply the local file. Not an error.
    console.log(`news-tape-sync: R2 not configured — ${cmd} skipped (local file is the archive)`);
    return;
  }
  try {
    if (cmd === "pull") await pull();
    else await push();
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (cmd === "pull") {
      // Includes the first-run 404. Never fatal: the refresh will merge onto whatever is on disk.
      console.warn(`news-tape-sync: pull failed (${msg.slice(0, 140)}) — continuing with the local archive`);
      return;
    }
    console.error(`news-tape-sync: push FAILED — ${msg.slice(0, 200)}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("news-tape-sync:", String(e?.message || e)); process.exitCode = 1; });
