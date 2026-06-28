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
  tag: string; // development type: Deal | Catalyst | Positioning | Unexplained | Trend | Analyst | Earnings ahead | Watch
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
export interface DeskNote {
  generatedAt: string; // ISO
  asOf: string; // human label for the window
  tldr: string; // 2-3 sentence overview — the tape + the one thing that matters most
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
