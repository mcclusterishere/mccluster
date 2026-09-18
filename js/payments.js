/* ============================================================
   Payment links: ONE register for the cause.
   Everything outside the three main offerings (the Limited Offer,
   web builds, and photo/video day bookings) is a SUGGESTED
   contribution through the nonprofit's live mission-fund link.
   One link, one ledger, every button live. `suggest` is the
   suggested amount shown on the button; givers set their own.
   ============================================================ */

var MCC_DONATE = "https://square.link/u/MBVeuzoo?src=sheet";

window.PAYMENTS = {
  "whodidtheshoot": {
    title: "Who Did The Shoot",
    page: "song-who-did-the-shoot.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "antisocial": {
    title: "Antisocial",
    page: "song-antisocial.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "environmental-injustice": {
    title: "Environmental Injustice",
    page: "song-environmental-injustice.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "gotwifi": {
    title: "Got WiFi",
    page: "song-got-wifi.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "vaunt": {
    title: "Vaunt (Acoustic)",
    page: "song-vaunt.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "dealerplates": {
    title: "Dealer Plates (A-Side)",
    page: "song-dealer-plates.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "subscribe": {
    title: "Back the catalogue",
    link: MCC_DONATE,
    label: "Back the catalogue \u00b7 any amount",
  },
  // The $20 identifier walkthrough (Square payment link). After purchase,
  // send buyers the unlisted walkthrough page.
  "idguide": {
    title: "Identifier Resource Pack",
    link: MCC_DONATE,
    label: "Give what's fair \u00b7 get the pack",
  },
  // The mission fund: live Square link (nonprofit). Hero, footer, and
  // the Equity Uprise pages all point here. Support / contribution
  // language only, no tax wording on the site or in the Square copy.
  "donate": {
    title: "Support the Mission",
    link: "https://square.link/u/MBVeuzoo?src=sheet",
  },
  // Square Appointments booking page for the paid inquiry call:
  // Dashboard → Appointments → create a paid "Inquiry Call" service with
  // prepayment required, then paste the online booking URL here.
  "bookcall": {
    title: "Book a Paid Call",
    link: "",
  },
};

/* ============================================================
   THE SINGLE-SELLER RAIL. The marketplace kit is gone.

   What used to live here: Stripe Connect Express onboarding
   (connectOnboard), provider ID verification (verifyId), destination
   charges to provider accounts (payDeal), payee rail resolution
   (rail), and the 10% seller-vs-buyer spread (RATE / quote / net).
   All of it removed from the customer-facing application per the
   single-operator model: McCluster is the only seller, and every
   charge starts from a controlled offering.

   Checkout now runs offering-first: the browser names a slug, the
   checkout edge function reads the offerings table for the
   authoritative price, seller, and provider (see
   supabase/migrations/0007_offerings.sql and
   supabase/functions/checkout). No publishable key ships here;
   Stripe-hosted checkout needs none, and the old pk_test never
   belonged in production.
   ============================================================ */
window.MCC_STRIPE = { HOUSE: { "mccluster": 1, "equity-uprise": 1 } };

/* ============================================================
   ACCOUNT-GATED MUSIC.

   The public catalog may carry a short preview URL. The master is
   fetched only after Supabase validates a live McCluster account;
   the browser receives it as an in-memory object URL, never as a
   public repository asset. The same authenticated endpoint handles
   downloads. This module is intentionally narrow: one release,
   one existing identity system, no second auth stack.
   ============================================================ */
(function () {
  "use strict";

  var TITLE = "niggy nigg";
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var ENDPOINT = SB_URL + "/functions/v1/song-niggy-nigg";
  var SESSION_KEY = "mccdb_session";
  var KEEP_KEY = "mcc_sess_keep";
  var activeObjectUrl = "";

  function readSession() {
    var raw = null;
    try { raw = localStorage.getItem(SESSION_KEY) || localStorage.getItem(KEEP_KEY); } catch (e) {}
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function saveSession(s) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      localStorage.setItem(KEEP_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function tokenExp(token) {
    try {
      var part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (part.length % 4) part += "=";
      return (JSON.parse(atob(part)).exp || 0) * 1000;
    } catch (e) { return 0; }
  }

  function accessToken() {
    var s = readSession();
    if (!s || !s.access_token) return Promise.resolve(null);
    if (tokenExp(s.access_token) - Date.now() > 60000) return Promise.resolve(s.access_token);
    if (!s.refresh_token) return Promise.resolve(null);
    return fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: SB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (fresh) {
      if (!fresh || !fresh.access_token) return null;
      saveSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token || s.refresh_token });
      return fresh.access_token;
    }).catch(function () { return null; });
  }

  function rowFor(target) {
    var row = target && target.closest ? target.closest("#tracks li[data-title]") : null;
    return row && (row.getAttribute("data-title") || "").toLowerCase() === TITLE ? row : null;
  }

  function accountHref() {
    return "account.html?next=" + encodeURIComponent(location.pathname + location.search);
  }

  function showGate(message) {
    var old = document.getElementById("mccSongGate");
    if (old) old.remove();
    var wrap = document.createElement("div");
    wrap.id = "mccSongGate";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = '<div class="mcc-song-gate__card">' +
      '<button class="mcc-song-gate__x" type="button" aria-label="Close">×</button>' +
      '<p class="mcc-song-gate__eyebrow">McCluster account</p>' +
      '<h2>Unlock the full version</h2>' +
      '<p>' + (message || "The public player carries the preview. Create an account or sign in to hear the full track and download it.") + '</p>' +
      '<a href="' + accountHref() + '">Create account or sign in</a>' +
      '</div>';
    wrap.querySelector(".mcc-song-gate__x").onclick = function () { wrap.remove(); };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  function ensureStyle() {
    if (document.getElementById("mccSongGateStyle")) return;
    var style = document.createElement("style");
    style.id = "mccSongGateStyle";
    style.textContent =
      '.mcc-gated-download{appearance:none;border:1px solid rgba(244,239,230,.25);background:rgba(0,0,0,.24);color:inherit;border-radius:999px;padding:.42rem .62rem;font:800 .61rem/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;white-space:nowrap}' +
      '.mcc-gated-download:hover{border-color:currentColor}.mcc-gated-download[disabled]{opacity:.45;cursor:wait}' +
      '#mccSongGate{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:1.2rem;background:rgba(0,0,0,.78);backdrop-filter:blur(12px)}' +
      '.mcc-song-gate__card{position:relative;width:min(430px,100%);border:1px solid rgba(244,239,230,.2);border-radius:22px;padding:1.5rem;background:#100d0c;color:#f4efe6;box-shadow:0 24px 90px rgba(0,0,0,.55);font-family:system-ui,sans-serif}' +
      '.mcc-song-gate__eyebrow{margin:0 0 .45rem;text-transform:uppercase;letter-spacing:.13em;font-size:.68rem;font-weight:850;opacity:.62}' +
      '.mcc-song-gate__card h2{margin:0 2rem .65rem 0;font-size:1.65rem;line-height:1.05}.mcc-song-gate__card p{line-height:1.55;opacity:.78}' +
      '.mcc-song-gate__card a{display:inline-flex;margin-top:.45rem;border-radius:999px;padding:.78rem 1rem;background:#f4efe6;color:#100d0c;text-decoration:none;font-weight:850}' +
      '.mcc-song-gate__x{position:absolute;right:.8rem;top:.7rem;border:0;background:none;color:inherit;font-size:1.5rem;cursor:pointer}';
    document.head.appendChild(style);
  }

  function fetchMaster(row, replay) {
    if (!row || row.getAttribute("data-mcc-full-ready") === "1") {
      if (replay && row) row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return Promise.resolve(true);
    }
    if (row.getAttribute("data-mcc-loading") === "1") return Promise.resolve(false);
    row.setAttribute("data-mcc-loading", "1");
    return accessToken().then(function (token) {
      if (!token) {
        row.removeAttribute("data-mcc-loading");
        if (replay) showGate();
        return false;
      }
      return fetch(ENDPOINT + "?full=1", {
        headers: { Authorization: "Bearer " + token, apikey: SB_KEY },
        cache: "no-store",
      }).then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error("account");
        if (!r.ok) throw new Error("delivery");
        return r.blob();
      }).then(function (blob) {
        if (activeObjectUrl) try { URL.revokeObjectURL(activeObjectUrl); } catch (e) {}
        activeObjectUrl = URL.createObjectURL(blob);
        row.setAttribute("data-src", activeObjectUrl);
        row.setAttribute("data-mcc-full-ready", "1");
        row.removeAttribute("data-mcc-loading");
        var small = row.querySelector("small");
        if (small) small.firstChild.nodeValue = "full version unlocked · ";
        if (replay) row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      }).catch(function (err) {
        row.removeAttribute("data-mcc-loading");
        if (replay) showGate(err && err.message === "account" ? "Your session needs a fresh sign-in before the full track can be delivered." : "The full track could not be delivered. Sign in again and retry.");
        return false;
      });
    });
  }

  function downloadMaster(button) {
    button.disabled = true;
    var oldText = button.textContent;
    button.textContent = "Loading";
    accessToken().then(function (token) {
      if (!token) throw new Error("account");
      return fetch(ENDPOINT + "?download=1", {
        headers: { Authorization: "Bearer " + token, apikey: SB_KEY },
        cache: "no-store",
      });
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("account");
      if (!r.ok) throw new Error("delivery");
      return r.blob();
    }).then(function (blob) {
      var href = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = href;
      a.download = "niggy-nigg.mp3";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
    }).catch(function (err) {
      showGate(err && err.message === "account" ? "Sign in to download the full track." : "The download could not be delivered. Sign in again and retry.");
    }).finally(function () {
      button.disabled = false;
      button.textContent = oldText;
    });
  }

  function decorate(row) {
    if (!row || row.getAttribute("data-mcc-gated") === "1") return;
    row.setAttribute("data-mcc-gated", "1");
    row.setAttribute("aria-label", TITLE + "; preview available; account required for full playback and download");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "mcc-gated-download";
    button.setAttribute("data-mcc-download", "1");
    button.textContent = "Download";
    row.appendChild(button);
    accessToken().then(function (token) { if (token) fetchMaster(row, false); });
  }

  function scan() {
    var rows = document.querySelectorAll('#tracks li[data-title="' + TITLE + '"]');
    for (var i = 0; i < rows.length; i++) decorate(rows[i]);
  }

  document.addEventListener("click", function (e) {
    var download = e.target && e.target.closest ? e.target.closest("[data-mcc-download]") : null;
    if (download) {
      e.preventDefault();
      e.stopImmediatePropagation();
      downloadMaster(download);
      return;
    }
    var row = rowFor(e.target);
    if (!row || (e.target.closest && e.target.closest("[data-hrt]"))) return;
    if (row.getAttribute("data-mcc-full-ready") === "1") return;
    var s = readSession();
    if (!s || !s.access_token) return; // signed-out listeners receive the public preview
    e.preventDefault();
    e.stopImmediatePropagation();
    fetchMaster(row, true);
  }, true);

  function bootGate() {
    ensureStyle();
    scan();
    var tracks = document.getElementById("tracks");
    if (tracks && window.MutationObserver) new MutationObserver(scan).observe(tracks, { childList: true, subtree: true });
    var deck = document.getElementById("deck");
    if (deck) deck.addEventListener("ended", function () {
      if ((deck.currentSrc || deck.src || "").indexOf("song-niggy-nigg") !== -1) showGate();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootGate);
  else bootGate();
})();
