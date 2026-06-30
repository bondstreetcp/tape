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
      "BESI.AS", "ABN.AS", "AGN.AS", "DSFIR.AS", "EXO.AS", "HEIA.AS", "IMCD.AS",
      "INGA.AS", "KPN.AS", "NN.AS", "PHIA.AS", "PRX.AS", "SBMO.AS", "REN.AS",
      "SHELL.AS", "UMG.AS", "UNA.AS", "WKL.AS",
      "MICC.AS", // The Magnum Ice Cream Company (Unilever ice-cream spinoff) — AEX member
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
    id: "topix",
    name: "TOPIX 100 (Japan)",
    short: "TOPIX 100",
    currency: "JPY",
    // TOPIX 100 large-caps (Core30 + Large70) — best-effort; any bad code is dropped at build time.
    tickers: [
      "7203.T", "6758.T", "9984.T", "6861.T", "8306.T", "9983.T", "6098.T", "8035.T",
      "6501.T", "7974.T", "4063.T", "9433.T", "9432.T", "8058.T", "8001.T", "6902.T",
      "7267.T", "6594.T", "4568.T", "4502.T", "8316.T", "8411.T", "6367.T", "6273.T",
      "7741.T", "4519.T", "6981.T", "9020.T", "8031.T", "7751.T", "6752.T", "6503.T",
      "7011.T", "4661.T", "9434.T", "6954.T", "4543.T", "8766.T", "8053.T", "7269.T",
      "8002.T", "8267.T", "9022.T", "4901.T", "4503.T", "4523.T", "4578.T", "8591.T",
      "8604.T", "8630.T", "8725.T", "8750.T", "8309.T", "7270.T", "7201.T", "5108.T",
      "6301.T", "6326.T", "6701.T", "6702.T", "6762.T", "6857.T", "6971.T", "6988.T",
      "4452.T", "4911.T", "2502.T", "2503.T", "2914.T", "2802.T", "3382.T", "9843.T",
      "4689.T", "4307.T", "9613.T", "7832.T", "5401.T", "5411.T", "5713.T", "3407.T",
      "4188.T", "4005.T", "5020.T", "1605.T", "9501.T", "9503.T", "9531.T", "9201.T",
      "9202.T", "4612.T", "5802.T", "3402.T", "6586.T", "7733.T", "9697.T", "6645.T",
      "6963.T", "6724.T", "4151.T", "4507.T", "7912.T",
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
      "CBK.DE", "HEI.DE", "BEI.DE", "SRT3.DE", "PAH3.DE", "ENR.DE",
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
  {
    id: "hsi",
    name: "Hang Seng (Hong Kong)",
    short: "Hang Seng",
    currency: "HKD",
    tickers: [
      "0700.HK", "9988.HK", "0005.HK", "1299.HK", "3690.HK", "0941.HK", "0939.HK",
      "1398.HK", "0388.HK", "2318.HK", "0883.HK", "0857.HK", "1810.HK", "0027.HK",
      "2628.HK", "3988.HK", "0016.HK", "0001.HK", "0002.HK", "0003.HK", "0006.HK",
      "0012.HK", "0066.HK", "0101.HK", "0175.HK", "0267.HK", "0288.HK", "0386.HK",
      "0688.HK", "0762.HK", "0823.HK", "0960.HK", "1038.HK", "1093.HK", "1109.HK",
      "1113.HK", "1177.HK", "1211.HK", "1928.HK", "2020.HK", "2269.HK", "2313.HK",
      "2331.HK", "2382.HK", "2688.HK", "9618.HK", "9999.HK", "9888.HK", "1024.HK",
      "6086.HK", // Fangzhou Jianke (online healthcare) — added on request; not a Hang Seng index member
    ],
  },
  {
    id: "ipc",
    name: "IPC (Mexico)",
    short: "IPC",
    currency: "MXN",
    tickers: [
      "AMXB.MX", "GFNORTEO.MX", "WALMEX.MX", "FEMSAUBD.MX", "GMEXICOB.MX", "CEMEXCPO.MX",
      "TLEVISACPO.MX", "BIMBOA.MX", "KIMBERA.MX", "ALSEA.MX", "GAPB.MX", "ASURB.MX",
      "OMAB.MX", "PINFRA.MX", "GCARSOA1.MX", "LIVEPOLC-1.MX", "ORBIA.MX", "PE&OLES.MX",
      "KOFUBL.MX", "AC.MX", "GRUMAB.MX", "CUERVO.MX", "Q.MX", "GENTERA.MX", "BBAJIOO.MX",
      "RA.MX", "CHDRAUIB.MX", "LABB.MX", "MEGACPO.MX", "VESTA.MX", "FUNO11.MX",
      "GFINBURO.MX", "GCC.MX", "BOLSAA.MX", "ALPEKA.MX",
    ],
  },
];
