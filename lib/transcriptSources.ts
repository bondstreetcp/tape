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

const execFileP = promisify(execFile);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
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
export type TranscriptSource = "investing" | "fool";
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

/**
 * The one call the digest job makes per reporter: the freshest full transcript dated within [since, today] —
 * Investing.com when reachable, else The Motley Fool's per-ticker listing. null = nothing posted yet (or blocked
 * everywhere) — the caller retries next tick.
 */
export async function findRecentTranscript(symbol: string, name: string, w: { since: string; today: string }): Promise<FoundTranscript | null> {
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
