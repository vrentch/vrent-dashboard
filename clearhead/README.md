# Clearhead

A standalone night-out copilot: log every drink with one tap and it estimates
your blood alcohol (‰), reminds you to drink water, paces your rounds and tells
you when it's time to stop — with alarms built to actually get through.

**Fully standalone.** Its own Vercel project (`clearhead`), its own push keys.
No connection to any other app or domain. One static page + one serverless
function; everything personal stays on the device (`localStorage`).

## Use it on your phone

1. Open **https://clearhead-vrentchs-projects.vercel.app** on your phone.
2. Install it: Android — browser menu → *Install app*; iPhone — Safari →
   Share → *Add to Home Screen* (required for lock-screen alarms on iOS).
3. In Settings (⚙︎): **Enable lock-screen alarms** and pick your alarm
   arsenal (siren, screen flash, flashlight blink).

## How the alarms work (three layers)

1. **In-app storm** — while Clearhead is open: repeating two-tone siren,
   screen strobe (≤2 flashes/sec), vibration loop, flashlight blink (Android,
   with camera permission), full-screen takeover that re-rings until dismissed.
2. **Night watch** (🛡, auto-armed on your first drink) — a whisper-quiet audio
   loop keeps the tab alive while the phone is locked, so timers still fire and
   the siren rings straight over the lock screen. Keep the app open at night.
3. **Server push** — the safety net. The app schedules its pending reminders
   (water / pace / "still out?" check-in) on the server; the `clearhead-tick` GitHub
   Actions workflow pings `/api/clearhead?op=tick` every ~5 minutes and fires
   anything due as a real push notification — arrives with the screen locked
   and even if the browser was killed. Granularity ≈ 5–10 min; the in-app
   timers stay exact.

### Enabling layer 3 (one-time, ~2 minutes)

The function reports `configured:false` until the Vercel project has:

- `VAPID_PRIVATE` — the private half of the app's push keypair (the public
  half is hardcoded in `index.html` / `api/clearhead.ts`).
- An Upstash Redis from the Vercel Marketplace (its `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` env vars are injected automatically).

Then redeploy. Without these, layers 1–2 still work fully.

## What it tracks

- **Profile**: sex, weight, height, age → Widmark formula refined with the
  Watson total-body-water model (the more cautious of the two is used).
  Absorption ~30 min per drink, elimination 0.15‰/h.
- **Live BAC gauge** with zones (0.5‰ Swiss driving limit, 0.8 / 1.2 / 2.0)
  and estimated "under 0.5‰ / fully clear" times.
- **Water alarms** ~20 min after each drink, one-tap water logging.
- **Pacing**: recommended gap between drinks with countdown, too-fast
  warnings, a food break every 3rd drink, and a drinks-per-night cap.
- **Drink catalog**: beer, wine, bubbles, G&T, Moscow Mule, spritz, shots and
  more — plus custom entries. Cocktails are counted by actual spirit content.
- **Night log & summary**: per-night history, peak ‰, standard units, waters.

The server stores only a push subscription plus pending alarm times,
auto-expiring within ~28 h.

## Disclaimer

Estimates only — real BAC varies with food, medication and physiology.
Never a green light to drive. Not medical advice. Emergencies in CH: 144.

## Deployment

The app is deployed file-based to the Vercel project `clearhead`
(production alias `clearhead-vrentchs-projects.vercel.app`). `build.mjs`
generates the icons at build time and unpacks `index.html` from the
`idx-*.b64` chunk files (gzip+base64 of `index.html`, split for transport;
regenerate with `gzip -9 -c index.html | base64 -w0` and re-split if you
edit the app). `index.html` in this folder is the canonical source.
