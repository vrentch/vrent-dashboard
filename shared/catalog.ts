// Shared data catalog used by both the client (filter UI) and the server
// (feed builder). Pure data + types only — safe to import anywhere.

export interface Country {
  code: string; // ISO 3166-1 alpha-2, used as Google News `gl`
  name: string;
  flag: string; // emoji
  lang: string; // primary language code, used as Google News `hl`/`ceid`
}

export interface Topic {
  key: string;
  label: string;
  icon: string; // lucide icon name
  // Either a Google News standard section token, or a search query.
  section?: string;
  query?: string;
}

// A curated, editable set of countries. Add more freely — the server builds
// Google News RSS endpoints from `code`/`lang`, so any valid pair works.
export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", flag: "🇺🇸", lang: "en" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", lang: "en" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭", lang: "de" },
  { code: "DE", name: "Germany", flag: "🇩🇪", lang: "de" },
  { code: "FR", name: "France", flag: "🇫🇷", lang: "fr" },
  { code: "IT", name: "Italy", flag: "🇮🇹", lang: "it" },
  { code: "ES", name: "Spain", flag: "🇪🇸", lang: "es" },
  { code: "RU", name: "Russia", flag: "🇷🇺", lang: "ru" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦", lang: "uk" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱", lang: "nl" },
  { code: "AT", name: "Austria", flag: "🇦🇹", lang: "de" },
  { code: "SE", name: "Sweden", flag: "🇸🇪", lang: "sv" },
  { code: "PL", name: "Poland", flag: "🇵🇱", lang: "pl" },
  { code: "TR", name: "Turkey", flag: "🇹🇷", lang: "tr" },
  { code: "IN", name: "India", flag: "🇮🇳", lang: "en" },
  { code: "CN", name: "China", flag: "🇨🇳", lang: "zh" },
  { code: "JP", name: "Japan", flag: "🇯🇵", lang: "ja" },
  { code: "KR", name: "South Korea", flag: "🇰🇷", lang: "ko" },
  { code: "BR", name: "Brazil", flag: "🇧🇷", lang: "pt" },
  { code: "MX", name: "Mexico", flag: "🇲🇽", lang: "es" },
  { code: "CA", name: "Canada", flag: "🇨🇦", lang: "en" },
  { code: "AU", name: "Australia", flag: "🇦🇺", lang: "en" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", lang: "en" },
  { code: "AE", name: "UAE", flag: "🇦🇪", lang: "en" },
  { code: "IL", name: "Israel", flag: "🇮🇱", lang: "en" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦", lang: "ar" },
  { code: "EG", name: "Egypt", flag: "🇪🇬", lang: "ar" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬", lang: "en" },
  { code: "AR", name: "Argentina", flag: "🇦🇷", lang: "es" },
  { code: "SG", name: "Singapore", flag: "🇸🇬", lang: "en" },
];

// "Field areas" — the topic dimension. Standard Google News sections use
// `section`; the rest use a search `query` so the same engine covers both.
export const TOPICS: Topic[] = [
  { key: "top", label: "Top stories", icon: "Newspaper" },
  { key: "world", label: "World", icon: "Globe", section: "WORLD" },
  { key: "nation", label: "National", icon: "Landmark", section: "NATION" },
  { key: "business", label: "Business", icon: "Briefcase", section: "BUSINESS" },
  { key: "finance", label: "Markets & Finance", icon: "LineChart", query: "stock market finance economy" },
  { key: "technology", label: "Technology", icon: "Cpu", section: "TECHNOLOGY" },
  { key: "science", label: "Science", icon: "FlaskConical", section: "SCIENCE" },
  { key: "health", label: "Health", icon: "HeartPulse", section: "HEALTH" },
  { key: "sports", label: "Sports", icon: "Trophy", section: "SPORTS" },
  { key: "entertainment", label: "Entertainment", icon: "Clapperboard", section: "ENTERTAINMENT" },
  { key: "energy", label: "Energy & Climate", icon: "Leaf", query: "energy climate environment" },
  { key: "realestate", label: "Real Estate", icon: "Building2", query: "real estate housing property market" },
  { key: "crypto", label: "Crypto", icon: "Bitcoin", query: "cryptocurrency bitcoin ethereum" },
  { key: "politics", label: "Politics", icon: "Vote", query: "politics government election policy" },
  { key: "economy", label: "Economy", icon: "DollarSign", query: "economy inflation GDP interest rates jobs" },
  { key: "ai", label: "AI", icon: "BrainCircuit", query: "artificial intelligence AI machine learning" },
  { key: "startups", label: "Startups", icon: "Rocket", query: "startup venture capital funding IPO" },
  { key: "gaming", label: "Gaming", icon: "Gamepad2", query: "video games gaming esports" },
  { key: "film", label: "Film & TV", icon: "Film", query: "movies film television streaming series" },
  { key: "music", label: "Music", icon: "Music", query: "music artists albums concerts" },
  { key: "travel", label: "Travel", icon: "Plane", query: "travel tourism airlines destinations" },
  { key: "food", label: "Food", icon: "UtensilsCrossed", query: "food cuisine restaurants recipes" },
  { key: "automotive", label: "Automotive", icon: "Car", query: "cars automotive electric vehicles" },
  { key: "space", label: "Space", icon: "Orbit", query: "space NASA rockets astronomy" },
  { key: "education", label: "Education", icon: "GraduationCap", query: "education schools universities" },
  { key: "culture", label: "Arts & Culture", icon: "Palette", query: "arts culture museums books theatre" },
  { key: "fashion", label: "Fashion", icon: "Shirt", query: "fashion style designers runway" },
  { key: "weather", label: "Weather", icon: "CloudSun", query: "weather storm forecast severe" },
];

export const DEFAULT_COUNTRIES = ["US", "CH", "GB"];
export const DEFAULT_TOPICS = ["top", "business", "world", "technology"];

// Starter watchlist for the Markets section (Yahoo Finance symbols).
export const DEFAULT_WATCHLIST = [
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "^GSPC", "^IXIC", "BTC-USD", "ETH-USD",
];

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function topicByKey(key: string): Topic | undefined {
  return TOPICS.find((t) => t.key === key);
}
