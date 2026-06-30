/**
 * SERVER-ONLY. Fetch a UK issuer's latest RNS results / trading-statement text from Investegate
 * (a free, server-rendered RNS aggregator). The company page at /company/<LSE-ticker> lists every
 * announcement with a stable URL; we pick the newest "results"-type ones (trading statement, interim,
 * half-year, final/full-year, quarter) and fetch each body as clean text for the LFL extractor.
 *
 * NOT client-safe (does network I/O) — used only by scripts/refresh-sss-intl.ts. Do NOT import from a
 * "use client" component.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const strip = (h: string): string =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#?[a-z0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// A results announcement is the one carrying the comp — exclude the routine RNS spam
// (share buybacks, director dealings, voting rights, block listings, AGM, holdings).
const RESULTS_RE = /trading statement|trading update|interim results|half[- ]year|final results|full[- ]year|preliminary|first quarter|third quarter|\bq[13]\b|quarterly|christmas trading|holiday trading/i;
const NOISE_RE = /transaction in own shares|director\/pdmr|pdmr shareholding|total voting rights|block listing|holding\(s\) in company|result of agm|net asset value|director declaration|grant of|notice of|timing of|board change|annual report|publication of/i;

export interface IrDoc {
  title: string;
  url: string;
  id: string; // the trailing numeric id (monotonic — higher = newer); the incremental gate key
  text: string;
}

/** The latest `take` results-type RNS announcements for an LSE ticker, newest first, as clean text. */
export async function getLatestUkResults(lseTicker: string, take = 1): Promise<IrDoc[]> {
  const ticker = lseTicker.toUpperCase();
  let page = "";
  try {
    const r = await fetch(`https://www.investegate.co.uk/company/${ticker}`, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!r.ok) return [];
    page = await r.text();
  } catch {
    return [];
  }
  // Pull every announcement link + its anchor text (the headline), in page order (newest first).
  const re = /<a[^>]+href="(https:\/\/www\.investegate\.co\.uk\/announcement\/rns\/[^"]+\/(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const cands: { url: string; id: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(page))) {
    const [, url, id] = m;
    const title = strip(m[3]);
    if (!title || seen.has(id)) continue;
    seen.add(id);
    if (RESULTS_RE.test(title) && !NOISE_RE.test(title)) cands.push({ url, id, title });
  }
  const docs: IrDoc[] = [];
  for (const c of cands.slice(0, take)) {
    try {
      const r = await fetch(c.url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (!r.ok) continue;
      const text = strip(await r.text());
      if (text.length > 500) docs.push({ title: c.title, url: c.url, id: c.id, text });
    } catch {
      /* skip this announcement */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return docs;
}
