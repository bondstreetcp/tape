// Filing Risk-Factor Watch — pulls the "Item 1A. Risk Factors" section from a company's two most
// recent 10-Ks and (via the LLM, in the API route) diffs them: what risks were ADDED, dropped, or
// notably intensified year-over-year. A new risk factor is often the earliest written signal that
// management sees something changing. Server-side (uses EDGAR); the panel imports the type only.

import { getFilings, HEADERS } from "./edgar";

export interface RiskChange {
  title: string; // the risk, in a few words
  note: string; // one line on what it is / why it's notable
}
export interface RiskFactorDiff {
  symbol: string;
  currentDate: string; // filing date of the latest 10-K
  priorDate: string; // filing date of the prior 10-K
  summary: string;
  added: RiskChange[];
  removed: RiskChange[];
  intensified: RiskChange[];
}

// Foreign filers use 20-F with a different structure — skip (US 10-K only).
const NON_US = /\.(PA|AS|L|DE|SW|TO|MX|KS|KQ|T|HK|MI|MC|F|SS|SZ|AX|NZ|SI|TW|SA|BR|VI|ST|HE|CO|OL|NS|BO)$/i;

async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (r.ok) return await r.text();
      if (r.status === 429 || r.status >= 500) continue;
      return null;
    } catch {
      /* retry */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// Strip a 10-K's HTML to text and carve out the Item 1A → (Item 1B | Item 2) span. The table of
// contents also lists "Item 1A", so we take the LONGEST such span (the real section, not the TOC
// line). Capped so the LLM prompt stays sane.
export function extractRiskFactors(html: string): string | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const startRe = /item[\s ]*1a[\.:\s—-]*risk[\s ]*factors/gi;
  const endRe = /item[\s ]*(?:1b|2)[\.:\s—-]/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(text))) starts.push(m.index);
  let best: { s: number; e: number; len: number } | null = null;
  for (const s of starts) {
    endRe.lastIndex = s + 6;
    const e = endRe.exec(text);
    const end = e ? e.index : Math.min(text.length, s + 80000);
    const len = end - s;
    if (len > 1000 && (!best || len > best.len)) best = { s, e: end, len };
  }
  if (!best) return null;
  return text.slice(best.s, best.e).slice(0, 22000);
}

// Fetch + extract Item 1A from the two most recent 10-Ks. Returns null when it can't (intl, <2
// 10-Ks on file, or the section couldn't be located in either).
export async function fetchRiskFactorSections(symbol: string): Promise<{ curr: { date: string; text: string }; prior: { date: string; text: string } } | null> {
  const s = decodeURIComponent(symbol).trim().toUpperCase();
  if (!s || NON_US.test(s)) return null;
  const page = await getFilings(s, 0, 250).catch(() => null); // 10-Ks are annual amid many 8-Ks — look back far enough for two
  const tenKs = (page?.filings || []).filter((f) => f.form === "10-K").slice(0, 2);
  if (tenKs.length < 2) return null;
  const [c, p] = tenKs;
  const [ch, ph] = await Promise.all([fetchText(c.url), fetchText(p.url)]);
  const ct = ch ? extractRiskFactors(ch) : null;
  const pt = ph ? extractRiskFactors(ph) : null;
  if (!ct || !pt) return null;
  return { curr: { date: c.date, text: ct }, prior: { date: p.date, text: pt } };
}
