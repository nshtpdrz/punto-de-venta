/* Service worker: guarda la app en el celular para que abra sin internet. Cambia VERSION al actualizar archivos. */
const VERSION = 'pdv-1.2';
const ARCHIVOS = ['./', 'index.html', 'app.js', 'lib/zxing.min.js', 'manifest.webmanifest', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'fuentes/barlow-condensed-latin-600-normal.woff2', 'fuentes/barlow-condensed-latin-700-normal.woff2', 'fuentes/ibm-plex-mono-latin-500-normal.woff2', 'fuentes/ibm-plex-mono-latin-700-normal.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// primero lo guardado; si hay internet, se actualiza en segundo plano para la próxima vez
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const guardado = await c.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => guardado);
    return guardado || red;
  }));
});
