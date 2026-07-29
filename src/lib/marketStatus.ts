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

function fmt(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function humanGap(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
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

  if (isOpen) {
    const toClose = closeMin - minutes;
    return { ...base, open: true, detail: toClose <= 60 ? `Closes in ${humanGap(toClose)}` : `Closes ${fmt(closeMin)}` };
  }

  // Compute the next open.
  if (isWeekday && minutes < openMin) {
    return { ...base, open: false, detail: `Opens in ${humanGap(openMin - minutes)}` };
  }
  // Next weekday (skip to Monday over the weekend).
  let addDays = 1;
  let d = (dow + 1) % 7;
  while (d === 0 || d === 6) {
    d = (d + 1) % 7;
    addDays++;
  }
  const dayLabel = addDays === 1 ? "tomorrow" : DOW[d];
  return { ...base, open: false, detail: `Opens ${dayLabel} ${fmt(openMin)}` };
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
