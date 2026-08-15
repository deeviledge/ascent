/* Ascent Log service worker
   静的ファイルは cache-first。電波が悪くても、また圏外でも即座に起動する。
   ファイルを追加したら FILES に追記し、CACHE の番号を必ず上げること。 */
const CACHE = "ascent-v9";
const FILES = [
  "./",
  "./index.html",
  "./tokens.css",
  "./app.css",
  "./seed.js",
  "./data.migrate.js",
  "./domain.js",
  "./view.mountain.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // cache-first + 裏で更新（stale-while-revalidate）
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit || caches.match("./index.html"));
      return hit || net;
    })
  );
});
