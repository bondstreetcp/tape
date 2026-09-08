/**
 * Ingest EXTERNAL transcripts you produced elsewhere — e.g. your own ASR (Whisper on the M4s) over audio you're
 * licensed to use — into the data/calls archive, so they flow through the SAME digest → sync → reader → AI path as
 * the scraped earnings-call transcripts. This is the tape SIDE of the audio pipeline: the capture + transcription
 * happen on YOUR side; this script never fetches or scrapes a source. Internal-research use.
 *
 * Drop files into data/incoming-transcripts/ (override the dir with argv[2]):
 *   • <SYM>.json  — { "symbol", "text", "title"?, "date"? (YYYY-MM-DD), "period"?, "source"?, "url"? }
 *   • <SYM>.txt   — raw transcript; symbol (+ optional period) parsed from the filename: STZ_2026-09-08.txt
 * Each becomes a RAW CallRecord (digest=null); the existing `ingest-transcripts` digests it (newest-first) and
 * `sync-calls-archive` publishes. Processed drops move to processed/, unreadable ones to failed/.
 *   npm run ingest-transcript-text
 */
import { promises as fs } from "fs";
import path from "path";
import { saveCallRecord } from "../lib/callsArchive";
import { parseDrop, dropToRecord } from "../lib/transcriptDrop";

async function main() {
  const dir = process.argv[2] || path.join(process.cwd(), "data", "incoming-transcripts");
  await fs.mkdir(dir, { recursive: true });
  const entries = (await fs.readdir(dir)).filter((n) => /\.(json|txt)$/i.test(n));
  if (!entries.length) {
    console.log(`ingest-transcript-text: no drops in ${dir} — put <SYM>.json / <SYM>.txt files here.`);
    return;
  }

  const now = new Date().toISOString();
  const move = async (name: string, sub: string) => {
    const to = path.join(dir, sub);
    await fs.mkdir(to, { recursive: true });
    await fs.rename(path.join(dir, name), path.join(to, name)).catch(() => {});
  };

  let ok = 0, bad = 0;
  for (const name of entries) {
    let contents: string;
    try { contents = await fs.readFile(path.join(dir, name), "utf8"); } catch { continue; }
    const drop = parseDrop(name, contents);
    if (!drop) {
      console.warn(`  x ${name}: unreadable / missing symbol|text (needs >=100 chars) — moved to failed/`);
      await move(name, "failed");
      bad++;
      continue;
    }
    const rec = dropToRecord(drop, now);
    await saveCallRecord(rec);
    await move(name, "processed");
    ok++;
    console.log(`  + ${rec.symbol} ${rec.fiscalPeriod} - ${rec.callDate} - ${rec.transcript.chars} chars (${rec.source})`);
  }
  console.log(`ingest-transcript-text: archived ${ok} - skipped ${bad}. Next: npm run ingest-transcripts (or let the nightly driver digest + sync).`);
}

main().catch((e) => { console.error("ingest-transcript-text:", String((e as Error)?.message || e)); process.exit(1); });
