# Clearhead

A standalone night-out copilot: log every drink with one tap and it estimates
your blood alcohol (‰), reminds you to drink water, paces your rounds and tells
you when it's time to stop — with alarms built to actually get through.

**Separate from the AC App.** It lives entirely in this folder plus one
serverless function (`api/clearhead.ts`) and one workflow
(`.github/workflows/clearhead-tick.yml`). It shares only the deployment's
existing push plumbing (VAPID keys + Vercel KV); no AC App code is touched.

## Get it on your phone

1. Open **`https://<your-domain>/clearhead/`** (production: the same Vercel
   deployment as the AC App).
2. Install it: Android — browser menu → *Install app*; iPhone — Safari →
   Share → *Add to Home Screen* (required for lock-screen alarms on iOS).
3. In Settings (⚙︎): **Enable lock-screen alarms** (Web Push) and pick your
   alarm arsenal (siren, screen flash, flashlight blink).

## How the alarms work (three layers)

1. **In-app storm** — while Clearhead is open: repeating two-tone siren,
   screen strobe (≤2 flashes/sec), vibration loop, flashlight blink (Android,
   with camera permission), full-screen takeover that re-rings until dismissed.
2. **Night watch** (🛡, auto-armed on your first drink) — a whisper-quiet audio
   loop keeps the tab alive while the phone is locked, so timers still fire and
   the siren rings straight over the lock screen. Keep the app open at night.
3. **Server push** — the safety net. The app schedules its pending reminders
   (water / pace / "still out?" check-in) on the server; a GitHub Actions cron
   pings `/api/clearhead?op=tick` every ~5 minutes and fires anything due as a
   real push notification — arrives with the screen locked and even if the
   browser was killed. (Granularity ≈ 5–10 min; the in-app timers stay exact.)

Requirements for layer 3: `VAPID_PRIVATE` + Vercel KV env vars (already used
by the AC App's notifications) and the cron workflow on the default branch.

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

Everything personal stays on the device (`localStorage`); the server stores
only a push subscription plus pending alarm times, auto-expiring within ~28h.

## Disclaimer

Estimates only — real BAC varies with food, medication and physiology.
Never a green light to drive. Not medical advice. Emergencies in CH: 144.
