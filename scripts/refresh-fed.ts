/**
 * Builds data/fed-watch.json — the Fed communications digest.
 *
 * 1. Pull the Fed RSS feeds: press_monetary.xml (FOMC statements/minutes) + speeches.xml, plus the
 *    latest Beige Book national summary.
 * 2. For each NEW item, fetch the full text and have GLM score it hawkish/dovish/neutral with a
 *    one-line headline, "what changed" (esp. FOMC statements), and 2-4 bullets.
 *
 * Forward-accumulating: already-classified items are kept; only new ones hit the LLM. Free source,
 * no key, no Cloudflare block. Run: npm run refresh-fed. Nightly (FULL).
 */
import { promises as fsp } from "fs";
import path from "path";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import type { Bias, FedItem, FedKind, FedWatchData } from "../lib/fedWatch";

const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "fed-watch.json");
const UA = "Mozilla/5.0 (stock-chart-screener research; jameslyeh@gmail.com)";
const KEEP = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawItem { id: string; date: string; title: string; url: string; desc: string; kind: FedKind; speaker: string | null }

function htmlToText(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—").replace(/&#8217;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  return res.ok ? res.text() : "";
}
// Fed pages carry a big nav/header before the body — jump to the first real content anchor so the LLM
// sees the statement/speech, not the menu.
function extractFedBody(html: string): string {
  let t = htmlToText(html);
  const i = t.search(/Recent indicators|Information received|The Committee (decided|reaffirmed|judges|will)|For (immediate )?release|Minutes of the|Good (morning|afternoon|evening)|Thank you|I(?:'m| am) (?:pleased|delighted|honored|grateful)/i);
  if (i > 200) t = t.slice(Math.max(0, i - 80));
  return t.slice(0, 7500);
}
function parseFeed(xml: string, kind: FedKind): RawItem[] {
  const cd = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  const out: RawItem[] = [];
  for (const it of xml.split("<item>").slice(1)) {
    const g = (t: string) => { const m = it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? cd(m[1]) : ""; };
    const title = g("title"), url = g("link") || g("guid"), dateRaw = g("pubDate"), desc = htmlToText(g("description"));
    if (!title || !url) continue;
    // refine kind + speaker from the item
    let k: FedKind = kind, speaker: string | null = null;
    if (kind === "speech") { speaker = title.split(",")[0].trim() || null; }
    else if (/minutes/i.test(title)) k = "minutes";
    else if (/statement/i.test(title)) k = "statement";
    else if (/beige book/i.test(title)) k = "beige-book";
    out.push({ id: url, date: dateRaw ? new Date(dateRaw).toISOString() : "", title, url, desc, kind: k, speaker });
  }
  return out;
}

async function classify(item: RawItem, body: string): Promise<{ bias: Bias; headline: string; whatChanged: string; points: string[] } | null> {
  const SYSTEM =
    "You are a Fed watcher for a professional investor. Read this Federal Reserve communication and score its monetary-policy signal on the hawkish↔dovish spectrum: HAWKISH = leaning toward tighter policy / higher-for-longer / inflation worry; DOVISH = leaning toward easing / cuts / labor-market concern; NEUTRAL = balanced or non-policy. " +
    "Return a one-sentence 'headline' (the single most market-relevant takeaway), 'whatChanged' (for an FOMC statement/minutes: what shifted vs the prior meeting — language on rates, inflation, jobs, balance sheet; for a speech: what's notable about this speaker's stance; '' if nothing), and 2-4 short 'points'. Be specific and terse; quote key phrases. " +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"bias":"hawkish"|"dovish"|"neutral","headline":string,"whatChanged":string,"points":string[]}';
  const ctx = `Type: ${item.kind}. Title: ${item.title}. ${item.speaker ? `Speaker: ${item.speaker}. ` : ""}${item.date.slice(0, 10)}\n\n${(body || item.desc).slice(0, 7000)}`;
  const out = await chatJSON<any>(SYSTEM, ctx + "\n\n" + SCHEMA, { maxTokens: 900 });
  if (!out || !["hawkish", "dovish", "neutral"].includes(out.bias)) return null;
  return {
    bias: out.bias,
    headline: String(out.headline || "").slice(0, 240),
    whatChanged: String(out.whatChanged || "").slice(0, 400),
    points: Array.isArray(out.points) ? out.points.filter((p: any) => typeof p === "string" && p.trim()).map((p: string) => p.trim().slice(0, 220)).slice(0, 4) : [],
  };
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

  const [monXml, spXml] = await Promise.all([
    getText("https://www.federalreserve.gov/feeds/press_monetary.xml"),
    getText("https://www.federalreserve.gov/feeds/speeches.xml"),
  ]);
  let raw = [...parseFeed(monXml, "statement"), ...parseFeed(spXml, "speech")];
  // latest Beige Book national summary (link off the hub)
  try {
    const hub = await getText("https://www.federalreserve.gov/monetarypolicy/publications/beige-book-default.htm");
    const m = hub.match(/href="([^"]*beigebook\d{6}-summary\.htm)"/i);
    if (m) { const url = new URL(m[1], "https://www.federalreserve.gov").href; const ym = url.match(/beigebook(\d{4})(\d{2})/); const d = ym ? `${ym[1]}-${ym[2]}-01T12:00:00Z` : nowISO; raw.unshift({ id: url, date: d, title: `Beige Book — ${ym ? ym[1] + "-" + ym[2] : "latest"}`, url, desc: "", kind: "beige-book", speaker: null }); }
  } catch { /* optional */ }
  raw = raw.filter((r) => r.date).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 24); // recent window
  console.log(`fetched ${raw.length} Fed items`);

  const prior: FedWatchData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, items: [] as FedItem[] }));
  const known = new Set(prior.items.map((i) => i.id));
  const fresh = raw.filter((r) => !known.has(r.id));
  console.log(`${fresh.length} new to classify`);

  const built = await mapPool(fresh, 4, async (r): Promise<FedItem | null> => {
    const body = /federalreserve\.gov/.test(r.url) ? extractFedBody(await getText(r.url).catch(() => "")) : "";
    await sleep(150);
    const c = await classify(r, body);
    if (!c) return null;
    return { id: r.id, date: r.date, kind: r.kind, title: r.title, speaker: r.speaker, url: r.url, ...c };
  });

  const items = [...built.filter((x): x is FedItem => !!x), ...prior.items]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, KEEP);
  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, items } satisfies FedWatchData));
  console.log(`\nwrote ${items.length} items (${built.filter(Boolean).length} new).`);
  for (const i of items.slice(0, 8)) console.log(`  ${i.date.slice(0, 10)} [${i.bias.padEnd(7)}] ${i.kind.padEnd(10)} ${i.title.slice(0, 60)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
