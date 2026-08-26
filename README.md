# Ladeplaner Clohars-Carnoët → Aachen

Eine App für die Fahrt von **15 Rue des Ajoncs, 29360 Clohars-Carnoët** nach
**Aachen** — und wieder zurück. Sie zeigt auf einer Karte, wo du gerade bist,
und listet daneben alle Schnellladesäulen **ab 150 kW** entlang der Strecke,
sortiert nach dem, was sich vom Umweg und vom Umfeld her wirklich lohnt.

Für jede Ladesäule steht dort:

- **Wie weit sie noch weg ist** und wann du ungefähr da bist
- **Wie viel Umweg sie kostet** — Ab- und Auffahrt zusammengerechnet,
  in Minuten und Kilometern, farblich abgestuft
- **Was in Laufweite ist** — McDonald's, Burger King, KFC, Einkaufszentren,
  Schuh- und andere Läden, Supermärkte, Restaurants, Cafés, WC
- **Ein Knopf, der die Google-Maps-Navigation startet**

## Die Strecke

Für Bretagne → Aachen gibt es zwei sinnvolle Varianten. Gewählt ist die
**Nordroute über die Normandie**:

> Clohars-Carnoët → N165 Lorient/Vannes → Rennes → A84 Avranches → **Caen** →
> A29 Pont de Normandie → **Amiens** → A2 Valenciennes → Belgien (Mons,
> Charleroi, Namur) → **Lüttich** → E40 → **Aachen**

**rund 938 km, gut 10 Stunden reine Fahrzeit.**

Die Alternative über Paris und Reims (rund 990 km) ist absichtlich **nicht**
gewählt — sie ist länger und führt mitten durch den Pariser Ballungsraum. Sie
wird in der Karte nur blass gestrichelt zum Vergleich mitgezeichnet.

Damit die Routenwahl nicht zufällig kippt, prüft der Generator jede
OSRM-Variante gegen Referenzpunkte: Eine Route gilt nur dann als Nordroute,
wenn sie an Avranches, Caen, dem Pont de Normandie und Amiens jeweils näher
als 60 km vorbeikommt **und** mindestens 45 km von Paris entfernt bleibt.
Erfüllt keine Variante das, wird eine Route über Caen und Le Havre erzwungen.

## Bedienung

Die App beantwortet die Frage **„Wo halten wir?"** — der Startzustand ist
bereits ein Vorschlag, nicht eine Liste mit 132 Treffern.

**Der Vorschlag (Hero):** Oben steht der nächste gute Stopp mit Ankunftszeit,
Umweg und dem, was es dort gibt — plus zwei Alternativen. Hat der Vorschlag
mehr als 5 Minuten Umweg, ist garantiert eine fast-umweglose Alternative
dabei. Gemerkte Stopps (Stern ★) gewinnen die Vorschlagswahl fast immer.

**Presets statt Filterwand:** Eine Zeile mit Stopp-Arten, die intern komplette
Filterzustände setzen:

| Preset | setzt |
|---|---|
| **Alles** | ab 150 kW, Umweg egal |
| **⚡ Nur laden** | ab 200 kW, Umweg ≤ 5 min |
| **🍔 Schnell essen** | Fast Food in ≤ 300 m Laufweite, Umweg ≤ 10 min |
| **🧒 Mit Kindern** | Spielplatz ODER McDonald's/Burger King in ≤ 400 m, Umweg ≤ 10 min |
| **🛍️ Shoppen** | Einkaufszentrum/Mode/Deko in ≤ 500 m, Umweg ≤ 15 min |

Feineinstellung im **Filter-Sheet** (Knopf rechts): Leistung, Umweg,
Umgebungs-Kategorien (eins reicht — ODER-Logik) mit Live-Trefferzahlen,
Reihenfolge. Abweichungen vom Preset zeigt der Filterknopf als Zahl,
das Preset bekommt einen Punkt; erneuter Tap aufs Preset setzt zurück.

**Planen / Fahren:** Zwei Modi für zwei Situationen. *Planen* (Küchentisch):
große Karte, Vorschlag ab Start. *Fahren* (Beifahrersitz): Karte kollabiert,
größere Ziele und Schrift, Reihenfolge fest „nach Strecke", nur was voraus
liegt. Erkennt die App Fahrt auf der Route, schlägt sie den Moduswechsel vor.

**Liste:** Nach Strecke sortiert, mit klebenden Regionsköpfen (Bretagne →
Normandie → … → Aachen) zur Orientierung beim Scrollen. Tippen klappt
Details auf (alle Orte in Laufweite, gruppiert). Fahrtrichtung ⇄ dreht
alles um; gemerkte Stopps werden je Richtung getrennt gespeichert.

**Je Ladepark:** Bewertung (0–100), Leistung, „in X min · an ≈ HH:MM ·
+Y min Umweg" (alle Umwege exakt geroutet), die relevantesten Orte mit
Namen und Fußweg — je nach Preset zuerst Spielplätze, Fast Food oder
Läden — und „Navi starten" (Google Maps). Sonntags markiert die App
Orte, die laut OpenStreetMap sonntags zu sind.

Die Gesamtbewertung gewichtet Leistung 22 %, Umweg 32 %, Umfeld 36 %,
Ladepunkte 10 %. Das Umfeld besteht aus drei Profil-Scores (Familie,
Shopping, Essen) — das beste Profil zählt am meisten, denn ein
herausragender Familien-Stopp ohne Shopping ist ein guter Stopp, kein
mittelmäßiger. Familien-Regeln aus der Eltern-Recherche: ohne
Bewegungsangebot (Spielplatz, Bolzplatz, Park, Indoor-Spielhalle) in 600 m
ist der Familien-Score hart gedeckelt — Picknicktische zählen nicht als
Auslauf; Spielplatz + Essen + WC unter 400 m gibt den Gold-Bonus.

## Starten

Die App ist statisch, ohne Build-Schritt. Sie muss aber über einen Webserver
laufen — per Doppelklick auf `index.html` blockiert der Browser das Laden der
Datendateien.

```bash
python3 -m http.server 8000
# dann http://localhost:8000 aufrufen
```

Auf dem Handy: über einen beliebigen Static-Host veröffentlichen und dort
„Zum Startbildschirm hinzufügen" wählen.

**Vercel:** Das Repo ist mit dem Projekt `ladeplaner` im Team
*Inform DataLab GmbH* verknüpft, jeder Push deployt automatisch.
`vercel.json` setzt die Cache-Header. Es gibt keinen Build-Schritt, Vercel
serviert die Dateien direkt. Warum die vier Regeln so aussehen:

| Pfad | Regel | Grund |
|---|---|---|
| `/sw.js` | `no-store` | Ein gecachter Service Worker friert den Datenstand ein und lässt sich kaum noch loswerden. |
| `/data/*` | `no-cache` | Immer gegen den Server prüfen; offline liefert der Service Worker den letzten Stand. |
| `/manifest.webmanifest` | Content-Type | Ohne `application/manifest+json` ignorieren manche Browser das Manifest. |
| `/vendor/*` | 1 Jahr `immutable` | Leaflet ist versioniert und ändert sich nicht — spart unterwegs Datenvolumen. |

`vercel.json` verträgt keine Kommentarschlüssel: Vercel validiert die Datei
gegen ein Schema und lehnt jede unbekannte Property ab, `"//"` eingeschlossen.
Deshalb steht die Begründung hier statt in der Datei.

Der Production Branch des Projekts ist `claude/hallo-welt-website-app-5vflji`
— ein Name aus der Vorgeschichte des Repos, der Inhalt ist der Ladeplaner.
Wer ihn loswerden will, legt einen Branch mit passendem Namen an und stellt
GitHubs Default-Branch sowie Vercels Production Branch darauf um.

**Offline:** Es gibt keine CDN-Abhängigkeit — Leaflet liegt unter
`vendor/leaflet/` mit im Repo, die Ladesäulendaten unter `data/`. Zusammen mit
dem Service Worker funktionieren damit Liste, Umwege, Umgebungsinfos und die
Navi-Knöpfe **ohne Netz**, und zwar auch dann, wenn der allererste Aufruf
schon offline passiert. Nur die Kartenkacheln brauchen Empfang; einmal
geladene Kacheln bleiben zwischengespeichert.

Der Standortzugriff braucht HTTPS (oder `localhost`).

## Datensatz neu erzeugen

`data/route.json` und `data/chargers.json` sind fest im Repo abgelegt, damit
die App offline vollständig ist. Neu bauen:

```bash
python3 tools/build_dataset.py --min-kw 150

# zusätzlich für die 25 bestbewerteten Säulen den Umweg exakt routen
# statt zu schätzen (dauert länger, ~2 Routing-Anfragen pro Säule):
python3 tools/build_dataset.py --min-kw 150 --exact-detours 25
```

Das Skript holt die Route bei OSRM, sucht abschnittsweise per Bounding-Box
alle Ladestationen im 8-km-Korridor, liest die Ladeleistung aus den
OSM-Tags, filtert auf ≥ 150 kW und sammelt POIs im 1-km-Umkreis jeder
Säule: Essen, Spielplätze/Parks/Bolzplätze, Einkaufszentren, Mode-,
Deko- und Spielwarenläden, Supermärkte, WC, Apotheken, Hotels. Marken
(McDonald's, Burger King, KFC, Quick, Carrefour, Decathlon, …) werden
über `brand:wikidata` erkannt — die IDs sind gegen die echten Daten des
Korridors verifiziert, Namensabgleich ist nur Rückfall. Öffnungszeiten
werden grob gedeutet (24/7? sonntags offen?), Raststätten-Lage über
`highway=services/rest_area` erkannt. Die Regeln stehen testbar in
`tools/poi_rules.py`.

Rohe Overpass-Antworten landen in `tools/.cache/` (nicht eingecheckt), damit
ein abgebrochener Lauf ohne erneute Netzlast weiterläuft. Falls ein
Overpass-Endpunkt gerade die eigene IP drosselt, lässt sich die Reihenfolge
umstellen:

```bash
OVERPASS_ENDPOINTS="https://overpass.kumi.systems/api/interpreter" \
  python3 tools/build_dataset.py
```

Icons neu erzeugen: `python3 tools/make_icons.py`

## Tests

```bash
node tests/test.js          # Projektion, Fahrtrichtung, Filter, Formate
python3 tests/test_dataset.py   # Leistungs-Parser, Bewertung, Routenwahl
```

## Dateien

```
index.html              Aufbau der Seite
css/app.css             Dunkles, kontraststarkes Layout für die Nutzung im Auto
js/geo.js               Entfernungen, Projektion der Position auf die Route
js/format.js            Deutsche Anzeigeformate, Symbole je Kategorie
js/data.js              Laden der Daten, Spiegel in localStorage
js/rank.js              Live-Kennzahlen, Filter, Sortierung
js/map.js               Leaflet-Karte, Marker, Routenlinien
js/app.js               Zusammenspiel, Standortverfolgung, Bedienung
data/route.json         Routengeometrie beider Varianten
data/chargers.json      Ladesäulen mit Umweg, Umfeld und Bewertung
sw.js                   Service Worker für den Offline-Betrieb
vendor/leaflet/         Leaflet 1.9.4, lokal statt über ein CDN (BSD-2-Clause)
tools/build_dataset.py  Erzeugt den Datensatz
tools/make_icons.py     Erzeugt die App-Icons
tests/                  Tests für Logik und Datensatz
```

## Woher die Daten kommen, und was das heißt

- **Routing:** [OSRM](https://project-osrm.org/) (Demo-Server)
- **Ladesäulen und Umgebung:** [OpenStreetMap](https://www.openstreetmap.org/copyright)
  über die Overpass-API, Lizenz ODbL

Zwei Einschränkungen, die man kennen sollte:

1. **Die Leistungsangaben stammen aus OSM** und sind dort nicht überall
   gepflegt. Eine Säule ohne getaggte Leistung taucht hier gar nicht auf, auch
   wenn sie in Wirklichkeit 300 kW kann. Umgekehrt kann eine getaggte Angabe
   veraltet sein. Für die Fahrt lohnt der Gegencheck mit einer Live-App, die
   auch den Belegtstatus kennt — dieser Datensatz weiß nichts über Störungen
   oder Wartezeiten.
2. **Die Umwegzeiten im mitgelieferten Datensatz sind echt geroutet**, nicht
   geschätzt: für alle 132 Ladeparks wurde eine Route von 9 km vor der
   Abfahrt bis 9 km danach einmal direkt und einmal über die Ladesäule
   gerechnet; die Differenz steht in der App. Das war die Mühe wert — die
   reine Luftlinienschätzung lag teils um mehr als eine Viertelstunde daneben
   (ein Ladepark schien 4 Minuten Umweg zu kosten, tatsächlich sind es 19).
   Wer den Datensatz ohne `--exact-detours` neu baut, bekommt wieder die
   Schätzung; die Karten zeigen im Tooltip an, welche der beiden Zahlen
   dahintersteht.
3. **Verkehr ist nicht berücksichtigt.** Die Fahrzeiten sind freie Strecke.
