/* Source results: the Control Room's honesty layer.

   Unavailable is not empty. Every read returns a result carrying its own
   state so a query that could not run is never rendered as "no records".
   Extracted from control-room-v2.js unchanged in behaviour. */
(function () {
  "use strict";

  var fmt = window.CR.fmt;
  var esc = fmt.esc, stateClass = fmt.stateClass;

  function okResult(data) { return { ok: true, state: "ok", data: data, message: "" }; }
  function badResult(kind, message, status) {
    return { ok: false, state: kind, data: null, message: message || "", status: status || 0 };
  }

  function classifySourceError(e) {
    var status = e && e.status;
    var message = (e && e.message) || "Request failed";
    if (message === "signed out") return badResult("unauthorized", "This session is not signed in.", 401);
    if (status === 401 || status === 403) return badResult("unauthorized", message, status);
    if (status === 404 || status === 501) return badResult("unsupported", message, status);
    if (status === 429) return badResult("degraded", message, status);
    if (!status || status >= 500) return badResult("unavailable", message, status || 0);
    return badResult("failed", message, status);
  }

  function src(promise) { return promise.then(okResult).catch(function (e) { return classifySourceError(e); }); }

  /* The ONLY place a failed result becomes []. The result itself stays in
     state.sources so the view can still say why the list is short. */
  function rowsOf(result) {
    var d = result && result.ok ? result.data : null;
    return Array.isArray(d) ? d : [];
  }
  function dataOf(result) { return result && result.ok ? result.data : null; }
  function pickRows(result, key) {
    if (!result || !result.ok) return [];
    var d = result.data;
    if (Array.isArray(d)) return d;
    return d && Array.isArray(d[key]) ? d[key] : [];
  }

  var SOURCE_COPY = {
    unauthorized: ["Not authorized", "This operator session is not permitted to read this source."],
    unavailable: ["Source unavailable", "The canonical source did not respond. This is not the same as having no records."],
    unsupported: ["Not supported yet", "No canonical endpoint exists for this view."],
    degraded: ["Degraded", "The source is rate limiting or partially responding."],
    failed: ["Request failed", "The canonical source rejected this request."]
  };

  function sourceBanner(result, label) {
    if (!result || result.ok) return "";
    var copy = SOURCE_COPY[result.state] || SOURCE_COPY.failed;
    var kind = result.state === "unsupported" ? "info" : (result.state === "unauthorized" ? "warn" : "bad");
    return '<div class="cr-source cr-source--' + esc(result.state) + '">' +
      '<span class="' + stateClass(kind) + '">' + esc(copy[0]) + '</span>' +
      '<div class="cr-source__text"><b>' + esc(label || "Source") + '</b><span>' + esc(copy[1]) + '</span>' +
      (result.message ? '<code>' + esc(result.message) + (result.status ? " · HTTP " + result.status : "") + '</code>' : "") +
      '</div><button class="cr-btn cr-btn--ghost" type="button" data-action="refresh">Retry</button></div>';
  }

  function sourceStates(entries) {
    return entries.filter(function (e) { return e[1] && !e[1].ok; })
      .map(function (e) { return sourceBanner(e[1], e[0]); }).join("");
  }

  window.CR.sources = {
    okResult: okResult, badResult: badResult, classifySourceError: classifySourceError, src: src,
    rowsOf: rowsOf, dataOf: dataOf, pickRows: pickRows,
    sourceBanner: sourceBanner, sourceStates: sourceStates
  };
})();
