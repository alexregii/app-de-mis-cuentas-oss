const CACHE_PREFIX = "mis-cuentas-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const UI_LAB_PATH = "/ui-lab.html";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/brand/logo.svg",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const shellResponse = await fetch(new Request(new URL("/", self.location.origin), {cache: "reload"}));
    if (!shellResponse.ok) throw new Error("No se pudo instalar el shell actualizado de la aplicación.");
    await cache.put("/", shellResponse.clone());
    const shell = await shellResponse.text();
    const assets = [...new Set(Array.from(shell.matchAll(/\b(?:src|href)="(\/assets\/[^\"]+)"/g), ([, path]) => path))];
    await cache.addAll(assets);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // El laboratorio es una segunda entrada de Vite, no una ruta SPA ni parte de la PWA.
  // Dejarla pasar evita que una caché de la aplicación entregue index.html en su lugar.
  if (url.pathname === UI_LAB_PATH) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/", {cacheName: CACHE_NAME})));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/") || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request, {cacheName: CACHE_NAME, ignoreVary: url.pathname.startsWith("/assets/")}).then((cached) => cached || fetch(request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })),
    );
  }
});
