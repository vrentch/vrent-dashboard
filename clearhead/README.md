# Clearhead

A standalone night-out copilot: log every drink with one tap and it estimates
your blood alcohol (‰), reminds you to drink water, paces your rounds and tells
you when it's time to stop.

**Completely separate from the AC App** — no build step, no server, no account.
One self-contained HTML file; everything is stored locally on the device
(`localStorage`).

## Use it

Open `clearhead/index.html` in any browser — or serve the folder statically.
On a phone, keep the tab open during the night and use the 🔆 button
(screen wake lock) so reminders can fire; alarms ring, vibrate and pop
full-screen. Optional browser notifications can be enabled in Settings.

## What it does

- **Profile**: sex, weight, height, age → Widmark formula refined with the
  Watson total-body-water model (the more cautious of the two is used).
  Absorption ~30 min per drink, elimination 0.15‰/h.
- **Live BAC gauge** with zones (0.5‰ Swiss driving limit, 0.8, 1.2, 2.0) and
  estimated "under 0.5‰ / fully clear" times.
- **Water alarms** ~20 min after each drink (configurable), one-tap
  "I drank water" logging.
- **Pacing**: recommended gap between drinks (default 45 min) with countdown,
  too-fast warnings, a food break every 3rd drink, and a drinks-per-night cap.
- **Drink catalog**: beer, wine, bubbles, G&T, Moscow Mule, spritz, shots and
  more — plus a custom drink entry. Cocktails are counted by their actual
  spirit content.
- **Night log & summary**: per-night history, peak ‰, standard units, waters.

## Disclaimer

Estimates only — real BAC varies with food, medication and physiology.
Never a green light to drive. Not medical advice. Emergencies in CH: 144.
