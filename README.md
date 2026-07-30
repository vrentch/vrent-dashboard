# AC App

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

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vrentch/vrent-dashboard&project-name=ac-news&repository-name=ac-news)

Click the button, sign in with GitHub, and press **Deploy**. Vercel
auto-detects Vite and the `/api` function — no configuration needed.

Alternatively, import the existing repo at
[vercel.com/new](https://vercel.com/new) (pick `vrent-dashboard` → Deploy).

### Then install on your phone

Open the deployed URL on your phone → browser menu → **Add to Home Screen**.
It launches full-screen like a native app called **AC App**.

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

## Notifications (optional, one-time setup)

Phone push (market open/close + a daily recap) needs a tiny free backend. In
the deployed project:

1. **Vercel → Storage → Create Database → KV** (Upstash), connect it to the
   project. This adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically.
2. **Vercel → Settings → Environment Variables**: add `VAPID_PRIVATE` (the
   private key that pairs with the public key in `src/lib/push.ts`) and
   optionally `VAPID_SUBJECT` = `mailto:you@example.com`.
3. Ensure **GitHub Actions** are enabled — `.github/workflows/notify-tick.yml`
   pings `/api/tick` every ~5 min to deliver alerts (free).
4. **Redeploy**, then in the installed app: **Settings → Notifications →
   Enable**.

Only market open/close and the daily recap are sent — no calendar or watchlist
data leaves the device. Generate a fresh VAPID pair anytime with
`node -e "console.log(require('web-push').generateVAPIDKeys())"` (update the
public key in `src/lib/push.ts` and `VAPID_PUBLIC` in `api/[...path].ts`).

## Notes

- Market data is delayed and provided for information only — not financial
  advice.
- Yahoo Finance endpoints are public but unofficial; if a symbol stops
  returning data, its ticker may have changed.
- To wire a commercial data provider later (e.g. a licensed news or market
  API), swap the fetchers in `server/news.ts` / `server/stocks.ts` — the client
  and routes stay the same.
