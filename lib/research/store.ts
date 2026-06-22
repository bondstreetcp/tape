/**
 * Research-corpus store. Two backends behind one async surface, chosen by env:
 *   - RESEARCH_DATABASE_URL set → Supabase/Postgres (store.db.ts) — production, persists
 *     across devices and works on Vercel serverless.
 *   - otherwise → local filesystem (data/.research/, gitignored — never committed/deployed).
 * The corpus is licensed, so neither the raw PDFs nor the extracted data go into git.
 */
import fs from "node:fs";
import path from "node:path";
import type { StoredDoc } from "./types";
import { dbListDocs, dbGetDoc, dbSaveDoc, dbCorpusIndex } from "./store.db";

const DIR = path.join(process.cwd(), "data", ".research", "docs");
const useDb = !!process.env.RESEARCH_DATABASE_URL;

// Strip US exchange/RIC suffixes (MU.O, MU.N, MSFT.OQ) so a broker's RIC merges with the
// plain ticker; keep international exchange suffixes (6086.HK, AZN.L, NESN.SW).
export const normTicker = (t: string): string => (t || "").toUpperCase().replace(/\.(O|OQ|N|A|K|P|PK|Q)$/i, "");

export const storeAvailable = (): boolean => {
  if (useDb) return true;
  try { return fs.existsSync(DIR); } catch { return false; }
};

// --- local filesystem backend (dev) ---
function fsListDocs(t?: string): StoredDoc[] {
  let files: string[] = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")); } catch { return []; }
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
function fsGetDoc(id: string): StoredDoc | null {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as StoredDoc; } catch { return null; }
}
function fsSaveDoc(doc: StoredDoc): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${doc.id}.json`), JSON.stringify(doc, null, 2));
}
function fsCorpusIndex(): { ticker: string; company: string; count: number; latest: string }[] {
  const by = new Map<string, { ticker: string; company: string; count: number; latest: string }>();
  for (const d of fsListDocs()) {
    const e = by.get(d.ticker) ?? { ticker: d.ticker, company: d.company, count: 0, latest: "" };
    e.count++;
    if ((d.publishDate || "") > e.latest) e.latest = d.publishDate || "";
    if (d.company && !e.company) e.company = d.company;
    by.set(d.ticker, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

// --- public async surface (picks the backend by env) ---
export async function listDocs(ticker?: string): Promise<StoredDoc[]> {
  const t = ticker ? normTicker(ticker) : undefined;
  return useDb ? dbListDocs(t) : fsListDocs(t);
}
export async function getDoc(id: string): Promise<StoredDoc | null> {
  return useDb ? dbGetDoc(id) : fsGetDoc(id);
}
export async function saveDoc(doc: StoredDoc): Promise<void> {
  const d = { ...doc, ticker: normTicker(doc.ticker) };
  return useDb ? dbSaveDoc(d) : Promise.resolve(fsSaveDoc(d));
}
export async function corpusIndex(): Promise<{ ticker: string; company: string; count: number; latest: string }[]> {
  return useDb ? dbCorpusIndex() : fsCorpusIndex();
}
