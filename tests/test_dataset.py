#!/usr/bin/env python3
"""Tests fuer den Datensatz-Generator. Aufruf: python3 tests/test_dataset.py

Schwerpunkt ist das Auslesen der Ladeleistung: OSM-Tags sind hier sehr
uneinheitlich getaggt, und ein Parserfehler wuerde entweder 50-kW-Saeulen
durchlassen oder 300-kW-Saeulen verschlucken.
"""

import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("bd", os.path.join(ROOT, "tools", "build_dataset.py"))
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)

PASS = FAIL = 0


def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}" + (f"  → {detail}" if detail else ""))


def eq(name, got, want):
    ok(name, got == want, f"erhalten {got!r}, erwartet {want!r}")


print("\nLeistung aus OSM-Tags")
p = bd.parse_power_kw
eq("charging_station:output '150 kW'", p({"charging_station:output": "150 kW"}), 150)
eq("Steckerangabe 'socket:type2_combo:output'",
   p({"socket:type2_combo:output": "300 kW"}), 300)
eq("ohne Einheit, kleine Zahl = kW", p({"maxpower": "350"}), 350)
eq("blanke Wattangabe wird umgerechnet", p({"maxpower": "150000"}), 150)
eq("explizite Wattangabe", p({"charging_station:output": "22000 W"}), 22)
eq("Komma statt Punkt", p({"charging_station:output": "62,5 kW"}), 62.5)
eq("mehrere Werte — der größte zählt",
   p({"socket:type2:output": "22 kW", "socket:type2_combo:output": "150 kW"}), 150)
eq("Semikolonliste in einem Tag", p({"charging_station:output": "50 kW;150 kW"}), 150)
eq("Freitext mit Zahl", p({"charging_station:output": "up to 300 kW"}), 300)
eq("kein Leistungstag = 0", p({"amenity": "charging_station", "name": "X"}), 0)
eq("unbrauchbarer Wert = 0", p({"charging_station:output": "yes"}), 0)
eq("Großschreibung stört nicht", p({"charging_station:output": "150 KW"}), 150)
eq("Abstruse Werte werden verworfen", p({"maxpower": "99999999"}), 0)

print("\nFilterschwelle 150 kW")
for tags, erwartet in [
    ({"charging_station:output": "150 kW"}, True),
    ({"charging_station:output": "149 kW"}, False),
    ({"socket:type2_combo:output": "350 kW"}, True),
    ({"socket:type2:output": "22 kW"}, False),
]:
    ok(f"{tags} → {'behalten' if erwartet else 'verworfen'}",
       (p(tags) >= 150) == erwartet)

print("\nProfil-Scores")
def poi(cat, dist, **kw):
    return {"cat": cat, "name": cat, "dist_m": dist, "pos": [49.0, 2.0], **kw}

gold = [poi("kinder", 150, art="playground"), poi("fastfood", 200, brand="mcdonalds"), poi("wc", 100)]
ok("Familien-Gold (Spielplatz+McD+WC nah) über 80", bd.score_familie(gold) > 80,
   str(bd.score_familie(gold)))
kein_auslauf = [poi("fastfood", 100, brand="mcdonalds"), poi("wc", 50), poi("cafe", 80)]
ok("Bewegungs-Veto deckelt ohne Spielplatz auf ≤25",
   bd.score_familie(kein_auslauf) <= 25, str(bd.score_familie(kein_auslauf)))
weit = [poi("kinder", 900, art="playground"), poi("fastfood", 900)]
ok("Alles 900 m weg zählt kaum", bd.score_familie(weit) < 25, str(bd.score_familie(weit)))
ok("leer = 0", bd.score_familie([]) == 0)
nur_picknick = [poi("kinder", 100, art="picnic"), poi("kinder", 200, art="picnic"),
                poi("fastfood", 150), poi("wc", 100)]
ok("Picknicktische allein sind keine Bewegung (Veto greift)",
   bd.score_familie(nur_picknick) <= 25, str(bd.score_familie(nur_picknick)))
mit_bolzplatz = nur_picknick + [poi("kinder", 250, art="pitch")]
ok("Bolzplatz hebt das Veto auf", bd.score_familie(mit_bolzplatz) > 50,
   str(bd.score_familie(mit_bolzplatz)))

outlet = [poi("mall", 200, outlet=True)] + [poi("mode", 100 + i) for i in range(12)]
ok("Outlet mit vielen Läden über 75", bd.score_shopping(outlet) > 75,
   str(bd.score_shopping(outlet)))
einzeln = [poi("mode", 400)]
ok("Ein einzelner Laden bleibt klein", bd.score_shopping(einzeln) < 25,
   str(bd.score_shopping(einzeln)))
ok("Outlet schlägt gleiche Mall ohne Outlet",
   bd.score_shopping(outlet) > bd.score_shopping(
       [poi("mall", 200)] + [poi("mode", 100 + i) for i in range(12)]))

voll = [poi("fastfood", 100, brand="burgerking"), poi("restaurant", 200),
        poi("cafe", 150), poi("supermarkt", 250)]
ok("volles Essensangebot über 80", bd.score_essen(voll) > 80, str(bd.score_essen(voll)))
ok("nur Café bleibt unter 25", bd.score_essen([poi("cafe", 200)]) < 25)

print("\nGeometrie")
linie = [(48.0, 2.0), (49.0, 2.0), (50.0, 2.0)]
cum = bd.cumulative(linie)
ok("cumulative monoton", cum[0] == 0 and cum[1] < cum[2])
d, along, _ = bd.project_on_route((49.0, 2.0), linie, cum)
ok("Punkt auf der Linie: Abstand ≈ 0", d < 5, f"{d:.1f} m")
ok("Punkt auf der Linie: halbe Strecke", abs(along - cum[2] / 2) < 500)
mitte = bd.point_at_distance(linie, cum, cum[2] / 2)
ok("point_at_distance trifft die Mitte", abs(mitte[0] - 49.0) < 0.02, str(mitte))
ok("point_at_distance klemmt am Ende", bd.point_at_distance(linie, cum, 1e9)[0] == 50.0)

print("\nUmwegschätzung")
km, minuten = bd.estimate_detour(0)
ok("direkt an der Route: nur der Ab-/Auffahrt-Zuschlag", km == 0.0 and minuten == 4,
   f"{km} km, {minuten} min")
km2, min2 = bd.estimate_detour(5000)
ok("5 km abseits ergibt mehr Umweg als 0 km", min2 > minuten and km2 > km,
   f"{km2} km, {min2} min")
ok("Umweg zählt hin und zurück", abs(km2 - 2 * 5.0 * 1.4) < 0.11, f"{km2} km")

print("\nBewertung")
basis = {"power_kw": 150, "detour_min": 20, "stalls": 2,
         "s_familie": 0, "s_shopping": 0, "s_essen": 0}
top = {"power_kw": 350, "detour_min": 0, "stalls": 12, "raststaette": "services",
       "s_familie": 95, "s_shopping": 80, "s_essen": 90}
ok("schlechtester Fall nahe 0", bd.score(basis) < 15, str(bd.score(basis)))
ok("bester Fall über 85", bd.score(top) > 85, str(bd.score(top)))
ok("kurzer Umweg schlägt langen",
   bd.score({**basis, "detour_min": 2}) > bd.score({**basis, "detour_min": 18}))
ok("mehr Leistung schlägt weniger",
   bd.score({**basis, "power_kw": 350}) > bd.score({**basis, "power_kw": 150}))
ok("gutes Profil hebt die Bewertung",
   bd.score({**basis, "s_familie": 90}) > bd.score(basis))
ok("ein Spitzenprofil zählt mehr als drei laue",
   bd.score({**basis, "s_familie": 90}) > bd.score({**basis, "s_familie": 35,
                                                    "s_shopping": 35, "s_essen": 35}))
ok("Raststätte gibt Bonus",
   bd.score({**basis, "raststaette": "services"}) > bd.score(basis))
ok("Bewertung bleibt im Bereich 0-100",
   all(0 <= bd.score(x) <= 100 for x in (basis, top, {**basis, "stalls": 999})))

print("\nLückensuche")
g = bd.find_gaps([10, 30, 120, 130, 200], 45)
ok("findet die 90-km-Lücke", (30.0, 120.0) in [(a, b) for a, b in g], str(g))
ok("findet die 70-km-Lücke am Ende", any(abs(a-130)<0.1 and abs(b-200)<0.1 for a,b in g), str(g))
ok("kleine Abstände sind keine Lücke", not any(b-a < 45 for a, b in g))
ok("Strecke ab km 0 zählt mit", bd.find_gaps([60, 70], 45)[0][0] == 0.0,
   str(bd.find_gaps([60, 70], 45)))
ok("keine Lücken → leer", bd.find_gaps([10, 40, 80, 120], 45) == [])

print("\nNordroute statt Paris")
nord = {"id": "n", "distance_m": 937600, "duration_s": 36600,
        "points": [(47.79, -3.55), (48.69, -1.37), (49.18, -0.37),
                   (49.43, 0.27), (49.89, 2.30), (50.47, 4.52), (50.78, 6.08)]}
paris = {"id": "p", "distance_m": 989500, "duration_s": 39800,
         "points": [(47.79, -3.55), (48.08, -0.93), (48.86, 2.35),
                    (49.12, 4.24), (49.86, 5.51), (50.78, 6.08)]}
bd.classify_route(nord)
bd.classify_route(paris)
ok("Nordvariante wird als solche erkannt", nord["ist_nordroute"] is True,
   f"maxVia={nord['via_nord_max_m']} Paris={nord['paris_m']}")
ok("Paris-Variante wird verworfen", paris["ist_nordroute"] is False,
   f"Paris={paris['paris_m']}")
ok("Auswahl nimmt die Nordvariante",
   bd.pick_nordroute([paris, nord])["id"] == "n")

print(f"\n{PASS} bestanden, {FAIL} fehlgeschlagen\n")
sys.exit(1 if FAIL else 0)
