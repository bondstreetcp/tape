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
  {
    id: "nikkei",
    name: "Nikkei 225 (Japan)",
    short: "Nikkei",
    currency: "JPY",
    tickers: [
      "7203.T", "6758.T", "9984.T", "6861.T", "8306.T", "9983.T", "6098.T", "8035.T",
      "6501.T", "7974.T", "4063.T", "9433.T", "9432.T", "8058.T", "8001.T", "6902.T",
      "7267.T", "6594.T", "4568.T", "4502.T", "8316.T", "8411.T", "6367.T", "6273.T",
      "7741.T", "4519.T", "6981.T", "9020.T", "8031.T", "7751.T", "6752.T", "6503.T",
      "7011.T", "4661.T", "9434.T", "6954.T", "4543.T", "8766.T", "8053.T", "7269.T",
    ],
  },
  {
    id: "ftse100",
    name: "FTSE 100 (UK)",
    short: "FTSE 100",
    currency: "GBP",
    tickers: [
      "AZN.L", "SHEL.L", "HSBA.L", "ULVR.L", "BP.L", "GSK.L", "RIO.L", "REL.L",
      "DGE.L", "BATS.L", "GLEN.L", "NG.L", "LSEG.L", "BARC.L", "LLOY.L", "VOD.L",
      "BA.L", "NWG.L", "PRU.L", "CPG.L", "AAL.L", "TSCO.L", "RKT.L", "IMB.L",
      "STAN.L", "RR.L", "III.L", "EXPN.L", "SSE.L", "NXT.L", "AV.L", "LGEN.L",
      "ABF.L", "SGRO.L", "HLN.L", "FLTR.L", "INF.L", "WTB.L", "BNZL.L", "SMIN.L",
    ],
  },
  {
    id: "dax",
    name: "DAX (Germany)",
    short: "DAX",
    currency: "EUR",
    tickers: [
      "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "AIR.DE", "MBG.DE", "MUV2.DE", "BAS.DE",
      "BMW.DE", "BAYN.DE", "VOW3.DE", "IFX.DE", "DB1.DE", "ADS.DE", "DBK.DE", "RWE.DE",
      "EOAN.DE", "HEN3.DE", "MRK.DE", "VNA.DE", "DHL.DE", "CON.DE", "BNR.DE", "SHL.DE",
      "SY1.DE", "HNR1.DE", "FRE.DE", "QIA.DE", "ZAL.DE", "P911.DE", "MTX.DE", "RHM.DE",
      "CBK.DE", "HEI.DE", "BEI.DE", "SRT3.DE", "PAH3.DE",
    ],
  },
  {
    id: "tsx",
    name: "S&P/TSX Composite (Canada)",
    short: "TSX",
    currency: "CAD",
    tickers: [
      "RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "CM.TO", "NA.TO", "MFC.TO", "SLF.TO",
      "GWO.TO", "IFC.TO", "BN.TO", "ENB.TO", "TRP.TO", "SU.TO", "CNQ.TO", "IMO.TO",
      "CVE.TO", "TOU.TO", "PPL.TO", "CNR.TO", "CP.TO", "WCN.TO", "GIB-A.TO", "MG.TO",
      "WSP.TO", "NTR.TO", "FNV.TO", "WPM.TO", "AEM.TO", "ABX.TO", "TECK-B.TO", "CCO.TO",
      "SHOP.TO", "CSU.TO", "OTEX.TO", "ATD.TO", "L.TO", "DOL.TO", "QSR.TO", "MRU.TO",
      "BCE.TO", "T.TO", "RCI-B.TO", "FTS.TO", "EMA.TO", "H.TO", "TRI.TO",
      "ATZ.TO", "GRGD.TO",
    ],
  },
  {
    id: "smi",
    name: "SMI (Switzerland)",
    short: "SMI",
    currency: "CHF",
    tickers: [
      "NESN.SW", "ROP.SW", "NOVN.SW", "UBSG.SW", "ZURN.SW", "ABBN.SW", "CFR.SW",
      "SIKA.SW", "LONN.SW", "ALC.SW", "GIVN.SW", "HOLN.SW", "SREN.SW", "SCMN.SW",
      "GEBN.SW", "PGHN.SW", "SOON.SW", "LOGN.SW", "KNIN.SW", "UHR.SW",
      "LISN.SW", "STMN.SW", "SCHP.SW", "SGSN.SW", "BAER.SW", "TEMN.SW", "ADEN.SW",
      "CLN.SW", "HBAN.SW", "VACN.SW", "GALE.SW", "BARN.SW",
    ],
  },
];
