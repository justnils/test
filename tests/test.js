/* Tests fuer die Rechenkerne der App: Projektion auf die Route,
   Fahrtrichtung und Filter. Aufruf: node tests/test.js */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const sandbox = { window: {}, console, Math, Date, CSS: { escape: (s) => s } };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

for (const f of ["geo.js", "format.js", "rank.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), sandbox, { filename: f });
}
const { Geo, Fmt, Rank } = sandbox.window;

let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}

function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// --------------------------------------------------------------- Geometrie

console.log("\nGeo");

// Paris -> Berlin, bekannter Grosskreis rund 878 km
const paris = [48.8566, 2.3522], berlin = [52.5200, 13.4050];
ok("haversine Paris–Berlin ≈ 878 km",
   near(Geo.haversine(paris, berlin) / 1000, 878, 8),
   (Geo.haversine(paris, berlin) / 1000).toFixed(1) + " km");

ok("haversine identischer Punkt = 0", Geo.haversine(paris, paris) === 0);

// Gerade Nord-Sued-Linie: 3 Punkte, je rund 111 km Abstand
const line = [[48, 2], [49, 2], [50, 2]];
const cum = Geo.cumulative(line);
ok("cumulative startet bei 0", cum[0] === 0);
ok("cumulative ist monoton", cum[1] > cum[0] && cum[2] > cum[1]);
ok("cumulative Gesamtlänge ≈ 222 km", near(cum[2] / 1000, 222.4, 2),
   (cum[2] / 1000).toFixed(1) + " km");

// Punkt exakt auf der Linie
let p = Geo.project([49, 2], line, cum);
ok("project: Punkt auf der Route hat Abstand ≈ 0", p.dist < 5, p.dist.toFixed(1) + " m");
ok("project: Streckenmeter ≈ Hälfte", near(p.along, cum[2] / 2, 500),
   (p.along / 1000).toFixed(1) + " km");

// Punkt seitlich versetzt (rund 0,1° Laenge auf 49° ≈ 7,3 km)
p = Geo.project([49, 2.1], line, cum);
ok("project: seitlicher Abstand ≈ 7,3 km", near(p.dist / 1000, 7.3, 0.5),
   (p.dist / 1000).toFixed(2) + " km");
ok("project: Streckenmeter bleibt bei der Hälfte", near(p.along, cum[2] / 2, 800));

// Punkt vor dem Anfang klemmt auf 0
p = Geo.project([47, 2], line, cum);
ok("project: vor dem Start klemmt auf 0", p.along < 1);

// pointAt ist die Umkehrung von project
const mid = Geo.pointAt(line, cum, cum[2] / 2);
ok("pointAt Mitte ≈ [49, 2]", near(mid[0], 49, 0.02) && near(mid[1], 2, 0.02),
   JSON.stringify(mid.map((v) => +v.toFixed(3))));
ok("pointAt klemmt über das Ende hinaus", Geo.pointAt(line, cum, 1e9)[0] === 50);
ok("pointAt klemmt unter 0", Geo.pointAt(line, cum, -1e9)[0] === 48);

// --------------------------------------------------------------- Format

console.log("\nFmt");
ok("km unter 950 m in Metern", Fmt.km(430) === "430 m", Fmt.km(430));
ok("km unter 10 km mit Komma", Fmt.km(4200) === "4,2 km", Fmt.km(4200));
ok("km darüber gerundet", Fmt.km(87400) === "87 km", Fmt.km(87400));
ok("minutes unter einer Stunde", Fmt.minutes(47) === "47 min", Fmt.minutes(47));
ok("minutes mit Stunden", Fmt.minutes(135) === "2 h 15", Fmt.minutes(135));
ok("minutes glatte Stunde", Fmt.minutes(120) === "2 h", Fmt.minutes(120));
ok("detourClass kurz = grün", Fmt.detourClass(4) === "detour-good");
ok("detourClass mittel = gelb", Fmt.detourClass(9) === "detour-mid");
ok("detourClass lang = rot", Fmt.detourClass(18) === "detour-bad");
ok("esc entschärft HTML", Fmt.esc('<a "x">') === "&lt;a &quot;x&quot;&gt;", Fmt.esc('<a "x">'));

// --------------------------------------------------------------- Rank

console.log("\nRank");

function charger(id, routeKm, opts) {
  return Object.assign({
    id, name: "L" + id, pos: [49, 2], power_kw: 300, stalls: 8,
    route_m: routeKm * 1000, detour_min: 4, detour_km: 3, score: 60, pois: []
  }, opts || {});
}

const set = [
  charger("a", 100),
  charger("b", 300),
  charger("c", 500)
];

// Hinfahrt bei km 300: a liegt hinter uns, c vor uns
let live = Rank.withLiveMetrics(set, { alongMe: 300000, reverse: false, kmh: 100 });
ok("Hinfahrt: a liegt hinter uns", live[0].isAhead === false, "aheadM=" + live[0].aheadM);
ok("Hinfahrt: c liegt vor uns", live[2].isAhead === true);
ok("Hinfahrt: Entfernung zu c = 200 km", live[2].aheadM === 200000);
ok("Hinfahrt: Restzeit zu c = 120 min bei 100 km/h", near(live[2].etaMin, 120, 0.1),
   String(live[2].etaMin));

// Rückfahrt bei km 300: jetzt ist a voraus und c hinter uns
live = Rank.withLiveMetrics(set, { alongMe: 300000, reverse: true, kmh: 100 });
ok("Rückfahrt: a liegt jetzt vor uns", live[0].isAhead === true, "aheadM=" + live[0].aheadM);
ok("Rückfahrt: c liegt jetzt hinter uns", live[2].isAhead === false);
ok("Rückfahrt: Entfernung zu a = 200 km", live[0].aheadM === 200000);

// Gerade passierte Ausfahrt bleibt kurz stehen (1,5 km Toleranz)
live = Rank.withLiveMetrics([charger("d", 100)], { alongMe: 101000, reverse: false, kmh: 100 });
ok("1 km hinter uns bleibt sichtbar", live[0].isAhead === true, "aheadM=" + live[0].aheadM);
live = Rank.withLiveMetrics([charger("d", 100)], { alongMe: 103000, reverse: false, kmh: 100 });
ok("3 km hinter uns fällt raus", live[0].isAhead === false);

// Ohne Position gilt alles als voraus
live = Rank.withLiveMetrics(set, { alongMe: null, reverse: false, kmh: null });
ok("ohne Position ist alles sichtbar", live.every((c) => c.isAhead));
ok("ohne Position keine Restzeit", live.every((c) => c.etaMin === null));

// Fallback-Tempo, wenn GPS zu langsam meldet (Stau, Standstreifen)
live = Rank.withLiveMetrics(set, { alongMe: 300000, reverse: false, kmh: 3 });
ok("unrealistisch langsames GPS-Tempo wird ersetzt",
   near(live[2].etaMin, 200 / Rank.DEFAULT_KMH * 60, 0.1), String(live[2].etaMin));

// Filter
const state = { alongMe: 0, reverse: false, kmh: 100 };
const mixed = [
  charger("p150", 100, { power_kw: 150, score: 50 }),
  charger("p350", 200, { power_kw: 350, score: 90 }),
  charger("weit", 300, { power_kw: 300, detour_min: 25, score: 70 }),
  charger("burger", 400, { power_kw: 300, score: 80,
                           pois: [{ cat: "burger", name: "McDonald's", dist_m: 120 }] })
];

let r = Rank.apply(mixed, state, { minPower: 300, maxDetour: 0, need: [], onlyAhead: true });
ok("Leistungsfilter 300 kW lässt 150-kW-Säule raus",
   !r.some((c) => c.id === "p150") && r.length === 3, "n=" + r.length);

r = Rank.apply(mixed, state, { minPower: 150, maxDetour: 10, need: [], onlyAhead: true });
ok("Umwegfilter 10 min entfernt die 25-min-Säule", !r.some((c) => c.id === "weit"));

r = Rank.apply(mixed, state, { minPower: 150, maxDetour: 0, need: ["burger"], onlyAhead: true });
ok("Burger-Filter lässt nur die passende Säule übrig",
   r.length === 1 && r[0].id === "burger", "n=" + r.length);

r = Rank.apply(mixed, state, { minPower: 150, maxDetour: 0, need: ["burger", "mall"], onlyAhead: true });
ok("mehrere Bedingungen müssen alle zutreffen", r.length === 0, "n=" + r.length);

// Sortierung: was voraus liegt zuerst, dann nach Bewertung
r = Rank.apply(mixed, { alongMe: 250000, reverse: false, kmh: 100 },
               { minPower: 150, maxDetour: 0, need: [], onlyAhead: false });
ok("Sortierung: voraus liegende Säulen zuerst",
   r[r.length - 1].id === "p150", "letzte=" + r[r.length - 1].id);
ok("Sortierung: unter den voraus liegenden die beste zuerst",
   r[0].id === "burger", "erste=" + r[0].id);

// Reihenfolge: nach Strecke vs. nach Bewertung
const weit = charger("weit-gut", 800, { score: 95 });     // top, aber 500 km weiter
const nah = charger("nah-mittel", 320, { score: 55 });    // mittelmäßig, gleich da
const posBekannt = { alongMe: 300000, reverse: false, kmh: 100 };
const basisFilter = { minPower: 150, maxDetour: 0, need: [], onlyAhead: true };

r = Rank.apply([weit, nah], posBekannt, { ...basisFilter, order: "strecke" });
ok("nach Strecke: die nächste Säule steht oben", r[0].id === "nah-mittel", "erste=" + r[0].id);

r = Rank.apply([weit, nah], posBekannt, { ...basisFilter, order: "score" });
ok("nach Bewertung: die beste Säule steht oben", r[0].id === "weit-gut", "erste=" + r[0].id);

// Bereits passierte Säulen landen in beiden Ordnungen hinten
const vorbei = charger("vorbei", 299, { score: 99 });
r = Rank.apply([vorbei, nah], posBekannt, { ...basisFilter, onlyAhead: false, order: "strecke" });
ok("nach Strecke: Passiertes ans Ende", r[r.length - 1].id === "vorbei");
r = Rank.apply([vorbei, nah], posBekannt, { ...basisFilter, onlyAhead: false, order: "score" });
ok("nach Bewertung: Passiertes trotz Top-Wertung ans Ende",
   r[r.length - 1].id === "vorbei", "letzte=" + r[r.length - 1].id);

// Ohne Position ist die Streckenordnung wirkungslos
r = Rank.apply([weit, nah], { alongMe: null, reverse: false, kmh: null },
               { ...basisFilter, order: "strecke" });
ok("ohne Position greift die Bewertungsordnung", r[0].id === "weit-gut", "erste=" + r[0].id);

console.log("\n" + pass + " bestanden, " + fail + " fehlgeschlagen\n");
process.exit(fail ? 1 : 0);
