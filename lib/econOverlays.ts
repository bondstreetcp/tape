// Economic-series overlays for the compare chart. Keys map to series already in the
// macro snapshot (data/macro.json — indicators or releases), served Vercel-safe by
// /api/econ-series/[key] (FRED itself is blocked from serverless). Symbols are
// prefixed "ECON:" so CompareChart routes them to that endpoint and shows the label.
export interface EconOverlay { key: string; label: string }

export const ECON_OVERLAYS: EconOverlay[] = [
  { key: "housing", label: "Housing Starts" },
  { key: "cpi", label: "CPI (YoY)" },
  { key: "unrate", label: "Unemployment" },
  { key: "ff", label: "Fed Funds" },
  { key: "t102", label: "10Y–2Y" },
];

export const ECON_PREFIX = "ECON:";
export const econSym = (key: string) => `${ECON_PREFIX}${key}`;

const LABEL_BY_SYM: Record<string, string> = Object.fromEntries(
  ECON_OVERLAYS.map((o) => [econSym(o.key), o.label]),
);

/** Friendly label for a compare symbol (econ overlays → their name; else the symbol). */
export const prettySym = (sym: string) => LABEL_BY_SYM[sym] ?? sym;
