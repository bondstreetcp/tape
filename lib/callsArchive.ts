/**
 * The earnings-call ARCHIVE (read/store layer) — a per-ticker-per-fiscal-quarter store of the RAW transcript
 * text PLUS its structured digest, built by scripts/backfill-transcripts and the ongoing digest job. This is
 * the deep history (~3yr × S&P 500) behind the AI's earnings-setup and "why did it move" analysis — distinct
 * from data/call-digests.json, which is a small rolling ~week window (KEEP=160) for the desk note.
 *
 * Storage mirrors the company-cache doctrine (lib/companyCache): sharded per-entity files under data/calls/,
 * kept OUT of the hot every-tick data.tar.gz path. A raw transcript is 50-90k chars, so S&P 500 × ~12 quarters
 * is ~300 MB raw — far too large for the every-tick tarball; the R2 sync/stamp lives in lib/callsArchiveSync
 * (script-only; it pulls in child_process/tar + R2, which the route-imported read path here must not).
 *
 * Everything here is fs-only and best-effort: a missing archive degrades the AI context, never fatal.
 */
import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import type { CallDigest } from "./callDigests";
import { conferenceRecordsDir } from "./conferencePortal";

/** One archived call — the raw transcript AND its structured digest, keyed by (symbol, fiscalPeriod). */
export interface CallRecord {
  eventType?: "earnings" | "conference"; // legacy records without a type retain earnings behavior
  symbol: string;
  fiscalPeriod: string; // stable per-quarter key, e.g. "2026-Q3" (the archive's identity — NOT callDate)
  callDate: string; // YYYY-MM-DD — the transcript's own date
  title: string;
  url: string;
  source: string; // provenance: "Google Finance" | "The Motley Fool" | ...
  transcript: { text: string; chars: number }; // the full raw text
  digest: CallDigest | null; // structured notes (null until the rig ingests it)
  fetchedAt: string; // ISO
  digestedAt?: string | null; // ISO — when the digest was produced (null = raw-only, awaiting ingestion)
}

export const callsCacheDir = (): string => path.join(process.cwd(), "data", "calls");
export const callsSymbolDir = (sym: string): string => path.join(callsCacheDir(), sym.toUpperCase());
export const callFile = (sym: string, fiscalPeriod: string): string =>
  path.join(callsSymbolDir(sym), `${fiscalPeriod.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

/** True if this (symbol, period) is already archived — the backfill's incremental skip. */
export function hasCallRecord(sym: string, fiscalPeriod: string): boolean {
  return existsSync(callFile(sym, fiscalPeriod));
}

/** Atomic write (.tmp + rename), creating the per-symbol dir — mirrors refresh-company-cache. */
export async function saveCallRecord(rec: CallRecord): Promise<void> {
  await fs.mkdir(callsSymbolDir(rec.symbol), { recursive: true });
  const f = callFile(rec.symbol, rec.fiscalPeriod);
  const tmp = `${f}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rec));
  await fs.rename(tmp, f);
}

export async function loadCallRecord(sym: string, fiscalPeriod: string): Promise<CallRecord | null> {
  if (/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/i.test(sym) && /^conference-\d+-\d+$/.test(fiscalPeriod)) {
    try { return JSON.parse(await fs.readFile(path.join(conferenceRecordsDir(), sym.toUpperCase(), `${fiscalPeriod}.json`), "utf8")) as CallRecord; } catch { /* legacy archive fallback */ }
  }
  try { return JSON.parse(await fs.readFile(callFile(sym, fiscalPeriod), "utf8")) as CallRecord; }
  catch { return null; }
}

/** All archived records for one symbol, newest call first. Best-effort: [] on any miss. */
export async function loadSymbolCalls(sym: string): Promise<CallRecord[]> {
  if (!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/i.test(sym)) return [];
  const readDir = async (dir: string): Promise<CallRecord[]> => { try {
    const files = (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && !n.endsWith(".tmp"));
    const recs = await Promise.all(files.map((n) => fs.readFile(path.join(dir, n), "utf8").then((s) => JSON.parse(s) as CallRecord).catch(() => null)));
    return recs.filter((r): r is CallRecord => !!r).sort((a, b) => (b.callDate || "").localeCompare(a.callDate || ""));
  } catch { return []; } };
  const base = await readDir(callsSymbolDir(sym));
  const overlay = await readDir(path.join(conferenceRecordsDir(), sym.toUpperCase()));
  const records = new Map(base.map(r => [r.fiscalPeriod, r]));
  for (const r of overlay) if (r.eventType === "conference" && r.symbol === sym.toUpperCase()) records.set(r.fiscalPeriod, r);
  return [...records.values()].sort((a,b) => b.callDate.localeCompare(a.callDate));
}

/** The last `n` DIGESTED calls for a symbol (newest first) — the compact history the AI surfaces read into
 *  earnings-setup / move-analysis context. Skips records still awaiting ingestion (digest === null). */
export async function getCallDigestHistory(sym: string, n = 4): Promise<CallDigest[]> {
  const recs = await loadSymbolCalls(sym);
  const out: CallDigest[] = [];
  for (const r of recs) { if (r.digest) out.push(r.digest); if (out.length >= n) break; }
  return out;
}

/** Count of archived records across all symbols (for the sync stamp / logging). Best-effort. */
export async function countCallRecords(): Promise<number> {
  try {
    const syms = await fs.readdir(callsCacheDir());
    let n = 0;
    for (const s of syms) {
      try { n += (await fs.readdir(path.join(callsCacheDir(), s))).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp")).length; } catch { /* not a dir */ }
    }
    return n;
  } catch { return 0; }
}
