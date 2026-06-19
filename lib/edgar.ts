/**
 * SEC EDGAR insider (Form 4) transactions. Resolves a ticker to its CIK, lists
 * all of the company's Form 4 filings (recent + older chunks), and parses each
 * filing's XML for non-derivative transactions (open-market buys/sells, grants,
 * exercises, etc.). Structured XML Form 4s exist from ~2003 on, so coverage is
 * roughly 2003–present.
 *
 * EDGAR requires a descriptive User-Agent and asks for <10 req/s; we fetch each
 * page of filings with a small concurrency pool.
 */
import * as cheerio from "cheerio";

const HEADERS = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };

export interface InsiderTx {
  date: string; // YYYY-MM-DD
  insider: string;
  role: string;
  code: string; // P, S, A, M, F, G, …
  acquired: boolean; // A (acquired) vs D (disposed)
  shares: number | null;
  price: number | null;
  value: number | null;
  kind: "buy" | "sell" | "other";
  acc: string; // accession number (for the EDGAR link)
}

export interface InsiderPage {
  cik: string | null;
  transactions: InsiderTx[];
  nextOffset: number | null;
  totalFilings: number;
}

const num = (s: string): number | null => {
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const normTicker = (t: string) => String(t).toUpperCase().replace(/[^A-Z0-9]/g, "");

// In-process caches (the route revalidates daily anyway).
let tickerMap: Map<string, string> | null = null;
const listCache = new Map<string, F4Filing[]>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function loadTickerMap(): Promise<Map<string, string>> {
  if (tickerMap) return tickerMap;
  const j = await getJson("https://www.sec.gov/files/company_tickers.json");
  const m = new Map<string, string>();
  for (const k in j) {
    const e = j[k];
    if (e?.ticker && e?.cik_str != null) m.set(normTicker(e.ticker), String(e.cik_str).padStart(10, "0"));
  }
  tickerMap = m;
  return m;
}

export async function tickerToCik(symbol: string): Promise<string | null> {
  const m = await loadTickerMap();
  return m.get(normTicker(symbol)) ?? null;
}

interface F4Filing { acc: string; doc: string; date: string; }

function collectForm4(r: any, out: F4Filing[]) {
  if (!r?.form) return;
  for (let i = 0; i < r.form.length; i++) {
    const doc = r.primaryDocument?.[i] || "";
    // Only structured XML Form 4s (and amendments) — pre-2003 .txt filings can't be parsed.
    if ((r.form[i] === "4" || r.form[i] === "4/A") && doc.endsWith(".xml"))
      out.push({ acc: r.accessionNumber[i], doc, date: r.filingDate[i] });
  }
}

async function getForm4List(cik: string): Promise<F4Filing[]> {
  const cached = listCache.get(cik);
  if (cached) return cached;
  const s = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const out: F4Filing[] = [];
  collectForm4(s.filings?.recent, out);
  for (const f of s.filings?.files || []) {
    try {
      collectForm4(await getJson(`https://data.sec.gov/submissions/${f.name}`), out);
    } catch {
      /* skip a bad chunk */
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  listCache.set(cik, out);
  return out;
}

async function parseForm4(cik: string, f: F4Filing): Promise<InsiderTx[]> {
  const accNo = f.acc.replace(/-/g, "");
  const rawDoc = (f.doc || "").split("/").pop() || ""; // strip the xslF345…/ render prefix
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}/${rawDoc}`;
  let xml: string;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  const $ = cheerio.load(xml, { xmlMode: true });
  const insider = ($("reportingOwner rptOwnerName").first().text() || "").trim() || "Insider";
  const rel = $("reportingOwnerRelationship").first();
  const flag = (sel: string) => /1|true/i.test(rel.find(sel).first().text());
  const roles: string[] = [];
  if (flag("isDirector")) roles.push("Director");
  if (flag("isOfficer")) roles.push(rel.find("officerTitle").first().text().trim() || "Officer");
  if (flag("isTenPercentOwner")) roles.push("10% Owner");
  const role = roles.join(", ") || "Insider";

  const out: InsiderTx[] = [];
  $("nonDerivativeTransaction").each((_, el) => {
    const $el = $(el);
    const date = $el.find("transactionDate value").first().text().trim();
    if (!date) return;
    const code = $el.find("transactionCoding transactionCode").first().text().trim();
    const ad = $el.find("transactionAcquiredDisposedCode value").first().text().trim();
    const shares = num($el.find("transactionShares value").first().text());
    const price = num($el.find("transactionPricePerShare value").first().text());
    out.push({
      date,
      insider,
      role,
      code,
      acquired: ad === "A",
      shares,
      price,
      value: shares != null && price != null ? shares * price : null,
      kind: code === "P" ? "buy" : code === "S" ? "sell" : "other",
      acc: f.acc,
    });
  });
  return out;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const ret = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        ret[k] = await fn(items[k]);
      }
    }),
  );
  return ret;
}

export async function getInsiderTransactions(symbol: string, offset = 0, limit = 24): Promise<InsiderPage> {
  const cik = await tickerToCik(symbol);
  if (!cik) return { cik: null, transactions: [], nextOffset: null, totalFilings: 0 };
  const list = await getForm4List(cik);
  const page = list.slice(offset, offset + limit);
  const parsed = await pool(page, 6, (f) => parseForm4(cik, f));
  const transactions = parsed.flat().sort((a, b) => b.date.localeCompare(a.date));
  const nextOffset = offset + limit < list.length ? offset + limit : null;
  return { cik, transactions, nextOffset, totalFilings: list.length };
}
