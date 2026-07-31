// Curated market regions → selectable indices → constituent symbols (all
// verified against CNBC). Switzerland uses native SIX symbols (CHF); Europe/UK
// use US-listed ADRs (USD); the US uses plain tickers; crypto uses the app's
// Yahoo-style aliases that the server maps to CNBC coin symbols.

export interface IndexDef {
  key: string;
  symbol: string; // headline index quote (Yahoo-style alias)
  label: string;
  constituents: string[];
}

export interface MarketRegion {
  key: string;
  name: string;
  flag: string;
  indices: IndexDef[];
}

const US_SP500 = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK.B", "JPM", "V",
  "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "ABBV", "MRK", "CVX",
  "PEP", "KO", "WMT", "BAC", "AVGO", "ADBE", "CRM", "NFLX", "AMD", "DIS",
];
const US_NASDAQ = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "ADBE", "CRM",
  "NFLX", "AMD", "CSCO", "TMUS", "TXN", "QCOM", "AMAT", "INTU", "ISRG", "BKNG",
  "MU", "LRCX", "ADI", "GILD", "MDLZ", "PANW", "SNPS", "CDNS", "ABNB", "MRVL",
  "FTNT", "ADP", "CMCSA", "PEP", "COST",
];
const US_DOW = [
  "AAPL", "MSFT", "JPM", "V", "UNH", "HD", "PG", "JNJ", "KO", "MCD",
  "CVX", "MRK", "WMT", "DIS", "CAT", "GS", "AXP", "BA", "IBM", "NKE",
  "HON", "AMGN", "CRM", "TRV", "VZ", "CSCO", "MMM", "DOW", "SHW", "NVDA",
];

const EU_STOXX = [
  "ASML", "SAP", "TTE", "SIEGY", "ALIZY", "LVMUY", "SAN", "BBVA", "STLA", "E",
  "BASFY", "MBGYY", "VWAGY", "ING", "BUD", "SNY", "DB", "DTEGY", "ADDYY", "BAYRY",
  "MURGY", "IFNNY",
];
const EU_DAX = [
  "SAP", "SIEGY", "ALIZY", "BASFY", "MBGYY", "VWAGY", "DB", "DTEGY", "ADDYY",
  "BAYRY", "MURGY", "IFNNY",
];
const EU_FTSE = [
  "AZN", "SHEL", "BP", "RIO", "BTI", "UL", "DEO", "HSBC", "GSK", "BCS",
  "VOD", "NGG", "RELX", "PUK", "LYG",
];

const CH_SMI = [
  "NESN-CH", "NOVN-CH", "RO-CH", "UBSG-CH", "ZURN-CH", "ABBN-CH", "CFR-CH",
  "SIKA-CH", "GIVN-CH", "LONN-CH", "SLHN-CH", "SREN-CH", "HOLN-CH", "GEBN-CH",
  "PGHN-CH", "ALC-CH", "SCMN-CH", "KNIN-CH", "SGSN-CH", "UHR-CH", "LOGI",
];

const CRYPTO = [
  "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD",
  "ADA-USD", "AVAX-USD", "LINK-USD", "DOT-USD", "LTC-USD",
];

export const REGIONS: MarketRegion[] = [
  {
    key: "us",
    name: "United States",
    flag: "🇺🇸",
    indices: [
      { key: "sp500", symbol: "^GSPC", label: "S&P 500", constituents: US_SP500 },
      { key: "nasdaq", symbol: "^IXIC", label: "Nasdaq", constituents: US_NASDAQ },
      { key: "dow", symbol: "^DJI", label: "Dow Jones", constituents: US_DOW },
    ],
  },
  {
    key: "europe",
    name: "Europe",
    flag: "🇪🇺",
    indices: [
      { key: "stoxx", symbol: "^STOXX50E", label: "Euro Stoxx 50", constituents: EU_STOXX },
      { key: "dax", symbol: "^GDAXI", label: "DAX (Germany)", constituents: EU_DAX },
      { key: "ftse", symbol: "^FTSE", label: "FTSE 100 (UK)", constituents: EU_FTSE },
    ],
  },
  {
    key: "switzerland",
    name: "Switzerland",
    flag: "🇨🇭",
    indices: [{ key: "smi", symbol: "^SSMI", label: "SMI", constituents: CH_SMI }],
  },
  {
    key: "crypto",
    name: "Crypto",
    flag: "🪙",
    indices: [{ key: "coins", symbol: "BTC-USD", label: "Top coins", constituents: CRYPTO }],
  },
  {
    key: "metals",
    name: "Metals",
    flag: "🥇",
    indices: [
      { key: "metals", symbol: "XAU=", label: "Gold", constituents: ["XAU=", "XAG=", "XPT=", "XPD=", "@HG.1"] },
    ],
  },
  {
    key: "materials",
    name: "Raw materials",
    flag: "🛢️",
    indices: [
      { key: "energy", symbol: "@CL.1", label: "Energy", constituents: ["@CL.1", "@BZ.1", "@NG.1", "@RB.1", "@HO.1"] },
      { key: "agri", symbol: "@C.1", label: "Agriculture", constituents: ["@C.1", "@W.1", "@S.1", "@KC.1", "@SB.1", "@CT.1", "@CC.1"] },
    ],
  },
  {
    key: "bonds",
    name: "Bonds & rates",
    flag: "🏦",
    indices: [
      { key: "gov10y", symbol: "US10Y", label: "10-year yields", constituents: ["US10Y", "DE10Y", "GB10Y", "CH10Y", "FR10Y", "IT10Y", "JP10Y"] },
      { key: "uscurve", symbol: "US10Y", label: "US curve", constituents: ["US2Y", "US5Y", "US10Y", "US30Y"] },
    ],
  },
  {
    key: "fx",
    name: "Currencies",
    flag: "💱",
    indices: [
      { key: "majors", symbol: "EUR=", label: "Majors", constituents: ["EUR=", "GBP=", "JPY=", "CHF=", "AUD=", "CAD=", "CNY="] },
      { key: "chf", symbol: "EURCHF=", label: "CHF crosses", constituents: ["EURCHF=", "GBPCHF=", "EUR=", "CHF="] },
    ],
  },
];

// Regions where a technical Buy/Sell signal would be ambiguous or misleading.
export const NO_SIGNAL_REGIONS = new Set(["bonds", "fx"]);

export function primaryIndex(r: MarketRegion): IndexDef {
  return r.indices[0];
}
