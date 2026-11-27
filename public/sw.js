// The game's service worker: it makes the installed game (and the site) open without a
// connection. Registered by src/main.ts in the built game only, from src/ui/install.ts.
//
//   - Network first for the page: online, every visit gets the latest deploy, and the answer is
//     kept. Offline, the kept page answers, whatever the URL's ?seed= says.
//   - The page's own files (assets/, named by their content hash) are kept and served from the
//     cache: a hashed file never changes. Each time the page is kept, the files it no longer
//     names are dropped, so old deploys do not pile up.
//   - The manifest and the icons: network first, the cache when offline.
//   - Anything from another site (the Exo 2 font) is the browser's own business; offline the
//     game falls back to system fonts.
//
// When it is installed it fetches the page and everything the page names, so the game plays
// offline from the second visit on, not only after the files have been requested once more.

const CACHE = 'void-relics';
const SCOPE = self.registration.scope;
const PAGE = SCOPE;
const EXTRAS = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'].map((p) => new URL(p, SCOPE).href);

/** The hashed files the page names: its script and its stylesheet. */
function assetsOf(html) {
  return [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => new URL(m[1], SCOPE).href);
}

/** Keeps a fresh copy of the page, fetches what it names that is not kept yet, and drops the rest. */
async function keepPage(response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(PAGE, response);
  const assets = assetsOf(html);
  await Promise.all(
    assets.map(async (url) => {
      if (await cache.match(url)) return;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    }),
  );
  const keep = new Set([PAGE, ...assets, ...EXTRAS]);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch(PAGE, { cache: 'no-cache' });
        if (res.ok) await keepPage(res);
        const cache = await caches.open(CACHE);
        await Promise.all(EXTRAS.map((url) => fetch(url).then((r) => (r.ok ? cache.put(url, r) : undefined)).catch(() => undefined)));
      } catch {
        // Offline while installing: the cache fills on the next visit.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.href.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) event.waitUntil(keepPage(res.clone()).catch(() => undefined));
          return res;
        })
        .catch(async () => (await caches.match(PAGE)) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      (async () => {
        const kept = await caches.match(request);
        if (kept) return kept;
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          event.waitUntil(cache.put(request, res.clone()));
        }
        return res;
      })(),
    );
    return;
  }

  if (EXTRAS.includes(url.href)) {
    event.respondWith(
      fetch(request)
        .then(async (res) => {
          if (res.ok) {
            const cache = await caches.open(CACHE);
            event.waitUntil(cache.put(request, res.clone()));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) ?? Response.error()),
    );
  }
});
