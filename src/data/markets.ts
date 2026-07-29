// Curated market regions for the Markets overview. Each region maps to a
// headline index plus a basket of constituent symbols (verified against CNBC).
// Switzerland uses native SIX symbols (CHF); Europe uses US-listed ADRs (USD);
// the US uses plain tickers. Crypto uses the app's Yahoo-style aliases that the
// server maps to CNBC coin symbols.

export interface MarketRegion {
  key: string;
  name: string;
  flag: string;
  index: { symbol: string; label: string };
  symbols: string[];
}

export const REGIONS: MarketRegion[] = [
  {
    key: "us",
    name: "United States",
    flag: "🇺🇸",
    index: { symbol: "^GSPC", label: "S&P 500" },
    symbols: [
      "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK.B", "JPM", "V",
      "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "ABBV", "MRK", "CVX",
      "PEP", "KO", "WMT", "BAC", "AVGO", "ADBE", "CRM", "NFLX", "AMD", "DIS",
    ],
  },
  {
    key: "europe",
    name: "Europe",
    flag: "🇪🇺",
    index: { symbol: "^STOXX50E", label: "Euro Stoxx 50" },
    symbols: [
      "ASML", "SAP", "NVO", "AZN", "SHEL", "TTE", "UL", "SNY", "BUD", "DEO",
      "SAN", "BBVA", "ING", "BP", "RIO", "BTI", "SIEGY", "STLA", "E", "DB",
      "PHG", "MBGYY", "VWAGY", "BASFY", "ALIZY", "LVMUY",
    ],
  },
  {
    key: "switzerland",
    name: "Switzerland",
    flag: "🇨🇭",
    index: { symbol: "^SSMI", label: "SMI" },
    symbols: [
      "NESN-CH", "NOVN-CH", "RO-CH", "UBSG-CH", "ZURN-CH", "ABBN-CH", "CFR-CH",
      "SIKA-CH", "GIVN-CH", "LONN-CH", "SLHN-CH", "SREN-CH", "HOLN-CH", "GEBN-CH",
      "PGHN-CH", "ALC-CH", "SCMN-CH", "KNIN-CH", "SGSN-CH", "UHR-CH", "LOGI",
    ],
  },
  {
    key: "crypto",
    name: "Crypto",
    flag: "🪙",
    index: { symbol: "BTC-USD", label: "Bitcoin" },
    symbols: [
      "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD",
      "ADA-USD", "AVAX-USD", "LINK-USD", "DOT-USD", "LTC-USD",
    ],
  },
];

export function regionByKey(key: string): MarketRegion | undefined {
  return REGIONS.find((r) => r.key === key);
}
