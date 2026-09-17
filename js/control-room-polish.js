/* McCluster Control Room progressive interaction polish.
   Keeps the locked Home / Work / Create / System / Apps architecture intact.
   This file only enhances DOM behavior; it creates no parallel state or backend. */
(function () {
  "use strict";

  var lastFocused = null;

  function closestAction(target) {
    return target && target.closest ? target.closest("[data-action]") : null;
  }

  function serviceKeyForResource(label) {
    var value = String(label || "").toLowerCase();
    if (value.indexOf("supabase") >= 0) return "db";
    if (value.indexOf("cloudflare") >= 0) return "api";
    if (value.indexOf("openai") >= 0 || value.indexOf("model") >= 0) return "core";
    if (value.indexOf("social") >= 0) return "comms";
    return "api";
  }

  function inspectMappedService(key) {
    location.hash = "#system:overview";
    window.setTimeout(function () {
      var selector = '[data-action="inspect-service"][data-key="' + key + '"]';
      var node = document.querySelector(selector);
      if (node) node.click();
    }, 30);
  }

  document.addEventListener("click", function (event) {
    var filter = event.target && event.target.closest ? event.target.closest("[data-job-filter]") : null;
    if (filter) {
      event.preventDefault();
      var desired = filter.getAttribute("data-job-filter") || "all";
      var root = filter.closest(".cr-workbar") || document;
      root.querySelectorAll("[data-job-filter]").forEach(function (button) {
        var active = button === filter;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      document.querySelectorAll(".cr-data-table tbody tr").forEach(function (row) {
        var stateCell = row.querySelector("td:first-child");
        var state = stateCell ? stateCell.textContent.trim().toLowerCase() : "";
        row.hidden = desired !== "all" && state !== desired;
      });
      return;
    }

    var action = closestAction(event.target);
    if (!action) return;

    if (action.getAttribute("data-action") === "inspect-resource") {
      event.preventDefault();
      event.stopImmediatePropagation();
      inspectMappedService(serviceKeyForResource(action.getAttribute("data-key") || action.textContent));
      return;
    }

    if (action.getAttribute("data-action") === "inspect-service" && !action.getAttribute("data-key")) {
      var inferred = action.getAttribute("data-id");
      if (inferred === "host") action.setAttribute("data-key", "host");
      else if (inferred === "health") action.setAttribute("data-key", "api");
    }
  }, true);

  var inspector = document.getElementById("crInspector");
  if (inspector && window.MutationObserver) {
    new MutationObserver(function () {
      var open = inspector.classList.contains("is-open");
      document.body.classList.toggle("cr-inspector-open", open);
      if (open) {
        lastFocused = lastFocused || document.activeElement;
        var close = document.getElementById("crInspectorClose");
        if (window.innerWidth <= 760 && close) window.setTimeout(function () { close.focus(); }, 0);
      } else if (lastFocused && lastFocused.focus) {
        try { lastFocused.focus({ preventScroll: true }); } catch (e) { lastFocused.focus(); }
        lastFocused = null;
      }
    }).observe(inspector, { attributes: true, attributeFilter: ["class"] });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || !inspector || !inspector.classList.contains("is-open") || window.innerWidth > 760) return;
    var focusables = inspector.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
