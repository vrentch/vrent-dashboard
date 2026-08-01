// Curated sports → leagues/competitions, keyed to ESPN's public slugs. The
// focus is football, tennis and Formula 1, plus the marquee global events
// (World Cup, Euros). Every slug is verified against site.api.espn.com.
// `standings: false` marks knockout/tour/championship competitions that have no
// meaningful league table (tennis tours, cup finals, F1 race calendar).

export interface League {
  key: string; // ESPN league slug, e.g. "eng.1"
  name: string;
  short: string;
  flag: string; // emoji shown on the tile / tab
  standings: boolean;
}

export interface Sport {
  key: string; // ESPN sport slug: "soccer" | "tennis" | "racing"
  name: string;
  icon: string; // emoji
  leagues: League[];
}

export const SPORTS: Sport[] = [
  {
    key: "soccer",
    name: "Football",
    icon: "⚽️",
    leagues: [
      { key: "eng.1", name: "Premier League", short: "EPL", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", standings: true },
      { key: "esp.1", name: "LaLiga", short: "LaLiga", flag: "🇪🇸", standings: true },
      { key: "ita.1", name: "Serie A", short: "Serie A", flag: "🇮🇹", standings: true },
      { key: "ger.1", name: "Bundesliga", short: "Bundes.", flag: "🇩🇪", standings: true },
      { key: "fra.1", name: "Ligue 1", short: "Ligue 1", flag: "🇫🇷", standings: true },
      { key: "sui.1", name: "Super League", short: "Swiss", flag: "🇨🇭", standings: true },
      { key: "uefa.champions", name: "Champions League", short: "UCL", flag: "🏆", standings: true },
      { key: "uefa.europa", name: "Europa League", short: "UEL", flag: "🥈", standings: true },
      { key: "fifa.world", name: "World Cup", short: "World Cup", flag: "🌍", standings: true },
      { key: "uefa.euro", name: "Euros", short: "Euro", flag: "🇪🇺", standings: true },
    ],
  },
  {
    key: "tennis",
    name: "Tennis",
    icon: "🎾",
    leagues: [
      { key: "atp", name: "ATP Tour", short: "ATP", flag: "🎾", standings: false },
      { key: "wta", name: "WTA Tour", short: "WTA", flag: "🎾", standings: false },
    ],
  },
  {
    key: "racing",
    name: "Formula 1",
    icon: "🏎️",
    leagues: [
      { key: "f1", name: "Formula 1", short: "F1", flag: "🏁", standings: false },
    ],
  },
];

export function sportOf(key: string): Sport | undefined {
  return SPORTS.find((s) => s.key === key);
}
