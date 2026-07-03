/**
 * Builds data/policy.json — the Policy & Contracts signal feed.
 *
 * 1. Federal Register API: recent RULES → GLM keeps the market-relevant ones and names the affected
 *    public companies + impact direction (a Boeing FAA airworthiness directive → BA; a drug-pricing
 *    rule → the big pharma names). 2. USAspending API: recent large CONTRACT awards → GLM maps the
 *    winner to its public ticker (drops national labs / private LLCs). Tickers validated vs Yahoo.
 *
 * Forward-accumulating; only new items hit the LLM. Free, no key. Run: npm run refresh-policy. Nightly.
 * A policy signal, not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import type { AffectedTicker, Impact, PolicyData, PolicyItem } from "../lib/policy";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "policy.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const DAY = 86_400_000;
const KEEP = 200;

interface RawRule { id: string; date: string; title: string; agency: string; abstract: string; url: string }
interface RawContract { id: string; date: string; recipient: string; amount: number; agency: string; desc: string; url: string }

async function fetchRules(): Promise<RawRule[]> {
  const f = ["title", "abstract", "agencies", "publication_date", "html_url", "document_number"].map((x) => `fields[]=${x}`).join("&");
  const url = `https://www.federalregister.gov/api/v1/documents.json?conditions[type][]=RULE&conditions[significant]=1&per_page=40&order=newest&${f}`;
  const res = await fetch(encodeURI(url), { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const j = await res.json();
  return (j?.results || []).map((r: any) => ({ id: `fr-${r.document_number}`, date: (r.publication_date || "") + "T12:00:00Z", title: r.title || "", agency: (r.agencies || []).map((a: any) => a.name).join(", "), abstract: r.abstract || "", url: r.html_url || "" }));
}
async function fetchContracts(): Promise<RawContract[]> {
  const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const body = { filters: { award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: start, end_date: end }] }, fields: ["Recipient Name", "Award Amount", "Awarding Agency", "Description", "generated_internal_id"], sort: "Award Amount", order: "desc", limit: 100 };
  const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(body) });
  if (!res.ok) return [];
  const j = await res.json();
  return (j?.results || []).filter((r: any) => (r["Award Amount"] || 0) >= 5e7).map((r: any) => ({ id: `us-${r.generated_internal_id}`, date: end + "T12:00:00Z", recipient: r["Recipient Name"] || "", amount: r["Award Amount"] || 0, agency: r["Awarding Agency"] || "", desc: (r["Description"] || "").slice(0, 120), url: r.generated_internal_id ? `https://www.usaspending.gov/award/${r.generated_internal_id}` : "https://www.usaspending.gov" }));
}

const imp = (x: any): Impact => (["positive", "negative", "mixed"].includes(x) ? x : "mixed");
function cleanTickers(arr: any): AffectedTicker[] {
  return (Array.isArray(arr) ? arr : []).map((t) => ({ ticker: String(t?.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 6), impact: imp(t?.impact) })).filter((t) => t.ticker.length >= 1);
}

async function classifyRules(rows: RawRule[]): Promise<Record<string, { tickers: AffectedTicker[]; summary: string }>> {
  const numbered = rows.map((r, i) => `#${i} agency="${r.agency}" title="${r.title}" abstract="${r.abstract.slice(0, 300)}"`).join("\n\n");
  const SYSTEM =
    "You screen new US Federal Register RULES for an equity investor. Keep ONLY rules that materially affect a specific publicly-traded company or a clearly-identifiable set of them (e.g. an FAA airworthiness directive on Boeing → BA; a CMS drug-pricing rule → big pharma LLY/PFE/MRK; an EPA emissions rule → autos/utilities; an FTC/DOJ action). For each kept rule return its index, the affected public tickers with an impact each (positive/negative/mixed for the stock), and a one-line summary of the rule + why it matters. " +
    "OMIT purely administrative/procedural rules and anything with no identifiable public-company impact. Do not force a ticker if there's no real one. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"items":[{"index":number,"tickers":[{"ticker":string,"impact":"positive"|"negative"|"mixed"}],"summary":string}]}';
  const out = await chatJSON<{ items: any[] }>(SYSTEM, numbered + "\n\n" + SCHEMA, { maxTokens: 2000 });
  const map: Record<string, { tickers: AffectedTicker[]; summary: string }> = {};
  for (const it of out?.items || []) { const r = rows[it?.index]; if (!r) continue; const tickers = cleanTickers(it.tickers); if (!tickers.length) continue; map[r.id] = { tickers, summary: String(it.summary || "").slice(0, 300) }; }
  return map;
}
async function classifyContracts(rows: RawContract[]): Promise<Record<string, { ticker: string; summary: string }>> {
  const numbered = rows.map((r, i) => `#${i} recipient="${r.recipient}" amount=$${Math.round(r.amount).toLocaleString()} agency="${r.agency}" desc="${r.desc}"`).join("\n");
  const SYSTEM =
    "You map US government contract winners to publicly-traded stock tickers for an investor. For each award, if the RECIPIENT is a publicly-traded company (or a clearly-owned subsidiary — e.g. Sikorsky→LMT, Raytheon→RTX, Pratt & Whitney→RTX), return its correct ticker and a one-line summary (what they won + for whom). " +
    "OMIT national labs, universities, nonprofits (Battelle, UT-Battelle, Triad, Leidos-run FFRDCs run as LLCs), private companies, and anything you can't confidently map to a public ticker. Do not guess. " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"items":[{"index":number,"ticker":string,"summary":string}]}';
  const out = await chatJSON<{ items: any[] }>(SYSTEM, numbered + "\n\n" + SCHEMA, { maxTokens: 1600 });
  const map: Record<string, { ticker: string; summary: string }> = {};
  for (const it of out?.items || []) { const r = rows[it?.index]; if (!r) continue; const ticker = String(it.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 6); if (ticker.length < 1) continue; map[r.id] = { ticker, summary: String(it.summary || "").slice(0, 300) }; }
  return map;
}

async function validTicker(sym: string): Promise<boolean> {
  try { const ch: any = await yf.chart(sym, { period1: new Date(Date.now() - 20 * DAY), interval: "1d" } as any, { validateResult: false }); return (ch?.quotes || []).some((q: any) => q?.close != null); } catch { return false; }
}
async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { out[i] = null as any; } } }));
  return out;
}

async function main() {
  const nowISO = new Date().toISOString();
  if (!(await llmConfigured())) { console.log("LLM not configured — skipping."); return; }

  const [rules, contracts] = await Promise.all([fetchRules().catch(() => []), fetchContracts().catch(() => [])]);
  console.log(`fetched ${rules.length} rules + ${contracts.length} contract awards (≥$50M)`);

  const prior: PolicyData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, items: [] as PolicyItem[] }));
  const known = new Set(prior.items.map((i) => i.id));
  const freshRules = rules.filter((r) => !known.has(r.id));
  const freshContracts = contracts.filter((r) => !known.has(r.id)).slice(0, 60);

  const ruleMap: Record<string, { tickers: AffectedTicker[]; summary: string }> = {};
  for (let i = 0; i < freshRules.length; i += 10) Object.assign(ruleMap, await classifyRules(freshRules.slice(i, i + 10)).catch(() => ({})));
  const conMap: Record<string, { ticker: string; summary: string }> = {};
  for (let i = 0; i < freshContracts.length; i += 12) Object.assign(conMap, await classifyContracts(freshContracts.slice(i, i + 12)).catch(() => ({})));

  const newRules: PolicyItem[] = freshRules.filter((r) => ruleMap[r.id]).map((r) => ({ id: r.id, date: r.date, kind: "rule", title: r.title, agency: r.agency, amount: null, recipient: null, tickers: ruleMap[r.id].tickers, summary: ruleMap[r.id].summary, url: r.url }));
  const newCons: PolicyItem[] = freshContracts.filter((r) => conMap[r.id]).map((r) => ({ id: r.id, date: r.date, kind: "contract", title: r.desc || `${r.recipient} award`, agency: r.agency, amount: r.amount, recipient: r.recipient, tickers: [{ ticker: conMap[r.id].ticker, impact: "positive" as Impact }], summary: conMap[r.id].summary, url: r.url }));
  console.log(`→ ${newRules.length} market-relevant rules + ${newCons.length} public-contractor awards`);

  // Validate NEW items' tickers only. Prior items already passed this gate — re-validating them
  // nightly meant one Yahoo blip stripped a stored ticker and deleted the item forever (the
  // Federal Register / USAspending windows have long moved past it).
  const fresh: PolicyItem[] = [...newRules, ...newCons];
  const syms = [...new Set(fresh.flatMap((m) => m.tickers.map((t) => t.ticker)))];
  const valid: Record<string, boolean> = {};
  await mapPool(syms, 6, async (s) => { valid[s] = await validTicker(s); });
  const freshValid = fresh.map((m) => ({ ...m, tickers: m.tickers.filter((t) => valid[t.ticker]) })).filter((m) => m.tickers.length);
  let merged = [...freshValid, ...prior.items].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);
  merged.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const items = merged.slice(0, KEEP);

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: rules.length + contracts.length, items } satisfies PolicyData));
  console.log(`\nwrote ${items.length} items (${newRules.length + newCons.length} new).`);
  for (const i of items.slice(0, 10)) console.log(`  ${i.date.slice(0, 10)} [${i.kind.padEnd(8)}] ${i.tickers.map((t) => t.ticker).join(",").padEnd(12)} ${i.amount ? "$" + (i.amount / 1e6).toFixed(0) + "M " : ""}${i.summary.slice(0, 55)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
