/**
 * Nostr Keep - PWA Service Worker
 * Uses network-first for app files (always get latest), cache-first for CDN assets.
 * Enables complete offline operation as fallback.
 */

const CACHE_NAME = 'nostr-keep-cache-v22';
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/nostr-tools@2.10.4/lib/nostr.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap'
];

// Install: cache everything
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Pre-caching assets...');
      return cache.addAll([...APP_FILES, ...CDN_FILES]);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clear old caches and take control immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for app files, cache-first for CDN/external
self.addEventListener('fetch', (e) => {
  // Only handle HTTP/HTTPS requests (ignores chrome-extension:// and other non-standard schemes)
  if (!e.request.url.startsWith('http')) {
    return;
  }

  if (e.request.method !== 'GET' || e.request.url.startsWith('ws')) {
    return;
  }

  const url = new URL(e.request.url);
  const isAppFile = url.origin === self.location.origin;

  if (isAppFile) {
    // Network-first: always try to get latest, fallback to cache for offline
    e.respondWith(
      fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(e.request);
      })
    );
  } else {
    // Cache-first for CDN assets (fonts, nostr-tools)
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          console.log('Fetch failed for:', e.request.url);
        });
      })
    );
  }
});
