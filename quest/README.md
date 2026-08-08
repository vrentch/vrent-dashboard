# VRENT Memory XR

A commercial mixed-reality memory game for the Meta Quest 3. Up to eight people
in one room flip cards on a table that is either their real table, seen through
passthrough, or a chosen virtual environment.

It is a **WebXR app**, built with Three.js and Vite, delivered as an installable
PWA and packaged into a signed Quest APK. There is no native code: the same
build runs in a browser, on the vrent.ch showcase page, and inside the headset.

## Quick start

```bash
npm install
npm run icons          # generate app icons from the brand palette
npm run environments   # generate the placeholder 360 panoramas (about 15s)
npm run dev            # http://localhost:5180
```

Open the printed URL in the Quest 3 browser (same wifi) and use the Enter VR
button. For multiplayer, run the realtime server alongside it:

```bash
npm run server:dev     # ws://localhost:8787
```

## The three editions

One codebase, three APKs. The edition is fixed at build time by `VITE_EDITION`
and gates features at runtime, so a Demo build cannot be talked into Pro
behaviour by editing local storage. The definitions live in
`shared/editions.ts`, which is the source of truth for everything downstream —
package ids, store metadata, icons, feature flags.

| | Demo | Pro | Enterprise |
| --- | --- | --- | --- |
| Package id | `ch.vrent.memoryxr.demo` | `ch.vrent.memoryxr` | `ch.vrent.memoryxr.enterprise` |
| Online multiplayer | no | yes, 8 players | yes, 8 players |
| AI opponents | yes | yes | yes |
| Environments | 4 | all | all |
| Custom 360 upload | no | no | yes |
| Global leaderboard | no | yes | yes |
| White label | no | no | yes |
| Watermark | yes | no | no |
| Session limit | 10 min | none | none |

```bash
npm run build:demo         # -> dist-demo
npm run build:pro          # -> dist-pro
npm run build:enterprise   # -> dist-enterprise
npm run build:all
npm run typecheck
```

Regenerate the PWA manifest to match before each edition build, so the deployed
manifest describes the edition that is actually deployed:

```bash
EDITION=demo node scripts/gen-manifests.mjs && npm run build:demo
```

## Layout

```
shared/      source of truth shared by app, server and build scripts
  brand.ts        palette, product names, package root. Re-skin here.
  editions.ts     the three editions and their feature gates
  environments.ts the environment catalogue
  game.ts         match rules and state
  protocol.ts     the client/server wire format
src/
  core/        renderer, XR session, input, raycasting, audio
  env/         procedural scenes, panoramas, environment switching
  game/        board, cards, layout, symbols
  net/         websocket client
  ai/          AI opponents and the in-game assistant
  ui/          2D entry screen and in-headset spatial panels
server/      realtime server: rooms, matchmaking, leaderboard
scripts/     asset and metadata generators (plain Node ESM, never bundled)
public/      copied verbatim into every dist: icons, panoramas, manifests
android/     APK packaging inputs and the build runbook
```

## Generated assets

Three generators produce everything that would otherwise be a binary blob
someone has to maintain by hand. All three read `shared/brand.ts` and friends,
so re-skinning the product for a customer is a palette edit plus a re-run.

| Command | Produces |
| --- | --- |
| `npm run icons` | `public/icons/` — 192/512/512-maskable PNGs for the house set and each edition, plus `favicon.svg` |
| `npm run environments` | `public/environments/` — three 4096x2048 equirectangular JPGs |
| `node scripts/gen-manifests.mjs` | `public/manifest.webmanifest` and `android/twa-manifest.<edition>.json` |

The panoramas are placeholders meant to be replaced with a customer's own 360
photography. `public/environments/README.md` documents the required format.

The icons are opaque and full bleed; the maskable variant keeps its artwork
inside the central safe zone because Horizon applies its own mask.

## Deploy topology

Two independent pieces. They are deployed separately and can live anywhere.

**1. The web app — a static site.**
`npm run build:<edition>` produces a folder of static files. Host it on any
HTTPS origin (Vercel, Netlify, S3, nginx). This is what the headset loads, and
it is also what the Quest APK wraps. Because `vite.config.ts` sets
`base: "./"`, the bundle works at a domain root or under a path prefix.

Three things must be reachable at the deploy domain before an APK can be built:

```
/manifest.webmanifest
/icons/<edition>/icon-512.png
/icons/<edition>/icon-512-maskable.png
/.well-known/assetlinks.json      (before the APK will launch)
```

**2. The realtime server — a small Node process.**
`server/index.ts` runs the WebSocket rooms, matchmaking by six-character code,
and the persistent leaderboard. Only the Pro and Enterprise editions connect to
it; a Demo build is fully standalone and needs no server at all, which is what
makes it safe to run on a trade-show kiosk with no network.

```bash
npm run server         # PORT, HOST, DATA_DIR, ALLOWED_ORIGINS, ...
```

Set `ALLOWED_ORIGINS` to the deploy domain in production. The server keeps its
leaderboard on disk in `DATA_DIR`, so give it a persistent volume.

A headset only needs the static site. The server is optional infrastructure for
the editions that offer online play.

## Building the APK

See **[`android/README.md`](android/README.md)** for the full runbook: keystore
creation and the warning that goes with it, the scripted bubblewrap build,
Digital Asset Links, sideloading with `adb`, and the Horizon Store upload.

The short version is that you should let CI do it:
**Actions -> Quest APK -> Run workflow**, pick an edition and a domain.

Two constraints worth knowing before you read that document:

- `horizonOSAppMode` must be `"immersive"` in every TWA manifest. This is a
  WebXR app; `"2D"` gives you a flat window with a browser URL bar.
- The signing key is permanent and unrecoverable. Back it up before you use it.

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `quest-ci.yml` | push or PR touching `quest/**` | Typecheck, build all three editions, verify the generated packaging metadata is committed and current |
| `quest-apk.yml` | manual, or a `quest-v*` tag | Build and sign an APK, verify the signature and app mode, upload it as an artifact |
