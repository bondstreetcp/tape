/**
 * Nightly build of data/value-chains.json — ordered value-chain layers with membership and
 * per-layer sourced economics from the company cache (/chains).
 *
 * Pipeline: walk data/company/<SYM>.json (US-listed only), place every name into the hand-written
 * VALUE_CHAINS layers — seeds directly, non-seeds via an exact profile.industry match or a
 * description ANCHOR inside the layer's sector gate; a non-seed fitting 2+ layers of one chain is
 * REFUSED and counted, never guessed (ambiguity is a refusal). Economics are medians with explicit
 * n per stat — coverage is printed, not implied. GM YoY needs two annual rows ~1 FY apart or abstains.
 * Pure local compute (no network); names come from the universe snapshots.
 *
 * Run: npm run refresh-value-chains. FULL tier; fixed roster (6 chains) — age-only freshness.
 */
import { promises as fsp } from "fs";
import path from "path";
import {
  VALUE_CHAINS, type ChainRow, type ChainLayerRow, type ChainMember, type ValueChainsFile,
  median, hhi,
} from "../lib/valueChains";
import { writeFeedGuarded } from "../lib/feedGuard";

const DATA = path.join(process.cwd(), "data");
const COMPANY_DIR = path.join(DATA, "company");
/** Foreign listings carry an exchange suffix (0001.HK, 7203.T); US class shares use dashes. */
const FOREIGN_SUFFIX = /\.[A-Z]{1,3}$/i;
/** Two annual rows count as consecutive fiscal years only inside this window. */
const FY_GAP_DAYS: [number, number] = [330, 430];

interface CompanyRecord {
  stats?: {
    grossMargins?: number | null; operatingMargins?: number | null; returnOnAssets?: number | null;
    revenueGrowth?: number | null; marketCap?: number | null;
  } | null;
  profile?: { description?: string | null; sector?: string | null; industry?: string | null } | null;
  financials?: { annual?: { date?: string; totalRevenue?: number | null; grossProfit?: number | null; costOfRevenue?: number | null }[] | null } | null;
}

/** Latest-FY-vs-prior gross-margin change in percentage points, or null when it can't be honest. */
function gmYoYpp(rec: CompanyRecord): number | null {
  const rows = (rec.financials?.annual || [])
    .filter((r) => r?.date && (r.totalRevenue ?? 0) > 0)
    .map((r) => {
      const gp = r.grossProfit ?? (r.costOfRevenue != null ? (r.totalRevenue as number) - r.costOfRevenue : null);
      return gp == null ? null : { date: r.date as string, gm: gp / (r.totalRevenue as number) };
    })
    .filter((r): r is { date: string; gm: number } => r !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (rows.length < 2) return null;
  const gapDays = (Date.parse(rows[0].date) - Date.parse(rows[1].date)) / 86_400_000;
  // Whitelist form so an unparseable date (NaN gap) ABSTAINS instead of slipping past a blacklist.
  if (!(gapDays >= FY_GAP_DAYS[0] && gapDays <= FY_GAP_DAYS[1])) return null;
  return (rows[0].gm - rows[1].gm) * 100;
}

async function loadNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const u of ["russell3000", "sp1500", "nasdaq100", "sp500"]) {
    try {
      const snap = JSON.parse(await fsp.readFile(path.join(DATA, u, "snapshot.json"), "utf8"));
      for (const s of snap?.stocks || []) if (s?.symbol && s?.name && !map.has(s.symbol)) map.set(s.symbol, s.name);
    } catch { /* a missing snapshot only costs display names */ }
  }
  return map;
}

async function main() {
  const names = await loadNameMap();
  const files = (await fsp.readdir(COMPANY_DIR)).filter((f) => f.endsWith(".json"));
  const usSymbols = files.map((f) => f.slice(0, -5)).filter((s) => !FOREIGN_SUFFIX.test(s));

  const records = new Map<string, CompanyRecord>();
  let described = 0;
  for (const sym of usSymbols) {
    try {
      const rec = JSON.parse(await fsp.readFile(path.join(COMPANY_DIR, `${sym}.json`), "utf8")) as CompanyRecord;
      records.set(sym, rec);
      if (rec.profile?.description) described++;
    } catch { /* unreadable file = not a member; counted via usScanned - records.size */ }
  }

  const chains: ChainRow[] = [];
  for (const def of VALUE_CHAINS) {
    // Dedup by ROOT symbol so share classes can't enter twice (LEN seed + LEN-B via industry
    // double-counted Lennar's cap in the layer HHI — the share-class-root join trap).
    const root = (s: string) => s.split("-")[0];
    const seedRoots = new Set(def.layers.flatMap((l) => l.seeds.map(root)));
    // Expansion, chain-wide first so cross-layer ambiguity is visible before assignment.
    const hits = new Map<string, { layerKey: string; source: "industry" | "anchor"; via: string }[]>();
    const seenRoots = new Set<string>();
    for (const [sym, rec] of records) {
      if (seedRoots.has(root(sym))) continue;
      const desc = rec.profile?.description?.toLowerCase();
      const sector = rec.profile?.sector || "";
      const industry = rec.profile?.industry || "";
      // No description ⇒ no expansion at all: the exclude veto can't be evaluated and we refuse
      // to admit what we can't check (ambiguity is a refusal). Seeds are unaffected.
      if (!desc) continue;
      // Two dash-class listings of one company would both pass an industry gate — first root wins.
      if (seenRoots.has(root(sym))) continue;
      let admitted = false;
      for (const layer of def.layers) {
        if (layer.exclude?.some((x) => desc?.includes(x))) continue;
        let hit: { source: "industry" | "anchor"; via: string } | null = null;
        if (industry && layer.industries?.includes(industry)) hit = { source: "industry", via: industry };
        else if (desc && (!layer.sectors || layer.sectors.includes(sector))) {
          const a = layer.anchors.find((x) => desc.includes(x));
          if (a) hit = { source: "anchor", via: a };
        }
        if (hit) {
          const list = hits.get(sym) || [];
          list.push({ layerKey: layer.key, ...hit });
          hits.set(sym, list);
          admitted = true;
        }
      }
      if (admitted) seenRoots.add(root(sym));
    }
    const ambiguous = [...hits.entries()]
      .filter(([, hs]) => new Set(hs.map((h) => h.layerKey)).size > 1)
      .map(([symbol, hs]) => ({ symbol, layers: [...new Set(hs.map((h) => h.layerKey))] }));
    const ambiguousSet = new Set(ambiguous.map((a) => a.symbol));

    const layers: ChainLayerRow[] = def.layers.map((layer) => {
      const memberSyms: { symbol: string; source: "seed" | "industry" | "anchor"; via?: string }[] = [];
      for (const s of layer.seeds) if (records.has(s)) memberSyms.push({ symbol: s, source: "seed" });
      for (const [sym, hs] of hits) {
        if (ambiguousSet.has(sym)) continue;
        const hit = hs.find((h) => h.layerKey === layer.key);
        if (hit) memberSyms.push({ symbol: sym, source: hit.source, via: hit.via });
      }
      const members: ChainMember[] = memberSyms
        .map(({ symbol, source, via }) => {
          const st = records.get(symbol)?.stats;
          return {
            symbol, source, ...(via ? { via } : {}),
            name: names.get(symbol) ?? null,
            mcap: st?.marketCap ?? null,
            gm: st?.grossMargins ?? null,
          };
        })
        .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));

      const stat = (pick: (r: CompanyRecord) => number | null | undefined) =>
        members.map((m) => pick(records.get(m.symbol)!)).filter((v): v is number => typeof v === "number");
      const gms = stat((r) => r.stats?.grossMargins);
      const ops = stat((r) => r.stats?.operatingMargins);
      const roas = stat((r) => r.stats?.returnOnAssets);
      const rgs = stat((r) => r.stats?.revenueGrowth);
      const yoys = stat((r) => gmYoYpp(r));
      const mcaps = members.map((m) => m.mcap ?? 0);
      const mcapN = members.filter((m) => m.mcap != null).length;
      return {
        key: layer.key, name: layer.name, role: layer.role, members,
        missingSeeds: layer.seeds.filter((s) => !records.has(s)),
        econ: {
          n: members.length,
          gmMedian: median(gms), gmN: gms.length,
          opMedian: median(ops), opN: ops.length,
          roaMedian: median(roas), roaN: roas.length,
          rgMedian: median(rgs), rgN: rgs.length,
          gmYoYpp: median(yoys), gmYoYN: yoys.length,
          hhi: hhi(mcaps),
          totalMcap: mcaps.reduce((a, b) => a + b, 0),
          mcapN,
        },
      };
    });
    chains.push({ key: def.key, name: def.name, blurb: def.blurb, layers, ambiguous });
  }

  const payload: ValueChainsFile = {
    generatedAt: new Date().toISOString(),
    usScanned: usSymbols.length,
    described,
    memberRows: chains.reduce((a, c) => a + c.layers.reduce((b, l) => b + l.econ.n, 0), 0),
    chains,
  };
  const w = await writeFeedGuarded("value-chains.json", payload, {
    replacer: (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v),
  });
  if (!w.written) {
    console.error(`value-chains: WRITE BLOCKED — ${w.reason}. Keeping the prior file.`);
    process.exit(1);
  }
  const totalMembers = chains.reduce((a, c) => a + c.layers.reduce((b, l) => b + l.econ.n, 0), 0);
  const totalExpanded = chains.reduce((a, c) => a + c.layers.reduce((b, l) => b + l.members.filter((m) => m.source !== "seed").length, 0), 0);
  const totalAmbig = chains.reduce((a, c) => a + c.ambiguous.length, 0);
  const totalMissing = chains.reduce((a, c) => a + c.layers.reduce((b, l) => b + l.missingSeeds.length, 0), 0);
  console.log(
    `value-chains: ${chains.length} chains · ${totalMembers} member rows (${totalExpanded} expanded) · ` +
    `${totalAmbig} ambiguous refused · ${totalMissing} seeds missing from cache · scanned ${usSymbols.length} US names (${described} described) [${w.reason}]`,
  );
}

main().catch((e) => { console.error("refresh-value-chains failed:", e); process.exit(1); });
