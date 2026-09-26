/*
 * Offline support for My Internship Notebook.
 * Network first, so a new deploy shows up on the next visit; the cached copy is
 * only used when the device is offline. API requests (Java server mode) are never cached.
 */
const CACHE = "internship-notebook-v12";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "js/app.js",
  "js/theme-init.js",
  "js/domain.js",
  "js/storage.js",
  "js/api.js",
  "js/cloud.js",
  "js/sync.js",
  "js/calendar.js",
  "js/ui/icons.js",
  "site-mode.js",
  "manifest.webmanifest",
  "privacy.html",
  "delete-account.html",
  "legal.css",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "favicon-20260915-v4.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("index.html");
        return Response.error();
      })
  );
});
