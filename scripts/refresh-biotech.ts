/**
 * Builds data/biotech-catalysts.json — a clinical binary-event radar.
 *
 * 1. ClinicalTrials.gov API v2: recently-updated Phase 2/3 INDUSTRY-sponsored trials, kept to the
 *    event-y statuses (completed = readout, active-not-recruiting = enrollment done, terminated =
 *    failure). 2. GLM maps the sponsor to its public TICKER + writes a one-line catalyst read, and
 *    drops trials whose sponsor isn't a mappable public company. Ticker validated against Yahoo.
 *
 * Forward-accumulating; only new trials hit the LLM. No key. Run: npm run refresh-biotech. Nightly.
 * Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { daysToReadout, type BioCatalyst, type BiotechData } from "../lib/biotech";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "biotech-catalysts.json");
const UA = "stock-chart-screener (research; jameslyeh@gmail.com)";
const DAY = 86_400_000;
const KEEP = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The statuses that carry a binary signal.
const KIND: Record<string, BioCatalyst["statusKind"]> = {
  COMPLETED: "readout",
  ACTIVE_NOT_RECRUITING: "enrolling-done",
  TERMINATED: "failed", SUSPENDED: "failed", WITHDRAWN: "failed",
};
const statusHuman = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

interface Raw { id: string; sponsor: string; drug: string; condition: string; phase: string; status: string; statusKind: BioCatalyst["statusKind"]; primaryCompletion: string | null; lastUpdate: string }

async function fetchTrials(): Promise<Raw[]> {
  const start = new Date(Date.now() - 21 * DAY).toISOString().slice(0, 10);
  const term = encodeURIComponent("AREA[Phase](PHASE2 OR PHASE3) AND AREA[LeadSponsorClass]INDUSTRY");
  const adv = encodeURIComponent(`AREA[LastUpdatePostDate]RANGE[${start},MAX]`);
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${term}&filter.advanced=${adv}&sort=LastUpdatePostDate:desc&pageSize=120`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CT.gov HTTP ${res.status}`);
  const j = await res.json();
  const out: Raw[] = [];
  for (const x of j?.studies || []) {
    const p = x.protocolSection || {};
    const status: string = p.statusModule?.overallStatus || "";
    const kind = KIND[status];
    if (!kind) continue; // keep only event-y statuses
    const phases: string[] = p.designModule?.phases || [];
    const drugs = (p.armsInterventionsModule?.interventions || []).filter((i: any) => i.type === "DRUG" || i.type === "BIOLOGICAL").map((i: any) => i.name);
    out.push({
      id: p.identificationModule?.nctId || "",
      sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || "",
      drug: (drugs[0] || p.identificationModule?.briefTitle || "").slice(0, 80),
      condition: (p.conditionsModule?.conditions || []).slice(0, 2).join(", ").slice(0, 80),
      phase: phases.map((ph) => ph.replace("PHASE", "Phase ")).join("/") || "—",
      status: statusHuman(status),
      statusKind: kind,
      primaryCompletion: p.statusModule?.primaryCompletionDateStruct?.date ? isoDate(p.statusModule.primaryCompletionDateStruct.date) : null,
      lastUpdate: p.statusModule?.lastUpdatePostDateStruct?.date ? isoDate(p.statusModule.lastUpdatePostDateStruct.date) : "",
    });
  }
  return out.filter((r) => r.id && r.sponsor);
}
function isoDate(d: string): string { const m = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/); return m ? `${m[1]}-${m[2]}-${m[3] || "01"}` : d; }

// GLM maps sponsors → tickers + writes the catalyst read, in a batch.
async function classifyBatch(rows: Raw[]): Promise<Record<string, { ticker: string; catalyst: string }>> {
  const numbered = rows.map((r, i) => `#${i} sponsor="${r.sponsor}" drug="${r.drug}" condition="${r.condition}" ${r.phase} status="${r.status}" readout=${r.primaryCompletion || "?"}`).join("\n");
  const SYSTEM =
    "You map clinical-trial sponsors to publicly-traded stock tickers for a biotech event trader, and write a one-line catalyst read. For each trial: if the SPONSOR is a publicly-traded company (US or major ADR), return its correct ticker (e.g. Vaxcyte=PCVX, Astria Therapeutics=ATXS, Novo Nordisk=NVO, Merck=MRK) and a one-line 'catalyst' = what this status change means for the stock (a Phase 3 completing = a pending topline readout; active-not-recruiting = enrollment done, readout ahead; terminated = a program failure) + the drug/indication. " +
    "If the sponsor is PRIVATE, an academic/NIH/hospital, or you can't confidently map it to a public ticker, OMIT that trial (do not guess). " + NO_ADVICE;
  const SCHEMA = 'Return ONLY JSON: {"items":[{"index":number,"ticker":string,"catalyst":string}]}';
  const out = await chatJSON<{ items: any[] }>(SYSTEM, numbered + "\n\n" + SCHEMA, { maxTokens: 1800 });
  const map: Record<string, { ticker: string; catalyst: string }> = {};
  for (const it of out?.items || []) {
    const r = rows[it?.index]; if (!r) continue;
    const ticker = String(it.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (ticker.length < 1 || ticker.length > 6) continue;
    map[r.id] = { ticker, catalyst: String(it.catalyst || "").slice(0, 240) };
  }
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

  const raw = await fetchTrials().catch((e) => { console.error("fetch failed:", (e as Error).message); return [] as Raw[]; });
  console.log(`fetched ${raw.length} event-status Phase 2/3 industry trials`);

  const prior: BiotechData = await fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: nowISO, scanned: 0, items: [] as BioCatalyst[] }));
  const known = new Set(prior.items.map((i) => i.id));
  const fresh = raw.filter((r) => !known.has(r.id));
  console.log(`${fresh.length} new to classify`);

  const extracted: Record<string, { ticker: string; catalyst: string }> = {};
  for (let i = 0; i < fresh.length; i += 12) { try { Object.assign(extracted, await classifyBatch(fresh.slice(i, i + 12))); } catch (e) { console.log(`  batch ${i} failed`); } }

  // validate the LLM's tickers against Yahoo (drop hallucinations / delisted)
  const cand = fresh.filter((r) => extracted[r.id]);
  const valid: Record<string, boolean> = {};
  await mapPool([...new Set(cand.map((r) => extracted[r.id].ticker))], 6, async (t) => { valid[t] = await validTicker(t); });

  const newItems: BioCatalyst[] = cand
    .filter((r) => valid[extracted[r.id].ticker])
    .map((r) => ({ id: r.id, ticker: extracted[r.id].ticker, company: r.sponsor, drug: r.drug, condition: r.condition, phase: r.phase, status: r.status, statusKind: r.statusKind, primaryCompletion: r.primaryCompletion, lastUpdate: r.lastUpdate, catalyst: extracted[r.id].catalyst, url: `https://clinicaltrials.gov/study/${r.id}` }));
  console.log(`→ ${newItems.length} new mappable catalysts`);

  const items = [...newItems, ...prior.items]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    // drop ancient completions (old trials getting an administrative touch, not a fresh catalyst)
    .filter((v) => { const d = daysToReadout(v.primaryCompletion); return d == null || d >= -200; })
    .sort((a, b) => Date.parse(b.lastUpdate || "0") - Date.parse(a.lastUpdate || "0")) // most-recent status change first
    .slice(0, KEEP);

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: raw.length, items } satisfies BiotechData));
  console.log(`\nwrote ${items.length} catalysts (${newItems.length} new).`);
  for (const i of items.slice(0, 10)) console.log(`  ${i.ticker.padEnd(6)} ${i.phase.padEnd(8)} ${i.statusKind.padEnd(14)} readout ${i.primaryCompletion || "?"} — ${i.catalyst.slice(0, 55)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
