/**
 * Fundamental-forensics board — universe-wide earnings-quality / red-flag scores, computed ENTIRELY
 * from the cached quarterly fundamentals panel (data/valuation-panel.json, built by the frames
 * migration). ZERO network: this is a compute-over-owned-data job — the NAS's sweet spot. For every
 * name with enough panel history it emits Beneish M (manipulation), Altman Z (distress), Piotroski F
 * (strength) and Sloan accruals (quality); a missing input yields a null score, never a wrong line.
 *
 * Math lives in lib/forensics.ts (pure, unit-tested). Meta (name/sector/marketCap/etf) comes from the
 * same US snapshot union the panel is built over. Writes data/forensics.json via writeFeedGuarded so a
 * degenerate run degrades to STALE, never EMPTY.
 */
import { promises as fs } from "fs";
import path from "path";
import { computeForensics, type ForensicRow, type ForensicsData, type PQ } from "../lib/forensics";
import { writeFeedGuarded } from "../lib/feedGuard";
import type { Snapshot } from "../lib/types";

const DATA = path.join(process.cwd(), "data");
const PANEL = path.join(DATA, "valuation-panel.json");

// Broadest-first union (russell3000 is the superset); first snapshot wins per symbol. Matches the set
// refresh-valuation-history builds the panel over, so every panel name can find its meta.
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "sp500", "nasdaq100"] as const;

interface Meta { symbol: string; name: string; sector: string; marketCap: number; etf: string }
interface PanelEntry { fetchedAt: string; seenEnd: string | null; q: PQ[] }
interface Panel { generatedAt: string; bySymbol: Record<string, PanelEntry> }

async function main() {
  // Meta from the US snapshot union.
  const meta = new Map<string, Meta>();
  for (const u of US_UNIVERSES) {
    let snap: Snapshot | null = null;
    try { snap = JSON.parse(await fs.readFile(path.join(DATA, u, "snapshot.json"), "utf8")) as Snapshot; } catch { continue; }
    for (const s of snap.stocks ?? []) {
      if (s.symbol && s.marketCap && s.sector && !meta.has(s.symbol)) {
        meta.set(s.symbol, { symbol: s.symbol, name: s.name, sector: s.sector, marketCap: s.marketCap, etf: s.etf });
      }
    }
  }
  if (!meta.size) { console.error("forensics: no readable US snapshots — keeping the prior forensics.json (degrade to STALE)."); process.exit(1); }

  // The panel is internal state; if it's unreadable there's nothing to compute — keep the prior board.
  let panel: Panel;
  try { panel = JSON.parse(await fs.readFile(PANEL, "utf8")) as Panel; }
  catch { console.error("forensics: valuation-panel.json unreadable — keeping the prior forensics.json."); process.exit(1); }

  const symbols = Object.keys(panel.bySymbol);
  const rows: ForensicRow[] = [];
  let noMeta = 0, tooThin = 0;
  for (const sym of symbols) {
    const m = meta.get(sym);
    if (!m) { noMeta++; continue; }
    const q = panel.bySymbol[sym]?.q;
    if (!Array.isArray(q) || q.length < 4) { tooThin++; continue; }
    const row = computeForensics(m, q);
    if (row) rows.push(row);
  }

  // Default order = most-actionable first: names carrying red flags on top, then most manipulation-like
  // (higher Beneish M), nulls last. The UI offers per-column sorting on top of this.
  rows.sort((a, b) =>
    b.flags.length - a.flags.length ||
    (b.mScore ?? -Infinity) - (a.mScore ?? -Infinity) ||
    (b.accruals ?? -Infinity) - (a.accruals ?? -Infinity),
  );

  console.log(`forensics: ${rows.length} rows from ${symbols.length} panel names (${noMeta} no-meta, ${tooThin} <4 quarters)`);
  const counts = {
    beneish: rows.filter((r) => r.mScore != null).length,
    altman: rows.filter((r) => r.zScore != null).length,
    piotroski: rows.filter((r) => r.fScore != null).length,
    accruals: rows.filter((r) => r.accruals != null).length,
  };
  console.log(`  computed: M=${counts.beneish} Z=${counts.altman} F=${counts.piotroski} accr=${counts.accruals}`);
  const flagged = rows.filter((r) => r.flags.length);
  console.log(`  ${flagged.length} names carry ≥1 red flag`);
  for (const r of flagged.slice(0, 10)) {
    console.log(`  ${r.symbol.padEnd(6)} M=${r.mScore ?? "—"}(${r.mFlag ?? "—"}) Z=${r.zScore ?? "—"}(${r.zZone ?? "—"}) F=${r.fScore ?? "—"} accr=${r.accruals ?? "—"}  [${r.flags.join("; ")}]`);
  }

  // Degrade to STALE, never EMPTY — belt-and-suspenders over the feed floor, which only guards BELOW
  // minCount. If this run built far fewer rows than a healthy prior board, something upstream thinned
  // (snapshots half-loaded, panel partially wiped) — keep the prior file rather than publish a
  // collapsed board. Growth is always fine (the nightly backfill ramp lifts the count freely); only a
  // >40% collapse vs a ≥100-row prior is blocked.
  let priorRows = 0;
  try { priorRows = (JSON.parse(await fs.readFile(path.join(DATA, "forensics.json"), "utf8")) as ForensicsData).rows?.length ?? 0; } catch { priorRows = 0; }
  if (priorRows >= 100 && rows.length < priorRows * 0.6) {
    console.error(`forensics: built ${rows.length} rows but the prior board had ${priorRows} — a >40% collapse; keeping the prior file (degrade to STALE, never EMPTY).`);
    process.exit(1);
  }

  const data: ForensicsData = {
    generatedAt: new Date().toISOString(),
    universe: "Russell 3000",
    scanned: symbols.length,
    rows,
  };

  const w = await writeFeedGuarded("forensics.json", data);
  if (!w.written) {
    console.error(`forensics: WRITE BLOCKED — ${w.reason}. Built ${rows.length} rows; keeping the prior board (degrade to STALE, never EMPTY).`);
    process.exit(1);
  }
  console.log(`forensics: wrote ${rows.length} rows → data/forensics.json [${w.reason}]`);
}

main().catch((e) => { console.error("forensics:", String(e?.message || e)); process.exit(1); });
