/**
 * Transcript SOURCES for the earnings-call digests — where a full transcript of a recent call can actually be
 * read from, in order of freshness, and the one finder the job calls.
 *
 * WHY THIS EXISTS (2026-09-04): The Motley Fool, the app's only transcript source (lib/transcripts), stopped
 * covering most large caps after June 2026 — its hub lists ~20 transcripts over four days, mostly small caps,
 * posted about a week after the call. Investing.com publishes full transcripts the same day ("Earnings call
 * transcript: …" — ~100 across its first four listing pages, including the week's big reporters) but blocks
 * some IPs outright: a 3-byte 403 for the NAS's home IP and for GitHub runners, a clean 200 from an office
 * PC. Alpha Vantage's EARNINGS_CALL_TRANSCRIPT works from anywhere but lags days-to-weeks and is patchy.
 *
 * So the finder tries Investing.com first (probed once per process; skipped when blocked), then Fool's
 * per-ticker listing. A run on a blocked box reports that it was blocked instead of pretending nothing was
 * posted, and the job can PUBLISH its output to R2 so a clean-IP box's run reaches the NAS and the site.
 *
 * Pure parsers are exported for tests; network lives in the async functions only.
 */
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deadline } from "./deadline";
import { listTranscriptCandidates, fetchTranscriptAt, type FullTranscript } from "./transcripts";
import { BROWSER_UA as UA } from "./scriptKit";
import type { Browser } from "playwright-core"; // type-only (erased) — the runtime import is lazy, see sharedBrowser()

const execFileP = promisify(execFile);
const LISTING = "https://www.investing.com/news/transcripts";
const HEADERS = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" };

/**
 * Investing.com's CDN judges the TLS handshake, not just the IP: from the same office PC, `curl` gets the page
 * and Node's fetch (undici) gets a 3-byte 403 in every header shape. So this source reads through the system
 * curl when one is present (Windows 10+, macOS, the NAS and Linux all ship it) and only then falls back to
 * fetch. A blocked IP is blocked either way — the NAS and GitHub runners fail both — which is what the
 * "blocked" reporting in the digest job is for. Returns null for anything but a real page (a 403 is a stub).
 */
async function getHtml(url: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("curl", ["-sS", "-L", "-m", "25", "--compressed", "-A", UA, "-H", `Accept: ${HEADERS.Accept}`, "-H", `Accept-Language: ${HEADERS["Accept-Language"]}`, url], { maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: "utf8" });
    if (stdout && stdout.length > 10_000) return stdout;
  } catch { /* no curl, or a transport failure — try fetch */ }
  try {
    const res = await fetch(url, { headers: HEADERS, signal: deadline(20_000) });
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 10_000 ? html : null;
  } catch { return null; }
}

export interface InvestingItem { url: string; title: string; date: string | null; slug: string }
export type TranscriptSource = "google" | "investing" | "fool";
export interface FoundTranscript { transcript: FullTranscript; source: TranscriptSource; date: string }

const SUFFIX = new Set(["inc", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "holdings", "holding", "group", "the", "nv", "sa", "ag", "se", "llc", "lp", "trust", "class", "cl", "a", "b", "c", "adr", "ads", "ord", "shs", "common", "stock", "shares", "and", "of", "companies"]);

/** "Five Below, Inc." → ["five","below"]; "The Campbell's Company" → ["campbells"]; "American Eagle Outfitters" → ["american","eagle","outfitters"]. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !SUFFIX.has(w));
}

/** First name-words too generic to identify a company on their own (the slug's next token must confirm). */
const GENERIC_FIRST = new Set(["american", "first", "united", "general", "national", "global", "international", "new", "north", "south", "east", "west", "great", "standard", "royal", "pacific", "atlantic", "central", "western", "eastern", "northern", "southern", "china", "canada", "texas", "california", "florida", "boston", "york", "carolina", "alpha", "omega", "liberty", "freedom", "enterprise", "capital", "financial", "energy", "health", "medical", "digital", "data", "tech", "technology", "systems", "solutions", "services", "industries", "partners", "brands", "foods", "motors", "airlines", "bank", "trust", "black", "white", "blue", "green", "silver", "golden", "universal", "premier", "advanced", "applied", "consolidated", "continental", "federal", "independent", "integrated", "modern", "national", "prime", "pure", "smart", "super", "total", "world"]);

/**
 * Does an Investing.com article slug refer to this company? Articles use the SHORT name ("credo-beats-q1…",
 * "lululemon-q2…"), so: the first significant name word must be a slug token; then either the next token is
 * the name's second word ("five-below", "hewlett-packard"), the name has one word, or the first word is
 * distinctive on its own (≥5 letters and not generic) — "credo", "lululemon" pass; "american-outdoor" does
 * not match American Eagle and "five-star-…" never matches Five Below. The article text is verified after.
 */
export function investingSlugMatches(slug: string, name: string, symbol = ""): boolean {
  const toks = slug.toLowerCase().split("-");
  // Some articles use the ticker as the name ("hpe-…", "aeo-…"): an exact token match for a ticker of 3+
  // letters that isn't an English word (the article-text check catches the rest).
  const sym = symbol.toLowerCase();
  if (sym.length >= 3 && !TICKER_WORDS.has(sym) && toks.includes(sym)) return true;
  const words = nameWords(name);
  if (!words.length) return false;
  const i = toks.indexOf(words[0]);
  if (i < 0) return false;
  if (words.length === 1 || toks[i + 1] === words[1]) return true;
  return words[0].length >= 5 && !GENERIC_FIRST.has(words[0]);
}
/** Tickers that are also ordinary slug words — never matched by the ticker-token rule. */
const TICKER_WORDS = new Set(["all", "and", "for", "the", "new", "now", "one", "two", "out", "top", "big", "low", "key", "net", "ceo", "cfo", "ipo", "are", "but", "can", "has", "its", "may", "off", "own", "per", "see", "set", "six", "ten", "way", "win", "yet", "add", "any", "ask", "bid", "buy", "cap", "cut", "dip", "eye", "fed", "fix", "gap", "hit", "job", "lag", "led", "lot", "mid", "mix", "pay", "run", "tax", "war", "well", "good", "best", "beat", "beats", "tops", "miss", "misses", "call", "post", "rise", "fall", "jump", "sink", "gain", "loss", "plan", "real", "fast", "life", "live", "love", "main", "open", "play", "rate", "sale", "save", "shop", "sign", "snap", "star", "true", "unit", "view", "wave", "work", "year"]);

/** The listing page's transcript articles, newest first as the page orders them. Pure. */
export function parseInvestingListing(html: string): InvestingItem[] {
  const $ = cheerio.load(html);
  const out: InvestingItem[] = [];
  const seen = new Set<string>();
  $('article[data-test="article-item"]').each((_, el) => {
    const a = $(el).find('a[data-test="article-title-link"]').first();
    const url = (a.attr("href") || "").trim();
    if (!/\/news\/transcripts\/earnings-call-transcript-/.test(url) || seen.has(url)) return;
    seen.add(url);
    const dt = ($(el).find('time[data-test="article-publish-date"]').first().attr("datetime") || $(el).find('time[data-test="article-publish-date"]').first().attr("dateTime") || "").trim();
    const date = /^\d{4}-\d{2}-\d{2}/.test(dt) ? dt.slice(0, 10) : null;
    out.push({ url, title: a.text().replace(/\s+/g, " ").trim(), date, slug: url.split("/").filter(Boolean).pop() || "" });
  });
  return out;
}

const NOISE = /^(Risk Disclosure|Position added successfully|Get the full|Full transcript -|This article was generated|Third party|Fusion Media|Sign in|Create a free|Related Articles|Latest Comments|Please wait|Are you sure|Delete|Report)/i;
const TAIL = /^(Risk Disclosure|This article was generated with the support of AI|Full transcript - )/i;

/**
 * The transcript text of an article page, or null when the page doesn't verify as THIS company (a slug match
 * is not proof — the ticker must appear as a word at least twice, or the name's first word at least three times).
 * Pure.
 */
export function parseInvestingArticle(html: string, symbol: string, name: string): { title: string; text: string } | null {
  const $ = cheerio.load(html);
  const paras: string[] = [];
  $("#article p").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (!t || NOISE.test(t)) return;
    paras.push(t);
  });
  // Cut at the trailing boilerplate (the page repeats it after the transcript proper).
  const cut = paras.findIndex((p, i) => i > 5 && TAIL.test(p));
  const body = (cut > 0 ? paras.slice(0, cut) : paras).join("\n\n");
  if (body.length < 3000) return null;
  const sym = symbol.toUpperCase();
  const tickerHits = (body.match(new RegExp(`\\b${sym.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}\\b`, "g")) || []).length;
  const first = nameWords(name)[0];
  // Apostrophes are dropped on both sides so "Campbell's" counts for "campbells".
  const nameHits = first ? (body.toLowerCase().replace(/['’]/g, "").match(new RegExp(`\\b${first}\\b`, "g")) || []).length : 0;
  if (tickerHits < 2 && nameHits < 3) return null;
  const title = ($('meta[property="og:title"]').attr("content") || $("h1").first().text() || "").replace(/\s*[|-]\s*Investing\.com.*$/i, "").replace(/\s+/g, " ").trim();
  return { title: title || `${sym} earnings call transcript`, text: body };
}

// ── network (memoized per process — the listing is one page for the whole run) ──────────────────────
const pageCache = new Map<number, Promise<string | null>>();
async function listingPage(page: number): Promise<string | null> {
  if (!pageCache.has(page)) pageCache.set(page, getHtml(page > 1 ? `${LISTING}/${page}` : LISTING)); // a real page is ~1 MB; the block is a 3-byte 403
  return pageCache.get(page)!;
}

/** Can this box read Investing.com at all? One probe per process. */
export async function investingReachable(): Promise<boolean> {
  return (await listingPage(1)) != null;
}

/** Transcript articles across the first `pages` listing pages (newest first), deduped. */
export async function listInvestingTranscripts(pages = 3): Promise<InvestingItem[]> {
  const out: InvestingItem[] = [];
  const seen = new Set<string>();
  for (let p = 1; p <= pages; p++) {
    const html = await listingPage(p);
    if (!html) break;
    for (const it of parseInvestingListing(html)) if (!seen.has(it.url)) { seen.add(it.url); out.push(it); }
  }
  return out;
}

export async function fetchInvestingTranscript(item: InvestingItem, symbol: string, name: string): Promise<FullTranscript | null> {
  const html = await getHtml(item.url);
  if (!html) return null;
  const parsed = parseInvestingArticle(html, symbol, name);
  if (!parsed) return null;
  return { title: parsed.title || item.title, date: item.date, source: "Investing.com", url: item.url, text: parsed.text };
}

// ── Google Finance (Quartr-sourced) — the freshest source the NAS's OWN IP can reach (Investing.com + GitHub
// are IP-blocked; Google is not). The transcript renders client-side via an obfuscated batchexecute RPC, so a
// static fetch can't read it — a headless Chromium renders the earnings tab and we scrape the DOM. Google carries
// ONLY the latest call per company (no back-catalogue) — exactly what the per-tick digest wants. playwright-core
// never downloads a browser on install; if Chromium is absent the launch throws and this source disables itself
// (→ falls back to Investing.com/Fool), so shipping this is safe before the NAS is provisioned. Provision with
// `npx playwright install chromium` (or apt chromium + a channel). ─────────────────────────────────────────

// yahoo-finance2 quote().exchange (short code) → the Google Finance URL exchange segment. Pure.
const GOOGLE_EXCH: Record<string, string> = {
  NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ", NGS: "NASDAQ", NASDAQ: "NASDAQ",
  NYQ: "NYSE", NYS: "NYSE", NYSE: "NYSE", ASE: "NYSEAMERICAN", AMEX: "NYSEAMERICAN",
  PCX: "NYSEARCA", ARCA: "NYSEARCA", BTS: "BATS", BATS: "BATS",
};
export function googleExchange(yahooExch: string | null | undefined): string | null {
  return yahooExch ? GOOGLE_EXCH[yahooExch.toUpperCase()] ?? null : null;
}

const GF_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Resolve Google's earnings-header date → YYYY-MM-DD. `callTime` ("Wed, Sep 2, 5:00 PM", year-less) is the CURRENT
 *  call when the page awaits the next print; else `repDate` ("Aug 27, 2026") is the latest report. Prefer callTime
 *  and pin its year to the most-recent PAST occurrence (a fiscal-period year ≠ calendar year). Pure. */
export function parseGoogleCallDate(callTime: string | null, repDate: string | null, todayISO: string): string | null {
  if (callTime) {
    const m = callTime.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2})/);
    const mo = m ? GF_MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (m && mo >= 0) {
      const day = Number(m[2]);
      const today = new Date(`${todayISO}T00:00:00Z`);
      let y = today.getUTCFullYear();
      if (Date.UTC(y, mo, day) > today.getTime() + 86_400_000) y -= 1; // a future month/day → last year's occurrence
      return `${y}-${String(mo + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  if (repDate) {
    const m = repDate.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})/);
    const mo = m ? GF_MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (m && mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
  }
  return null;
}

/** The transcript body from the earnings tab's `main` innerText — "Call transcript" heading to the next section
 *  (the AI "Highlights" blurb then the speaker-labelled call). Pure. '' when absent. */
export function extractGoogleTranscript(mainText: string): string {
  const start = mainText.indexOf("Call transcript");
  if (start < 0) return "";
  let end = mainText.indexOf("Related earnings", start);
  if (end < 0) end = mainText.indexOf("Previous reports", start);
  if (end < 0) end = mainText.length;
  return mainText.slice(start, end)
    .replace(/^Call transcript\s*/i, "")
    .replace(/^(?:(?:expand_less|expand_more|summarize_auto|expand_all)\s*)+/i, "") // strip leading material-icon chrome
    .trim();
}

/** Is the rendered text a REAL transcript for THIS company (not a placeholder / wrong page)? Pure. */
export function googleTranscriptValid(text: string, symbol: string, name: string): boolean {
  if (text.length < 3000) return false;
  const sym = symbol.toUpperCase();
  const tickerHits = (text.match(new RegExp(`\\b${sym.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}\\b`, "g")) || []).length;
  const first = nameWords(name)[0];
  const nameHits = first ? (text.toLowerCase().replace(/['’]/g, "").match(new RegExp(`\\b${first}\\b`, "g")) || []).length : 0;
  const hasSpeakers = /operator|prepared remarks|earnings call|conference call|analyst/i.test(text);
  return (tickerHits >= 1 || nameHits >= 2) && hasSpeakers;
}

let _browser: Promise<Browser | null> | null = null;
async function sharedBrowser(): Promise<Browser | null> {
  if (!_browser) _browser = (async () => {
    try { const { chromium } = await import("playwright-core"); return await chromium.launch({ headless: true }); }
    catch (e) { console.warn(`google-transcripts: headless Chromium unavailable (${String((e as Error)?.message || e).slice(0, 80)}) — source disabled`); return null; }
  })();
  return _browser;
}
/** Close the shared headless browser so the process can exit — the digest job calls this in its finally. */
export async function closeGoogleBrowser(): Promise<void> {
  const p = _browser; _browser = null;
  const b = p ? await p.catch(() => null) : null;
  if (b) await b.close().catch(() => {});
}

/** Render one earnings tab → {title, mainText}, or null (bad exchange / missing / Chromium down). */
async function renderGoogleEarnings(symbol: string, exchange: string): Promise<{ title: string; mainText: string } | null> {
  const browser = await sharedBrowser();
  if (!browser) return null;
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
  try {
    await ctx.addCookies([{ name: "SOCS", value: "CAI", domain: ".google.com", path: "/" }]); // pre-accept consent, no personalization
    const page = await ctx.newPage();
    await page.goto(`https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:${exchange}?tab=earnings`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (/consent\.google\.com/.test(page.url())) return null;
    await page.getByText("Call transcript", { exact: false }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.getByText("Call transcript", { exact: false }).first().click({ timeout: 4_000 }).catch(() => {}); // expand (CSS toggle)
    await page.waitForTimeout(1_200);
    return await page.evaluate(() => ({ title: document.title || "", mainText: (document.querySelector("main") as HTMLElement)?.innerText || "" }));
  } catch { return null; }
  finally { await ctx.close().catch(() => {}); }
}

/** Google Finance's latest transcript for a reporter, dated within [since, today] — else null. Resolves the exact
 *  exchange via Yahoo (a bare/wrong ticker 404s on Google), falling back to the two big US boards. */
export async function findGoogleTranscript(symbol: string, name: string, w: { since: string; today: string }): Promise<FoundTranscript | null> {
  let exchanges: string[] = ["NASDAQ", "NYSE"];
  try {
    const mod = await import("yahoo-finance2");
    // dynamic-import boundary: this build's default export is a constructor with a .quote() — type just what we read
    const YF = mod.default as unknown as { new (opts?: { suppressNotices?: string[] }): { quote(s: string): Promise<{ exchange?: string }> } };
    const q = await new YF({ suppressNotices: ["yahooSurvey"] }).quote(symbol);
    const g = googleExchange(q?.exchange);
    if (g) exchanges = [g];
  } catch { /* Yahoo down — try both boards */ }
  for (const exch of exchanges) {
    const rendered = await renderGoogleEarnings(symbol, exch);
    if (!rendered) continue;
    const text = extractGoogleTranscript(rendered.mainText);
    if (!googleTranscriptValid(text, symbol, name)) continue;
    const callTime = (rendered.mainText.match(/Call Time:\s*([^\n]+)/) || [])[1]?.trim() || null;
    const ri = rendered.mainText.indexOf("Previous reports");
    const repDate = ri >= 0 ? (rendered.mainText.slice(ri, ri + 900).match(/[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/) || [])[0] || null : null;
    const date = parseGoogleCallDate(callTime, repDate, w.today);
    if (!date || date < w.since || date > w.today) continue; // Google's latest isn't the recent call → skip
    const coName = (rendered.title.match(/^(.*?)\s*\(/) || [])[1]?.trim() || name;
    const url = `https://www.google.com/finance/quote/${symbol}:${exch}?tab=earnings`;
    return { transcript: { title: `${coName} earnings call transcript`, date, source: "Google Finance", url, text }, source: "google", date };
  }
  return null;
}

/**
 * The one call the digest job makes per reporter: the freshest full transcript dated within [since, today].
 * Google Finance FIRST (the only same-day source the NAS's own IP can reach) → Investing.com (clean-IP only) →
 * The Motley Fool's per-ticker listing. null = nothing posted yet (or unreachable everywhere) — retry next tick.
 */
export async function findRecentTranscript(symbol: string, name: string, w: { since: string; today: string }): Promise<FoundTranscript | null> {
  const g = await findGoogleTranscript(symbol, name, w).catch(() => null);
  if (g) return g;
  if (await investingReachable()) {
    const items = await listInvestingTranscripts(6); // ~35 articles a page; six pages cover the lookback in season
    const hit = items.find((it) => it.date && it.date >= w.since && it.date <= w.today && investingSlugMatches(it.slug, name, symbol));
    if (hit) {
      const t = await fetchInvestingTranscript(hit, symbol, name);
      if (t) return { transcript: t, source: "investing", date: hit.date! };
    }
  }
  const list = await listTranscriptCandidates(symbol, name).catch(() => [] as { url: string; date: string }[]);
  const f = list.find((t) => t.date && t.date >= w.since && t.date <= w.today);
  if (f) {
    const t = await fetchTranscriptAt(symbol, f).catch(() => null);
    if (t) return { transcript: t, source: "fool", date: f.date };
  }
  return null;
}
