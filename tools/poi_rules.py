"""Erkennungsregeln fuer POIs rund um Ladeparks.

Eigenes Modul, damit die Regeln testbar sind und build_dataset.py nicht
weiter waechst. Drei Aufgaben:

  1. Marken erkennen  — wikidata-zuerst, Namensabgleich nur als Rueckfall.
     Die Wikidata-IDs sind aus den echten Overpass-Daten des Korridors
     verifiziert (tools/.cache), nicht geraten.
  2. Kategorien schneiden — nach dem, was eine Familie beim Ladestopp
     wirklich sucht: schnell essen, Kinder beschaeftigen, shoppen,
     einkaufen, Praktisches.
  3. Oeffnungszeiten deuten — kein vollstaendiger Parser, sondern die zwei
     Antworten, die unterwegs zaehlen: "rund um die Uhr?" und
     "sonntags offen?" (die Fahrt kann sonntags sein; in FR/BE/DE ist
     sonntags vieles zu).
"""

import re

# ------------------------------------------------------------------ Marken

# slug -> (Anzeigename, Kategorie, wikidata-IDs, Namens-Regex als Rueckfall)
# Kategorien siehe CATEGORIES unten.
BRANDS = {
    # Schnellessen — die Marken, nach denen unterwegs gefragt wird
    "mcdonalds":  ("McDonald's", "fastfood", {"Q38076"}, r"mc\s?donald"),
    "burgerking": ("Burger King", "fastfood", {"Q177054"}, r"burger\s?king"),
    "kfc":        ("KFC", "fastfood", {"Q524757"}, r"\bkfc\b|kentucky fried"),
    "quick":      ("Quick", "fastfood", {"Q286494"}, r"\bquick\b"),
    "subway":     ("Subway", "fastfood", {"Q244457"}, r"\bsubway\b"),
    "dominos":    ("Domino's", "fastfood", {"Q839466"}, r"domino'?s"),
    "otacos":     ("O'Tacos", "fastfood", {"Q28494040"}, r"o'?tacos"),
    "buffalo":    ("Buffalo Grill", "restaurant", {"Q944655"}, r"buffalo\s?grill"),
    "flunch":     ("Flunch", "restaurant", {"Q629326"}, r"\bflunch\b"),
    # Cafés & Baecker-Ketten
    "starbucks":  ("Starbucks", "cafe", {"Q37158"}, r"starbucks"),
    "paul":       ("PAUL", "cafe", {"Q3370417"}, r"^paul\b"),
    "marieblachere": ("Marie Blachère", "cafe", {"Q62082410"}, r"marie\s?blach"),
    # Supermaerkte — Hyper- und Vollsortimenter getrennt von Minilaeden
    "carrefour":  ("Carrefour", "supermarkt", {"Q217599"}, r"^carrefour$|carrefour hypermarch"),
    "carrefour_m":("Carrefour Market", "supermarkt", {"Q2689639"}, r"carrefour market"),
    "leclerc":    ("E.Leclerc", "supermarkt", {"Q1273376"}, r"e\.?\s?leclerc"),
    "intermarche":("Intermarché", "supermarkt", {"Q3153200"}, r"intermarch"),
    "superu":     ("Super U", "supermarkt", {"Q2529029"}, r"\b(super|hyper)\s?u\b"),
    "auchan":     ("Auchan", "supermarkt", {"Q758603"}, r"auchan"),
    "lidl":       ("Lidl", "supermarkt", {"Q151954"}, r"\blidl\b"),
    "aldi":       ("Aldi", "supermarkt", {"Q41171373", "Q41171672", "Q125054"}, r"\baldi\b"),
    "delhaize":   ("Delhaize", "supermarkt", {"Q1184173"}, r"delhaize"),
    "colruyt":    ("Colruyt", "supermarkt", {"Q2363991"}, r"colruyt"),
    "rewe":       ("Rewe", "supermarkt", {"Q16968817"}, r"\brewe\b"),
    # Mode & Sport — das Shopping-Herzstueck
    "decathlon":  ("Decathlon", "mode", {"Q509349"}, r"decathlon"),
    "intersport": ("Intersport", "mode", {"Q666888"}, r"intersport"),
    "chaussea":   ("Chaussea", "mode", {"Q62082044"}, r"chaussea"),
    "gemo":       ("Gémo", "mode", {"Q3122954"}, r"g[ée]mo"),
    "celio":      ("Celio", "mode", {"Q2672003"}, r"\bcelio\b"),
    "ca":         ("C&A", "mode", {"Q701338"}, r"^c\s?&\s?a$"),
    "kiabi":      ("Kiabi", "mode", {"Q3196299"}, r"kiabi"),
    "action":     ("Action", "mode", {"Q2634111"}, r"^action$"),
    "zeeman":     ("Zeeman", "mode", {"Q184399"}, r"zeeman"),
    # Hotels — fuer den Fall, dass es spaeter wird
    "ibis":       ("Ibis", "hotel", {"Q920166", "Q1458135"}, r"\bibis\b"),
    "bbhotel":    ("B&B Hotels", "hotel", {"Q794939"}, r"b\s?&\s?b\s?hotel"),
    "campanile":  ("Campanile", "hotel", {"Q2412064"}, r"campanile"),
}

_WD_INDEX = {}
for _slug, (_n, _c, _wds, _rx) in BRANDS.items():
    for _wd in _wds:
        _WD_INDEX[_wd] = _slug

_RX_INDEX = [(slug, re.compile(rx, re.I)) for slug, (_n, _c, _wds, rx) in BRANDS.items()]


def match_brand(tags):
    """Marken-Slug oder None. brand:wikidata schlaegt jeden Namensabgleich."""
    wd = tags.get("brand:wikidata")
    if wd in _WD_INDEX:
        return _WD_INDEX[wd]
    name = tags.get("brand") or tags.get("name") or ""
    if name:
        for slug, rx in _RX_INDEX:
            if rx.search(name):
                return slug
    return None

# -------------------------------------------------------------- Kategorien

# Kategorie -> (Anzeigename, Symbol, Gewicht in der Bewertung)
# Der Schnitt folgt den Fragen beim Stopp: Was essen wir? Was machen die
# Kinder? Kann man shoppen? Brauchen wir was Praktisches?
CATEGORIES = {
    "fastfood":   ("Schnell essen", "🍔", 8),
    "restaurant": ("Restaurant", "🍽️", 5),
    "cafe":       ("Café & Bäcker", "☕", 4),
    "kinder":     ("Für Kinder", "🧒", 8),
    "mall":       ("Einkaufszentrum", "🛍️", 10),
    "mode":       ("Mode & Schuhe", "👟", 6),
    "deko":       ("Deko & Geschenke", "🎁", 4),
    "supermarkt": ("Supermarkt", "🛒", 5),
    "wc":         ("WC", "🚻", 4),
    "hotel":      ("Hotel", "🛏️", 2),
    "tanken":     ("Tankstelle", "⛽", 1),
    "apotheke":   ("Apotheke", "💊", 2),
}

# Fuer die Namensausgabe, wenn ein POI keinen eigenen Namen traegt
_FALLBACK = {
    "fastfood": "Imbiss", "restaurant": "Restaurant", "cafe": "Café",
    "kinder": "Spielplatz", "mall": "Einkaufszentrum", "mode": "Modegeschäft",
    "deko": "Dekoladen",
    "supermarkt": "Supermarkt", "wc": "WC", "hotel": "Hotel",
    "tanken": "Tankstelle", "apotheke": "Apotheke",
}

_MODE_SHOPS = {"clothes", "shoes", "bags", "jewelry", "watches", "cosmetics",
               "perfumery", "beauty", "sports", "outdoor",
               "fashion_accessories", "boutique"}
_DEKO_SHOPS = {"interior_decoration", "houseware", "gift", "variety_store",
               "home_decoration", "candles"}
_KID_LEISURE = {"playground", "park", "pitch", "water_park", "trampoline_park",
                "amusement_arcade", "miniature_golf"}
_OUTLET_RX = re.compile(r"outlet|marques\s?avenue|usines?\b", re.I)


def categorize(tags):
    """OSM-Tags -> (Kategorie, Anzeigename, Marke|None[, Extras]) oder None.

    Marken zuerst: Ein McDonald's soll "McDonald's" heissen und in
    "fastfood" landen, egal wie das amenity-Tag aussieht.
    """
    brand = match_brand(tags)
    if brand:
        disp, cat, _, _ = BRANDS[brand]
        return (cat, disp, brand)

    name = tags.get("name") or tags.get("brand") or ""
    amenity = tags.get("amenity", "")
    shop = tags.get("shop", "")
    leisure = tags.get("leisure", "")
    tourism = tags.get("tourism", "")

    if leisure in _KID_LEISURE:
        kid_names = {"playground": "Spielplatz", "park": "Park",
                     "pitch": "Bolzplatz", "water_park": "Wasserpark",
                     "trampoline_park": "Trampolinpark",
                     "amusement_arcade": "Spielhalle",
                     "miniature_golf": "Minigolf"}
        # art unterscheidet echte Bewegungsangebote von Beiwerk — ein
        # Picknicktisch beschaeftigt kein Kind, das seit 3 h sitzt.
        return ("kinder", name or kid_names.get(leisure, "Spielplatz"), None,
                {"art": leisure})
    if tourism in ("picnic_site",) or leisure == "picnic_table":
        return ("kinder", name or "Picknickplatz", None, {"art": "picnic"})
    if shop == "toys":
        return ("kinder", name or "Spielwaren", None, {"art": "toys"})
    if amenity == "ice_cream":
        return ("cafe", name or "Eisdiele", None)
    if amenity == "fast_food":
        return ("fastfood", name or "Imbiss", None)
    if amenity == "restaurant":
        return ("restaurant", name or "Restaurant", None)
    if amenity == "cafe" or shop in ("bakery", "pastry", "coffee"):
        return ("cafe", name or ("Bäckerei" if shop == "bakery" else "Café"), None)
    if shop in ("mall", "department_store"):
        label = name or ("Einkaufszentrum" if shop == "mall" else "Kaufhaus")
        if _OUTLET_RX.search(name):
            label = name  # Outlets heissen wie sie heissen
        return ("mall", label, None)
    if shop in _MODE_SHOPS:
        return ("mode", name or _FALLBACK["mode"], None)
    if shop in _DEKO_SHOPS:
        return ("deko", name or _FALLBACK["deko"], None)
    if shop in ("supermarket", "convenience"):
        return ("supermarkt", name or ("Supermarkt" if shop == "supermarket" else "Minimarkt"), None)
    if amenity == "toilets":
        return ("wc", "WC", None)
    if amenity == "pharmacy":
        return ("apotheke", name or "Apotheke", None)
    if amenity == "fuel":
        return ("tanken", name or "Tankstelle", None)
    if tourism in ("hotel", "motel"):
        return ("hotel", name or "Hotel", None)
    return None

# --------------------------------------------------------- Oeffnungszeiten

_SU_OFF = re.compile(r"\bSu\s*(?:off|closed)\b", re.I)
_HAS_SU = re.compile(r"\bSu\b")
_DAY_RANGE = re.compile(r"\b(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)\b")
_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]


def _range_covers_sunday(text):
    for a, b in _DAY_RANGE.findall(text):
        ia, ib = _DAYS.index(a), _DAYS.index(b)
        span = _DAYS[ia:ib + 1] if ia <= ib else _DAYS[ia:] + _DAYS[:ib + 1]
        if "Su" in span:
            return True
    return False


def opening_flags(raw):
    """opening_hours -> {"h24": bool, "sunday": "open"|"closed"|"unknown"}.

    Bewusst grob: Es geht um die Reisefrage "lohnt der Stopp am Sonntag",
    nicht um minutengenaue Zeiten. Im Zweifel "unknown" — lieber keine
    Aussage als eine falsche.
    """
    if not raw:
        return {"h24": False, "sunday": "unknown"}
    text = raw.strip()
    if text == "24/7" or text.lower().startswith("24/7"):
        return {"h24": True, "sunday": "open"}
    if _SU_OFF.search(text):
        return {"h24": False, "sunday": "closed"}
    if _HAS_SU.search(text) or _range_covers_sunday(text):
        return {"h24": False, "sunday": "open"}
    if _DAY_RANGE.search(text) or re.search(r"\b(Mo|Tu|We|Th|Fr|Sa)\b", text):
        # Tage genannt, Sonntag nirgends dabei -> zu
        return {"h24": False, "sunday": "closed"}
    return {"h24": False, "sunday": "unknown"}
