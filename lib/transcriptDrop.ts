/**
 * Pure helpers for ingesting EXTERNAL transcripts you produced elsewhere (e.g. your own ASR — Whisper on the M4s —
 * over audio you're licensed to use) into the data/calls archive. scripts/ingest-transcript-text does the fs sweep;
 * this file is the pure parse + shape (route-safe, unit-tested). Nothing here fetches or scrapes anything.
 */
import path from "path";
import type { CallRecord } from "./callsArchive";

/** A dropped transcript, before it becomes a CallRecord. `symbol` + `text` are required; the rest default. */
export interface Drop {
  symbol: string;
  text: string;
  title?: string;
  date?: string; // YYYY-MM-DD
  period?: string; // archive key (e.g. "2026-Q3" or a conference label); defaults to the date
  source?: string;
  url?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * Parse one dropped file into a Drop (or null if unusable). `.json` → {symbol, text, title?, date?, period?, source?,
 * url?}; `.txt` → raw transcript with symbol (+ optional period) taken from the filename, e.g. STZ_2026-09-08.txt.
 * Requires a non-empty symbol and ≥100 chars of text (so an empty/partial file is skipped, not archived).
 */
export function parseDrop(filename: string, contents: string): Drop | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".json") {
    let o: unknown;
    try { o = JSON.parse(contents); } catch { return null; }
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (typeof r.symbol !== "string" || typeof r.text !== "string") return null;
    if (!r.symbol.trim() || r.text.trim().length < 100) return null;
    return { symbol: r.symbol, text: r.text, title: str(r.title), date: str(r.date), period: str(r.period), source: str(r.source), url: str(r.url) };
  }
  if (ext === ".txt") {
    if (contents.trim().length < 100) return null;
    const parts = path.basename(filename, ext).split(/[_.]/);
    const symbol = (parts[0] || "").trim();
    if (!symbol) return null;
    const period = parts[1] && /\d/.test(parts[1]) ? parts[1] : undefined; // a datey/quartery 2nd segment = the period
    return { symbol, text: contents, period };
  }
  return null;
}

/** Shape a Drop into a raw CallRecord (digest=null → the existing ingest digests it). Pure; pass `nowISO`. */
export function dropToRecord(d: Drop, nowISO: string): CallRecord {
  const symbol = d.symbol.trim().toUpperCase();
  const callDate = (d.date || nowISO.slice(0, 10)).trim();
  const source = (d.source || "external transcript").trim();
  const period = (d.period || callDate).trim(); // conferences have no fiscal quarter → key by date (or a caller label)
  return {
    symbol,
    fiscalPeriod: period,
    callDate,
    title: (d.title || `${symbol} — ${source}`).trim(),
    url: d.url?.trim() || "",
    source,
    transcript: { text: d.text, chars: d.text.length },
    digest: null,
    fetchedAt: nowISO,
    digestedAt: null,
  };
}
