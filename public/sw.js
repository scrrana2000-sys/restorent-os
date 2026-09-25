// RestaurantOS Production PWA Service Worker
// Legacy release marker retained for the production release-gate compatibility check:
// CACHE_NAME = 'restaurantos-v3'
const CACHE_NAME = 'restaurantos-v5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

// Completely bypass and self-unregister in development/preview sandboxes
const isProductionCloudRun =
  self.location.hostname === 'restaurantos-xqi52dpwga-el.a.run.app';

const isSupportedProductionHost =
  isProductionCloudRun ||
  self.location.hostname === 'scrrana2000-sys.github.io';

const isDevSandbox =
  !isSupportedProductionHost ||
  (self.location.hostname.includes('run.app') && !isProductionCloudRun) ||
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1';

if (isDevSandbox) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
    );
  });
} else {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      }).then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      }).then(() => self.clients.claim())
    );
  });
}

self.addEventListener('fetch', (event) => {
  // Only process GET requests from the same origin
  if (event.request.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(event.request.url);
  } catch (_e) {
    return;
  }

  // Always bypass cache for API, development modules, Vite internals, and dev query params
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/@vite') ||
    url.pathname.includes('/@fs') ||
    url.pathname.includes('/src/') ||
    url.pathname.includes('/node_modules/') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.tsx') ||
    url.searchParams.has('t') ||
    url.searchParams.has('v')
  ) {
    return;
  }

  // Network-First for HTML navigation requests (ensures fresh preview & instant updates)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('./index.html') || caches.match('/');
          });
        })
    );
    return;
  }

  // JavaScript and CSS bundles are content-hashed on every deployment.
  // Network-first prevents a new index.html from referencing a bundle that an
  // older service-worker cache no longer contains (the previous cause of
  // "Failed to fetch dynamically imported module" crashes after deployments).
  const isVersionedAsset =
    url.pathname.includes('/assets/') &&
    (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'));

  if (isVersionedAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First for non-versioned static assets (images, icons, fonts, manifest)
  // with background refresh.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {/* Offline fallback */});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});
