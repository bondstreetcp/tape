/**
 * Research-corpus store. The MVP uses a local filesystem store (data/.research/, gitignored
 * — the corpus is licensed and never committed or deployed). The function surface here is
 * the seam: a Supabase/Postgres+pgvector adapter implements the same shape for production
 * (Vercel serverless can't use the local FS), swapped via an env flag. Until then the
 * Research desk is a local-dev feature.
 */
import fs from "node:fs";
import path from "node:path";
import type { StoredDoc } from "./types";

const DIR = path.join(process.cwd(), "data", ".research", "docs");

// Strip US exchange/RIC suffixes (MU.O, MU.N, MSFT.OQ) so a broker's RIC merges with the
// plain ticker; keep international exchange suffixes (6086.HK, AZN.L, NESN.SW).
export const normTicker = (t: string): string => (t || "").toUpperCase().replace(/\.(O|OQ|N|A|K|P|PK|Q)$/i, "");

export const storeAvailable = (): boolean => {
  try { return fs.existsSync(DIR); } catch { return false; }
};

export function listDocs(ticker?: string): StoredDoc[] {
  let files: string[] = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")); } catch { return []; }
  const t = ticker ? normTicker(ticker) : null;
  const docs: StoredDoc[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as StoredDoc;
      d.ticker = normTicker(d.ticker);
      if (!t || d.ticker === t) docs.push(d);
    } catch { /* skip malformed */ }
  }
  return docs.sort((a, b) => (b.publishDate || "").localeCompare(a.publishDate || ""));
}

export function getDoc(id: string): StoredDoc | null {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as StoredDoc; } catch { return null; }
}

export function saveDoc(doc: StoredDoc): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${doc.id}.json`), JSON.stringify(doc, null, 2));
}

/** Tickers present in the corpus with their doc counts (newest date), for the desk index. */
export function corpusIndex(): { ticker: string; company: string; count: number; latest: string }[] {
  const by = new Map<string, { ticker: string; company: string; count: number; latest: string }>();
  for (const d of listDocs()) {
    const e = by.get(d.ticker) ?? { ticker: d.ticker, company: d.company, count: 0, latest: "" };
    e.count++;
    if ((d.publishDate || "") > e.latest) e.latest = d.publishDate || "";
    if (d.company && !e.company) e.company = d.company;
    by.set(d.ticker, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}
