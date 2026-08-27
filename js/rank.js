/* Filtern, bewerten, sortieren und VORSCHLAGEN.

   Kernidee aus dem UX-Konzept: Die App beantwortet "Wo halten wir?" —
   deshalb liefert dieses Modul nicht nur eine gefilterte Liste, sondern
   auch einen konkreten Vorschlag (Hero + Alternativen).

   Es gibt genau einen Filterzustand. Presets sind nur Schreibhilfen, die
   dieselben Felder setzen wie die Regler im Filter-Sheet. */
window.Rank = (function () {
  "use strict";

  var DEFAULT_KMH = 95;      // Annahme Autobahn, solange kein GPS-Tempo vorliegt
  var MIN_KMH = 45;          // darunter wird die Restzeit unbrauchbar lang

  /* Presets: Jede Definition beschreibt einen kompletten Filterzustand.
     needAny ist eine Liste von Muss-Gruppen; jede Gruppe ist erfüllt, wenn
     IRGENDEIN POI passt (ODER innerhalb der Gruppe, UND zwischen Gruppen).
     Ein POI passt, wenn Kategorie ODER Marke stimmt und er nah genug ist. */
  var PRESETS = {
    alles:  { minPower: 150, maxDetour: 0,  needAny: [] },
    laden:  { minPower: 200, maxDetour: 5,  needAny: [] },
    essen:  { minPower: 150, maxDetour: 10,
              needAny: [{ cats: ["fastfood"], brands: [], maxDist: 300 }] },
    kinder: { minPower: 150, maxDetour: 10,
              needAny: [{ cats: ["kinder"], brands: ["mcdonalds", "burgerking"],
                          maxDist: 400 }] },
    shoppen:{ minPower: 150, maxDetour: 15,
              needAny: [{ cats: ["mall", "mode", "deko"], brands: [],
                          maxDist: 500 }] }
  };

  function presetFilters(name) {
    var p = PRESETS[name] || PRESETS.alles;
    return {
      preset: name,
      minPower: p.minPower,
      maxDetour: p.maxDetour,
      needAny: p.needAny.map(function (g) {
        return { cats: g.cats.slice(), brands: g.brands.slice(), maxDist: g.maxDist };
      }),
      order: "strecke",
      onlyAhead: true
    };
  }

  /* Weicht der aktuelle Zustand von der Preset-Definition ab?
     (Fuer den "angepasst"-Punkt am Chip und den Filter-Zaehler.) */
  function deviationCount(filters) {
    var p = PRESETS[filters.preset] || PRESETS.alles;
    var n = 0;
    if (filters.minPower !== p.minPower) { n++; }
    if (filters.maxDetour !== p.maxDetour) { n++; }
    var a = JSON.stringify(filters.needAny.map(groupKey).sort());
    var b = JSON.stringify(p.needAny.map(groupKey).sort());
    if (a !== b) { n++; }
    return n;
  }

  function groupKey(g) {
    return g.cats.slice().sort().join(",") + "|" +
           g.brands.slice().sort().join(",") + "|" + g.maxDist;
  }

  function groupMatches(group, poi) {
    if (poi.dist_m > group.maxDist) { return false; }
    if (group.cats.indexOf(poi.cat) >= 0) { return true; }
    return !!poi.brand && group.brands.indexOf(poi.brand) >= 0;
  }

  function satisfiedGroups(charger, needAny) {
    var n = 0;
    for (var i = 0; i < needAny.length; i++) {
      for (var j = 0; j < charger.pois.length; j++) {
        if (groupMatches(needAny[i], charger.pois[j])) { n++; break; }
      }
    }
    return n;
  }

  // ------------------------------------------------------------ Live-Werte

  function withLiveMetrics(chargers, state) {
    var alongMe = state.alongMe;
    var reverse = state.reverse;
    var kmh = state.kmh > MIN_KMH ? state.kmh : DEFAULT_KMH;

    return chargers.map(function (c) {
      var out = Object.create(c);
      if (alongMe == null) {
        out.aheadM = null;
        out.isAhead = true;
        out.etaMin = null;
      } else {
        // Auf der Rueckfahrt laeuft die Streckenzaehlung rueckwaerts.
        var delta = reverse ? (alongMe - c.route_m) : (c.route_m - alongMe);
        out.aheadM = delta;
        out.isAhead = delta > -1500;   // gerade passierte Ausfahrt springt nicht weg
        out.etaMin = delta > 0 ? (delta / 1000) / kmh * 60 : null;
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- Filter

  function passesFilters(c, f) {
    if (c.power_kw < f.minPower) { return false; }
    if (f.maxDetour > 0 && c.detour_min > f.maxDetour) { return false; }
    if (f.onlyAhead && !c.isAhead) { return false; }
    return satisfiedGroups(c, f.needAny) === f.needAny.length;
  }

  function sort(list, state, order) {
    if (order === "umgebung") {
      // Ranking nach Attraktivitaet der Umgebung; Passiertes ans Ende.
      return list.slice().sort(function (a, b) {
        if (state.alongMe != null && a.aheadM != null && b.aheadM != null) {
          var aN = a.aheadM >= 0, bN = b.aheadM >= 0;
          if (aN !== bN) { return aN ? -1 : 1; }
        }
        if ((b.s_umfeld || 0) !== (a.s_umfeld || 0)) {
          return (b.s_umfeld || 0) - (a.s_umfeld || 0);
        }
        return b.score - a.score;
      });
    }
    var byRoute = order === "strecke";
    var dir = state.reverse ? -1 : 1;
    return list.slice().sort(function (a, b) {
      if (state.alongMe != null && a.aheadM != null && b.aheadM != null) {
        var aNear = a.aheadM >= 0, bNear = b.aheadM >= 0;
        if (aNear !== bNear) { return aNear ? -1 : 1; }
      }
      if (byRoute) {
        // Mit Position: was naeher voraus liegt zuerst. Ohne Position
        // (Kuechentisch-Planung): Streckenkilometer ab Start, auf der
        // Rueckfahrt rueckwaerts.
        if (a.aheadM != null && b.aheadM != null && a.aheadM !== b.aheadM) {
          return a.aheadM - b.aheadM;
        }
        if (a.aheadM == null && a.route_m !== b.route_m) {
          return (a.route_m - b.route_m) * dir;
        }
      }
      if (b.score !== a.score) { return b.score - a.score; }
      return (a.aheadM || 0) - (b.aheadM || 0);
    });
  }

  function apply(chargers, state, filters) {
    var live = withLiveMetrics(chargers, state);
    var kept = live.filter(function (c) { return passesFilters(c, filters); });
    return sort(kept, state, filters.order);
  }

  // ------------------------------------------------------------ Vorschlaege

  /* Vorschlags-Score: Basisbewertung, Umweg zaehlt doppelt schwer,
     Leistung und erfuellte Preset-Wuensche geben Bonus, gemerkte Stopps
     gewinnen fast immer. */
  function suggestScore(c, filters, merked) {
    var pts = c.score
            - 4 * c.detour_min
            + Math.min(15, (c.power_kw - 150) / 10)
            + Math.min(30, 15 * satisfiedGroups(c, filters.needAny));
    if (merked && merked[c.id]) { pts += 25; }
    return pts;
  }

  /* Hero + Alternativen. Kandidaten liegen voraus im Zeitfenster 20-75 min
     (leer -> auf 90 min weiten; immer noch leer -> naechste 3 voraus).
     Garantie: Hat der Hero >5 min Umweg, wird eine Alternative durch den
     besten fast-umweglosen Park (<=3 min) ersetzt — die "eigentlich wollte
     ich gar nicht abfahren"-Option fehlt sonst genau dann, wenn man sie
     braucht. */
  function suggest(chargers, state, filters, merked) {
    var live = withLiveMetrics(chargers, state);
    var pool = live.filter(function (c) {
      return passesFilters(c, filters) && c.isAhead && (c.aheadM == null || c.aheadM > 0);
    });

    function inWindow(maxMin) {
      return pool.filter(function (c) {
        return c.etaMin != null && c.etaMin >= 20 && c.etaMin <= maxMin;
      });
    }

    var cand = [];
    if (state.alongMe != null) {
      cand = inWindow(75);
      if (!cand.length) { cand = inWindow(90); }
    }
    if (!cand.length) {
      // Ohne Position (Planmodus) oder leeres Fenster: die naechsten voraus.
      cand = sort(pool, state, "strecke").slice(0, 8);
    }
    if (!cand.length) { return null; }

    cand.sort(function (a, b) {
      return suggestScore(b, filters, merked) - suggestScore(a, filters, merked);
    });
    var hero = cand[0];
    var alts = cand.slice(1, 3);

    if (hero.detour_min > 5) {
      var direkt = pool.filter(function (c) {
        return c.detour_min <= 3 && c.id !== hero.id;
      }).sort(function (a, b) {
        return suggestScore(b, filters, merked) - suggestScore(a, filters, merked);
      })[0];
      if (direkt && alts.every(function (a) { return a.id !== direkt.id; })) {
        alts = [alts[0], direkt].filter(Boolean).slice(0, 2);
      }
    }
    return { hero: hero, alts: alts };
  }

  return { apply: apply, withLiveMetrics: withLiveMetrics, sort: sort,
           suggest: suggest, suggestScore: suggestScore,
           presetFilters: presetFilters, deviationCount: deviationCount,
           satisfiedGroups: satisfiedGroups, PRESETS: PRESETS,
           DEFAULT_KMH: DEFAULT_KMH };
})();
