// Always fetch the latest game files. Without this, the Quest Browser can keep using old
// copies of the game's code for a while after an update. Each file is checked with the
// server on every load (cheap when nothing changed); if the network is down the browser's
// normal cache is used.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => fetch(req)));
});
