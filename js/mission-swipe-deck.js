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
  /* The card's art is its kind, drawn as a glyph: missions carry no photo and none is invented (owner's reference, 2026-10-19). */
  var GLYPH = {
    help: 'M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10Z',
    create: 'M4 20l4-1 10-10-3-3L5 16zM13 7l3 3M3 21h18',
    explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5-1.5-2 6.5-6.5 2 2-6.5z',
    earn: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v10m3-7.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.2 1.3 2 3 2.3 3 1.1 3 2.3-1.3 2.2-3 2.2-3-1.1-3-2.5',
    other: 'M12 3l2.7 5.6 6.3.9-4.5 4.3 1 6.2L12 17l-5.5 3 1-6.2L3 9.5l6.3-.9z'
  };
  var MARK = { pass: 'M6 6l12 12M18 6 6 18', accept: 'M12 20.5s-8-5-8-11a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 6-8 11-8 11Z' };
  function svg(path) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg>'; }
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
    var doc = host.ownerDocument, state = createState(), ready = false, busy = false, error = "", drag = null, card = null, view = "open", completedLoaded = false;
    var uid = "mission-deck-" + (++sequence), announcement = "";
    host.classList.add("mn-swipe");
    host.setAttribute("data-mission-deck", "");
    host.innerHTML = '<div class="mn-swipe__top"><div class="mn-swipe__filters" role="tablist" aria-label="Mission status">' +
      '<button type="button" role="tab" data-status="open" aria-selected="true">Open</button>' +
      '<button type="button" role="tab" data-status="completed" aria-selected="false">Completed</button></div>' +
      '<button class="mn-swipe__undo" type="button" aria-label="Undo last pass" title="Undo last pass">↶</button></div>' +
      '<p class="mn-swipe__count"></p><div class="mn-swipe__stage"></div>' +
      '<div class="mn-swipe__completed" id="mnCompletedSeries" role="tabpanel" aria-label="Completed mission series" hidden></div>' +
      '<p class="mn-swipe__status" role="status" aria-live="polite" aria-atomic="true"></p>';
    var filters = host.querySelector(".mn-swipe__filters"), stage = host.querySelector(".mn-swipe__stage"), status = host.querySelector(".mn-swipe__status");
    var count = host.querySelector(".mn-swipe__count"), undo = host.querySelector(".mn-swipe__undo"), completed = host.querySelector(".mn-swipe__completed");
    filters.querySelector('[data-status="completed"]').setAttribute("aria-controls", "mnCompletedSeries");
    function el(tag, className, value) {
      var node = doc.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = String(value); return node;
    }
    function button(className, label, callback) {
      var b = el("button", className, label); b.type = "button"; b.onclick = callback; return b;
    }
    filters.querySelectorAll("[data-status]").forEach(function (b) {
      b.onclick = function () { if (busy) return; view = b.dataset.status; announcement = ""; say(""); render(); };
      b.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        var tabs = Array.prototype.slice.call(filters.querySelectorAll("[data-status]"));
        var position = tabs.indexOf(b);
        var next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 :
          (position + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        tabs[next].click(); tabs[next].focus();
      });
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
      filters.querySelectorAll("[data-status]").forEach(function (b) {
        b.setAttribute("aria-selected", String(b.dataset.status === view)); b.tabIndex = b.dataset.status === view ? 0 : -1; b.disabled = busy;
      });
      var isCompleted = view === "completed";
      stage.hidden = count.hidden = undo.hidden = isCompleted; completed.hidden = !isCompleted;
      if (isCompleted) {
        resetDrag();
        // The open card leaves the DOM with its tab; render() rebuilds it from
        // state when Open is selected again, so nothing is lost by clearing.
        stage.replaceChildren(); card = null;
        if (!completedLoaded) {
          completedLoaded = true;
          completed.textContent = "Loading completed missions…";
          if (options.onCompleted) Promise.resolve().then(function () { return options.onCompleted(completed); }).catch(function () {
            completedLoaded = false; completed.textContent = "Completed missions could not load. Switch tabs to retry.";
          });
          else completed.textContent = "No completed mission series is published yet.";
        }
        return;
      }
      undo.disabled = busy || !state.canUndo();
      var list = state.available(), m = state.current();
      count.textContent = !ready ? "Loading open missions…" : list.length + (list.length === 1 ? " open mission" : " open missions");
      stage.replaceChildren(); card = null;
      if (!ready || error || !m) {
        var empty = el("div", "mn-swipe__empty");
        empty.appendChild(el("h3", "", !ready ? "Finding your next mission" : error ? "Missions could not load" : "You’re all caught up"));
        empty.appendChild(el("p", "", !ready ? "Open missions will appear here." : error || (state.category() === "all" ? "Check back for more, or take another look at the missions you passed." : "No more open missions in " + LABELS[state.category()] + ". Try another category.")));
        if (error && options.onRefresh) empty.appendChild(button("mn-swipe__details", "Try again", options.onRefresh));
        if (ready && !error && state.canUndo()) empty.appendChild(button("mn-swipe__details", "Review passed missions", function () { state.resetPasses(); announcement = ""; render(); focusCard(); }));
        stage.appendChild(empty); return;
      }
      /* THE DECK (owner's reference, 2026-10-19): the open mission on top, the next two peeking out behind it, the
         kind as art, the facts the row carries as chips, X and heart under the card, dots for how many are left. */
      var deck = el("div", "mn-swipe__deck");
      list.slice(1, 3).forEach(function (next, i) {
        var peek = el("div", "mn-swipe__peek"); peek.dataset.category = category(next) || "other";
        peek.setAttribute("aria-hidden", "true"); peek.style.setProperty("--peek", String(i + 1)); deck.appendChild(peek);
      });
      card = el("article", "mn-swipe__card"); card.tabIndex = 0; card.dataset.mission = key(m);
      card.setAttribute("aria-labelledby", uid + "-title");
      card.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
      var stamps = el("div", "mn-swipe__stamps"); stamps.setAttribute("aria-hidden", "true");
      stamps.appendChild(el("span", "mn-swipe__stamp mn-swipe__stamp--pass", "PASS"));
      stamps.appendChild(el("span", "mn-swipe__stamp mn-swipe__stamp--accept", "ACCEPT")); card.appendChild(stamps);
      var type = category(m), meta = el("p", "mn-swipe__category", type ? LABELS[type] : String(m.domain || "Mission").replace(/_/g, " "));
      card.dataset.category = type || "other";
      var art = el("div", "mn-swipe__art"); art.setAttribute("aria-hidden", "true"); art.innerHTML = svg(GLYPH[type] || GLYPH.other);
      art.appendChild(meta); card.appendChild(art);
      var body = el("div", "mn-swipe__body"); card.appendChild(body);
      var title = el("h3", "", m.title || "Mission"); title.id = uid + "-title"; body.appendChild(title);
      var description = el("div", "mn-swipe__description");
      description.appendChild(el("p", "", brief(m.description)));
      body.appendChild(description);
      var tags = el("div", "mn-swipe__tags"), points = Number(m.points);
      if (points > 0) tags.appendChild(el("span", "mn-swipe__tag mn-swipe__tag--xp", "XP +" + points));
      if (m.region_label) tags.appendChild(el("span", "mn-swipe__tag", String(m.region_label)));
      if (type && m.domain && String(m.domain).toLowerCase() !== type) tags.appendChild(el("span", "mn-swipe__tag", String(m.domain).replace(/_/g, " ")));
      if (m.proof_required) { var review = el("span", "mn-swipe__tag mn-swipe__review", "Proof reviewed"); review.title = "Submit your result for review when you finish."; tags.appendChild(review); }
      if (tags.childNodes.length) body.appendChild(tags);
      var tools = el("div", "mn-swipe__tools");
      if (options.onOpen) tools.appendChild(button("mn-swipe__details", "Read full mission", function () { if (!busy) options.onOpen(m); }));
      body.appendChild(tools);
      deck.appendChild(card); stage.appendChild(deck);
      var actions = el("div", "mn-swipe__actions");
      var pass = button("mn-swipe__pass", "", function () { decide("pass"); });
      pass.innerHTML = svg(MARK.pass) + '<span class="sr-only">Pass</span>';
      var accept = button("mn-swipe__accept", "", function () { decide("accept"); });
      accept.innerHTML = svg(MARK.accept) + '<span class="sr-only">' + (busy ? "Opening…" : "Accept") + '</span>';
      pass.setAttribute("aria-label", "Pass mission: " + m.title); accept.setAttribute("aria-label", "Accept mission: " + m.title);
      pass.disabled = accept.disabled = busy;
      var browse = el("div", "mn-swipe__browse"), dots = el("div", "mn-swipe__dots"); dots.setAttribute("aria-hidden", "true");
      for (var d = 0; d < Math.min(list.length, 5); d++) { var dot = el("i", d === 0 ? "is-on" : ""); dots.appendChild(dot); }
      browse.appendChild(dots); browse.appendChild(el("span", "mn-swipe__hint", "Swipe to browse missions"));
      var arrows = el("span", "mn-swipe__arrows", "← →"); arrows.setAttribute("aria-hidden", "true"); browse.appendChild(arrows);
      actions.appendChild(pass); actions.appendChild(browse); actions.appendChild(accept); stage.appendChild(actions);
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
