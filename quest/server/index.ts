/**
 * HTTP + WebSocket entry point for VRENT Memory XR multiplayer.
 *
 *   node --experimental-strip-types server/index.ts
 *
 * Everything transport-shaped lives here — listening, CORS, origin checks,
 * rate limiting, frame size, health and stats. The game itself lives in
 * `rooms.ts` behind the `Connection` seam, so a socket problem can never
 * corrupt a match and a rule change can never break the socket handling.
 *
 * Environment (all optional):
 *   PORT             listen port, default 8787
 *   HOST             bind address, default 0.0.0.0
 *   DATA_DIR         leaderboard directory, default ./data
 *   ALLOWED_ORIGINS  comma-separated origin allowlist; permissive in dev only
 *   STATS_TOKEN      bearer token that unlocks per-room detail on /stats
 *   MAX_CONNECTIONS  global socket cap, default 400
 *   MAX_PER_IP       sockets from one address, default 16
 *   LOG_LEVEL        debug | info | warn | error, default info
 *   LOG_JSON         1 to emit JSON log lines
 *   AI_BRAIN_MODULE  optional module to load the real AI brain from
 *   NODE_ENV         "production" turns off the permissive CORS default
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { createLeaderboard, DATA_DIR } from "./leaderboard.ts";
import type { Connection, Session } from "./rooms.ts";
import { createRegistry, log } from "./rooms.ts";
import { setAiFactory } from "./ai-runner.ts";
import type { AiFactory } from "./ai-runner.ts";

// ── Configuration ───────────────────────────────────────────────────────────

const PORT = toInt(process.env.PORT, 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const IS_PROD = process.env.NODE_ENV === "production";

/** One frame can never be bigger than this. A flip is about 30 bytes. */
const MAX_MESSAGE_BYTES = 16 * 1024;

/** Requirement: 30 messages/sec per connection. */
const RATE_LIMIT_PER_SEC = 30;
/** A little headroom so a legitimate burst (join + settings) is not punished. */
const RATE_BURST = 15;
/** Sustained abuse past this many rejected frames closes the socket. */
const RATE_STRIKES_MAX = 90;

const MAX_CONNECTIONS = toInt(process.env.MAX_CONNECTIONS, 400);
const MAX_PER_IP = toInt(process.env.MAX_PER_IP, 16);

/** Close a socket that connects and never says hello. */
const HANDSHAKE_TIMEOUT_MS = 15_000;
/** Two missed heartbeats and the socket is considered dead. */
const HEARTBEAT_INTERVAL_MS = 30_000;

const SERVER_VERSION = readVersion();
const STARTED_AT = Date.now();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

const STATS_TOKEN = process.env.STATS_TOKEN ?? "";

// ── Wiring ──────────────────────────────────────────────────────────────────

const leaderboard = createLeaderboard({ dir: DATA_DIR, log });
const registry = createRegistry({ leaderboard, serverVersion: SERVER_VERSION });

await loadAiBrain();

/**
 * The real AI lives in `src/ai/opponent.ts` (browser-side module owned
 * elsewhere). Point `AI_BRAIN_MODULE` at it — or at any module exporting a
 * factory — to run it server-side. Failure is never fatal: `ai-runner.ts`
 * falls back to its built-in policy.
 */
async function loadAiBrain(): Promise<void> {
  const spec = process.env.AI_BRAIN_MODULE;
  if (!spec) return;
  try {
    const mod = (await import(spec)) as Record<string, unknown>;
    const candidate = mod.createAiOpponent ?? mod.createOpponent ?? mod.default;
    if (typeof candidate !== "function") {
      log("warn", "ai.brain-no-factory", { module: spec });
      return;
    }
    setAiFactory(candidate as AiFactory);
    log("info", "ai.brain-loaded", { module: spec });
  } catch (err) {
    log("warn", "ai.brain-load-failed", { module: spec, error: describe(err) });
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  try {
    handleHttp(req, res);
  } catch (err) {
    log("error", "http.threw", { url: req.url, error: describe(err) });
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "server-error" }));
  }
});

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const path = (req.url ?? "/").split("?")[0];

  applyCors(res, typeof origin === "string" ? origin : undefined);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    json(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  if (path === "/health" || path === "/healthz") {
    const stats = registry.stats();
    json(res, 200, {
      ok: true,
      status: "healthy",
      version: SERVER_VERSION,
      protocol: PROTOCOL_VERSION,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      rooms: stats.rooms,
      players: stats.players,
      connections: sockets.size,
      leaderboard: leaderboard.stats().persistent ? "persistent" : "memory-only",
      time: new Date().toISOString(),
    });
    return;
  }

  if (path === "/stats") {
    const stats = registry.stats();
    const lb = leaderboard.stats();
    // Room codes are the only thing standing between the public internet and
    // someone's private game, so the room list needs the operator token.
    const detailed = statsAuthorised(req);
    json(res, 200, {
      ok: true,
      version: SERVER_VERSION,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      rooms: stats.rooms,
      players: stats.players,
      humans: stats.humans,
      ais: stats.ais,
      connectedPlayers: stats.connected,
      connections: sockets.size,
      sessions: stats.sessions,
      byPhase: stats.byPhase,
      leaderboard: { global: lb.global, today: lb.today, rooms: lb.rooms, persistent: lb.persistent },
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      detail: detailed ? stats.detail : undefined,
      detailHint: detailed ? undefined : "set STATS_TOKEN and pass ?token= for per-room detail",
    });
    return;
  }

  if (path === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(
      `VRENT Memory XR multiplayer server ${SERVER_VERSION}\n` +
        `protocol ${PROTOCOL_VERSION}\n` +
        `websocket endpoint: same host, path / or /ws\n` +
        `health: /health   stats: /stats\n`,
    );
    return;
  }

  json(res, 404, { ok: false, error: "not-found" });
}

function statsAuthorised(req: IncomingMessage): boolean {
  if (!STATS_TOKEN) return false;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth === `Bearer ${STATS_TOKEN}`) return true;
  const url = req.url ?? "";
  const q = url.indexOf("?");
  if (q < 0) return false;
  return new URLSearchParams(url.slice(q + 1)).get("token") === STATS_TOKEN;
}

function applyCors(res: ServerResponse, origin: string | undefined): void {
  const allowed = originAllowed(origin);
  if (allowed && origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  } else if (allowed) {
    res.setHeader("access-control-allow-origin", "*");
  }
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-max-age", "600");
}

/**
 * No allowlist in dev ⇒ anything goes, which is what `npm run dev` needs.
 * No allowlist in production ⇒ only non-browser clients (no Origin header),
 * because an open origin policy on a paid deployment is a real risk.
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // native app / curl / health checker
  if (ALLOWED_ORIGINS.length === 0) return !IS_PROD;
  return ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

// ── WebSocket ───────────────────────────────────────────────────────────────

interface SocketState {
  id: string;
  ip: string;
  session: Session;
  /** Token bucket for the 30 msg/sec limit. */
  tokens: number;
  lastRefill: number;
  strikes: number;
  lastRateWarnAt: number;
  alive: boolean;
  handshakeTimer: ReturnType<typeof setTimeout> | null;
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, clientTracking: false });
const sockets = new Map<WebSocket, SocketState>();
const perIp = new Map<string, number>();
let socketCounter = 0;
let shuttingDown = false;

httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path !== "/" && path !== "/ws") {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }
  if (shuttingDown) {
    rejectUpgrade(socket, 503, "Server Shutting Down");
    return;
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (!originAllowed(origin)) {
    log("warn", "ws.origin-rejected", { origin, ip: clientIp(req) });
    rejectUpgrade(socket, 403, "Forbidden Origin");
    return;
  }
  if (sockets.size >= MAX_CONNECTIONS) {
    log("warn", "ws.at-capacity", { connections: sockets.size, max: MAX_CONNECTIONS });
    rejectUpgrade(socket, 503, "Server Full");
    return;
  }
  const ip = clientIp(req);
  if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) {
    log("warn", "ws.per-ip-limit", { ip, max: MAX_PER_IP });
    rejectUpgrade(socket, 429, "Too Many Connections");
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
});

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  } catch {
    /* the peer is already gone */
  }
  socket.destroy();
}

function onConnection(ws: WebSocket, ip: string): void {
  socketCounter = (socketCounter + 1) % 0xffffff;
  const id = `c${socketCounter.toString(36)}`;

  const connection: Connection = {
    id,
    ip,
    send(msg: ServerMessage): void {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify(msg));
    },
    close(code: number, reason: string): void {
      try {
        ws.close(code, reason.slice(0, 120));
      } catch {
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
      }
    },
    isOpen(): boolean {
      return ws.readyState === 1;
    },
  };

  const session = registry.attach(connection);
  const state: SocketState = {
    id,
    ip,
    session,
    tokens: RATE_LIMIT_PER_SEC + RATE_BURST,
    lastRefill: Date.now(),
    strikes: 0,
    lastRateWarnAt: 0,
    alive: true,
    handshakeTimer: null,
  };
  sockets.set(ws, state);
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

  state.handshakeTimer = setTimeout(() => {
    if (!session.playerId) {
      log("debug", "ws.handshake-timeout", { conn: id, ip });
      connection.close(4408, "no hello");
    }
  }, HANDSHAKE_TIMEOUT_MS);
  if (typeof state.handshakeTimer.unref === "function") state.handshakeTimer.unref();

  log("debug", "ws.open", { conn: id, ip, connections: sockets.size });

  ws.on("message", (data: RawData, isBinary: boolean) => {
    try {
      if (isBinary) {
        connection.send({ t: "error", code: "invalid", message: "Binary frames are not accepted." });
        return;
      }
      const text = typeof data === "string" ? data : data.toString("utf8");
      if (text.length > MAX_MESSAGE_BYTES) {
        connection.send({ t: "error", code: "invalid", message: "Frame too large." });
        connection.close(1009, "frame too large");
        return;
      }
      if (!allowFrame(state, connection)) return;
      registry.handle(session, text);
    } catch (err) {
      // Absolutely nothing arriving on a socket may take the process down.
      log("error", "ws.message-threw", { conn: id, error: describe(err) });
    }
  });

  ws.on("pong", () => {
    state.alive = true;
  });

  ws.on("error", (err: Error) => {
    log("debug", "ws.error", { conn: id, error: err.message });
  });

  ws.on("close", (code: number, reasonBuf: Buffer) => {
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    sockets.delete(ws);
    const left = (perIp.get(ip) ?? 1) - 1;
    if (left <= 0) perIp.delete(ip);
    else perIp.set(ip, left);
    const reason = reasonBuf?.toString("utf8").slice(0, 60) || String(code);
    try {
      registry.detach(session, reason);
    } catch (err) {
      log("error", "ws.detach-threw", { conn: id, error: describe(err) });
    }
    log("debug", "ws.close", { conn: id, code, reason, connections: sockets.size });
  });
}

/** Token bucket: 30 messages/sec sustained, small burst, then the door. */
function allowFrame(state: SocketState, conn: Connection): boolean {
  const at = Date.now();
  const elapsed = (at - state.lastRefill) / 1000;
  if (elapsed > 0) {
    state.tokens = Math.min(RATE_LIMIT_PER_SEC + RATE_BURST, state.tokens + elapsed * RATE_LIMIT_PER_SEC);
    state.lastRefill = at;
  }
  if (state.tokens >= 1) {
    state.tokens -= 1;
    if (state.strikes > 0) state.strikes -= 1;
    return true;
  }

  state.strikes += 1;
  if (at - state.lastRateWarnAt > 2000) {
    state.lastRateWarnAt = at;
    conn.send({ t: "error", code: "rate-limited", message: "Slow down — too many messages." });
    log("warn", "ws.rate-limited", { conn: state.id, ip: state.ip, strikes: state.strikes });
  }
  if (state.strikes > RATE_STRIKES_MAX) {
    log("warn", "ws.rate-kick", { conn: state.id, ip: state.ip });
    conn.close(1008, "rate limit");
  }
  return false;
}

/** Ping every socket; anything that missed the last round is dead. */
const heartbeat = setInterval(() => {
  for (const [ws, state] of sockets) {
    if (!state.alive) {
      log("debug", "ws.heartbeat-timeout", { conn: state.id });
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      continue;
    }
    state.alive = false;
    try {
      ws.ping();
    } catch {
      /* the close handler will clean up */
    }
  }
}, HEARTBEAT_INTERVAL_MS);
if (typeof heartbeat.unref === "function") heartbeat.unref();

// ── Boot ────────────────────────────────────────────────────────────────────

await leaderboard.ready();

httpServer.listen(PORT, HOST, () => {
  log("info", "server.listening", {
    port: PORT,
    host: HOST,
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    dataDir: DATA_DIR,
    env: IS_PROD ? "production" : "development",
    node: process.version,
  });
  if (ALLOWED_ORIGINS.length > 0) {
    log("info", "cors.allowlist", { origins: ALLOWED_ORIGINS.join(" ") });
  } else if (IS_PROD) {
    log("warn", "cors.unset", {
      hint: "ALLOWED_ORIGINS is empty in production — browser clients will be refused. Set it to the origin serving the headset app, e.g. https://play.vrent.ch",
    });
  } else {
    log("warn", "cors.permissive", { hint: "development default: every origin is accepted" });
  }
  if (!STATS_TOKEN) log("info", "stats.public-summary-only", { hint: "set STATS_TOKEN for per-room detail" });
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log("error", "server.port-in-use", { port: PORT });
    process.exit(1);
  }
  log("error", "server.error", { error: err.message });
});

// ── Shutdown & last-resort guards ───────────────────────────────────────────

let shutdownStarted = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  log("info", "server.shutdown", { signal, rooms: registry.stats().rooms, connections: sockets.size });

  clearInterval(heartbeat);
  for (const [ws] of sockets) {
    try {
      ws.close(1012, "server restarting");
    } catch {
      /* already gone */
    }
  }
  registry.shutdown();
  try {
    await leaderboard.dispose();
  } catch (err) {
    log("error", "shutdown.leaderboard", { error: describe(err) });
  }

  httpServer.close(() => {
    log("info", "server.stopped", {});
    process.exit(0);
  });
  // Never let a lingering socket hold a deploy hostage.
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  // Every inbound path is already wrapped; anything reaching here is a bug in
  // ours or a dependency's async code. During a live event, staying up with a
  // loud log beats dropping eight headsets out of a game.
  log("error", "process.uncaught", { error: describe(err), stack: err instanceof Error ? err.stack : undefined });
});

process.on("unhandledRejection", (reason) => {
  log("error", "process.unhandled-rejection", { error: describe(reason) });
});

// ── Small helpers ───────────────────────────────────────────────────────────

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function toInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
