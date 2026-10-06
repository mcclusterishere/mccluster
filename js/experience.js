/* McCluster Experience Evidence client.
 *
 * Evidence Plane v1 does not reorder or personalize live surfaces. It gives a
 * surface a canonical decision_id, then attaches that id to render/visibility/
 * interaction/outcome events so later experiments can be evaluated honestly.
 *
 * This file assumes js/analytics.js has already passed the privacy gate and
 * exposed MCC_ANALYTICS_CONTEXT + MCC_TRACK. Surfaces may safely fall back to
 * their existing order if this service is unavailable.
 */
(function (root) {
  "use strict";

  var API = "https://api.mccluster.org";

  function sessionToken() {
    try {
      var s = JSON.parse(localStorage.getItem("mccdb_session") || "null");
      return s && s.access_token ? s.access_token : null;
    } catch (_) { return null; }
  }

  function context() {
    try {
      return root.MCC_ANALYTICS_CONTEXT && root.MCC_ANALYTICS_CONTEXT.experienceContext
        ? root.MCC_ANALYTICS_CONTEXT.experienceContext()
        : {};
    } catch (_) { return {}; }
  }

  function cleanCandidate(c, index) {
    if (!c || c.id == null) return null;
    return {
      id: String(c.id).slice(0, 160),
      kind: String(c.kind || "content").slice(0, 64),
      position: Number.isFinite(Number(c.position)) ? Number(c.position) : index,
      meta: c.meta && typeof c.meta === "object" ? c.meta : {}
    };
  }

  function decisionProps(decision, extra) {
    extra = extra && typeof extra === "object" ? extra : {};
    var out = {
      decision_id: decision && decision.decision_id || null,
      experience_surface: decision && decision.surface || null,
      experience_policy: decision && decision.policy
        ? decision.policy.key + "@" + decision.policy.version
        : null,
      experience_experiment: decision && decision.experiment
        ? decision.experiment.key
        : null,
      experience_arm: decision && decision.experiment
        ? decision.experiment.arm
        : null
    };
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== undefined) out[k] = extra[k];
    });
    return out;
  }

  function track(name, decision, extra) {
    try {
      if (root.MCC_TRACK) root.MCC_TRACK(name, decisionProps(decision, extra));
    } catch (_) {}
  }

  async function decide(surface, candidates, opts) {
    opts = opts || {};
    var localCandidates = (candidates || []).map(cleanCandidate).filter(Boolean);
    if (!root.MCC_ANALYTICS_CONTEXT || typeof root.MCC_ANALYTICS_CONTEXT.experienceContext !== "function") {
      return {
        ok: false, fallback: true,
        candidates: localCandidates.slice(0, Math.max(1, Number(opts.maxItems) || localCandidates.length)),
        error: "privacy gate not acknowledged"
      };
    }
    var ctx = context();
    var body = {
      surface: String(surface || ""),
      device_id: ctx.device_id || null,
      session_id: ctx.session_id || null,
      max_items: opts.maxItems || (candidates || []).length,
      context: {
        path: ctx.path || location.pathname + location.search,
        source: ctx.source || "direct",
        viewport: root.innerWidth + "x" + root.innerHeight
      },
      candidates: localCandidates
    };
    if (!body.surface || !body.candidates.length) {
      return { ok: false, fallback: true, candidates: body.candidates, error: "surface and candidates required" };
    }

    var headers = { "content-type": "application/json" };
    var token = sessionToken();
    if (token) headers.authorization = "Bearer " + token;

    try {
      var res = await fetch(API + "/v1/experience/decide", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !data.ok) throw new Error(data && (data.error || data.reason) || "decision failed");
      return data;
    } catch (error) {
      return {
        ok: false,
        fallback: true,
        candidates: body.candidates.slice(0, Math.max(1, Number(body.max_items) || body.candidates.length)),
        error: error && error.message || "decision unavailable"
      };
    }
  }

  function impression(decision, candidate, extra) {
    track("experience_impression", decision, Object.assign({
      candidate_id: candidate && candidate.id || null,
      candidate_kind: candidate && candidate.kind || null,
      position: candidate && candidate.position != null ? candidate.position : null
    }, extra || {}));
  }

  function visible(decision, candidate, extra) {
    track("experience_visible", decision, Object.assign({
      candidate_id: candidate && candidate.id || null,
      candidate_kind: candidate && candidate.kind || null,
      position: candidate && candidate.position != null ? candidate.position : null
    }, extra || {}));
  }

  function interact(decision, candidate, extra) {
    track("experience_interaction", decision, Object.assign({
      candidate_id: candidate && candidate.id || null,
      candidate_kind: candidate && candidate.kind || null,
      position: candidate && candidate.position != null ? candidate.position : null
    }, extra || {}));
  }

  function dismissed(decision, candidate, extra) {
    track("experience_dismissed", decision, Object.assign({
      candidate_id: candidate && candidate.id || null,
      candidate_kind: candidate && candidate.kind || null,
      position: candidate && candidate.position != null ? candidate.position : null
    }, extra || {}));
  }

  function outcome(decision, name, extra) {
    track("experience_outcome", decision, Object.assign({
      outcome: String(name || "").slice(0, 120)
    }, extra || {}));
  }

  root.MCC_EXPERIENCE = {
    decide: decide,
    impression: impression,
    visible: visible,
    interact: interact,
    dismissed: dismissed,
    outcome: outcome,
    decisionProps: decisionProps
  };
})(window);
