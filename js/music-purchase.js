/* purchase.html: the page Stripe returns a direct-music buyer to.
   =====================================================================
   ?session_id=cs_...  Stripe's return. music-direct-access "claim" binds the
                       session to the order the server stored for it, fulfils
                       it once, and answers the entitlement token (for 24 hours
                       after payment). The address bar is then rewritten to
                       ?token=..., which is the link the buyer keeps; the
                       session id is not kept anywhere.
   ?token=<uuid>       the kept link: "status" shows what is left, "download"
                       counts one download and opens a short-lived signed URL.
   ?canceled=1         Checkout was left; nothing was charged.
   ===================================================================== */
(function (root) {
  "use strict";
  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var FN = SB + "/functions/v1/music-direct-access";
  var TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
  var $ = function (id) { return document.getElementById(id); };
  var token = null;

  function post(body) {
    return fetch(FN, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "The download service is unavailable right now."); e.status = r.status; throw e; }
          return d;
        });
      });
  }
  function lead(text) { $("ppLead").textContent = text; }
  function status(text, bad) { $("ppStatus").textContent = text || ""; if (bad) $("ppStatus").setAttribute("data-tone", "bad"); else $("ppStatus").removeAttribute("data-tone"); }
  function when(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); }
    catch (_) { return String(iso || ""); }
  }
  function keepLink(t) {
    var url = location.origin + location.pathname + "?token=" + encodeURIComponent(t);
    try { history.replaceState(null, "", "?token=" + encodeURIComponent(t)); } catch (_) {}
    try {
      var list = JSON.parse(localStorage.getItem("mcc_direct_purchases") || "[]");
      if (list.indexOf(t) < 0) { list.unshift(t); localStorage.setItem("mcc_direct_purchases", JSON.stringify(list.slice(0, 50))); }
    } catch (_) {}
    $("ppLink").value = url;
    $("ppLinkBox").hidden = false;
  }
  function show(d) {
    $("ppCard").hidden = false;
    $("ppTitle").textContent = d.title || "Your track";
    var parts = [];
    if (d.max_downloads != null) parts.push(d.downloads_left + " of " + d.max_downloads + " downloads left");
    if (d.expires_at) parts.push("available until " + when(d.expires_at));
    $("ppMeta").textContent = parts.join(" · ");
    var can = !!d.can_download && !!token;
    $("ppDownload").disabled = !can;
    $("ppDownload").hidden = !token;
    if (d.refusal) status(d.refusal.message, true);
  }

  function claim(sessionId, tries) {
    post({ action: "claim", session_id: sessionId }).then(function (d) {
      if (d.state === "processing") {
        if (tries < 15) { lead("Your payment is being confirmed…"); return setTimeout(function () { claim(sessionId, tries + 1); }, 2000); }
        lead("Your payment is still being confirmed. Reload this page in a minute.");
        return;
      }
      if (d.state === "revoked") { $("ppHead").textContent = "Purchase closed"; lead(d.message || "This purchase was refunded."); return; }
      $("ppHead").textContent = "Thank you";
      if (d.token_hidden) { lead(d.message); show(d); return; }
      token = d.token;
      keepLink(token);
      lead("Your purchase is complete. Download your track below.");
      show(d);
    }).catch(function (e) { lead(e.message); });
  }
  function load(t) {
    token = t;
    post({ action: "status", token: t }).then(function (d) {
      $("ppHead").textContent = d.state === "revoked" ? "Purchase closed" : "Your purchase";
      lead(d.state === "revoked" ? "This purchase was refunded or revoked." : "Download your track below.");
      $("ppLink").value = location.href; $("ppLinkBox").hidden = d.state === "revoked";
      show(d);
    }).catch(function (e) { lead(e.message); });
  }

  $("ppDownload").addEventListener("click", function () {
    if (!token) return;
    var b = $("ppDownload");
    b.disabled = true; status("Preparing your download…");
    post({ action: "download", token: token }).then(function (d) {
      status(d.downloads_left + " download" + (d.downloads_left === 1 ? "" : "s") + " left.");
      if (root.MCC_TRACK) root.MCC_TRACK("direct_download", {});
      b.disabled = d.downloads_left <= 0;
      root.location.assign(d.url);
    }).catch(function (e) { status(e.message, true); b.disabled = e.status >= 400 && e.status < 500 && e.status !== 400; });
  });
  $("ppCopy").addEventListener("click", function () {
    var v = $("ppLink").value;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { status("Link copied."); }, function () {
      $("ppLink").select(); status("Select the link and copy it.");
    });
  });

  var q = new URLSearchParams(location.search);
  var t = q.get("token"), s = q.get("session_id");
  if (q.get("canceled")) { $("ppHead").textContent = "Checkout canceled"; lead("Nothing was charged. You can pick the track again whenever you like."); }
  else if (t && TOKEN_RE.test(t)) load(t);
  else if (s && SESSION_RE.test(s)) claim(s, 0);
  else lead("This page shows a purchase after checkout. Open the link from your purchase to download again.");
})(window);
