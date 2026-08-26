/* Laedt Route und Ladesäulen. Der Datensatz liegt statisch im Repo, damit die
   App auch ohne Netz funktioniert — unterwegs ist genau das der Normalfall.
   Zusaetzlich wird alles in localStorage gespiegelt. */
window.Data = (function () {
  "use strict";

  var KEY = "ladeplaner.cache.v1";

  function cacheRead() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function cacheWrite(payload) {
    try { localStorage.setItem(KEY, JSON.stringify(payload)); } catch (e) { /* Speicher voll */ }
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) { throw new Error(url + " → HTTP " + r.status); }
      return r.json();
    });
  }

  /* Liefert { route, chargers, fromCache }. Faellt bei Netzfehler auf den
     zuletzt gespeicherten Stand zurueck. */
  function load() {
    return Promise.all([getJSON("data/route.json"), getJSON("data/chargers.json")])
      .then(function (res) {
        var payload = { route: res[0], chargers: res[1], stored: Date.now() };
        cacheWrite(payload);
        return { route: payload.route, chargers: payload.chargers, fromCache: false };
      })
      .catch(function (err) {
        var c = cacheRead();
        if (c) {
          return { route: c.route, chargers: c.chargers, fromCache: true, error: err };
        }
        throw err;
      });
  }

  return { load: load };
})();
