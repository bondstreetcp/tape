// Constituent lists for the international index universes. Tickers are Yahoo
// symbols (with the exchange suffix). Names are best-effort and get overwritten
// by Yahoo's own shortName at build time; any ticker that fails to fetch is
// simply dropped, so an out-of-date entry degrades gracefully.

export interface IntlUniverse {
  id: string;
  name: string;
  short: string;
  currency: string;
  tickers: string[];
}

// Yahoo's sector taxonomy → the SPDR ETF keys the app already groups by, so
// international names reuse the whole sector/treemap/screener system.
export const YAHOO_SECTOR_TO_ETF: Record<string, string> = {
  Technology: "XLK",
  Healthcare: "XLV",
  "Financial Services": "XLF",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  "Communication Services": "XLC",
  Industrials: "XLI",
  Energy: "XLE",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Basic Materials": "XLB",
};

export const INTL_UNIVERSES: IntlUniverse[] = [
  {
    id: "cac40",
    name: "CAC 40 (France)",
    short: "CAC 40",
    currency: "EUR",
    tickers: [
      "AC.PA", "AI.PA", "AIR.PA", "ALO.PA", "MT.AS", "CS.PA", "BNP.PA", "EN.PA",
      "CAP.PA", "CA.PA", "ACA.PA", "BN.PA", "DSY.PA", "EDEN.PA", "ENGI.PA",
      "EL.PA", "ERF.PA", "RMS.PA", "KER.PA", "LR.PA", "OR.PA", "MC.PA", "ML.PA",
      "ORA.PA", "RI.PA", "PUB.PA", "RNO.PA", "SAF.PA", "SGO.PA", "SAN.PA",
      "SU.PA", "GLE.PA", "STLAP.PA", "STMPA.PA", "TEP.PA", "HO.PA", "TTE.PA",
      "URW.PA", "VIE.PA", "DG.PA", "WLN.PA",
    ],
  },
  {
    id: "aex",
    name: "AEX (Netherlands)",
    short: "AEX",
    currency: "EUR",
    tickers: [
      "ADYEN.AS", "AD.AS", "AKZA.AS", "MT.AS", "ASM.AS", "ASML.AS", "ASRNL.AS",
      "BESI.AS", "ABN.AS", "AGN.AS", "DSFIR.AS", "GLPG.AS", "HEIA.AS", "IMCD.AS",
      "INGA.AS", "KPN.AS", "NN.AS", "PHIA.AS", "PRX.AS", "RAND.AS", "REN.AS",
      "SHELL.AS", "UMG.AS", "UNA.AS", "WKL.AS",
    ],
  },
  {
    id: "kospi",
    name: "KOSPI (Korea)",
    short: "KOSPI",
    currency: "KRW",
    tickers: [
      "005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS", "000270.KS",
      "068270.KS", "005490.KS", "035420.KS", "051910.KS", "006400.KS", "035720.KS",
      "105560.KS", "055550.KS", "012330.KS", "028260.KS", "066570.KS", "003670.KS",
      "096770.KS", "015760.KS", "017670.KS", "034730.KS", "032830.KS", "018260.KS",
      "086790.KS", "009150.KS", "011200.KS", "010130.KS", "316140.KS", "024110.KS",
      "030200.KS", "010950.KS", "090430.KS", "011170.KS", "138040.KS", "047810.KS",
    ],
  },
];
