/**
 * Staples Scanner extractor — turns the biweekly NielsenIQ sell-side scan notes into a structured
 * per-company/category time series (data/staples-scanner.json) for the Staples Scanner board + the
 * desk-note / earnings-prep tie-in. See lib/staplesScanner.ts for the data model + the licensing note.
 *
 * WATCHED FOLDER: drop the licensed scan PDFs (GS / Morgan Stanley / Wells Fargo NielsenIQ updates) into
 * STAPLES_SCAN_DIR (default: the top-level staples-scans/ — kept OUTSIDE data/ on purpose, so the raw
 * licensed PDFs never ride the R2 tarball (data-to-r2 ships only data/) and are never committed (the repo
 * is public; staples-scans/ is gitignored). We pdf-parse the text layer, extract the numbers with the LLM,
 * and persist ONLY the derived figures to data/staples-scanner.json — never the copyrighted text.
 * Already-extracted files are skipped (FORCE=1 re-runs). On the NAS the folder persists across ticks —
 * git pull --ff-only and the data/-only R2 hydrate never touch it.
 *
 *   npm run refresh-staples-scanner            # extract any new PDFs in the watched folder
 *   FORCE=1 npm run refresh-staples-scanner    # re-extract everything
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { narrative, narrativeList } from "../lib/llmValidate";
import { tickerFor, inflectionOf, type ScanLevel, type ScanRow, type ScanReport, type ScanSummary, type StaplesScannerData } from "../lib/staplesScanner";
import { writeFeedOrExit } from "../lib/feedGuard";

// Load .env.local into process.env for local tsx runs (CI injects the vars directly).
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI provides env directly */ }

const SCAN_DIR = process.env.STAPLES_SCAN_DIR || join(process.cwd(), "staples-scans");
const OUT = join(process.cwd(), "data", "staples-scanner.json");
const FORCE = process.env.FORCE === "1";
const TEXT_CAP = Number(process.env.STAPLES_SCAN_CAP) || 30000; // the summary + company/category tables are front-loaded
const HISTORY_CAP = 200;

const SYSTEM =
  "You extract structured NielsenIQ retail-scanner data points from ONE sell-side research note on consumer staples. " +
  "The note reports US point-of-sale DOLLAR sales growth over trailing windows — L2wk, L4wk, L12wk, L52wk — at the CATEGORY, COMPANY (manufacturer), and BRAND level, plus volume growth, price/mix, and DOLLAR-SHARE changes in basis points. " +
  "Return one row per CATEGORY and per COMPANY you can find, plus notable BRANDS that have a share move or a called-out trend. " +
  "RULES: Extract ONLY figures explicitly stated — NEVER invent, interpolate, or guess a number; omit any window you do not see. " +
  "All growth figures are y/y percent as a SIGNED number (e.g. -4.7 for down 4.7%). Put the 2-week $ growth in dollar.l2w, 4-week in dollar.l4w, 12-week in dollar.l12w, 52-week in dollar.l52w. " +
  "volume = the latest-window volume growth %; priceMix = the latest-window price/mix %. shareDeltaBps = the y/y dollar-share change in basis points, signed (+ = gaining share), else null. " +
  "inflection = 'accelerating' | 'decelerating' | 'stable' ONLY when the note states or clearly implies it (e.g. an Inflection Tracker table), else null. " +
  "note = ONE short PARAPHRASED takeaway (max ~20 words) — NEVER a verbatim quote from the note. level = 'category' | 'company' | 'brand'. " +
  "category = the product category (Beer, Spirits, Wine, RTD, FMB, Hard Seltzer, CSD, Energy, Bottled Water, Snacks, Cigarettes, Smokeless, Vapor, Beauty, Skin Care, Oral Care, HPC, etc.). " +
  "Also return: source (the bank — Goldman Sachs, Morgan Stanley, Wells Fargo, …), a short title, segment (Alcohol | Tobacco | Non-Alc Beverages | Beauty & HPC | Staples Retail), periodEnd (the data-thru date as YYYY-MM-DD), and publishedAt (the report date as YYYY-MM-DD). " +
  "Return a SINGLE JSON OBJECT. " + NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON: {"source":string,"title":string,"segment":string,"periodEnd":"YYYY-MM-DD","publishedAt":"YYYY-MM-DD","rows":[{"level":"category|company|brand","category":string,"label":string,"dollar":{"l2w":number|null,"l4w":number|null,"l12w":number|null,"l52w":number|null},"volume":number|null,"priceMix":number|null,"shareDeltaBps":number|null,"inflection":"accelerating|decelerating|stable"|null,"note":string|null}]}';

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[%+,]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};
const isoDate = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");

function cleanRow(r: any): ScanRow | null {
  const label = String(r?.label ?? "").trim().slice(0, 60);
  if (!label) return null;
  const level: ScanLevel = r?.level === "category" || r?.level === "brand" ? r.level : "company";
  const dollar = { l2w: num(r?.dollar?.l2w), l4w: num(r?.dollar?.l4w), l12w: num(r?.dollar?.l12w), l52w: num(r?.dollar?.l52w) };
  // Nothing extractable → drop the row rather than store an empty shell.
  if (dollar.l2w == null && dollar.l4w == null && dollar.l12w == null && dollar.l52w == null && num(r?.shareDeltaBps) == null) return null;
  const inflection = ["accelerating", "decelerating", "stable"].includes(r?.inflection) ? r.inflection : inflectionOf(dollar);
  return {
    level,
    category: String(r?.category ?? "").trim().slice(0, 40) || "—",
    label,
    ticker: level === "company" ? tickerFor(label) : null,
    dollar,
    volume: num(r?.volume),
    priceMix: num(r?.priceMix),
    shareDeltaBps: num(r?.shareDeltaBps),
    inflection,
    note: r?.note ? String(r.note).trim().slice(0, 160) : null,
  };
}

async function extractReport(file: string, text: string): Promise<ScanReport | null> {
  const out = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nSELL-SIDE SCAN NOTE (file: ${file}):\n${text.slice(0, TEXT_CAP)}`, {
    maxTokens: 8000,
    reasoningEffort: "low",
  });
  if (!out || !Array.isArray(out.rows)) return null;
  const rows = out.rows.map(cleanRow).filter((r: ScanRow | null): r is ScanRow => r !== null);
  if (!rows.length) return null;
  return {
    source: String(out.source ?? "").trim().slice(0, 24) || "—",
    title: String(out.title ?? file.replace(/\.pdf$/i, "")).trim().slice(0, 120),
    segment: String(out.segment ?? "").trim().slice(0, 40) || "Staples",
    periodEnd: isoDate(out.periodEnd),
    publishedAt: isoDate(out.publishedAt),
    sourceFile: file,
    rows,
  };
}

// AI "desk read" of the whole board — the trading takeaway across every extracted scan. Generated once
// here (biweekly cadence → no per-view cost) and stored on the data so the board shows it instantly.
async function buildSummary(reports: ScanReport[]): Promise<ScanSummary | null> {
  // Latest row per (level|name|category), tagged with segment — the same de-dup the board renders.
  const best = new Map<string, ScanRow & { segment: string; periodEnd: string }>();
  for (const rep of reports) for (const row of rep.rows ?? []) {
    const key = `${row.level}|${(row.ticker || row.label).toUpperCase()}|${row.category.toLowerCase()}`;
    const cur = best.get(key);
    if (!cur || (rep.periodEnd || "") > cur.periodEnd) best.set(key, { ...row, segment: rep.segment, periodEnd: rep.periodEnd });
  }
  const all = [...best.values()].filter((r) => r.level !== "brand"); // companies + categories carry the signal
  if (all.length < 3) return null;
  // Rank by salience: the acceleration (L4w − L12w) or the dollar-share move, whichever is larger.
  const accel = (r: ScanRow) => (r.dollar.l4w ?? 0) - (r.dollar.l12w ?? 0);
  const salience = (r: ScanRow) => Math.max(Math.abs(accel(r)), Math.abs((r.shareDeltaBps ?? 0) / 100));
  const rows = all.sort((a, b) => salience(b) - salience(a)).slice(0, 60);
  const n = (v: number | null | undefined) => (v == null ? "?" : `${v > 0 ? "+" : ""}${v}%`);
  const line = (r: ScanRow & { segment: string }) =>
    `${r.segment} · ${r.level} · ${r.label}${r.category && r.category !== "—" ? ` (${r.category})` : ""}: L4w ${n(r.dollar.l4w)} vs L12w ${n(r.dollar.l12w)}${r.volume != null ? `, vol ${n(r.volume)}` : ""}${r.shareDeltaBps != null ? `, shareΔ ${r.shareDeltaBps > 0 ? "+" : ""}${r.shareDeltaBps}bps` : ""}${r.inflection ? ` [${r.inflection}]` : ""}${r.note ? ` — ${r.note}` : ""}`;
  const periodEnd = reports.map((r) => r.periodEnd).filter(Boolean).sort().at(-1) || "";

  const SYSTEM =
    "You are a consumer-staples analyst reading the latest NielsenIQ US retail-scanner data for a trading desk. " +
    "From the figures provided, summarize the trading read: which companies/categories are ACCELERATING vs DECELERATING (L4-week vs L12-week $ growth — the inflection is the signal, not the level), who is GAINING or LOSING dollar share, the notable category trends, and which names the data flags as best/worst set up into their next print. " +
    "Ground EVERY claim in the numbers/names provided — never invent a figure or a company not listed. Prefer volume-led over price-led growth when calling something healthy. Be concrete and terse. " +
    NO_ADVICE;
  const SCHEMA =
    'Return ONLY JSON: {"headline":string (ONE sentence — the single biggest takeaway for a staples trader),' +
    '"points":string[] (3-6 short plain-English bullets: the standout accelerating/decelerating names, share gainers/losers, category trends, and any name clearly set up well or poorly into its print — no bullet symbols)}';

  const out = await chatJSON<{ headline?: string; points?: unknown }>(
    SYSTEM,
    `Data thru ${periodEnd}. ${rows.length} company/category reads (most salient first):\n${rows.map(line).join("\n")}\n\n${SCHEMA}`,
    { maxTokens: 900, reasoningEffort: "low" },
  );
  // narrative(): a "…" shell in the headline or the points is no summary at all (lib/llmValidate)
  const headline = narrative(out?.headline, 320);
  if (!out || !headline || !Array.isArray(out.points)) return null;
  const points = narrativeList(out.points, 6, 280);
  if (!points.length) return null;
  return { headline, points, periodEnd, generatedAt: new Date().toISOString() };
}

async function main() {
  if (!(await llmConfigured())) {
    console.warn("staples-scanner: no LLM configured (OPENROUTER_API_KEY) — skipping.");
    return;
  }
  if (!existsSync(SCAN_DIR)) {
    console.log(`staples-scanner: no scan dir at ${SCAN_DIR} — nothing to do (drop the biweekly Nielsen PDFs there).`);
    return;
  }
  const pdfs = readdirSync(SCAN_DIR).filter((f) => /\.pdf$/i.test(f)).sort();
  if (!pdfs.length) {
    console.log(`staples-scanner: no PDFs in ${SCAN_DIR}.`);
    return;
  }

  const existing: StaplesScannerData = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, "utf8"))
    : { generatedAt: "", reports: [] };
  const bySrc = new Map<string, ScanReport>((existing.reports ?? []).map((r) => [r.sourceFile, r]));

  let extracted = 0;
  for (const f of pdfs) {
    if (bySrc.has(f) && !FORCE) { console.log(`  ${f}: already extracted — skip (FORCE=1 to re-run)`); continue; }
    let text = "";
    try {
      const data: any = await pdfParse(readFileSync(join(SCAN_DIR, f)));
      text = String(data?.text ?? "");
    } catch (e: any) {
      console.warn(`  ${f}: pdf-parse failed (${String(e?.message || e).slice(0, 80)}) — skip`);
      continue;
    }
    if (text.length < 400) { console.warn(`  ${f}: no extractable text (image-only PDF?) — skip`); continue; }
    const rep = await extractReport(f, text).catch(() => null);
    if (!rep) { console.warn(`  ${f}: extraction returned nothing — skip`); continue; }
    bySrc.set(f, rep);
    extracted++;
    console.log(`  ${f}: ${rep.rows.length} rows · ${rep.source} · ${rep.segment} · thru ${rep.periodEnd || "?"}`);
  }

  const reports = [...bySrc.values()]
    .sort((a, b) => (b.periodEnd || "").localeCompare(a.periodEnd || "") || (b.publishedAt || "").localeCompare(a.publishedAt || ""))
    .slice(0, HISTORY_CAP);

  // Regenerate the AI desk read when new scans came in (or when we have none yet); otherwise keep the prior
  // one so a no-op run doesn't burn an LLM call. Never drop a good summary if the regen fails.
  let summary = existing.summary ?? null;
  if (reports.length && (extracted > 0 || !summary)) {
    const fresh = await buildSummary(reports).catch((e) => { console.warn(`  summary: ${String(e?.message || e).slice(0, 80)}`); return null; });
    if (fresh) { summary = fresh; console.log(`  summary: ${fresh.headline.slice(0, 90)}`); }
  }

  await writeFeedOrExit("staples-scanner.json", { generatedAt: new Date().toISOString(), summary, reports });
  console.log(`staples-scanner: wrote ${reports.length} reports (${extracted} newly extracted) → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
