/**
 * Builds data/campaigns.json — the activism & short-campaign board.
 *
 * 1. SEC EDGAR full-text search (efts.sec.gov) for recent SCHEDULE 13D (activist stakes) + DEFC14A /
 *    PREC14A / DFAN14A (proxy fights). 2. Short-seller reports from 13 firms — 8 RSS feeds + 2 HTML
 *    pages (Spruce Point, Viceroy) + 3 X timelines via nitter.net RSS (Culper/NINGI/Iceberg, whose
 *    sites are Cloudflare-walled; x.com itself is login-walled — probed 2026-07-01). 3. GLM reads
 *    each and extracts {ticker, company, campaigner, type, the ASK/allegation} and drops routine /
 *    non-campaign / long-idea items. 4. Price the stock since the event.
 *
 * Forward-accumulating; only new items hit the LLM. Run: npm run refresh-campaigns. Nightly (FULL).
 * A public-disclosure tracker, not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import type { Campaign, CampaignType, CampPerf, CampaignsData } from "../lib/campaigns";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "campaigns.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const DAY = 86_400_000;
const KEEP = 200;
const WINDOW_DAYS = 21;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FORMS: { form: string; type: CampaignType }[] = [
  { form: "SCHEDULE 13D", type: "activist" },
  { form: "DEFC14A", type: "proxy-fight" },
  { form: "PREC14A", type: "proxy-fight" },
  { form: "DFAN14A", type: "proxy-fight" },
];

interface Raw { id: string; date: string; type: CampaignType; form: string; issuer: string; ticker: string | null; other: string; url: string; docUrl: string; ciks: string[]; doc: string }

function htmlToText(html: string): string {
  return (html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// From a display_name like "Newegg Commerce, Inc.  (NEGG)  (CIK 0001474627)" pull the ticker + clean name.
function parseName(dn: string): { name: string; ticker: string | null } {
  const parens = [...dn.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  let ticker: string | null = null;
  for (const p of parens) {
    if (/^CIK/i.test(p)) continue;
    const first = p.split(",")[0].trim();
    if (/^[A-Z][A-Z0-9.\-]{0,5}$/.test(first)) { ticker = first; break; }
  }
  const name = dn.replace(/\s*\([^)]*\)/g, "").trim();
  return { name, ticker };
}

async function eftsFetch(form: string, startdt: string, enddt: string): Promise<any[]> {
  const u = `https://efts.sec.gov/LATEST/search-index?forms=${encodeURIComponent(form)}&startdt=${startdt}&enddt=${enddt}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(u, { headers: { "User-Agent": UA } }).catch(() => null);
    if (res?.ok) { const j = await res.json(); return j?.hits?.hits || []; }
    await sleep(600 + attempt * 800); // EFTS throttles bursts (429/403) — back off and retry
  }
  console.log(`  EFTS ${form}: failed after retries`);
  return [];
}
async function fetchFilingText(r: Raw): Promise<string> {
  // _id = accession:doc ; the doc lives under one of the filing's CIKs — try each.
  const accNo = r.id.replace(/-/g, "");
  for (const cik of r.ciks) {
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}/${r.doc}`;
    try { const res = await fetch(url, { headers: { "User-Agent": UA } }); if (res.ok) return htmlToText(await res.text()); } catch { /* try next */ }
    await sleep(120);
  }
  return "";
}

// ── Short-seller report sources ─────────────────────────────────────────────────────────────────
// The firms' OWN sites are the primary route — X/x.com is login-walled and both twitter-syndication
// endpoints are dead (probed 2026-07-01: 429 / empty body / JS shell). nitter.net RSS mirrors the X
// timelines and is the only route for the three Cloudflare-403 firms (Culper, NINGI, Iceberg) —
// best-effort by nature (other nitter instances are already challenge-walled). Kerrisdale and Bear
// Cave publish longs/roundups too — classify() drops anything that isn't a genuine short campaign.
const SHORT_RSS: { firm: string; url: string; nitter?: boolean }[] = [
  { firm: "Muddy Waters", url: "https://muddywatersresearch.com/feed/?post_type=reports" },
  { firm: "Kerrisdale Capital", url: "https://www.kerrisdalecap.com/feed/?post_type=investments" },
  { firm: "Grizzly Research", url: "https://grizzlyreports.com/feed/" },
  { firm: "Fuzzy Panda", url: "https://fuzzypandaresearch.com/feed/" },
  { firm: "Blue Orca Capital", url: "https://www.blueorcacapital.com/feed/" },
  { firm: "The Bear Cave", url: "https://thebearcave.substack.com/feed" },
  { firm: "Hunterbrook", url: "https://hntrbrk.com/feed" },
  { firm: "Gotham City Research", url: "https://www.gothamcityresearch.com/blog-feed.xml" },
  { firm: "Culper Research", url: "https://nitter.net/CulperResearch/rss", nitter: true },
  { firm: "NINGI Research", url: "https://nitter.net/NingiResearch/rss", nitter: true },
  { firm: "Iceberg Research", url: "https://nitter.net/IcebergResear/rss", nitter: true },
];
const SHORT_SEED_DAYS = 120; // feeds carry history; only seed items this recent
// Firm sites / nitter want a BROWSER UA (Cloudflare et al. reject research UAs) — EDGAR keeps the
// SEC-style UA above, per its fair-access policy.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function rssShorts(firm: string, url: string, nitter = false): Promise<Raw[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    const cd = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    const out: Raw[] = [];
    for (const it of xml.split("<item>").slice(1)) {
      const g = (t: string) => { const m = it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? cd(m[1]) : ""; };
      const title = htmlToText(g("title"));
      let link = g("link");
      const date = g("pubDate");
      const dT = Date.parse(date); // one malformed pubDate must not throw and kill the whole firm's feed
      if (!title || !link || !Number.isFinite(dT)) continue;
      if (nitter) {
        if (/^(RT by|R to) /.test(title)) continue; // retweets/replies — not the firm's own report
        link = link.replace(/^https?:\/\/nitter\.[^/]+/, "https://x.com").replace(/#m$/, ""); // store the real X link
      }
      const body = htmlToText(g("content:encoded") || g("description"));
      out.push({ id: link, date: new Date(dT).toISOString(), type: "short", form: nitter ? "X post" : "short report", issuer: title.slice(0, 200), ticker: null, other: firm, url: link, docUrl: link, ciks: [], doc: (title + "\n\n" + body).slice(0, 6000) });
    }
    return out;
  } catch { return []; }
}

// Spruce Point publishes on a Webflow /research/ page (no RSS) — server-rendered HTML.
async function sprucePoint(): Promise<Raw[]> {
  try {
    const res = await fetch("https://www.sprucepointcap.com/research/", { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) return [];
    const html = await res.text();
    const out: Raw[] = [];
    // Card shape: <div class="research-date">Apr 24, 2026</div><a href="/research/slug" ...><h3 class="research-h3">Title</h3></a>
    for (const m of html.matchAll(/research-date"[^>]*>([^<]+)<\/div>\s*<a[^>]+href="(\/research\/[^"]+)"[^>]*>\s*<h3[^>]*research-h3[^>]*>([^<]+)</g)) {
      const [, date, href, title] = m;
      if (Number.isNaN(Date.parse(date))) continue;
      const link = `https://www.sprucepointcap.com${href}`;
      out.push({ id: link, date: new Date(date).toISOString(), type: "short", form: "short report", issuer: htmlToText(title).slice(0, 200), ticker: null, other: "Spruce Point", url: link, docUrl: link, ciks: [], doc: htmlToText(title).slice(0, 6000) });
    }
    return out;
  } catch { return []; }
}

// Viceroy's /publications page (they left WordPress — /feed/ is a 404) — anchors + <time> pairs.
async function viceroy(): Promise<Raw[]> {
  try {
    const res = await fetch("https://viceroyresearch.org/publications", { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) return [];
    const html = await res.text();
    const out: Raw[] = [];
    // Card shape: <a wire:navigate href="https://viceroyresearch.org/publications/slug" ...> … <h2 …>Title</h2> … (a date somewhere in the card)
    for (const block of html.split(/<a [^>]*href="(?=https?:\/\/viceroyresearch\.org\/publications\/)/).slice(1)) {
      const href = block.match(/^([^"]+)"/)?.[1];
      const title = htmlToText(block.match(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/)?.[1] || "");
      const head = block.slice(0, 2500);
      let time = head.match(/<time[^>]*>([^<]+)<\/time>/)?.[1] || head.match(/datetime="([^"]+)"/)?.[1] || head.match(/\b([A-Z][a-z]{2,8} \d{1,2}, \d{4})\b/)?.[1] || "";
      if (!time) {
        // Viceroy's cards print year-less dates ("Jun 30") — assume the current year, and if that
        // lands in the future (a December item read in January), roll back a year.
        const m = head.match(/\b([A-Z][a-z]{2,8} \d{1,2})\b/);
        if (m) {
          const d = new Date(`${m[1]}, ${new Date().getFullYear()}`);
          if (!Number.isNaN(d.getTime())) time = (d.getTime() > Date.now() + 30 * DAY ? new Date(d.getTime() - 365 * DAY) : d).toISOString();
        }
      }
      if (!href || !title || title.length < 8 || Number.isNaN(Date.parse(time))) continue;
      out.push({ id: href, date: new Date(time).toISOString(), type: "short", form: "short report", issuer: title.slice(0, 200), ticker: null, other: "Viceroy Research", url: href, docUrl: href, ciks: [], doc: title.slice(0, 6000) });
    }
    return out;
  } catch { return []; }
}

async function shortReports(): Promise<Raw[]> {
  const lists = await mapPool(SHORT_RSS, 4, (s) => rssShorts(s.firm, s.url, s.nitter));
  const html = await Promise.all([sprucePoint(), viceroy()]);
  const all = [...lists.flat().filter(Boolean), ...html.flat()];
  const cutoff = Date.now() - SHORT_SEED_DAYS * DAY;
  const kept = all.filter((r) => Date.parse(r.date) >= cutoff);
  const byFirm: Record<string, number> = {};
  for (const r of kept) byFirm[r.other] = (byFirm[r.other] || 0) + 1;
  console.log(`short sources: ${kept.length} items ${JSON.stringify(byFirm)}`);
  return kept;
}

async function classify(r: Raw, text: string): Promise<{ ticker: string | null; company: string; campaigner: string; ask: string; summary: string; material: boolean } | null> {
  const SYSTEM =
    "You read one SEC activist/proxy filing or one short-seller report and summarize the CAMPAIGN for a professional investor. Extract: the TARGET public company + its ticker; the CAMPAIGNER (the activist/dissident investor, or the short firm); a one-line ASK (what the activist wants — board seats, sale, breakup, strategy change) or ALLEGATION (what the short alleges — fraud, accounting, overvaluation); and a 1-2 sentence summary. " +
    "Set material=false and it will be DROPPED if this is NOT a genuine campaign: a passive/routine 13D with no stated activist intent, a company's own routine proxy mailing, an administrative amendment with no new demand, or anything without a clear target company. Be strict. " +
    (r.type === "short"
      ? "This item comes from a short-seller's site or X feed, and some publish MORE than short reports: set material=false for LONG/positive theses, portfolio or performance updates, newsletter roundups/compilations covering many names, media appearances, replies or general commentary. material=true ONLY for a new NEGATIVE report/allegation targeting ONE specific public company (a $CASHTAG in a tweet announcing a new short counts). "
      : "") +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"ticker":string|null,"company":string,"campaigner":string,"ask":string,"summary":string,"material":boolean}';
  const ctx = `Form: ${r.form}. Type: ${r.type}. Subject as filed: ${r.issuer}${r.ticker ? ` (${r.ticker})` : ""}. Other party: ${r.other}.\n\n${text.slice(0, 6500)}`;
  const out = await chatJSON<any>(SYSTEM, ctx + "\n\n" + SCHEMA, { maxTokens: 700 });
  if (!out || out.material === false) return null;
  const ticker = out.ticker ? String(out.ticker).toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 6) : r.ticker;
  return { ticker: ticker || r.ticker, company: String(out.company || r.issuer).slice(0, 80), campaigner: String(out.campaigner || r.other).slice(0, 80), ask: String(out.ask || "").slice(0, 220), summary: String(out.summary || "").slice(0, 400), material: true };
}


// A ticker the LLM emitted (vs one EDGAR supplied) must actually price on Yahoo before it is
// stored — else a wrong-but-real symbol shows another company's move as this event's performance.
async function validTicker(sym: string): Promise<boolean> {
  try { const ch: any = await yf.chart(sym, { period1: new Date(Date.now() - 20 * DAY), interval: "1d" } as any, { validateResult: false }); return (ch?.quotes || []).some((q: any) => q?.close != null); } catch { return false; }
}
async function perfFor(ticker: string, eventISO: string): Promise<CampPerf | null> {
  try {
    const eT = Date.parse(eventISO);
    const ch: any = await yf.chart(ticker, { period1: new Date(eT - 8 * DAY), interval: "1d" } as any, { validateResult: false });
    const q = (ch?.quotes || []).filter((x: any) => x?.close != null).map((x: any) => ({ t: new Date(x.date).getTime(), c: x.close as number }));
    if (!q.length) return null;
    const at = (q.find((p: any) => p.t >= eT) || q[0]).c;
    const now = q[q.length - 1].c;
    return { priceAtEvent: at, priceNow: now, sincePct: at && now ? +(((now / at) - 1) * 100).toFixed(2) : null };
  } catch { return null; }
}

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { out[i] = null as any; } }
  }));
  return out;
}

async function main() {
  const nowISO = new Date().toISOString();
  if (!(await llmConfigured())) { console.log("LLM not configured — skipping."); return; }
  const enddt = nowISO.slice(0, 10);
  const startdt = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);

  // ── gather raw items ──
  const raw: Raw[] = [];
  for (const { form, type } of FORMS) {
    const hits = await eftsFetch(form, startdt, enddt).catch(() => []);
    for (const h of hits) {
      const src = h._source || {}; const dns: string[] = src.display_names || [];
      const parsed = dns.map(parseName);
      const issuerIdx = parsed.findIndex((p) => p.ticker); // the public company (has a ticker)
      const iss = parsed[issuerIdx >= 0 ? issuerIdx : 0] || { name: dns[0] || "?", ticker: null };
      const other = parsed.filter((_, i) => i !== (issuerIdx >= 0 ? issuerIdx : 0)).map((p) => p.name).join(", ") || dns[1] || "";
      const [acc, doc] = String(h._id || "").split(":");
      if (!acc || !doc) continue;
      raw.push({ id: acc, date: (src.file_date || "") + "T12:00:00Z", type, form, issuer: iss.name, ticker: iss.ticker, other, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.ciks?.[0]}&type=${encodeURIComponent(form)}`, docUrl: "", ciks: src.ciks || [], doc });
    }
    await sleep(300);
  }
  const mw = await shortReports();
  console.log(`fetched ${raw.length} SEC filings + ${mw.length} short reports`);

  // dedup by id, newest first, cap
  const seenRaw = new Set<string>();
  const allRaw = [...mw, ...raw].filter((r) => (seenRaw.has(r.id) ? false : (seenRaw.add(r.id), true))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const prior: CampaignsData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, campaigns: [] as Campaign[] }));
  const known = new Set(prior.campaigns.map((c) => c.id));
  // Per-bucket LLM caps so the short-report seed (13 sources × history) can't starve the EDGAR
  // activist/proxy stream in one run — same pattern as refresh-ipo/corp-events. Overflow is picked
  // up next run (forward-accumulating).
  const capBy: Record<string, number> = {};
  const fresh = allRaw.filter((r) => !known.has(r.id)).filter((r) => {
    const k = r.type === "short" ? "short" : "sec";
    const n = capBy[k] || 0;
    if (n >= 40) return false;
    capBy[k] = n + 1;
    return true;
  });
  console.log(`${fresh.length} new to classify ${JSON.stringify(capBy)}`);

  const built = await mapPool(fresh, 4, async (r): Promise<Campaign | null> => {
    const text = r.type === "short" ? r.doc : await fetchFilingText(r);
    const c = await classify(r, text);
    if (c && c.ticker && c.ticker !== r.ticker && !(await validTicker(c.ticker))) c.ticker = r.ticker; // reject LLM-invented symbols
    if (!c) return null;
    return { id: r.id, date: r.date, type: r.type, ticker: c.ticker, company: c.company, campaigner: c.campaigner, form: r.form, ask: c.ask, summary: c.summary, url: r.type === "short" ? r.url : (r.ciks[0] ? `https://www.sec.gov/Archives/edgar/data/${Number(r.ciks[0])}/${r.id.replace(/-/g, "")}/${r.doc}` : r.url) };
  });

  const merged = [...built.filter((x): x is Campaign => !!x), ...prior.campaigns]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, KEEP);

  // refresh perf for tickered campaigns (dedupe tickers)
  const syms = [...new Set(merged.map((c) => c.ticker).filter((t): t is string => !!t))];
  const perfMap: Record<string, CampPerf | null> = {};
  await mapPool(syms, 6, async (s) => { perfMap[s] = await perfFor(s, merged.find((c) => c.ticker === s)!.date); });
  for (const c of merged) c.perf = c.ticker ? (perfMap[c.ticker] ?? null) : null;

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: allRaw.length, campaigns: merged } satisfies CampaignsData));
  console.log(`\nwrote ${merged.length} campaigns (${built.filter(Boolean).length} new).`);
  for (const c of merged.slice(0, 10)) console.log(`  ${c.date.slice(0, 10)} [${c.type.padEnd(11)}] ${(c.ticker || "—").padEnd(6)} ${c.campaigner.slice(0, 24).padEnd(24)} — ${c.ask.slice(0, 50)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
