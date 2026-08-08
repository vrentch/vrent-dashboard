/**
 * The headset's end of the wire protocol.
 *
 * Three things matter more than anything else here, because all three happen
 * in front of paying customers:
 *
 *  1. **It degrades to nothing.** With no URL — the Demo edition ships with no
 *     server at all — the client sits in `offline`, every call is a no-op and
 *     solo/AI play carries on untouched. It never throws at the caller.
 *  2. **It survives a sleeping headset.** A Quest that naps mid-game keeps a
 *     socket that looks open but is dead. Heartbeats detect that, backoff
 *     reconnects, and the stored resume token reclaims the same seat, score and
 *     turn position rather than joining as a stranger.
 *  3. **Deadlines are honest.** `hideAt` and `deadline` are absolute times on
 *     the *server's* clock; a headset's clock can be minutes out. Every pong
 *     measures the offset, and timestamps are converted to local epoch ms
 *     before they reach `NetEvents`, so a countdown ring is never wrong.
 */

import type { AiLevel } from "../../shared/editions.ts";
import type { GameSettings } from "../../shared/game.ts";
import type { ClientMessage, EmoteId, RoomView, ServerMessage } from "../../shared/protocol.ts";
import { PROTOCOL_VERSION, decode, encode } from "../../shared/protocol.ts";
import type { NetClient, NetEvents, NetStatus } from "../contracts.ts";

/** 1s → 2s → 4s → 8s → 15s, then 15s forever. Jittered on every attempt. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;
const JITTER = 0.25;

const HEARTBEAT_MS = 10_000;
/** No pong in this long and the link is dead, whatever the socket claims. */
const PONG_TIMEOUT_MS = 25_000;
/** How long the first `connect()` waits before reporting failure. */
const CONNECT_TIMEOUT_MS = 10_000;

const STORAGE_KEY = "vrent.memoryxr.net";

export interface NetClientOptions {
  /** Sent in `hello`; defaults to `VITE_EDITION`, else "pro". */
  edition?: string;
  /** localStorage key for the resume token. Set per-edition to keep them apart. */
  storageKey?: string;
  /** Keep retrying after the first failed connect. Default true. */
  autoReconnect?: boolean;
  /** Diagnostics sink. Defaults to `console`. */
  logger?: (level: "debug" | "info" | "warn", event: string, detail?: unknown) => void;
}

interface Persisted {
  token: string;
  playerId: string;
  code: string | null;
}

/**
 * Builds a client bound to `url`. Pass an empty string (or anything that is
 * not a ws/wss URL) to get a permanently-offline client — that is the Demo
 * edition's path and it must never touch the network.
 */
export function createNetClient(url: string, events: NetEvents, options: NetClientOptions = {}): NetClient {
  const endpoint = normaliseUrl(url);
  const edition = options.edition ?? readEnvEdition();
  const storageKey = options.storageKey ?? STORAGE_KEY;
  const autoReconnect = options.autoReconnect !== false;
  const logger = options.logger ?? defaultLogger;

  let status: NetStatus = "offline";
  let socket: WebSocket | null = null;
  let playerId: string | null = null;
  let displayName = "Player";

  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  let rtt = -1;
  let lastPongAt = 0;
  let pingSentAt = 0;
  /** serverTime − localTime, smoothed. Added to local, subtracted from server. */
  let clockOffset = 0;
  let clockSynced = false;

  let stopped = true;
  let lastRoom: RoomView | null = null;
  /** Has this socket already had a welcome? Tells a resume from a seat grant. */
  let welcomedThisSocket = false;
  /** Replayed once the socket is up: the room we intend to be in. */
  let pendingIntent: ClientMessage | null = null;
  let joinedCode: string | null = null;

  let connectResolve: (() => void) | null = null;
  let connectReject: ((err: Error) => void) | null = null;

  const persisted = loadPersisted(storageKey);
  let resumeToken = persisted?.token ?? "";
  if (persisted?.code) joinedCode = persisted.code;

  // ── Status & events ───────────────────────────────────────────────────────

  function setStatus(next: NetStatus): void {
    if (status === next) return;
    status = next;
    logger("debug", "net.status", next);
    safely(() => events.onStatus(next));
  }

  /** A throwing UI handler must not break the socket loop. */
  function safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logger("warn", "net.handler-threw", err);
    }
  }

  // ── Clock ─────────────────────────────────────────────────────────────────

  function toLocal(serverTs: number): number {
    if (!Number.isFinite(serverTs) || serverTs <= 0) return serverTs;
    return serverTs - clockOffset;
  }

  function localiseRoom(room: RoomView): RoomView {
    if (clockOffset === 0) return room;
    return { ...room, turnDeadline: toLocal(room.turnDeadline), startedAt: toLocal(room.startedAt) };
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  function connect(name: string): Promise<void> {
    displayName = cleanName(name) || displayName;

    if (!endpoint) {
      // Demo edition / no server configured. Nothing to do, and that is fine.
      logger("info", "net.offline", "no server URL configured — solo and AI play only");
      setStatus("offline");
      return Promise.resolve();
    }
    if (typeof WebSocket === "undefined") {
      logger("warn", "net.no-websocket", "this runtime has no WebSocket");
      setStatus("offline");
      return Promise.resolve();
    }
    if (status === "online") return Promise.resolve();

    stopped = false;
    attempt = 0;

    return new Promise<void>((resolve, reject) => {
      connectResolve = resolve;
      connectReject = reject;
      clearTimer(connectTimer);
      connectTimer = setTimeout(() => {
        finishConnect(new Error(`No response from ${endpoint} after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);
      open();
    });
  }

  /** Settles the promise returned by `connect()` exactly once. */
  function finishConnect(err: Error | null): void {
    clearTimer(connectTimer);
    connectTimer = null;
    const resolveFn = connectResolve;
    const rejectFn = connectReject;
    connectResolve = null;
    connectReject = null;
    if (!resolveFn && !rejectFn) return;
    if (err) {
      logger("warn", "net.connect-failed", err.message);
      rejectFn?.(err);
    } else {
      resolveFn?.();
    }
  }

  function open(): void {
    if (stopped || !endpoint) return;
    closeSocket();
    welcomedThisSocket = false;
    setStatus(attempt === 0 ? "connecting" : "reconnecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch (err) {
      logger("warn", "net.socket-construct-failed", err);
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      logger("debug", "net.socket-open", endpoint);
      send({
        t: "hello",
        name: displayName,
        edition,
        protocol: PROTOCOL_VERSION,
        ...(resumeToken ? { resumeToken } : {}),
      });
      startHeartbeat();
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (socket !== ws) return;
      if (typeof ev.data !== "string") return;
      const msg = decode<ServerMessage>(ev.data);
      if (!msg) {
        logger("warn", "net.bad-frame", ev.data.slice(0, 120));
        return;
      }
      try {
        dispatch(msg);
      } catch (err) {
        logger("warn", "net.dispatch-threw", err);
      }
    };

    ws.onerror = () => {
      if (socket !== ws) return;
      logger("debug", "net.socket-error", endpoint);
    };

    ws.onclose = (ev: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      stopHeartbeat();
      logger("debug", "net.socket-close", `${ev.code} ${ev.reason}`);
      if (stopped) {
        setStatus("offline");
        return;
      }
      // 4400 is our own "your protocol is too old" — retrying cannot help.
      if (ev.code === 4400) {
        setStatus("failed");
        finishConnect(new Error("Protocol mismatch — update the headset app."));
        return;
      }
      finishConnect(new Error(`Connection closed (${ev.code})`));
      scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    if (stopped || !endpoint) return;
    if (!autoReconnect && attempt > 0) {
      setStatus("failed");
      return;
    }
    clearTimer(reconnectTimer);
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    const jittered = Math.round(base * (1 + (Math.random() * 2 - 1) * JITTER));
    attempt += 1;
    setStatus("reconnecting");
    logger("debug", "net.reconnect-in", `${jittered}ms (attempt ${attempt})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, jittered);
  }

  /** A wake-from-sleep should not wait out a 15s backoff. */
  function reconnectNow(why: string): void {
    if (stopped || !endpoint) return;
    if (status === "online" || status === "connecting") return;
    logger("debug", "net.reconnect-now", why);
    clearTimer(reconnectTimer);
    reconnectTimer = null;
    attempt = 0;
    open();
  }

  function closeSocket(): void {
    const ws = socket;
    socket = null;
    stopHeartbeat();
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* nothing useful to do */
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  function startHeartbeat(): void {
    stopHeartbeat();
    lastPongAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (!socket || socket.readyState !== 1) return;
      if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
        // The classic sleeping-headset case: the socket says OPEN, the link is
        // long gone. Tear it down so the backoff can do its job.
        logger("warn", "net.heartbeat-timeout", `${Date.now() - lastPongAt}ms since last pong`);
        const ws = socket;
        closeSocket();
        try {
          ws.close(4000, "heartbeat");
        } catch {
          /* already gone */
        }
        scheduleReconnect();
        return;
      }
      pingSentAt = Date.now();
      send({ t: "ping", at: pingSentAt });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  function dispatch(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome": {
        if (msg.protocol !== PROTOCOL_VERSION) {
          logger("warn", "net.protocol-mismatch", `server ${msg.protocol}, app ${PROTOCOL_VERSION}`);
          safely(() => events.onError("bad-protocol", "This server speaks a different protocol version."));
          stopped = true;
          closeSocket();
          setStatus("failed");
          finishConnect(new Error("protocol mismatch"));
          return;
        }

        const resumed = playerId !== null && playerId === msg.playerId;
        const previousId = playerId;
        // A second `welcome` on the same socket is the server handing over a
        // seat token (after createRoom/joinRoom), not a reconnect.
        const reclaimed = resumed && !welcomedThisSocket;
        welcomedThisSocket = true;
        playerId = msg.playerId;
        if (msg.resumeToken) {
          resumeToken = msg.resumeToken;
          persist(storageKey, { token: resumeToken, playerId: msg.playerId, code: joinedCode });
        }

        attempt = 0;
        setStatus("online");
        finishConnect(null);
        logger("info", "net.welcome", `${msg.playerId} (server ${msg.serverVersion}${reclaimed ? ", seat reclaimed" : ""})`);

        if (pendingIntent) {
          const intent = pendingIntent;
          pendingIntent = null;
          send(intent);
        } else if (!resumed && joinedCode && previousId !== null) {
          // The seat could not be reclaimed (held longer than the server's 90s,
          // or the room restarted). Walk back in through the front door.
          logger("info", "net.rejoin", joinedCode);
          send({ t: "joinRoom", code: joinedCode });
        }
        // A fresh pong right away keeps `latency()` from reading -1 for 10s.
        pingSentAt = Date.now();
        send({ t: "ping", at: pingSentAt });
        return;
      }

      case "pong": {
        lastPongAt = Date.now();
        const sentAt = msg.at || pingSentAt;
        const sample = lastPongAt - sentAt;
        if (sample >= 0 && sample < 60_000) {
          rtt = rtt < 0 ? sample : Math.round(rtt * 0.7 + sample * 0.3);
          // Assume a symmetric path: the server's clock read `serverTime` at
          // roughly the midpoint of the round trip.
          const offsetSample = msg.serverTime - (sentAt + sample / 2);
          clockOffset = clockSynced ? clockOffset * 0.8 + offsetSample * 0.2 : offsetSample;
          clockSynced = true;
        }
        return;
      }

      case "roomState":
        lastRoom = msg.room;
        joinedCode = msg.room.code;
        persist(storageKey, { token: resumeToken, playerId: playerId ?? "", code: joinedCode });
        safely(() => events.onRoom(localiseRoom(msg.room)));
        return;

      case "gameStarted":
        lastRoom = msg.room;
        joinedCode = msg.room.code;
        safely(() => events.onRoom(localiseRoom(msg.room)));
        return;

      case "playerJoined":
      case "playerLeft":
      case "settingsChanged":
      case "countdown":
        // `NetEvents` has no hook for these, and it does not need one: the
        // server always follows them with a `roomState`, which carries the
        // roster, the settings and the phase (including "countdown").
        return;

      case "revealed":
        safely(() => events.onRevealed(msg.index, msg.symbol, msg.by));
        return;

      case "matched": {
        // The wire message carries no seat, so resolve it from the roster.
        const seat = seatOf(msg.by);
        safely(() => events.onMatched(msg.indices, msg.by, seat, msg.streak));
        return;
      }

      case "missed":
        safely(() => events.onMissed(msg.indices, msg.by, toLocal(msg.hideAt)));
        return;

      case "hidden":
        safely(() => events.onHidden(msg.indices));
        return;

      case "turnChanged":
        safely(() => events.onTurn(msg.playerId, msg.seat, toLocal(msg.deadline)));
        return;

      case "gameOver":
        safely(() => events.onGameOver(msg.result));
        return;

      case "leaderboard":
        safely(() => events.onLeaderboard(msg.entries));
        return;

      case "emote":
        safely(() => events.onEmote(msg.playerId, msg.emote));
        return;

      case "error": {
        logger("warn", "net.error", `${msg.code}: ${msg.message}`);
        // These four all mean "you are not in that room" — forget it, so a
        // reconnect does not try to walk back into a room we were kicked from
        // or that no longer exists.
        if (
          msg.code === "not-in-room" ||
          msg.code === "no-such-room" ||
          msg.code === "room-full" ||
          msg.code === "already-started"
        ) {
          joinedCode = null;
          lastRoom = null;
          persist(storageKey, { token: resumeToken, playerId: playerId ?? "", code: null });
        }
        safely(() => events.onError(msg.code, msg.message));
        return;
      }

      default:
        logger("debug", "net.unknown-message", (msg as { t: string }).t);
    }
  }

  function seatOf(id: string): number {
    return lastRoom?.players.find((p) => p.id === id)?.seat ?? 0;
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  function send(msg: ClientMessage): boolean {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(encode(msg));
      return true;
    } catch (err) {
      logger("warn", "net.send-failed", err);
      return false;
    }
  }

  /**
   * Room-level intent survives a reconnect; per-flip actions do not. Replaying
   * a stale flip after the board has moved on would be worse than dropping it.
   */
  function sendOrRemember(msg: ClientMessage): void {
    if (send(msg)) return;
    if (msg.t === "createRoom" || msg.t === "joinRoom") {
      pendingIntent = msg;
      if (msg.t === "joinRoom") joinedCode = msg.code;
      logger("debug", "net.queued", msg.t);
      reconnectNow("queued intent");
    } else {
      logger("debug", "net.dropped-offline", msg.t);
    }
  }

  // ── Wake-up hooks ─────────────────────────────────────────────────────────
  // A Quest coming out of sleep fires both of these; reconnecting immediately
  // is the difference between "back in the game" and "stares at a spinner".

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reconnectNow("visible");
    });
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => reconnectNow("network online"));
    window.addEventListener("pagehide", () => stopHeartbeat());
  }

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    status(): NetStatus {
      return status;
    },

    /** Smoothed round-trip time in ms; -1 until the first pong lands. */
    latency(): number {
      return rtt;
    },

    selfId(): string | null {
      return playerId;
    },

    connect,

    createRoom(settings: GameSettings, maxPlayers: number): void {
      sendOrRemember({ t: "createRoom", settings, maxPlayers });
    },

    joinRoom(code: string): void {
      sendOrRemember({ t: "joinRoom", code });
    },

    leaveRoom(): void {
      joinedCode = null;
      lastRoom = null;
      pendingIntent = null;
      persist(storageKey, { token: resumeToken, playerId: playerId ?? "", code: null });
      send({ t: "leaveRoom" });
    },

    updateSettings(patch: Partial<GameSettings>): void {
      send({ t: "updateSettings", settings: patch });
    },

    addAi(level: AiLevel): void {
      send({ t: "addAi", level });
    },

    removeAi(id: string): void {
      send({ t: "removeAi", playerId: id });
    },

    startGame(): void {
      send({ t: "startGame" });
    },

    flip(index: number): void {
      send({ t: "flip", index });
    },

    emote(emote: EmoteId): void {
      send({ t: "emote", emote });
    },

    requestLeaderboard(scope: "room" | "global" | "today"): void {
      send({ t: "requestLeaderboard", scope });
    },

    disconnect(): void {
      stopped = true;
      pendingIntent = null;
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      clearTimer(connectTimer);
      connectTimer = null;
      finishConnect(null);
      closeSocket();
      setStatus("offline");
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Accepts ws/wss, upgrades http→ws, and rejects anything else as "offline". */
function normaliseUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") parsed.protocol = "ws:";
    else if (parsed.protocol === "https:") parsed.protocol = "wss:";
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function readEnvEdition(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.VITE_EDITION ?? "pro";
  } catch {
    return "pro";
  }
}

function cleanName(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer);
}

function loadPersisted(key: string): Persisted | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (typeof parsed.token !== "string") return null;
    return {
      token: parsed.token,
      playerId: typeof parsed.playerId === "string" ? parsed.playerId : "",
      code: typeof parsed.code === "string" && parsed.code ? parsed.code : null,
    };
  } catch {
    // Private-mode WebViews throw on localStorage. Reconnect still works
    // in-process; only a full app restart loses the seat.
    return null;
  }
}

function persist(key: string, value: Persisted): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* see loadPersisted */
  }
}

function defaultLogger(level: "debug" | "info" | "warn", event: string, detail?: unknown): void {
  if (level === "debug") return; // quiet by default; pass a logger to see these
  const line = `[net] ${event}`;
  if (level === "warn") console.warn(line, detail ?? "");
  else console.info(line, detail ?? "");
}
