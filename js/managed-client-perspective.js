/* Public managed-client perspective. Strictly presentation/routing, NEVER authorization.
   Shared navigation remains the owner of the actual bottom bar. */
(function () {
  "use strict";
  var bar = window.MCC_BAR;
  if (!bar || !bar.navigation || document.body.hasAttribute("data-no-appbar")) return;
  var catalog = Object.freeze({
    "faith-and-results": Object.freeze({
      name: "Faith & Results", short: "Faith",
      path: "partners/faith-and-results.html",
      mark: "https://raw.githubusercontent.com/mcclusterishere/Faith-And-Results/d7cd015158e026352c2862d8d7643fb8c72e227b/assets/icons/apple-touch-icon.png", initial: "F"
    }),
    "shiloh-church-gpt": Object.freeze({
      name: "Shiloh Baptist Church", short: "Shiloh",
      path: "partners/shiloh-church-gpt.html",
      mark: "https://raw.githubusercontent.com/mcclusterishere/Shiloh-Church-BPT-App/ea0f1bd1bad33876255daaa5ce8f4641982770f9/assets/media/favicon.webp", initial: "S"
    })
  });
  var storeKey = "mcc_managed_client_perspective";
  var params = new URLSearchParams(location.search);
  var forced = document.body.getAttribute("data-managed-client");
  var explicit = forced || (params.has("mcc_app") ? params.get("mcc_app") : null);
  var house = new URL(bar.navigation.house, location.href);
  var atHouseRoot = location.origin === house.origin && /^\/(?:index\.html)?$/.test(location.pathname);
  function read() { try { return sessionStorage.getItem(storeKey); } catch (e) { return null; } }
  function write(value) { try { if (value) sessionStorage.setItem(storeKey, value); else sessionStorage.removeItem(storeKey); } catch (e) {} }
  if (atHouseRoot && !explicit) write(null);
  var slug = explicit === null ? read() : explicit;
  var current = Object.prototype.hasOwnProperty.call(catalog, slug) ? catalog[slug] : null;
  if (!current) { if (explicit !== null) write(null); return; }
  write(slug);
  var dock = document.querySelector(".appbar");
  if (!dock) return;
  function withContext(destination) {
    var url = new URL(destination, location.href);
    url.searchParams.set("mcc_app", slug);
    return url.href;
  }
  var home = withContext(new URL(current.path, house).href);
  var music = withContext(new URL("listen.html", house).href);
  var world = withContext(bar.navigation.world);
  var failedMark = false;
  function paint() {
    if (bar.admin && bar.admin()) return;
    if (dock.classList.contains("appbar--morph")) return;
    var tab = dock.querySelector('a[data-appnav="home"]');
    if (!tab) return;
    var dest = new URL(home);
    if (tab.href !== home) tab.href = home;
    var aria = "Open " + current.name + " app";
    if (tab.getAttribute("aria-label") !== aria) tab.setAttribute("aria-label", aria);
    if (tab.getAttribute("data-managed-perspective") !== slug) tab.setAttribute("data-managed-perspective", slug);
    var label = tab.querySelector("span:last-child");
    if (label && label.textContent !== current.short) label.textContent = current.short;
    var mark = tab.querySelector(".appbar__m");
    if (!mark || !mark.classList.contains("appbar__m--managed")) {
      var picture = document.createElement(failedMark ? "span" : "img");
      picture.className = "appbar__m appbar__m--managed" + (failedMark ? " appbar__m--initial" : "");
      picture.setAttribute("aria-hidden", "true");
      if (failedMark) picture.textContent = current.initial;
      else {
        picture.src = current.mark;
        picture.alt = "";
        picture.addEventListener("error", function () {
          failedMark = true;
          if (picture.isConnected) {
            var letter = document.createElement("span");
            letter.className = "appbar__m appbar__m--managed appbar__m--initial";
            letter.setAttribute("aria-hidden", "true");
            letter.textContent = current.initial;
            picture.replaceWith(letter);
          }
        }, {once:true});
      }
      if (mark) mark.replaceWith(picture);
      else tab.insertBefore(picture, label || null);
    }
    var here = location.origin === dest.origin && location.pathname === dest.pathname;
    if (tab.classList.contains("is-here") !== here) tab.classList.toggle("is-here", here);
    if (here) { if (tab.getAttribute("aria-current") !== "page") tab.setAttribute("aria-current", "page"); }
    else if (tab.getAttribute("aria-current") === "page") tab.removeAttribute("aria-current");
  }
  var style = document.createElement("style");
  style.textContent = '.appbar .appbar__m--managed{display:block;width:31px;height:31px;max-width:31px;max-height:31px;object-fit:contain;border:0;background:transparent}.appbar span.appbar__m--managed{display:grid;place-items:center;font:800 17px/1 system-ui,sans-serif;color:inherit}';
  document.head.appendChild(style);
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (bar.admin && bar.admin()) return;
    if (dock.classList.contains("appbar--morph")) return;
    var tab = event.target && event.target.closest && event.target.closest("a[data-appnav]");
    if (!tab || !dock.contains(tab)) return;
    var key = tab.getAttribute("data-appnav");
    if (key !== "home" && key !== "music" && key !== "world") return;
    // On the Music document, the shared bar is the real play/pause transport.
    // Do not swallow that click: the current URL already retains mcc_app.
    if (key === "music" && location.origin === new URL(music).origin &&
        location.pathname === new URL(music).pathname &&
        typeof window.MCC_NP_PLAY === "function" &&
        typeof window.MCC_NP_PAUSE === "function") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    bar.navigation.go(key === "home" ? home : (key === "music" ? music : world));
  }, true);
  new MutationObserver(paint).observe(dock, {childList:true,subtree:true});
  window.addEventListener("mcc:auth-state", paint);
  window.addEventListener("mcc:appbar-admin", paint);
  window.addEventListener("pageshow", paint);
  paint();
})();
