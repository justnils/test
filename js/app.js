/* Zusammenspiel: Daten, Position, Presets, Vorschlag, Anzeige.

   Leitprinzip aus dem UX-Konzept: Der Default-Zustand ist bereits eine
   Antwort. Oben steht ein konkreter Stopp-Vorschlag (Hero + Alternativen),
   die volle Liste ist der zweite Blick. Es gibt genau EINEN Filterzustand:
   Preset-Chips, Filter-Sheet und beide Modi lesen und schreiben dasselbe
   Objekt. */
(function () {
  "use strict";

  var el = {};
  ["map", "list", "list-count", "list-title", "empty", "empty-why", "empty-reset",
   "trip-stats", "trip-title", "dir-badge", "btn-dir", "btn-locate", "btn-filter",
   "mode-plan", "mode-fahrt", "hero", "preset-chips", "need-chips", "only-ahead",
   "filter-sheet", "sheet-backdrop", "sheet-reset", "sheet-apply", "data-note",
   "sheet"].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] =
      document.getElementById(id);
  });

  var state = {
    mode: "plan",        // "plan" (Küchentisch) oder "fahrt" (unterwegs)
    route: null,
    routePoints: null,
    cum: null,
    chargers: [],
    alongMe: null,
    offRouteM: null,
    kmh: null,
    reverse: false,
    activeId: null,
    watchId: null,
    centered: false,
    fahrtHint: false,    // Fahrmodus-Vorschlag schon gezeigt?
    merked: {}           // Stopp gemerkt (Stern), je Richtung persistiert
  };

  var filters = Rank.presetFilters("alles");
  var speeds = [];
  var SMOOTH = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto" : "smooth";

  // Welche POIs in der Kurzzeile zuerst stehen, haengt vom Preset ab.
  var POI_PRIO = {
    kinder: ["kinder", "fastfood", "wc"],
    essen: ["fastfood", "restaurant", "cafe"],
    shoppen: ["mall", "mode", "deko"],
    laden: [], alles: []
  };

  var NEED_OPTIONS = ["kinder", "fastfood", "mall", "mode", "deko", "supermarkt", "wc"];

  var SONNTAG = new Date().getDay() === 0;

  /* Abschnitte der Strecke fuer die Sticky-Koepfe. Kommt normalerweise aus
     route.json (vom Generator auf die echte Route projiziert); die Konstante
     ist nur Rueckfall fuer alte Datenstaende. */
  var REGIONS_FALLBACK = [
    { bis_km: 125, name: "Bretagne", sub: "N165 Lorient – Vannes" },
    { bis_km: 250, name: "Rennes & A84", sub: "Rennes – Avranches" },
    { bis_km: 430, name: "Normandie", sub: "Caen – Pont de Normandie" },
    { bis_km: 560, name: "Côte d'Albâtre", sub: "Saint-Valery · Übernachtung" },
    { bis_km: 700, name: "Picardie", sub: "A29 Richtung Amiens" },
    { bis_km: 810, name: "Hauts-de-France", sub: "A2 Valenciennes" },
    { bis_km: 950, name: "Belgien", sub: "Mons – Namur – Lüttich" },
    { bis_km: 9999, name: "Aachen & Umgebung", sub: "E40 – Ziel" }
  ];
  var regions = REGIONS_FALLBACK;

  function regionFor(routeM) {
    var km = routeM / 1000;
    for (var i = 0; i < regions.length; i++) {
      if (km <= regions[i].bis_km) { return regions[i]; }
    }
    return regions[regions.length - 1];
  }

  // ------------------------------------------------------------- Speicher

  function merkKey() { return "ladeplaner.merked." + (state.reverse ? "rueck" : "hin"); }

  function loadMerked() {
    try { state.merked = JSON.parse(localStorage.getItem(merkKey())) || {}; }
    catch (e) { state.merked = {}; }
  }

  function saveMerked() {
    try { localStorage.setItem(merkKey(), JSON.stringify(state.merked)); }
    catch (e) { /* Speicher voll — dann eben nicht */ }
  }

  // ------------------------------------------------------------ Meldungen

  var sheetTimer;
  function say(text, ms) {
    el.sheet.textContent = text;
    el.sheet.hidden = false;
    clearTimeout(sheetTimer);
    if (ms !== 0) {
      sheetTimer = setTimeout(function () { el.sheet.hidden = true; }, ms || 4000);
    }
  }

  // ------------------------------------------------------------- Bausteine

  function navUrl(pos) {
    return "https://www.google.com/maps/dir/?api=1&destination=" +
           pos[0].toFixed(6) + "," + pos[1].toFixed(6) +
           "&travelmode=driving&dir_action=navigate";
  }

  /* Die eine wichtige Zeile: wann bin ich da, was kostet der Abstecher. */
  function primaryLine(c) {
    var teile = [];
    if (c.etaMin != null) {
      teile.push("in " + Fmt.minutes(c.etaMin));
      teile.push("an ≈ " + Fmt.clockIn(c.etaMin));
    } else if (c.aheadM != null && c.aheadM < 0) {
      teile.push(Fmt.km(-c.aheadM) + " hinter dir");
    } else {
      teile.push("km " + Math.round(c.route_m / 1000));
    }
    teile.push('<span class="' + Fmt.detourClass(c.detour_min) + '">' +
               Fmt.detourText(c.detour_min) + "</span>");
    return teile.join(" · ");
  }

  /* Kurzzeile Nutzen: die drei relevantesten Orte MIT Namen und Fussweg. */
  function topPois(c, n) {
    var prio = POI_PRIO[filters.preset] || [];
    var sorted = c.pois.slice().sort(function (a, b) {
      var pa = prio.indexOf(a.cat), pb = prio.indexOf(b.cat);
      pa = pa < 0 ? 99 : pa; pb = pb < 0 ? 99 : pb;
      if (pa !== pb) { return pa - pb; }
      return a.dist_m - b.dist_m;
    });
    // je Kategorie nur der naechste Vertreter, sonst 3x Bäcker
    var seen = {}, out = [];
    for (var i = 0; i < sorted.length && out.length < n; i++) {
      var p = sorted[i];
      if (seen[p.cat + "|" + p.name]) { continue; }
      seen[p.cat + "|" + p.name] = true;
      if (seen["cat:" + p.cat] && prio.indexOf(p.cat) < 0) { continue; }
      seen["cat:" + p.cat] = true;
      out.push(p);
    }
    return out;
  }

  function poiChip(p) {
    var warn = SONNTAG && p.sunday === "closed";
    return '<span class="poi' + (warn ? " poi-zu" : "") + '">' +
      Fmt.icon(p.cat) + " " + Fmt.esc(p.name) +
      ' <small>' + Fmt.km(p.dist_m) + (p.kids ? " · Spielbereich" : "") +
      (warn ? " · So. zu" : "") + "</small></span>";
  }

  function nutzenLine(c) {
    var top = topPois(c, 3);
    if (!top.length) {
      return '<span class="poi-more">nichts in Laufweite getaggt' +
             (c.raststaette ? " · Raststätte (WC vorhanden)" : "") + "</span>";
    }
    var rest = c.pois.length - top.length;
    return top.map(poiChip).join("") +
      (rest > 0 ? '<button type="button" class="poi-more" data-act="more">+' +
                  rest + " weitere</button>" : "");
  }

  function umfeldClass(v) {
    if (v >= 62) { return "umf-top"; }
    if (v >= 42) { return "umf-mid"; }
    return "umf-low";
  }

  function badges(c) {
    var out = [];
    var u = c.s_umfeld || 0;
    out.push('<span class="tag tag-umfeld ' + umfeldClass(u) +
      '" title="Attraktivität der Umgebung: ' + u + ' von 100 — ' +
      'aus Familien-, Shopping- und Essens-Angebot in Laufweite">🌳 ' + u + "</span>");
    if (c.raststaette) { out.push('<span class="tag tag-rast">Raststätte</span>'); }
    if (c.s_familie >= 60) { out.push('<span class="tag">🧒 ' + c.s_familie + "</span>"); }
    if (c.s_shopping >= 60) { out.push('<span class="tag">🛍️ ' + c.s_shopping + "</span>"); }
    return out.join("");
  }

  function scoreClass(score) {
    if (score >= 62) { return "score-top"; }
    if (score >= 42) { return "score-mid"; }
    return "score-low";
  }

  function detailsHTML(c) {
    var zeilen = [];
    if (c.operator) { zeilen.push("Betreiber: " + Fmt.esc(c.operator)); }
    if (c.stalls) { zeilen.push(c.stalls + " Ladepunkte"); }
    if (c.opening_hours) { zeilen.push("Ladesäule: " + Fmt.esc(c.opening_hours)); }
    zeilen.push("Umweg hin+zurück: +" + c.detour_min + " min / " +
                String(c.detour_km).replace(".", ",") + " km" +
                (c.exact ? " (gemessen)" : " (geschätzt)"));
    var gruppen = {};
    c.pois.forEach(function (p) { (gruppen[p.cat] = gruppen[p.cat] || []).push(p); });
    var poiHtml = Object.keys(gruppen).map(function (cat) {
      return '<div class="det-group"><span class="det-cat">' + Fmt.icon(cat) + " " +
        Fmt.esc(Fmt.catName(cat)) + "</span>" +
        gruppen[cat].map(poiChip).join("") + "</div>";
    }).join("");
    return '<div class="card-details">' +
      '<p class="det-meta">' + zeilen.join(" · ") + "</p>" + poiHtml + "</div>";
  }

  function cardHTML(c) {
    var open = c.id === state.activeId;
    return '<li class="card' + (open ? " is-active" : "") + '" data-id="' + Fmt.esc(c.id) + '">' +
      '<div class="card-head">' +
        '<div class="rank ' + scoreClass(c.score) + '" title="Bewertung ' + c.score + ' von 100">' +
          c.score + "</div>" +
        '<div class="card-title"><h3>' + Fmt.esc(c.name) + "</h3>" +
          '<div class="card-sub">' + primaryLine(c) + "</div></div>" +
        '<div class="kw">' + c.power_kw + "<small> kW</small></div>" +
        '<button type="button" class="star' + (state.merked[c.id] ? " is-on" : "") +
          '" data-act="merk" aria-label="Stopp merken" aria-pressed="' +
          (!!state.merked[c.id]) + '">' + (state.merked[c.id] ? "★" : "☆") + "</button>" +
      "</div>" +
      '<div class="pois">' + nutzenLine(c) + badges(c) + "</div>" +
      (open ? detailsHTML(c) : "") +
      '<div class="actions">' +
        '<a class="btn btn-nav" href="' + navUrl(c.pos) + '" target="_blank" rel="noopener">Navi starten</a>' +
        '<button type="button" class="btn" data-act="show">Karte</button>' +
      "</div>" +
      "</li>";
  }

  // ---------------------------------------------------------------- Hero

  function heroAltHTML(c) {
    return '<button type="button" class="hero-alt" data-id="' + Fmt.esc(c.id) + '">' +
      '<span class="hero-alt-name">' + Fmt.esc(c.name) + "</span>" +
      '<span class="hero-alt-meta">' + primaryLine(c) + "</span></button>";
  }

  function renderHero() {
    var sug = Rank.suggest(state.chargers, state, filters, state.merked);
    if (!sug) { el.hero.hidden = true; return; }
    var h = sug.hero;
    var label = state.alongMe == null
      ? "Vorschlag für den ersten Stopp"
      : "Nächster guter Stopp";
    el.hero.innerHTML =
      '<p class="hero-label">' + label + "</p>" +
      '<div class="hero-card" data-id="' + Fmt.esc(h.id) + '">' +
        '<div class="hero-head"><h3>' + Fmt.esc(h.name) + "</h3>" +
          '<span class="kw">' + h.power_kw + "<small> kW</small></span></div>" +
        '<p class="hero-primary">' + primaryLine(h) + "</p>" +
        '<div class="pois">' + nutzenLine(h) + "</div>" +
        '<div class="actions">' +
          '<a class="btn btn-nav" href="' + navUrl(h.pos) + '" target="_blank" rel="noopener">Navi starten</a>' +
          '<button type="button" class="btn" data-act="show">Karte</button>' +
        "</div></div>" +
      (sug.alts.length ? '<div class="hero-alts">' + sug.alts.map(heroAltHTML).join("") + "</div>" : "") +
      '<button type="button" class="hero-all" id="hero-all">Alle Ladeparks ↓</button>';
    el.hero.hidden = false;
  }

  // ---------------------------------------------------------------- Liste

  function render() {
    var wirksam = filters;
    var list = Rank.apply(state.chargers, state, wirksam);
    if (wirksam.order === "strecke") {
      var html = [], lastRegion = null;
      var dir = state.reverse ? -1 : 1;
      list.forEach(function (c) {
        var r = regionFor(c.route_m);
        if (r !== lastRegion && (c.aheadM == null || c.aheadM >= 0)) {
          lastRegion = r;
          html.push('<li class="list-section" aria-hidden="true"><span>' +
            Fmt.esc(r.name) + '</span><small>' + Fmt.esc(r.sub) + "</small></li>");
        }
        html.push(cardHTML(c));
      });
      el.list.innerHTML = html.join("");
    } else {
      el.list.innerHTML = list.map(cardHTML).join("");
    }
    el.empty.hidden = list.length > 0;
    if (!list.length) {
      var why = [];
      if (filters.preset !== "alles") { why.push("Preset „" + presetLabel(filters.preset) + "“"); }
      if (filters.maxDetour > 0) { why.push("Umweg ≤ " + filters.maxDetour + " min"); }
      if (filters.minPower > 150) { why.push("ab " + filters.minPower + " kW"); }
      el.emptyWhy.textContent = why.length
        ? "Aktiv: " + why.join(", ") + ". Eine Stufe lockern hilft meist."
        : "Vermutlich liegt nichts mehr voraus — Richtung oder „nur voraus“ prüfen.";
    }
    el.listCount.textContent = list.length + " von " + state.chargers.length;
    el.listTitle.textContent = state.reverse ? "Ladeparks Richtung Clohars-Carnoët"
                                             : "Ladeparks Richtung Aachen";
    MapView.drawChargers(list);
    MapView.setActive(state.activeId);
    renderHero();
    renderChips();
  }

  function presetLabel(p) {
    var map = { laden: "Nur laden", essen: "Schnell essen",
                kinder: "Mit Kindern", shoppen: "Shoppen", alles: "Alles" };
    return map[p] || p;
  }

  function renderTrip() {
    if (state.alongMe == null) {
      el.tripStats.textContent = state.mode === "plan"
        ? "Planmodus — Vorschläge gelten ab Start. GPS für Live-Werte."
        : "Position unbekannt — tippe auf GPS.";
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

  // ------------------------------------------------------------- Filter-UI

  function renderChips() {
    var abw = Rank.deviationCount(filters);
    document.querySelectorAll("[data-preset]").forEach(function (chip) {
      var on = chip.dataset.preset === filters.preset;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-checked", String(on));
      chip.classList.toggle("is-tuned", on && abw > 0);
    });
    el.btnFilter.textContent = abw > 0 ? "Filter (" + abw + ")" : "Filter";
    el.btnFilter.classList.toggle("is-on", abw > 0);
  }

  function needCounts() {
    var live = Rank.withLiveMetrics(state.chargers, state);
    var counts = {};
    NEED_OPTIONS.forEach(function (cat) {
      counts[cat] = live.filter(function (c) {
        return (!filters.onlyAhead || c.isAhead) &&
               c.pois.some(function (p) { return p.cat === cat && p.dist_m <= 500; });
      }).length;
    });
    return counts;
  }

  function activeNeedCats() {
    var cats = {};
    filters.needAny.forEach(function (g) {
      g.cats.forEach(function (c) { cats[c] = true; });
    });
    return cats;
  }

  function syncSheet() {
    document.querySelectorAll("[data-power]").forEach(function (b) {
      b.classList.toggle("is-on", Number(b.dataset.power) === filters.minPower);
    });
    document.querySelectorAll("[data-detour]").forEach(function (b) {
      b.classList.toggle("is-on", Number(b.dataset.detour) === filters.maxDetour);
    });
    document.querySelectorAll("[data-order]").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.order === filters.order);
    });
    el.onlyAhead.checked = filters.onlyAhead;

    var counts = needCounts();
    var active = activeNeedCats();
    el.needChips.innerHTML = NEED_OPTIONS.map(function (cat) {
      return '<button type="button" class="chip' + (active[cat] ? " is-on" : "") +
        '" data-need="' + cat + '">' + Fmt.icon(cat) + " " + Fmt.catName(cat) +
        ' <small>' + counts[cat] + "</small></button>";
    }).join("");
    updateApplyCount();
  }

  function updateApplyCount() {
    var n = Rank.apply(state.chargers, state, filters).length;
    el.sheetApply.textContent = n + (n === 1 ? " Ladepark anzeigen" : " Ladeparks anzeigen");
  }

  function openSheet() {
    syncSheet();
    el.filterSheet.hidden = false;
    el.sheetBackdrop.hidden = false;
    document.body.classList.add("sheet-open");
  }

  function closeSheet() {
    el.filterSheet.hidden = true;
    el.sheetBackdrop.hidden = true;
    document.body.classList.remove("sheet-open");
    render();
  }

  /* Umgebungs-Chips im Sheet: Auswahl wird EINE Muss-Gruppe (ODER). */
  function setNeedFromChips() {
    var cats = Array.prototype.map.call(
      el.needChips.querySelectorAll(".is-on"),
      function (b) { return b.dataset.need; });
    filters.needAny = cats.length
      ? [{ cats: cats, brands: cats.indexOf("kinder") >= 0 ? ["mcdonalds", "burgerking"] : [],
           maxDist: 500 }]
      : [];
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
    if (!state.centered) {
      state.centered = true;
      MapView.focus(pos, 9);
    }
    // Faehrt offensichtlich schon auf der Route -> einmal Fahrmodus anbieten
    if (state.mode === "plan" && !state.fahrtHint && state.kmh > 60 && proj.dist < 3000) {
      state.fahrtHint = true;
      say("Du bist unterwegs — oben auf „Fahren“ tippen für die Fahransicht.", 8000);
    }
    el.btnLocate.classList.add("is-on");
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
      enableHighAccuracy: true, maximumAge: 5000, timeout: 20000
    });
  }

  // ------------------------------------------------------------- Bedienung

  function setDirection(reverse) {
    state.reverse = reverse;
    el.dirBadge.textContent = reverse ? "Rückfahrt" : "Hinfahrt";
    el.tripTitle.textContent = reverse ? "Aachen → Clohars-Carnoët"
                                       : "Clohars-Carnoët → Aachen";
    loadMerked();
    renderTrip();
    render();
  }

  function setMode(mode) {
    state.mode = mode;
    document.body.classList.toggle("mode-fahrt", mode === "fahrt");
    el.modePlan.classList.toggle("is-on", mode === "plan");
    el.modeFahrt.classList.toggle("is-on", mode === "fahrt");
    el.modePlan.setAttribute("aria-selected", String(mode === "plan"));
    el.modeFahrt.setAttribute("aria-selected", String(mode === "fahrt"));
    if (mode === "fahrt") {
      // Unterwegs zaehlt nur, was vor einem liegt — in Streckenreihenfolge.
      filters.order = "strecke";
      filters.onlyAhead = true;
      if (state.watchId == null) { startWatching(); }
    }
    MapView.invalidate();
    renderTrip();
    render();
  }

  function findCharger(id) {
    return state.chargers.find(function (x) { return x.id === id; });
  }

  function onCardClick(ev) {
    var host = ev.target.closest("[data-id]");
    if (!host) { return; }
    var id = host.dataset.id;
    var act = ev.target.dataset.act || ev.target.closest("[data-act]") &&
              ev.target.closest("[data-act]").dataset.act;

    if (act === "merk") {
      if (state.merked[id]) { delete state.merked[id]; } else { state.merked[id] = true; }
      saveMerked();
      render();
      return;
    }
    if (act === "show") {
      var c = findCharger(id);
      if (c) { state.activeId = id; MapView.focus(c.pos, 13); }
      el.map.scrollIntoView({ behavior: SMOOTH, block: "start" });
      render();
      return;
    }
    if (ev.target.closest(".hero-alt")) {
      state.activeId = id;
      render();
      var card = el.list.querySelector('[data-id="' + CSS.escape(id) + '"]');
      if (card) { card.scrollIntoView({ behavior: SMOOTH, block: "center" }); }
      return;
    }
    if (ev.target.closest("a")) { return; }   // Navi-Link ungestoert lassen
    // Karte auf-/zuklappen (Progressive Disclosure)
    state.activeId = state.activeId === id ? null : id;
    render();
  }

  function wire() {
    document.querySelectorAll("[data-preset]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        // Erneuter Tap auf das aktive Preset = zuruecksetzen auf die Definition.
        filters = Rank.presetFilters(chip.dataset.preset);
        if (state.mode === "fahrt") { filters.order = "strecke"; filters.onlyAhead = true; }
        render();
      });
    });

    el.btnFilter.addEventListener("click", openSheet);
    el.sheetBackdrop.addEventListener("click", closeSheet);
    el.sheetApply.addEventListener("click", closeSheet);
    el.sheetReset.addEventListener("click", function () {
      filters = Rank.presetFilters(filters.preset);
      syncSheet();
    });

    el.filterSheet.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) { return; }
      if (b.dataset.power) { filters.minPower = Number(b.dataset.power); }
      else if (b.dataset.detour != null) { filters.maxDetour = Number(b.dataset.detour); }
      else if (b.dataset.order) { filters.order = b.dataset.order; }
      else if (b.dataset.need) { b.classList.toggle("is-on"); setNeedFromChips(); }
      else { return; }
      syncSheet();
    });

    el.onlyAhead.addEventListener("change", function () {
      filters.onlyAhead = el.onlyAhead.checked;
      updateApplyCount();
    });

    el.btnDir.addEventListener("click", function () { setDirection(!state.reverse); });
    el.btnLocate.addEventListener("click", startWatching);
    el.modePlan.addEventListener("click", function () { setMode("plan"); });
    el.modeFahrt.addEventListener("click", function () { setMode("fahrt"); });
    el.emptyReset.addEventListener("click", function () {
      filters = Rank.presetFilters("alles");
      render();
    });

    el.list.addEventListener("click", onCardClick);

    var fab = document.getElementById("fab-top");
    var fabTick = false;
    window.addEventListener("scroll", function () {
      if (fabTick) { return; }
      fabTick = true;
      requestAnimationFrame(function () {
        fab.hidden = window.scrollY < 900;
        fabTick = false;
      });
    }, { passive: true });
    fab.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: SMOOTH });
    });
    el.hero.addEventListener("click", function (ev) {
      if (ev.target.id === "hero-all") {
        el.list.scrollIntoView({ behavior: SMOOTH, block: "start" });
        return;
      }
      onCardClick(ev);
    });
  }

  // ------------------------------------------------------------------ Start

  function boot() {
    var mapOk = MapView.init({
      onSelect: function (id) {
        state.activeId = id;
        render();
        var card = el.list.querySelector('[data-id="' + CSS.escape(id) + '"]');
        if (card) { card.scrollIntoView({ behavior: SMOOTH, block: "center" }); }
      }
    });
    if (!mapOk) {
      el.map.innerHTML = '<p class="map-fallback">Karte nicht verfügbar. ' +
        "Vorschläge, Liste und Navigation funktionieren trotzdem.</p>";
    }

    Data.load().then(function (res) {
      state.route = res.route;
      var chosen = res.route.routes.find(function (r) { return r.gewaehlt; }) || res.route.routes[0];
      state.routePoints = chosen.points;
      state.cum = Geo.cumulative(chosen.points);
      state.chargers = res.chargers.chargers;
      if (res.route.regions && res.route.regions.length) {
        regions = res.route.regions;
      }
      loadMerked();

      MapView.drawRoutes(res.route);
      var etappen = (chosen.legs && chosen.legs.length === 2)
        ? " · Etappe 1: " + Math.round(chosen.legs[0].km) + " km bis Saint-Valery, " +
          "Etappe 2: " + Math.round(chosen.legs[1].km) + " km bis Aachen"
        : "";
      el.dataNote.textContent = state.chargers.length + " Schnellladeparks ab " +
        res.chargers.min_kw + " kW · " + chosen.name + " (" +
        chosen.distance_km.toFixed(0) + " km)" + etappen +
        " · Stand " + res.chargers.generated +
        (res.fromCache ? " · offline aus dem Zwischenspeicher" : "") +
        " · App " + (self.APP_VERSION || "?");

      wire();
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
