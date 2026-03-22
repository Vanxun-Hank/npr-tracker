/**
 * Service Worker — PWA Offline Support
 * ======================================
 * A service worker is a script that runs in the background,
 * separate from your web page. It acts as a proxy between
 * your app and the network.
 *
 * KEY CONCEPT: Service Workers
 * - They run in a separate thread (don't block the UI)
 * - They can intercept network requests
 * - They can cache files for offline use
 * - They enable "Add to Home Screen" on mobile
 *
 * KEY CONCEPT: Cache API
 * - caches.open(name) creates or opens a named cache
 * - cache.addAll(urls) downloads and stores files
 * - cache.match(request) checks if a request is cached
 * - Different strategies: cache-first, network-first, stale-while-revalidate
 *
 * LIFECYCLE:
 * 1. Install → cache app shell files
 * 2. Activate → clean up old caches
 * 3. Fetch → intercept requests and serve from cache
 *
 * You'll learn: service workers, caching strategies, PWA fundamentals
 */

// Cache version — bump this to force clearing old caches
var CACHE_NAME = 'npr-tracker-v3';

// Files to cache during installation (the "app shell")
// These are the minimum files needed to display the app
var APP_SHELL_FILES = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/player.js',
    '/js/transcript.js',
    '/js/bookmark.js',
    '/js/vocab.js',
    '/manifest.json',
];

/**
 * INSTALL EVENT
 * Fires when the service worker is first registered.
 * We use this to pre-cache the app shell files.
 *
 * self.skipWaiting() tells the browser to activate this
 * service worker immediately instead of waiting.
 */
self.addEventListener('install', function (event) {
    console.log('[SW] Installing service worker...');

    // event.waitUntil() keeps the install event alive
    // until the promise resolves (all files are cached)
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                console.log('[SW] Caching app shell files');
                return cache.addAll(APP_SHELL_FILES);
            })
            .then(function () {
                return self.skipWaiting();
            })
    );
});

/**
 * ACTIVATE EVENT
 * Fires after installation, when the service worker takes control.
 * We use this to clean up old caches from previous versions.
 */
self.addEventListener('activate', function (event) {
    console.log('[SW] Activating service worker...');

    event.waitUntil(
        caches.keys()
            .then(function (cacheNames) {
                // Delete any caches that don't match our current cache name
                return Promise.all(
                    cacheNames
                        .filter(function (name) {
                            return name !== CACHE_NAME;
                        })
                        .map(function (name) {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(function () {
                // Take control of all open tabs immediately
                return self.clients.claim();
            })
    );
});

/**
 * FETCH EVENT
 * Fires every time the app makes a network request.
 * We intercept the request and decide: serve from cache or network?
 *
 * STRATEGY: Network First, Cache Fallback
 * 1. Try to fetch from the network (get the latest code)
 * 2. If successful → update the cache and return the fresh response
 * 3. If offline → fall back to the cached version
 *
 * This ensures users always get the latest code when online,
 * while still working offline with the last cached version.
 *
 * EXCEPTION: API requests are never cached (always fresh data)
 */
self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);

    // Don't cache API requests — always fetch fresh data
    if (url.pathname.startsWith('/api/')) {
        return;  // Let the browser handle it normally
    }

    event.respondWith(
        fetch(event.request)
            .then(function (networkResponse) {
                // Got a fresh response — update the cache
                if (networkResponse && networkResponse.status === 200) {
                    var responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then(function (cache) {
                            cache.put(event.request, responseToCache);
                        });
                }
                return networkResponse;
            })
            .catch(function () {
                // Network failed (offline) — try the cache
                return caches.match(event.request);
            })
    );
});
