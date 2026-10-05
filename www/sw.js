// Офлайн-режим: все файлы приложения сохраняются на устройстве при первой загрузке.
// Данные геолога в кэш не попадают — они в IndexedDB.

const VERSION = 'kern-1.0.0';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/util.js',
  'js/store.js',
  'js/seed.js',
  'js/model.js',
  'js/calc.js',
  'js/geo.js',
  'js/zip.js',
  'js/sheets.js',
  'js/importer.js',
  'js/exporter.js',
  'js/components.js',
  'js/demo.js',
  'js/views/projects.js',
  'js/views/hole.js',
  'js/views/interval.js',
  'js/views/samples.js',
  'js/views/photos.js',
  'js/views/striplog.js',
  'js/views/importview.js',
  'js/views/analysis.js',
  'js/views/compare.js',
  'js/views/section.js',
  'js/views/exportview.js',
  'js/views/settings.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === 'navigate') {
      const hit = await cache.match('index.html');
      if (hit) return hit;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Нет связи, а файл не сохранён в офлайн-кэше', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
