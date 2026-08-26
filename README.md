# Hallo Welt

Eine kleine statische Website, die "Hallo Welt" sagt.

## Funktionen

- Tageszeitabhängige Begrüßung (Guten Morgen / Guten Tag / Guten Abend / Gute Nacht)
- Namensfeld: personalisierte Begrüßung
- Live-Uhr mit deutschem Datumsformat
- Hell/Dunkel-Umschalter, der die Systemeinstellung berücksichtigt und die Auswahl speichert
- Responsives Layout, keine Abhängigkeiten, kein Build-Schritt

## Starten

`index.html` einfach im Browser öffnen — oder einen lokalen Server nutzen:

```bash
python3 -m http.server 8000
# danach http://localhost:8000 aufrufen
```

## Dateien

- `index.html` — Aufbau der Seite
- `style.css` — Design inkl. Farbvariablen für beide Themes
- `script.js` — Begrüßung, Uhr, Theme-Umschalter
