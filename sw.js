/* Service Worker: App und Datensatz offline verfuegbar halten.
   Unterwegs — Landstrasse, Grenzgebiet, Tunnel — ist genau das der Fall,
   in dem man die Liste braucht. Kartenkacheln bleiben online-abhaengig,
   alles andere funktioniert ohne Netz. */

var CACHE = "ladeplaner-v1";

var SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
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

  if (isTile) {
    // Kacheln: erst Cache (spart Datenvolumen), sonst Netz und ablegen.
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
    // Daten: erst Netz (frischer Stand), bei Ausfall der letzte bekannte.
    ev.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  ev.respondWith(
    caches.match(req).then(function (hit) { return hit || fetch(req); })
  );
});
