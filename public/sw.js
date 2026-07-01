/* Tape service worker — enables install + an offline shell WITHOUT ever serving stale market data.
 * Strategy:
 *   - /api/*                         → never intercept (always live)
 *   - /_next/static/*, /icons/*      → cache-first (content-hashed / immutable)
 *   - navigations (HTML)             → network-first, fall back to the offline page
 *   - everything else same-origin    → network, fall back to cache
 * Bump VERSION to invalidate the shell cache on deploy. */
const VERSION = "tape-v1";
const SHELL = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin (fonts/CDNs) alone
  if (url.pathname.startsWith("/api/")) return; // live data — never cache

  // immutable assets → cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // page navigations → network-first with an offline fallback (also satisfies installability)
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        return (await caches.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }

  // anything else same-origin → network, fall back to cache if offline
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
