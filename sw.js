/* Service Worker: App und Datensatz offline verfuegbar halten.

   Strategien:
   - App-Dateien (HTML/CSS/JS): stale-while-revalidate — sofort aus dem
     Cache antworten, im Hintergrund die neue Version holen. Damit ist die
     App offline-faehig UND ein Deployment erreicht jeden Nutzer spaetestens
     beim zweiten Oeffnen. (Vorher war das cache-first ohne Refresh: wer die
     App einmal geladen hatte, sah fuer immer die erste Version.)
   - Daten (JSON): erst Netz, bei Ausfall der letzte bekannte Stand.
   - Kartenkacheln: erst Cache (spart unterwegs Datenvolumen), sonst Netz.

   Der Cache-Name traegt die App-Version aus js/version.js — Versionssprung
   raeumt alte Caches ab. */

importScripts("js/version.js");

var CACHE = "ladeplaner-" + self.APP_VERSION;

var SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/version.js",
  "./js/geo.js",
  "./js/format.js",
  "./js/data.js",
  "./js/rank.js",
  "./js/map.js",
  "./js/app.js",
  "./data/route.json",
  "./data/chargers.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png"
];

self.addEventListener("install", function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Einzeln, damit ein einzelner Fehlschlag die Installation nicht kippt.
      return Promise.all(SHELL.map(function (url) {
        return c.add(url).catch(function () { /* dieses Asset eben nicht */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET") { return; }

  var url = new URL(req.url);
  var isTile = /tile\.openstreetmap\.org/.test(url.hostname);
  var isData = url.pathname.endsWith(".json");
  var isOwn = url.origin === self.location.origin;

  if (isTile) {
    ev.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () { return hit; });
      })
    );
    return;
  }

  if (isData) {
    ev.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  if (isOwn) {
    // stale-while-revalidate: Cache antwortet sofort, Netz aktualisiert leise.
    ev.respondWith(
      caches.match(req).then(function (hit) {
        var refresh = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return hit; });
        return hit || refresh;
      })
    );
    return;
  }

  ev.respondWith(
    caches.match(req).then(function (hit) { return hit || fetch(req); })
  );
});
