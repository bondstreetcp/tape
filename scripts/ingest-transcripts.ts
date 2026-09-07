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
 * Incremental (skips already-digested records), resumable, budgeted. Env: INGEST_LIMIT (0=all), INGEST_ONLY
 * ("AAPL,MSFT"), INGEST_DELAY_MS (0), INGEST_LOCAL_ONLY (1).
 *   CALL_DIGEST_LOCAL_URL=http://192.168.1.76:8000/v1 CALL_DIGEST_LOCAL_MODEL=argus-vlm npm run ingest-transcripts
 */
import { promises as fs } from "fs";
import { scopedLocalEnv } from "../lib/callDigests";
// Map CALL_DIGEST_LOCAL_* → LLM_LOCAL_* BEFORE lib/llm reads env (it reads per-call, but assign up top to be safe).
const SCOPED = scopedLocalEnv(process.env);
if (SCOPED) Object.assign(process.env, SCOPED);
import { FLASH_MODEL, llmConfigured } from "../lib/llm";
import { digestTranscript, type DigestLlm } from "../lib/digestTranscript";
import { callsCacheDir, loadSymbolCalls, saveCallRecord, type CallRecord } from "../lib/callsArchive";
import { sleep } from "../lib/scriptKit";

const LOCAL = !!(process.env.LLM_LOCAL_BASE_URL && process.env.LLM_LOCAL_MODEL);
const LOCAL_ONLY = process.env.INGEST_LOCAL_ONLY !== "0"; // default true: don't burn cloud $ on a bulk backfill
const LIMIT = Number(process.env.INGEST_LIMIT || 0); // 0 = all un-digested
const DELAY_MS = Math.max(0, Number(process.env.INGEST_DELAY_MS || 0));
const ONLY = (process.env.INGEST_ONLY || "").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());

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

  console.log(`ingest-transcripts: ${syms.length} symbols · model ${MODEL_LABEL} · ${LOCAL ? "LOCAL rig" : "cloud fallback"}${LIMIT ? ` · limit ${LIMIT}` : ""}`);
  const t0 = Date.now();
  let done = 0, failed = 0, already = 0;
  outer: for (const sym of syms) {
    const recs = await loadSymbolCalls(sym);
    for (const rec of recs) {
      if (rec.digest) { already++; continue; }
      if (LIMIT && done >= LIMIT) break outer;
      if (DELAY_MS) await sleep(DELAY_MS);
      const digest = await digestTranscript(
        { symbol: rec.symbol, name: rec.symbol, sector: null, marketCap: null, title: rec.title, date: rec.callDate, url: rec.url, source: rec.source, text: rec.transcript.text },
        LLM, MODEL_LABEL, rec.callDate,
      ).catch((e) => { console.warn(`  ${sym} ${rec.fiscalPeriod}: ${String((e as Error)?.message || e).slice(0, 80)}`); return null; });
      if (!digest) { failed++; continue; }
      const updated: CallRecord = { ...rec, digest, digestedAt: new Date().toISOString() };
      await saveCallRecord(updated);
      done++;
      if (done % 20 === 0) console.log(`  … ${done} digested (${sym} ${rec.fiscalPeriod})`);
    }
  }
  console.log(`ingest-transcripts: done in ${Math.round((Date.now() - t0) / 60_000)}min · ${done} digested · ${already} already · ${failed} failed`);
}

main().catch((e) => { console.error("ingest-transcripts:", String((e as Error)?.message || e)); process.exit(1); });
