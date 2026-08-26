/* Anzeigeformate — deutsch, kurz, im Auto auf einen Blick lesbar. */
window.Fmt = (function () {
  "use strict";

  function km(meters) {
    if (meters == null || !isFinite(meters)) { return "–"; }
    if (meters < 950) { return Math.round(meters / 10) * 10 + " m"; }
    var v = meters / 1000;
    return (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace(".", ",") + " km";
  }

  function minutes(min) {
    if (min == null || !isFinite(min)) { return "–"; }
    min = Math.round(min);
    if (min < 60) { return min + " min"; }
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m === 0 ? h + " h" : h + " h " + String(m).padStart(2, "0");
  }

  /* Uhrzeit in `min` Minuten ab jetzt. */
  function clockIn(min) {
    if (min == null || !isFinite(min)) { return "–"; }
    var d = new Date(Date.now() + min * 60000);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  /* Farbklasse fuer den Umweg: bis 5 min gruen, bis 12 gelb, darueber rot. */
  function detourClass(min) {
    if (min <= 5) { return "detour-good"; }
    if (min <= 12) { return "detour-mid"; }
    return "detour-bad";
  }

  /* Umwegtext: unter 2 Minuten ist es fuer den Fahrer "direkt an der Route". */
  function detourText(min) {
    // Geschütztes Leerzeichen: der Wert soll als Einheit umbrechen,
    // nie mitten in "+10 min".
    return min <= 1 ? "direkt an der\u00A0Route"
                    : "+" + min + "\u00A0min\u00A0Umweg";
  }

  var ICONS = {
    fastfood: "🍔", restaurant: "🍽️", cafe: "☕", kinder: "🛝",
    mall: "🛍️", mode: "👟", deko: "🎁", supermarkt: "🛒",
    wc: "🚻", hotel: "🛏️", tanken: "⛽", apotheke: "💊"
  };

  var CAT_NAMES = {
    fastfood: "Schnell essen", restaurant: "Restaurant", cafe: "Café & Bäcker",
    kinder: "Für Kinder", mall: "Einkaufszentrum", mode: "Mode & Schuhe",
    deko: "Deko & Geschenke", supermarkt: "Supermarkt", wc: "WC",
    hotel: "Hotel", tanken: "Tankstelle", apotheke: "Apotheke"
  };

  function icon(cat) { return ICONS[cat] || "•"; }
  function catName(cat) { return CAT_NAMES[cat] || cat; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  return { km: km, minutes: minutes, clockIn: clockIn,
           detourClass: detourClass, detourText: detourText,
           icon: icon, catName: catName, esc: esc };
})();
