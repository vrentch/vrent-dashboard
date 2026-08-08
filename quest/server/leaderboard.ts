/**
 * Persistent leaderboard.
 *
 * Entries are derived exclusively from the server's own `summarise()` output
 * and the authoritative board — a client never submits a score, so a modified
 * headset cannot post a number it did not earn. AI opponents are excluded; a
 * leaderboard with a prize attached only ranks humans.
 *
 * Storage is a single JSON file under `DATA_DIR`, written atomically
 * (temp file + fsync + rename) so a crash or a machine restart mid-write can
 * never leave a half-written file behind. If the directory is not writable the
 * store degrades to memory-only and says so loudly rather than crashing a paid
 * demo.
 */

import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { MatchResult } from "../shared/game.ts";
import type { LeaderboardEntry, LeaderboardScope } from "../shared/protocol.ts";

/** Where the JSON file lives. Point a persistent volume here in production. */
export const DATA_DIR = process.env.DATA_DIR ?? "./data";

/** Hard cap per scope, as specified. Keeps the file small and reads instant. */
export const MAX_PER_SCOPE = 500;

/** Room buckets are pruned to this many rooms, most recently used first. */
const MAX_ROOMS_TRACKED = 300;

/** Coalesce bursts of writes (a whole room finishing at once) into one save. */
const SAVE_DEBOUNCE_MS = 400;

/** Give up on the disk after this many consecutive failed writes. */
const MAX_SAVE_FAILURES = 3;

const FILE_VERSION = 1;

type Logger = (level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => void;

interface StoredEntry {
  name: string;
  score: number;
  pairs: number;
  mode: string;
  accuracy: number;
  at: number;
}

interface StoreFile {
  version: number;
  global: StoredEntry[];
  today: { day: string; entries: StoredEntry[] };
  rooms: Record<string, StoredEntry[]>;
}

/**
 * Everything the leaderboard needs to record a finished match. All of it comes
 * from server-side state; nothing here is client supplied.
 */
export interface MatchRecordInput {
  roomCode: string;
  /** Straight from `summarise()` on the authoritative match state. */
  result: MatchResult;
  /** playerId → pairs actually matched, counted off the server's own board. */
  pairsByPlayer: Record<string, number>;
}

export interface LeaderboardOptions {
  dir?: string;
  maxPerScope?: number;
  log?: Logger;
}

export interface LeaderboardStats {
  global: number;
  today: number;
  rooms: number;
  persistent: boolean;
  file: string;
}

export interface Leaderboard {
  /** Resolves once the file on disk (if any) has been loaded. */
  ready(): Promise<void>;
  /** Ranked entries for a scope. `roomCode` is required for scope "room". */
  top(scope: LeaderboardScope, roomCode?: string | null, limit?: number): LeaderboardEntry[];
  /** Records a finished match. Returns how many entries were stored. */
  recordMatch(input: MatchRecordInput): number;
  /** Forces a write of any pending changes. */
  flush(): Promise<void>;
  stats(): LeaderboardStats;
  dispose(): Promise<void>;
}

const noopLog: Logger = () => {};

export function createLeaderboard(options: LeaderboardOptions = {}): Leaderboard {
  const dir = options.dir ?? DATA_DIR;
  const cap = Math.max(1, options.maxPerScope ?? MAX_PER_SCOPE);
  const log = options.log ?? noopLog;
  const file = join(dir, "leaderboard.json");

  let store: StoreFile = emptyStore();
  let dirty = false;
  let persistent = true;
  let warnedUnwritable = false;
  let consecutiveFailures = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let disposed = false;

  const loaded = load();

  async function load(): Promise<void> {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      store = sanitiseStore(parsed, cap);
      log("info", "leaderboard.loaded", {
        file,
        global: store.global.length,
        today: store.today.entries.length,
        rooms: Object.keys(store.rooms).length,
      });
    } catch (err) {
      const code = errCode(err);
      if (code === "ENOENT") {
        log("info", "leaderboard.new", { file });
      } else {
        // A corrupt file must not stop the event. Start clean, keep the old
        // file out of the way so the operator can still look at it.
        log("warn", "leaderboard.unreadable", { file, error: describe(err) });
        store = emptyStore();
      }
    }
    rollDay();
  }

  function rollDay(): void {
    const day = localDayKey();
    if (store.today.day !== day) {
      store.today = { day, entries: [] };
      dirty = true;
    }
  }

  function queueSave(): void {
    if (disposed || !persistent) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void save();
    }, SAVE_DEBOUNCE_MS);
    // Never hold the process open just to flush a leaderboard.
    if (typeof saveTimer.unref === "function") saveTimer.unref();
  }

  function save(): Promise<void> {
    if (!dirty) return saving;
    saving = saving.then(() => writeOnce()).catch(() => {});
    return saving;
  }

  async function writeOnce(): Promise<void> {
    if (!dirty || !persistent) return;
    dirty = false;
    const payload = JSON.stringify(store);
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
      await mkdir(dir, { recursive: true });
      const handle = await open(tmp, "w");
      try {
        await handle.writeFile(payload, "utf8");
        // fsync before rename: rename is atomic, but only durable if the data
        // it points at already reached the disk.
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, file);
      consecutiveFailures = 0;
      log("debug", "leaderboard.saved", { file, bytes: payload.length });
    } catch (err) {
      dirty = true;
      consecutiveFailures += 1;
      await unlink(tmp).catch(() => {});
      const code = errCode(err);
      const unwritable = code === "EACCES" || code === "EPERM" || code === "EROFS";

      // A permissions problem is settled on the first attempt; anything else
      // gets a few tries in case it is transient (a volume still attaching).
      // Either way we stop eventually: retrying a doomed write on every match
      // would bury the log an operator is trying to read during an event.
      if (unwritable || consecutiveFailures >= MAX_SAVE_FAILURES) {
        persistent = false;
        if (!warnedUnwritable) {
          warnedUnwritable = true;
          log("error", "leaderboard.readonly", {
            file,
            error: describe(err),
            attempts: consecutiveFailures,
            hint: "DATA_DIR is not writable — scores are in memory only and will be lost on restart. chown the volume or point DATA_DIR somewhere writable.",
          });
        }
      } else {
        log("error", "leaderboard.save-failed", { file, error: describe(err), attempt: consecutiveFailures });
      }
    }
  }

  function bucket(scope: LeaderboardScope, roomCode?: string | null): StoredEntry[] {
    if (scope === "global") return store.global;
    if (scope === "today") {
      rollDay();
      return store.today.entries;
    }
    if (!roomCode) return [];
    return store.rooms[roomCode] ?? [];
  }

  function insert(list: StoredEntry[], entry: StoredEntry): void {
    list.push(entry);
    list.sort(compareStored);
    if (list.length > cap) list.length = cap;
  }

  return {
    ready(): Promise<void> {
      return loaded;
    },

    top(scope: LeaderboardScope, roomCode?: string | null, limit = 100): LeaderboardEntry[] {
      const list = bucket(scope, roomCode);
      const sliced = list.slice(0, Math.max(0, Math.min(limit, cap)));
      return rank(sliced);
    },

    recordMatch(input: MatchRecordInput): number {
      rollDay();
      const at = Date.now();
      const mode = String(input.result.mode);
      let added = 0;

      for (const r of input.result.results) {
        // Requirement: never rank a bot alongside paying customers.
        if (r.isAi) continue;
        const pairs = Math.max(0, Math.round(input.pairsByPlayer[r.playerId] ?? 0));
        const score = Math.max(0, Math.round(r.score));

        const entry: StoredEntry = {
          name: cleanName(r.name),
          score,
          pairs,
          mode,
          accuracy: clamp01(r.accuracy),
          at,
        };

        insert(store.global, entry);
        insert(store.today.entries, entry);
        const roomList = store.rooms[input.roomCode] ?? [];
        insert(roomList, entry);
        store.rooms[input.roomCode] = roomList;
        added++;
      }

      if (added > 0) {
        pruneRooms(store, MAX_ROOMS_TRACKED);
        dirty = true;
        queueSave();
        log("info", "leaderboard.recorded", { room: input.roomCode, entries: added, mode });
      }
      return added;
    },

    async flush(): Promise<void> {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await save();
      await saving;
    },

    stats(): LeaderboardStats {
      return {
        global: store.global.length,
        today: store.today.entries.length,
        rooms: Object.keys(store.rooms).length,
        persistent,
        file,
      };
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // dispose() runs on shutdown, so bypass the "disposed" guard in save().
      if (dirty && persistent) {
        saving = saving.then(() => writeOnce()).catch(() => {});
      }
      await saving;
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyStore(): StoreFile {
  return { version: FILE_VERSION, global: [], today: { day: localDayKey(), entries: [] }, rooms: {} };
}

/** Highest score first; ties broken by accuracy, then by who got there first. */
function compareStored(a: StoredEntry, b: StoredEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  return a.at - b.at;
}

/** Equal scores share a rank; the next rank skips, matching `summarise()`. */
function rank(list: readonly StoredEntry[]): LeaderboardEntry[] {
  let currentRank = 0;
  let lastScore = Number.POSITIVE_INFINITY;
  return list.map((e, i) => {
    if (e.score < lastScore) {
      currentRank = i + 1;
      lastScore = e.score;
    }
    return {
      rank: currentRank,
      name: e.name,
      score: e.score,
      pairs: e.pairs,
      mode: e.mode,
      accuracy: e.accuracy,
      at: e.at,
    };
  });
}

function pruneRooms(store: StoreFile, max: number): void {
  const codes = Object.keys(store.rooms);
  if (codes.length <= max) return;
  const newest = (code: string): number => {
    const list = store.rooms[code];
    let t = 0;
    for (const e of list) if (e.at > t) t = e.at;
    return t;
  };
  codes
    .sort((a, b) => newest(b) - newest(a))
    .slice(max)
    .forEach((code) => {
      delete store.rooms[code];
    });
}

/** Local calendar day, so "today" matches the operator's wall clock (set TZ). */
function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function cleanName(raw: string): string {
  // Strip control characters — a name ends up in logs, on a projector and in
  // a JSON file, and none of those want a stray escape sequence.
  const stripped = String(raw ?? "")
    .replace(CONTROL_CHARS, "")
    .trim();
  return (stripped || "Player").slice(0, 24);
}

/** Defensive parse — the file on disk is untrusted input like anything else. */
function sanitiseStore(raw: unknown, cap: number): StoreFile {
  const out = emptyStore();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Partial<StoreFile>;

  out.global = sanitiseList(obj.global, cap);
  const today = obj.today;
  if (today && typeof today === "object" && typeof today.day === "string") {
    out.today = { day: today.day, entries: sanitiseList(today.entries, cap) };
  }
  if (obj.rooms && typeof obj.rooms === "object") {
    for (const [code, list] of Object.entries(obj.rooms)) {
      if (typeof code !== "string" || code.length > 12) continue;
      const entries = sanitiseList(list, cap);
      if (entries.length > 0) out.rooms[code] = entries;
    }
  }
  pruneRooms(out, MAX_ROOMS_TRACKED);
  return out;
}

function sanitiseList(raw: unknown, cap: number): StoredEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<StoredEntry>;
    if (typeof e.score !== "number" || !Number.isFinite(e.score)) continue;
    out.push({
      name: cleanName(typeof e.name === "string" ? e.name : "Player"),
      score: Math.max(0, Math.round(e.score)),
      pairs: typeof e.pairs === "number" && Number.isFinite(e.pairs) ? Math.max(0, Math.round(e.pairs)) : 0,
      mode: typeof e.mode === "string" ? e.mode.slice(0, 24) : "classic",
      accuracy: clamp01(typeof e.accuracy === "number" ? e.accuracy : 0),
      at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0,
    });
    if (out.length >= cap * 2) break;
  }
  out.sort(compareStored);
  if (out.length > cap) out.length = cap;
  return out;
}

function errCode(err: unknown): string {
  return err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
