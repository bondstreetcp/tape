/**
 * Persistent headline archive (funda build-order #5, substrate) — every headline any pipeline
 * already fetches gets KEPT. getNews is a live RSS read that retained nothing, so no headline
 * backtest, debate-evidence backfill, or attribution history was ever possible; the archive is
 * forward-only from ship day and every unarchived day is history lost, which is why this ships
 * as substrate before anything consumes it.
 *
 * Design: TEE AT THE POINT OF USE — getNews calls archiveNews() after each successful fetch, so
 * coverage is organic (exactly the names the system looks at nightly) and costs ZERO extra
 * fetches. Writes are gated by NEWS_ARCHIVE=1 (set by run-tick + the workflow): web/Vercel
 * contexts have read-only filesystems and must never try. Concurrent getNews calls funnel
 * through one in-process chain; the file loads once per process and flushes every N mutations.
 * Rows keep {t, title, pub} only — Google's redirect links are 400-char dead weight and rot
 * anyway; title+publisher+time is the analyzable record. Rolling cap per symbol keeps the file
 * inside the every-tick tarball's budget (capacity ~2 years of typical per-name flow).
 */
import { promises as fsp } from "fs";
import path from "path";
import type { NewsItem } from "./news";

const FILE = path.join(process.cwd(), "data", "news-archive.json");
const CAP_PER_SYMBOL = 150;
const FLUSH_EVERY = 20;

export interface ArchivedHeadline {
  /** Publish time (ISO) when the feed carried one, else first-seen date. */
  t: string;
  title: string;
  pub: string;
}

export interface NewsArchiveFile {
  generatedAt: string;
  count: number;
  symbols: Record<string, ArchivedHeadline[]>;
}

/** Same normalization getNews dedupes on — a press release and its media echo are one headline. */
export const headlineKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);

/** Pure merge: append unseen headlines, newest-first, rolling cap. Exported for tests. */
export function mergeHeadlines(
  existing: ArchivedHeadline[],
  incoming: { title: string; publisher: string; time: string | null }[],
  nowIso: string,
  cap = CAP_PER_SYMBOL,
): ArchivedHeadline[] {
  const seen = new Set(existing.map((h) => headlineKey(h.title)));
  const added: ArchivedHeadline[] = [];
  for (const i of incoming) {
    const key = headlineKey(i.title);
    if (!i.title || seen.has(key)) continue;
    seen.add(key);
    added.push({ t: i.time || nowIso.slice(0, 10), title: i.title, pub: i.publisher || "News" });
  }
  if (!added.length) return existing;
  return [...added, ...existing].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, cap);
}

let state: { data: NewsArchiveFile; dirty: number } | null = null;
let chain: Promise<void> = Promise.resolve();

async function loadOnce(): Promise<NewsArchiveFile> {
  if (state) return state.data;
  let data: NewsArchiveFile;
  try {
    data = JSON.parse(await fsp.readFile(FILE, "utf8"));
    if (!data.symbols) throw new Error("shape");
  } catch {
    data = { generatedAt: new Date().toISOString(), count: 0, symbols: {} };
  }
  state = { data, dirty: 0 };
  return data;
}

async function flush(): Promise<void> {
  if (!state) return;
  const d = state.data;
  d.generatedAt = new Date().toISOString();
  d.count = Object.values(d.symbols).reduce((a, l) => a + l.length, 0);
  await fsp.writeFile(FILE, JSON.stringify(d));
  state.dirty = 0;
}

/** Tee a getNews result into the archive. No-op unless NEWS_ARCHIVE=1. Never throws — an archive
 *  failure must not break the pipeline that fetched the news. */
export function archiveNews(query: string, items: NewsItem[]): Promise<void> {
  if (process.env.NEWS_ARCHIVE !== "1" || !items.length) return Promise.resolve();
  const symbol = query.trim().toUpperCase();
  if (!symbol || symbol === "MARKET") return Promise.resolve();
  chain = chain.then(async () => {
    try {
      const data = await loadOnce();
      const prev = data.symbols[symbol] || [];
      const next = mergeHeadlines(prev, items, new Date().toISOString());
      if (next === prev) return;
      data.symbols[symbol] = next;
      state!.dirty++;
      if (state!.dirty >= FLUSH_EVERY) await flush();
    } catch (e) {
      console.warn("news-archive: skipped —", String((e as Error)?.message || e));
    }
  });
  return chain;
}

/** Final flush for script tails (process.exit skips beforeExit — call this where convenient;
 *  losing a partial batch only costs headlines tomorrow's fetch re-serves). */
export function flushNewsArchive(): Promise<void> {
  chain = chain.then(() => flush().catch(() => undefined));
  return chain;
}

// Graceful ends flush automatically; hard process.exit() paths lose at most FLUSH_EVERY-1 rows.
process.once("beforeExit", () => { void flushNewsArchive(); });
