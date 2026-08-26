(function () {
  "use strict";

  var greeting = document.getElementById("greeting");
  var form = document.getElementById("name-form");
  var input = document.getElementById("name-input");
  var clock = document.getElementById("clock");
  var themeToggle = document.getElementById("theme-toggle");

  function greetingForHour(hour) {
    if (hour < 5) return "Gute Nacht";
    if (hour < 11) return "Guten Morgen";
    if (hour < 18) return "Guten Tag";
    return "Guten Abend";
  }

  function render(name) {
    var prefix = greetingForHour(new Date().getHours());
    greeting.textContent = name ? prefix + ", " + name + "!" : "Hallo Welt";
    document.title = name ? prefix + ", " + name + "!" : "Hallo Welt";
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    render(input.value.trim());
  });

  function tick() {
    clock.textContent = new Date().toLocaleString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  tick();
  setInterval(tick, 1000);

  function applyTheme(theme) {
    var dark = theme === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    themeToggle.textContent = dark ? "Helles Design" : "Dunkles Design";
    themeToggle.setAttribute("aria-pressed", String(dark));
  }

  function storedTheme() {
    try {
      return localStorage.getItem("theme");
    } catch (error) {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem("theme", theme);
    } catch (error) {
      /* Speichern ist optional (z. B. im privaten Modus). */
    }
  }

  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(storedTheme() || (prefersDark ? "dark" : "light"));

  themeToggle.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    storeTheme(next);
  });
})();
