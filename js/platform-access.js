/* PLATFORM ACCESS — what a workspace may use right now, read from the server's projection, never inferred.

   Contract (docs/productization/20261102-trial/WORKER-CONTRACT.md, default-off behind CREATOR_DOMAIN_TRIAL_ENABLED):
     GET  /v2/platform/apps/{app_key}/access?org_id={uuid}            → the capability projection
     POST /v2/platform/domain-trials/{order_uuid}/cancel {org_id}     → cancels an included trial, idempotent
   The projection is the truth: base_manage is the owner's existing control, advanced and white_label each say
   allowed:true/false with the server's reason; the trial and the annual domain registration have DIFFERENT
   expiries; hosting is explicitly unresolved. Nothing here grants, pays, renews or converts. When the route is not
   enabled (503 module_contract_unconfigured) that is said plainly.

   Mounted by customer-site.js (read) and customer-domain-purchases.js (read + cancel). Vanilla script, one object. */
(function (w, d) {
  "use strict";
  var API = "https://api.mccluster.org", UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function el(tag, text, cls) { var n = d.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; }
  function when(iso) { if (!iso) return ""; var x = new Date(iso); return isNaN(x) ? "" : x.toLocaleString(); }
  function day(iso) { if (!iso) return ""; var x = new Date(iso); return isNaN(x) ? "" : x.toLocaleDateString(); }
  /* the server's reason words, said in the owner's words; unknown reasons are shown as they are */
  var REASONS = {
    existing_owner_control: "yours already: your account, your sites and your drafts stay under your control",
    included_trial: "included with your verified domain registration, for one month",
    mapped_paid_subscription: "covered by an active paid subscription for this app",
    not_granted: "no included trial has been recorded for this workspace",
    pending: "the included trial has not started yet",
    expired: "the included trial has ended; your site, data and control are kept",
    cancelled: "the included trial was cancelled; your site, data and control are kept",
    registration_blocked: "the domain order is not fulfilled (refund or reconciliation pending), so the included trial is paused",
    trial_disabled: "included trials are not switched on by McCluster yet",
    module_disabled: "this app is switched off in the catalogue",
    unentitled: "not included; this is a separately purchasable module",
    economics_policy_unresolved: "hosting terms are not decided yet: nothing here promises funded hosting"
  };
  function reasonText(code) { return REASONS[code] || String(code || "").replace(/_/g, " "); }

  function request(token, path, opts) {
    opts = opts || {};
    return fetch(API + path, { method: opts.method || "GET", headers: Object.assign({ authorization: "Bearer " + token, accept: "application/json" }, opts.body ? { "content-type": "application/json" } : {}), body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store", signal: opts.signal })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (b) { return { ok: r.ok, status: r.status, data: b }; }); })
      .catch(function () { return { ok: false, status: 0, data: null }; });
  }
  function access(token, appKey, orgId, signal) {
    if (!UUID.test(orgId || "") || !/^[a-z0-9][a-z0-9._-]{1,99}$/.test(appKey || "")) return Promise.resolve({ ok: false, status: 400, data: { code: "invalid_module_scope" } });
    return request(token, "/v2/platform/apps/" + encodeURIComponent(appKey) + "/access?org_id=" + encodeURIComponent(orgId), { signal: signal });
  }
  function cancel(token, orderId, orgId) {
    if (!UUID.test(orderId || "") || !UUID.test(orgId || "")) return Promise.resolve({ ok: false, status: 400, data: { code: "invalid_cancel_scope" } });
    return request(token, "/v2/platform/domain-trials/" + encodeURIComponent(orderId) + "/cancel", { method: "POST", body: { org_id: orgId } });
  }
  function apps(signal) { return request("", "/v1/apps", { signal: signal }).then(function (r) { return r.ok && r.data && Array.isArray(r.data.apps) ? r.data.apps : null; }); }

  /* One capability line: the name, allowed or not, and why. Unentitled advanced/white-label is shown greyed, not hidden. */
  function capabilityRow(name, cap) {
    var row = el("div", "", "pa-cap" + (cap && cap.allowed === true ? " is-allowed" : " is-denied"));
    row.setAttribute("role", "listitem");
    row.appendChild(el("b", name));
    row.appendChild(el("span", cap && cap.allowed === true ? "Available" : "Not available", "pa-cap__state"));
    row.appendChild(el("small", reasonText(cap && cap.reason)));
    return row;
  }
  /* The projection as a card. `onCancel(orderId)` is supplied where cancellation is offered; the trial's order is
     not part of this projection (backend request recorded), so the caller passes the order ids it can see. */
  function render(container, result, opts) {
    opts = opts || {};
    container.replaceChildren();
    if (result.status === 503 && result.data && /unconfigured/.test(result.data.code || "")) { container.appendChild(el("p", "Platform access checks are not switched on for this site yet. Your account, your sites and your drafts are unaffected.", "pa-note")); return; }
    if (result.status === 401) { container.appendChild(el("p", "Sign in again to check this workspace's access.", "pa-note")); return; }
    if (result.status === 403) { container.appendChild(el("p", "This workspace is not yours to check, or your identity is not active.", "pa-note")); return; }
    if (result.status === 404) { container.appendChild(el("p", "This app is not in the catalogue.", "pa-note")); return; }
    if (!result.ok || !result.data || !result.data.capabilities) { container.appendChild(el("p", "Access could not be checked. Nothing has been assumed; try again.", "pa-note")); return; }
    var p = result.data, caps = p.capabilities, trial = p.trial || {}, domain = p.domain || {}, hosting = p.hosting || {};
    var list = el("div", "", "pa-caps"); list.setAttribute("role", "list");
    list.appendChild(capabilityRow("Site management", caps.base_manage));
    list.appendChild(capabilityRow("Advanced modules", caps.advanced));
    list.appendChild(capabilityRow("White-label", caps.white_label));
    container.appendChild(list);
    var t = el("p", "", "pa-trial");
    t.textContent = trial.state === "active" ? "Included platform month: active until " + when(trial.expires_at) + "."
      : trial.state === "pending" ? "Included platform month: starts " + when(trial.starts_at) + "."
      : trial.state === "expired" ? "Included platform month ended " + when(trial.expires_at) + ". Your site, data and control are kept; advanced modules are off unless purchased."
      : trial.state === "cancelled" ? "Included platform month cancelled " + when(trial.cancelled_at) + ". Your site, data and control are kept."
      : trial.state === "registration_blocked" ? "Included platform month paused: the domain order is " + String(domain.registration_state || "not fulfilled").replace(/_/g, " ") + "."
      : "No included platform month recorded for this workspace.";
    container.appendChild(t);
    if (domain.hostname) container.appendChild(el("p", "Domain " + domain.hostname + ": registered " + day(domain.registered_at) + ", for its paid term until " + day(domain.expires_at) + " (" + String(domain.registration_state || "").replace(/_/g, " ") + "). The annual registration does not end with the platform month.", "pa-domain"));
    container.appendChild(el("p", "Hosting: " + reasonText(hosting.reason) + ".", "pa-hosting"));
    if (p.automatic_paid_conversion === false) container.appendChild(el("p", "No automatic paid conversion: nothing is charged when the month ends.", "pa-note"));
    if (opts.onCancel && (trial.state === "active" || trial.state === "pending" || trial.state === "registration_blocked")) {
      var row = el("div", "", "pa-actions");
      if (opts.orderIds && opts.orderIds.length) {
        var sel = el("select"); sel.setAttribute("aria-label", "Domain order the included month came with");
        opts.orderIds.forEach(function (id) { var o = el("option", "Order " + id); o.value = id; sel.appendChild(o); });
        sel.value = opts.orderIds[0];
        row.appendChild(sel);
        var b = el("button", "Cancel the included platform month", "site-action"); b.type = "button";
        b.onclick = function () {
          if (!w.confirm("Cancel the included platform month for this workspace? Advanced modules stop at once. Your domain registration, your site, your data and any separate paid subscription are not cancelled.")) return;
          b.disabled = true; opts.onCancel(sel.value).then(function () { b.disabled = false; });
        };
        row.appendChild(b);
      } else row.appendChild(el("p", "To cancel the included month, open your domain purchases and cancel from the order it came with.", "pa-note"));
      container.appendChild(row);
    }
  }
  w.MCC_PLATFORM_ACCESS = { access: access, cancel: cancel, apps: apps, render: render, reasonText: reasonText };
})(window, document);
