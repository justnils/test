/* Filtern, bewerten und sortieren der Ladesäulen — abhaengig davon, wo man
   gerade ist und in welche Richtung man faehrt. */
window.Rank = (function () {
  "use strict";

  var DEFAULT_KMH = 95;      // Annahme Autobahn, solange kein GPS-Tempo vorliegt
  var MIN_KMH = 45;          // darunter wird die Restzeit unbrauchbar lang

  /* Ergaenzt jede Saeule um Werte, die von der aktuellen Position abhaengen:
     Entfernung entlang der Route, Restzeit, liegt sie noch vor mir. */
  function withLiveMetrics(chargers, state) {
    var alongMe = state.alongMe;       // Streckenmeter der eigenen Position
    var reverse = state.reverse;       // true = Rückfahrt
    var kmh = state.kmh > MIN_KMH ? state.kmh : DEFAULT_KMH;

    return chargers.map(function (c) {
      var out = Object.create(c);
      if (alongMe == null) {
        out.aheadM = null;
        out.isAhead = true;
        out.etaMin = null;
      } else {
        // Auf der Rückfahrt laeuft die Streckenzaehlung rueckwaerts.
        var delta = reverse ? (alongMe - c.route_m) : (c.route_m - alongMe);
        out.aheadM = delta;
        out.isAhead = delta > -1500;   // 1,5 km Toleranz, damit die gerade
                                       // passierte Ausfahrt nicht wegspringt
        out.etaMin = delta > 0 ? (delta / 1000) / kmh * 60 : null;
      }
      return out;
    });
  }

  function passesFilters(c, f) {
    if (c.power_kw < f.minPower) { return false; }
    if (f.maxDetour > 0 && c.detour_min > f.maxDetour) { return false; }
    if (f.onlyAhead && !c.isAhead) { return false; }
    if (f.need.length) {
      var cats = {};
      c.pois.forEach(function (p) { cats[p.cat] = true; });
      for (var i = 0; i < f.need.length; i++) {
        if (!cats[f.need[i]]) { return false; }
      }
    }
    return true;
  }

  /* Zwei Ordnungen, weil zwei Fragen dahinterstecken:
     "strecke" — was kommt als Nächstes? Das braucht man am Steuer.
     "score"   — was lohnt sich am meisten? Das plant man vorher.
     Ohne bekannte Position ergibt die Streckenordnung keinen Sinn, dann
     wird immer nach Bewertung sortiert. */
  function sort(list, state, order) {
    var byRoute = order === "strecke" && state.alongMe != null;
    return list.slice().sort(function (a, b) {
      // Bereits passierte Säulen rutschen in beiden Ordnungen ans Ende.
      if (state.alongMe != null && a.aheadM != null && b.aheadM != null) {
        var aNear = a.aheadM >= 0, bNear = b.aheadM >= 0;
        if (aNear !== bNear) { return aNear ? -1 : 1; }
      }
      if (byRoute && a.aheadM != null && b.aheadM != null && a.aheadM !== b.aheadM) {
        return a.aheadM - b.aheadM;
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

  return { apply: apply, withLiveMetrics: withLiveMetrics, sort: sort,
           DEFAULT_KMH: DEFAULT_KMH };
})();
