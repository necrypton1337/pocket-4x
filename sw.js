// Офлайн: при первом открытии всё кладём в кэш, дальше играем без сети.
// При изменении файлов игры поднимайте VERSION, чтобы телефон забрал новую версию.
const VERSION = 'pocket4x-v10';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/ui/main.js', 'src/ui/render.js', 'src/ui/icons.js',
  'src/core/data.js', 'src/core/hex.js', 'src/core/rng.js', 'src/core/mapgen.js', 'src/core/game.js',
  'src/core/ai.js', 'src/core/turn.js', 'src/core/save.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(FILES);
    // Графика: список берём из манифеста спрайтов
    const res = await fetch('assets/manifest.json');
    await c.put('assets/manifest.json', res.clone());
    const man = await res.json();
    await c.addAll(Object.keys(man.sprites).map((n) => `assets/${n}.${man.ext || 'png'}`));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
