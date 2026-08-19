/**
 * PRO-tier model shootout — code verifies, models propose. Default contenders are set below (MODELS=
 * overrides). The 2026-08-19 RUNS=3 run pitted z-ai/glm-5.2 vs moonshotai/kimi-k3 (neutral Gemini pair
 * judging): glm HELD the whole PRO seat — won narration 5/6 best-votes + IPO 30/30; kimi took only
 * valuation verdicts (4/6, marginal + worse-grounded), failed the "win both synthesis legs" bar. A
 * single run had flipped narration to kimi — judge variance, which is why RUNS≥3 exists (see below).
 *
 * Successor to eval-local-model.ts (the 2026-07-03 "can a local 72B do it" eval). Same doctrine —
 * code verifies, models propose — but aimed at the PRO_MODEL seat, so it runs BOTH kinds of work:
 *
 *   Leg A — SSS comp extraction. Gold = AutoNation quarters, each arithmetic-verified against the
 *           filing's own table. The "guidance-class" verifiable task.
 *   Leg B — IPO prospectus classification vs stored references (underwriters spot-verified 18/18).
 *           ⚠ the stored refs were produced by GLM — ticker/price/size are objective facts from the
 *           prospectus, but treat a GLM edge here with that grain of salt.
 *   Leg C — trade-desk narration (the flagship "code prices, LLM narrates"). Input = the shipped
 *           board's code-priced stat/event lines. Code-checks schema, symbol containment, and
 *           NUMBER GROUNDING (every numeral in a thesis must exist in that candidate's own line —
 *           the move-attribution-trap class). Quality judged blind.
 *   Leg D — valuation verdicts (genuine/trap/mixed). Candidates rebuilt from valuation-history +
 *           the live snapshot with the production selection rule. Same code checks; judged blind.
 *
 * Judging: two OUT-OF-RACE families (deepseek-v3.2, kimi-k3) score anonymized, per-judge-shuffled
 * outputs 1-10 on grounding/insight/clarity. Neither judge shares a lab with any contender.
 *
 * Latency is recorded per call — after 2026-08-04 (gemini-3.1-preview blowing 40s deadlines in
 * ask.ts) it is a first-class result, not a footnote. Cost comes from the llm-usage byModel delta.
 *
 *   npx tsx scripts/eval-model-shootout.ts            # all legs, one pass
 *   LEGS=ab npx tsx scripts/eval-model-shootout.ts    # extraction only (a|b|c|d, any combo)
 *   MODELS=x,y,z ...                                  # override the contender list
 *   RUNS=3 npx tsx scripts/eval-model-shootout.ts     # repeat every leg 3× and print an AGGREGATE
 *                                                     #   (best-vote tally + panel-mean) — de-noises the panel
 */
import { promises as fsp } from "fs";
import path from "path";
import { chatJSON } from "../lib/llm";
import { flushSync } from "../lib/llmUsage";
import { stripHtml } from "../lib/edgarSearch";

const CONTENDERS = (process.env.MODELS || "z-ai/glm-5.2,moonshotai/kimi-k3")
  .split(",").map((s) => s.trim()).filter(Boolean);
// OUT-OF-RACE judges that must NOT share a lab with any contender (else self-scoring bias). Default is
// the neutral Gemini pair — valid while the contenders are GLM/Kimi/DeepSeek. If you move a Gemini model
// INTO the race, move the judges to other labs. (A startup guard below hard-fails on any judge∩contender.)
const JUDGES = (process.env.JUDGES || "google/gemini-3.1-pro-preview,google/gemini-3.7-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);
const LEGS = (process.env.LEGS || "abcd").toLowerCase();
// Repeat the WHOLE shootout N× and print an AGGREGATE (best-vote tally + panel-mean per model). The
// blind panel is noisy at n=1 — the 2026-08-19 Leg C winner flipped between two single runs — so RUNS≥3
// is how you separate a real synthesis edge from judge variance. Capped at 10.
const RUNS = Math.max(1, Math.min(10, Number(process.env.RUNS) || 1));
const NO_ADVICE = "This is analytical commentary, not personalized investment advice.";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SEC_UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (m: string) => m.replace(/^.*\//, "");

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": /sec\.gov/.test(url) ? SEC_UA : UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return stripHtml(await res.text());
}

// Per-model latency log (ms) — every timed() call lands here.
const lat: Record<string, number[]> = {};
async function timed<T>(model: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try { return await fn(); }
  catch (e: any) { console.log(`    (${short(model)} error: ${String(e?.message || e).slice(0, 90)})`); return null; }
  finally { (lat[model] ??= []).push(Date.now() - t0); }
}
const stats = (xs: number[]) => {
  if (!xs.length) return "—";
  const s = [...xs].sort((a, b) => a - b);
  return `median ${(s[Math.floor(s.length / 2)] / 1000).toFixed(1)}s · max ${(s[s.length - 1] / 1000).toFixed(1)}s`;
};

/**
 * Number grounding: every numeric token the model wrote must exist in the source line it was given.
 * The check behind "NEVER invent a ... figure" — a fabricated number is the one violation code can
 * catch outright. Integers 0-12 are whitelisted ("two of the three", "1-2 weeks" style counting),
 * as are bare 4-digit years present anywhere in the source.
 */
function inventedNumbers(text: string, source: string): string[] {
  const srcNums = new Set((source.match(/-?\d+(?:\.\d+)?/g) || []).map((n) => String(+n)));
  const bad: string[] = [];
  for (const tok of text.match(/-?\d+(?:\.\d+)?/g) || []) {
    const v = +tok;
    if (Math.abs(v) <= 12 && Number.isInteger(v)) continue;
    // |v| match too: the input prints signed discounts ("-75%") and a model legitimately writes
    // "trading 75% below its median" — a sign-echo, not an invention. Observed inflating Leg D
    // counts for BOTH models on the 2026-08-04 run (TEAM:75, DPZ:44 flagged identically).
    const hit = srcNums.has(String(v)) || [...srcNums].some((s) => Math.abs(+s - v) < 0.05 || Math.abs(Math.abs(+s) - Math.abs(v)) < 0.05);
    if (!hit) bad.push(tok);
  }
  return [...new Set(bad)];
}

// ── Leg A: SSS comp extraction (prompt verbatim from scripts/refresh-sss.ts) ───────────────────────
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

async function legA() {
  const sss = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "same-store-sales.json"), "utf8"));
  const periods = (sss.byTicker["AN"]?.periods ?? []).filter((p: any) => p.comp != null && p.source?.url).slice(0, 10);
  console.log(`\n══ Leg A: SSS comp extraction — ${periods.length} AutoNation quarters (arithmetic-verified gold) ══`);
  const score: Record<string, { exact: number; close: number; wrong: number; fail: number }> = {};
  for (const m of CONTENDERS) score[m] = { exact: 0, close: 0, wrong: 0, fail: 0 };
  for (const p of periods) {
    let text = "";
    try { text = grepWindows(await fetchText(p.source.url)); } catch { console.log(`  ${p.fpEnd}: fetch failed — skipped`); continue; }
    const row: string[] = [];
    for (const model of CONTENDERS) {
      const out = await timed(model, () => chatJSON<any>(SSS_SYSTEM, `${SSS_SCHEMA}\n\nEarnings text for AN:\n${text}`, { model, maxTokens: 2000 }));
      const got = typeof out?.comp === "number" ? out.comp : null;
      const s = score[model];
      if (got == null) { s.fail++; row.push("fail"); }
      else if (Math.abs(got - p.comp) < 0.05) { s.exact++; row.push(String(got)); }
      else if (Math.abs(got - p.comp) <= 0.3) { s.close++; row.push(got + "~"); }
      else { s.wrong++; row.push(got + "✗"); }
      await sleep(150);
    }
    console.log(`  ${p.fpEnd}  gold ${String(p.comp).padStart(5)}  | ${CONTENDERS.map((m, i) => `${short(m).slice(0, 12)} ${row[i].padStart(7)}`).join(" | ")}`);
  }
  return score;
}

// ── Leg B: IPO classification (prompt verbatim from scripts/refresh-ipo.ts) ────────────────────────
const IPO_SYSTEM =
  "You read one SEC 424B4 prospectus and determine if it is an INITIAL public offering (a company listing common stock for the FIRST time) — NOT a follow-on, secondary, shelf takedown, ETF, SPAC unit, or debt offering. If it IS an IPO, return the ticker, company name, IPO price per share, total deal size in US$ MILLIONS, and exchange (NYSE/Nasdaq). Else isIpo=false.";
const IPO_SCHEMA = 'Return ONLY JSON: {"isIpo":boolean,"ticker":string,"company":string,"priceUsd":number|null,"sizeUsdM":number|null,"exchange":string}';

async function legB() {
  const ipo = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "ipo-monitor.json"), "utf8"));
  const events = ipo.events.filter((e: any) => e.kind !== "upcoming" && e.url && e.ticker && e.priceUsd != null).slice(0, 10);
  console.log(`\n══ Leg B: IPO classification — ${events.length} priced prospectuses (stored refs; several hand-verified) ══`);
  const score: Record<string, { ticker: number; price: number; size: number; n: number; fail: number }> = {};
  for (const m of CONTENDERS) score[m] = { ticker: 0, price: 0, size: 0, n: 0, fail: 0 };
  for (const e of events) {
    let text = "";
    try { text = (await fetchText(e.url)).slice(0, 6000); } catch { console.log(`  ${e.ticker}: fetch failed — skipped`); continue; }
    const cells: string[] = [];
    for (const model of CONTENDERS) {
      const out = await timed(model, () => chatJSON<any>(IPO_SYSTEM, `Filed ${e.ipoDate}. ${e.company}.\n\n${text}\n\n${IPO_SCHEMA}`, { model, maxTokens: 1300 }));
      const s = score[model];
      if (!out || out.isIpo === false) { s.fail++; cells.push("fail "); await sleep(150); continue; }
      s.n++;
      const tOk = String(out.ticker || "").toUpperCase() === e.ticker;
      const pOk = out.priceUsd != null && Math.abs(out.priceUsd - e.priceUsd) < 0.51;
      const zOk = out.sizeUsdM != null && e.sizeUsdM != null ? Math.abs(out.sizeUsdM - e.sizeUsdM) / e.sizeUsdM < 0.15 : out.sizeUsdM == null && e.sizeUsdM == null;
      if (tOk) s.ticker++;
      if (pOk) s.price++;
      if (zOk) s.size++;
      cells.push(`${tOk ? "T" : "t"}${pOk ? "P" : "p"}${zOk ? "Z" : "z"}`.padEnd(5));
      await sleep(150);
    }
    console.log(`  ${e.ticker.padEnd(6)} $${String(e.priceUsd).padEnd(6)} ${String(e.sizeUsdM).padEnd(7)}M | ${CONTENDERS.map((m, i) => `${short(m).slice(0, 12)} ${cells[i]}`).join(" | ")}  (caps=match)`);
  }
  return score;
}

// ── Synthesis legs: run one production prompt per model, code-check, then judge blind ──────────────
interface SynthOut { model: string; raw: any; text: string; violations: string[]; checkNote: string }

interface PanelResult { scores: Record<string, number[]>; bests: string[] }
async function judgePanel(taskLabel: string, taskInput: string, outs: SynthOut[]): Promise<PanelResult> {
  // Anonymize + shuffle per judge so neither name nor position leaks into the score.
  const scores: Record<string, number[]> = {};
  const bests: string[] = []; // each judge's stated BEST model — tallied across RUNS to de-noise the panel
  for (const o of outs) scores[o.model] = [];
  for (const judge of JUDGES) {
    const order = [...outs].sort(() => Math.random() - 0.5);
    const labels = ["X", "Y", "Z"].slice(0, order.length);
    const body = order.map((o, i) => `=== OUTPUT ${labels[i]} ===\n${o.text}`).join("\n\n");
    const sys =
      "You are grading anonymized model outputs for an equity-research product. Score each output 1-10 on: " +
      "grounding (claims tie to the supplied input; nothing invented), insight (says something a sharp analyst would find non-obvious), " +
      "clarity (tight, concrete, actionable). Be a hard grader; 9-10 is rare. Judge ONLY from the input and outputs given.";
    const user = `TASK: ${taskLabel}\n\n=== INPUT GIVEN TO ALL MODELS ===\n${taskInput}\n\n${body}\n\nReturn ONLY JSON: {"scores":{"${labels.join('":{"grounding":n,"insight":n,"clarity":n},"')}":{"grounding":n,"insight":n,"clarity":n}},"best":"X","note":"one line"}`;
    const out = await timed(judge, () => chatJSON<any>(sys, user, { model: judge, maxTokens: 2500 }));
    if (!out?.scores) { console.log(`    (judge ${short(judge)}: no usable scores)`); continue; }
    for (let i = 0; i < order.length; i++) {
      const s = out.scores[labels[i]];
      const total = s ? (Number(s.grounding) || 0) + (Number(s.insight) || 0) + (Number(s.clarity) || 0) : 0;
      if (total > 0) scores[order[i].model].push(total);
    }
    const bestModel = order[labels.indexOf(out.best)]?.model;
    if (bestModel) bests.push(bestModel);
    console.log(`    judge ${short(judge).padEnd(14)} best=${short(bestModel || "?")}  «${String(out.note || "").slice(0, 100)}»`);
  }
  return { scores, bests };
}

async function legC(): Promise<{ input: string; outs: SynthOut[]; judged: PanelResult }> {
  const ti = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "trade-ideas.json"), "utf8"));
  const pool = (ti.ideas || []).map((p: any) => ({ symbol: p.symbol, name: p.name, side: p.side, structure: p.structure, stat: p.stat, event: p.event }));
  const PICK = Math.min(5, pool.length);
  console.log(`\n══ Leg C: trade-desk narration — ${pool.length} code-priced candidates, pick ${PICK} (production prompt) ══`);
  const SYSTEM = `You are an options strategist writing a weekly desk note of the most actionable trades. Each candidate below was DETECTED and PRICED BY CODE — its ticker, structure, and stat (the mispricing) are FIXED and correct; do NOT change them or invent new numbers.

Your job: SELECT the ${PICK} most compelling, actionable-this-week ideas, and for each write:
- thesis: 2-3 sentences on why it's attractive, grounded ONLY in that candidate's stat + event. No new numbers, no price targets.
- risk: ONE sentence — the main thing that kills the trade (the move happens, IV stays bid, thin liquidity, the catalyst slips).
- trap: true if the edge is likely just pricing a KNOWN pending event (e.g. rich vol because a real catalyst is coming) rather than a free mispricing — be honest.
- conviction: "high" | "medium" | "low".

RULES:
- Pick the BEST ${PICK} (or fewer if few are compelling). Prefer a MIX of buy-vol / sell-vol / event, not all one kind.
- Ground every thesis in THAT candidate's stat/event. NEVER invent a deal, date, earnings figure, or price.
- Tight and concrete. No hype.
${NO_ADVICE}
Return JSON: { "picks": [ { "symbol": "TICKER", "thesis": "...", "risk": "...", "trap": false, "conviction": "medium" } ] }`;
  const user = pool.map((p: any) => `${p.symbol} (${p.name}) · ${p.side} · ${p.structure}\n  stat: ${p.stat}${p.event ? `\n  event: ${p.event}` : ""}`).join("\n\n");
  const bySym = new Map(pool.map((p: any) => [p.symbol, `${p.stat} ${p.event || ""}`]));

  const outs: SynthOut[] = [];
  for (const model of CONTENDERS) {
    const out = await timed(model, () => chatJSON<any>(SYSTEM, user, { model, maxTokens: 6000, reasoningEffort: "medium" }));
    const picks = Array.isArray(out?.picks) ? out.picks : [];
    const alien = picks.filter((p: any) => !bySym.has(p.symbol)).map((p: any) => p.symbol);
    const violations = picks.flatMap((p: any) => inventedNumbers(`${p.thesis || ""} ${p.risk || ""}`, String(bySym.get(p.symbol) || "")).map((n) => `${p.symbol}:${n}`));
    const badConv = picks.filter((p: any) => !["high", "medium", "low"].includes(p.conviction)).length;
    const note = `picks ${picks.length}/${PICK} · alien-symbols ${alien.length}${alien.length ? ` (${alien.join(",")})` : ""} · invented-numbers ${violations.length}${violations.length ? ` (${violations.slice(0, 4).join(", ")}${violations.length > 4 ? "…" : ""})` : ""} · bad-conviction ${badConv}`;
    console.log(`  ${short(model).padEnd(24)} ${out ? note : "FAILED"}  ${(lat[model]?.at(-1)! / 1000).toFixed(1)}s`);
    outs.push({ model, raw: out, text: picks.map((p: any) => `${p.symbol} [${p.conviction}${p.trap ? ", TRAP" : ""}]\n  thesis: ${p.thesis}\n  risk: ${p.risk}`).join("\n") || "(no output)", violations, checkNote: note });
  }
  console.log(`  — blind panel (${JUDGES.map(short).join(", ")}) —`);
  const judged = await judgePanel(`Select the ${PICK} best options trades from code-priced candidates and write thesis/risk/trap/conviction for each. Grounding rule: no numbers beyond the candidate's own stat/event line.`, user, outs);
  return { input: user, outs, judged };
}

async function legD(): Promise<{ input: string; outs: SynthOut[]; judged: PanelResult }> {
  const MULT_LABEL: Record<string, string> = { pe: "P/E", evEbitda: "EV/EBITDA", ps: "P/S", pb: "P/B" };
  const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
  const pct = (v: number | null | undefined, d = 0) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
  const vh = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "valuation-history.json"), "utf8"));
  const snap = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "russell3000", "snapshot.json"), "utf8"));
  const ctx = new Map((snap?.stocks || []).map((s: any) => [s.symbol, s] as const));
  const cand = Object.entries(vh.names as Record<string, any>)
    .map(([sym, n]) => { const mk = n.eligible?.[0]; const st = mk ? n.multiples?.[mk] : undefined; return st && mk ? { sym, mk, st } : null; })
    .filter((x): x is { sym: string; mk: string; st: any } => x !== null)
    .filter((x) => x.st.z <= -1 && x.st.discountPct <= -15 && ctx.has(x.sym) && ((ctx.get(x.sym) as any).marketCap ?? 0) >= 1e9)
    .sort((a, b) => a.st.z - b.st.z)
    .slice(0, 14);
  const lines = cand.map(({ sym, mk, st }) => {
    const c = ctx.get(sym) as any;
    const earnDir = c.forwardPE != null && c.trailingPE != null
      ? c.forwardPE < c.trailingPE * 0.95 ? "earnings expected to GROW (fwd P/E below trailing)"
        : c.forwardPE > c.trailingPE * 1.05 ? "earnings expected to FALL (fwd P/E above trailing)" : "earnings roughly flat"
      : "earnings direction unclear";
    return `${sym} (${c.name}) · ${c.sector || "?"} · ${money(c.marketCap)} · ${MULT_LABEL[mk] || mk} ${st.current.toFixed(1)} vs 10yr median ${st.median.toFixed(1)} (z ${st.z.toFixed(1)}, ${pct(st.discountPct)}) · price 3m ${pct(c.returns?.["3m"])}, 1y ${pct(c.returns?.["1y"])}, ${pct(c.pctFromHigh)} vs 52w-high · ${earnDir}${c.dividendYield ? ` · div ${c.dividendYield.toFixed(1)}%` : ""}`;
  });
  console.log(`\n══ Leg D: valuation verdicts — ${lines.length} deepest discounts (production prompt, reasoning=high) ══`);
  const SYSTEM =
    "You are a value-investing analyst. Each name trades at a steep discount to its OWN 10-year valuation. For EACH, judge whether the cheapness is a GENUINE discount (the business is stable or improving and is simply out of favor — mean-reversion candidate) or a likely VALUE TRAP (the market is correctly pricing structural deterioration and the multiple may stay low or fall further), or MIXED (genuinely cheap but with real risks). " +
    "Lean on the supplied signals: forward-vs-trailing P/E is the market's earnings-direction view (rising earnings supports 'genuine'; falling earnings supports 'trap'); a price still making new lows / down hard over 1y suggests the market sees deterioration; a one-off recent dip with steady earnings suggests 'genuine'. Give ONE concise sentence of reasoning grounded in those signals — never invent fundamentals you weren't given. " +
    NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"verdicts":[{"symbol": string, "verdict": "genuine"|"trap"|"mixed", "reason": string}]}';
  const user = `${SCHEMA}\n\nDEEP DISCOUNTS (each with discount depth + price trend + earnings direction):\n${lines.join("\n")}`;
  const byLine = new Map(cand.map(({ sym }, i) => [sym, lines[i]]));

  const outs: SynthOut[] = [];
  for (const model of CONTENDERS) {
    const out = await timed(model, () => chatJSON<any>(SYSTEM, user, { model, maxTokens: 6000, reasoningEffort: "high" }));
    const vs = Array.isArray(out?.verdicts) ? out.verdicts : [];
    const covered = vs.filter((v: any) => byLine.has(v.symbol)).length;
    const badEnum = vs.filter((v: any) => !["genuine", "trap", "mixed"].includes(v.verdict)).length;
    const violations = vs.flatMap((v: any) => inventedNumbers(String(v.reason || ""), String(byLine.get(v.symbol) || "")).map((n) => `${v.symbol}:${n}`));
    const note = `coverage ${covered}/${lines.length} · bad-enum ${badEnum} · invented-numbers ${violations.length}${violations.length ? ` (${violations.slice(0, 4).join(", ")}${violations.length > 4 ? "…" : ""})` : ""}`;
    console.log(`  ${short(model).padEnd(24)} ${out ? note : "FAILED"}  ${(lat[model]?.at(-1)! / 1000).toFixed(1)}s`);
    outs.push({ model, raw: out, text: vs.map((v: any) => `${v.symbol}: ${v.verdict} — ${v.reason}`).join("\n") || "(no output)", violations, checkNote: note });
  }
  console.log(`  — blind panel (${JUDGES.map(short).join(", ")}) —`);
  const judged = await judgePanel("For each deeply-discounted stock, call genuine discount vs value trap vs mixed with one grounded sentence. Reasons must lean only on the supplied signals.", user, outs);
  return { input: user, outs, judged };
}

// ── per-run summary (also the entire output when RUNS=1) ─────────────────────────────────────────────
type LegAScore = Record<string, { exact: number; close: number; wrong: number; fail: number }>;
type LegBScore = Record<string, { ticker: number; price: number; size: number; n: number; fail: number }>;
type SynthRun = { input: string; outs: SynthOut[]; judged: PanelResult };

function printSummary(tag: string, a: LegAScore | null, b: LegBScore | null, c: SynthRun | null, d: SynthRun | null) {
  console.log(`\n══ ${tag}SUMMARY ══`);
  if (a) { console.log(`Leg A (SSS comps vs verified gold):`); for (const [m, s] of Object.entries(a)) console.log(`  ${short(m).padEnd(26)} exact ${s.exact} · close(≤0.3) ${s.close} · wrong ${s.wrong} · fail ${s.fail}`); }
  if (b) { console.log(`Leg B (IPO fields vs stored refs):`); for (const [m, s] of Object.entries(b)) console.log(`  ${short(m).padEnd(26)} ticker ${s.ticker}/${s.n} · price ${s.price}/${s.n} · size(±15%) ${s.size}/${s.n} · classify-fail ${s.fail}`); }
  for (const [label, leg] of [["Leg C (trade narration)", c], ["Leg D (valuation verdicts)", d]] as const) {
    if (!leg) continue;
    console.log(`${label} — code checks + blind panel (${JUDGES.length} judges × 30 max each):`);
    for (const o of leg.outs) {
      const js = leg.judged.scores[o.model] || [];
      const panel = js.length ? `panel ${js.reduce((x, y) => x + y, 0)}/${js.length * 30}` : "panel —";
      console.log(`  ${short(o.model).padEnd(26)} ${panel} · ${o.checkNote}`);
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const overlap = JUDGES.filter((j) => CONTENDERS.includes(j));
  if (overlap.length) { console.error(`⚠ judge(s) also in the race (self-scoring bias): ${overlap.join(", ")}. Set JUDGES= to out-of-race labs.`); process.exit(1); }
  console.log(`Contenders: ${CONTENDERS.join("  vs  ")}   ·   judges: ${JUDGES.map(short).join(", ")}${RUNS > 1 ? `\nRUNS=${RUNS} — repeating every leg and aggregating (de-noises the blind panel)` : ""}`);
  const usageBefore = await fsp.readFile(path.join(process.cwd(), "data", "llm-usage.json"), "utf8").then((s) => JSON.parse(s).byModel ?? {}).catch(() => ({}));

  const aRuns: LegAScore[] = [], bRuns: LegBScore[] = [], cRuns: SynthRun[] = [], dRuns: SynthRun[] = [];
  for (let run = 1; run <= RUNS; run++) {
    if (RUNS > 1) console.log(`\n╔══════════════ RUN ${run}/${RUNS} ══════════════╗`);
    const a = LEGS.includes("a") ? await legA() : null;
    const b = LEGS.includes("b") ? await legB() : null;
    const c = LEGS.includes("c") ? await legC() : null;
    const d = LEGS.includes("d") ? await legD() : null;
    printSummary(RUNS > 1 ? `RUN ${run}/${RUNS} ` : "", a, b, c, d);
    if (a) aRuns.push(a);
    if (b) bRuns.push(b);
    if (c) cRuns.push(c);
    if (d) dRuns.push(d);
  }

  if (RUNS > 1) {
    console.log(`\n╔══════════════ AGGREGATE across ${RUNS} runs ══════════════╗`);
    if (aRuns.length) {
      console.log(`Leg A (SSS comps) — summed over ${aRuns.length} runs:`);
      for (const m of CONTENDERS) {
        const s = aRuns.reduce((x, r) => ({ exact: x.exact + (r[m]?.exact || 0), close: x.close + (r[m]?.close || 0), wrong: x.wrong + (r[m]?.wrong || 0), fail: x.fail + (r[m]?.fail || 0) }), { exact: 0, close: 0, wrong: 0, fail: 0 });
        console.log(`  ${short(m).padEnd(26)} exact ${s.exact} · close ${s.close} · wrong ${s.wrong} · fail ${s.fail}`);
      }
    }
    if (bRuns.length) {
      console.log(`Leg B (IPO classify) — summed over ${bRuns.length} runs:`);
      for (const m of CONTENDERS) {
        const s = bRuns.reduce((x, r) => ({ ticker: x.ticker + (r[m]?.ticker || 0), price: x.price + (r[m]?.price || 0), size: x.size + (r[m]?.size || 0), n: x.n + (r[m]?.n || 0), fail: x.fail + (r[m]?.fail || 0) }), { ticker: 0, price: 0, size: 0, n: 0, fail: 0 });
        console.log(`  ${short(m).padEnd(26)} ticker ${s.ticker}/${s.n} · price ${s.price}/${s.n} · size ${s.size}/${s.n} · classify-fail ${s.fail}`);
      }
    }
    // The headline de-noise: across every run×judge, who was voted BEST, and the mean panel total.
    for (const [label, runs] of [["Leg C (trade narration)", cRuns], ["Leg D (valuation verdicts)", dRuns]] as const) {
      if (!runs.length) continue;
      const votes = runs.flatMap((r) => r.judged.bests); // one BEST vote per judge per run
      console.log(`${label} — ${runs.length} runs × ${JUDGES.length} judges = ${votes.length} blind best-votes:`);
      const ranked = CONTENDERS.map((m) => {
        const totals = runs.flatMap((r) => r.judged.scores[m] || []);
        const mean = totals.length ? totals.reduce((x, y) => x + y, 0) / totals.length : 0;
        const wins = votes.filter((v) => v === m).length;
        const invented = runs.reduce((acc, r) => acc + (r.outs.find((o) => o.model === m)?.violations.length || 0), 0);
        return { m, mean, wins, invented, n: totals.length };
      }).sort((x, y) => y.wins - x.wins || y.mean - x.mean);
      for (const r of ranked) console.log(`  ${short(r.m).padEnd(26)} best-votes ${r.wins}/${votes.length} · panel-mean ${r.mean.toFixed(1)}/30 (n=${r.n}) · invented-# ${r.invented} total`);
    }
  }

  console.log(`\nLatency (all calls${RUNS > 1 ? `, ${RUNS} runs` : ""}):`);
  for (const m of [...CONTENDERS, ...JUDGES]) if (lat[m]?.length) console.log(`  ${short(m).padEnd(26)} n=${lat[m].length} · ${stats(lat[m])}`);

  flushSync();
  const usageAfter = await fsp.readFile(path.join(process.cwd(), "data", "llm-usage.json"), "utf8").then((s) => JSON.parse(s).byModel ?? {}).catch(() => ({}));
  console.log(`Cost (llm-usage byModel delta${RUNS > 1 ? `, all ${RUNS} runs` : " this run"}):`);
  for (const m of [...CONTENDERS, ...JUDGES]) {
    const d0 = usageBefore[m]?.estUsd ?? 0, d1 = usageAfter[m]?.estUsd ?? 0;
    if (d1 > d0) console.log(`  ${short(m).padEnd(26)} $${(d1 - d0).toFixed(3)}`);
  }
})();
