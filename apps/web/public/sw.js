/*
 * LifeScan service worker.
 *
 * Sole job: make /s/<id> render with no network.
 *
 * The scan page is entirely client-rendered from the URL fragment, so every
 * /s/* URL produces the same HTML document. We therefore cache ONE copy of
 * that document under a canonical key and serve it for any /s/* navigation.
 * That is what lets a tag written today still work offline tomorrow, and why
 * the demo phone only needs to have visited the app once, online, ever.
 *
 * Static chunks are cached lazily as they are requested, so a single online
 * visit primes everything the offline path needs.
 */

const VERSION = "lifescan-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

/** Canonical cache key for the scan-page document, independent of card id. */
const SHELL_KEY = "/__lifescan_scan_shell__";

self.addEventListener("install", (event) => {
  // Take over as soon as possible so the first visit primes the cache.
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      // Warm the shell using a representative scan URL. If the network is
      // unavailable at install time this simply no-ops; the first successful
      // navigation will populate it instead.
      try {
        const cache = await caches.open(SHELL_CACHE);
        const response = await fetch("/s/preview", { cache: "reload" });
        if (response.ok) await cache.put(SHELL_KEY, response.clone());
      } catch {
        /* offline at install — populated on first successful navigation */
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions so a deploy can't leave a stale
      // app shell serving forever.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Scan-page navigations — the offline-critical path.
  if (request.mode === "navigate" && url.pathname.startsWith("/s/")) {
    event.respondWith(handleScanNavigation(request));
    return;
  }

  // 2. Build assets — immutable, safe to serve cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.json") {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Everything else (chain RPC, guardian calls, agent stream) stays online-only
  // by design — those operations are meaningless without a network anyway.
});

/**
 * Network-first with a cached-shell fallback.
 *
 * Network-first (not cache-first) so a redeploy is picked up promptly when
 * online; the cached shell is the safety net that makes airplane mode work.
 */
async function handleScanNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(SHELL_KEY, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(SHELL_KEY);
    if (cached) return cached;

    return new Response(offlineFallbackHtml(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/**
 * Last-resort page shown only if the app shell was never cached. It still
 * surfaces the card data, because that data is in the URL fragment and needs
 * nothing but a browser to read.
 */
function offlineFallbackHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LifeScan — Emergency Medical ID</title>
<style>
  body{margin:0;background:#080d18;color:#e8edf7;font-family:system-ui,sans-serif;padding:24px}
  .k{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#2b3a5c}
  .v{font-size:28px;font-weight:800;margin:4px 0 20px}
  .blood{color:#2dd4a7;font-size:64px}
  .allergy{color:#ff4d5e}
  .note{margin-top:24px;font-size:11px;color:#2b3a5c;line-height:1.6}
</style>
</head>
<body>
  <div id="out"><p class="k">Reading card…</p></div>
  <p class="note">Offline fallback view. Data read from the card itself.</p>
<script>
  var parts = decodeURIComponent(location.hash.replace(/^#/,'')).split('|');
  var f = function(i){ var v = (parts[i]||'').trim(); return (!v||v==='-') ? 'NOT RECORDED' : v; };
  if (parts[0] === '0') {
    document.getElementById('out').innerHTML =
      '<p class="k">Patient</p><p class="v">' + f(2) + '</p>' +
      '<p class="k">Blood group</p><p class="v blood">' + f(3) + '</p>' +
      '<p class="k">Allergies</p><p class="v allergy">' + f(4) + '</p>' +
      '<p class="k">Implants / directives</p><p class="v">' + f(5) + '</p>' +
      '<p class="k">Emergency contact</p><p class="v">' + f(6) + '</p>';
  } else {
    document.getElementById('out').innerHTML =
      '<p class="k">Card could not be read</p>' +
      '<p class="v">Check the printed details on the card.</p>';
  }
</script>
</body>
</html>`;
}
