// Push-alarm scheduler for Curfew — the whole backend of this standalone
// app. Requires two things in the deployment's env to be active (otherwise
// every op reports configured:false and the app quietly runs in-app-only):
//   VAPID_PRIVATE                     — private half of the app's VAPID pair
//   KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* names)
//                                     — an Upstash Redis (Vercel Marketplace)
//   QSTASH_TOKEN (optional)           — lets ?op=setup maintain the QStash
//                                       schedule that pings tick every 5 min
// No relative imports (Vercel runs this file as native ESM).
//
// Ops (single route /api/clearhead, ?op= or {"op":...} in a POST body —
// QStash calls the bare route with a JSON body):
//   POST ?op=schedule  {subscription, alarms:[{id,at,title,body,urgent?}]}
//                      Replaces the device's pending alarm list (empty = clear).
//   GET  ?op=tick      Fires every due alarm; pinged every 5 min by a QStash
//                      schedule (created via ?op=setup).
//   GET  ?op=setup     Ensures exactly one such QStash schedule exists
//                      (idempotent, deletes duplicates, inert without token).
//   POST ?op=test      {subscription} — sends one push immediately.
//   GET  ?op=status    {configured, tick} — whether push + heartbeat are set up.
//
// An alarm only ever notifies the device that scheduled it (the push
// subscription IS the address); nothing personal is stored beyond that.

import type { IncomingMessage, ServerResponse } from "node:http";
import * as webpush from "web-push";

// Curfew's own standalone VAPID identity (public half).
const VAPID_PUBLIC = "BI-y6GbVdZiDP3_JT4-LuGODcO16aqsA07Pofkgcry6Yn-IcBkY3zY5NWxWoycRDBiuR_K9ensyEIHDYaLEdCVs";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

function configured(): boolean {
  return !!(KV_URL && KV_TOKEN && VAPID_PRIVATE);
}

let vapidReady = false;
function ensureVapid(): void {
  if (vapidReady || !VAPID_PRIVATE) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:info@vrent.ch", VAPID_PUBLIC, VAPID_PRIVATE);
  vapidReady = true;
}

async function kv(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(KV_URL as string, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const j = (await res.json()) as { result?: unknown };
  return j.result;
}

function subId(endpoint: string): string {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (h * 31 + endpoint.charCodeAt(i)) >>> 0;
  return h.toString(36) + endpoint.length.toString(36);
}

interface Alarm {
  id: string;
  at: number; // epoch ms
  title: string;
  body: string;
  urgent?: boolean;
}
interface Rec {
  subscription: { endpoint: string } & Record<string, unknown>;
  alarms: Alarm[];
  updatedAt: number;
}

const MAX_ALARMS = 12;
const HORIZON_MS = 24 * 3600000; // alarms may be scheduled at most 24h out
const STALE_MS = 45 * 60000; // unsent alarms older than this are dropped, not fired
const REC_TTL_S = 100000; // ~28h — a night's schedule, then it evaporates

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

function sanitizeAlarms(raw: unknown, now: number): Alarm[] {
  if (!Array.isArray(raw)) return [];
  const out: Alarm[] = [];
  for (const a of raw.slice(0, MAX_ALARMS)) {
    const o = a as Record<string, unknown>;
    const at = typeof o?.at === "number" ? o.at : NaN;
    const id = str(o?.id, 64);
    const title = str(o?.title, 90);
    const body = str(o?.body, 260);
    if (!id || !title || !isFinite(at)) continue;
    if (at > now + HORIZON_MS || at < now - STALE_MS) continue;
    out.push({ id, at: Math.round(at), title, body, urgent: o?.urgent === true });
  }
  return out;
}

type Json = Record<string, unknown>;
interface Out {
  status: number;
  body: Json;
}

async function sendPush(rec: Rec, alarm: { title: string; body: string; urgent?: boolean; tag?: string }, id: string): Promise<boolean> {
  ensureVapid();
  try {
    await webpush.sendNotification(
      rec.subscription as unknown as webpush.PushSubscription,
      JSON.stringify({ title: alarm.title, body: alarm.body, urgent: !!alarm.urgent, tag: alarm.tag || "clearhead-alarm", url: "./" }),
      { TTL: 1800, urgency: "high" }
    );
    return true;
  } catch (err) {
    const code = (err as { statusCode?: number })?.statusCode;
    if (code === 404 || code === 410) {
      // Subscription is dead — forget the device.
      await kv(["DEL", `ch:${id}`]).catch(() => undefined);
      await kv(["SREM", "ch:subs", id]).catch(() => undefined);
    }
    return false;
  }
}

async function scheduleHandler(body: Json | undefined): Promise<Out> {
  if (!configured()) return { status: 200, body: { ok: false, configured: false } };
  const subscription = body?.subscription as Rec["subscription"] | undefined;
  if (!subscription?.endpoint || typeof subscription.endpoint !== "string") {
    return { status: 400, body: { ok: false, error: "subscription required" } };
  }
  const now = Date.now();
  const alarms = sanitizeAlarms(body?.alarms, now);
  const id = subId(subscription.endpoint);
  const rec: Rec = { subscription, alarms, updatedAt: now };
  await kv(["SET", `ch:${id}`, JSON.stringify(rec), "EX", REC_TTL_S]);
  await kv(["SADD", "ch:subs", id]);
  return { status: 200, body: { ok: true, configured: true, pending: alarms.length } };
}

async function tickHandler(): Promise<Out> {
  if (!configured()) return { status: 200, body: { ok: false, configured: false } };
  const now = Date.now();
  const ids = ((await kv(["SMEMBERS", "ch:subs"])) as string[] | null) || [];
  let sent = 0;

  for (const id of ids) {
    const raw = (await kv(["GET", `ch:${id}`])) as string | null;
    if (!raw) {
      await kv(["SREM", "ch:subs", id]);
      continue;
    }
    let rec: Rec;
    try {
      rec = JSON.parse(raw) as Rec;
    } catch {
      continue;
    }
    const alarms = Array.isArray(rec.alarms) ? rec.alarms : [];
    const due = alarms.filter((a) => a.at <= now && a.at > now - STALE_MS);
    const future = alarms.filter((a) => a.at > now);
    // Nothing due and nothing stale-dropped — leave the record untouched.
    if (!due.length && future.length === alarms.length) continue;
    for (const a of due) {
      if (await sendPush(rec, a, id)) sent++;
    }
    // Persist with fired + stale alarms removed so a delayed second tick
    // can't fire them again.
    const rec2: Rec = { subscription: rec.subscription, alarms: future, updatedAt: now };
    await kv(["SET", `ch:${id}`, JSON.stringify(rec2), "EX", REC_TTL_S]).catch(() => undefined);
  }
  return { status: 200, body: { ok: true, devices: ids.length, sent } };
}

async function testHandler(body: Json | undefined): Promise<Out> {
  if (!configured()) return { status: 200, body: { ok: false, configured: false } };
  const subscription = body?.subscription as Rec["subscription"] | undefined;
  if (!subscription?.endpoint) return { status: 400, body: { ok: false, error: "subscription required" } };
  const ok = await sendPush(
    { subscription, alarms: [], updatedAt: Date.now() },
    { title: "Curfew 🛡", body: "Lock-screen alarms are armed. Lock your phone — reminders will still reach you.", tag: "clearhead-test" },
    subId(subscription.endpoint)
  );
  return { status: 200, body: { ok } };
}

// Self-bootstrap of the heartbeat: ensure exactly one QStash schedule pings
// this deployment's tick every 5 minutes. Safe to expose publicly — it is
// idempotent (extra duplicates get deleted) and inert without QSTASH_TOKEN.
const TICK_DEST = "https://clearhead-vrentchs-projects.vercel.app/api/clearhead";
async function setupHandler(): Promise<Out> {
  if (!QSTASH_TOKEN) return { status: 200, body: { ok: false, tick: false, missing: "QSTASH_TOKEN" } };
  const auth = { Authorization: `Bearer ${QSTASH_TOKEN}` };
  const ls = await fetch("https://qstash.upstash.io/v2/schedules", { headers: auth, signal: AbortSignal.timeout(8000) });
  if (!ls.ok) return { status: 502, body: { ok: false, error: `qstash list ${ls.status}` } };
  const all = (await ls.json()) as Record<string, unknown>[];
  const ours = (Array.isArray(all) ? all : []).filter((s) => String(s.destination || "").startsWith(TICK_DEST));
  for (const s of ours.slice(1)) {
    await fetch(`https://qstash.upstash.io/v2/schedules/${String(s.scheduleId)}`, { method: "DELETE", headers: auth }).catch(() => undefined);
  }
  if (ours.length) return { status: 200, body: { ok: true, tick: true, already: true } };
  const mk = await fetch(`https://qstash.upstash.io/v2/schedules/${TICK_DEST}`, {
    method: "POST",
    headers: { ...auth, "Upstash-Cron": "*/5 * * * *", "Content-Type": "application/json" },
    body: JSON.stringify({ op: "tick" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!mk.ok) return { status: 502, body: { ok: false, error: `qstash create ${mk.status}` } };
  return { status: 200, body: { ok: true, tick: true, created: true } };
}

function readBody(req: IncomingMessage): Promise<Json | undefined> {
  return new Promise((resolve) => {
    const pre = (req as IncomingMessage & { body?: unknown }).body;
    if (pre !== undefined) {
      resolve(typeof pre === "string" ? safeJson(pre) : (pre as Json));
      return;
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(safeJson(data)));
    req.on("error", () => resolve(undefined));
  });
}
function safeJson(s: string): Json | undefined {
  try {
    return s ? (JSON.parse(s) as Json) : undefined;
  } catch {
    return undefined;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://localhost");
  const body = req.method === "POST" ? await readBody(req) : undefined;
  const op = url.searchParams.get("op") || str(body?.op, 16);

  let out: Out;
  try {
    if (op === "status") out = { status: 200, body: { ok: true, configured: configured(), tick: !!QSTASH_TOKEN } };
    else if (op === "tick") out = await tickHandler();
    else if (op === "setup") out = await setupHandler();
    else if (op === "schedule") out = await scheduleHandler(body);
    else if (op === "test") out = await testHandler(body);
    else out = { status: 404, body: { ok: false, error: `unknown op: ${op}` } };
  } catch (err) {
    out = { status: 502, body: { ok: false, error: String(err instanceof Error ? err.message : err) } };
  }

  res.statusCode = out.status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(out.body));
}
