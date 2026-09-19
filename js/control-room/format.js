/* Control Room formatting primitives.

   Pure presentation helpers with no state, no DOM ownership and no network.
   Extracted from control-room-v2.js so the surface code reads as surface
   code; behaviour is identical and every call site is unchanged. */
(function () {
  "use strict";

  function esc(value) {
    var d = document.createElement("i");
    d.textContent = value == null ? "" : String(value);
    return d.innerHTML;
  }

  function text(value, fallback) {
    return value === null || value === undefined || value === ""
      ? (fallback == null ? "—" : fallback)
      : String(value);
  }

  function count(value) { var n = Number(value); return Number.isFinite(n) ? n : 0; }

  function titleCase(value) {
    return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function ago(value) {
    if (!value) return "—";
    var t = new Date(value).getTime();
    if (!Number.isFinite(t)) return text(value);
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }

  function moneyCents(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n / 100);
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
    } catch (e) { return String(value); }
  }

  function durationBetween(a, b) {
    var start = a ? new Date(a).getTime() : 0, end = b ? new Date(b).getTime() : 0;
    if (!start || !end || end < start) return "—";
    var ms = end - start;
    if (ms < 1000) return ms + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return Math.round(ms / 60000) + "m";
  }

  function stateClass(kind) { return "cr-state cr-state--" + (kind || "info"); }

  /* A jsonb column that defaults to '{}' is truthy even when it holds
     nothing, so "did the backend actually report an error" cannot be a plain
     truthiness check — that is how an empty object reaches an operator
     rendered as "[object Object]". */
  function jsonText(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "string") return value.trim();
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "";
    var keys = Object.keys(value);
    if (!keys.length) return "";
    if (typeof value.message === "string" && value.message) return value.message;
    if (typeof value.error === "string" && value.error) return value.error;
    if (typeof value.detail === "string" && value.detail) return value.detail;
    return JSON.stringify(value);
  }

  window.CR = window.CR || {};
  window.CR.fmt = {
    esc: esc, text: text, count: count, titleCase: titleCase, ago: ago,
    moneyCents: moneyCents, formatDate: formatDate, durationBetween: durationBetween,
    stateClass: stateClass, jsonText: jsonText
  };
})();
