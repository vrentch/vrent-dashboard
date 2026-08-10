# Handoff: putting Memory XR on vrent.ch

Written to be executed by whoever owns the vrent.ch site. Everything the game
needs is already built and pushed on branch
`claude/meta-quest-memory-game-apk-1kvkro`, under `quest/`.

There are two jobs, in this order. They cannot be swapped.

1. **Host the game** at a real HTTPS URL.
2. **Point vrent.ch at it** — a link, an embed, or a subdomain.

---

## Why it cannot just be dropped into the site

The game is a WebXR application, not a widget. Two constraints drive
everything below:

- **HTTPS is mandatory.** `navigator.xr` does not exist outside a secure
  context. On plain HTTP, or from a LAN address, the page loads and the
  flat-screen version plays, but the headset can never enter VR or
  passthrough. Silent failure — no error, the button just does nothing.
- **It is ~2 MB of static files with its own page.** It is not a script you
  paste into an existing page. It needs its own document.

---

## Job 1 — host it

Any static host works. Pick whichever matches how vrent.ch is already run.

**Build command** (Node 22, run inside `quest/`):

```bash
npm ci
npm run build:pro          # -> dist/
```

Set `VITE_SERVER_URL` at build time only if the multiplayer server is
deployed (see the bottom of this file). Without it the game still runs — it
offers solo and AI play and hides the multiplayer entries.

### Option A — GitHub Pages (no new accounts)

A workflow is already committed at `.github/workflows/quest-pages.yml`.

1. Merge the branch to `main` (the workflow must exist on the default branch
   before `workflow_dispatch` will list it).
2. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions → **Quest web demo** → Run workflow → edition `pro`.

Private repositories need GitHub Pro, Team or Enterprise for Pages. On a free
private repo, use Option B.

### Option B — Vercel or Netlify

Import `vrentch/vrent-dashboard`, then:

| Setting | Value |
| --- | --- |
| Root directory | `quest` |
| Build command | `npm run build:pro` |
| Output directory | `dist` |
| Node version | 22 |

Both have a free tier that covers this comfortably.

### Option C — the existing vrent.ch hosting

`npm run build:pro`, then upload the contents of `dist/` to a path such as
`/game/`. `vite.config.ts` sets `base: "./"`, so the bundle works from any
subpath with no rebuild.

Whatever you choose, the result is one URL. Everything below needs it.

---

## Job 2 — point vrent.ch at it

### Preferred: a direct link

A button or card on vrent.ch linking to the game URL, opening in the same tab.
Nothing to configure, and the headset gets a clean top-level document, which
is the most reliable place to start an XR session.

Suggested copy, matching what the game already says about itself:

> **Try Memory XR** — plays in your browser now, or open it in the Meta Quest
> Browser for the full mixed-reality game.

### If it must be embedded in a Wix or CMS page

**The iframe needs an explicit permissions policy or VR will not work:**

```html
<iframe
  src="https://YOUR-GAME-URL/"
  title="VRENT Memory XR"
  allow="xr-spatial-tracking; fullscreen; autoplay"
  allowfullscreen
  style="width:100%;aspect-ratio:16/10;border:0;border-radius:16px"
></iframe>
```

`allow="xr-spatial-tracking"` is the part people miss. Without it the embed
plays fine on a laptop and silently refuses to enter VR on a Quest, which is
the single worst outcome — it looks like the product is broken.

Wix specifically: use **Embed → Custom Element / HTML iframe**, paste the
markup above, and confirm Wix has not stripped the `allow` attribute after
saving. Some builders do. If it strips it, fall back to a direct link.

### Best of both: a subdomain

Point `game.vrent.ch` (or `xr.vrent.ch`) at the host from Job 1 via a CNAME,
and link to it from the main site. Keeps the game on your own domain, keeps
it a top-level document, avoids the iframe policy problem entirely.

---

## What to check before calling it done

Run through this on the deployed URL, not on a local build:

- [ ] Loads over **https://**, no mixed-content warnings in the console.
- [ ] Desktop: **Play on this screen** starts a game; dragging looks around.
- [ ] Desktop: the **What it costs** section shows all prices.
- [ ] Light and dark both render (toggle is in the header, and it follows the
      visitor's OS setting on first visit).
- [ ] Phone at 390px wide: pricing cards stack, nothing overflows sideways.
- [ ] **On a Quest 3, in the Quest Browser**: the entry screen offers **Enter
      Mixed Reality**, and tapping it shows the board on your real table.
      If that button is missing or does nothing, HTTPS or the iframe `allow`
      attribute is the cause — nothing else.

---

## Optional: multiplayer

Solo and AI play need no server. Room codes do.

`quest/server/` is a standalone Node WebSocket service with Docker, Render and
Fly configs in `quest/server/README.md`. Deploy it, then rebuild the site with
`VITE_SERVER_URL=wss://your-server-host` so the client knows where to connect.

Two environment variables matter in production:

- `ALLOWED_ORIGINS` — must include the site origin, or the Quest browser's
  origin header gets refused.
- `STATS_TOKEN` — gates the room list on `/stats`. Live room codes are the
  only thing keeping strangers out of a customer's game.

---

## Optional: the AI assistant

The in-headset assistant answers from an on-device knowledge base with no
network. To also allow free-form questions, deploy `quest/api/assistant.ts` as
a serverless function and set `ANTHROPIC_API_KEY` in the server environment.

The key must never reach the bundle. If it is unset the endpoint returns
"unavailable" and the headset silently uses its offline answers, which is the
intended fallback rather than a failure.

---

## Do not

- Do not serve it over HTTP, or from a LAN IP, and expect VR to work.
- Do not embed it without `allow="xr-spatial-tracking"`.
- Do not commit a keystore, an API key, or `STATS_TOKEN` to the repo.
- Do not change prices in the page markup — they are generated from
  `quest/shared/editions.ts`. Edit that one file and rebuild.
