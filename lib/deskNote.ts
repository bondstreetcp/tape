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
import { promises as fsp } from "fs";
import path from "path";

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
  counts: { movers: number; filings: number; flow: number; analyst: number };
}

let _cache: Promise<DeskNote | null> | null = null;

export function loadDeskNote(): Promise<DeskNote | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "desk-note.json"), "utf8")
      .then((s) => JSON.parse(s) as DeskNote)
      .catch(() => null);
  return _cache;
}
