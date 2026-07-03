/**
 * One-off model-quality eval: can Qwen2.5-72B (the local-hosting candidate) replace the incumbents
 * on Tape's extraction tasks? Runs the EXACT production prompts through candidate + incumbent via
 * OpenRouter and grades both against values we previously VERIFIED by hand:
 *
 *   Task A — same-store-sales comp extraction (incumbent: Gemini 3.1 Pro; the "guidance-class" task).
 *            Gold = AutoNation's quarters, each arithmetic-verified against the filing's own table.
 *   Task B — IPO prospectus classification (incumbent: GLM-5.2; the nightly-fleet task).
 *            Reference = stored classifications (underwriters were spot-verified 18/18 vs prospectuses).
 *
 * Note: a locally-hosted AWQ 4-bit 72B lands ~1-3% below OpenRouter's serving of the same model —
 * treat candidate results as a tight upper bound. Run: npx tsx scripts/eval-local-model.ts
 */
import { promises as fsp } from "fs";
import path from "path";
import { chatJSON, PRO_MODEL } from "../lib/llm";
import { stripHtml } from "../lib/edgarSearch";

const CANDIDATE = process.env.CANDIDATE || "qwen/qwen-2.5-72b-instruct";
const GLM = "z-ai/glm-5.2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SEC_UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": /sec\.gov/.test(url) ? SEC_UA : UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return stripHtml(await res.text());
}

// ── Task A: SSS comp extraction (prompt copied verbatim from scripts/refresh-sss.ts) ──
const SSS_SYSTEM =
  "You extract the COMPARABLE SALES metric (a.k.a. same-store sales / SSS / identical sales / like-for-like) from a retailer's or restaurant's quarterly earnings press release. Return the headline TOTAL-COMPANY comparable-sales figure for the MOST RECENT FISCAL QUARTER, on a ONE-YEAR basis. Rules: " +
  "Use the MOST RECENT FISCAL QUARTER (a ~3-month / 12-13-week period — note some chains run a 16-week Q1), NOT a full-year, annual, or year-to-date/52-week figure — if the release shows BOTH a quarter and a full-year comp, pick the QUARTER. " +
  "IMPORTANT — a FOURTH-QUARTER / fiscal-year-END release reports BOTH a full-year comp AND a separate fourth-quarter comp; extract the FOURTH-QUARTER one (it IS a quarter — often labeled 'fourth quarter', 'Q4', 'fourth-quarter same-restaurant/comparable sales'), NEVER the full-year/fiscal-year figure. " +
  "AUTOMOTIVE / VEHICLE DEALERSHIP GROUPS usually do NOT print a single headline comp %; instead they publish an 'UNAUDITED SAME STORE DATA' table whose TOTAL 'Same-store Revenue' (or the total 'Revenue' row inside that same-store table) shows the current-quarter and prior-year-quarter DOLLAR amounts, and often a total '% Variance'. Use that TOTAL same-store REVENUE change as 'comp': take the stated total % variance, or — if only dollars are shown — compute (current ÷ prior − 1) × 100, rounded to ONE decimal, SIGNED. Set metricLabel='Same-store Revenue'. Use the TOTAL only, NEVER a single line such as New vehicle / Used vehicle / Parts & service / Finance & insurance. " +
  "'comp' = total-company 1-year comparable-sales % change, SIGNED (e.g. 5.3 or -2.1). If a TOTAL/CONSOLIDATED/company-wide comparable-sales figure is given (even alongside per-brand or per-segment figures), put that TOTAL in 'comp' and the breakdown in 'segments'. Only if there is genuinely NO single company-wide comp (some multi-brand operators), set comp=null and fill 'segments'. " +
  "Do NOT return system-wide sales growth, net-sales growth, or total-revenue growth — ONLY the comparable/same-store/identical/like-for-like metric. " +
  "'periodEnd': the END date of that fiscal QUARTER, as ISO YYYY-MM-DD. Return a SINGLE JSON OBJECT, not an array.";
const SSS_SCHEMA = 'Return ONLY JSON (a single object): {"comp": number|null, "periodEnd": string|null, "metricLabel": string|null}';

const KW = /comparable|same[- ]?(store|restaurant|shop|location|cafe|salon)|identical sales|like[- ]for[- ]like|comp(s|arable)?\s+(restaurant|store|sales)|system[- ]wide/i;
function grepWindows(text: string, pad = 900, cap = 15000): string {
  const hits: [number, number][] = [];
  const re = new RegExp(KW.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - pad), e = Math.min(text.length, m.index + pad);
    if (hits.length && s <= hits[hits.length - 1][1]) hits[hits.length - 1][1] = e;
    else hits.push([s, e]);
    if (hits.reduce((a, [x, y]) => a + (y - x), 0) > cap) break;
  }
  const head = text.slice(0, 1300);
  if (!hits.length) return (head + "\n…\n" + text.slice(0, cap)).slice(0, cap);
  return (head + "\n…\n" + hits.map(([s, e]) => text.slice(s, e)).join("\n…\n")).slice(0, cap);
}

async function taskSSS() {
  const sss = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "same-store-sales.json"), "utf8"));
  const an = sss.byTicker["AN"];
  const periods = (an?.periods ?? []).filter((p: any) => p.comp != null && p.source?.url).slice(0, 10);
  console.log(`\n══ Task A: SSS comp extraction — ${periods.length} AutoNation quarters (arithmetic-verified gold) ══`);
  const score: Record<string, { exact: number; close: number; wrong: number; fail: number }> = {};
  for (const model of [CANDIDATE, GLM, PRO_MODEL]) score[model] = { exact: 0, close: 0, wrong: 0, fail: 0 };
  for (const p of periods) {
    let text = "";
    try { text = grepWindows(await fetchText(p.source.url)); } catch { console.log(`  ${p.fpEnd}: fetch failed — skipped`); continue; }
    const row: string[] = [];
    for (const model of [CANDIDATE, GLM, PRO_MODEL]) {
      const out = await chatJSON<any>(SSS_SYSTEM, `${SSS_SCHEMA}\n\nEarnings text for AN:\n${text}`, { model, maxTokens: 2000 }).catch(() => null);
      const got = typeof out?.comp === "number" ? out.comp : null;
      const s = score[model];
      if (got == null) { s.fail++; row.push("fail"); }
      else if (Math.abs(got - p.comp) < 0.05) { s.exact++; row.push(String(got)); }
      else if (Math.abs(got - p.comp) <= 0.3) { s.close++; row.push(got + "~"); }
      else { s.wrong++; row.push(got + "✗"); }
      await sleep(150);
    }
    console.log(`  ${p.fpEnd}  gold ${String(p.comp).padStart(5)}  | 72B ${row[0].padStart(7)} | GLM ${row[1].padStart(7)} | Pro ${row[2].padStart(7)}`);
  }
  return score;
}

// ── Task B: IPO classification (prompt copied verbatim from scripts/refresh-ipo.ts) ──
const IPO_SYSTEM =
  "You read one SEC 424B4 prospectus and determine if it is an INITIAL public offering (a company listing common stock for the FIRST time) — NOT a follow-on, secondary, shelf takedown, ETF, SPAC unit, or debt offering. If it IS an IPO, return the ticker, company name, IPO price per share, total deal size in US$ MILLIONS, and exchange (NYSE/Nasdaq). Else isIpo=false.";
const IPO_SCHEMA = 'Return ONLY JSON: {"isIpo":boolean,"ticker":string,"company":string,"priceUsd":number|null,"sizeUsdM":number|null,"exchange":string}';

async function taskIPO() {
  const ipo = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "ipo-monitor.json"), "utf8"));
  const events = ipo.events.filter((e: any) => e.kind !== "upcoming" && e.url && e.ticker && e.priceUsd != null).slice(0, 10);
  console.log(`\n══ Task B: IPO classification — ${events.length} priced prospectuses (stored GLM reference; several hand-verified) ══`);
  const score: Record<string, { ticker: number; price: number; size: number; n: number; fail: number }> = {};
  for (const model of [CANDIDATE, GLM]) score[model] = { ticker: 0, price: 0, size: 0, n: 0, fail: 0 };
  for (const e of events) {
    let text = "";
    try { text = (await fetchText(e.url)).slice(0, 6000); } catch { console.log(`  ${e.ticker}: fetch failed — skipped`); continue; }
    const cells: string[] = [];
    for (const model of [CANDIDATE, GLM]) {
      const out = await chatJSON<any>(IPO_SYSTEM, `Filed ${e.ipoDate}. ${e.company}.\n\n${text}\n\n${IPO_SCHEMA}`, { model, maxTokens: 1300 }).catch(() => null);
      const s = score[model];
      if (!out || out.isIpo === false) { s.fail++; cells.push("fail"); await sleep(150); continue; }
      s.n++;
      const tOk = String(out.ticker || "").toUpperCase() === e.ticker;
      const pOk = out.priceUsd != null && Math.abs(out.priceUsd - e.priceUsd) < 0.51;
      const zOk = out.sizeUsdM != null && e.sizeUsdM != null ? Math.abs(out.sizeUsdM - e.sizeUsdM) / e.sizeUsdM < 0.15 : out.sizeUsdM == null && e.sizeUsdM == null;
      if (tOk) s.ticker++;
      if (pOk) s.price++;
      if (zOk) s.size++;
      cells.push(`${tOk ? "T" : "t"}${pOk ? "P" : "p"}${zOk ? "Z" : "z"}`);
      await sleep(150);
    }
    console.log(`  ${e.ticker.padEnd(6)} $${String(e.priceUsd).padEnd(6)} ${String(e.sizeUsdM).padEnd(7)}M | 72B ${cells[0].padEnd(5)} | GLM ${cells[1].padEnd(5)}   (caps=match)`);
  }
  return score;
}

(async () => {
  const a = await taskSSS();
  const b = await taskIPO();
  console.log(`\n══ SUMMARY ══`);
  console.log(`Task A (SSS comps vs verified gold):`);
  for (const [m, s] of Object.entries(a)) console.log(`  ${m.padEnd(32)} exact ${s.exact} · close(≤0.3) ${s.close} · wrong ${s.wrong} · fail ${s.fail}`);
  console.log(`Task B (IPO fields vs stored reference):`);
  for (const [m, s] of Object.entries(b)) console.log(`  ${m.padEnd(32)} ticker ${s.ticker}/${s.n} · price ${s.price}/${s.n} · size(±15%) ${s.size}/${s.n} · classify-fail ${s.fail}`);
  console.log(`\nCaveat: local AWQ 4-bit runs ~1-3% below this hosted 72B; treat candidate scores as a tight upper bound.`);
})();
