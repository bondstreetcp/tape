import { NextRequest, NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/companyProfile";
import { tickerToCik, getSubmissions, fetchWithRetry, htmlToText } from "@/lib/edgar";
import { chatJSON, FLASH_MODEL, NO_ADVICE, llmConfigured } from "@/lib/llm";
import type { ExecBio, ExecBiosResponse } from "@/lib/execBios";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Executive bios drilled from a company's SEC filings — prior roles/employers, tenure, education, other
// boards. Two grounded sources: the DEF 14A proxy (rich director bios — education, other boards) + the 10-K
// "Information about our Executive Officers" section (business experience for the non-director officers).
// GROUNDED: the LLM copies only what a filing states about a named person and returns null where it isn't
// disclosed — never invented. Same doctrine as the rest of the app: filings supply facts, the model reads.

const SYSTEM =
  "You extract EXECUTIVE / DIRECTOR bios from a company's SEC filings as JSON. You are given a ROSTER of names and filing text that may contain a DEF 14A proxy (rich director bios: prior roles, education, other public-company boards) and/or a 10-K 'Executive Officers' section (business experience for officers). " +
  "For each roster person, find their bio wherever it appears and extract ONLY what the text states: prior positions/employers (priorRoles), the year they took their CURRENT role (since), education (degrees + schools), and other PUBLIC-company boards (otherBoards). " +
  "CRITICAL: copy only facts written in the text. If a field is not stated (education is frequently omitted for officers), return an empty array or null — NEVER guess, infer, or use outside knowledge about the person. If a roster person's bio is not in the text, set found:false. summary: one short plain-English sentence built ONLY from the extracted facts, or null. " +
  NO_ADVICE;

// Strip honorifics/punctuation → tokens (the LLM echoes "Mr. Tim Cook" while the roster has "Timothy D. Cook").
const parts = (n: string): string[] =>
  n.toLowerCase().replace(/\b(mr|mrs|ms|dr|prof|sir)\b/g, "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
/** Map the LLM's echoed name to a roster person. Prefer an exact surname+first-name match; fall back to
 *  surname+first-initial ONLY if it's unambiguous — never guess when two officers could collide. */
function matchRoster(llmName: string, roster: string[]): string | null {
  const a = parts(llmName);
  if (!a.length) return null;
  const aLast = a[a.length - 1], aFirst = a[0];
  const full = roster.filter((rn) => { const b = parts(rn); return b.length && b[b.length - 1] === aLast && b[0] === aFirst; });
  if (full.length === 1) return full[0];
  const init = roster.filter((rn) => { const b = parts(rn); return b.length && b[b.length - 1] === aLast && b[0][0] === aFirst[0]; });
  return init.length === 1 ? init[0] : null; // 0 or >1 candidates → don't attribute (no bio beats a wrong one)
}

// TEXT GROUNDING — the LLM invents a school/employer from parametric memory (it gave Dimon "Colgate", which
// is in the proxy but for a DIFFERENT director). So every school/company name in an extracted fact must appear
// WITHIN a window of an occurrence of THIS person's surname — i.e. inside their own bio paragraph. Kills both
// pure fabrication and mis-attribution. Better to show nothing than a wrong fact.
const STOP = new Set(
  ("university college schools school graduate graduated chief executive officer president vice senior director board company companies corporation corp group holdings inc llc lp the and of a an from to at in on for with as by its our their he she his her mr ms mrs prof bachelor bachelors master masters degree bba mba emba phd jd md ba bs bsc msc llb co ceo cfo coo cto cmo cio evp svp vp gc chairman chairwoman chair partner counsel treasurer secretary founder cofounder cochairman since served serves serving prior previously current currently formerly until through role roles various positions us usa u.s inc.").split(" "),
);
function properNouns(str: string): string[] {
  const caps = str.match(/\p{Lu}[\p{L}&.'’-]{3,}/gu) || []; // Capitalized words (Unicode-aware), 4+ chars
  const acr = str.match(/\b[A-Z][A-Z&]{1,4}\b/g) || []; // all-caps acronyms (IBM, MIT, NYSE, GE)
  return [...caps, ...acr]
    .map((t) => t.toLowerCase().replace(/[.'’&-]+$/g, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
}
/** Windows [start,end) around each occurrence of the surname — a bio starts with the name, facts follow. */
function bioWindows(textLower: string, surname: string, back = 200, fwd = 2200): [number, number][] {
  if (surname.length < 3) return [];
  const wins: [number, number][] = [];
  let i = textLower.indexOf(surname);
  while (i >= 0 && wins.length < 60) { wins.push([Math.max(0, i - back), i + fwd]); i = textLower.indexOf(surname, i + 1); }
  return wins;
}
const inWindows = (needle: string, textLower: string, wins: [number, number][]) => wins.some(([s, e]) => textLower.slice(s, e).includes(needle));
/** A fact is grounded if every proper noun in it sits in this person's bio window. `requireNoun` forces a
 *  school/company name to exist (education/boards must name something; a generic-word-only value is dropped). */
function groundedNear(str: string, textLower: string, wins: [number, number][], requireNoun = false): boolean {
  const toks = properNouns(str);
  if (!toks.length) return !requireNoun; // generic title (e.g. "Chief Operating Officer") — keep unless a name is required
  if (!wins.length) return false;
  return toks.every((t) => inWindows(t, textLower, wins));
}

/** Fetch a filing's PRIMARY document (the proxy / 10-K itself — not the largest exhibit) as text. */
async function fetchPrimary(cik: string, acc: string, doc: string): Promise<{ url: string; text: string } | null> {
  if (!doc) return null;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`;
  try {
    const t = htmlToText(await (await fetchWithRetry(url)).text());
    return t.length > 1000 ? { url, text: t } : null;
  } catch { return null; }
}

/** Gather the grounded bio text: the latest DEF 14A (full) + the 10-K's executive-officers section. */
async function gatherSources(symbol: string): Promise<{ proxy: { url: string; date: string } | null; text: string } | null> {
  const cik = await tickerToCik(symbol).catch(() => null);
  if (!cik) return null;
  const sub = await getSubmissions(cik).catch(() => null);
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  const latest = (form: string) => { for (let i = 0; i < r.form.length; i++) if (r.form[i] === form) return { acc: r.accessionNumber[i], date: r.filingDate[i], doc: r.primaryDocument[i] }; return null; };

  let text = "";
  let proxy: { url: string; date: string } | null = null;

  const pf = latest("DEF 14A");
  if (pf) {
    const ft = await fetchPrimary(cik, pf.acc, pf.doc);
    if (ft && ft.text.length > 2000) { text += "=== PROXY STATEMENT (DEF 14A) ===\n" + ft.text.slice(0, 68000); proxy = { url: ft.url, date: pf.date }; }
  }

  const tf = latest("10-K");
  if (tf) {
    const ft = await fetchPrimary(cik, tf.acc, tf.doc);
    if (ft) {
      const m = ft.text.match(
        /information about (our|the) executive officers|executive officers of (the registrant|the company|our company|our)|our executive officers|item\s*10[.\s—-]{0,4}[^\n]{0,50}executive officers/i,
      );
      if (m && m.index != null) text += "\n\n=== 10-K: EXECUTIVE OFFICERS ===\n" + ft.text.slice(m.index, m.index + 14000);
    }
  }
  return text.length > 2000 ? { proxy, text } : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();

  const profile = await getCompanyProfile(sym).catch(() => null);
  const roster = (profile?.officers ?? []).map((o) => o.name).filter((n): n is string => !!n);
  const base = (extra: Partial<ExecBiosResponse>): ExecBiosResponse => ({ symbol: sym, proxy: null, bios: {}, ...extra });
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!roster.length) return NextResponse.json(base({ note: "No executive roster available." }), noStore);
  if (!(await llmConfigured())) return NextResponse.json(base({ note: "Bios need the LLM configured." }), noStore);

  const src = await gatherSources(sym);
  if (!src) return NextResponse.json(base({ note: "No recent proxy / 10-K with bios found." }), noStore);

  const schema =
    'Return ONLY JSON: {"bios":[{"name": string, "found": boolean, "since": number|null, "priorRoles": string[], "education": string[], "otherBoards": string[], "summary": string|null}]}';
  const prompt = `ROSTER (find a bio for each; echo the name):\n${roster.map((n) => `- ${n}`).join("\n")}\n\n${schema}\n\nFILING TEXT:\n${src.text}`;

  const out = await chatJSON<{ bios: any[] }>(SYSTEM, prompt, { model: FLASH_MODEL, maxTokens: 2800, reasoningEffort: "low" }).catch(() => null);

  const yr = new Date().getUTCFullYear();
  const textLower = src.text.toLowerCase();
  const bios: Record<string, ExecBio> = {};
  for (const b of out?.bios ?? []) {
    if (!b?.name || !b.found) continue;
    const key = matchRoster(String(b.name), roster);
    if (!key || bios[key]) continue; // must map to a UNIQUE roster person; first match wins
    const kp = parts(key);
    const wins = bioWindows(textLower, kp[kp.length - 1] || ""); // windows around THIS person's surname
    const arr = (v: any, cap: number, requireNoun = false): string[] =>
      (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : []).filter((x) => groundedNear(x, textLower, wins, requireNoun)).slice(0, cap);
    // A tenure year is only kept if it actually appears in the person's bio window (else it's a guess).
    const since = typeof b.since === "number" && b.since > 1900 && b.since <= yr && inWindows(String(b.since), textLower, wins) ? b.since : null;
    const summary = typeof b.summary === "string" && b.summary.trim() && groundedNear(b.summary, textLower, wins) ? b.summary.trim() : null;
    bios[key] = {
      found: true,
      since,
      priorRoles: arr(b.priorRoles, 8), // a bare title is allowed
      education: arr(b.education, 4, true), // must name a school
      otherBoards: arr(b.otherBoards, 6, true), // must name a company / institution
      summary,
    };
  }

  const anyFound = Object.keys(bios).length > 0;
  return NextResponse.json(
    base({ proxy: src.proxy, bios, note: anyFound ? undefined : "The filings didn't yield bios for these names." }),
    // Officers change slowly + filings are annual → cache hard on success; never cache an empty/failed read.
    { headers: { "Cache-Control": anyFound ? "public, s-maxage=43200, stale-while-revalidate=604800" : "no-store" } },
  );
}
