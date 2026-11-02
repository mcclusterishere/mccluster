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
  var OWN_SRC = (d.currentScript && d.currentScript.src) || "", STAMP = (OWN_SRC.match(/[?&]v=([^&]+)/) || [])[1] || "";

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
        var b = null; try { b = t ? JSON.parse(t) : null; } catch (_) {}
        if (!r.ok) throw Object.assign(new Error((b && (b.message || b.error)) || t || ("HTTP " + r.status)), { status: r.status, body: b });
        return b;
      });
    });
  }
  /* REVISIONS. Every slot write carries the revision it was read at (site_content_v2 through
     js/editor-revisions.js). A slot that changed under the hand typing in it is not overwritten:
     the page says so and keeps what was typed on screen until it is reloaded. Where that RPC is
     not installed, the legacy RPCs remain, but only after the slot's updated_at is read back. */
  /* the shared client is loaded here (owner-only code on 60+ pages), not wired into every page */
  var loadingV2 = null;
  function V2() { return w.MCC_EDITOR_V2 || null; }
  function ensureV2() {
    if (V2()) return Promise.resolve(V2());
    if (!loadingV2) loadingV2 = new Promise(function (resolve) {
      var sc = d.createElement("script"); sc.src = OWN_SRC.replace(/[^/]*$/, "") .replace(/\?.*$/, "") + "editor-revisions.js" + (STAMP ? "?v=" + STAMP : "");
      sc.onload = function () { resolve(V2()); }; sc.onerror = function () { resolve(null); }; d.head.appendChild(sc);
    });
    return loadingV2;
  }
  function slotClient(slot) { var v = V2(); return v ? v.site(rpc, PAGE, slot) : null; }
  function publicRow(slot) {
    return fetch(SB + "/rest/v1/site_content?select=updated_at&page=eq." + encodeURIComponent(PAGE) + "&slot=eq." + encodeURIComponent(slot) + "&limit=1", { headers: { apikey: KEY }, cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (rows) { var row = Array.isArray(rows) && rows[0]; return row ? row.updated_at || null : null; });
  }
  /* the slot's head when editing begins: {revision} from v2, or {legacy:true, updated_at} */
  /* the slot's head: {revision} from v2; {legacy:true} ONLY on the contract's PGRST202 signal; otherwise the error is
     kept and every write for that slot is refused (fail closed) until it is opened again */
  function openSlot(slot) {
    return ensureV2().then(function (v) {
      var c = slotClient(slot);
      if (!c) throw Object.assign(new Error("the revision client could not be loaded"), { status: 0 });
      return c.read().then(function (r) { if (!v.wellFormed(r)) throw Object.assign(new Error("malformed"), { malformed: true, status: 200 }); return { revision: r.revision, protected: !!r.protected, snapshot: r.snapshot }; }).catch(function (err) {
        var cl = v.classify(err);
        if (v.legacyAllowed(cl, null)) return publicRow(slot).then(function (at) { return { legacy: true, updated_at: at }; });
        throw err;
      });
    });
  }
  function explain(err, what) { var v = V2(); return v ? v.explain(v.classify(err), what) : (err.message || String(err)); }
  function isConflict(err) { var v = V2(); return v ? v.classify(err).kind === "conflict" : (err && err.status === 409); }

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

  var heads = {};   /* slot → head read when its edit began */
  function beginEdit(node) {
    if (current) return;
    current = node;
    node.setAttribute("data-mcc-editing", "1");
    node.contentEditable = "true";
    node.focus();
    d.getElementById("mccEditRevert").hidden = false;
    say(node.getAttribute("data-edit") ? "tagged slot" : "position-keyed — may drift");
    var slot = slotFor(node);
    heads[slot] = null;
    openSlot(slot).then(function (h) { heads[slot] = h; if (current === node) say((h.legacy ? "" : "rev " + h.revision + " · ") + (node.getAttribute("data-edit") ? "tagged slot" : "position-keyed — may drift")); })
      .catch(function (e) { heads[slot] = { error: e }; if (current === node) say("cannot save: " + explain(e, "opened").slice(0, 60)); });

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
      var head = heads[slot];
      if (!head || head.error) { say(head ? "not saved: the versioned editor could not be reached (" + explain(head.error, "saved").slice(0, 50) + "); your words stay on screen until you reload" : "not saved: still reading the slot; tap it again"); return; } /* fail closed; typed words are left in place */
      say("saving…");
      var data = { value: after, kind: "text",
        /* original is what SHIPPED, so it is only meaningful the first time; the function keeps the first one it is given. */
        original: node.getAttribute("data-original") || before, fragile: !node.getAttribute("data-edit") };
      var write = head.legacy
        ? publicRow(slot).then(function (at) { if ((at || null) !== (head.updated_at || null)) throw Object.assign(new Error("changed elsewhere"), { status: 409, body: { code: "conflict" } });
            return rpc("site_content_set", { p_page: PAGE, p_slot: slot, p_value: after, p_kind: "text", p_original: data.original, p_fragile: data.fragile, p_via: "editor" }); })
        : slotClient(slot).save(head.revision, data);
      write.then(function (v) { say(v && typeof v.revision === "number" ? "saved · rev " + v.revision : "saved"); setTimeout(function () { say(""); }, 1500); })
        .catch(function (e) {
          if (isConflict(e)) { say("not saved: changed elsewhere — reload, then edit again"); return; } /* what was typed stays on screen */
          node.textContent = before; say("failed: " + explain(e, "saved").slice(0, 60));
        });
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
    var node = current, slot = slotFor(node), head = heads[slot];
    if (!head || head.error) { say(head ? "not reverted: the slot could not be read" : "not reverted: still reading the slot"); return; }
    var write = head.legacy
      ? publicRow(slot).then(function (at) { if ((at || null) !== (head.updated_at || null)) throw Object.assign(new Error("changed elsewhere"), { status: 409, body: { code: "conflict" } }); return rpc("site_content_revert", { p_page: PAGE, p_slot: slot }); })
      : slotClient(slot).reset(head.revision);
    write.then(function () { say("reverted — reload to see the original"); })
      .catch(function (e) { say(isConflict(e) ? "not reverted: changed elsewhere — reload first" : "failed: " + explain(e, "reverted").slice(0, 60)); });
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
