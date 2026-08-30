/* ============================================================
   THE OFFER LADDER, ON THE DESK.

   The old sites.html lane switch put a plan into the CRM exactly
   one way: it appended ?plan=<slug> to onboard.html, onboard stored
   S.plan, and the submission encoded it as the first line of a
   plain-text body posted to site_requests as {kind, body}. The desk
   read that line by eye. Nothing else carried the plan — there was
   no column for it.

   That path is preserved here, character for character, because it
   is the only behaviour the CRM and every existing record already
   understand. What is added on top:

     - the canonical identifiers (offer, mode, config)
     - the legacy slug the configuration maps to, where one exists
     - a machine-readable header block at the top of the body, so
       the identity survives even on a database that has not run
       migration 0009 yet

   Submission degrades in three steps, and only the first is new:
     1. insert with the canonical columns
     2. if the schema rejects them, insert {kind, body} — the exact
        legacy shape, which always works
     3. if the wire is down, hand back a mailto with the same body

   Requires js/offers.js (window.MCC_OFFERS) and js/backend.js
   (window.MCC_SUPA).
   ============================================================ */
(function () {
  "use strict";

  /* legacy first line, unchanged in shape: the desk reads this by eye */
  function legacyHeadline(L, offer, mode) {
    var o = window.MCC_OFFERS.offerOf(L, offer);
    if (!o) return "NEW CLIENT ONBOARDING · no offer picked";
    var price = window.MCC_OFFERS.priceOf(L, offer, mode);
    var name = o.full_name || o.name;
    var modeName = offer === "runway" ? "" : " — " + (L.modes[mode] || {}).name;
    var amount = "";
    if (price && price.approved) {
      if (price.kind === "start") amount = " ($" + window.MCC_OFFERS.money(price.amount) + " to start, then $" +
        window.MCC_OFFERS.money(o.pricing.recurring.amount) + "/mo)";
      else if (price.amount != null) amount = " ($" + window.MCC_OFFERS.money(price.amount) + "/" + price.cadence + ")";
      else if (price.from != null) amount = " (from $" + window.MCC_OFFERS.money(price.from) + ")";
    } else {
      amount = " (terms structured during discovery)";
    }
    return "NEW CLIENT ONBOARDING · " + name + modeName + amount;
  }

  /* the canonical identity of a configuration */
  function identity(L, offer, mode) {
    var row = window.MCC_OFFERS.configOf(L, offer, mode);
    return {
      offer: row.offer,
      mode: offer === "runway" ? null : row.mode,
      config: row.config,
      legacy_plan: row.legacy_plan,
      label: row.label
    };
  }

  /* the header block: identity that survives a database without 0009 */
  function stamp(id) {
    return [
      "CONFIG: " + id.config,
      "OFFER: " + id.offer,
      "MODE: " + (id.mode || "n/a — Runway has no Equity version"),
      "LEGACY-PLAN: " + (id.legacy_plan || "none — not a pre-ladder lane")
    ].join("\n");
  }

  /* build the full submission from the ledger and the answers */
  function build(L, state) {
    var offer = state.offer;
    var mode = offer === "runway" ? "m" : (state.mode || "m");
    var id = identity(L, offer, mode);

    var body = [
      legacyHeadline(L, offer, mode),
      stamp(id),
      "",
      (state.lines || []).join("\n")
    ].join("\n");

    /* site_requests.body is checked at 3..4000 characters */
    if (body.length > 3900) body = body.slice(0, 3890) + "\n… (truncated)";

    return {
      kind: "onboarding",
      body: body,
      offer: id.offer,
      mode: id.mode,
      config: id.config,
      legacy_plan: id.legacy_plan
    };
  }

  /* a schema that predates 0009 rejects the new columns by name */
  function isSchemaError(status, text) {
    if (status !== 400 && status !== 404 && status !== 422) return false;
    return /column|schema cache|PGRST204|PGRST205/i.test(text || "");
  }

  function post(payload) {
    var S = window.MCC_SUPA;
    return S.token().then(function (t) {
      if (!t) throw new Error("no session");
      function insert(row) {
        return fetch(S.url + "/rest/v1/site_requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", apikey: S.key,
            Authorization: "Bearer " + t, Prefer: "return=minimal"
          },
          body: JSON.stringify(row)
        });
      }
      return insert(payload).then(function (r) {
        if (r.ok) return { ok: true, shape: "canonical" };
        return r.text().then(function (txt) {
          if (!isSchemaError(r.status, txt)) throw new Error("request " + r.status);
          /* the database has not run 0009 — fall back to the legacy shape,
             which still carries the identity inside the body header */
          return insert({ kind: payload.kind, body: payload.body }).then(function (r2) {
            if (!r2.ok) throw new Error("request " + r2.status);
            return { ok: true, shape: "legacy" };
          });
        });
      });
    });
  }

  window.MCC_OFFER_CRM = {
    build: build, post: post, identity: identity,
    legacyHeadline: legacyHeadline, stamp: stamp, isSchemaError: isSchemaError
  };
})();
