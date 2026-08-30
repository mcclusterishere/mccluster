/* ============================================================
   THE SHOP — the rate card, shoppable.

   Every service line on the card carries data-shop attributes;
   this file turns each one into something you can put in a
   package. Stack services and the package discounts itself:

       two lines   —  5% off the package
       three       — 10% off
       four+       — 15% off

   The flagship and the campaign never enter the tray — they are
   already packages. The Teardown rides along as its own product
   (the call around it is free; the $585 credits back). "from" lines ride at
   their floor and the total says so. Monthly lines discount on
   the same tiers, shown per month.

   The tray keeps the one-CTA law: its button is the same
   "Book a call with me", and the package rides into the gate
   lead (gate.js asks MCC_SHOP for a summary), so the desk sees
   exactly what was in the cart even if the call never books.
   The package survives reloads (localStorage).
   ============================================================ */
(function () {
  "use strict";
  var KEY = "mccPack";
  var TIERS = [[4, 15], [3, 10], [2, 5]];

  var items = {};   /* id -> {id,n,p,m} from the cards */
  var picked = [];  /* ids in the order they were added */
  var tray, fab;

  function load() {
    try { picked = (JSON.parse(localStorage.getItem(KEY)) || []).filter(function (id) { return items[id]; }); }
    catch (e) { picked = []; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(picked)); } catch (e) {} }

  function pct() {
    for (var i = 0; i < TIERS.length; i++) if (picked.length >= TIERS[i][0]) return TIERS[i][1];
    return 0;
  }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  var FLAT = { teardown: true }; /* credits back in full, so it never discounts */
  function totals() {
    var once = 0, mo = 0, flat = 0, from = false, off = pct();
    picked.forEach(function (id) {
      var it = items[id];
      if (FLAT[it.id]) { flat += it.p; return; }
      if (it.m === "mo") mo += it.p; else once += it.p;
      if (it.m === "from") from = true;
    });
    var k = 1 - off / 100;
    return { off: off, from: from, once: once, mo: mo, flat: flat,
      onceOff: once * k + flat, moOff: mo * k,
      savesOnce: once - once * k, savesMo: mo - mo * k };
  }

  /* the words the gate sends to the desk */
  function summary() {
    if (!picked.length) return "";
    var t = totals();
    var lines = ["PACKAGE (" + picked.length + " services · " + t.off + "% off):"];
    picked.forEach(function (id) {
      var it = items[id];
      lines.push("  - " + it.n + " — " + (it.m === "from" ? "from " : "") + money(it.p) + (it.m === "mo" ? "/mo" : ""));
    });
    if (t.once || t.flat) lines.push("  One-time: " + (t.from ? "from " : "") + money(t.onceOff)
      + (t.off ? " (was " + money(t.once + t.flat) + ")" : "")
      + (t.flat ? " — includes the Teardown $585, credits in full" : ""));
    if (t.mo) lines.push("  Monthly: " + money(t.moOff) + "/mo" + (t.off ? " (was " + money(t.mo) + "/mo)" : ""));
    return lines.join("\n");
  }

  /* ---------- painting ---------- */
  function paintCards() {
    Object.keys(items).forEach(function (id) {
      var card = document.querySelector('[data-shop="' + id + '"]');
      /* Rate lines are rendered per mode now, so a line that is in the saved
         package may not be on screen — the tray still totals it, but there is
         no card to mark. Skip it instead of throwing. */
      if (!card) return;
      var on = picked.indexOf(id) > -1;
      card.classList.toggle("is-picked", on);
      var b = card.querySelector(".shop__add");
      if (b) { b.textContent = on ? "In the package" : "Add to package";
        b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }
    });
  }

  function paintTray() {
    if (!picked.length) {
      if (tray) { tray.remove(); tray = null; }
      document.documentElement.classList.remove("shop-on");
      return;
    }
    document.documentElement.classList.add("shop-on");
    if (!tray) {
      tray = document.createElement("aside");
      tray.className = "shop";
      tray.setAttribute("aria-label", "Your package");
      document.body.appendChild(tray);
      tray.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest("[data-clear]") || e.target.closest("[data-unpick]")) return;
        if (e.target.closest("[data-fold]")) { e.preventDefault(); tray.classList.toggle("is-open"); }
      });
      tray.addEventListener("click", function (e) {
        var rm = e.target.closest("[data-unpick]");
        if (rm) { toggle(rm.getAttribute("data-unpick")); return; }
        if (e.target.closest("[data-clear]")) {
          var last = picked.slice();
          picked = []; save(); paint();
          var toast = document.createElement("div");
          toast.className = "shop__undo";
          toast.innerHTML = 'Package emptied. <button type="button">Undo</button>';
          document.body.appendChild(toast);
          var tid = setTimeout(function () { toast.remove(); }, 6000);
          toast.querySelector("button").addEventListener("click", function () {
            clearTimeout(tid); toast.remove();
            picked = last; save(); paint();
          });
          return;
        }
        if (e.target.closest("[data-fold]")) { tray.classList.toggle("is-open"); return; }
      });
      requestAnimationFrame(function () { tray.classList.add("is-in"); });
    }
    var t = totals(), open = tray.classList.contains("is-open");
    var rows = picked.map(function (id) {
      var it = items[id];
      return '<li>' + it.n + "<b>" + (it.m === "from" ? "from " : "") + money(it.p) + (it.m === "mo" ? "/mo" : "") + "</b>"
        + '<button type="button" data-unpick="' + id + '" aria-label="Remove ' + it.n + '">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'
        + "</button></li>";
    }).join("");
    var rung = t.off === 0 ? "add one more for 5% off"
      : t.off === 5 ? "5% off &middot; one more = 10%"
      : t.off === 10 ? "10% off &middot; one more = 15%"
      : "15% off &middot; the ceiling";
    var headSum = (t.once || t.flat ? (t.from ? "from " : "") + money(t.onceOff) : "")
      + (t.mo ? (t.once || t.flat ? " +" : "") + money(t.moOff) + "/mo" : "");
    var clipped = picked.length > 5 ? '<li class="shop__more">&hellip;and ' + (picked.length - 5) + " more in the list</li>" : "";
    tray.innerHTML =
      '<div class="shop__head" data-fold role="button" tabindex="0" aria-live="polite">'
      + "<b>Your package &middot; " + picked.length + "</b>"
      + '<span class="shop__headsum">' + headSum + "</span>"
      + "<span>" + rung + "</span>"
      + '<button type="button" class="shop__clear" data-clear aria-label="Empty the package">Empty</button>'
      + '<svg class="shop__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      + "</div>"
      + '<div class="shop__body">'
      + "<ul>" + rows + clipped + "</ul>"
      + '<div class="shop__sum">'
      + (t.once || t.flat ? "<p><span>One-time</span><b>" + (t.from ? "from " : "") + money(t.onceOff) + "</b>"
          + (t.off && t.once ? "<s>" + money(t.once + t.flat) + "</s>" : "") + "</p>" : "")
      + (t.flat ? '<p class="shop__flatline"><span>Includes the Teardown &middot; credits in full</span><b>$585</b></p>' : "")
      + (t.mo ? "<p><span>Monthly</span><b>" + money(t.moOff) + "/mo</b>"
          + (t.off ? "<s>" + money(t.mo) + "/mo</s>" : "") + "</p>" : "")
      + (t.off ? '<p class="shop__save"><span>The package saves you</span><b>' + money(t.savesOnce)
          + (t.savesMo >= 1 ? " now + " + money(t.savesMo) + "/mo" : "") + "</b></p>" : "")
      + "</div>"
      + '<a class="btn btn--ruby shop__cta" data-book href="#book" data-cta="shop-book">Book a call with me</a>'
      + "</div>";
    tray.classList.toggle("is-open", open);
  }

  function paint() { paintCards(); paintTray(); }

  function toggle(id) {
    var i = picked.indexOf(id);
    if (i > -1) picked.splice(i, 1); else picked.push(id);
    save(); paint();
    if (window.MCC_TRACK) window.MCC_TRACK("shop_toggle", { id: id, count: picked.length, off: pct() });
  }

  function boot() {
    var cards = document.querySelectorAll("[data-shop]");
    if (!cards.length) return;
    [].forEach.call(cards, function (card) {
      /* rescan() re-runs this after the ledger paints the rate lines, so a
         card that already carries its button is skipped rather than doubled */
      if (card.querySelector(".shop__add")) return;
      var it = {
        id: card.getAttribute("data-shop"),
        n: card.getAttribute("data-shop-n"),
        p: +card.getAttribute("data-shop-p"),
        m: card.getAttribute("data-shop-m") || "once",
      };
      items[it.id] = it;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "shop__add";
      b.textContent = "Add to package";
      b.addEventListener("click", function () { toggle(it.id); });
      card.appendChild(b);
    });
    load();
    paint();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  var NEEDMAP = {
    "photo-event": "Photography", "photo-portrait": "Photography",
    "photo-half": "Photography", "photo-full": "Photography",
    "vid-half": "Video / brand film", "vid-full": "Video / brand film",
    "brand-film": "Video / brand film", "music-video": "Video / brand film",
    "event-film": "Video / brand film",
    "web-build": "Web design / build", "hosting": "Web design / build",
    "webmgmt": "Web design / build", "social": "Social media management",
    "sync": "Music / original scoring", "scoring": "Music / original scoring",
    "jingle": "Music / original scoring", "teardown": "Creative direction",
  };
  function needs() {
    var out = [];
    picked.forEach(function (id) {
      var n = NEEDMAP[id];
      if (n && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }
  /* The rate lines are rendered from data/offers.json AFTER DOMContentLoaded,
     so the page that owns them calls rescan() once they exist. boot() skips
     anything already wired, which makes rescan safe to call repeatedly. */
  window.MCC_SHOP = { summary: summary, count: function () { return picked.length; },
    discount: pct, needs: needs, rescan: boot };
})();
