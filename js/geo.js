/* Geometrie auf der Route: Entfernungen, Projektion der eigenen Position,
   Punkte in einer bestimmten Streckenentfernung. Alle Laengen in Metern. */
window.Geo = (function () {
  "use strict";

  var R = 6371008.8;
  var rad = Math.PI / 180;

  function haversine(a, b) {
    var p1 = a[0] * rad, p2 = b[0] * rad;
    var dp = p2 - p1, dl = (b[1] - a[1]) * rad;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* Aufsummierte Streckenlaenge je Stuetzpunkt — Basis fuer alle km-Angaben. */
  function cumulative(points) {
    var out = [0], i;
    for (i = 1; i < points.length; i++) {
      out.push(out[i - 1] + haversine(points[i - 1], points[i]));
    }
    return out;
  }

  /* Projiziert einen Punkt auf die Route.
     Liefert { dist, along, index }: Abstand zur Route, Streckenmeter der
     Projektion und Segmentindex. Rechnet in einer lokalen Ebene, das reicht
     auf diesen Distanzen und ist deutlich schneller als spherisch. */
  function project(point, points, cum) {
    var mx = Math.cos(point[0] * rad) * 111320, my = 110540;
    var px = point[1] * mx, py = point[0] * my;
    var best = { dist: Infinity, along: 0, index: 0 };
    for (var i = 0; i < points.length - 1; i++) {
      var ax = points[i][1] * mx, ay = points[i][0] * my;
      var bx = points[i + 1][1] * mx, by = points[i + 1][0] * my;
      var dx = bx - ax, dy = by - ay;
      var seg2 = dx * dx + dy * dy;
      var t = seg2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / seg2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var cx = ax + t * dx, cy = ay + t * dy;
      var d = Math.hypot(px - cx, py - cy);
      if (d < best.dist) {
        best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]), index: i };
      }
    }
    return best;
  }

  /* Punkt auf der Route bei Streckenmeter `target`. */
  function pointAt(points, cum, target) {
    var total = cum[cum.length - 1];
    target = Math.max(0, Math.min(total, target));
    var lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= target) { lo = mid; } else { hi = mid; }
    }
    var span = cum[hi] - cum[lo];
    var t = span === 0 ? 0 : (target - cum[lo]) / span;
    return [points[lo][0] + t * (points[hi][0] - points[lo][0]),
            points[lo][1] + t * (points[hi][1] - points[lo][1])];
  }

  return { haversine: haversine, cumulative: cumulative, project: project, pointAt: pointAt };
})();
