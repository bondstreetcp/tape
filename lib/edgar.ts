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

export const HEADERS = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };

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
const subCache = new Map<string, any>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function getSubmissions(cik: string): Promise<any> {
  const c = subCache.get(cik);
  if (c) return c;
  const s = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  subCache.set(cik, s);
  return s;
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
  const s = await getSubmissions(cik);
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

export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
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

// ---- Material filings & earnings (8-K item 2.02 = earnings release) ----------
const FORM_LABEL: Record<string, string> = {
  "10-K": "Annual report (10-K)",
  "10-Q": "Quarterly report (10-Q)",
  "8-K": "Current report (8-K)",
  "20-F": "Annual report (20-F)",
  "40-F": "Annual report (40-F)",
  "6-K": "Foreign report (6-K)",
  "DEF 14A": "Proxy statement",
  "DEFA14A": "Proxy (additional)",
  "S-1": "Registration (S-1)",
  "424B5": "Prospectus (424B5)",
  "SC 13D": "13D (activist stake)",
  "SC 13G": "13G (passive stake)",
};
const KEY_FORMS = new Set(Object.keys(FORM_LABEL));

export interface Filing {
  form: string;
  date: string;
  acceptance: string; // acceptanceDateTime (ET) — hour tells before-open vs after-close
  acc: string;
  doc: string;
  items: string;
  label: string;
  isEarnings: boolean;
  url: string;
}

export interface FilingsPage {
  cik: string | null;
  filings: Filing[];
  nextOffset: number | null;
}

export async function getFilings(symbol: string, offset = 0, limit = 30): Promise<FilingsPage> {
  const cik = await tickerToCik(symbol);
  if (!cik) return { cik: null, filings: [], nextOffset: null };
  const s = await getSubmissions(cik);
  const r = s.filings?.recent;
  if (!r?.form) return { cik, filings: [], nextOffset: null };
  const all: Filing[] = [];
  for (let i = 0; i < r.form.length; i++) {
    const form = r.form[i];
    if (!KEY_FORMS.has(form)) continue;
    const items = r.items?.[i] || "";
    const isEarnings = form === "8-K" && /(^|,)\s*2\.02/.test(items);
    const accNo = r.accessionNumber[i].replace(/-/g, "");
    all.push({
      form,
      date: r.filingDate[i],
      acceptance: r.acceptanceDateTime?.[i] || "",
      acc: r.accessionNumber[i],
      doc: r.primaryDocument[i],
      items,
      isEarnings,
      label: isEarnings ? "Earnings release" : FORM_LABEL[form] || form,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}/${r.primaryDocument[i]}`,
    });
  }
  const page = all.slice(offset, offset + limit);
  const nextOffset = offset + limit < all.length ? offset + limit : null;
  return { cik, filings: page, nextOffset };
}

const NAMED_ENT: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…",
};
const safeChar = (cp: number) => {
  try {
    return cp && cp >= 32 ? String.fromCodePoint(cp) : " ";
  } catch {
    return " ";
  }
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENT[n.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 80000);
}

/** Fetch a filing's main human-readable exhibit (e.g. the earnings press release) as text. */
export async function getFilingText(
  symbol: string,
  acc: string,
): Promise<{ title: string; text: string; url: string } | null> {
  const cik = await tickerToCik(symbol);
  if (!cik) return null;
  const accNo = acc.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}`;
  try {
    const idx = await getJson(`${base}/index.json`);
    const items: any[] = idx?.directory?.item || [];
    const htms = items.filter((f) => /\.html?$/i.test(f.name) && !/^R\d|index|FilingSummary/i.test(f.name));
    htms.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
    // Prefer an EX-99 press-release exhibit; otherwise the largest .htm.
    const pick = htms.find((f) => /ex-?99|ex99/i.test(f.name)) || htms[0];
    if (!pick) return null;
    const url = `${base}/${pick.name}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const text = htmlToText(await res.text());
    return { title: pick.name, text, url };
  } catch {
    return null;
  }
}
