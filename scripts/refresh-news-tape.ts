/**
 * Real-time news tape refresh — poll the free wires, tag what can be tagged, accumulate the archive.
 *
 *   npm run refresh-news-tape
 *
 * COSTS NOTHING AND CALLS NO MODEL. Five keyless HTTP GETs (~300KB total), a name-index build, and a
 * regex per headline. There is no LLM anywhere in this pipeline — the judgement lives in the matcher's
 * refusal rules, the rest is arithmetic. That is deliberate: this runs every few minutes, and anything
 * with a per-call cost could not.
 *
 * ⚠ THIS IS AN APPEND-ONLY ARCHIVE AND THE ONLY WAY TO BUILD IT IS FORWARD. Each wire exposes only its
 * newest ~20 items and forgets the rest; a poll we skip is history we can never recover. So the script
 * is defensive in one specific direction: a source that fails must never cause the file to shrink.
 * Per-source failures are caught and logged, the merge is union-with-prior, and writeFeedGuarded is the
 * final backstop ("a KILLED step writes NOTHING").
 */
import { promises as fs } from "fs";
import path from "path";
import { writeFeedGuarded } from "../lib/feedGuard";
import { WIRE_SOURCES, type RawItem } from "../lib/wireSources";
import {
  buildNameIndex, tagHeadline, isPromo, categoryOf, mergeTapeAccumulate, summariseTape,
  normTicker, type Registrant, type TapeItem,
} from "../lib/newsTape";

const DATA = path.join(process.cwd(), "data");
const OUT = "news-tape.json";
const KEEP = Number(process.env.NEWS_TAPE_KEEP || 20_000);
const TIMEOUT_MS = Number(process.env.NEWS_TAPE_TIMEOUT_MS || 20_000);
// SEC asks for a contactable UA on every automated request; the wires accept anything. Same string
// the rest of the SEC callers use (lib/edgar.ts) so all our traffic is attributable to one identity.
const UA = process.env.SEC_USER_AGENT || "stock-chart-screener (research; jameslyeh@gmail.com)";

async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/**
 * SEC's registrant list is the tagging ground truth. It is cached to disk because this script runs
 * every few minutes and the file changes about once a day — re-pulling 1.2MB on every tick would be
 * rude to SEC and pointless. A stale cache is strictly better than a failed run: an older list tags
 * slightly fewer names, which is the safe direction.
 */
async function loadRegistrants(): Promise<Registrant[]> {
  const cache = path.join(DATA, "sec-registrants.json");
  const DAY = 86_400_000;
  try {
    const st = await fs.stat(cache);
    if (Date.now() - st.mtimeMs < DAY) {
      return JSON.parse(await fs.readFile(cache, "utf8")) as Registrant[];
    }
  } catch { /* no cache yet */ }

  try {
    const raw = JSON.parse(await getText("https://www.sec.gov/files/company_tickers.json")) as
      Record<string, { cik_str: number; ticker: string; title: string }>;
    const regs = Object.values(raw)
      .filter((e) => e?.ticker && e?.title)
      .map((e) => ({ ticker: e.ticker, title: e.title, cik: String(e.cik_str).padStart(10, "0") }));
    if (regs.length < 5000) throw new Error(`implausible registrant count ${regs.length}`);
    await fs.mkdir(DATA, { recursive: true });
    await fs.writeFile(cache, JSON.stringify(regs), "utf8");
    console.log(`  registrants: pulled ${regs.length} from SEC`);
    return regs;
  } catch (e) {
    // Fall back to whatever is on disk, however old — tagging with a stale list beats not running.
    const stale = await fs.readFile(cache, "utf8").then((s) => JSON.parse(s) as Registrant[]).catch(() => null);
    if (stale?.length) { console.warn(`  registrants: SEC pull failed (${String((e as Error).message)}), using stale cache of ${stale.length}`); return stale; }
    throw new Error(`cannot load registrants and no cache exists: ${String((e as Error).message)}`);
  }
}

async function main() {
  const regs = await loadRegistrants();
  const idx = buildNameIndex(regs);
  const cikToTicker = new Map<string, string>();
  for (const r of regs) {
    // First writer wins: SEC lists the primary share class first, so GOOGL beats GOOG for CIK lookup.
    if (r.cik && !cikToTicker.has(r.cik)) cikToTicker.set(r.cik, normTicker(r.ticker));
  }
  console.log(`  index: ${idx.exact.size} exact names, ${idx.prefix.size} unambiguous prefixes, ${cikToTicker.size} CIKs`);

  // ── poll every wire concurrently; a failure is logged and skipped, never fatal ──────────────────
  const polled = await Promise.all(WIRE_SOURCES.map(async (src) => {
    try {
      const body = await getText(src.url);
      const rows = src.parse(body);
      console.log(`  ${src.name.padEnd(16)} ${String(rows.length).padStart(4)} items`);
      return { src, rows };
    } catch (e) {
      console.warn(`  ${src.name.padEnd(16)} FAILED — ${String((e as Error).message)}`);
      return { src, rows: [] as RawItem[] };
    }
  }));

  const okSources = polled.filter((p) => p.rows.length > 0).length;
  if (okSources === 0) {
    // Every wire down at once is far more likely to be our network than the whole internet. Writing a
    // merge of nothing would still be safe (union with prior), but there is no reason to touch the file.
    console.error("news-tape: every source returned zero items — leaving the archive untouched");
    process.exitCode = 1;
    return;
  }

  // ── tag ────────────────────────────────────────────────────────────────────────────────────────
  const fresh: TapeItem[] = [];
  for (const { src, rows } of polled) {
    for (const r of rows) {
      let symbol: string | null = null;
      let tagHow: TapeItem["tagHow"] = null;

      // EDGAR first: a CIK is ground truth, not inference — but only when the filer IS the subject.
      // See the "(Filed by)" trap in lib/wireSources.
      if (r.cik && r.subjectIsFiler) {
        const s = cikToTicker.get(r.cik);
        if (s) { symbol = s; tagHow = "edgar-cik"; }
      }
      if (!symbol) {
        const t = tagHeadline(r.headline, idx, r.context);
        if (t) { symbol = t.symbol; tagHow = t.how; }
      }

      // Macro sources are never about one issuer; a ticker on a Fed release would be noise at best.
      const kind = src.kind === "macro" ? "macro" : isPromo(r.headline) ? "promo" : src.kind;
      if (src.kind === "macro") { symbol = null; tagHow = null; }

      fresh.push({
        id: r.id, at: r.at, source: src.name, kind,
        headline: r.headline, url: r.url, symbol, tagHow,
        category: categoryOf(r.headline, r.category),
      });
    }
  }

  // ── merge with the archive ─────────────────────────────────────────────────────────────────────
  const priorFile = await fs.readFile(path.join(DATA, OUT), "utf8")
    .then((s) => JSON.parse(s) as { items?: TapeItem[] }).catch(() => null);
  const prior = priorFile?.items ?? [];
  const items = mergeTapeAccumulate(prior, fresh, KEEP);
  const added = items.length - prior.length;

  const now = Date.now();
  const summary = summariseTape(items, now);
  const payload = {
    generatedAt: new Date(now).toISOString(),
    sources: WIRE_SOURCES.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    sourcesOk: okSources,
    // The honest latency claim, so the page never implies a real-time feed we do not have.
    latencyNote: "Free public wires: EDGAR runs ~5 min behind, press wires ~10 min. Not a sub-second feed.",
    ...summary,
    items,
  };

  const w = await writeFeedGuarded(OUT, payload);
  console.log(
    `news-tape: ${w.written ? "wrote" : "SKIPPED"} ${items.length} rows ` +
    `(+${added} new, ${summary.tagged} tagged = ${summary.taggedPct}%, ${summary.inLastHour} in last hour, ` +
    `${okSources}/${WIRE_SOURCES.length} sources ok)${w.written ? "" : ` — ${w.reason}`}`,
  );
}

main().catch((e) => { console.error("refresh-news-tape:", String(e?.message || e)); process.exitCode = 1; });
