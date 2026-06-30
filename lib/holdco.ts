/**
 * Holdco Arb / look-through-NAV tracker. For a curated set of holding companies, compute look-through
 * NAV = Σ(listed-stake values) + static other-NAV − net debt, vs the holdco's own market price →
 * discount/premium to NAV, with a z-score vs its own recent history (the CEF Discount-Hunter idea
 * applied to holdcos). Built offline by scripts/refresh-holdco-nav.ts → data/holdco-nav.json.
 *
 * The HOLDCOS roster below is the only hand-maintained input. Each stake is a % of a listed company
 * (value = pctOwned × the stake's live market cap) OR an absolute share count (millions). otherNavM +
 * netDebtM + sharesOutM + asOf come from each holdco's published NAV statement and are SEED ESTIMATES
 * — verify against the company's own NAV sheet before trading. Stake prices + FX are fetched live.
 */
// No fs import — this module is imported by the client view (types + discountColor + the roster).
// The page reads data/holdco-nav.json itself.

export interface Stake {
  ticker: string; // Yahoo symbol of the listed stake (e.g. 0700.HK, RACE, ATCO-A.ST)
  name: string;
  pctOwned?: number; // fraction of the listed co owned (value = pctOwned × its market cap); preferred
  sharesM?: number; // OR absolute shares held, millions (value = sharesM × price)
}
export interface Holdco {
  slug: string;
  name: string;
  ticker: string; // the holdco's own listing (e.g. PRX.AS)
  currency: string; // reporting currency (EUR/SEK/JPY/GBP/USD)
  sharesOutM: number; // holdco shares outstanding, millions
  netDebtM: number; // net debt in reporting-currency millions (negative = net cash)
  otherNavM: number; // static value of NON-listed assets (private holdings, ops) in reporting-currency millions
  asOf: string; // as-of of the net-debt / shares / other-NAV inputs
  stakes: Stake[];
  note?: string;
}

// ── Curated roster (SEED ESTIMATES — verify each holdco's stakes/net-debt against its NAV sheet) ──
export const HOLDCOS: Holdco[] = [
  {
    slug: "prosus", name: "Prosus", ticker: "PRX.AS", currency: "EUR", sharesOutM: 2420, netDebtM: -9000, otherNavM: 26000, asOf: "2026-03",
    note: "NAV dominated by its ~24% Tencent stake; the rest is other listed e-commerce + a large net-cash pile + private ops (the otherNAV line).",
    stakes: [{ ticker: "0700.HK", name: "Tencent", pctOwned: 0.24 }, { ticker: "DHER.DE", name: "Delivery Hero", pctOwned: 0.25 }],
  },
  {
    slug: "exor", name: "Exor", ticker: "EXO.AS", currency: "EUR", sharesOutM: 220, netDebtM: -3000, otherNavM: 6500, asOf: "2026-03",
    note: "Agnelli family holdco. Listed: Ferrari, Stellantis, CNH, Philips, Iveco. otherNAV = private (Christian Louboutin, reinsurance, Juventus, GEDI) + cash.",
    stakes: [
      { ticker: "RACE", name: "Ferrari", pctOwned: 0.235 },
      { ticker: "STLA", name: "Stellantis", pctOwned: 0.145 },
      { ticker: "CNH", name: "CNH Industrial", pctOwned: 0.267 },
      { ticker: "PHIA.AS", name: "Philips", pctOwned: 0.15 },
      { ticker: "IVG.MI", name: "Iveco", pctOwned: 0.27 },
    ],
  },
  {
    slug: "gbl", name: "Groupe Bruxelles Lambert", ticker: "GBLB.BR", currency: "EUR", sharesOutM: 148, netDebtM: 0, otherNavM: 9000, asOf: "2026-03",
    note: "Frère/Desmarais holdco. Listed: adidas, Pernod Ricard, SGS. otherNAV = private (Webhelp/Concentrix, Sanoptis, Affidea) + Sienna PE.",
    stakes: [
      { ticker: "ADS.DE", name: "adidas", pctOwned: 0.07 },
      { ticker: "RI.PA", name: "Pernod Ricard", pctOwned: 0.094 },
      { ticker: "SGSN.SW", name: "SGS", pctOwned: 0.19 },
    ],
  },
  {
    slug: "porsche-se", name: "Porsche SE", ticker: "PAH3.DE", currency: "EUR", sharesOutM: 306.25, netDebtM: 5100, otherNavM: 0, asOf: "2026-03",
    note: "The classic VW discount: NAV is ~100% two listed stakes — 31.9% of Volkswagen's TOTAL capital (53.3% of the ordinaries, no prefs) + 12.5% of Porsche AG. Published NAV ≈ €46/sh, ~−33%. Stake %s are vs total share capital — the model risk is VW's dual-class market-cap convention.",
    stakes: [
      { ticker: "VOW.DE", name: "Volkswagen", pctOwned: 0.319 },
      { ticker: "P911.DE", name: "Porsche AG", pctOwned: 0.125 },
    ],
  },
  {
    slug: "naspers", name: "Naspers", ticker: "NPN.JO", currency: "ZAR", sharesOutM: 754.8, netDebtM: 1646, otherNavM: 19752, asOf: "2026-06",
    note: "Single-asset: ~98% of NAV is Prosus (which itself trades at a discount to its Tencent-dominated NAV — the famous DOUBLE-discount). The Naspers↔Prosus cross-holding makes a naive direct look-through understate; this uses Naspers' reported ~69% ECONOMIC interest so NAV ties to its own statement (≈ ZAR 1,398/sh, ~−40%). Note: the directly-monetizable Prosus shares are ~43% — the gap is the circular cross-holding.",
    stakes: [
      { ticker: "PRX.AS", name: "Prosus (economic)", pctOwned: 0.691 },
    ],
  },
  {
    slug: "industrivarden", name: "Industrivärden", ticker: "INDU-C.ST", currency: "SEK", sharesOutM: 431.88, netDebtM: 1880, otherNavM: 482, asOf: "2026-06",
    note: "Swedish industrial holdco — ~99.7% listed (Volvo, Sandvik, Handelsbanken, Essity, SCA, Ericsson, Skanska, Alleima). Publishes NAV monthly; discount has compressed to ~flat/slight-premium in mid-2026 (NAV ≈ SEK 392/sh).",
    stakes: [
      { ticker: "VOLV-B.ST", name: "Volvo", pctOwned: 0.095 },
      { ticker: "SAND.ST", name: "Sandvik", pctOwned: 0.149 },
      { ticker: "SHB-A.ST", name: "Handelsbanken", pctOwned: 0.116 },
      { ticker: "ESSITY-B.ST", name: "Essity", pctOwned: 0.109 },
      { ticker: "SCA-B.ST", name: "SCA", pctOwned: 0.117 },
      { ticker: "SKA-B.ST", name: "Skanska", pctOwned: 0.077 },
      { ticker: "ALLEI.ST", name: "Alleima", pctOwned: 0.204 },
      { ticker: "ERIC-B.ST", name: "Ericsson", pctOwned: 0.026 },
    ],
  },
  {
    slug: "lundberg", name: "L E Lundbergföretagen", ticker: "LUND-B.ST", currency: "SEK", sharesOutM: 248, netDebtM: 0, otherNavM: 33400, asOf: "2026-05",
    note: "Lundberg family holdco — listed core (Holmen, Indutrade, Industrivärden, Hufvudstaden, Husqvarna, Sandvik, Skanska, Alleima) + a wholly-owned property arm (Lundbergs Fastigheter ≈ the otherNAV). NAV ≈ SEK 652/sh, ~−30%. Property value + deferred tax make otherNAV approximate.",
    stakes: [
      { ticker: "HOLM-B.ST", name: "Holmen", pctOwned: 0.36 },
      { ticker: "INDT.ST", name: "Indutrade", pctOwned: 0.272 },
      { ticker: "INDU-C.ST", name: "Industrivärden", pctOwned: 0.218 },
      { ticker: "HUFV-A.ST", name: "Hufvudstaden", pctOwned: 0.491 },
      { ticker: "HUSQ-B.ST", name: "Husqvarna", pctOwned: 0.078 },
      { ticker: "ALLEI.ST", name: "Alleima", pctOwned: 0.105 },
      { ticker: "SKA-B.ST", name: "Skanska", pctOwned: 0.054 },
      { ticker: "SAND.ST", name: "Sandvik", pctOwned: 0.033 },
      { ticker: "SHB-A.ST", name: "Handelsbanken", pctOwned: 0.033 },
    ],
  },
  {
    slug: "power-corp", name: "Power Corporation of Canada", ticker: "POW.TO", currency: "CAD", sharesOutM: 632.1, netDebtM: 4300, otherNavM: 5000, asOf: "2026-03",
    note: "Desmarais family holdco — Great-West Lifeco (71%), IGM Financial (63%), ~19% of GBL (itself a holdco → a double-discount line) + unlisted Wealthsimple/Sagard (the otherNAV). Adjusted NAV ≈ CAD 84.5/sh; discount unusually narrow (~−18%) vs a long-run ~−35%.",
    stakes: [
      { ticker: "GWO.TO", name: "Great-West Lifeco", pctOwned: 0.711 },
      { ticker: "IGM.TO", name: "IGM Financial", pctOwned: 0.629 },
      { ticker: "GBLB.BR", name: "GBL", pctOwned: 0.19 },
    ],
  },
  {
    slug: "wendel", name: "Wendel", ticker: "MF.PA", currency: "EUR", sharesOutM: 40.39, netDebtM: 590, otherNavM: 4885, asOf: "2026-03",
    note: "French holdco mid-transition — only ~27% listed (Bureau Veritas, being sold down; IHS, being taken out for cash); the bulk is private (Stahl, sold to Henkel; IK Partners + Monroe asset-management). NAV ≈ €158/sh, a wide ~−51% discount (private-heavy NAV draws more skepticism).",
    stakes: [
      { ticker: "BVI.PA", name: "Bureau Veritas", pctOwned: 0.15 },
      { ticker: "IHS", name: "IHS Towers", pctOwned: 0.19 },
    ],
  },
  {
    slug: "investor-ab", name: "Investor AB", ticker: "INVE-B.ST", currency: "SEK", sharesOutM: 3065.6, netDebtM: 13933, otherNavM: 256407, asOf: "2026-03",
    note: "Wallenberg holdco. Large listed core (Atlas Copco, ABB, AstraZeneca, SEB, EQT, Saab, Sobi, Epiroc, Ericsson, Electrolux, Wärtsilä, Nasdaq, Husqvarna) + wholly-owned Patricia Industries (private — Mölnlycke et al.) + EQT funds, both in otherNAV. NAV ≈ SEK 367/sh; usually a small PREMIUM (quality + the Patricia mark).",
    stakes: [
      { ticker: "ATCO-A.ST", name: "Atlas Copco", pctOwned: 0.171 },
      { ticker: "ABB.ST", name: "ABB", pctOwned: 0.144 },
      { ticker: "AZN.ST", name: "AstraZeneca", pctOwned: 0.033 },
      { ticker: "SEB-A.ST", name: "SEB", pctOwned: 0.215 },
      { ticker: "EQT.ST", name: "EQT", pctOwned: 0.147 },
      { ticker: "SAAB-B.ST", name: "Saab", pctOwned: 0.302 },
      { ticker: "SOBI.ST", name: "Sobi", pctOwned: 0.344 },
      { ticker: "EPI-A.ST", name: "Epiroc", pctOwned: 0.171 },
      { ticker: "ERIC-B.ST", name: "Ericsson", pctOwned: 0.099 },
      { ticker: "ELUX-B.ST", name: "Electrolux", pctOwned: 0.179 },
      { ticker: "WRT1V.HE", name: "Wärtsilä", pctOwned: 0.177 },
      { ticker: "NDAQ", name: "Nasdaq", pctOwned: 0.103 },
      { ticker: "HUSQ-B.ST", name: "Husqvarna", pctOwned: 0.168 },
    ],
  },
  {
    slug: "softbank", name: "SoftBank Group", ticker: "9984.T", currency: "JPY", sharesOutM: 5700, netDebtM: 11380000, otherNavM: 26220000, asOf: "2026-03",
    note: "Listed core = Arm (~90%) + SoftBank Corp telecom (~40%); net debt folds in the Arm asset-backed margin financing (so the gross Arm stake reconciles). The huge otherNAV is the MOSTLY-UNLISTED Vision Funds — only ~46% of NAV is mark-to-market, so the discount is opinion-dependent. Published NAV ≈ ¥7,029/sh (Mar-2026). T-Mobile/Alibaba/DT excluded — sold or fully collared.",
    stakes: [
      { ticker: "ARM", name: "Arm Holdings", pctOwned: 0.87 },
      { ticker: "9434.T", name: "SoftBank Corp (telecom)", pctOwned: 0.40 },
    ],
  },
  {
    slug: "bollore", name: "Bolloré SE", ticker: "BOL.PA", currency: "EUR", sharesOutM: 1400, netDebtM: -1400, otherNavM: 1400, asOf: "2026-06",
    note: "Vincent Bolloré family holdco (via Compagnie de l'Odet, ~71%). Post-2024 simplification: a DIRECT 18.4% of Universal Music Group (the single biggest line, ~€7.5bn) + the controlling stakes that resulted from Vivendi's Dec-2024 four-way split — 29.3% of the rump Vivendi (VIV.PA) PLUS direct ~30.4% of each spinoff Canal+ (CAN.L), Havas (HAVAS.AS) and Louis Hachette (ALHG.PA), all held alongside Vivendi rather than through it. Big net-cash pile from the 2022/2024 logistics disposals (Bolloré Logistics → CMA CGM); net cash was €5.6bn at Dec-2025 but a €4.2bn EXCEPTIONAL DIVIDEND (€1.5/sh) was paid 25-Jun-2026, cutting it to ~€1.4bn — reflected here. otherNAV = Rubis 6% (€199m) + Socfin agribusiness (€306m) + the residual industrial/energy bucket (Blue Solutions LMP batteries/Bluebus, Bolloré Energy oil distribution, Plastic Films) — SEED ESTIMATE, Bolloré doesn't separately mark these. CAN.L quotes in GBp (pence) → engine ÷100. CIRCULAR CROSS-HOLDING: ~52% of Bolloré is held indirectly via the Bolloré↔Compagnie de l'Odet self-control loop, so `sharesOutM` here = the ECONOMIC FREE FLOAT (~1,400M), NOT the ~2,810M reported listed shares — this is the basis analysts use, and on it the discount lands ~−45% (vs the published ~40%, up to ~70% on a full control-loop look-through). On reported shares the direct method shows a small PREMIUM, which is misleading. Two caveats: (1) the direct method still can't see through Vivendi's own ~44% discount (the VIV.PA line is marked at Vivendi's depressed price), so the true look-through discount is wider; (2) a 1:10 share consolidation was announced for 18-Nov-2025 — if Yahoo reprices BOL.PA to ~€41, divide sharesOutM by 10. Medium-confidence — Bolloré is the hardest holdco to mark cleanly. Published portfolio of listed securities = €10.6bn (Dec-2025).",
    stakes: [
      { ticker: "UMG.AS", name: "Universal Music Group", pctOwned: 0.184 },
      { ticker: "VIV.PA", name: "Vivendi", pctOwned: 0.293 },
      { ticker: "CAN.L", name: "Canal+ Group", pctOwned: 0.304 },
      { ticker: "HAVAS.AS", name: "Havas", pctOwned: 0.304 },
      { ticker: "ALHG.PA", name: "Louis Hachette Group", pctOwned: 0.304 },
    ],
  },
  {
    slug: "vivendi", name: "Vivendi SE", ticker: "VIV.PA", currency: "EUR", sharesOutM: 995, netDebtM: 1768, otherNavM: 450, asOf: "2025-12",
    note: "Post-Dec-2024 RUMP Vivendi — after the four-way split (Canal+/Havas/Louis Hachette were spun OUT to shareholders and now sit on Bolloré's balance sheet directly, NOT here). What remains is an investment vehicle whose NAV is dominated by UMG. UMG is BY FAR the largest asset (~9.9% net economic stake): capital interest was ~14.6% at YE2024 but partly hedged via a forward sale, so net economic exposure ~9.9% — modeled as pctOwned 0.0991 on UMG's full market cap (the hedge means this slightly OVERSTATES clean ownership; if the computed discount prints much wider than ~45%, trim UMG toward the post-hedge figure or move the hedge proceeds into otherNAV/netDebt). Then Banijay ~19.2%, MFE-MediaForEurope B-shares ~15.9% (B = super-voting; A = MFEA.MI), Lagardère ~13.4% (NOT the old 57% — the control block went to Louis Hachette in the spin), a residual Telecom Italia ~2.5% (NOT the old ~23% — sold 15% to Poste Italiane Apr-2025, exited telecoms), Prisa ~11.2%. otherNAV = 100%-owned Gameloft + residual Telefónica + cash — SEED ESTIMATE, the softest input. Net financial debt ~€1,768m (H1-2025). Published holdco discount ~33–50% since the spin (~40% mid-2025). Cross-held with [[holdco]] Bolloré (Bolloré owns 29.3% of Vivendi).",
    stakes: [
      { ticker: "UMG.AS", name: "Universal Music Group (net of hedge)", pctOwned: 0.0991 },
      { ticker: "BNJ.AS", name: "Banijay Group", pctOwned: 0.192 },
      { ticker: "MFEB.MI", name: "MFE-MediaForEurope (B)", pctOwned: 0.1592 },
      { ticker: "MMB.PA", name: "Lagardère", pctOwned: 0.134 },
      { ticker: "PRS.MC", name: "Prisa", pctOwned: 0.1119 },
      { ticker: "TIT.MI", name: "Telecom Italia (ord)", pctOwned: 0.0251 },
    ],
  },
  {
    slug: "psh", name: "Pershing Square Holdings", ticker: "PSH.L", currency: "USD", sharesOutM: 175.03, netDebtM: 3629, otherNavM: 1600, asOf: "2026-03",
    note: "Ackman's closed-end fund — concentrated, ~118% net exposure, NAV ~88% mark-to-market. Positions = the Q1-2026 13F share counts; net debt = PSH's public bonds (the leverage); otherNAV = the off-13F GSE (Fannie/Freddie) + SPARC + cash. Universal Music was fully EXITED in June 2026 (dropped here). Published NAV ≈ $71/sh (Mar-2026), ~−27% discount. Verify against PSH's own monthly NAV report.",
    stakes: [
      { ticker: "BN", name: "Brookfield", sharesM: 59.70 },
      { ticker: "AMZN", name: "Amazon", sharesM: 11.45 },
      { ticker: "UBER", name: "Uber", sharesM: 29.96 },
      { ticker: "MSFT", name: "Microsoft", sharesM: 5.65 },
      { ticker: "QSR", name: "Restaurant Brands", sharesM: 22.65 },
      { ticker: "META", name: "Meta", sharesM: 2.66 },
      { ticker: "HHH", name: "Howard Hughes", sharesM: 18.85 },
      { ticker: "SEG", name: "Seaport Entertainment", sharesM: 5.02 },
      { ticker: "HTZ", name: "Hertz", sharesM: 15.24 },
      { ticker: "GOOG", name: "Alphabet", sharesM: 0.31 },
    ],
  },
];

// ── Computed output (written to data/holdco-nav.json by the refresh script) ──
export interface StakeVal { ticker: string; name: string; valueM: number | null; pctOfNav: number | null }
export interface HoldcoNav {
  slug: string;
  name: string;
  ticker: string;
  currency: string;
  asOf: string;
  price: number | null; // holdco price (reporting currency)
  navPerShare: number | null;
  grossAssetM: number | null; // listed stakes + otherNAV
  listedM: number | null; // listed stakes only (for coverage)
  otherNavM: number;
  netDebtM: number;
  navM: number | null;
  discount: number | null; // price/NAVps − 1, in % (negative = trades below NAV)
  z1y: number | null;
  stretched: boolean; // z1y ≤ −1 — unusually wide vs its own recent history
  coveragePct: number | null; // listed value ÷ gross asset (how much of NAV is mark-to-market)
  stakes: StakeVal[];
  history: [string, number, number][]; // [date, navPerShare, price] — discount derived = price/nav − 1
  note?: string;
  error?: string;
}
export interface HoldcoNavData { generatedAt: string; asOf: string | null; holdcos: HoldcoNav[] }

/** Discount color: deep discount = green (cheap), premium = red. */
export const discountColor = (d: number | null) => (d == null ? "var(--text-3)" : d <= -25 ? "#22c55e" : d <= -10 ? "#4ade80" : d < 0 ? "#a3e635" : "#ef4444");
