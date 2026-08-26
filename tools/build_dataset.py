#!/usr/bin/env python3
"""
Baut den statischen Datensatz fuer den EV-Ladeplaner.

Ablauf:
  1. Route(n) via OSRM holen (Haupt- + Alternativroute).
  2. Route auf feste Schrittweite resampeln -> Korridor-Stuetzpunkte.
  3. Ladestationen im Korridor via Overpass holen, Leistung parsen, filtern.
  4. POIs (Mall, Fast Food, Schuhe, Supermarkt ...) rund um jede Station holen.
  5. Position auf der Route projizieren, Umweg schaetzen.
  6. data/route.json + data/chargers.json schreiben.

Aufruf:  python3 tools/build_dataset.py [--min-kw 150] [--exact-detours N]
"""

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import poi_rules as rules  # noqa: E402 - Marken, Kategorien, Oeffnungszeiten
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

START = (47.7936, -3.5486)   # 15 Rue des Ajoncs, 29360 Clohars-Carnoet
ZIEL = (50.7753, 6.0839)     # Aachen
START_NAME = "Clohars-Carnoët (15 Rue des Ajoncs)"
ZIEL_NAME = "Aachen"

OSRM = "https://router.project-osrm.org"

# Gewuenscht ist die Nordvariante ueber die Normandie, ausdruecklich NICHT
# die Strecke ueber Paris. Statt Zwischenpunkte zu erzwingen (die verzerren
# die Geometrie, weil OSRM dann in die Innenstaedte faehrt) werden die
# OSRM-Alternativen anhand dieser Referenzpunkte ausgewaehlt.
VIA_NORD = [
    (48.6900, -1.3700),   # A84 bei Avranches
    (49.1829, -0.3707),   # Caen
    (49.4310,  0.2740),   # Pont de Normandie / Le Havre
    (49.8941,  2.2958),   # Amiens
]
VIA_NORD_MAX_M = 60000    # so nah muss die Route an jedem Referenzpunkt liegen
PARIS = (48.8566, 2.3522)
PARIS_MIN_M = 45000       # naeher als das an Paris = verworfen
# Reihenfolge ist die Vorzugsreihenfolge; der erste erreichbare gewinnt.
# Ueber OVERPASS_ENDPOINTS (kommagetrennt) umstellbar, falls ein Endpunkt
# die eigene IP gerade drosselt.
OVERPASS_ENDPOINTS = [e for e in os.environ.get("OVERPASS_ENDPOINTS", "").split(",") if e] or [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
CA = "/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None

CORRIDOR_M = 8000      # Suchradius um die Route
SAMPLE_M = 3000        # Abstand der Korridor-Stuetzpunkte
POI_RADIUS_M = 1000    # Umkreis fuer POIs je Ladestation
CHUNK = 60             # Stuetzpunkte pro Overpass-Anfrage
SEGMENT_M = 40000      # Laenge eines Abfrage-Abschnitts
CACHE = os.path.join(HERE, ".cache")   # rohe Overpass-Antworten, macht Laeufe wiederholbar

# ---------------------------------------------------------------- Geometrie

def haversine(a, b):
    """Entfernung zweier (lat, lon)-Punkte in Metern."""
    R = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def cumulative(points):
    """Aufsummierte Streckenlaenge je Stuetzpunkt."""
    out = [0.0]
    for i in range(1, len(points)):
        out.append(out[-1] + haversine(points[i - 1], points[i]))
    return out


def resample(points, step):
    """Route auf gleichmaessige Abstaende ausduennen."""
    out = [points[0]]
    acc = 0.0
    for i in range(1, len(points)):
        acc += haversine(points[i - 1], points[i])
        if acc >= step:
            out.append(points[i])
            acc = 0.0
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out


def project_on_route(point, route, cum):
    """Naechster Punkt auf der Route.

    Liefert (Abstand Luftlinie in m, Streckenkilometer der Projektion,
    Index des Segments).
    """
    best = (float("inf"), 0.0, 0)
    lat0 = math.radians(point[0])
    mx = math.cos(lat0) * 111320.0
    my = 110540.0
    px, py = point[1] * mx, point[0] * my
    for i in range(len(route) - 1):
        ax, ay = route[i][1] * mx, route[i][0] * my
        bx, by = route[i + 1][1] * mx, route[i + 1][0] * my
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        cx, cy = ax + t * dx, ay + t * dy
        d = math.hypot(px - cx, py - cy)
        if d < best[0]:
            along = cum[i] + t * (cum[i + 1] - cum[i])
            best = (d, along, i)
    return best

# ---------------------------------------------------------------- HTTP

def http_get(url, data=None, tries=4, timeout=180):
    """GET/POST mit Backoff. data=dict -> form-encoded POST."""
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode(data).encode() if data else None,
                headers={"User-Agent": "ev-ladeplaner/1.0 (dataset builder)"},
            )
            kw = {"timeout": timeout}
            if CA:
                import ssl
                kw["context"] = ssl.create_default_context(cafile=CA)
            with urllib.request.urlopen(req, **kw) as r:
                return json.loads(r.read().decode())
        except Exception as e:      # noqa: BLE001 - jede Netzstoerung soll retryen
            last = e
            wait = 2 ** attempt
            print(f"    ! {type(e).__name__}: {e} — retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Anfrage endgueltig fehlgeschlagen: {url} ({last})")


def cache_path(query):
    import hashlib
    return os.path.join(CACHE, hashlib.sha1(query.encode()).hexdigest()[:16] + ".json")


def overpass(query):
    """Overpass-Query gegen die Endpunkt-Liste, erster Erfolg gewinnt.

    Antworten landen im Cache, damit ein abgebrochener Lauf ohne erneute
    Netzlast fortgesetzt werden kann — Overpass ist langsam und mag keine
    Wiederholungen.
    """
    os.makedirs(CACHE, exist_ok=True)
    cp = cache_path(query)
    if os.path.exists(cp):
        with open(cp, encoding="utf-8") as f:
            return json.load(f)

    errors = []
    for ep in OVERPASS_ENDPOINTS:
        try:
            print(f"  -> Overpass {urllib.parse.urlparse(ep).netloc}", file=sys.stderr)
            result = http_get(ep, data={"data": query}, tries=5, timeout=240)
            with open(cp, "w", encoding="utf-8") as f:
                json.dump(result, f)
            return result
        except Exception as e:      # noqa: BLE001
            errors.append(f"{ep}: {e}")
    raise RuntimeError("Kein Overpass-Endpunkt erreichbar:\n" + "\n".join(errors))

# ---------------------------------------------------------------- Routing

def fetch_routes():
    """Haupt- und Alternativroute von OSRM holen."""
    coords = f"{START[1]},{START[0]};{ZIEL[1]},{ZIEL[0]}"
    url = f"{OSRM}/route/v1/driving/{coords}?overview=full&alternatives=true&geometries=geojson"
    d = http_get(url)
    if d.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {d}")
    routes = []
    for i, r in enumerate(d["routes"]):
        pts = [(lat, lon) for lon, lat in r["geometry"]["coordinates"]]
        routes.append({
            "id": f"route{i}",
            "distance_m": r["distance"],
            "duration_s": r["duration"],
            "points": pts,
        })
    routes.sort(key=lambda r: r["distance_m"])
    for r in routes:
        classify_route(r)
    return routes


def min_dist_to_route(point, points):
    """Kuerzester Abstand eines Punktes zur Routenlinie (Stuetzpunkt-Naeherung)."""
    return min(haversine(point, p) for p in points)


def classify_route(route):
    """Route als Nord- oder Paris-Variante einordnen."""
    pts = route["points"]
    abstaende = [min_dist_to_route(v, pts) for v in VIA_NORD]
    paris_m = min_dist_to_route(PARIS, pts)
    route["via_nord_max_m"] = round(max(abstaende))
    route["paris_m"] = round(paris_m)
    route["ist_nordroute"] = (max(abstaende) <= VIA_NORD_MAX_M and paris_m >= PARIS_MIN_M)
    route["name"] = ("Nordroute über die Normandie" if route["ist_nordroute"]
                     else "Variante über Paris/Reims")
    return route


def pick_nordroute(routes):
    """Die Nordvariante auswaehlen; sonst ueber Caen erzwingen."""
    nord = [r for r in routes if r["ist_nordroute"]]
    if nord:
        nord.sort(key=lambda r: r["distance_m"])
        print(f"  Nordroute erkannt: {nord[0]['distance_m']/1000:.0f} km "
              f"(Abstand Paris {nord[0]['paris_m']/1000:.0f} km)", file=sys.stderr)
        return nord[0]

    print("  ! Keine Alternative erfüllt die Nord-Kriterien — "
          "erzwinge Route über Caen/Le Havre", file=sys.stderr)
    via = ";".join(f"{lon},{lat}" for lat, lon in [START] + VIA_NORD[1:3] + [ZIEL])
    d = http_get(f"{OSRM}/route/v1/driving/{via}?overview=full&geometries=geojson")
    if d.get("code") != "Ok":
        raise RuntimeError(f"OSRM (erzwungene Nordroute): {d}")
    r = d["routes"][0]
    forced = {
        "id": "nord-erzwungen",
        "distance_m": r["distance"],
        "duration_s": r["duration"],
        "points": [(lat, lon) for lon, lat in r["geometry"]["coordinates"]],
    }
    return classify_route(forced)

# ---------------------------------------------------------------- Leistung

POWER_KEYS = re.compile(r"(output|maxpower|max_power|power_rating)", re.I)
NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kw|w|kilowatt)?", re.I)


def parse_power_kw(tags):
    """Maximale Ladeleistung in kW aus den OSM-Tags herauslesen."""
    best = 0.0
    for key, raw in tags.items():
        if not POWER_KEYS.search(key):
            continue
        for m in NUM.finditer(str(raw)):
            try:
                val = float(m.group(1).replace(",", "."))
            except ValueError:
                continue
            unit = (m.group(2) or "").lower()
            if unit in ("w",) and val > 1000:
                val /= 1000.0
            elif not unit and val > 1000:
                val /= 1000.0        # blanke Wattangabe
            if 0 < val < 1000:
                best = max(best, val)
    return best


def socket_summary(tags):
    """Steckertypen mit Anzahl, soweit getaggt."""
    out = {}
    for key, raw in tags.items():
        m = re.fullmatch(r"socket:([a-z0-9_]+)", key)
        if not m:
            continue
        typ = m.group(1)
        try:
            out[typ] = int(str(raw).strip())
        except ValueError:
            out[typ] = None
    return out

# ---------------------------------------------------------------- POIs

# Was in der Naehe einer Ladesaeule interessant ist. Die Auswahl folgt der
# Recherche (Eltern-Foren, Shopping-Ziele der Route, OSM-Wiki):
#   - Kinder brauchen nach Stunden im Auto BEWEGUNG: Spielplatz, Park,
#     Bolzplatz, Indoor-Spielhalle; kids_area markiert Restaurants mit
#     Spielbereich (McDonald's PlayPlace).
#   - Shopping heisst Mode/Schuhe/Beauty/Deko — Baumarkt und Autoteile
#     wuerden jede Peripherie-Zone dominieren und bleiben deshalb draussen.
#   - highway=services/rest_area erkennt, dass der Ladepark AN der
#     Raststaette liegt (Umweg praktisch null, WC garantiert).
POI_FILTERS = [
    'nwr[amenity~"^(fast_food|restaurant|cafe|ice_cream|toilets|fuel|pharmacy)$"]',
    'nwr[shop~"^(mall|department_store|clothes|shoes|bags|fashion_accessories'
    '|jewelry|watches|cosmetics|perfumery|beauty|interior_decoration|houseware'
    '|gift|variety_store|toys|sports|outdoor|supermarket|convenience|bakery)$"]',
    'nwr[leisure~"^(playground|park|pitch|indoor_play|trampoline_park'
    '|miniature_golf|picnic_table)$"]',
    'nwr[tourism~"^(hotel|motel|picnic_site)$"]',
    'nwr[kids_area~"^(yes|designated)$"]',
    'nwr[highway~"^(services|rest_area)$"]',
]

def element_latlon(el):
    if "lat" in el and "lon" in el:
        return (el["lat"], el["lon"])
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else None


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def coord_list(points):
    return ",".join(f"{lat:.5f},{lon:.5f}" for lat, lon in points)


def segment_bboxes(route_points, seg_m=SEGMENT_M, pad_m=CORRIDOR_M):
    """Route in Abschnitte zerlegen und je Abschnitt eine gepolsterte Bbox bauen.

    Bbox-Abfragen sind fuer Overpass deutlich guenstiger als eine grosse
    around-Union ueber hunderte Stuetzpunkte — letztere laeuft auf dieser
    Streckenlaenge zuverlaessig in Timeouts.
    """
    cum = cumulative(route_points)
    boxes = []
    start = 0
    for i in range(1, len(route_points)):
        ende = i == len(route_points) - 1
        if not ende and cum[i] - cum[start] < seg_m:
            continue
        teil = route_points[start:i + 1]
        lats = [p[0] for p in teil]
        lons = [p[1] for p in teil]
        mid_lat = (min(lats) + max(lats)) / 2
        dlat = pad_m / 111320.0
        dlon = pad_m / (111320.0 * max(0.2, math.cos(math.radians(mid_lat))))
        boxes.append((min(lats) - dlat, min(lons) - dlon,
                      max(lats) + dlat, max(lons) + dlon))
        start = i
    return boxes


def fetch_chargers(route_points):
    """Alle Ladestationen im Korridor um die Route (abschnittsweise per Bbox)."""
    boxes = segment_bboxes(route_points)
    print(f"  Korridor: {len(boxes)} Abschnitte, Puffer {CORRIDOR_M} m", file=sys.stderr)
    found = {}
    for i, (s, w, n, e) in enumerate(boxes, 1):
        q = (f"[out:json][timeout:120];"
             f"nwr[amenity=charging_station]({s:.4f},{w:.4f},{n:.4f},{e:.4f});"
             f"out center tags;")
        print(f"  Ladesäulen-Abschnitt {i}/{len(boxes)}", file=sys.stderr)
        for el in overpass(q)["elements"]:
            found[f"{el['type']}/{el['id']}"] = el
        time.sleep(1.0)
    print(f"  {len(found)} Ladestationen in den Abschnitts-Boxen", file=sys.stderr)
    return found


def fetch_pois(chargers):
    """POIs im Umkreis der (bereits gefilterten) Ladestationen.

    Auch hier per Bbox statt around: eine 1-km-Box je Ladepark ist fuer
    Overpass eine billige Abfrage. Ladeparks, die dicht beieinander liegen,
    teilen sich eine Box — an Raststaetten stehen oft mehrere.
    """
    dlat = POI_RADIUS_M / 111320.0
    boxen = []
    for c in chargers:
        lat, lon = c["pos"]
        dlon = POI_RADIUS_M / (111320.0 * max(0.2, math.cos(math.radians(lat))))
        # Liegt die Saeule schon samt Umkreis in einer bereits geplanten Box?
        if any(s + dlat <= lat <= n - dlat and w + dlon <= lon <= e - dlon
               for s, w, n, e in boxen):
            continue
        boxen.append((lat - 2 * dlat, lon - 2 * dlon, lat + 2 * dlat, lon + 2 * dlon))

    print(f"  {len(boxen)} Umkreis-Boxen für {len(chargers)} Ladeparks", file=sys.stderr)
    found = {}
    for i, (s, w, n, e) in enumerate(boxen, 1):
        body = "".join(f"{f}({s:.4f},{w:.4f},{n:.4f},{e:.4f});" for f in POI_FILTERS)
        q = f"[out:json][timeout:90];({body});out center tags;"
        if i % 10 == 1 or i == len(boxen):
            print(f"  POI-Box {i}/{len(boxen)}", file=sys.stderr)
        for el in overpass(q)["elements"]:
            found[f"{el['type']}/{el['id']}"] = el
        time.sleep(0.6)
    print(f"  {len(found)} POIs gesamt", file=sys.stderr)
    return found


# ---------------------------------------------------------------- Umweg

def point_at_distance(route, cum, target_m):
    """Punkt auf der Route bei Streckenkilometer target_m."""
    target_m = max(0.0, min(cum[-1], target_m))
    lo, hi = 0, len(cum) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum[mid] <= target_m:
            lo = mid
        else:
            hi = mid
    span = cum[hi] - cum[lo]
    t = 0.0 if span == 0 else (target_m - cum[lo]) / span
    return (route[lo][0] + t * (route[hi][0] - route[lo][0]),
            route[lo][1] + t * (route[hi][1] - route[lo][1]))


def estimate_detour(dist_to_route_m):
    """Grobschaetzung ohne Routing: Luftlinie -> Zeitverlust hin und zurueck."""
    road_km = dist_to_route_m / 1000.0 * 1.4          # Umwegfaktor Strasse
    km = 2 * road_km                                   # hin und zurueck
    minutes = km / 50.0 * 60.0 + 4.0                   # + Ab-/Auffahrt, Kreisel
    return round(km, 1), round(minutes)


def exact_detour(charger, route, cum, arm_m=9000):
    """Echter Umweg: Route A->B gegen A->Ladesaeule->B (OSRM)."""
    a = point_at_distance(route, cum, charger["route_m"] - arm_m)
    b = point_at_distance(route, cum, charger["route_m"] + arm_m)
    p = charger["pos"]

    def osrm(pts):
        s = ";".join(f"{lon},{lat}" for lat, lon in pts)
        url = f"{OSRM}/route/v1/driving/{s}?overview=false"
        # Auch Routing-Antworten cachen: bei 130 Ladeparks sind das ueber
        # 260 Anfragen, die ein Abbruch sonst komplett verwirft.
        os.makedirs(CACHE, exist_ok=True)
        cp = cache_path(url)
        if os.path.exists(cp):
            with open(cp, encoding="utf-8") as f:
                d = json.load(f)
        else:
            d = http_get(url, tries=3, timeout=60)
            with open(cp, "w", encoding="utf-8") as f:
                json.dump(d, f)
            time.sleep(1.1)
        if d.get("code") != "Ok":
            raise RuntimeError(d.get("code"))
        r = d["routes"][0]
        return r["distance"], r["duration"]

    base_m, base_s = osrm([a, b])
    via_m, via_s = osrm([a, p, b])
    return {
        "detour_km": round(max(0.0, (via_m - base_m)) / 1000.0, 1),
        "detour_min": max(0, round((via_s - base_s) / 60.0)),
        "exact": True,
    }

# ---------------------------------------------------------------- Bewertung

def decay(d):
    """Fusswegfaktor: unter 300 m voll, bis 600 m halb, danach wenig.

    900 m einfache Strecke frisst die halbe Ladezeit — sagt jede
    Eltern-Recherche, gilt aber genauso fuer den Schuhladen.
    """
    if d < 300:
        return 1.0
    if d < 600:
        return 0.55
    return 0.25


def _best(pois, cats, brands=None):
    """Naechster POI aus den Kategorien (optional nur bestimmte Marken)."""
    best = None
    for p in pois:
        if p["cat"] not in cats:
            continue
        if brands is not None and p.get("brand") not in brands:
            continue
        if best is None or p["dist_m"] < best["dist_m"]:
            best = p
    return best


def score_familie(pois):
    """0-100: Taugt der Stopp fuer Kinder, die seit Stunden sitzen?

    Regeln aus der Eltern-Recherche: Bewegung > Essen > WC. Ohne
    Bewegungsangebot in Laufweite hilft auch das beste Eis nichts
    (Bewegungs-Veto). Spielplatz + Essen + WC dicht beieinander ist Gold.
    """
    BEWEGT = ("playground", "park", "pitch", "indoor_play",
              "trampoline_park", "amusement_arcade", "miniature_golf")
    bewegung = None
    picknick = None
    for p in pois:
        if p["cat"] != "kinder":
            continue
        if p.get("art") in BEWEGT:
            if bewegung is None or p["dist_m"] < bewegung["dist_m"]:
                bewegung = p
        elif p.get("art") == "picnic":
            if picknick is None or p["dist_m"] < picknick["dist_m"]:
                picknick = p
    spielplatz = bewegung
    essen = _best(pois, {"fastfood", "restaurant"})
    wc = _best(pois, {"wc"})
    eis = _best(pois, {"cafe"})

    pts = 0.0
    if spielplatz:
        pts += 35 * decay(spielplatz["dist_m"])
    if essen:
        pts += 20 * decay(essen["dist_m"])
        if essen.get("kids") or essen.get("brand") in ("mcdonalds", "burgerking"):
            pts += 10          # Spielbereich drinnen — Regenwetter-Retter
    if wc:
        pts += 12
    elif essen:
        pts += 6               # Restaurant hat immer ein WC
    if eis:
        pts += 6
    if picknick:
        pts += 4               # nett, aber kein Ersatz fuers Austoben

    # Gold-Kombination: alles unter 400 m
    if (spielplatz and spielplatz["dist_m"] < 400 and essen and
            essen["dist_m"] < 400 and (wc or essen)):
        pts *= 1.2
    # Bewegungs-Veto: nichts zum Austoben in 600 m -> hart deckeln
    if not (bewegung and bewegung["dist_m"] < 600):
        pts = min(pts, 25.0)
    return round(min(100.0, pts))


def score_shopping(pois):
    """0-100: Lohnt der Stopp zum Shoppen (Mode, Schuhe, Deko)?

    Shop-Dichte logarithmisch gedaempft — 5 Laeden sind viel besser als
    einer, 50 kaum besser als 30. Einkaufszentrum und Outlet on top.
    """
    laeden = [p for p in pois if p["cat"] in ("mode", "deko")]
    n = len(laeden)
    pts = 55.0 * min(1.0, math.log10(1 + n) / math.log10(30))
    mall = _best(pois, {"mall"})
    if mall:
        pts += 25 * decay(mall["dist_m"])
        if mall.get("outlet"):
            pts += 20          # Outlet ist das Ziel, nicht der Kompromiss
    return round(min(100.0, pts))


def score_essen(pois):
    """0-100: Wie gut kann man hier essen?"""
    ff = _best(pois, {"fastfood"})
    rest = _best(pois, {"restaurant"})
    cafe = _best(pois, {"cafe"})
    markt = _best(pois, {"supermarkt"})
    pts = 0.0
    if ff:
        pts += 40 * decay(ff["dist_m"])
        if ff.get("brand"):
            pts += 10          # bekannte Marke = bekannte Erwartung
    if rest:
        pts += 25 * decay(rest["dist_m"])
    if cafe:
        pts += 15 * decay(cafe["dist_m"])
    if markt:
        pts += 10 * decay(markt["dist_m"])
    return round(min(100.0, pts))


def score(charger):
    """Gesamtbewertung 0-100 aus Leistung, Umweg, Ladepunkten und Umfeld.

    Umfeld = die Profil-Scores (Familie/Shopping/Essen): das beste Profil
    zaehlt am meisten — ein herausragender Familien-Stopp ohne Shopping
    ist ein guter Stopp, kein mittelmaessiger.
    """
    kw = charger["power_kw"]
    power = min(1.0, max(0.0, (kw - 150) / 200.0))
    detour = max(0.0, 1.0 - charger["detour_min"] / 20.0)
    stalls = min(1.0, (charger.get("stalls") or 2) / 12.0)

    profile = [charger.get("s_familie", 0), charger.get("s_shopping", 0),
               charger.get("s_essen", 0)]
    umfeld = (0.6 * max(profile) + 0.4 * (sum(profile) / 3)) / 100.0
    if charger.get("raststaette"):
        umfeld = min(1.0, umfeld + 0.10)   # WC + kurze Wege garantiert

    total = 100 * (0.22 * power + 0.32 * detour + 0.36 * umfeld + 0.10 * stalls)
    return round(total)


# ---------------------------------------------------------------- Aufbau

def build_charger(el, route, cum, min_kw):
    """Ein Overpass-Element in einen Ladesaeulen-Datensatz uebersetzen."""
    tags = el.get("tags", {})
    pos = element_latlon(el)
    if not pos:
        return None
    kw = parse_power_kw(tags)
    if kw < min_kw:
        return None

    dist, along, _ = project_on_route(pos, route, cum)
    detour_km, detour_min = estimate_detour(dist)
    sockets = socket_summary(tags)
    stalls = None
    for key in ("capacity", "charging_station:capacity"):
        try:
            stalls = int(str(tags[key]).strip())
            break
        except (KeyError, ValueError):
            continue
    if stalls is None and sockets:
        counted = [v for v in sockets.values() if isinstance(v, int)]
        stalls = sum(counted) if counted else None

    return {
        "id": f"{el['type']}/{el['id']}",
        "name": tags.get("name") or tags.get("operator") or tags.get("brand") or "Ladepark",
        "operator": tags.get("operator") or tags.get("brand") or tags.get("network") or "",
        "pos": pos,
        "power_kw": round(kw),
        "stalls": stalls,
        "sockets": sockets,
        "access": tags.get("access", ""),
        "fee": tags.get("fee", ""),
        "opening_hours": tags.get("opening_hours", ""),
        "dist_to_route_m": round(dist),
        "route_m": round(along),
        "detour_km": detour_km,
        "detour_min": detour_min,
        "exact": False,
        "raststaette": None,
        "pois": [],
    }


RASTSTAETTE_M = 400    # Ladepark liegt "an der Raststaette", wenn so nah


def attach_pois(chargers, pois):
    """POIs kategorisieren, der naechsten Saeule zuordnen, Flags setzen."""
    playgrounds = []       # fuer die McDonald's-Spielbereich-Heuristik
    einordnungen = []

    for el in pois.values():
        pos = element_latlon(el)
        tags = el.get("tags", {})
        if not pos or not tags:
            continue

        # Raststaetten sind kein POI-Chip, sondern ein Flag am Ladepark.
        if tags.get("highway") in ("services", "rest_area"):
            for c in chargers:
                if haversine(pos, c["pos"]) < RASTSTAETTE_M:
                    c["raststaette"] = tags["highway"]
            continue

        cat = rules.categorize(tags)
        if not cat:
            continue
        kind, name, brand = cat[0], cat[1], cat[2]
        extras = cat[3] if len(cat) > 3 else {}
        nearest, nd = None, float("inf")
        for c in chargers:
            d = haversine(pos, c["pos"])
            if d < nd:
                nearest, nd = c, d
        if nearest is None or nd > POI_RADIUS_M:
            continue

        poi = {"cat": kind, "name": name, "dist_m": round(nd),
               "pos": [round(pos[0], 6), round(pos[1], 6)]}
        poi.update(extras)
        if brand:
            poi["brand"] = brand
        flags = rules.opening_flags(tags.get("opening_hours"))
        if flags["sunday"] != "unknown":
            poi["sunday"] = flags["sunday"]
        if flags["h24"]:
            poi["h24"] = True
        if tags.get("kids_area") in ("yes", "designated"):
            poi["kids"] = True
        if kind == "mall" and rules._OUTLET_RX.search(name):
            poi["outlet"] = True
        if kind == "kinder" and tags.get("leisure") == "playground":
            playgrounds.append(pos)
        einordnungen.append((nearest, poi))

    for nearest, poi in einordnungen:
        nearest["pois"].append(poi)

    for c in chargers:
        # Heuristik: Spielplatz-Node dicht neben McDonald's/Burger King
        # -> das ist der Restaurant-Spielbereich.
        for p in c["pois"]:
            if p.get("brand") in ("mcdonalds", "burgerking") and not p.get("kids"):
                pp = [round(v, 6) for v in p["pos"]]
                if any(haversine(pp, pg) < 80 for pg in playgrounds):
                    p["kids"] = True
        gewicht = {k: v[2] for k, v in rules.CATEGORIES.items()}
        c["pois"].sort(key=lambda p: (-gewicht.get(p["cat"], 0), p["dist_m"]))
        c["pois"] = c["pois"][:18]
        c["s_familie"] = score_familie(c["pois"])
        c["s_shopping"] = score_shopping(c["pois"])
        c["s_essen"] = score_essen(c["pois"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-kw", type=float, default=150)
    ap.add_argument("--exact-detours", type=int, default=0,
                    help="fuer die N bestbewerteten Saeulen den Umweg exakt routen")
    args = ap.parse_args()

    os.makedirs(DATA, exist_ok=True)

    print("1/5 Route holen …", file=sys.stderr)
    routes = fetch_routes()
    main_route = pick_nordroute(routes)
    if main_route not in routes:
        routes.insert(0, main_route)
    pts, cum = main_route["points"], cumulative(main_route["points"])
    print(f"  Hauptroute {main_route['distance_m']/1000:.0f} km, "
          f"{main_route['duration_s']/3600:.1f} h, {len(pts)} Punkte", file=sys.stderr)

    print("2/5 Ladestationen suchen …", file=sys.stderr)
    raw = fetch_chargers(pts)

    print("3/5 Leistung filtern …", file=sys.stderr)
    chargers = []
    for el in raw.values():
        c = build_charger(el, pts, cum, args.min_kw)
        if c:
            chargers.append(c)
    chargers.sort(key=lambda c: c["route_m"])
    print(f"  {len(chargers)} Stationen mit ≥{args.min_kw:.0f} kW", file=sys.stderr)

    print("4/5 Umgebung (POIs) …", file=sys.stderr)
    attach_pois(chargers, fetch_pois(chargers))

    if args.exact_detours:
        print(f"5/5 Umweg exakt routen (Top {args.exact_detours}) …", file=sys.stderr)
        ziel = sorted(chargers, key=score, reverse=True)[:args.exact_detours]
        for i, c in enumerate(ziel, 1):
            try:
                vorher = c["detour_min"]
                c.update(exact_detour(c, pts, cum))
                if i % 10 == 0 or i == len(ziel):
                    print(f"    {i}/{len(ziel)}", file=sys.stderr)
                if abs(c["detour_min"] - vorher) >= 8:
                    print(f"    ~ {c['name'][:30]}: geschätzt {vorher} min → "
                          f"gemessen {c['detour_min']} min", file=sys.stderr)
            except Exception as e:      # noqa: BLE001
                print(f"    ! {c['name']}: {e}", file=sys.stderr)
    else:
        print("5/5 Umweg exakt routen — übersprungen", file=sys.stderr)

    for c in chargers:
        c["score"] = score(c)

    route_out = {
        "start": {"pos": list(START), "name": START_NAME},
        "ziel": {"pos": list(ZIEL), "name": ZIEL_NAME},
        "gewaehlt": main_route["id"],
        "routes": [{
            "id": r["id"],
            "name": r["name"],
            "ist_nordroute": r["ist_nordroute"],
            "gewaehlt": r["id"] == main_route["id"],
            "abstand_paris_km": round(r["paris_m"] / 1000),
            "distance_km": round(r["distance_m"] / 1000, 1),
            "duration_h": round(r["duration_s"] / 3600, 2),
            "points": [[round(a, 5), round(b, 5)] for a, b in resample(r["points"], 250)],
        } for r in routes],
        "generated": time.strftime("%Y-%m-%d"),
        "source": "OSRM (Routing) + OpenStreetMap/Overpass (Ladesäulen, POIs)",
    }
    with open(os.path.join(DATA, "route.json"), "w", encoding="utf-8") as f:
        json.dump(route_out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA, "chargers.json"), "w", encoding="utf-8") as f:
        json.dump({"min_kw": args.min_kw,
                   "generated": time.strftime("%Y-%m-%d"),
                   "chargers": chargers}, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nFertig: {len(chargers)} Ladestationen -> data/chargers.json", file=sys.stderr)
    for c in sorted(chargers, key=lambda c: c["score"], reverse=True)[:12]:
        cats = ", ".join(sorted({p["name"] for p in c["pois"][:5]}))
        print(f"  {c['score']:3d}  {c['power_kw']:4d} kW  +{c['detour_min']:2d} min  "
              f"km {c['route_m']/1000:6.1f}  {c['name'][:34]:34s} {cats[:60]}", file=sys.stderr)


if __name__ == "__main__":
    main()
