/**
 * "Real economy" alt-data — free, primary-source freight / travel / housing indicators that lead the
 * hard macro prints. CLIENT-SAFE: types + presentation helpers only (no fs), imported by
 * <RealEconomyPanel/>. The feed is built by scripts/refresh-real-economy.ts and read server-side by
 * lib/realEconomyServer.ts.
 *
 * Sources (all free, no license): FRED (fredgraph, keyless) for the monthly index series, and TSA's
 * public checkpoint-throughput page for daily air-travel demand. Hotel is a lodging-CPI PROXY, NOT STR
 * RevPAR (which is licensed) — labeled as such everywhere it renders.
 */
export type RealEcoGroup = "Activity" | "Recession watch" | "Manufacturing" | "Services" | "Freight" | "Consumer" | "Prices" | "Money & Credit" | "Labor" | "Travel" | "Housing";

export interface RealEcoSeries {
  key: string;
  label: string;
  group: RealEcoGroup;
  unit: string; // human unit for the value, e.g. "carloads/mo", "index", "k units SAAR", "$B SAAR"
  changeUnit?: "%" | "pts"; // "pts" for diffusion/index/rate levels (a point move, not a % — a % change of a survey index is meaningless)
  freq?: "M" | "W" | "Q"; // cadence — drives the short-change label ("MoM"/"WoW"/"QoQ"); default monthly
  signLevel?: boolean; // colour the LEVEL by sign (>0 green) — for diffusion/activity indices where >0 = expansion
  invert?: boolean; // invert the CHANGE colour — for lower-is-better series (jobless claims, mortgage rates)
  seriesId: string; // FRED id (provenance)
  latest: number | null;
  latestDate: string | null; // period end (YYYY-MM-DD)
  prev: number | null; // prior period (for MoM)
  yearAgo: number | null; // ~12mo prior (for YoY)
  momPct: number | null;
  yoyPct: number | null;
  history: [string, number][]; // [date, value], trimmed oldest→newest, for a sparkline
  source: string;
  note?: string; // caveat shown inline (proxy disclosures)
}

export interface TsaThroughput {
  latestDate: string | null; // most recent day (M/D/YYYY normalized to YYYY-MM-DD)
  latest: number | null; // passengers that day
  avg7: number | null; // trailing 7-day average
  prev7: number | null; // 7-day avg ~1 month earlier
  chg30dPct: number | null; // avg7 vs prev7 — near-term momentum (the page is YTD-only, so no true YoY)
  history: [string, number][]; // last ~120 days [date, passengers]
  source: string;
}

export interface RealEconomyRead {
  tldr: string; // one-line synthesis
  regime: "expanding" | "cooling" | "mixed" | "contracting"; // the overall read
  points: string[]; // 2-4 plain-English observations
  readThrough?: string[]; // sector/ticker read-throughs
  caveat?: string;
  generatedAt: string;
}

export interface RealEconomyData {
  asOf: string;
  series: RealEcoSeries[];
  tsa: TsaThroughput | null;
  read?: RealEconomyRead | null; // baked AI desk read (regenerates when a monthly series prints)
}

export const REGIME_COLOR: Record<RealEconomyRead["regime"], string> = {
  expanding: "#22c55e",
  cooling: "#f59e0b",
  mixed: "var(--text-2)",
  contracting: "#ef4444",
};

export const GROUP_ORDER: RealEcoGroup[] = ["Activity", "Recession watch", "Manufacturing", "Services", "Freight", "Consumer", "Prices", "Money & Credit", "Labor", "Travel", "Housing"];

/** Sub-labels that name the licensed print each survey group is the free stand-in for — so a reader
 *  scanning for "ISM" finds it on the header, not just buried in a tooltip. */
export const GROUP_SUBTITLE: Partial<Record<RealEcoGroup, string>> = {
  Manufacturing: "ISM-PMI proxy · regional-Fed surveys + hard output",
  Services: "ISM-Services proxy · regional-Fed surveys",
};

/** The regional-Fed survey members that compose each sector's single ISM-style proxy headline. */
export const SURVEY_COMPOSITES: { group: RealEcoGroup; key: string; label: string; note: string; members: string[] }[] = [
  { group: "Manufacturing", key: "pmi-composite", label: "Mfg composite — ISM-PMI proxy", members: ["pmi-empire", "pmi-philly", "pmi-dallas"],
    note: "Equal-weight Empire/Philly/Dallas diffusion indices — the free stand-in for the licensed ISM Manufacturing PMI. On the surveys' native scale (>0 = expansion), NOT ISM's 50-centred basis." },
  { group: "Services", key: "svc-composite", label: "Services composite — ISM proxy", members: ["svc-ny", "svc-philly", "svc-dallas"],
    note: "Equal-weight NY/Philly/Dallas Fed service-sector surveys — free stand-in for the licensed ISM Services PMI. Native survey scale (>0 = expansion)." },
];

/** Average a set of diffusion-index survey series into ONE composite (the free ISM-PMI proxy). Per date,
 *  averages the members that reported that month, requiring at least half so a late survey doesn't skew
 *  the level; latest / prev / YoY and the history spark are derived from that averaged path. Kept on the
 *  members' native 0-centred diffusion scale (>0 = expansion), NOT rescaled to ISM's 50 basis. Pure. */
export function diffusionComposite(members: RealEcoSeries[], meta: { key: string; label: string; group: RealEcoGroup; note: string }): RealEcoSeries | null {
  const usable = members.filter((m) => m.history && m.history.length);
  if (usable.length < 2) return null; // one survey isn't a composite
  const byDate = new Map<string, number[]>();
  for (const m of usable) for (const [d, v] of m.history) { const a = byDate.get(d) ?? []; a.push(v); byDate.set(d, a); }
  const need = Math.ceil(usable.length / 2);
  const hist = [...byDate.entries()]
    .filter(([, vs]) => vs.length >= need)
    .map(([d, vs]) => [d, Math.round((vs.reduce((s, x) => s + x, 0) / vs.length) * 10) / 10] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (hist.length < 2) return null;
  const latest = hist[hist.length - 1], prev = hist[hist.length - 2];
  const yearTargetMs = Date.parse(latest[0]) - 365 * 86_400_000;
  let yearAgo: [string, number] | null = null;
  for (const h of hist) { if (Date.parse(h[0]) <= yearTargetMs) yearAgo = h; else break; }
  return {
    key: meta.key, label: meta.label, group: meta.group, unit: "diffusion · avg", changeUnit: "pts", signLevel: true,
    seriesId: "", source: `Composite · equal-weight of ${usable.length} regional-Fed surveys`, note: meta.note,
    latest: latest[1], latestDate: latest[0], prev: prev[1], yearAgo: yearAgo ? yearAgo[1] : null,
    momPct: latest[1] - prev[1], yoyPct: yearAgo ? latest[1] - yearAgo[1] : null,
    history: hist.slice(-252),
  };
}

/** Compact number for display: 1,006,056 → "1.01M", 2,166,539 → "2.17M", 1239 → "1,239". */
export function fmtVal(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (/\$M/.test(unit)) return `$${(v / 1_000).toFixed(1)}B`; // construction spend is $M SAAR → show $B
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 100_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export const pctColor = (v: number | null): string => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");
export const fmtPct = (v: number | null): string => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
/** A change value with its unit — "+3.2%" for levels, "+3.2 pts" for diffusion-index surveys. */
export const fmtChange = (v: number | null, unit: "%" | "pts" = "%"): string =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}${unit === "pts" ? " pts" : "%"}`;

/** Hover explanations for each series (keyed by RealEcoSeries.key), + TSA. Presentation, not data. */
export const SERIES_TOOLTIPS: Record<string, string> = {
  // Activity (broad pulse)
  "cfnai": "Chicago Fed National Activity Index — a weighted average of 85 monthly indicators of US real activity. 0 = trend growth; positive = above-trend, negative = below-trend. The single best 'how's the real economy' number (the 3-month average smooths the noise).",
  "wei": "Weekly Economic Index (Lewis-Mertens-Stock, Dallas Fed) — a WEEKLY index of 10 daily/weekly real-activity series (retail, jobless claims, fuel, steel, electricity…), scaled to 4-quarter GDP growth. The timeliest broad read on the economy.",
  "nfci": "Chicago Fed National Financial Conditions Index — a weekly gauge of risk, credit and leverage across money, bond & equity markets. 0 = average; NEGATIVE = LOOSER (easier) conditions, positive = tighter. Financial-conditions context for the real economy.",
  // Prices / inflation (each series' LEVEL is already an annual rate — falling = disinflation)
  "core-sticky": "Sticky-Price Core CPI (Atlanta Fed) — year-over-year inflation in the prices that change infrequently (rents, services), excluding food & energy. Because sticky prices move slowly, this is a cleaner read on underlying inflation's TREND than the noisy headline. Falling = disinflation.",
  "trimmed-pce": "Trimmed-Mean PCE (Dallas Fed) — year-over-year inflation after trimming the most extreme price moves each month. The Fed's preferred robust core gauge; strips out one-off spikes to show the persistent trend. Falling = disinflation toward the 2% goal.",
  "infl-exp-1yr": "University of Michigan 1-year inflation expectations — what households expect inflation to be over the next year. Expectations are self-fulfilling (they feed wage and price setting), so the Fed watches them closely. Falling = better-anchored.",
  "breakeven-5yr": "5-year breakeven inflation rate — the market's expected average inflation over 5 years, implied by the gap between nominal Treasuries and TIPS. A real-time, market-priced inflation expectation (month-end shown). Falling = the market sees cooler inflation ahead.",
  "infl-exp-5y5y": "5-year, 5-year forward inflation rate — the market's expected inflation for the 5 years starting 5 years out. The Fed's favourite gauge of LONG-RUN inflation credibility, stripped of near-term noise (month-end shown). Well-anchored ≈ 2–2.5%.",
  "wage-growth": "Atlanta Fed Wage Growth Tracker — median hourly pay growth for the same workers year-over-year (3-month average). The wage/cost-push side of inflation: strong for workers, but persistent >~3.5% growth is hard to square with 2% price inflation.",
  // Money & Credit (the credit impulse — quantity of credit & money, distinct from the Credit tab's spreads)
  "credit-ci": "C&I loans — bank lending to businesses (Fed H.8, all commercial banks). Year-over-year growth is a core 'credit impulse': accelerating = expansion fuel; contracting = a credit squeeze that often precedes slowdowns.",
  "consumer-credit": "Total consumer credit outstanding (Fed G.19) — household borrowing (cards, auto, student). YoY growth shows whether consumers are leaning on credit; a sharp slowdown signals caution or stress.",
  "m2": "M2 money supply — cash, deposits & money-market funds. YoY growth = how fast liquidity is expanding; it went NEGATIVE in 2023 for the first time in the modern era (a sharp monetary tightening). More growth = more liquidity in the system.",
  "bank-credit": "Total bank credit (all commercial banks, H.8) — the broadest measure of bank lending (loans + securities). YoY growth is the aggregate credit impulse.",
  "lending-standards": "Senior Loan Officer Survey (SLOOS) — the NET % of banks tightening standards on business (C&I) loans. Above 0 = more banks tightening than easing (a credit headwind); below 0 = easing. A powerful LEADING signal — tightening precedes slower loan growth. Quarterly.",
  "card-delinquency": "Credit-card delinquency rate (all commercial banks) — the % of card balances past due. Rising = household financial stress building; a key consumer-health & credit-risk read. Quarterly.",
  // Labor
  "initial-claims": "Initial jobless claims — weekly new filings for unemployment insurance (Dept. of Labor). The timeliest read on the labor market turning; LOWER = healthier. Watch the 4-week trend, not any single week.",
  "continued-claims": "Continued jobless claims — people still collecting unemployment (a week lagged vs initial claims). Rising continued claims = laid-off workers taking longer to find work. LOWER = healthier.",
  "quits-rate": "JOLTS quits rate (BLS) — the % of workers who voluntarily quit each month. People quit when they're confident they can find something better, so a RISING quits rate signals a hot, worker-favorable labor market; a falling one signals caution. A cleaner confidence read than the headline jobs number.",
  "temp-help": "Temporary-help services payrolls (BLS) — the number of temp workers employed. Temps are the first hired into an upturn and the first cut ahead of a downturn, so this employment line typically TURNS BEFORE the broader payrolls number — a classic leading labor indicator. Rising = expansion ahead.",
  // Goods cycle (added into their natural groups)
  "core-capex": "Core capital-goods orders — new orders for nondefense capital goods EX-aircraft (Census). The cleanest read on business INVESTMENT demand; leads capex spending and equipment output.",
  "inventories-sales": "Total business inventories-to-sales ratio (Census) — months of inventory relative to sales. RISING = overhang (a headwind for production & freight as firms destock); falling = lean, demand outrunning stock.",
  "vehicle-sales": "Total light-vehicle sales (BEA, SAAR) — cars + light trucks sold, annualized. A big, timely read on consumer big-ticket demand and credit appetite.",
  // Housing (added)
  "new-home-sales": "New single-family homes sold, annualized (Census) — the demand side of new construction; pairs with starts/permits (supply).",
  "mortgage-30yr": "30-year fixed mortgage rate (Freddie Mac, weekly) — the primary driver of housing affordability & demand. LOWER = more supportive for housing.",
  // Recession watch
  "sahm": "Sahm Rule (real-time) — fires a recession signal when the 3-month-average unemployment rate rises 0.5pt above its 12-month low. Below 0.5 = no signal; the closer to +0.5, the nearer a downturn. One of the most reliable real-time recession triggers.",
  "recession-prob": "Smoothed U.S. recession probability — a statistical model's estimate of the odds the economy is currently in recession (Chauvet-Piger, from output/income/sales/jobs). Sits near 0% in expansions and spikes toward 100% around actual recessions.",
  "fin-stress": "St. Louis Fed Financial Stress Index — 18 market indicators (rates, credit spreads, volatility) in one gauge: 0 = average stress, >0 = elevated (risk-off), <0 = calm. A real-time read on financial-system strain.",
  "heavy-trucks": "Heavy (Class-8) truck retail sales — big-rig demand is discretionary business investment that rolls over EARLY in a slowdown, so a sharp drop is a classic recession warning. Higher = healthier freight/industrial demand.",
  // Manufacturing
  "pmi-empire": "Empire State Manufacturing Survey (NY Fed) — a diffusion index: the net % of factories reporting expansion vs contraction. >0 = expanding, <0 = contracting; the month-to-month POINT move is the signal. A free, timely stand-in for the licensed ISM PMI.",
  "pmi-philly": "Philadelphia Fed Manufacturing Survey — a diffusion index (net % of firms expanding). >0 = expanding; watch the point move. Free ISM-PMI stand-in.",
  "pmi-dallas": "Dallas Fed Manufacturing Survey — a diffusion index (net % of firms expanding). >0 = expanding; watch the point move. Free ISM-PMI stand-in.",
  "pmi-composite": "Manufacturing composite — the equal-weight average of the Empire (NY), Philadelphia and Dallas Fed manufacturing diffusion indices, one free stand-in for the licensed ISM Manufacturing PMI. >0 = the surveys net-expanding; watch the point move. On the surveys' own 0-centred scale, not ISM's 50 basis.",
  "industrial-production": "Federal Reserve Industrial Production index (2017 = 100) — the real output of US factories, mines and utilities. The core HARD measure of manufacturing output.",
  "capacity-util": "Capacity utilization (%, Federal Reserve) — how much of the economy's productive capacity is actually in use. High = tight (potential price pressure); falling = slack building.",
  // Services (the free stand-in for the licensed ISM Services — services are ~70% of the economy)
  "svc-ny": "NY Fed Business Leaders Survey — current business activity for the New York region's SERVICE firms, a diffusion index (>0 = expanding). The services counterpart to the Empire manufacturing survey. Reported not-seasonally-adjusted.",
  "svc-philly": "Philadelphia Fed Nonmanufacturing Survey — firms' own current general activity, a diffusion index (>0 = expanding). A free, timely read on services activity in the mid-Atlantic.",
  "svc-dallas": "Dallas Fed Texas Service Sector Outlook Survey — current general business activity, a diffusion index (>0 = expanding). Texas services are a large, early-reporting slice of the sector.",
  "svc-composite": "Services composite — the equal-weight average of the NY, Philadelphia and Dallas Fed service-sector surveys, one free stand-in for the licensed ISM Services PMI. >0 = net-expanding. Services are ~70% of the economy; on the surveys' native scale, not ISM's 50 basis.",
  "chicago-cfsec": "Chicago Fed Survey of Economic Conditions (CFSEC) — a standardized activity index for the Chicago Fed's district (0 = trend growth; + above, − below). A FREE Chicago read — distinct from the licensed MNI/ISM-Chicago PMI, which isn't publicly redistributable.",
  // Freight
  "rail-carloads": "US rail carloads (AAR, seasonally adjusted) — bulk goods moved by rail: coal, chemicals, grain, autos, metals. A read on heavy-industry & commodity freight demand.",
  "rail-intermodal": "US rail intermodal units (AAR, SA) — containers & trailers on rail, mostly consumer & imported goods. Tracks the retail/import goods pipeline.",
  "truck-freight-tsi": "BTS Freight Transportation Services Index — the US GOVERNMENT's index of for-hire freight VOLUME across all modes (trucking-dominated), monthly since 2000. Free public stand-in for the proprietary ATA Truck Tonnage Index. Modeled from carrier output data.",
  "cass-shipments": "Cass Freight Index — SHIPMENTS: the number of freight shipments Cass Information Systems processes for its North American shipper clients — a PRIVATE, real-invoice sample across all modes (rebased 1990 = 100). Vs the BTS index: Cass is transaction-based (actual freight bills, more timely, North America, truckload-heavy), while BTS is a government model of US for-hire output — the two corroborate each other.",
  "cass-expenditures": "Cass Freight Index — EXPENDITURES: total freight SPEND (shipments × rate) from Cass's invoice data (1990 = 100). Because it includes freight-RATE inflation, Expenditures ÷ Shipments is a proxy for freight rates — rising expenditures while shipments fall = higher rates.",
  // Consumer
  "retail-sales": "Advance monthly retail & food-services sales (Census Bureau, SAAR $) — the headline read on consumer spending.",
  "durable-goods": "New orders for manufactured durable goods (Census, SAAR $) — big-ticket items (machinery, aircraft, autos). A forward read on business & consumer investment demand.",
  // Travel
  "hotel-lodging-cpi": "CPI for lodging away from home (hotels/motels, BLS) — a PRICE proxy for hotels: it captures room-price inflation, NOT occupancy or revenue. Real RevPAR is STR/CoStar-licensed and isn't free.",
  // Housing
  "housing-starts": "New privately-owned housing units STARTED, annualized (SAAR, Census) — a read on residential construction breaking ground.",
  "building-permits": "New housing units AUTHORIZED by building permits (SAAR, Census) — leads housing starts, since permits come before ground-breaking.",
  "construction-spend": "Total US construction spending, residential + non-residential (SAAR, Census) — the broad construction-activity gauge.",
  // TSA (keyed separately)
  tsa: "TSA airport checkpoint throughput — daily count of US air passengers screened. A real-time DEMAND proxy for air travel (not load factor). The TSA page is year-to-date only, so there's no true year-over-year — the 'vs 1mo' is near-term momentum.",
};
