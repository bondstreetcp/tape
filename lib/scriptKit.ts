/**
 * The ONE copy of the helpers every refresh script used to carry for itself.
 *
 * The 2026-09-05 review counted mapPool defined in 29 scripts, sleep in 52 files, a browser user-agent
 * in 19, a per-module Yahoo client in 34, readJson in 6, validTicker in 4 and htmlToText in 3. Copies
 * drift — most pools swallowed a failed task silently, a few warned — and every fix had to land N
 * times. Scripts and server-only libs import from here.
 *
 * NEVER import this from a client component or a lib a client component reaches: it reads the
 * filesystem, and an fs import pulled into a "use client" bundle breaks `next build` (it froze
 * tape-web for nine deploy cycles once — docs/FEEDBACK-2026-08-16.md).
 */
import { promises as fs } from "fs";
import path from "path";

export const DAY = 86_400_000;
export const DATA_DIR = path.join(process.cwd(), "data");

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What a real Chrome sends — for hosts that serve a thin page (or a 403) to anything else. */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** An honest research UA with a contact, which the public-data hosts (SEC, BLS, BEA, the Fed) ask for. */
export const RESEARCH_UA = "Mozilla/5.0 (tape research; jameslyeh@gmail.com)";

const errMsg = (e: unknown): string => String((e as any)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);

// ── Concurrency ──────────────────────────────────────────────────────────────────────────────────

/**
 * Run `fn` over `items` with at most `n` in flight; results keep the input order. STRICT: the first
 * rejection rejects the pool (Promise.all semantics). Use it where one failure should fail the run —
 * a snapshot build that must be complete or not at all.
 */
export async function mapPool<T, R>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
    }),
  );
  return out;
}

/**
 * The same pool for per-name fan-outs, where one bad symbol must not sink the feed: a task that throws
 * leaves `null` in its slot. The failures are NOT silent — the first is logged in full, the count is
 * printed at the end, and both ride into the tick report through `swallow` (label = the caller's).
 */
export async function mapPoolSafe<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
  label = "mapPool",
): Promise<(R | null)[]> {
  const out = new Array<R | null>(items.length);
  let idx = 0;
  let errs = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await fn(items[i], i); }
        catch (e) { errs++; out[i] = null; swallow(label, e); }
      }
    }),
  );
  if (errs) console.warn(`  ${label}: ${errs}/${items.length} tasks threw (dropped as null)`);
  return out;
}

// ── Suppressed errors, counted ───────────────────────────────────────────────────────────────────

/** The stderr line the runner lifts into the tick report: `[suppressed-errors] {"label":count,…}`. */
export const SUPPRESSED_MARK = "[suppressed-errors]";
const suppressed = new Map<string, { n: number; first: string }>();
let exitHooked = false;

/**
 * Count an error that was deliberately swallowed. "Degrade, never break" is right for a nightly, but a
 * bare `catch {}` makes a wrong URL, a changed page layout and an expired key all look like "nothing
 * today" — the transcript-source collapse hid behind an empty listing for weeks. The FIRST error per
 * label is logged in full; the rest are counted, and the counts are printed at exit as one line that
 * run-tick parses into data/tick-report.json (`suppressed` per step), so a feed failing quietly every
 * night shows on the status page instead of aging out unnoticed.
 */
export function swallow(label: string, err?: unknown): void {
  const cur = suppressed.get(label);
  if (cur) { cur.n++; return; }
  const first = errMsg(err);
  suppressed.set(label, { n: 1, first });
  console.warn(`  [swallowed] ${label}: ${first}`);
  if (!exitHooked) { exitHooked = true; process.once("exit", reportSuppressed); }
}

/** Run `fn`; on a throw, count it under `label` and return `fallback` — the readable form of
 *  `.catch(() => null)` for the cases where the failure should be counted, not forgotten. */
export async function quietly<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { swallow(label, e); return fallback; }
}

export function suppressedCounts(): Record<string, number> {
  return Object.fromEntries([...suppressed].map(([k, v]) => [k, v.n]));
}
/** Test seam. */
export function resetSuppressed(): void { suppressed.clear(); }

function reportSuppressed(): void {
  if (!suppressed.size) return;
  process.stderr.write(`${SUPPRESSED_MARK} ${JSON.stringify(suppressedCounts())}\n`);
}

/** Lift the counts back out of a step's captured stderr (run-tick). The last marker line wins. */
export function parseSuppressed(stderr: string): Record<string, number> | null {
  let out: Record<string, number> | null = null;
  for (const m of stderr.matchAll(/\[suppressed-errors\] (\{[^\n]*\})/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j && typeof j === "object" && !Array.isArray(j)) out = j;
    } catch { /* a cut-off line — ignore it */ }
  }
  return out;
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

/** data/<file> parsed, or null when it doesn't exist yet (a first run is not an error). A file that
 *  exists but won't parse IS an error, and is counted rather than hidden. Absolute paths pass through. */
export async function readJson<T = any>(file: string, dir = DATA_DIR): Promise<T | null> {
  const abs = path.isAbsolute(file) ? file : path.join(dir, file);
  try { return JSON.parse(await fs.readFile(abs, "utf8")) as T; }
  catch (e) {
    if ((e as any)?.code !== "ENOENT") swallow(`readJson ${path.basename(abs)}`, e);
    return null;
  }
}

// ── Vendors ──────────────────────────────────────────────────────────────────────────────────────

/** Does Yahoo have a close for `sym` in the last 20 days? The liveness check before a scraped ticker
 *  is admitted to a feed. Goes through the shared self-healing client (lib/yahooClient), loaded lazily
 *  so scripts that only want `sleep` don't pay for yahoo-finance2 at import. */
export async function validTicker(sym: string): Promise<boolean> {
  try {
    const { yahoo } = await import("./yahooClient");
    const ch: any = await yahoo.chart(sym, { period1: new Date(Date.now() - 20 * DAY), interval: "1d" } as any, { validateResult: false });
    return (ch?.quotes || []).some((q: any) => q?.close != null);
  } catch { return false; }
}

// ── Text ─────────────────────────────────────────────────────────────────────────────────────────

/** HTML → plain text for an LLM prompt: block ends become newlines, scripts/styles go, the common
 *  entities decode, runs of blank lines collapse. (lib/edgar has the filing-grade variant with a cap.) */
export function htmlToText(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "+3.2%" from percentage POINTS, "?" when unknown — the prompt-context flavour (the UI has lib/format). */
export const pct = (v: number | null | undefined, d = 0): string => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
/** "$1.2B" / "$340M" / "$12K" — the prompt-context flavour. */
export const money = (v: number): string =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`;
