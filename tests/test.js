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

// Filter mit Muss-Gruppen (ODER innerhalb, UND zwischen Gruppen)
function grp(cats, brands, maxDist) {
  return { cats: cats, brands: brands || [], maxDist: maxDist || 1000 };
}
function fil(over) {
  return Object.assign({ preset: "alles", minPower: 150, maxDetour: 0,
                         needAny: [], order: "strecke", onlyAhead: true }, over);
}
const state = { alongMe: 0, reverse: false, kmh: 100 };
const mixed = [
  charger("p150", 100, { power_kw: 150, score: 50 }),
  charger("p350", 200, { power_kw: 350, score: 90 }),
  charger("weit", 300, { power_kw: 300, detour_min: 25, score: 70 }),
  charger("mcd", 400, { power_kw: 300, score: 80,
    pois: [{ cat: "fastfood", brand: "mcdonalds", name: "McDonald's", dist_m: 120 }] }),
  charger("spiel", 500, { power_kw: 300, score: 75,
    pois: [{ cat: "kinder", name: "Spielplatz", dist_m: 250 },
           { cat: "fastfood", name: "Friterie", dist_m: 700 }] })
];

let r = Rank.apply(mixed, state, fil({ minPower: 300 }));
ok("Leistungsfilter 300 kW lässt 150-kW-Säule raus",
   !r.some((c) => c.id === "p150") && r.length === 4, "n=" + r.length);

r = Rank.apply(mixed, state, fil({ maxDetour: 10 }));
ok("Umwegfilter 10 min entfernt die 25-min-Säule", !r.some((c) => c.id === "weit"));

r = Rank.apply(mixed, state, fil({ needAny: [grp(["fastfood"], [], 300)] }));
ok("Fastfood ≤300 m: nur McDonald's-Park bleibt",
   r.length === 1 && r[0].id === "mcd", "n=" + r.length + " " + r.map(c=>c.id));

r = Rank.apply(mixed, state, fil({ needAny: [grp(["kinder"], ["mcdonalds"], 400)] }));
ok("Kinder-Gruppe: Spielplatz ODER McDonald's erfüllt sie",
   r.length === 2 && r.some(c=>c.id==="mcd") && r.some(c=>c.id==="spiel"),
   r.map(c=>c.id).join(","));

r = Rank.apply(mixed, state, fil({ needAny: [grp(["kinder"], [], 400), grp(["fastfood"], [], 300)] }));
ok("zwei Gruppen = UND: keiner erfüllt beide", r.length === 0, "n=" + r.length);

// Presets
const kp = Rank.presetFilters("kinder");
ok("Preset kinder setzt 150 kW / ≤10 min", kp.minPower === 150 && kp.maxDetour === 10);
ok("Preset kinder hat genau eine Muss-Gruppe", kp.needAny.length === 1);
ok("Preset-Definition wird kopiert, nicht referenziert",
   (kp.needAny[0].cats.push("x"), Rank.presetFilters("kinder").needAny[0].cats.length === 1));
ok("deviationCount 0 bei unverändertem Preset",
   Rank.deviationCount(Rank.presetFilters("shoppen")) === 0);
const abw = Rank.presetFilters("shoppen"); abw.minPower = 300;
ok("deviationCount zählt Abweichungen", Rank.deviationCount(abw) === 1,
   String(Rank.deviationCount(abw)));

// Sortierung: was voraus liegt zuerst, dann nach Bewertung
r = Rank.apply(mixed, { alongMe: 250000, reverse: false, kmh: 100 },
               fil({ onlyAhead: false, order: "strecke" }));
ok("Sortierung: voraus liegende Säulen zuerst",
   r[r.length - 1].aheadM < 0, "letzte=" + r[r.length - 1].id);
r = Rank.apply(mixed, { alongMe: 0, reverse: false, kmh: 100 },
               fil({ order: "score" }));
ok("nach Bewertung: beste zuerst", r[0].id === "p350", "erste=" + r[0].id);

// Vorschlags-Engine
console.log("\nVorschläge");
// Bei 100 km/h: km 100 → 60 min ETA (im Fenster), km 200 → 120 min (draußen)
const sug1 = Rank.suggest(mixed, { alongMe: 0, reverse: false, kmh: 100 }, fil({}), {});
ok("Hero liegt im 20-75-min-Fenster", sug1 && sug1.hero.etaMin >= 20 && sug1.hero.etaMin <= 75,
   sug1 && String(sug1.hero.etaMin));
ok("Hero ist p150 (einziger im Fenster)", sug1.hero.id === "p150", sug1.hero.id);

// Alle im Fenster: der beste gewinnt
const dicht = [
  charger("a", 60, { score: 60, detour_min: 2 }),
  charger("b", 80, { score: 85, detour_min: 3 }),
  charger("c", 100, { score: 70, detour_min: 1 })
];
const sug2 = Rank.suggest(dicht, { alongMe: 0, reverse: false, kmh: 100 }, fil({}), {});
ok("bester Vorschlags-Score gewinnt", sug2.hero.id === "b", sug2.hero.id);
ok("zwei Alternativen", sug2.alts.length === 2);

// Gemerkter Stopp gewinnt
const sug3 = Rank.suggest(dicht, { alongMe: 0, reverse: false, kmh: 100 }, fil({}), { c: true });
ok("gemerkter Stopp schlägt besseren Score", sug3.hero.id === "c", sug3.hero.id);

// Umweg-Garantie: Hero mit >5 min Umweg zieht eine Direkt-Alternative nach
const umwegig = [
  charger("fern1", 60, { score: 95, detour_min: 9,
    pois: [{ cat: "mall", name: "Outlet", dist_m: 100 }] }),
  charger("fern2", 70, { score: 90, detour_min: 8 }),
  charger("fern3", 75, { score: 88, detour_min: 8 }),
  charger("direkt", 80, { score: 55, detour_min: 1 })
];
const sug4 = Rank.suggest(umwegig, { alongMe: 0, reverse: false, kmh: 100 }, fil({}), {});
ok("Hero mit Umweg > 5 min: Direkt-Option unter den Alternativen",
   sug4.hero.detour_min > 5 && sug4.alts.some(a => a.id === "direkt"),
   JSON.stringify([sug4.hero.id].concat(sug4.alts.map(a=>a.id))));

// Ohne Position: nächste voraus als Kandidaten, kein Absturz
const sug5 = Rank.suggest(dicht, { alongMe: null, reverse: false, kmh: null }, fil({}), {});
ok("Planmodus ohne Position liefert trotzdem einen Hero", !!sug5 && !!sug5.hero);

// Planmodus: Streckenordnung ohne Position = km ab Start, Richtung zählt
r = Rank.apply(dicht, { alongMe: null, reverse: false, kmh: null },
               fil({ order: "strecke" }));
ok("ohne Position: Hinfahrt sortiert km aufsteigend", r[0].id === "a" && r[2].id === "c",
   r.map(x => x.id).join(","));
r = Rank.apply(dicht, { alongMe: null, reverse: true, kmh: null },
               fil({ order: "strecke" }));
ok("ohne Position: Rückfahrt sortiert km absteigend", r[0].id === "c" && r[2].id === "a",
   r.map(x => x.id).join(","));

// Umgebungs-Ranking
const umf = [
  charger("kahl", 60, { score: 80, s_umfeld: 10 }),
  charger("gruen", 80, { score: 50, s_umfeld: 90 }),
  charger("mittel", 100, { score: 70, s_umfeld: 50 })
];
r = Rank.apply(umf, { alongMe: 0, reverse: false, kmh: 100 },
               fil({ order: "umgebung" }));
ok("Umgebungs-Ranking: grünster Stopp zuerst", r[0].id === "gruen" && r[2].id === "kahl",
   r.map(x => x.id).join(","));
const umf2 = [charger("vorbei", 10, { score: 40, s_umfeld: 95 })].concat(umf);
r = Rank.apply(umf2, { alongMe: 50000, reverse: false, kmh: 100 },
               fil({ order: "umgebung", onlyAhead: false }));
ok("Umgebungs-Ranking: Passiertes trotzdem ans Ende",
   r[r.length - 1].id === "vorbei", r.map(x => x.id).join(","));

// Nichts voraus → null
const sug6 = Rank.suggest(dicht, { alongMe: 999000, reverse: false, kmh: 100 }, fil({}), {});
ok("nichts voraus → null", sug6 === null, JSON.stringify(sug6));

console.log("\n" + pass + " bestanden, " + fail + " fehlgeschlagen\n");
process.exit(fail ? 1 : 0);
