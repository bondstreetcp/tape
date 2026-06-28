/**
 * Morning Desk Note — a single GLM-5.2-authored overnight brief for the Home
 * dashboard that fuses the night's already-refreshed artifacts (biggest movers +
 * their catalysts, high-impact SEC filings, unusual options flow, analyst rating
 * actions) into a tiered, deduped, source-cited summary.
 *
 * Deterministic-first: scripts/refresh-desk-note.ts picks the top inputs in
 * TypeScript; GLM only narrates and organizes (it never sees prices it wasn't
 * handed, and is told to stay descriptive — no buy/sell calls). Built offline →
 * data/desk-note.json; this module owns the types + the cached loader.
 */
import { promises as fsp } from "fs";
import path from "path";

export interface DeskNoteBullet {
  text: string; // one development, descriptive
  tickers: string[]; // tickers it concerns (rendered as links)
}
export interface DeskNoteSection {
  heading: string; // e.g. "Top story", "Material filings", "Unusual options"
  bullets: DeskNoteBullet[];
}
export interface DeskNote {
  generatedAt: string; // ISO
  asOf: string; // human label for the window, e.g. "Fri Jun 26 close → overnight"
  tldr: string; // 1–2 sentence overview
  sections: DeskNoteSection[];
  counts: { movers: number; filings: number; flow: number; analyst: number }; // inputs surveyed
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
