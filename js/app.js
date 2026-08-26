/* Zusammenspiel: Daten laden, Position verfolgen, filtern, anzeigen. */
(function () {
  "use strict";

  var el = {
    map: document.getElementById("map"),
    list: document.getElementById("list"),
    listCount: document.getElementById("list-count"),
    listTitle: document.getElementById("list-title"),
    empty: document.getElementById("empty"),
    tripStats: document.getElementById("trip-stats"),
    tripTitle: document.getElementById("trip-title"),
    dirBadge: document.getElementById("dir-badge"),
    btnDir: document.getElementById("btn-dir"),
    btnLocate: document.getElementById("btn-locate"),
    onlyAhead: document.getElementById("only-ahead"),
    dataNote: document.getElementById("data-note"),
    sheet: document.getElementById("sheet")
  };

  var state = {
    route: null,
    routePoints: null,
    cum: null,
    chargers: [],
    alongMe: null,       // eigene Position als Streckenmeter
    offRouteM: null,     // Abstand zur Route
    kmh: null,
    reverse: false,      // false = Hinfahrt, true = Rückfahrt
    activeId: null,
    watchId: null,
    centered: false      // wurde die Karte schon auf die eigene Position gezogen?
  };

  var filters = { minPower: 150, maxDetour: 0, need: [], onlyAhead: true,
                order: "strecke" };

  var speeds = [];       // gleitender Mittelwert der GPS-Geschwindigkeit

  // ------------------------------------------------------------- Meldungen

  var sheetTimer;
  function say(text, ms) {
    el.sheet.textContent = text;
    el.sheet.hidden = false;
    clearTimeout(sheetTimer);
    if (ms !== 0) {
      sheetTimer = setTimeout(function () { el.sheet.hidden = true; }, ms || 4000);
    }
  }

  // ------------------------------------------------------------- Rendern

  function navUrl(pos) {
    return "https://www.google.com/maps/dir/?api=1&destination=" +
           pos[0].toFixed(6) + "," + pos[1].toFixed(6) +
           "&travelmode=driving&dir_action=navigate";
  }

  function poiChips(c) {
    if (!c.pois.length) {
      return '<span class="poi-more">nichts in Laufweite getaggt</span>';
    }
    var shown = c.pois.slice(0, 6).map(function (p) {
      return '<span class="poi" title="' + Fmt.esc(Fmt.catName(p.cat)) + ", " +
             Fmt.km(p.dist_m) + ' zu Fuß">' + Fmt.icon(p.cat) + " " +
             Fmt.esc(p.name) + "</span>";
    }).join("");
    var rest = c.pois.length - 6;
    return shown + (rest > 0 ? '<span class="poi-more">+' + rest + " weitere</span>" : "");
  }

  function metricBlock(c) {
    var dist, distLabel, eta;
    if (c.aheadM == null) {
      dist = "km " + Math.round(c.route_m / 1000);
      distLabel = "Streckenpunkt";
      eta = "–";
    } else if (c.aheadM >= 0) {
      dist = Fmt.km(c.aheadM);
      distLabel = "noch";
      eta = c.etaMin != null ? Fmt.minutes(c.etaMin) + " · " + Fmt.clockIn(c.etaMin) : "–";
    } else {
      dist = Fmt.km(-c.aheadM);
      distLabel = "schon vorbei";
      eta = "hinter dir";
    }
    return '<div class="metrics">' +
      '<div><span class="metric-label">' + distLabel + '</span>' +
        '<span class="metric-value">' + dist + "</span></div>" +
      '<div><span class="metric-label">Ankunft</span>' +
        '<span class="metric-value"><small>ca.</small> ' + eta + "</span></div>" +
      '<div title="Abfahren, hinfahren, zurück auf die Route — zusammen ' +
        c.detour_min + ' Minuten und ' + String(c.detour_km).replace(".", ",") +
        ' km mehr als durchzufahren' + (c.exact ? " (gemessen)" : " (geschätzt)") + '">' +
        '<span class="metric-label">Umweg</span>' +
        '<span class="metric-value ' + Fmt.detourClass(c.detour_min) + '">+' +
        c.detour_min + " min<small> / " + String(c.detour_km).replace(".", ",") +
        " km</small></span></div>" +
      "</div>";
  }

  /* Farbstufe des Bewertungs-Badges. Gleiche Schwellen wie die Kartenpins,
     damit Liste und Karte dasselbe erzählen. */
  function scoreClass(score) {
    if (score >= 62) { return "score-top"; }
    if (score >= 42) { return "score-mid"; }
    return "score-low";
  }

  function cardHTML(c, index) {
    var sub = [c.operator || "Betreiber unbekannt"];
    if (c.stalls) { sub.push(c.stalls + " Ladepunkte"); }
    if (c.opening_hours === "24/7") { sub.push("24/7"); }
    return '<li class="card' + (c.id === state.activeId ? " is-active" : "") +
      '" data-id="' + Fmt.esc(c.id) + '">' +
      '<div class="card-head">' +
        '<div class="rank ' + scoreClass(c.score) + '" title="Bewertung ' + c.score +
          ' von 100 — aus Ladeleistung, Umweg, Umfeld und Anzahl Ladepunkte">' +
          c.score + "</div>" +
        '<div class="card-title"><h3>' + Fmt.esc(c.name) + "</h3>" +
          '<div class="card-sub">' + Fmt.esc(sub.join(" · ")) + "</div></div>" +
        '<div class="kw">' + c.power_kw + "<small> kW</small></div>" +
      "</div>" +
      metricBlock(c) +
      '<div class="pois">' + poiChips(c) + "</div>" +
      '<div class="actions">' +
        '<a class="btn btn-nav" href="' + navUrl(c.pos) + '" target="_blank" rel="noopener">' +
          "Navi starten</a>" +
        '<button type="button" class="btn" data-act="show">Auf Karte</button>' +
      "</div>" +
      "</li>";
  }

  function render() {
    var wirksam = Object.assign({}, filters,
      state.alongMe == null ? { order: "score" } : null);
    var list = Rank.apply(state.chargers, state, wirksam);
    el.list.innerHTML = list.map(cardHTML).join("");
    el.empty.hidden = list.length > 0;
    el.listCount.textContent = list.length + " von " + state.chargers.length +
      (filters.onlyAhead && state.alongMe != null ? " · nur voraus" : "");
    el.listTitle.textContent = state.reverse ? "Ladesäulen Richtung Clohars-Carnoët"
                                             : "Ladesäulen Richtung Aachen";
    MapView.drawChargers(list);
    MapView.setActive(state.activeId);
  }

  function renderTrip() {
    if (state.alongMe == null) {
      el.tripStats.textContent = "Position unbekannt — tippe auf GPS. " +
        "Ohne Position wird nach Bewertung sortiert.";
      return;
    }
    var total = state.cum[state.cum.length - 1];
    var remaining = state.reverse ? state.alongMe : total - state.alongMe;
    var kmh = state.kmh > 45 ? state.kmh : Rank.DEFAULT_KMH;
    var min = remaining / 1000 / kmh * 60;
    var parts = ["km " + Math.round(state.alongMe / 1000) + " von " + Math.round(total / 1000),
                 "noch " + Fmt.km(remaining),
                 "Ankunft ca. " + Fmt.clockIn(min)];
    if (state.offRouteM != null && state.offRouteM > 3000) {
      parts.push("⚠︎ " + Fmt.km(state.offRouteM) + " abseits der Route");
    }
    el.tripStats.textContent = parts.join(" · ");
  }

  // ------------------------------------------------------------- Position

  function onPosition(p) {
    var pos = [p.coords.latitude, p.coords.longitude];
    var proj = Geo.project(pos, state.routePoints, state.cum);
    state.alongMe = proj.along;
    state.offRouteM = proj.dist;

    if (p.coords.speed != null && p.coords.speed >= 0) {
      speeds.push(p.coords.speed * 3.6);
      if (speeds.length > 12) { speeds.shift(); }
      state.kmh = speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length;
    }

    MapView.setMe(pos, p.coords.accuracy);
    // Beim ersten Fix auf die Umgebung zoomen. Die Gesamtroute ist als
    // Übersicht schön, im Auto will man aber sehen, was gleich kommt.
    if (!state.centered) {
      state.centered = true;
      MapView.focus(pos, 9);
    }
    el.btnLocate.classList.add("is-on");
    syncOrderChips();
    renderTrip();
    render();
  }

  function onPositionError(err) {
    el.btnLocate.classList.remove("is-on");
    var msg = err.code === 1 ? "Standortfreigabe verweigert — bitte im Browser erlauben."
            : err.code === 3 ? "Standort dauert zu lange. Nochmal versuchen?"
            : "Standort nicht verfügbar (" + err.message + ")";
    say(msg, 6000);
  }

  function startWatching() {
    if (!navigator.geolocation) {
      say("Dieser Browser kennt keine Standortbestimmung.", 6000);
      return;
    }
    if (state.watchId != null) { navigator.geolocation.clearWatch(state.watchId); }
    say("Standort wird bestimmt …", 2500);
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000
    });
  }

  // ------------------------------------------------------------- Bedienung

  /* Solange keine Position bekannt ist, kann nicht nach Strecke sortiert
     werden. Das soll man den Knöpfen ansehen, statt es still zu ignorieren. */
  function syncOrderChips() {
    var known = state.alongMe != null;
    document.querySelectorAll("[data-order]").forEach(function (c) {
      var strecke = c.dataset.order === "strecke";
      c.disabled = strecke && !known;
      c.title = c.disabled ? "Erst möglich, wenn die Position bekannt ist" : "";
      c.classList.toggle("is-on", known ? c.dataset.order === filters.order
                                        : c.dataset.order === "score");
    });
  }

  function setDirection(reverse) {
    state.reverse = reverse;
    el.dirBadge.textContent = reverse ? "Rückfahrt" : "Hinfahrt";
    el.tripTitle.textContent = reverse ? "Aachen → Clohars-Carnoët"
                                       : "Clohars-Carnoët → Aachen";
    renderTrip();
    render();
  }

  function wireChips() {
    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        if (chip.dataset.power) {
          document.querySelectorAll("[data-power]").forEach(function (c) {
            c.classList.toggle("is-on", c === chip);
          });
          filters.minPower = Number(chip.dataset.power);
        } else if (chip.dataset.detour != null) {
          document.querySelectorAll("[data-detour]").forEach(function (c) {
            c.classList.toggle("is-on", c === chip);
          });
          filters.maxDetour = Number(chip.dataset.detour);
        } else if (chip.dataset.order) {
          document.querySelectorAll("[data-order]").forEach(function (c) {
            c.classList.toggle("is-on", c === chip);
          });
          filters.order = chip.dataset.order;
        } else if (chip.dataset.need) {
          chip.classList.toggle("is-on");
          filters.need = Array.prototype.map.call(
            document.querySelectorAll("[data-need].is-on"),
            function (c) { return c.dataset.need; }
          );
        }
        render();
      });
    });

    el.onlyAhead.addEventListener("change", function () {
      filters.onlyAhead = el.onlyAhead.checked;
      render();
    });

    el.btnDir.addEventListener("click", function () { setDirection(!state.reverse); });
    el.btnLocate.addEventListener("click", startWatching);

    el.list.addEventListener("click", function (ev) {
      var card = ev.target.closest(".card");
      if (!card) { return; }
      var id = card.dataset.id;
      state.activeId = id;
      MapView.setActive(id);
      document.querySelectorAll(".card").forEach(function (c) {
        c.classList.toggle("is-active", c.dataset.id === id);
      });
      if (ev.target.dataset.act === "show") {
        var c = state.chargers.find(function (x) { return x.id === id; });
        if (c) { MapView.focus(c.pos, 13); }
        el.map.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // ------------------------------------------------------------- Start

  function boot() {
    var mapOk = MapView.init({
      onSelect: function (id) {
        state.activeId = id;
        MapView.setActive(id);
        var card = el.list.querySelector('[data-id="' + CSS.escape(id) + '"]');
        if (card) {
          document.querySelectorAll(".card").forEach(function (c) {
            c.classList.toggle("is-active", c === card);
          });
          card.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    });

    if (!mapOk) {
      // Ohne Karte bleibt die Liste vollstaendig nutzbar — sie ist das,
      // was unterwegs gebraucht wird.
      el.map.innerHTML = '<p class="map-fallback">Karte nicht verfügbar. ' +
        "Liste, Umwege und Navigation funktionieren trotzdem.</p>";
    }

    Data.load().then(function (res) {
      state.route = res.route;
      var chosen = res.route.routes.find(function (r) { return r.gewaehlt; }) || res.route.routes[0];
      state.routePoints = chosen.points;
      state.cum = Geo.cumulative(chosen.points);
      state.chargers = res.chargers.chargers;

      MapView.drawRoutes(res.route);
      el.dataNote.textContent = state.chargers.length + " Schnellladesäulen ab " +
        res.chargers.min_kw + " kW entlang der " + chosen.name + " (" +
        chosen.distance_km.toFixed(0) + " km) · Stand " + res.chargers.generated +
        (res.fromCache ? " · offline aus dem Zwischenspeicher" : "");

      wireChips();
      syncOrderChips();
      renderTrip();
      render();
      startWatching();
    }).catch(function (err) {
      el.dataNote.textContent = "Daten konnten nicht geladen werden: " + err.message;
      say("Daten konnten nicht geladen werden. Seite über einen Webserver öffnen, " +
          "nicht per Doppelklick auf die Datei.", 0);
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* egal */ });
    }
  }

  boot();
})();
