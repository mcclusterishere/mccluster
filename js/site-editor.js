/* ============================================================
   THE SITE EDITOR — change any page, on the page, from a phone.

   Owner only. Press the pencil, tap any text, type, done. No deploy, no
   git, no laptop. Reorder sections, hide them, put them back.

   IT EDITS THE OVERRIDE, NEVER THE FILE. The HTML in git stays exactly
   as shipped, so Revert is a delete and always lands somewhere real.
   That matters more than usual here, because the model on the VPS writes
   through the same table: an undo that depends on the model being right
   is not an undo.

   WHAT IT REFUSES TO EDIT: anything inside the app bar. js/tabbar.js is
   locked by the owner's instruction, and an editor that can quietly
   rewrite the navigation is one bad tap from an unusable site.
   ============================================================ */
(function (w, d) {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var OWNER = "matthew@mccluster.org";
  var PAGE = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  function session() {
    try { return JSON.parse(localStorage.getItem("mccdb_session") || "null"); }
    catch (e) { return null; }
  }
  function emailOf(s) {
    if (s && s.user && s.user.email) return s.user.email;
    try {
      var b = s && s.access_token && s.access_token.split(".")[1];
      if (!b) return "";
      var p = b.replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4) p += "=";
      return (JSON.parse(atob(p)) || {}).email || "";
    } catch (e) { return ""; }
  }

  var S = session();
  if (String(emailOf(S)).toLowerCase() !== OWNER) return;

  /* Off limits, permanently. */
  var LOCKED = ".appbar, .mcc-auth-chip, .cmdk, .cmdk-hint, #mccEditBar, script, style, svg";

  function rpc(fn, body) {
    return fetch(SB + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: KEY, authorization: "Bearer " + S.access_token,
                 "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error(t || ("HTTP " + r.status));
        return t ? JSON.parse(t) : null;
      });
    });
  }

  var on = false, current = null;

  var bar = d.createElement("div");
  bar.id = "mccEditBar";
  bar.innerHTML =
    '<button type="button" id="mccEditToggle" class="mccEd__btn mccEd__btn--go">Edit page</button>' +
    '<span class="mccEd__say" id="mccEditSay"></span>' +
    '<button type="button" id="mccEditRevert" class="mccEd__btn" hidden>Revert this</button>';
  d.body.appendChild(bar);

  var css = d.createElement("style");
  css.textContent =
    "#mccEditBar{position:fixed;left:50%;transform:translateX(-50%);z-index:8000;" +
      "bottom:calc(10.2rem + env(safe-area-inset-bottom,0px));display:flex;gap:.5rem;align-items:center;" +
      "max-width:calc(100vw - 1.5rem);padding:.5rem .6rem;border-radius:999px;" +
      "background:#191b1e;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 12px 34px rgba(0,0,0,.5);" +
      "font:600 .78rem 'Manrope',system-ui,sans-serif;color:#eceded}" +
    ".mccEd__btn{min-height:40px;border:0;cursor:pointer;border-radius:999px;padding:.5rem .85rem;" +
      "background:#241f20;color:#eceded;font:700 .76rem 'Manrope',system-ui,sans-serif;" +
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}" +
    ".mccEd__btn--go.is-on{background:#e5383b;color:#fff}" +
    ".mccEd__say{color:rgba(236,237,237,.7);max-width:11rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "html.mccEd-on [data-mcc-editable]{outline:1px dashed rgba(229,56,59,.55);outline-offset:2px;cursor:text}" +
    "html.mccEd-on [data-mcc-editable]:hover{outline-color:#e5383b;background:rgba(229,56,59,.07)}" +
    "[data-mcc-editing]{outline:2px solid #e5383b !important;background:rgba(229,56,59,.1)}";
  d.head.appendChild(css);

  var say = function (t) { d.getElementById("mccEditSay").textContent = t || ""; };

  /* What is worth offering as editable: things that are their own words.
     An element containing other elements is a container, and letting
     someone retype a container replaces its children with a string. */
  function editable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.closest(LOCKED)) return false;
    if (!/^(H1|H2|H3|H4|H5|H6|P|LI|SPAN|STRONG|EM|SMALL|BLOCKQUOTE|FIGCAPTION|LABEL|TD|TH|A|BUTTON|SUMMARY)$/.test(node.tagName)) return false;
    if (node.children.length) return false;
    return (node.textContent || "").trim().length > 0;
  }

  function mark() {
    d.querySelectorAll("*").forEach(function (n) {
      if (editable(n)) n.setAttribute("data-mcc-editable", "1");
      else n.removeAttribute("data-mcc-editable");
    });
  }

  function slotFor(node) {
    return node.getAttribute("data-edit") || w.MCC_SLOT_PATH(node);
  }

  function beginEdit(node) {
    if (current) return;
    current = node;
    node.setAttribute("data-mcc-editing", "1");
    node.contentEditable = "true";
    node.focus();
    d.getElementById("mccEditRevert").hidden = false;
    say(node.getAttribute("data-edit") ? "tagged slot" : "position-keyed — may drift");

    var before = node.textContent;
    function finish(save) {
      node.removeAttribute("data-mcc-editing");
      node.contentEditable = "false";
      node.removeEventListener("blur", onBlur);
      node.removeEventListener("keydown", onKey);
      var after = node.textContent;
      current = null;
      d.getElementById("mccEditRevert").hidden = true;
      if (!save || after === before) { node.textContent = before; say(""); return; }
      say("saving…");
      rpc("site_content_set", {
        p_page: PAGE, p_slot: slotFor(node), p_value: after,
        p_kind: "text",
        /* original is what SHIPPED, so it is only meaningful the first
           time; the function keeps the first one it is given. */
        p_original: node.getAttribute("data-original") || before,
        p_fragile: !node.getAttribute("data-edit"),
        p_via: "editor"
      }).then(function () { say("saved"); setTimeout(function () { say(""); }, 1500); })
        .catch(function (e) { node.textContent = before; say("failed: " + e.message.slice(0, 40)); });
    }
    function onBlur() { finish(true); }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
      if (e.key === "Enter" && node.tagName !== "P" && node.tagName !== "BLOCKQUOTE") {
        e.preventDefault(); node.blur();
      }
    }
    node.addEventListener("blur", onBlur);
    node.addEventListener("keydown", onKey);
  }

  d.getElementById("mccEditToggle").addEventListener("click", function () {
    on = !on;
    this.classList.toggle("is-on", on);
    this.textContent = on ? "Done" : "Edit page";
    d.documentElement.classList.toggle("mccEd-on", on);
    if (on) { mark(); say("tap any text"); } else { say(""); }
  });

  d.getElementById("mccEditRevert").addEventListener("click", function () {
    if (!current) return;
    var node = current, slot = slotFor(node);
    rpc("site_content_revert", { p_page: PAGE, p_slot: slot })
      .then(function () { say("reverted — reload to see the original"); })
      .catch(function (e) { say("failed: " + e.message.slice(0, 40)); });
  });

  d.addEventListener("click", function (e) {
    if (!on || current) return;
    var node = e.target.closest("[data-mcc-editable]");
    if (!node) return;
    /* In edit mode a link is a thing to rewrite, not to follow. */
    e.preventDefault(); e.stopPropagation();
    beginEdit(node);
  }, true);

  w.MCC_EDITOR = { on: function () { return on; }, page: PAGE };
})(window, document);
