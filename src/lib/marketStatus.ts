// Lightweight market open/closed engine. Uses each exchange's local time via
// Intl time zones. Holidays are not modelled (a reasonable simplification for
// an at-a-glance indicator).

export interface MarketDef {
  key: string;
  name: string;
  flag: string;
  tz?: string;
  open?: [number, number]; // local open h,m
  close?: [number, number]; // local close h,m
  always?: boolean; // 24/7 (crypto)
}

export const MARKETS: MarketDef[] = [
  { key: "us", name: "US", flag: "🇺🇸", tz: "America/New_York", open: [9, 30], close: [16, 0] },
  { key: "ch", name: "Swiss", flag: "🇨🇭", tz: "Europe/Zurich", open: [9, 0], close: [17, 30] },
  { key: "eu", name: "Europe", flag: "🇪🇺", tz: "Europe/Berlin", open: [9, 0], close: [17, 30] },
  { key: "uk", name: "UK", flag: "🇬🇧", tz: "Europe/London", open: [8, 0], close: [16, 30] },
  { key: "crypto", name: "Crypto", flag: "🪙", always: true },
];

export interface MarketStatus {
  key: string;
  name: string;
  flag: string;
  open: boolean;
  detail: string; // e.g. "Closes 16:00" / "Opens in 2h 15m" / "Opens Mon 09:30"
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(tz: string, now: Date) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const minute = parseInt(get("minute"), 10);
  const wdShort = get("weekday");
  const dow = DOW.indexOf(wdShort); // 0=Sun … 6=Sat
  return { dow, minutes: hour * 60 + minute };
}

function humanGap(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Format an absolute moment in the *viewer's* local time zone (adapts per
// device automatically — no hard-coded exchange clock).
function localClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function localWeekday(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export function statusFor(m: MarketDef, now: Date = new Date()): MarketStatus {
  const base = { key: m.key, name: m.name, flag: m.flag };
  if (m.always) return { ...base, open: true, detail: "24 / 7" };
  if (!m.tz || !m.open || !m.close) return { ...base, open: false, detail: "" };

  const { dow, minutes } = localParts(m.tz, now);
  const openMin = m.open[0] * 60 + m.open[1];
  const closeMin = m.close[0] * 60 + m.close[1];
  const isWeekday = dow >= 1 && dow <= 5;
  const isOpen = isWeekday && minutes >= openMin && minutes < closeMin;
  const at = (gapMin: number) => new Date(now.getTime() + gapMin * 60000);

  if (isOpen) {
    const toClose = closeMin - minutes;
    return { ...base, open: true, detail: toClose <= 60 ? `Closes in ${humanGap(toClose)}` : `Closes ${localClock(at(toClose))}` };
  }

  // Same-day open still ahead.
  if (isWeekday && minutes < openMin) {
    const toOpen = openMin - minutes;
    return { ...base, open: false, detail: toOpen <= 90 ? `Opens in ${humanGap(toOpen)}` : `Opens ${localClock(at(toOpen))}` };
  }

  // Next weekday open (skip the weekend). Gap in exchange-local minutes maps
  // 1:1 to real elapsed minutes, so we can add it to `now` and show local time.
  let addDays = 1;
  let d = (dow + 1) % 7;
  while (d === 0 || d === 6) {
    d = (d + 1) % 7;
    addDays++;
  }
  const gap = addDays * 1440 - minutes + openMin;
  const moment = at(gap);
  const dayLabel = addDays === 1 ? "tomorrow" : localWeekday(moment);
  return { ...base, open: false, detail: `Opens ${dayLabel} ${localClock(moment)}` };
}

export function allStatuses(now: Date = new Date()): MarketStatus[] {
  return MARKETS.map((m) => statusFor(m, now));
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
