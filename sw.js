const CACHE_NAME = "quant-trade-static-v1";
const STATIC_ASSETS = [
  "/",
  "/app",
  "/manifest.webmanifest",
  "/assets/quant-trade-icon.svg",
  "/quant_system功能&使用說明/quant_system_strategy_tg.html",
  "/quant_system投資策略/VCP型態.jpg",
  "/quant_system投資策略/買入及賣出訊號.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/app")))
  );
});
