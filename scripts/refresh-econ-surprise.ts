/**
 * refresh-econ-surprise — builds the Economic Surprise Index from data we already have: consensus
 * forecasts (ForexFactory, lib/econEstimates) matched to actual prints (FRED, via the macro snapshot's
 * ReleaseData). For each release that printed with a consensus on file we standardize the surprise and
 * append it to a ledger (data/econ-surprises.json), then recompute the index as a time-decayed sum of
 * the trailing ~90 days of standardized surprises.
 *
 * The ledger ACCRETES (ForexFactory only publishes the current week, so surprises can only be captured
 * as they print) — the script reads the prior file and merges, so on the NAS the history builds up.
 * Keyless, no LLM. Refreshed on FULL (must run AFTER refresh-macro so ReleaseData.latest is fresh).
 *
 *   npx tsx scripts/refresh-econ-surprise.ts
 */
import { promises as fsp } from "fs";
import path from "path";
import { getMacroCached } from "../lib/macroData";
import { getEconEstimates, matchEstimate } from "../lib/econEstimates";
import { RELEASES } from "../lib/releases";
import { writeFeedGuarded } from "../lib/feedGuard";
import { SURPRISE_CFG, parseFFValue, standardizeSurprise, metricConsistent, surpriseIdOf, type SurpriseEvent, type EconSurpriseData } from "../lib/econSurprise";

const DAY = 86_400_000;
const t = (d: string) => new Date(d + "T00:00:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function readPrior(): Promise<EconSurpriseData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "econ-surprises.json"), "utf8");
    const d = JSON.parse(raw) as EconSurpriseData;
    return d && Array.isArray(d.events) ? d : null;
  } catch { return null; }
}

/** ESI(t) = Σ over events in (t−90d, t] of z·exp(−age/45d). A steady release cadence makes it
 *  comparable over time; positive = data mostly beating. Weekly grid from the first event to today. */
function buildIndex(events: SurpriseEvent[]): [string, number][] {
  if (!events.length) return [];
  const first = t(events[0].date);
  const now = new Date().getTime();
  const out: [string, number][] = [];
  for (let ms = first; ms <= now + DAY; ms += 7 * DAY) {
    let s = 0;
    for (const e of events) {
      const age = ms - t(e.date);
      if (age < 0 || age > 90 * DAY) continue;
      s += e.z * Math.exp(-age / (45 * DAY));
    }
    out.push([iso(ms), Math.round(s * 100) / 100]);
  }
  return out;
}

async function main() {
  const prior = await readPrior();
  const priorEvents = prior?.events ?? [];
  const seen = new Set(priorEvents.map(surpriseIdOf));
  const today = iso(Date.now());

  const [macro, ff] = await Promise.all([getMacroCached(), getEconEstimates()]);
  const releases = macro.releases ?? {};

  const fresh: SurpriseEvent[] = [];
  for (const def of RELEASES) {
    const cfg = SURPRISE_CFG[def.key];
    const rel = releases[def.key];
    if (!cfg || !rel || rel.latest == null || !rel.latestDate) continue;
    // Identity is the FRED reference/observation date (stable per print). A new one = a fresh release.
    const id = `${def.key}|${rel.latestDate}`;
    if (seen.has(id)) continue;
    // ForexFactory only carries the CURRENT week, so a just-detected print is landing ~now — match the
    // consensus against the run date, NOT the reference month (which for monthly releases is weeks earlier
    // than the release and would fall outside matchEstimate's ±7d window, silently dropping every monthly
    // surprise — only weekly claims, where reference≈release, slipped through before).
    const est = matchEstimate(def.key, today, ff);
    const consensus = parseFFValue(est?.forecast);
    if (consensus == null) continue; // no consensus on file → can't score this print yet
    if (!metricConsistent(def.transform, est?.title)) continue; // FF only had the wrong metric (y/y vs m/m)
    // ForexFactory's week includes UPCOMING releases. If the matched consensus is for a release that hasn't
    // happened yet, the print sitting in FRED is the PRIOR period — don't pair them (the new period gets
    // captured once it actually prints and FRED advances). Only score a consensus whose release day has come.
    const releaseDate = est?.dateISO ? est.dateISO.slice(0, 10) : today;
    if (releaseDate > today) continue;
    const z = standardizeSurprise(def.key, rel.latest, consensus);
    if (z == null) continue;
    fresh.push({ key: def.key, label: def.label, category: cfg.category, date: releaseDate, actual: rel.latest, consensus, unit: def.unit, z, obs: rel.latestDate });
    seen.add(id);
  }

  const events = [...priorEvents, ...fresh].sort((a, b) => t(a.date) - t(b.date));
  const index = buildIndex(events);
  const data: EconSurpriseData = {
    asOf: new Date().toISOString(),
    startedDate: prior?.startedDate || (events[0]?.date ?? new Date().toISOString().slice(0, 10)),
    events,
    index,
    latest: index.length ? index[index.length - 1][1] : null,
  };

  fresh.forEach((e) => console.log(`  + ${e.key.padEnd(9)} ${e.date} actual ${e.actual} vs cons ${e.consensus} → ${e.z > 0 ? "+" : ""}${e.z}σ`));
  const w = await writeFeedGuarded("econ-surprises.json", data);
  console.log(`refresh-econ-surprise: ${fresh.length} new, ${events.length} total, ESI ${data.latest ?? "—"} — ${w.reason}`);
  if (!w.written) { console.error("refresh-econ-surprise: kept prior file (guarded)."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-econ-surprise:", String((e as Error)?.message || e)); process.exitCode = 1; });
