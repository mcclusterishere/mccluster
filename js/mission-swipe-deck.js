/* Mission discovery only. A pass stays in this page's memory. Acceptance is
   delegated to the existing mission workflow; the deck never creates proof,
   awards points, approves an application, or assumes a request succeeded. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCC_MISSION_DECK = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  var CATEGORIES = ["all", "create", "help", "explore", "earn"];
  var LABELS = { all: "All", create: "Create", help: "Help", explore: "Explore", earn: "Earn" };
  var sequence = 0;
  function key(m) { return String(m && (m.id || m.mission_id) || ""); }
  function category(m) {
    var value = String(m && (m.discovery_category || m.domain) || "").toLowerCase();
    return CATEGORIES.indexOf(value) > 0 ? value : "";
  }
  function brief(value) {
    var text = String(value || "").replace(/\s+/g, " ").trim() || "Open the mission to read its brief.";
    if (text.length <= 220) return text;
    var excerpt = text.slice(0, 219), boundary = excerpt.lastIndexOf(" ");
    if (boundary > 0) excerpt = excerpt.slice(0, boundary);
    return excerpt.trimEnd() + "…";
  }
  function gesture(dx, dy, width) {
    return Math.abs(dx) >= Math.min(96, Math.max(64, width * 0.25)) && Math.abs(dx) > Math.abs(dy) * 1.5
      ? (dx < 0 ? "pass" : "accept") : null;
  }
  function createState() {
    var rows = [], passed = [], accepted = new Set(), filter = "all", preferred = "";
    function available() {
      return rows.filter(function (m) {
        return !accepted.has(key(m)) && passed.indexOf(key(m)) < 0 && (filter === "all" || category(m) === filter);
      });
    }
    function current() { var list = available(); return list.find(function (m) { return key(m) === preferred; }) || list[0] || null; }
    return {
      update: function (items) {
        var seen = new Set();
        rows = (Array.isArray(items) ? items : []).filter(function (m) {
          var id = key(m);
          if (!id || seen.has(id) || m.status !== "open" || m.kind === "clip") return false;
          seen.add(id); return true;
        });
      },
      current: current,
      available: available,
      category: function () { return filter; },
      selectCategory: function (value) { if (CATEGORIES.indexOf(value) >= 0) { filter = value; preferred = ""; } },
      pass: function () { var m = current(); if (!m) return null; passed.push(key(m)); preferred = ""; return m; },
      accept: function (id) { if (rows.some(function (m) { return key(m) === id; })) accepted.add(id); preferred = ""; },
      undo: function () {
        while (passed.length) {
          var id = passed.pop(), row = rows.find(function (m) { return key(m) === id; });
          if (row && !accepted.has(id)) { filter = "all"; preferred = id; return row; }
        }
        return null;
      },
      resetPasses: function () { passed = []; preferred = ""; },
      canUndo: function () { return passed.some(function (id) { return rows.some(function (m) { return key(m) === id; }) && !accepted.has(id); }); }
    };
  }
  function mount(host, options) {
    if (!host) return null;
    options = options || {};
    var doc = host.ownerDocument, state = createState(), ready = false, busy = false, error = "", drag = null, card = null;
    var uid = "mission-deck-" + (++sequence), announcement = "";
    host.classList.add("mn-swipe");
    host.setAttribute("data-mission-deck", "");
    host.innerHTML = '<nav class="mn-swipe__filters" aria-label="Mission categories"></nav>' +
      '<div class="mn-swipe__top"><p class="mn-swipe__count"></p><button class="mn-swipe__undo" type="button">Undo pass</button></div>' +
      '<p class="mn-swipe__hint" id="' + uid + '-hint">Swipe left to pass. Swipe right to accept.</p>' +
      '<div class="mn-swipe__stage"></div><p class="mn-swipe__status" role="status" aria-live="polite" aria-atomic="true"></p>';
    var filters = host.querySelector(".mn-swipe__filters"), stage = host.querySelector(".mn-swipe__stage"), status = host.querySelector(".mn-swipe__status");
    var count = host.querySelector(".mn-swipe__count"), undo = host.querySelector(".mn-swipe__undo");
    function el(tag, className, value) {
      var node = doc.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = String(value); return node;
    }
    function button(className, label, callback) {
      var b = el("button", className, label); b.type = "button"; b.onclick = callback; return b;
    }
    CATEGORIES.forEach(function (value) {
      var b = button("", LABELS[value], function () { if (busy) return; resetDrag(); state.selectCategory(value); announcement = ""; render(); });
      b.dataset.category = value; filters.appendChild(b);
    });
    function say(message, failed) {
      announcement = message || ""; status.textContent = announcement; status.classList.toggle("is-error", !!failed);
    }
    function focusCard() {
      if (card && !doc.querySelector("dialog[open]")) card.focus({ preventScroll: true });
    }
    function resetDrag() {
      var old = drag; drag = null;
      if (card) {
        card.style.removeProperty("transform"); card.classList.remove("is-dragging"); card.removeAttribute("data-direction");
        if (old && card.hasPointerCapture && card.hasPointerCapture(old.id)) card.releasePointerCapture(old.id);
      }
    }
    function render() {
      resetDrag();
      host.setAttribute("aria-busy", String(busy || !ready));
      filters.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.category === state.category())); b.disabled = busy; });
      undo.disabled = busy || !state.canUndo();
      var list = state.available(), m = state.current();
      count.textContent = !ready ? "Loading missions…" : list.length + (list.length === 1 ? " mission to explore" : " missions to explore");
      stage.replaceChildren(); card = null;
      if (!ready || error || !m) {
        var empty = el("div", "mn-swipe__empty");
        empty.appendChild(el("h3", "", !ready ? "Finding your next mission" : error ? "Missions could not load" : "You’re all caught up"));
        empty.appendChild(el("p", "", !ready ? "Open missions will appear here." : error || (state.category() === "all" ? "Check back for more, or take another look at the missions you passed." : "No more open missions in " + LABELS[state.category()] + ". Try another category.")));
        if (error && options.onRefresh) empty.appendChild(button("mn-swipe__details", "Try again", options.onRefresh));
        if (ready && !error && state.canUndo()) empty.appendChild(button("mn-swipe__details", "Review passed missions", function () { state.resetPasses(); announcement = ""; render(); focusCard(); }));
        stage.appendChild(empty); return;
      }
      card = el("article", "mn-swipe__card"); card.tabIndex = 0; card.dataset.mission = key(m);
      card.setAttribute("aria-labelledby", uid + "-title"); card.setAttribute("aria-describedby", uid + "-hint");
      card.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
      var stamps = el("div", "mn-swipe__stamps"); stamps.setAttribute("aria-hidden", "true");
      stamps.appendChild(el("span", "mn-swipe__stamp mn-swipe__stamp--pass", "PASS"));
      stamps.appendChild(el("span", "mn-swipe__stamp mn-swipe__stamp--accept", "ACCEPT")); card.appendChild(stamps);
      var type = category(m), meta = el("p", "mn-swipe__category", type ? LABELS[type] : String(m.domain || "Mission").replace(/_/g, " "));
      card.dataset.category = type || "other"; card.appendChild(meta);
      var title = el("h3", "", m.title || "Mission"); title.id = uid + "-title"; card.appendChild(title);
      var description = el("div", "mn-swipe__description");
      description.appendChild(el("p", "", brief(m.description)));
      card.appendChild(description);
      if (m.proof_required) card.appendChild(el("p", "mn-swipe__review", "Submit your result for review when you finish."));
      var tools = el("div", "mn-swipe__tools");
      if (options.onOpen) tools.appendChild(button("mn-swipe__details", "Read full mission", function () { if (!busy) options.onOpen(m); }));
      card.appendChild(tools);
      var actions = el("div", "mn-swipe__actions");
      var pass = button("mn-swipe__pass", "← Pass", function () { decide("pass"); });
      var accept = button("mn-swipe__accept", busy ? "Opening…" : "Accept →", function () { decide("accept"); });
      pass.setAttribute("aria-label", "Pass mission: " + m.title); accept.setAttribute("aria-label", "Accept mission: " + m.title);
      pass.disabled = accept.disabled = busy; actions.appendChild(pass); actions.appendChild(accept); card.appendChild(actions);
      stage.appendChild(card);
      card.addEventListener("keydown", function (e) {
        if (e.target !== card || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); decide(e.key === "ArrowLeft" ? "pass" : "accept"); }
      });
      card.addEventListener("pointerdown", function (e) {
        if (!e.isPrimary) { resetDrag(); return; }
        if (busy || e.button !== 0 || e.target.closest("button,a,input,textarea,select,summary")) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, horizontal: false };
      });
      card.addEventListener("pointermove", function (e) {
        if (!drag || drag.id !== e.pointerId) return;
        drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
        if (!drag.horizontal) {
          if (Math.abs(drag.dy) > 12 && Math.abs(drag.dy) >= Math.abs(drag.dx)) { resetDrag(); return; }
          if (Math.abs(drag.dx) < 12 || Math.abs(drag.dx) <= Math.abs(drag.dy) * 1.5) return;
          drag.horizontal = true; card.setPointerCapture(e.pointerId); card.classList.add("is-dragging");
        }
        if (e.cancelable) e.preventDefault();
        var x = Math.max(-240, Math.min(240, drag.dx));
        card.style.transform = "translateX(" + x + "px) rotate(" + (x / 24) + "deg)";
        card.dataset.direction = drag.dx < 0 ? "pass" : "accept";
      });
      card.addEventListener("pointerup", function (e) {
        if (!drag || drag.id !== e.pointerId) return;
        var choice = drag.horizontal ? gesture(e.clientX - drag.x, e.clientY - drag.y, card.clientWidth) : null;
        resetDrag(); if (choice) { e.preventDefault(); decide(choice); }
      });
      card.addEventListener("pointercancel", resetDrag);
      card.addEventListener("lostpointercapture", function (e) {
        // Touch initially captures the child under the finger. Moving capture
        // to this card emits a bubbling loss from that child; it is not a cancel.
        if (drag && e.target === card && !card.hasPointerCapture(e.pointerId)) resetDrag();
      });
    }
    function decide(action) {
      var m = state.current(); if (!m || busy || !ready || error) return Promise.resolve(false);
      resetDrag();
      if (action === "pass") {
        state.pass(); render(); say("Passed “" + m.title + "”. You can undo that."); focusCard(); return Promise.resolve(true);
      }
      if (action !== "accept" || !options.onAccept) return Promise.resolve(false);
      busy = true; render(); say("Opening “" + m.title + "”…");
      return Promise.resolve().then(function () { return options.onAccept(m); }).then(function (result) {
        // Only the authoritative workflow can confirm acceptance. Sign-in,
        // unfinished applications, cancellations and errors retain this card.
        if (result && result.accepted === true) state.accept(key(m));
        busy = false; render();
        say(result && result.message || "Continue in the mission window.", !!(result && result.error));
        if (result && result.accepted === true) focusCard();
        return !!(result && result.accepted === true);
      }, function (e) {
        busy = false; render(); say(e && e.message || "Could not accept this mission. Try again.", true); return false;
      });
    }
    undo.onclick = function () { if (busy) return; var m = state.undo(); render(); if (m) { say("Restored “" + m.title + "”."); focusCard(); } };
    render();
    return {
      update: function (rows) { state.update(rows); ready = true; error = ""; render(); },
      loading: function () { if (!ready) render(); },
      fail: function (message) { ready = true; error = message || "Try again in a moment."; render(); say(error, true); },
      refresh: function () { if (options.onRefresh) options.onRefresh(); }
    };
  }
  return { mount: mount, createState: createState, category: category, gesture: gesture, brief: brief };
});
