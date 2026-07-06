/**
 * Builds data/biotech-catalysts.json — a clinical binary-event radar.
 *
 * 1. ClinicalTrials.gov API v2: recently-updated Phase 2/3 INDUSTRY-sponsored trials, kept to the
 *    event-y statuses (completed = readout, active-not-recruiting = enrollment done, terminated =
 *    failure). 2. GLM maps the sponsor to its public TICKER + writes a one-line catalyst read, and
 *    drops trials whose sponsor isn't a mappable public company. Ticker validated against Yahoo.
 * 3. PDUFA rows: EDGAR full-text search for "PDUFA" in fresh 8-Ks → the LLM extracts the drug,
 *    indication and FDA target action date from the press release — and the date is only kept if it
 *    literally appears in the filing text (code verifies; the model can't invent a date).
 *
 * Forward-accumulating; only new trials/filings hit the LLM. No key. Run: npm run refresh-biotech.
 * Nightly. Not advice.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { daysToReadout, dateNearAnchor, type BioCatalyst, type BiotechData } from "../lib/biotech";
import { eftsSearch, fetchFilingBodyText, edgarDocUrl, type EftsHit } from "../lib/edgarSearch";

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

// ---- PDUFA action dates from fresh 8-K press releases (EDGAR full-text search) -----------------
const PDUFA_WINDOW = 14; // days of filings scanned per run (forward-accumulating, so gaps self-heal)
const PDUFA_CAP = 25; // max filings LLM-read per run (budget cap — same pattern as the KEDM monitors)

async function extractPdufa(hit: EftsHit, text: string): Promise<BioCatalyst | null> {
  const SYSTEM =
    "You read an SEC 8-K press release from a drug company and extract its announced PDUFA date (the FDA's target action date on an NDA/BLA under review), if one is explicitly stated. " +
    'Return ONLY JSON: {"found": boolean, "drug": string, "indication": string, "date": "YYYY-MM-DD", "app": string}. ' +
    "found:false unless the text states a SPECIFIC, CURRENT/UPCOMING PDUFA (or FDA target action) date — a quarter or half-year is not a date, and a prior/superseded/historical date mentioned in passing doesn't count. drug = the product/candidate name; indication = the disease; app = the application type as stated (NDA, BLA, sNDA, sBLA…). Copy only what the text states — never infer or use outside knowledge. " +
    NO_ADVICE;
  const out = await chatJSON<{ found: boolean; drug: string; indication: string; date: string; app: string }>(
    SYSTEM, `FILING (${hit.issuer}, ${hit.date}):\n${text.slice(0, 14000)}`, { maxTokens: 260 },
  ).catch(() => null);
  if (!out?.found || !out.date || !hit.ticker) return null;
  const textLower = text.toLowerCase();
  // Code-side grounding — every displayed fact must survive a gate against the filing text:
  // 1. The date must appear verbatim NEAR the drug's name (an 8-K can carry dates for several
  //    programs — "somewhere in the text" would let the LLM pair drug A with drug B's date).
  const drug = String(out.drug || "").trim().slice(0, 80);
  if (!drug || !dateNearAnchor(out.date, textLower, [drug, drug.split(/[\s(]/)[0]])) return null;
  // 2. An announced action date is always after the filing date — anything else is a historical
  //    reference ("our prior PDUFA date of…"), not a new event.
  if (Date.parse(out.date) <= Date.parse(hit.date)) return null;
  const days = daysToReadout(out.date);
  if (days == null || days > 800) return null;
  // 3. The indication is display-only — keep it only if its distinctive words are in the filing.
  const indication = String(out.indication || "").trim().slice(0, 80);
  const condition = indication.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 5 && textLower.includes(w)) ? indication : "";
  // 4. The application type must literally appear, else fall back to the generic.
  const appRaw = String(out.app || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 14);
  const app = appRaw && textLower.includes(appRaw.toLowerCase()) ? appRaw : "NDA/BLA";
  // The catalyst line is BUILT from the gated fields — no free LLM prose reaches the UI.
  const dateHuman = new Date(out.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return {
    id: hit.accession,
    ticker: hit.ticker,
    company: hit.issuer,
    drug,
    condition,
    phase: app,
    status: "PDUFA date set",
    statusKind: "pdufa",
    primaryCompletion: out.date,
    lastUpdate: hit.date,
    catalyst: `FDA decision ahead — the ${app} for ${drug}${condition ? ` in ${condition}` : ""} has a PDUFA target action date of ${dateHuman}.`,
    url: hit.ciks[0] ? edgarDocUrl(hit.ciks[0], hit.accession, hit.doc) : "",
  };
}

async function fetchPdufa(knownIds: Set<string>, knownEvents: Set<string>): Promise<BioCatalyst[]> {
  const startdt = new Date(Date.now() - PDUFA_WINDOW * DAY).toISOString().slice(0, 10);
  const enddt = new Date().toISOString().slice(0, 10);
  const hits = await eftsSearch({ q: '"PDUFA"', forms: "8-K", startdt, enddt });
  const cand = hits.filter((h) => h.ticker && !knownIds.has(h.accession)).slice(0, PDUFA_CAP);
  console.log(`PDUFA: ${hits.length} 8-K hits, ${cand.length} new to read`);
  const out: BioCatalyst[] = [];
  let empty = 0;
  for (const hit of cand) {
    const text = await fetchFilingBodyText(hit).catch(() => "");
    if (!text) { empty++; continue; } // fetch failed — count it so an EDGAR outage isn't silent
    if (!/pdufa/i.test(text)) continue; // the term was in a doc we didn't fetch — skip rather than guess
    const item = await extractPdufa(hit, text);
    // one row per ticker+date — re-announcements of the same action date aren't new events
    const key = `${item?.ticker}|${item?.primaryCompletion}`;
    if (item && !knownEvents.has(key)) { knownEvents.add(key); out.push(item); }
    await sleep(300);
  }
  if (empty) console.warn(`  PDUFA: ${empty}/${cand.length} filing fetches came back empty${empty === cand.length ? " — EDGAR may be down, scan produced nothing" : ""}`);
  return out;
}

async function validTicker(sym: string): Promise<boolean> {
  try { const ch: any = await yf.chart(sym, { period1: new Date(Date.now() - 20 * DAY), interval: "1d" } as any, { validateResult: false }); return (ch?.quotes || []).some((q: any) => q?.close != null); } catch { return false; }
}
async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let idx = 0, errs = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { errs++; out[i] = null as any; } } }));
  if (errs) console.warn(`  mapPool: ${errs}/${items.length} tasks threw (dropped as null)`); // A9: swallowed errors must be visible
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

  // PDUFA rows ride the same feed (statusKind "pdufa"); their tickers get the same Yahoo validation.
  const knownEvents = new Set(prior.items.filter((i) => i.statusKind === "pdufa").map((i) => `${i.ticker}|${i.primaryCompletion}`));
  const pdufaRaw = await fetchPdufa(known, knownEvents).catch((e) => { console.error("PDUFA scan failed:", (e as Error).message); return [] as BioCatalyst[]; });
  const pdufaOk: Record<string, boolean> = {};
  await mapPool([...new Set(pdufaRaw.map((i) => i.ticker))], 6, async (t) => { pdufaOk[t] = await validTicker(t); });
  const pdufaNew = pdufaRaw.filter((i) => pdufaOk[i.ticker]);
  console.log(`→ ${pdufaNew.length} new PDUFA dates`);

  // An FDA extension announces a NEW date for the same drug (e.g. a 3-month CRL-cycle push) — the
  // fresh row supersedes any prior pdufa row for the same ticker+drug, else the stale date lingers.
  // Prefix match on the normalized name so a variant spelling ("PRA-1234a") still supersedes.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const freshKeys = pdufaNew.map((i) => ({ ticker: i.ticker, dk: norm(i.drug) }));
  const priorKept = prior.items.filter((i) => {
    if (i.statusKind !== "pdufa") return true;
    const dk = norm(i.drug);
    return !freshKeys.some((f) => f.ticker === i.ticker && (f.dk.startsWith(dk) || dk.startsWith(f.dk)));
  });

  const items = [...newItems, ...pdufaNew, ...priorKept]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
    // drop ancient completions (old trials getting an administrative touch, not a fresh catalyst);
    // a PDUFA row dies 30 days after the action date — once the FDA has decided, the event is over
    .filter((v) => {
      const d = daysToReadout(v.primaryCompletion);
      if (v.statusKind === "pdufa") return d != null && d >= -30;
      return d == null || d >= -200;
    })
    .sort((a, b) => Date.parse(b.lastUpdate || "0") - Date.parse(a.lastUpdate || "0")) // most-recent status change first
    .slice(0, KEEP);

  await fsp.writeFile(FILE, JSON.stringify({ generatedAt: nowISO, scanned: raw.length, items } satisfies BiotechData));
  console.log(`\nwrote ${items.length} catalysts (${newItems.length} new).`);
  for (const i of items.slice(0, 10)) console.log(`  ${i.ticker.padEnd(6)} ${i.phase.padEnd(8)} ${i.statusKind.padEnd(14)} readout ${i.primaryCompletion || "?"} — ${i.catalyst.slice(0, 55)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
