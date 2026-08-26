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

| Element | Wirkung |
|---|---|
| **GPS** | Standort verfolgen. Position, Restweg und Ankunftszeit aktualisieren sich laufend. |
| **Richtung ⇄** | Zwischen Hinfahrt und Rückfahrt umschalten. Auf der Rückfahrt dreht sich die Zählrichtung — „noch 80 km" meint dann die Säulen Richtung Bretagne. |
| **ab 150 / 200 / 300 kW** | Mindestladeleistung. |
| **≤ 5 min / ≤ 10 min / Umweg egal** | Obergrenze für den Umweg. |
| **🍔 🛍️ 👟 🛒 🚻** | Nur Säulen zeigen, bei denen es das auch gibt. Mehrere Filter gelten gleichzeitig. |
| **nur voraus** | Säulen ausblenden, an denen du schon vorbei bist (mit 1,5 km Toleranz, damit die gerade passierte Ausfahrt nicht sofort verschwindet). |
| **Navi starten** | Öffnet Google Maps mit der Ladesäule als Ziel. |
| **Auf Karte** | Springt zur Säule auf der Karte. |

Die Reihenfolge ist umschaltbar, weil zwei verschiedene Fragen dahinterstecken:
**nach Strecke** beantwortet „was kommt als Nächstes" — das braucht man am
Steuer. **nach Bewertung** beantwortet „wo lohnt es sich am meisten" — das
plant man vorher. Solange keine Position bekannt ist, wird immer nach
Bewertung sortiert; der Streckenknopf ist dann sichtbar deaktiviert. Die Zahl
im farbigen Badge links auf jeder Karte ist die Bewertung, nicht die
Platznummer — dieselbe Farbstufe wie die Kartenpins.

Die Bewertung (0–100) gewichtet vier Dinge: Ladeleistung 25 %, Umweg 35 %,
Umfeld 30 %, Anzahl Ladepunkte 10 %. Ein Ladepark mit 350 kW direkt an der
Autobahn mit Burger und WC landet damit vor einem 150-kW-Park mit 15 Minuten
Umweg und nichts drumherum.

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
OSM-Tags, filtert auf ≥ 150 kW, sammelt POIs im 1-km-Umkreis jeder Säule und
rechnet Umweg und Bewertung aus.

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
