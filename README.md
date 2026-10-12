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

## Studio (AI Instagram content)

The **Studio** tab turns your photos into ready-to-publish Instagram content:

1. Set up your **brand kit** once (logo, name, handle, colors, caption
   language) — it's stamped onto every design.
2. Upload up to 4 photos, describe the post, and pick formats (post / story /
   reel). Optionally tap **AI brief** — the AI looks at your photos and asks
   3 multiple-choice questions to sharpen the result.
3. The AI (strongest configured Claude model, `AI_STUDIO_MODEL` env override)
   returns a caption + hashtags, art-directed layouts rendered on-device at
   Instagram-native sizes, an engagement-sticker idea, and a scene-by-scene
   reel plan you can export as an animated video.
4. Everything is saved to the **Library**, auto-organized into categories the
   AI assigns. Download anything, or use **Share** on your phone to send a
   design straight into the Instagram app.

## The Daily Game (targets, scored at 22:00)

A game you play against yourself. Open it from the **tile on Home**.

**Targets.** Add, adjust, retire or delete them at any time. Each one carries:

- a **measure** — tick it off, log a number against a goal, or keep a limit
  clean ("avoid it", which starts the day satisfied and breaks when you log a
  slip);
- a **priority** — Low ×1, Normal ×2, Important ×3, Non-negotiable ×5, which is
  literally its weight in the day score;
- a **cadence** — every day, Mon–Fri, weekends, chosen weekdays, *n*× a week or
  month, or a one-off. A quota target ("4× a week") sits on the board as
  optional and turns **required** only once you can no longer afford to skip
  it;
- a **timeline** — a plain daily habit, or a week/month/quarter/year campaign
  where the daily logs add up to a bigger total with its own pace bar;
- an optional **end date** plus a **renewal mode** — retire on that date, or
  shift the whole window forward a week/month/quarter/year and come back for
  another term.

**The score.** At your close time (22:00 by default) the day is sealed and
scored 0–100: the weighted share of the required targets you actually
delivered. Overachievement and quota work banked early land in a bonus pool, so
a day can never exceed 100 but extra effort still pays XP. A day with nothing
due is a rest day — it costs you nothing and doesn't break a streak.

**The rival.** A ghost whose daily form is built from *your* last few scores,
then shifted by the difficulty you pick (Warm-up → Nemesis) and a deterministic
daily wobble. It learns: a winning run makes it raise its game, a losing run
makes it ease off. Its number is visible from the morning, so you always know
the bar. Beat it and the verdict screen celebrates; lose and it tells you
exactly which single target would have flipped the result.

**Prizes.** XP and levels (Rookie → Legend) with a growth path you can see,
~49 achievements across four tiers, and weekly / monthly / yearly medals
(bronze → platinum) that need both a quality average *and* a number of days
played. Each calendar month is a season with its own recap. Weekly challenges
and a monthly boss fight are generated from the targets you actually own.

**Everything stays on the device.** Targets, logs, scores and trophies live in
`localStorage` — nothing about them is sent anywhere. The only optional server
touch is a "day close" push notification (Settings → Notifications), and it
carries no data, just the whistle.

Internally, the store holds **only facts** (targets, logs, settings); every
score, streak, badge and medal is derived by pure functions, so fixing a
forgotten entry honestly re-scores the day instead of leaving a stale total
behind.

## Project structure

```
shared/catalog.ts     Countries & topics (edit to add more)
server/               RSS + Yahoo data layer (framework-agnostic)
api/[...path].ts      Serverless entry (production)
vite.config.ts        Dev middleware serves the same /api in dev
src/features/news      News section
src/features/markets   Markets section
src/features/game      The Daily Game (Arena / Targets / Growth / Trophies)
src/lib/game           Game engine — store (facts) + pure scoring/achievements
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

Only market open/close, the daily recap and the Daily Game's close-time whistle
are sent — no calendar, watchlist or target data leaves the device. Generate a fresh VAPID pair anytime with
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
