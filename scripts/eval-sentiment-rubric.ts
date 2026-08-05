/**
 * A/B eval of the overnight-filings SENTIMENT rubric — the /debates precondition.
 *
 * THE PROBLEM: the digest's sentiment runs wildly bull-skewed (2026-07-27: 174 bullish / 11 bearish
 * of 400; 2026-08-05: 161 / 27) even though the rubric already says "judge substance, not tone."
 * If that skew is REAL (companies do time good news), a debate ledger built on it is fine; if it's
 * the model deferring to issuer framing, the ledger becomes a press-release feed. Only labels can
 * tell which.
 *
 * DESIGN — one variable at a time:
 *   • Stratified sample from the live feed (bullish/neutral/bearish buckets, deterministic pick).
 *   • REFERENCE labels: PRO_MODEL reads the RAW FILING TEXT with an independent, skew-aware framing
 *     (not either rubric) + high reasoning. These are strong-reader labels, not gospel — every
 *     disagreement is printed with the evidence so a human adjudicates before any rubric ships.
 *   • Variant A: the production SYSTEM + schema, VERBATIM (copied below; keep in sync by hand).
 *   • Variant B: identical except the one sentiment sentence — recalibrated with concrete bearish
 *     tells and an explicit counter to issuer spin. Same model tier as production (FLASH).
 *   • Report: distributions, agreement vs reference, per-item table, and the money metric — of the
 *     reference's bearish set, what each variant catches.
 *
 *   npx tsx scripts/eval-sentiment-rubric.ts            # full run (~36 filings × 3 calls)
 *   N=12 npx tsx scripts/eval-sentiment-rubric.ts       # smaller smoke run
 */
import { promises as fsp } from "fs";
import path from "path";
import { getFilingText } from "../lib/edgar";
import { chatJSON, FLASH_MODEL, PRO_MODEL } from "../lib/llm";

const DATA = path.join(process.cwd(), "data");
const N = Number(process.env.N) || 36;
const TEXT_CAP = 30_000;

// ── Variant A: the production prompt, verbatim (scripts/refresh-overnight-filings.ts). Copied, not
// imported, because production keeps these inline; the eval's job is to test THIS exact wording. ──
const SENTIMENT_A =
  "sentiment: the filing's effect on the forward outlook / intrinsic value (bullish/neutral/bearish) — judge substance, not tone.";
// ── Variant B: the recalibrated sentence — the ONLY delta between A and B. ──
const SENTIMENT_B =
  "sentiment: the filing's effect on the forward outlook / intrinsic value (bullish/neutral/bearish). Judge the ECONOMICS, not the wording: issuers systematically frame bad news positively, so a filing can read upbeat and be bearish. Bearish tells (any one suffices when material): core revenue/margin/EPS deteriorating without an offsetting driver; guidance cut, withdrawn, or walked back; impairment, restatement, or going-concern language; covenant pressure or dilutive/expensive capital raised from weakness; a lost major customer/contract; regulatory or litigation action against the company; a surprise CEO/CFO/auditor exit. Bullish requires a genuine forward improvement (raised guidance, accelerating core growth, accretive deal, real capital return), not just an in-line quarter described warmly. neutral = genuinely balanced or immaterial, NOT a euphemism for 'mixed but politely worded'.";

const SYSTEM_CORE =
  "You are an equity analyst writing the overnight desk note on a new SEC filing. You get the FILING text — your ONLY source for every claim and number you cite. " +
  "Identify ONLY what materially changed or what the filing announces: revenue/margin/EPS vs the prior period, guidance, segment trends, new/dropped risk factors, buybacks/dividends, M&A (parties/price/structure), capital raises (size/coupon/use of proceeds), management changes, accounting/restatements. Ground every claim in the FILING text — never invent or infer a number that isn't stated there. Ignore boilerplate and unchanged repeated language. " +
  "FIELD RUBRICS — surprise: 'beat'/'miss' ONLY vs an analyst consensus/estimate explicitly stated in the filing (e.g. an EPS-surprise line), else 'na'; never infer beat/miss from a year-over-year change. %SENTIMENT% decisionTakeaway: one falsifiable sentence on what changed and why it matters; never a buy/sell/hold call. Return ONLY JSON.";
const SCHEMA =
  'Return ONLY a JSON object: {"headline": string (<=12 words), "decisionTakeaway": string, "sentiment": "bullish"|"neutral"|"bearish", "surprise": "beat"|"inline"|"miss"|"na"}';

// ── The reference labeler: an independent framing, deliberately unlike either variant. ──
const REF_SYSTEM =
  "You are a skeptical buy-side analyst. Read this SEC filing and answer ONE question: is it incrementally POSITIVE, NEGATIVE, or NEUTRAL for the stock's forward outlook relative to what a holder already expected? " +
  "Corporate filings are written to sound positive — judge the underlying economics, not the framing. A quarter can 'grow' and still be bad (decelerating, margin-down, guidance trimmed); a filing can be dull and still be good (a large accretive buyback). If the filing is genuinely routine/administrative, say neutral. " +
  "Give your verdict plus the ONE piece of evidence from the filing that most drives it, quoted or closely paraphrased.";
const REF_SCHEMA = 'Return ONLY JSON: {"label": "bullish"|"neutral"|"bearish", "evidence": string (one sentence, from the filing)}';

/** Deterministic stratified pick: sort each bucket by accession and take an even spread. */
function pick<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

async function main() {
  const feed = JSON.parse(await fsp.readFile(path.join(DATA, "overnight-filings.json"), "utf8"));
  const items: any[] = (feed.items || []).filter((x: any) => x?.ticker && x?.accession);
  const by = (s: string) => items.filter((x) => x.sentiment === s).sort((a, b) => a.accession.localeCompare(b.accession));
  // Bearish is the scarce class — take all of it; split the rest ~40/60 bullish/neutral.
  const bears = by("bearish").slice(0, Math.min(10, N));
  const rest = N - bears.length;
  const sample = [...bears, ...pick(by("bullish"), Math.round(rest * 0.45)), ...pick(by("neutral"), Math.ceil(rest * 0.55))].slice(0, N);
  console.log(`eval-sentiment: ${sample.length} filings (of ${items.length}; stored dist ${["bullish", "neutral", "bearish"].map((s) => `${s[0]}=${by(s).length}`).join(" ")})`);

  const rows: any[] = [];
  for (const it of sample) {
    const text = (await getFilingText(it.ticker, it.accession).catch(() => null))?.text?.slice(0, TEXT_CAP) || "";
    if (text.length < 400) { console.log(`  ${it.ticker} ${it.form}: unreadable — skipped`); continue; }
    const user = (schema: string) => `${schema}\n\n=== FILING (${it.ticker} ${it.form}, filed ${it.filedAt?.slice(0, 10)}) ===\n${text}`;
    const [ref, a, b] = await Promise.all([
      chatJSON<any>(REF_SYSTEM, user(REF_SCHEMA), { model: PRO_MODEL, maxTokens: 1200, reasoningEffort: "high" }).catch(() => null),
      chatJSON<any>(SYSTEM_CORE.replace("%SENTIMENT%", SENTIMENT_A), user(SCHEMA), { model: FLASH_MODEL, maxTokens: 900 }).catch(() => null),
      chatJSON<any>(SYSTEM_CORE.replace("%SENTIMENT%", SENTIMENT_B), user(SCHEMA), { model: FLASH_MODEL, maxTokens: 900 }).catch(() => null),
    ]);
    const row = {
      ticker: it.ticker,
      form: it.form,
      stored: it.sentiment,
      ref: ref?.label ?? null,
      refWhy: (ref?.evidence || "").slice(0, 140),
      A: a?.sentiment ?? null,
      B: b?.sentiment ?? null,
      headline: (it.headline || "").slice(0, 60),
    };
    rows.push(row);
    console.log(`  ${row.ticker.padEnd(6)} ${row.form.padEnd(5)} stored=${String(row.stored).padEnd(8)} ref=${String(row.ref).padEnd(8)} A=${String(row.A).padEnd(8)} B=${String(row.B).padEnd(8)} ${row.headline}`);
  }

  const dist = (k: "stored" | "ref" | "A" | "B") => {
    const d: Record<string, number> = {};
    for (const r of rows) d[r[k] ?? "fail"] = (d[r[k] ?? "fail"] || 0) + 1;
    return JSON.stringify(d);
  };
  const agree = (k: "stored" | "A" | "B") => {
    const ok = rows.filter((r) => r.ref && r[k] === r.ref).length;
    const n = rows.filter((r) => r.ref && r[k]).length;
    return n ? `${ok}/${n} (${Math.round((100 * ok) / n)}%)` : "—";
  };
  console.log(`\n══ SUMMARY (n=${rows.length}) ══`);
  console.log(`dist stored ${dist("stored")}\ndist ref    ${dist("ref")}\ndist A      ${dist("A")}\ndist B      ${dist("B")}`);
  console.log(`agreement w/ reference: stored ${agree("stored")} · A ${agree("A")} · B ${agree("B")}`);
  const refBears = rows.filter((r) => r.ref === "bearish");
  console.log(`reference-bearish (${refBears.length}): stored catches ${refBears.filter((r) => r.stored === "bearish").length} · A ${refBears.filter((r) => r.A === "bearish").length} · B ${refBears.filter((r) => r.B === "bearish").length}`);
  console.log(`\n── disagreements vs reference (for human adjudication) ──`);
  for (const r of rows.filter((x) => x.ref && (x.A !== x.ref || x.B !== x.ref)))
    console.log(`  ${r.ticker.padEnd(6)} ref=${r.ref.padEnd(8)} A=${String(r.A).padEnd(8)} B=${String(r.B).padEnd(8)} — ${r.refWhy}`);

  const out = path.join(DATA, ".tmp");
  await fsp.mkdir(out, { recursive: true });
  await fsp.writeFile(path.join(out, "sentiment-eval.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1));
  console.log(`\nraw rows → data/.tmp/sentiment-eval.json`);
}

main().catch((e) => { console.error("eval-sentiment:", String(e?.message || e)); process.exit(1); });
