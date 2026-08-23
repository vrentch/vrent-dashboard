// VRENT Offerten — offline cache
const CACHE = "vrent-offerten-v2";
const ASSETS = [
  "./", "./index.html", "./jspdf.umd.min.js", "./fonts.js",
  "./manifest.webmanifest", "./favicon.png", "./mark.png", "./logo.png", "./icon-192.png", "./icon-512.png",
  "./apple-touch-icon.png",
  "./fonts/archivo-400.woff2", "./fonts/archivo-600.woff2",
  "./fonts/archivo-700.woff2", "./fonts/archivo-800.woff2",
  "./fonts/plexmono-400.woff2", "./fonts/plexmono-600.woff2"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => (e.request.mode === "navigate" ? caches.match("./index.html") : undefined));
    })
  );
});
