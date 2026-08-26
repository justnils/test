#!/usr/bin/env python3
"""Tests fuer tools/poi_rules.py: Markenerkennung, Kategorien, Oeffnungszeiten."""

import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("pr", os.path.join(ROOT, "tools", "poi_rules.py"))
pr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pr)

PASS = FAIL = 0

def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {name}")
    else: FAIL += 1; print(f"  ✗ {name}" + (f"  → {detail}" if detail else ""))

def eq(name, got, want):
    ok(name, got == want, f"erhalten {got!r}, erwartet {want!r}")

print("\nMarkenerkennung")
mb = pr.match_brand
eq("McDonald's über wikidata", mb({"brand:wikidata": "Q38076", "name": "Restaurant X"}), "mcdonalds")
eq("wikidata schlägt Namen", mb({"brand:wikidata": "Q177054", "name": "McDonalds daneben"}), "burgerking")
eq("McDonald's über Namen (Schreibvariante)", mb({"name": "Mc Donald's Caen"}), "mcdonalds")
eq("McDonalds ohne Apostroph", mb({"name": "McDonalds"}), "mcdonalds")
eq("Burger King über brand", mb({"brand": "Burger King"}), "burgerking")
eq("KFC", mb({"name": "KFC Amiens"}), "kfc")
eq("Quick (belgisch)", mb({"name": "Quick Barchon"}), "quick")
eq("E.Leclerc mit Punkt und Leerzeichen", mb({"name": "E. Leclerc"}), "leclerc")
eq("Super U", mb({"name": "Super U Guidel"}), "superu")
eq("Hyper U zählt auch", mb({"name": "Hyper U"}), "superu")
eq("Aldi Süd über zweite wikidata-ID", mb({"brand:wikidata": "Q41171672"}), "aldi")
eq("Gémo mit Akzent", mb({"name": "Gémo"}), "gemo")
eq("Gemo ohne Akzent", mb({"name": "Gemo"}), "gemo")
eq("unbekannte Marke = None", mb({"name": "Chez Loïc"}), None)
eq("leere Tags = None", mb({}), None)
ok("kein Fehlmatch: 'Quickly Nails' ist kein Quick", mb({"name": "Quickly Nails"}) is None,
   str(mb({"name": "Quickly Nails"})))
ok("kein Fehlmatch: 'Paulaner Stube' ist kein PAUL", mb({"name": "Paulaner Stube"}) is None,
   str(mb({"name": "Paulaner Stube"})))

print("\nKategorien")
c = pr.categorize
eq("McDonald's → fastfood mit Marken-Slug",
   c({"amenity": "fast_food", "brand:wikidata": "Q38076"}), ("fastfood", "McDonald's", "mcdonalds"))
eq("Spielplatz → kinder mit art", c({"leisure": "playground"}),
   ("kinder", "Spielplatz", None, {"art": "playground"}))
eq("Park → kinder mit art", c({"leisure": "park", "name": "Parc de la Baie"}),
   ("kinder", "Parc de la Baie", None, {"art": "park"}))
eq("Picknicktisch → kinder mit art picnic", c({"leisure": "picnic_table"}),
   ("kinder", "Picknickplatz", None, {"art": "picnic"}))
eq("Eisdiele → cafe", c({"amenity": "ice_cream"})[0], "cafe")
eq("Bäckerei → cafe", c({"shop": "bakery"}), ("cafe", "Bäckerei", None))
eq("Decathlon → mode über Marke", c({"shop": "sports", "brand:wikidata": "Q509349"}),
   ("mode", "Decathlon", "decathlon"))
eq("Schuhladen ohne Marke → mode", c({"shop": "shoes"})[0], "mode")
eq("Taschen → mode", c({"shop": "bags"})[0], "mode")
eq("Mall → mall", c({"shop": "mall", "name": "Mondeville 2"}), ("mall", "Mondeville 2", None))
eq("Outlet behält Namen", c({"shop": "mall", "name": "Honfleur Normandy Outlet"})[1],
   "Honfleur Normandy Outlet")
eq("Lidl → supermarkt mit Marke", c({"shop": "supermarket", "brand:wikidata": "Q151954"}),
   ("supermarkt", "Lidl", "lidl"))
eq("Apotheke", c({"amenity": "pharmacy"})[0], "apotheke")
eq("WC", c({"amenity": "toilets"}), ("wc", "WC", None))
ok("Zaun bleibt None", c({"barrier": "fence"}) is None)
ok("jede Kategorie aus categorize existiert in CATEGORIES",
   all(cat in pr.CATEGORIES for cat in
       [c(t)[0] for t in [{"amenity":"fast_food"},{"amenity":"restaurant"},{"amenity":"cafe"},
        {"leisure":"playground"},{"shop":"mall"},{"shop":"shoes"},{"shop":"supermarket"},
        {"amenity":"toilets"},{"tourism":"hotel"},{"amenity":"fuel"},{"amenity":"pharmacy"}]]))

print("\nÖffnungszeiten")
of = pr.opening_flags
eq("24/7", of("24/7"), {"h24": True, "sunday": "open"})
eq("24/7 mit Zusatz", of("24/7; PH off")["h24"], True)
eq("explizit sonntags zu", of("Mo-Sa 09:00-19:30; Su off")["sunday"], "closed")
eq("Su closed", of("Mo-Fr 08:00-20:00; Su closed")["sunday"], "closed")
eq("Mo-Sa ohne Su → zu", of("Mo-Sa 08:30-19:00")["sunday"], "closed")
eq("Mo-Su → offen", of("Mo-Su 09:00-22:00")["sunday"], "open")
eq("Sa-Su Wochenendrange → offen", of("Sa-Su 10:00-18:00")["sunday"], "open")
eq("Su mit eigener Zeit → offen", of("Mo-Sa 09:00-20:00; Su 09:00-12:30")["sunday"], "open")
eq("leer → unknown", of(""), {"h24": False, "sunday": "unknown"})
eq("None → unknown", of(None)["sunday"], "unknown")
eq("Freitext → unknown", of("sunrise-sunset")["sunday"], "unknown")
eq("Fr-Mo Range über die Woche → offen", of("Fr-Mo 10:00-18:00")["sunday"], "open")

print(f"\n{PASS} bestanden, {FAIL} fehlgeschlagen\n")
sys.exit(1 if FAIL else 0)
