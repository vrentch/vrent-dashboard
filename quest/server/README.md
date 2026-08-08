# VRENT Memory XR — multiplayer server

The authoritative server behind the six-character room codes. Customers join a
host's room by typing the code on a floating keyboard; everything that decides
who scored happens here, not on the headset.

- **Server-authoritative.** The server owns the deck. A card's `symbol` is
  `null` on the wire until that card is legitimately face-up, so a modified
  client cannot read the board out of a network trace — which matters the
  moment a leaderboard has a prize attached to it.
- **Shared rules.** Scoring, turn order, sudden-death elimination and the final
  summary all come from `shared/game.ts`, the same module the headset runs. The
  client and the server cannot disagree about who won.
- **No build step.** Node 22 strips the types at load time, in development and
  in production alike.

```
server/
  index.ts        HTTP + WebSocket transport: CORS, rate limits, /health, /stats
  rooms.ts        room registry and the authoritative match loop
  leaderboard.ts  persistent, atomically-written JSON leaderboard
  ai-runner.ts    drives AI opponents server-side
```

---

## Run it locally

```bash
npm install
npm run server          # http://localhost:8787
# or with reload:
npm run server:dev
```

```bash
curl localhost:8787/health
curl localhost:8787/stats
```

Requires Node 22.6+ (for `--experimental-strip-types`). `node --version`.

---

## Deploy

All three routes build the same image. The build context must be the app root —
the one holding both `server/` and `shared/` — because the server imports the
shared rules directly.

### Render (simplest)

```bash
cp server/render.yaml ./render.yaml     # Render only reads a root blueprint
git add render.yaml && git commit -m "Add Render blueprint" && git push
```

Dashboard → **New → Blueprint** → pick the repo → **Apply**. Set
`ALLOWED_ORIGINS` when prompted (see below). The blueprint already attaches a
1 GB disk at `/data` and points the health check at `/health`.

Use the **Starter** plan or higher. Free instances sleep, and a sleeping
instance drops every websocket in the room.

### Fly.io

```bash
fly launch --no-deploy --copy-config --config server/fly.toml
fly volumes create vrent_data --size 1 --region fra
fly secrets set ALLOWED_ORIGINS="https://play.vrent.ch" \
                STATS_TOKEN="$(openssl rand -hex 16)"
fly deploy --config server/fly.toml
```

Change `app = "vrent-memory-xr"` in `fly.toml` first — Fly app names are global.

If the logs show `leaderboard.readonly`, the volume mounted root-owned and the
unprivileged process cannot write it. One-time fix:

```bash
fly ssh console -C "chown -R node:node /data"
fly apps restart vrent-memory-xr
```

The server keeps playing either way; it just holds scores in memory until the
volume is writable.

### Any VPS with Docker

```bash
docker build -f server/Dockerfile -t vrent-memory-server .
docker volume create vrent-data
docker run -d --name vrent-memory --restart unless-stopped \
  -p 8787:8787 -v vrent-data:/data \
  -e ALLOWED_ORIGINS="https://play.vrent.ch" \
  -e STATS_TOKEN="$(openssl rand -hex 16)" \
  vrent-memory-server
```

Put it behind a TLS terminator (Caddy, nginx, Traefik) and forward websocket
upgrades. The headset app is served over HTTPS, so the socket **must** be
`wss://` — a browser refuses a plain `ws://` socket from an HTTPS page.

Minimal Caddy:

```
play-api.vrent.ch {
    reverse_proxy 127.0.0.1:8787
}
```

---

## What the headset app needs

One variable, set at build time on the **app** (not on this server):

```bash
VITE_SERVER_URL="wss://play-api.vrent.ch"   # no trailing path needed
npm run build:pro
```

`createNetClient(url, events)` accepts `wss://`, `ws://`, or an `https://` /
`http://` URL it upgrades for you. It also accepts the bare host with no path —
the server listens on both `/` and `/ws`.

Leave `VITE_SERVER_URL` **unset** for the Demo edition. The client then sits
permanently in `offline`, opens no sockets at all, and solo/AI play works
exactly as before. That is the intended Demo behaviour, not a failure mode.

---

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DATA_DIR` | `./data` | Leaderboard directory. Point at a persistent volume. |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated origin allowlist. **Set this in production.** |
| `STATS_TOKEN` | *(empty)* | Bearer token that unlocks per-room detail on `/stats`. |
| `MAX_CONNECTIONS` | `400` | Global socket cap. |
| `MAX_PER_IP` | `16` | Sockets from one address. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `LOG_JSON` | *(unset)* | `1` for JSON log lines instead of readable ones. |
| `TZ` | system | Which midnight the leaderboard's `today` scope rolls over at. |
| `AI_BRAIN_MODULE` | *(unset)* | Module to load the real AI brain from (see below). |
| `NODE_ENV` | *(unset)* | `production` disables the permissive CORS default. |

### ALLOWED_ORIGINS, precisely

- **Unset, `NODE_ENV` not `production`** — every origin is accepted. This is
  what `npm run dev` needs.
- **Unset, `NODE_ENV=production`** — browser clients are **refused**. Requests
  with no `Origin` header (health checkers, curl, native clients) still work.
  The server logs a loud `cors.unset` warning at boot.
- **Set** — exactly those origins, matched in full and case-sensitively
  (`https://play.vrent.ch`, not `play.vrent.ch`). List several with commas.

The Quest browser always sends an `Origin`, so a production deployment serving
the headset app from a website must set this.

---

## Operating it during an event

`GET /health` → `200` and JSON. Wire it to your platform's health check.

```json
{ "ok": true, "status": "healthy", "version": "1.0.0", "protocol": 1,
  "uptimeSec": 4210, "rooms": 3, "players": 11, "connections": 9,
  "leaderboard": "persistent", "time": "2026-08-08T14:22:03.118Z" }
```

`GET /stats` → room and player counts. Add the operator token for the room
list, because live room codes are the only thing keeping strangers out of a
customer's game:

```bash
curl "https://play-api.vrent.ch/stats?token=$STATS_TOKEN"
# or: curl -H "Authorization: Bearer $STATS_TOKEN" .../stats
```

Logs are one line per event, `event key=value`, readable over a shoulder and
greppable afterwards. Set `LOG_JSON=1` to ship them somewhere instead.

```
14:11:53 INFO  server.listening port=8787 version=1.0.0 protocol=1 env=production
14:12:07 INFO  room.created room=NPV4W5 host=p_msk… mode=classic pairs=10 maxPlayers=8
14:12:19 INFO  player.joined room=NPV4W5 name="Anna" seat=1 seats=2
14:13:02 INFO  match.started room=NPV4W5 mode=classic pairs=10 players=3 seed=2216…
14:13:44 INFO  player.dropped room=NPV4W5 name="Anna" holdSec=90
14:13:51 INFO  player.resumed room=NPV4W5 name="Anna" phase=playing
14:15:10 INFO  match.finished room=NPV4W5 reason=complete durationSec=128 winner="Anna" score=17
```

The ones worth reacting to: `cors.unset` and `leaderboard.readonly` at boot
(misconfiguration), `ws.rate-limited` / `ws.at-capacity` (someone is hammering
it), `handler.threw` (a bug — the room survives, but capture the line).

### Behaviour an operator should know

- **Room codes** come from `makeRoomCode` — six characters, no vowels and no
  `0/O/1/I/L`, so nothing reads badly in front of a client and nothing is
  ambiguous when read aloud. A code that is already live is never reissued.
- **Rooms expire** 30 minutes after their last activity; a sweeper runs every
  30 seconds. An empty room closes immediately.
- **A dropped headset keeps its seat for 90 seconds** and is skipped in the
  turn order meanwhile, so a Quest that goes to sleep mid-game wakes up back in
  its own seat with its score intact. After 90 seconds in a lobby the seat is
  released; **mid-match the roster entry stays** (removing it would rewrite
  every turn index and corrupt the final scoreboard) and only the resume token
  is retired.
- **Miss timing is server-side.** On a miss the server broadcasts `missed` with
  an absolute `hideAt`, then broadcasts `hidden` and advances the turn itself. A
  client never gets to tell the server that time has passed.
- **Turn timers.** With `settings.turnSeconds > 0` a player who runs out is
  auto-passed and `turnChanged` carries an absolute deadline. A timeout passes
  the turn; it does not eliminate anyone, even in Sudden Death.
- **Rate limiting** is 30 messages/sec per connection (small burst allowed),
  frames are capped at 16 KB, and sustained abuse closes the socket. There are
  also global and per-IP connection caps.
- **Clock skew is handled on the client.** All deadlines cross the wire as
  absolute server time; `src/net/client.ts` measures the offset from every
  pong and converts to local time before the UI sees it.

---

## Leaderboard

A single JSON file at `$DATA_DIR/leaderboard.json`, written atomically
(temp file → `fsync` → `rename`), so a crash or a redeploy mid-write cannot
leave a half-written file. Three scopes — `room`, `today`, `global` — capped at
500 entries each.

Entries are derived from the server's own `summarise()` output and its own
board. **A client-submitted score is never trusted, and AI players are never
recorded.** Equal scores share a rank, exactly as `summarise()` does it.

Back it up by copying the one file:

```bash
fly ssh console -C "cat /data/leaderboard.json" > backup.json   # Fly
docker cp vrent-memory:/data/leaderboard.json ./backup.json     # Docker
```

---

## AI opponents

The host can add AI seats to an online room; `ai-runner.ts` plays them
server-side, and their flips go through exactly the same validation as a
human's.

The real AI brain lives in **`src/ai/opponent.ts`** (implementing `AiOpponent`
from `src/contracts.ts`). It is deliberately not imported here, so the server
boots and plays a full game with no browser-side code present. `ai-runner.ts`
ships a modest built-in fallback and an injection hook:

```ts
import { setAiFactory } from "./ai-runner.ts";
import { createAiOpponent } from "../src/ai/opponent.ts";

setAiFactory((playerId, level) => createAiOpponent(playerId, level));
```

`AiOpponent` structurally satisfies the runner's `AiBrain`, so no adapter is
needed. Or point `AI_BRAIN_MODULE` at any module exporting `createAiOpponent`,
`createOpponent` or a default factory:

```bash
AI_BRAIN_MODULE=../src/ai/opponent.ts npm run server
```

A brain that throws, hangs (8 s), or returns an unplayable card is logged and
replaced with a fallback pick for that turn. A broken AI never stalls a room.

---

## Scaling notes

Rooms are held in memory, so this is a **single-instance** service. Two
instances behind a load balancer means two disjoint sets of rooms and two
leaderboards. One small machine handles a large event comfortably — a room
generates a few frames per second at most. Scale up (more CPU/RAM), not out,
until there is a shared store behind it.
