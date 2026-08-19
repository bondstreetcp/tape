/**
 * Morning Desk Note — a single GLM-5.2-authored overnight brief for the Home
 * dashboard / Morning Desk tab that fuses the night's already-refreshed artifacts
 * (biggest movers + their catalysts + trend/valuation context, high-impact SEC
 * filings, unusual options flow, analyst rating actions) into a tiered, deduped,
 * TWO-LAYER summary: each development carries both the fact AND the read (why it
 * matters / signal-vs-noise / what it sets up), plus a forward-looking watchlist.
 *
 * Deterministic-first: scripts/refresh-desk-note.ts picks the top inputs in
 * TypeScript; GLM only analyzes/organizes and stays descriptive — never a
 * buy/sell/hold call. Built offline → data/desk-note.json; this module owns the
 * types + the cached loader.
 */
import path from "path";
import { cachedFile } from "./jsonCache";

export interface DeskNoteBullet {
  fact: string; // what happened (concise)
  read: string; // the SECOND LAYER — why it matters / read-through / signal-vs-noise / what to watch
  tickers: string[]; // tickers it concerns (rendered as links)
  /** @deprecated pre-v2 notes carried a per-bullet type chip ("Trend"/"Catalyst"/…) — decoration, not
   * information (user feedback 2026-07-08). New notes don't write it; kept optional for old files. */
  tag?: string;
}
export interface DeskNoteSection {
  heading: string;
  synthesis: string; // the second-layer thematic read tying the section's bullets together
  bullets: DeskNoteBullet[];
}
export interface DeskNoteWatch {
  text: string; // a concrete upcoming catalyst (earnings tonight, a deal vote, an FDA date, a close)
  tickers: string[];
}
/** A grounded web-search citation (from lib/ask) backing a mover's "why did it move" explanation. */
export interface DeskSource {
  title: string;
  uri: string;
}
/** CODE-BUILT market context strip (no LLM) — cap-weighted S&P 1-day, breadth, VIX, dealer gamma. */
export interface DeskTape {
  avg1d: number | null; // cap-weighted S&P 500 1-day return, %
  adv: number; // advancers (1d > 0)
  dec: number; // decliners
  big: number; // names that moved ±4%+
  vix: number | null;
  vixAsOf?: string | null; // FRED VIX closes lag ~a day — stamp it so the strip stays honest
  gamma: { symbol: string; regime: "long" | "short"; distToFlipPct: number | null }[]; // SPY/QQQ
}

/** CODE-BUILT forward calendar (no LLM) — who reports today/tomorrow + imminent hard binaries. */
export interface DeskCalendar {
  earnings: { symbol: string; name: string; when: "today" | "tomorrow"; implied: number | null }[];
  binaries: { ticker: string; label: string; date: string; daysTo: number; implied: number | null }[];
}

export interface DeskNote {
  generatedAt: string; // ISO
  run?: "morning" | "evening"; // which desk run wrote it (pre-open vs post-close framing)
  asOf: string; // human label for the window
  tldr: string; // 2-3 sentence overview — the tape + the one thing that matters most
  tape?: DeskTape | null; // code-built, always-accurate context strip
  calendar?: DeskCalendar | null; // code-built forward calendar
  sections: DeskNoteSection[];
  watchToday: DeskNoteWatch[];
  /** Grounded web-search citations for movers explained via the ask engine, keyed by ticker — rendered
   *  as chips under the matching bullets (mirrors the stock-page ExplainMove UX). Absent on old notes. */
  moveSources?: { ticker: string; sources: DeskSource[] }[];
  counts: { movers: number; filings: number; flow: number; analyst: number };
}

// mtime+size-keyed (lib/jsonCache), NOT a permanent module cache: the NAS refreshes data/ IN PLACE
// under a live server (tape-web-entrypoint.sh), so the loader MUST re-read when desk-note.json is
// re-hydrated. The old `let _cache` singleton was set once per process and never invalidated — the
// desk note froze at process boot and only changed on a rebuild/restart, so across a gap between code
// pushes the home page's brief went stale for DAYS while every jsonCache-backed feed refreshed hourly
// (diagnosed 2026-08-19: "Morning run · 2d ago" sitting on a fully healthy pipeline). cachedFile
// self-invalidates on the next read after a rewrite — the same contract the whole in-place refresh relies on.
export function loadDeskNote(): Promise<DeskNote | null> {
  return cachedFile(path.join(process.cwd(), "data", "desk-note.json"), (s) => JSON.parse(s) as DeskNote);
}
