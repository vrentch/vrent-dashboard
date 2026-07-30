// Tracks which news stories have been seen in Shorts, so Shorts only surfaces
// fresh ones. The News tab is unaffected — it always shows everything. Keyed by
// the article id (its link), which is stable across fetches.
const KEY = "vrent.news.seen.v1";
const MAX = 800;

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let order = load();
let set = new Set(order);

export function isSeen(id: string): boolean {
  return !!id && set.has(id);
}

export function markSeen(id: string): void {
  if (!id || set.has(id)) return;
  set.add(id);
  order.push(id);
  if (order.length > MAX) {
    const drop = order.splice(0, order.length - MAX);
    for (const d of drop) set.delete(d);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* quota — ignore */
  }
}
