/**
 * Builds data/macro-releases.json — the "recent economic releases" headline feed, from the PRIMARY
 * sources, FREE and KEYLESS:
 *   · BEA  https://apps.bea.gov/rss/rss.xml         — GDP, PCE / personal income, trade (dated items)
 *   · BLS  https://www.bls.gov/feed/bls_latest.rss  — CPI, PPI, jobs, ECI, productivity … ("Latest Numbers" rollup)
 *
 * No LLM, no key. Forward-accumulating: known headlines keep their first-seen date; only genuinely new
 * prints are added (so it becomes a rolling stream of "it just printed"). Run: npm run refresh-macro-releases.
 * Nightly (FULL). See lib/macroReleases.ts for the model + how this complements the FRED calendar.
 *
 * NOTE on sources probed 2026-08-24: Treasury press RSS is gone (home.treasury.gov 404/000); BLS's
 * per-release feeds (empsit.rss/cpi.rss) return 0 items and BLS blocks a "too-perfect" Chrome UA
 * (Akamai) — the plain research UA below works and the bls_latest rollup is the reliable BLS surface.
 */
import { promises as fsp } from "fs";
import path from "path";
import { catOf, type MacroRelease, type MacroReleasesData } from "../lib/macroReleases";

const FILE = path.join(process.cwd(), "data", "macro-releases.json");
const UA = "Mozilla/5.0 (tape macro-feed research; jameslyeh@gmail.com)";
const KEEP = 60;

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  return res.ok ? res.text() : "";
}
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&#39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
// RSS dates carry NAMED US zones (…08:30:00 EDT) that Date.parse rejects — map the common ones to offsets.
const ZONES: [RegExp, string][] = [[/\bEDT\b/, "-0400"], [/\bEST\b/, "-0500"], [/\bCDT\b/, "-0500"], [/\bCST\b/, "-0600"], [/\bMDT\b/, "-0600"], [/\bMST\b/, "-0700"], [/\bPDT\b/, "-0700"], [/\bPST\b/, "-0800"]];
const iso = (raw: string): string => {
  let s = raw.trim(); for (const [re, off] of ZONES) s = s.replace(re, off);
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : "";
};

// The market-moving BEA headlines only — the feed also carries niche reports (GDP-by-state, direct
// investment, foreign-affiliate activity) that would drown the signal. Mirrors econCalendar's MAJOR set.
const BEA_MAJOR = /gross domestic product|^gdp\b|personal income and outlays|international trade in goods and services/i;
const BEA_EXCLUDE = /by state|by industry|by county|by metropolitan|affiliat|direct investment|foreign direct|investment position/i;

/** BEA: <item name="…"> rows (attribute on the tag!) carrying title/link/pubDate plus a data block with
 *  the actual print (<current><percentChange|rateChange>) — we fold that figure into `value`. */
function parseBEA(xml: string): MacroRelease[] {
  const out: MacroRelease[] = [];
  for (const it of xml.split(/<item\b[^>]*>/).slice(1)) {
    const g = (t: string) => { const m = it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ""; };
    const title = g("title"), url = g("link") || g("guid"), date = iso(g("pubDate"));
    if (!title || !url || !date) continue;
    if (!BEA_MAJOR.test(title) || BEA_EXCLUDE.test(title)) continue;
    // Headline figure from the <current> block: a % change (GDP/PCE) or a $ level (trade balance).
    const cur = (it.match(/<current>([\s\S]*?)<\/current>/) || ["", ""])[1];
    const num = decode((cur.match(/<(?:percentChange|rateChange)>([\s\S]*?)<\/(?:percentChange|rateChange)>/) || ["", ""])[1]);
    const period = decode((cur.match(/<infoDate>([\s\S]*?)<\/infoDate>/) || ["", ""])[1]);
    // Guard the figure: BEA's <current> occasionally carries a malformed value — show one only when it
    // reads as a clean number or $-level, else fall back to the (already dated) title alone. Append "%"
    // just for a bare number (GDP "+1.5"); leave "-$73.3 billion" and self-united values as-is.
    const clean = /^[+-]?\$?[\d.,]+%?(\s*(?:billion|million|trillion))?$/i.test(num);
    const value = num && clean ? `${num}${/^[+-]?[\d.,]+$/.test(num) ? "%" : ""}${period ? ` · ${period}` : ""}` : null;
    out.push({ source: "BEA", title, url, date, category: catOf(title), value });
  }
  return out;
}

/** BLS: one "Latest Numbers" rollup item whose CDATA lists each indicator: `Label: <value> in <period>`. */
function parseBLS(xml: string): MacroRelease[] {
  const item = xml.split("<item>")[1] || "";
  const cd = (item.match(/<!\[CDATA\[([\s\S]*?)\]\]>/) || ["", ""])[1];
  const date = iso((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || ["", ""])[1]) || new Date().toISOString();
  const out: MacroRelease[] = [];
  for (const block of cd.split(/<p>/).slice(1)) {
    const label = (block.match(/^([^:<]+):/) || ["", ""])[1].replace(/&amp;/g, "&").trim();
    if (!label) continue;
    // value = text between the first <br> and the first following <a> (the "News Release" link)
    const afterBr = block.split(/<br\s*\/?>/i)[1] || "";
    const value = afterBr.split(/<a\b/i)[0].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!value || value.length < 2) continue;
    const href = (block.match(/<a[^>]+href="([^"]+)"/i) || ["", ""])[1];
    const url = href ? new URL(href, "https://www.bls.gov").href : "https://www.bls.gov/data/";
    out.push({ source: "BLS", title: `${label}: ${value}`, url, date, category: catOf(label), value });
  }
  return out;
}

async function main() {
  const [beaXml, blsXml] = await Promise.all([
    getText("https://apps.bea.gov/rss/rss.xml").catch(() => ""),
    getText("https://www.bls.gov/feed/bls_latest.rss").catch(() => ""),
  ]);
  const bea = parseBEA(beaXml), bls = parseBLS(blsXml);
  console.log(`fetched: BEA ${bea.length} · BLS ${bls.length}`);
  if (!bea.length && !bls.length) { console.error("both feeds returned nothing — not overwriting."); process.exit(1); }

  // Forward-accumulate: seed with prior (keeps each headline's first-seen date), add only new titles.
  const prior: MacroReleasesData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: "", releases: [] as MacroRelease[] }));
  const key = (r: MacroRelease) => `${r.source}|${r.title}`;
  const seen = new Map<string, MacroRelease>((prior.releases ?? []).map((r) => [key(r), r]));
  let added = 0;
  for (const r of [...bea, ...bls]) if (!seen.has(key(r))) { seen.set(key(r), r); added++; }

  const releases = [...seen.values()]
    .filter((r) => r.date)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, KEEP);
  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: new Date().toISOString(), releases } satisfies MacroReleasesData));
  console.log(`wrote ${releases.length} releases (${added} new) → ${FILE}`);
  for (const r of releases.slice(0, 10)) console.log(`  ${r.date.slice(0, 10)} [${r.source}] ${r.category.padEnd(9)} ${r.title.slice(0, 64)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
