/**
 * Builds data/trump-truth-stocks.json — the "Trump stock calls" feed.
 *
 * 1. Pull the President's recent Truth Social posts (Mastodon API for @realDonaldTrump; trumpstruth.org
 *    RSS as a fallback if the API IP-blocks the CI runner).
 * 2. GLM screens every NEW post and keeps ONLY the ones that name a specific publicly-traded company in
 *    a stock-moving way (praise/criticism of the business, a deal, a tariff/policy at it, an endorsement
 *    or attack) — all the political noise is dropped. It extracts ticker(s) + stance + a quote.
 * 3. For each named ticker, pull the price series and compute the return SINCE the post (+1d/1w/1m).
 *
 * Forward-accumulating: already-classified posts are kept; only new posts hit the LLM, but every kept
 * post's performance is refreshed each run. Run: npm run refresh-trump-truth. Nightly (FULL).
 *
 * This is a public-post MENTION tracker, not investment advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import type { Perf, Stance, TickerCall, TrumpStockPost, TrumpStocksData } from "../lib/trumpStocks";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "trump-truth-stocks.json");
const TRUMP_ID = "107780257626128497"; // @realDonaldTrump
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const PAGES = 6; // ~40 posts/page
const KEEP = 200;
const DAY = 86_400_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface RawPost { id: string; date: string; url: string; text: string }

function htmlToText(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchViaApi(): Promise<RawPost[]> {
  const out: RawPost[] = [];
  let maxId: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const u = new URL(`https://truthsocial.com/api/v1/accounts/${TRUMP_ID}/statuses`);
    u.searchParams.set("exclude_replies", "true");
    u.searchParams.set("limit", "40");
    if (maxId) u.searchParams.set("max_id", maxId);
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    const arr: any[] = await res.json();
    if (!Array.isArray(arr) || !arr.length) break;
    for (const p of arr) {
      const text = htmlToText(p.content);
      const quoted = p.quote ? htmlToText(p.quote.content) : "";
      const card = p.card?.title ? `[linked: ${p.card.title}]` : "";
      const full = [text, quoted, card].filter(Boolean).join(" — ");
      out.push({ id: String(p.id), date: p.created_at, url: p.url, text: full });
    }
    maxId = String(arr[arr.length - 1].id);
    await sleep(400);
  }
  return out;
}

async function fetchViaRss(): Promise<RawPost[]> {
  const res = await fetch("https://trumpstruth.org/feed", { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  const out: RawPost[] = [];
  for (const it of xml.split("<item>").slice(1)) {
    const g = (tag: string) => { const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? cdata(m[1]) : ""; };
    const link = g("link") || g("guid");
    const id = ((link.match(/(\d{6,})/) || [])[1]) || link;
    const dateRaw = g("pubDate");
    const text = htmlToText(g("description") || g("title"));
    if (id && text) out.push({ id, date: dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString(), url: link, text });
  }
  return out;
}

interface Extracted { tickers: TickerCall[]; quote: string; rationale: string }

async function classifyBatch(posts: RawPost[]): Promise<Record<string, Extracted>> {
  const numbered = posts.map((p, i) => `#${i} (${(p.date || "").slice(0, 10)}): ${p.text.slice(0, 600)}`).join("\n\n");
  const SYSTEM =
    "You screen Donald Trump's Truth Social posts for a professional investor who ONLY cares about posts where TRUMP HIMSELF makes a statement about a SPECIFIC publicly-traded company (US-listed or a major foreign/ADR) that could move THAT stock — he praises or criticizes the BUSINESS, announces/celebrates a deal/investment/US plant, threatens or imposes a tariff/policy/regulatory/legal action on it, or explicitly endorses or attacks it. " +
    "EXCLUDE (return nothing): generic economy/markets/politics, 'the stock market is up', attacking a media outlet purely over its news coverage (not its business), a person whose surname merely coincides with a ticker, sports, crypto tokens, AND — importantly — a company that appears only INCIDENTALLY: in the headline of an article he reshared, in a passing list, or as the maker of an unrelated product, where he is not himself commenting on that company. When in doubt, EXCLUDE. Most posts are NOT relevant — a typical batch has zero or one. " +
    "For each RELEVANT post return: its index; the real listed ticker symbol(s) in UPPERCASE (Dell→DELL, Intel→INTC, Nvidia→NVDA, Apple→AAPL, Boeing→BA, U.S. Steel→X); the company name; a stance (bullish = positive for the stock / praises / endorses / a helpful deal; bearish = attacks / threatens / negative; neutral = mentions without a clear direction); a quote (<=140 chars) of TRUMP'S relevant words; and a one-line rationale. " +
    NO_ADVICE;
  const SCHEMA =
    'Return ONLY JSON: {"items":[{"index":number,"tickers":[{"ticker":string,"company":string,"stance":"bullish"|"bearish"|"neutral"}],"quote":string,"rationale":string}]}. Use an empty items array if none are relevant.';
  const out = await chatJSON<{ items: any[] }>(SYSTEM, numbered + "\n\n" + SCHEMA, { maxTokens: 2200 });
  const map: Record<string, Extracted> = {};
  for (const it of out?.items || []) {
    const p = posts[it?.index];
    if (!p) continue;
    const tickers: TickerCall[] = (it.tickers || [])
      .map((t: any) => ({
        ticker: String(t?.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, ""),
        company: String(t?.company || "").slice(0, 60),
        stance: (["bullish", "bearish", "neutral"].includes(t?.stance) ? t.stance : "neutral") as Stance,
      }))
      .filter((t: TickerCall) => t.ticker.length >= 1 && t.ticker.length <= 6);
    if (!tickers.length) continue;
    map[p.id] = { tickers, quote: String(it.quote || "").slice(0, 180), rationale: String(it.rationale || "").slice(0, 200) };
  }
  return map;
}

async function seriesFor(sym: string): Promise<{ t: number; c: number }[] | null> {
  try {
    const ch: any = await yf.chart(sym, { period1: new Date(Date.now() - 430 * DAY), interval: "1d" } as any, { validateResult: false });
    const q = (ch?.quotes || []).filter((x: any) => x?.close != null).map((x: any) => ({ t: new Date(x.date).getTime(), c: x.close as number }));
    return q.length ? q : null;
  } catch {
    return null;
  }
}
function perfFrom(series: { t: number; c: number }[], postT: number): Perf {
  const after = (target: number) => { const f = series.find((p) => p.t >= target); return f ? f.c : null; };
  const at = after(postT);
  const now = series[series.length - 1].c;
  const pct = (a: number | null, b: number | null) => (a && b ? +(((b / a) - 1) * 100).toFixed(2) : null);
  return { priceAtPost: at, priceNow: now, sincePct: pct(at, now), d1Pct: pct(at, after(postT + 1.5 * DAY)), w1Pct: pct(at, after(postT + 7 * DAY)), m1Pct: pct(at, after(postT + 30 * DAY)) };
}

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { out[i] = null as any; } }
  }));
  return out;
}

async function main() {
  const nowISO = new Date().toISOString();
  if (!(await llmConfigured())) { console.log("LLM not configured — skipping (set OPENROUTER_API_KEY)."); return; }

  // ── fetch posts ──
  let raw: RawPost[] = [], source = "";
  try { raw = await fetchViaApi(); source = "truthsocial.com API"; console.log(`fetched ${raw.length} posts via API`); }
  catch (e) {
    console.log(`API failed (${(e as Error).message}) → RSS fallback`);
    try { raw = await fetchViaRss(); source = "trumpstruth.org RSS"; console.log(`fetched ${raw.length} posts via RSS`); }
    catch (e2) { console.error("both sources failed:", (e2 as Error).message); }
  }
  raw = raw.filter((p) => p.text && p.text.replace(/\[linked:[^\]]*\]/g, "").trim().length > 15);

  // ── load prior, classify only NEW posts ──
  const prior: TrumpStocksData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, source, scanned: 0, posts: [] as TrumpStockPost[] }));
  const known = new Set(prior.posts.map((p) => p.id));
  const fresh = raw.filter((p) => !known.has(p.id));
  console.log(`${fresh.length} new posts to screen (of ${raw.length} fetched, ${prior.posts.length} already tracked)`);

  const extracted: Record<string, Extracted> = {};
  for (let i = 0; i < fresh.length; i += 12) {
    const batch = fresh.slice(i, i + 12);
    try { Object.assign(extracted, await classifyBatch(batch)); } catch (e) { console.log(`  batch ${i} failed: ${(e as Error).message}`); }
  }
  const newStockPosts: TrumpStockPost[] = fresh
    .filter((p) => extracted[p.id])
    .map((p) => ({ id: p.id, date: p.date, url: p.url, excerpt: extracted[p.id].quote || p.text.slice(0, 160), rationale: extracted[p.id].rationale, tickers: extracted[p.id].tickers }));
  console.log(`→ ${newStockPosts.length} new STOCK posts found`);

  // ── merge, then refresh performance for every kept post ──
  const merged = [...newStockPosts, ...prior.posts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, KEEP);
  const symbols = [...new Set(merged.flatMap((p) => p.tickers.map((t) => t.ticker)))];
  console.log(`pricing ${symbols.length} unique tickers…`);
  const seriesMap: Record<string, { t: number; c: number }[] | null> = {};
  await mapPool(symbols, 6, async (sym) => { seriesMap[sym] = await seriesFor(sym); });

  let dropped = 0;
  for (const post of merged) {
    const postT = Date.parse(post.date);
    post.tickers = post.tickers
      .map((t) => { const s = seriesMap[t.ticker]; return { ...t, perf: s ? perfFrom(s, postT) : null }; })
      .filter((t) => t.perf); // drop tickers Yahoo can't price (hallucinated / delisted)
    if (!post.tickers.length) dropped++;
  }
  const posts = merged.filter((p) => p.tickers.length);

  const data: TrumpStocksData = { generatedAt: nowISO, source, scanned: raw.length, posts };
  await fsp.writeFile(FILE, JSON.stringify(data));
  console.log(`\nwrote ${posts.length} stock posts (${dropped} dropped for unpriceable tickers). source: ${source}`);
  for (const p of posts.slice(0, 10)) {
    const t = p.tickers.map((x) => `${x.ticker}(${x.stance[0]}${x.perf?.sincePct != null ? " " + (x.perf.sincePct >= 0 ? "+" : "") + x.perf.sincePct + "%" : ""})`).join(", ");
    console.log(`  ${p.date.slice(0, 10)}  ${t}  — ${p.rationale.slice(0, 70)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
