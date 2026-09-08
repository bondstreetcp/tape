/**
 * Ingest the earnings-call ARCHIVE — digest every RAW transcript (digest===null) in data/calls/ into structured
 * CallDigest notes, on the AMD rig overnight (FREE local compute). scripts/backfill-transcripts pulls the raw
 * text fast; this slow, one-sequence GPU pass runs separately so the two don't gate each other.
 *
 * Routing: set CALL_DIGEST_LOCAL_URL + CALL_DIGEST_LOCAL_MODEL (the rig's vLLM, e.g. http://192.168.1.76:8000/v1
 * + argus-vlm). scopedLocalEnv maps them onto LLM_LOCAL_* and every digest call goes local. By default this
 * REFUSES to run without the rig configured (INGEST_LOCAL_ONLY=1) so a 6,000-transcript backfill never silently
 * bills the cloud flash tier; set INGEST_LOCAL_ONLY=0 to allow the cloud fallback.
 *
 * Incremental (skips already-digested records), resumable, budgeted. Orders NEWEST call first by default so the
 * most move-relevant quarters digest first (the archive is ~24k records / weeks of rig time — cap it). Env:
 * INGEST_ORDER ("recent"=newest first | "alpha"=by symbol), INGEST_LIMIT (0=all), INGEST_ONLY ("AAPL,MSFT"),
 * INGEST_DELAY_MS (0), INGEST_LOCAL_ONLY (1), INGEST_PAUSE_PEAK (1 = pause during Georgia Power on-peak:
 * weekdays 14:00-19:00 ET, excl holidays, thru Sep 30 — dodges peak electricity pricing on the rig).
 *   CALL_DIGEST_LOCAL_URL=http://192.168.1.76:8000/v1 CALL_DIGEST_LOCAL_MODEL=argus-vlm npm run ingest-transcripts
 *   INGEST_LIMIT=3000 …  # digest the 3,000 most recent calls first, then re-run for more
 */
import { promises as fs } from "fs";
import { scopedLocalEnv } from "../lib/callDigests";
// Map CALL_DIGEST_LOCAL_* → LLM_LOCAL_* BEFORE lib/llm reads env (it reads per-call, but assign up top to be safe).
const SCOPED = scopedLocalEnv(process.env);
if (SCOPED) Object.assign(process.env, SCOPED);
import { FLASH_MODEL, llmConfigured } from "../lib/llm";
import { digestTranscript, type DigestLlm } from "../lib/digestTranscript";
import { callsCacheDir, loadSymbolCalls, loadCallRecord, saveCallRecord, type CallRecord } from "../lib/callsArchive";
import { sleep, isGeorgiaPowerPeak } from "../lib/scriptKit";

const LOCAL = !!(process.env.LLM_LOCAL_BASE_URL && process.env.LLM_LOCAL_MODEL);
const LOCAL_ONLY = process.env.INGEST_LOCAL_ONLY !== "0"; // default true: don't burn cloud $ on a bulk backfill
const LIMIT = Number(process.env.INGEST_LIMIT || 0); // 0 = all un-digested
const DELAY_MS = Math.max(0, Number(process.env.INGEST_DELAY_MS || 0));
const ONLY = (process.env.INGEST_ONLY || "").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());
const ORDER = (process.env.INGEST_ORDER || "recent").toLowerCase(); // "recent" = newest call first (most move-relevant); "alpha" = by symbol A→Z
const PAUSE_PEAK = process.env.INGEST_PAUSE_PEAK === "1"; // pause GPU work during Georgia Power on-peak (wkdays 2-7pm ET, excl holidays, thru Sep 30)

const LLM: DigestLlm = { model: FLASH_MODEL, local: true, reasoningEffort: "low", timeoutMs: LOCAL ? 600_000 : 180_000, retries: LOCAL_ONLY ? 1 : 3 };
const MODEL_LABEL = LOCAL ? `local:${process.env.LLM_LOCAL_MODEL}` : `cloud:${FLASH_MODEL}`;

async function main() {
  if (LOCAL_ONLY && !LOCAL) {
    console.error("ingest-transcripts: no CALL_DIGEST_LOCAL_URL/MODEL — set the rig endpoint (or INGEST_LOCAL_ONLY=0 to allow the paid cloud fallback). Refusing to run a bulk backfill on cloud by accident.");
    return;
  }
  if (!llmConfigured()) { console.error("ingest-transcripts: no LLM configured (LLM_LOCAL_* or OPENROUTER_API_KEY). Aborting."); return; }

  let syms: string[] = [];
  try { syms = (await fs.readdir(callsCacheDir())).filter((s) => !s.startsWith(".")); }
  catch { console.error("ingest-transcripts: no data/calls archive yet — run backfill-transcripts first."); return; }
  if (ONLY.length) syms = syms.filter((s) => ONLY.includes(s.toUpperCase()));
  syms.sort();

  // Build the work queue = every UN-digested record across the selected names. We keep only a light key per record
  // (never all ~1.4 GB of transcript text at once): load one symbol's records, push the keys, let them GC, repeat.
  // Then order newest-call-first so the most move-relevant quarters digest first (INGEST_ORDER=alpha keeps A→Z per
  // symbol). LIMIT caps the queue — so `INGEST_LIMIT=3000` on the default order digests the 3,000 most recent calls.
  type Work = { symbol: string; fiscalPeriod: string; callDate: string };
  const work: Work[] = [];
  for (const sym of syms) {
    for (const rec of await loadSymbolCalls(sym)) {
      if (!rec.digest) work.push({ symbol: rec.symbol, fiscalPeriod: rec.fiscalPeriod, callDate: rec.callDate });
    }
  }
  if (ORDER !== "alpha") work.sort((a, b) => (b.callDate || b.fiscalPeriod).localeCompare(a.callDate || a.fiscalPeriod));
  const queue = LIMIT ? work.slice(0, LIMIT) : work;

  console.log(`ingest-transcripts: ${work.length} undigested across ${syms.length} names · order ${ORDER}${LIMIT ? ` · processing newest ${queue.length}` : ""} · model ${MODEL_LABEL} · ${LOCAL ? "LOCAL rig" : "cloud fallback"}${PAUSE_PEAK ? " · peak-pause on (wkdys 2-7pm ET)" : ""}`);
  const t0 = Date.now();
  let done = 0, failed = 0, already = 0;
  for (const w of queue) {
    if (PAUSE_PEAK && isGeorgiaPowerPeak()) {
      console.log(`  ⏸ ${new Date().toISOString()} · Georgia Power on-peak (wkdys 14:00–19:00 ET) — pausing the rig until off-peak`);
      while (isGeorgiaPowerPeak()) await sleep(5 * 60_000);
      console.log(`  ▶ ${new Date().toISOString()} · off-peak — resuming ingest`);
    }
    const rec = await loadCallRecord(w.symbol, w.fiscalPeriod); // lazy reload → current state + bounded memory
    if (!rec) { failed++; continue; }
    if (rec.digest) { already++; continue; } // digested since the queue was built (a prior/overlapping run)
    if (DELAY_MS) await sleep(DELAY_MS);
    const digest = await digestTranscript(
      { symbol: rec.symbol, name: rec.symbol, sector: null, marketCap: null, title: rec.title, date: rec.callDate, url: rec.url, source: rec.source, text: rec.transcript.text },
      LLM, MODEL_LABEL, rec.callDate,
    ).catch((e) => { console.warn(`  ${w.symbol} ${w.fiscalPeriod}: ${String((e as Error)?.message || e).slice(0, 80)}`); return null; });
    if (!digest) { failed++; continue; }
    await saveCallRecord({ ...rec, digest, digestedAt: new Date().toISOString() });
    done++;
    if (done % 20 === 0) console.log(`  … ${done}/${queue.length} digested (latest ${w.symbol} ${w.fiscalPeriod} · ${w.callDate})`);
  }
  console.log(`ingest-transcripts: done in ${Math.round((Date.now() - t0) / 60_000)}min · ${done} digested · ${already} already · ${failed} failed`);
}

main().catch((e) => { console.error("ingest-transcripts:", String((e as Error)?.message || e)); process.exit(1); });
