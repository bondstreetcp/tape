/**
 * Value chains — hand-written, ORDERED supply-chain layers (upstream → downstream) with
 * membership and per-layer economics computed nightly from the company cache (/chains).
 *
 * The definitions below are the human input: a diffable const in the PEER_COHORTS spirit — every
 * layer states its seeds and the exact description anchors that may expand it, so membership is
 * reviewable line by line. Code refuses ambiguity: an anchor-matched name that fits 2+ layers of
 * the same chain is DROPPED and counted, never guessed into a rung. No lead-lag or "bottleneck"
 * claims — the measured lead-lag leg was killed by its own walk-forward gate (eval-lead-lag.ts);
 * what ships is sourced economics per layer with explicit n.
 */

export interface ChainLayerDef {
  key: string;
  name: string;
  /** One line on what this layer sells into the next — rendered under the layer title. */
  role: string;
  seeds: string[];
  /** Exact Yahoo profile.industry values admitted wholesale — the precise route where the
   *  taxonomy maps 1:1 to a layer (verified strings, e.g. "Oil & Gas E&P"). */
  industries?: string[];
  /** Lowercase phrases matched against profile.description — only for niche layers the industry
   *  taxonomy is too coarse for; [] = seeds-only. (First cut proved broad anchors pull freight
   *  forwarders into "airline" and Ecolab into "petrochemical" — prefer industries.) */
  anchors: string[];
  /** Yahoo profile.sector values an ANCHOR match must belong to; seeds and industries bypass. */
  sectors?: string[];
  /** Description phrases that VETO a non-seed admission — for vendor-taxonomy warts (Yahoo files
   *  spot-rate tanker owners under "Oil & Gas Midstream"; their economics would pollute a
   *  fee-based pipeline layer). Seeds are exempt: a hand-picked name stays. */
  exclude?: string[];
}

export interface ChainDef {
  key: string;
  name: string;
  blurb: string;
  layers: ChainLayerDef[];
}

export const VALUE_CHAINS: ChainDef[] = [
  {
    key: "ai-datacenter",
    name: "AI Datacenter",
    blurb: "From chip design software to the hyperscalers that rent the compute.",
    layers: [
      { key: "eda", name: "Chip design & IP", role: "Design tools and licensed cores every chipmaker below depends on", seeds: ["SNPS", "CDNS", "ARM"], anchors: ["electronic design automation"], sectors: ["Technology"] },
      { key: "semicap", name: "Fab equipment & materials", role: "The machines and consumables that build the wafers", seeds: ["ASML", "AMAT", "LRCX", "KLAC", "TER", "ENTG", "ONTO", "ACMR"], anchors: ["wafer fabrication equipment", "semiconductor manufacturing equipment"], sectors: ["Technology"] },
      { key: "chips", name: "Foundry, logic & accelerators", role: "The processors and networking silicon the racks are built around", seeds: ["TSM", "NVDA", "AMD", "AVGO", "MRVL", "INTC", "GFS", "MPWR"], anchors: [] },
      { key: "memory", name: "Memory & storage", role: "HBM, DRAM and flash — the capacity constraint beside the GPU", seeds: ["MU", "WDC", "STX"], anchors: [] },
      { key: "systems", name: "Servers, networking & optics", role: "Racks, switches and interconnect that turn silicon into clusters", seeds: ["SMCI", "DELL", "HPE", "ANET", "CSCO", "CIEN", "COHR", "LITE"], anchors: [] },
      { key: "dc-infra", name: "Power, cooling & shells", role: "Electrical gear, thermal management and the buildings themselves", seeds: ["VRT", "ETN", "PWR", "MOD", "NVT", "EQIX", "DLR"], anchors: [] },
      { key: "hyperscalers", name: "Hyperscalers & AI platforms", role: "The demand end — capex budgets that fund every layer above", seeds: ["MSFT", "AMZN", "GOOGL", "META", "ORCL", "CRWV"], anchors: [], sectors: ["Technology", "Communication Services", "Consumer Cyclical"] },
    ],
  },
  {
    key: "housing",
    name: "US Housing",
    blurb: "Aggregates and building products through builders, distribution, retail and mortgage finance.",
    layers: [
      { key: "materials", name: "Materials & building products", role: "Aggregates, insulation, roofing and interiors sold to builders and pros", seeds: ["MLM", "VMC", "EXP", "BLDR", "MAS", "MHK", "OC", "AWI", "TREX"], industries: ["Building Products & Equipment", "Building Materials", "Lumber & Wood Production"], anchors: [] },
      { key: "builders", name: "Homebuilders", role: "Land, entitlement and vertical construction — the volume decision", seeds: ["DHI", "LEN", "PHM", "NVR", "TOL", "KBH", "TMHC", "MTH", "GRBK"], industries: ["Residential Construction"], anchors: [] },
      { key: "distribution", name: "Distribution & installers", role: "Pro-channel distribution and installed products between factory and site", seeds: ["POOL", "SITE", "FERG", "WSO", "GMS", "BLD", "IBP"], anchors: [] },
      { key: "retail", name: "Home improvement retail", role: "The repair-and-remodel demand signal, ahead of new construction", seeds: ["HD", "LOW", "FND", "WSM"], anchors: [] },
      { key: "finance", name: "Mortgage & title", role: "Origination, insurance and closing — where rate moves bite first", seeds: ["RKT", "UWMC", "PFSI", "FNF", "FAF", "ESNT", "MTG", "RDN"], anchors: ["mortgage insurance"], sectors: ["Financial Services"] },
    ],
  },
  {
    key: "aero",
    name: "Aerospace",
    blurb: "Specialty metals through components and airframers to the airlines and the aftermarket.",
    layers: [
      { key: "materials", name: "Alloys, castings & forgings", role: "Flight-critical metallurgy with decade-long qualification moats", seeds: ["ATI", "CRS", "HWM", "KALU"], anchors: [], sectors: ["Basic Materials", "Industrials"] },
      { key: "components", name: "Systems & components", role: "Actuation, avionics and engine content sold to the primes", seeds: ["TDG", "HEI", "RBC", "WWD", "CW", "DCO", "GE"], anchors: ["aircraft components"], sectors: ["Industrials"] },
      { key: "primes", name: "Airframers & defense primes", role: "The integrators whose build rates set the whole chain's volume", seeds: ["BA", "LMT", "NOC", "GD", "RTX", "LHX", "TXT"], anchors: [], sectors: ["Industrials"] },
      { key: "operators", name: "Airlines & lessors", role: "The demand end — traffic and fleet plans that pull deliveries", seeds: ["DAL", "UAL", "LUV", "AAL", "ALK", "AL"], industries: ["Airlines"], anchors: [] },
      { key: "aftermarket", name: "MRO & aftermarket", role: "Spares and repairs priced off the installed base, not build rates", seeds: ["HEI", "TDG", "AIR"], anchors: [], sectors: ["Industrials"] },
    ],
  },
  {
    key: "oil-gas",
    name: "Oil & Gas",
    blurb: "Services and equipment through E&P, pipelines, refining and petrochemicals.",
    layers: [
      { key: "services", name: "Services & equipment", role: "Drilling, completion and hardware — leveraged to producer capex", seeds: ["SLB", "HAL", "BKR", "NOV", "FTI", "WHD", "LBRT"], industries: ["Oil & Gas Equipment & Services", "Oil & Gas Drilling"], anchors: [] },
      { key: "upstream", name: "Exploration & production", role: "The barrels themselves — price takers who set everyone else's volume", seeds: ["XOM", "CVX", "COP", "EOG", "FANG", "DVN", "OXY", "APA", "CTRA", "PR"], industries: ["Oil & Gas E&P"], anchors: [] },
      { key: "midstream", name: "Midstream & pipelines", role: "Fee-based gathering, processing and transport between wellhead and market", seeds: ["WMB", "KMI", "OKE", "ET", "EPD", "TRGP"], industries: ["Oil & Gas Midstream"], anchors: [], exclude: ["tanker", "vessel", "carrier"] },
      { key: "downstream", name: "Refining & marketing", role: "Crack spreads — crude in, products out", seeds: ["VLO", "MPC", "PSX", "DK", "PBF", "DINO"], industries: ["Oil & Gas Refining & Marketing"], anchors: [] },
      { key: "chemicals", name: "Petrochemicals", role: "Feedstock consumers — cheap gas is their margin", seeds: ["LYB", "DOW", "WLK", "OLN", "HUN"], anchors: [] },
    ],
  },
  {
    key: "grid",
    name: "Grid & Power",
    blurb: "Electrical equipment through the contractors, generators and regulated utilities electrifying the grid.",
    layers: [
      { key: "equipment", name: "T&D equipment", role: "Transformers, switchgear and enclosures — the multi-year backlog layer", seeds: ["ETN", "HUBB", "GEV", "NVT", "ATKR", "POWL", "AZZ"], anchors: ["switchgear"], sectors: ["Industrials"] },
      { key: "epc", name: "Electrical contractors & EPC", role: "The labor that turns utility capex budgets into energized assets", seeds: ["PWR", "MTZ", "PRIM", "EME", "FIX", "IESC"], anchors: ["electrical construction"], sectors: ["Industrials"] },
      { key: "generation", name: "Independent power & nuclear", role: "Merchant megawatts — the scarcity trade when demand outruns supply", seeds: ["VST", "CEG", "NRG", "TLN"], industries: ["Utilities - Independent Power Producers"], anchors: [] },
      { key: "utilities", name: "Regulated utilities", role: "Rate-based demand — the steady buyer of everything above", seeds: ["NEE", "SO", "DUK", "D", "AEP", "EXC", "XEL", "ED"], industries: ["Utilities - Regulated Electric"], anchors: [] },
    ],
  },
  {
    key: "drugs",
    name: "Drug Supply Chain",
    blurb: "Research tools through CDMOs and pharma to distributors, pharmacies and payers.",
    layers: [
      { key: "tools", name: "Research tools & instruments", role: "Picks and shovels for discovery — funded by biopharma R&D budgets", seeds: ["TMO", "DHR", "A", "WAT", "BRKR", "RVTY", "ILMN", "MTD"], anchors: [] },
      { key: "cdmo", name: "CDMOs & clinical trials", role: "Outsourced development, manufacturing and trial execution", seeds: ["CRL", "MEDP", "ICLR", "IQV", "WST", "FTRE"], anchors: [] },
      { key: "pharma", name: "Pharma & biotech", role: "The IP owners — approvals here pull volume through every layer below", seeds: ["LLY", "MRK", "PFE", "ABBV", "BMY", "AMGN", "GILD", "VRTX", "REGN"], anchors: [], sectors: ["Healthcare"] },
      { key: "distribution", name: "Drug distribution", role: "Razor-thin-margin logistics moving nearly every pill in America", seeds: ["MCK", "COR", "CAH"], anchors: ["pharmaceutical distribution"], sectors: ["Healthcare"] },
      { key: "payers", name: "Pharmacies, PBMs & payers", role: "The demand end — formularies and reimbursement set everyone's price", seeds: ["CVS", "UNH", "CI", "ELV", "HUM"], anchors: [], sectors: ["Healthcare"] },
    ],
  },
];

/* ---------- computed snapshot types (data/value-chains.json) ---------- */

export interface ChainMember {
  symbol: string;
  name: string | null;
  source: "seed" | "industry" | "anchor";
  /** The industry value or anchor phrase that admitted an expansion member — every row states its gate. */
  via?: string;
  mcap: number | null;
  /** Own TTM gross margin (fraction) — lets the UI show dispersion inside a layer. */
  gm: number | null;
  /** The rest of the per-company economics the layer medians are computed FROM — carried so the UI can
   *  show the constituents, not just the aggregate (the 2026-08-16 "show each company, not the median"
   *  ask). Same units/definitions as the layer stats. */
  op?: number | null; // TTM operating margin (fraction)
  roa?: number | null; // TTM return on assets (fraction)
  rg?: number | null; // TTM revenue growth YoY (fraction)
  gmYoY?: number | null; // GM change latest FY vs prior, percentage POINTS
}

export interface LayerEcon {
  n: number;
  gmMedian: number | null;
  gmN: number;
  opMedian: number | null;
  opN: number;
  roaMedian: number | null;
  roaN: number;
  rgMedian: number | null;
  rgN: number;
  /** Median change in annual gross margin, latest FY vs prior FY, in percentage POINTS. */
  gmYoYpp: number | null;
  gmYoYN: number;
  /** Market-cap Herfindahl within the layer, 0–10000. */
  hhi: number | null;
  totalMcap: number;
  /** Members with a market cap — HHI and totalMcap silently exclude the rest, so show this n. */
  mcapN: number;
}

export interface ChainLayerRow {
  key: string;
  name: string;
  role: string;
  members: ChainMember[];
  econ: LayerEcon;
  /** Seeds absent from the company cache — printed, not hidden. */
  missingSeeds: string[];
}

export interface ChainRow {
  key: string;
  name: string;
  blurb: string;
  layers: ChainLayerRow[];
  /** Anchor matches refused because they fit 2+ layers (ambiguity is a refusal). */
  ambiguous: { symbol: string; layers: string[] }[];
}

export interface ValueChainsFile {
  generatedAt: string;
  /** Honesty counters: cache files scanned / with a usable description. */
  usScanned: number;
  described: number;
  /** Total member rows across all chains/layers — the write-guard count (chains.length is a
   *  structural constant 6, so gating on it could never catch a hollow night). */
  memberRows: number;
  chains: ChainRow[];
}

/* ---------- pure math (exported for tests) ---------- */

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Herfindahl index of market-cap shares, 0–10000 (10000 = a one-name layer). */
export function hhi(mcaps: number[]): number | null {
  const pos = mcaps.filter((m) => m > 0);
  const total = pos.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return Math.round(pos.reduce((acc, m) => acc + (m / total) ** 2, 0) * 10000);
}
