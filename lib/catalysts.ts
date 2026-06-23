/**
 * Per-stock "why it moved" catalyst lines for the Movers panel. A terse, grounded clause
 * (e.g. "Q3 earnings beat, raised FY guidance" / "agreed to be acquired by X") generated
 * offline from each mover's own recent news in scripts/refresh-catalysts.ts — never the raw
 * latest headline (which devolved into earnings-PR boilerplate and law-firm spam). When the
 * news doesn't clearly explain a move, the catalyst is empty and the UI simply shows nothing.
 */
import { promises as fsp } from "fs";
import path from "path";

export interface Catalyst {
  why: string; // the catalyst clause ("" = no clear catalyst)
  ts: string; // ISO timestamp it was generated (for the TTL refresh)
  tf?: string; // the timeframe the catalyst explains ("1d"/"1w"/"ytd"/"1y") — gates cache reuse
}
export type CatalystMap = Record<string, Catalyst>;

let _cache: Promise<CatalystMap> | null = null;

export function loadCatalysts(): Promise<CatalystMap> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "catalysts.json"), "utf8")
      .then((s) => JSON.parse(s) as CatalystMap)
      .catch(() => ({}));
  return _cache;
}
