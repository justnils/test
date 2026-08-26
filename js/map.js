/* Karte: Route, Ladesäulen, eigene Position. */
window.MapView = (function () {
  "use strict";

  var map, meMarker, meAccuracy;
  var markers = {};          // id -> Leaflet-Marker
  var activeId = null;
  var onSelect = function () {};
  var ready = false;         // Karte nutzbar? Ohne sie laeuft der Rest weiter.

  /* Liefert true, wenn die Karte steht. Schlaegt das fehl — kein Leaflet,
     kein WebGL, was auch immer — bleibt die App bedienbar: die Liste mit
     Umwegen und Zielen ist der Teil, der unterwegs zaehlt. */
  function init(handlers) {
    onSelect = handlers.onSelect || onSelect;
    if (typeof L === "undefined") { return false; }
    try {
      map = L.map("map", {
        zoomControl: true,
        attributionControl: true,
        // Ohne Animationen. Drei Gründe: eine unterbrochene Zoom-Animation
        // lässt Leaflet jedes weitere setView verschlucken, die Karte hängt
        // dann fest; mit über hundert Markern kostet die Animation spürbar
        // Leistung; und beim Fahren will man den neuen Ausschnitt sofort
        // sehen, nicht hingleiten.
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
      map.setView([49.3, 1.5], 6);
      ready = true;
    } catch (e) {
      ready = false;
    }
    return ready;
  }

  /* Zeichnet die gewaehlte Nordroute kraeftig, andere Varianten nur blass
     als Orientierung. */
  function drawRoutes(routeData) {
    if (!ready) { return; }
    var chosen = null;
    routeData.routes.forEach(function (r) {
      var isChosen = r.gewaehlt;
      var line = L.polyline(r.points, {
        color: isChosen ? "#4ade80" : "#64748b",
        weight: isChosen ? 5 : 2,
        opacity: isChosen ? 0.95 : 0.35,
        dashArray: isChosen ? null : "6 8"
      }).addTo(map);
      line.bindPopup("<b>" + r.name + "</b><br>" + r.distance_km.toFixed(0).replace(".", ",") +
                     " km · ca. " + r.duration_h.toFixed(1).replace(".", ",") + " h" +
                     (isChosen ? "<br><i>gewählte Route</i>" : ""));
      if (isChosen) { chosen = line; }
    });
    L.marker(routeData.start.pos, { title: routeData.start.name }).addTo(map)
      .bindPopup("<b>Start</b><br>" + routeData.start.name);
    L.marker(routeData.ziel.pos, { title: routeData.ziel.name }).addTo(map)
      .bindPopup("<b>Ziel</b><br>" + routeData.ziel.name);
    if (chosen) { map.fitBounds(chosen.getBounds(), { padding: [24, 24] }); }
  }

  function pinClass(score) {
    if (score >= 62) { return "pin pin-top"; }
    if (score >= 42) { return "pin pin-mid"; }
    return "pin pin-low";
  }

  function drawChargers(list) {
    if (!ready) { return; }
    Object.keys(markers).forEach(function (id) { map.removeLayer(markers[id]); });
    markers = {};
    list.forEach(function (c, i) {
      var icon = L.divIcon({
        className: "",
        html: '<div class="' + pinClass(c.score) + (c.id === activeId ? " is-active" : "") +
              '">' + (i + 1) + "</div>",
        iconSize: [30, 30]
      });
      var m = L.marker(c.pos, { icon: icon, title: c.name }).addTo(map);
      m.on("click", function () { onSelect(c.id); });
      m.bindPopup(
        "<b>" + Fmt.esc(c.name) + "</b><br>" +
        c.power_kw + " kW · Umweg +" + c.detour_min + " min<br>" +
        (c.pois.length ? c.pois.slice(0, 4).map(function (p) {
          return Fmt.icon(p.cat) + " " + Fmt.esc(p.name);
        }).join("<br>") : "<i>nichts in Laufweite getaggt</i>")
      );
      markers[c.id] = m;
    });
  }

  function setActive(id) {
    activeId = id;
    if (!ready) { return; }
    Object.keys(markers).forEach(function (mid) {
      var el = markers[mid].getElement();
      if (el && el.firstChild) { el.firstChild.classList.toggle("is-active", mid === id); }
    });
  }

  function focus(pos, zoom) {
    if (!ready) { return; }
    // Ohne Animation: der Sprung ist sofort und verlässlich. Eine laufende
    // Zoom-Animation kann unterbrochen werden und die Karte steht dann falsch
    // — beim Fahren will man weder das eine noch das andere.
    map.setView(pos, zoom || Math.max(map.getZoom(), 12), { animate: false });
  }

  function setMe(pos, accuracy) {
    if (!ready) { return; }
    if (!meMarker) {
      meMarker = L.marker(pos, {
        icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [20, 20] }),
        zIndexOffset: 1000
      }).addTo(map);
      meAccuracy = L.circle(pos, { radius: accuracy || 50, color: "#60a5fa",
                                   weight: 1, fillOpacity: 0.08 }).addTo(map);
    } else {
      meMarker.setLatLng(pos);
      meAccuracy.setLatLng(pos).setRadius(accuracy || 50);
    }
  }

  function isReady() { return ready; }

  /* Nach Layoutwechseln (Fahrmodus schrumpft die Karte) muss Leaflet die
     neue Groesse erfahren, sonst rendert es in die alte Flaeche. */
  function invalidate() {
    if (ready) { setTimeout(function () { map.invalidateSize(); }, 60); }
  }

  return { init: init, isReady: isReady, invalidate: invalidate,
           drawRoutes: drawRoutes, drawChargers: drawChargers,
           setActive: setActive, focus: focus, setMe: setMe };
})();
