# Vrent — News & Markets

A mobile-first **PWA** (installable web app) with two sections:

- **News** — live world headlines you filter by **country** and **field area**
  (topic). Fully adjustable and re-selectable; your choices are remembered on
  your device. Aggregated from public news feeds (Google News, which surfaces
  outlets such as CNBC, 20 Minuten, DZEN and thousands of others).
- **Markets** — live stock/index/crypto quotes with charts and analytics
  (range change, volatility, moving average, period high/low). Powered by
  public Yahoo Finance endpoints.

**No API keys, no logins, no cost.** A tiny built-in serverless function fetches
the feeds so the phone app isn't blocked by browser cross-origin rules.

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL (e.g. http://localhost:5173) on your computer or phone
(same Wi-Fi). Live data works in dev because Vite serves the same `/api/*`
routes as production.

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build (static only — no /api)
npm run typecheck  # optional: TypeScript check
```

> `npm run preview` serves only the static build and does **not** run the
> `/api` function, so live data needs either `npm run dev` or a real deploy.

## Deploy (free) & install on your phone

The project is set up for **Vercel** (any host with Node serverless functions
works). Vercel runs the static app and the `/api` function together, so the
phone app has live data with no keys.

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new) — it auto-detects Vite;
   no configuration needed.
3. Open the deployed URL on your phone → browser menu → **Add to Home Screen**.
   It launches full-screen like a native app.

## How to use

- **News tab → Adjust:** pick any countries and field areas, or type a keyword
  (e.g. "elections", "AI"). The chip row filters the loaded stories instantly.
- **Markets tab → Edit:** manage your watchlist (stocks, indices like `^GSPC`,
  FX like `EURUSD=X`, crypto like `BTC-USD`). Tap any row for a full chart and
  analytics across 1D → 5Y ranges.

## Project structure

```
shared/catalog.ts     Countries & topics (edit to add more)
server/               RSS + Yahoo data layer (framework-agnostic)
api/[...path].ts      Serverless entry (production)
vite.config.ts        Dev middleware serves the same /api in dev
src/features/news      News section
src/features/markets   Markets section
src/features/settings  Settings / about
```

## Notes

- Market data is delayed and provided for information only — not financial
  advice.
- Yahoo Finance endpoints are public but unofficial; if a symbol stops
  returning data, its ticker may have changed.
- To wire a commercial data provider later (e.g. a licensed news or market
  API), swap the fetchers in `server/news.ts` / `server/stocks.ts` — the client
  and routes stay the same.
