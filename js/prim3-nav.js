(function () {
  "use strict";

  var ROOT = (function () {
    var src = document.currentScript && document.currentScript.src;
    return src ? src.replace(/js\/prim3-nav\.js.*$/, "") : "";
  })();
  var target = ROOT + "prim3.html";
  var book = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c2.9-.8 5.5-.4 8 1.2v12c-2.5-1.6-5.1-2-8-1.2z"/><path d="M20 5.5c-2.9-.8-5.5-.4-8 1.2v12c2.5-1.6 5.1-2 8-1.2z"/></svg>';

  function go(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.href = target;
  }

  function stopHold(event) {
    event.stopImmediatePropagation();
  }

  function install() {
    document.querySelectorAll(".appbar").forEach(function (dock) {
      var tab = dock.querySelector('[data-appnav="sites"]');
      if (!tab) return;
      if (tab.getAttribute("data-prim3-nav") === "1") return;

      tab.setAttribute("data-prim3-nav", "1");
      tab.setAttribute("href", target);
      tab.setAttribute("aria-label", "PRIM3 curriculum");
      tab.innerHTML = book + "<span>PRIM3</span>";
      if (location.pathname.split("/").pop() === "prim3.html") tab.classList.add("is-here");

      /* tabbar.js still owns the historical `sites` wing in older page
         markup. Capture this one control before its hold/click handlers so
         the retired Whip wing cannot reappear. Whip itself remains intact
         at whip.html; only its global doorway is being tucked away. */
      tab.addEventListener("pointerdown", stopHold, true);
      tab.addEventListener("click", go, true);
    });
  }

  function boot() {
    install();
    if (!document.body || !window.MutationObserver) return;
    new MutationObserver(install).observe(document.body, {childList:true, subtree:true});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();
