/* Applies the saved theme before first paint (no flash). Kept as a tiny external
   file because the production CSP allows only same-origin scripts. */
(function () {
  try {
    var pref = localStorage.getItem("px-theme") || "light";
    var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    if (dark) root.classList.add("dark");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#010C28" : "#FFFFFF");
  } catch (e) { /* storage blocked: stay light */ }
})();
