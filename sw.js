/* Service worker. Con internet usa siempre lo más reciente; sin internet, lo guardado en el celular.
   Cambia VERSION al publicar: al activarse, recarga la app abierta para que se vea la versión nueva. */
const VERSION = 'pdv-2.1';
const ARCHIVOS = ['./', 'index.html', 'app.js', 'lib/zxing.min.js', 'manifest.webmanifest', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'fuentes/barlow-latin-400-normal.woff2', 'fuentes/barlow-latin-500-normal.woff2', 'fuentes/barlow-latin-600-normal.woff2', 'fuentes/barlow-latin-700-normal.woff2'];
const ESPERA_RED = 2500;   // con internet lento, no hacer esperar al tendero: usa lo guardado

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(ARCHIVOS.map((a) => fetch(a, { cache: 'reload' }).then((r) => c.put(a, r))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys(), viejas = claves.filter((k) => k !== VERSION);
    await Promise.all(viejas.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (viejas.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);   // actualizó: recargar
  })());
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const guardado = await c.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' ? await c.match('index.html') : undefined);
    const red = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (!guardado) return red;
    const tiempo = new Promise((ok) => setTimeout(() => ok(guardado), ESPERA_RED));
    return Promise.race([red.catch(() => guardado), tiempo]);
  })());
});
