/* REVISION-AWARE EDITING, shared by every editor entry point.

   One place for the contract every writer must honour once a record is enrolled in the versioned editor
   (docs/productization/20261102-v2/API.md): every mutation carries the revision it was based on; a stale
   revision is a 409 that keeps the local draft and asks for a deliberate decision; a lost response is read
   back before anything is retried; restore is a new audited revision, never a republish; and nothing here
   ever falls back to a blind legacy write once the versioned API has answered.

   Two authorities, two transports:
   - owned websites (personal front, project front): Worker `/v2/fronts|projects/{key}/…` with the account's
     own bearer (workers/mccluster/src/editor-versioned.js);
   - Control homepage and inline page text: Supabase RPC `site_content_v2` with the admin's own bearer.
   The caller supplies the transport (its existing api()/rpc() function), so session guards stay where they are.

   The status vocabulary (classify) is the one the UI shows: conflict / signin / forbidden / notfound /
   unconfigured / network / invalid / toolarge / other. */
(function (w) {
  "use strict";

  function status(err) { return err && typeof err.status === "number" ? err.status : 0; }
  function text(v) { return String(v == null ? "" : v); }

  /* What happened, in words the editor can act on. `unconfigured` means the versioned API is not switched
     on for this deployment (503 code unconfigured): the only case where the legacy path remains the path. */
  function classify(err) {
    var s = status(err), body = err && err.body, code = text(body && body.code || err && err.code || "");
    var msg = text(body && (body.error || body.message) || err && err.message || "");
    var tag = (code + " " + msg).toLowerCase();
    if (s === 409 || /conflict|pt409|40001/.test(tag)) return { kind: "conflict", code: code || "conflict", status: s };
    if (s === 401 || /signin/.test(tag)) return { kind: "signin", code: code || "signin", status: s };
    if (s === 403 || /42501|forbidden|not_authorized|private_profile|editor_removed|not_owner_withdrawn/.test(tag)) return { kind: "forbidden", code: code || "forbidden", status: s, reason: reason(tag) };
    if (s === 404 || /p0002|not_found/.test(tag)) return { kind: "notfound", code: code || "notfound", status: s };
    if (s === 503 && /unconfigured|not enabled/.test(tag)) return { kind: "unconfigured", code: "unconfigured", status: s };
    if (s === 413 || /too_large/.test(tag)) return { kind: "toolarge", code: "too_large", status: s };
    if (s === 400 || /22023|invalid/.test(tag)) return { kind: "invalid", code: code || "invalid", status: s };
    if (!s) return { kind: "network", code: "network", status: 0 };
    return { kind: "other", code: code || ("http_" + s), status: s };
  }
  function reason(tag) {
    if (/private_profile/.test(tag)) return "private_profile";
    if (/editor_removed|\bremoved\b/.test(tag)) return "removed";
    if (/not_owner_withdrawn/.test(tag)) return "not_owner_withdrawn";
    if (/protected_presentation|use_tile/.test(tag)) return "protected_presentation";
    return "";
  }

  function same(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; } }

  /* ---------- owned websites: personal front or project front through the Worker ---------- */
  /* api(path, {method, body}) is the caller's own function: it attaches the session, guards account switches and
     rejects with {status, body}. kind is "fronts" (key "me", or a handle for house-owner moderation) or "projects". */
  function owned(api, kind, key) {
    var base = "/v2/" + kind + "/" + encodeURIComponent(key);
    function post(op, body) { return api(base + "/" + op, { method: "POST", body: body }); }
    var client = {
      base: base,
      read: function () { return api(base + "/edit"); },
      history: function () { return api(base + "/history"); },
      save: function (expected, config, publish) { return post("edit", { expected_revision: expected, config: config, publish: publish === true }); },
      restore: function (expected, restoreRevision) { return post("restore", { expected_revision: expected, restore_revision: restoreRevision }); },
      unpublish: function (expected) { return post("unpublish", { expected_revision: expected }); },
      withdraw: function (expected) { return post("withdraw", { expected_revision: expected }); },
      recover: function (expected) { return post("recover", { expected_revision: expected }); },
      takedown: function (expected, why) { return post("takedown", { expected_revision: expected, reason: text(why).slice(0, 300) }); },
      /* After a response was lost: was the mutation committed? Read the record back and compare.
         - revision === expected: nothing happened; the same request may be sent again unchanged.
         - revision === expected + 1 and the snapshot carries what was sent: committed; adopt it.
         - anything else: another writer got there (or more happened); never assume. */
      reconcile: function (attempt) { return client.read().then(function (now) { return reconcile(now, attempt); }); }
    };
    return client;
  }
  function reconcile(now, attempt) {
    var rev = now && typeof now.revision === "number" ? now.revision : null, snap = now && now.snapshot || {};
    if (rev === null) return { outcome: "unknown", current: now };
    if (rev === attempt.expected) return { outcome: "not_committed", current: now };
    if (rev === attempt.expected + 1) {
      var fits = attempt.action === "save" || attempt.action === "publish" ? same(snap.draft, attempt.config)
        : attempt.action === "unpublish" ? snap.published == null
        : attempt.action === "withdraw" ? !!snap.removed_at
        : attempt.action === "recover" ? !snap.removed_at
        : attempt.action === "restore" ? same(snap.draft, attempt.config) : true;
      return { outcome: fits ? "committed" : "unknown", current: now };
    }
    return { outcome: "unknown", current: now };
  }

  /* ---------- Control content: one page/slot through the site_content_v2 RPC ---------- */
  /* rpc(fn, body) is the caller's own function (admin bearer, apikey) rejecting with {status, body}. */
  function site(rpc, page, slot) {
    function call(action, expected, data, restore) {
      return rpc("site_content_v2", { p_page: page, p_slot: slot, p_action: action, p_expected: expected == null ? null : expected, p_data: data == null ? null : data, p_restore: restore == null ? null : restore });
    }
    var client = {
      page: page, slot: slot,
      read: function () { return call("read"); },
      history: function () { return call("history"); },
      /* data: {value, kind:"text", original:"", fragile:false} — the row's own editable fields, nothing else */
      save: function (expected, data) { return call("save", expected, data); },
      restore: function (expected, restoreRevision) { return call("restore", expected, null, restoreRevision); },
      reset: function (expected) { return call("reset", expected); },
      reconcile: function (attempt) {
        return client.read().then(function (now) {
          var rev = now && typeof now.revision === "number" ? now.revision : null, snap = now && now.snapshot;
          if (rev === null) return { outcome: "unknown", current: now };
          if (rev === attempt.expected) return { outcome: "not_committed", current: now };
          if (rev === attempt.expected + 1) {
            var fits = attempt.action === "save" ? !!snap && text(snap.value) === text(attempt.data && attempt.data.value)
              : attempt.action === "reset" ? snap == null : true;
            return { outcome: fits ? "committed" : "unknown", current: now };
          }
          return { outcome: "unknown", current: now };
        });
      }
    };
    return client;
  }

  /* The sentence an editor shows for a classified failure. `what` names the action ("saved", "published"…). */
  function explain(c, what) {
    switch (c.kind) {
      case "conflict": return "Not " + what + ": this page changed somewhere else since you opened it. Your edits are kept here. Review the latest saved version, then decide what to keep.";
      case "signin": return "Not " + what + ": you are signed out. Sign in again; your edits stay on this screen.";
      case "forbidden": return c.reason === "private_profile" ? "Not " + what + ": your profile is private. Set it public first; your draft is kept."
        : c.reason === "removed" ? "Not " + what + ": McCluster took this page down. You can keep editing your draft."
        : c.reason === "not_owner_withdrawn" ? "This project was not withdrawn by you here, so it cannot be recovered from this screen."
        : c.reason === "protected_presentation" ? "Not " + what + ": this project has a protected presentation; switch it first."
        : "Not " + what + ": you are not allowed to change this.";
      case "notfound": return "Not " + what + ": this page is not yours, or it no longer exists.";
      case "unconfigured": return "Versioned saving is not switched on for this site yet.";
      case "toolarge": return "Not " + what + ": the settings are larger than this page allows.";
      case "invalid": return "Not " + what + ": a setting was refused by the server.";
      case "network": return "Not confirmed: the connection dropped before an answer came back. Checking what was saved…";
      default: return "Not " + what + ": the server could not do it (" + (c.code || "error") + ").";
    }
  }

  w.MCC_EDITOR_V2 = { owned: owned, site: site, classify: classify, explain: explain, reconcile: reconcile, same: same };
})(window);
