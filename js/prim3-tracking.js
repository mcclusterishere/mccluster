(function () {
  "use strict";

  var COURSE_ID = "prim3-foundation-v3";
  var LOCAL_KEY = "prim3_prim_tracking_v1";
  var MAPS = {
    security: "https://raw.githubusercontent.com/mcclusterishere/mccluster/main/docs/prim3/SECURITY-PLUS-TOPIC-LEDGER.json",
    network: "https://raw.githubusercontent.com/mcclusterishere/mccluster/main/docs/prim3/NETWORK-PLUS-TOPIC-LEDGER.json",
    aplus: "https://raw.githubusercontent.com/mcclusterishere/mccluster/main/docs/prim3/APLUS-PRECURSOR-MAP.json"
  };

  var cache = { course: null, rows: [], security: null, network: null, aplus: null };

  function parseJson(response) {
    return response.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!response.ok) {
        var message = data && (data.error || data.message);
        throw Object.assign(new Error(message || "PRIM tracking request failed"), { status: response.status, data: data });
      }
      return data;
    });
  }

  function api(path, init) {
    if (!window.MCC || typeof window.MCC.api !== "function") {
      return Promise.reject(Object.assign(new Error("M Account unavailable"), { status: 401 }));
    }
    return window.MCC.api(path, init || {}).then(parseJson);
  }

  function session() {
    if (!window.MCC || typeof window.MCC.refreshIfNeeded !== "function") return Promise.resolve(null);
    return window.MCC.refreshIfNeeded();
  }

  function getJson(url) {
    return fetch(url, { headers: { accept: "application/json" } }).then(parseJson);
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function rowByModule(id) {
    return cache.rows.find(function (row) { return String(row.module_id || "").toUpperCase() === id; }) || null;
  }

  function safeMastery(row) {
    return row && row.mastery && typeof row.mastery === "object" && !Array.isArray(row.mastery) ? row.mastery : {};
  }

  function primState(row) {
    var mastery = safeMastery(row);
    return mastery.prim && typeof mastery.prim === "object" && !Array.isArray(mastery.prim) ? mastery.prim : {};
  }

  function percent(numerator, denominator) {
    return denominator ? Math.round((numerator / denominator) * 100) : 0;
  }

  function summarizeObjectiveMap(objectives, passed) {
    var ids = Object.keys(objectives || {});
    var mastered = 0;
    var active = 0;
    var completedSlots = 0;
    var totalSlots = 0;

    ids.forEach(function (id) {
      var modules = unique((objectives[id] && objectives[id].learn_modules) || []);
      var done = modules.filter(function (moduleId) { return passed.has(moduleId); }).length;
      completedSlots += done;
      totalSlots += modules.length;
      if (modules.length && done === modules.length) mastered += 1;
      else if (done > 0) active += 1;
    });

    return {
      mastered: mastered,
      active: active,
      total: ids.length,
      percent: percent(completedSlots, totalSlots)
    };
  }

  function summarizeAPlus(aplus, passed) {
    var mastered = 0;
    var active = 0;
    var total = 0;
    var completedSlots = 0;
    var totalSlots = 0;

    ((aplus && aplus.exams) || []).forEach(function (exam) {
      var objectives = exam.objectives || {};
      Object.keys(objectives).forEach(function (id) {
        total += 1;
        var modules = unique((objectives[id] && objectives[id].learn_modules) || []);
        var done = modules.filter(function (moduleId) { return passed.has(moduleId); }).length;
        completedSlots += done;
        totalSlots += modules.length;
        if (modules.length && done === modules.length) mastered += 1;
        else if (done > 0) active += 1;
      });
    });

    return { mastered: mastered, active: active, total: total, percent: percent(completedSlots, totalSlots) };
  }

  function unitAnchors() {
    var modules = (cache.course && cache.course.modules) || [];
    var units = {};
    modules.forEach(function (module) {
      if (!module.unit_id) return;
      if (!units[module.unit_id] || Number(module.sequence) < Number(units[module.unit_id].sequence)) units[module.unit_id] = module;
    });
    return units;
  }

  function modalitySummary(letter) {
    var anchors = unitAnchors();
    var unitIds = Object.keys(anchors);
    var available = 0;
    var completed = 0;

    unitIds.forEach(function (unitId) {
      var module = anchors[unitId];
      if (letter === "R" && !module.song) return;
      if (letter === "I" && !module.episode_title) return;
      if (letter === "M" && (!module.labs || !Object.keys(module.labs).some(function (key) { return !!module.labs[key]; }))) return;
      available += 1;
      var state = primState(rowByModule(module.id));
      if (state[letter] && state[letter].completed === true) completed += 1;
    });

    return { completed: completed, total: available, percent: percent(completed, available) };
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setBar(id, value) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, value)) + "%";
  }

  function render() {
    if (!cache.course) return;
    var passed = new Set(cache.rows.filter(function (row) { return !!row.passed_at; }).map(function (row) { return String(row.module_id || "").toUpperCase(); }));
    var p = { completed: passed.size, total: Number(cache.course.module_count || 66), percent: percent(passed.size, Number(cache.course.module_count || 66)) };
    var r = modalitySummary("R");
    var i = modalitySummary("I");
    var m = modalitySummary("M");
    var security = summarizeObjectiveMap(cache.security && cache.security.objectives, passed);
    var network = summarizeObjectiveMap(cache.network && cache.network.objectives, passed);
    var aplus = summarizeAPlus(cache.aplus, passed);

    setText("primPValue", p.completed + " of " + p.total);
    setText("primPPercent", p.percent + "%");
    setBar("primPBar", p.percent);
    setText("primRValue", r.completed + " of " + r.total);
    setText("primRPercent", r.percent + "%");
    setBar("primRBar", r.percent);
    setText("primIValue", i.completed + " of " + i.total);
    setText("primIPercent", i.percent + "%");
    setBar("primIBar", i.percent);
    setText("primMValue", m.completed + " of " + m.total);
    setText("primMPercent", m.percent + "%");
    setBar("primMBar", m.percent);

    setText("securityObjectiveValue", security.mastered + " of " + security.total);
    setText("securityObjectiveMeta", security.active + " active · " + security.percent + "% topic coverage");
    setBar("securityObjectiveBar", security.percent);
    setText("networkObjectiveValue", network.mastered + " of " + network.total);
    setText("networkObjectiveMeta", network.active + " active · " + network.percent + "% topic coverage");
    setBar("networkObjectiveBar", network.percent);
    setText("aPlusObjectiveValue", aplus.mastered + " of " + aplus.total);
    setText("aPlusObjectiveMeta", aplus.active + " active · " + aplus.percent + "% precursor coverage");
    setBar("aPlusObjectiveBar", aplus.percent);

    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ P: p, R: r, I: i, M: m, security: security, network: network, aplus: aplus, updated_at: new Date().toISOString() }));
    } catch (_) {}
  }

  function refresh() {
    return session().then(function (active) {
      if (!active || !active.access_token) return null;
      return Promise.all([
        api("/v1/prim3/course"),
        api("/v1/prim3/progress"),
        getJson(MAPS.security),
        getJson(MAPS.network),
        getJson(MAPS.aplus)
      ]).then(function (items) {
        cache.course = items[0] && items[0].course;
        cache.rows = (items[1] && items[1].progress) || [];
        cache.security = items[2];
        cache.network = items[3];
        cache.aplus = items[4];
        render();
        window.dispatchEvent(new CustomEvent("prim3:trackingready"));
        return summary();
      });
    }).catch(function () {
      return null;
    });
  }

  function summary() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch (_) { return null; }
  }

  function recordModality(unitId, letter, completed, metadata) {
    letter = String(letter || "").toUpperCase();
    if (["R", "I", "M"].indexOf(letter) === -1) return Promise.reject(new Error("Only Rhythm, Immersion and Missions are recorded manually"));
    if (!/^U\d{2}$/.test(String(unitId || "").toUpperCase())) return Promise.reject(new Error("Invalid PRIM3 unit"));

    return refresh().then(function () {
      var anchors = unitAnchors();
      var anchor = anchors[String(unitId).toUpperCase()];
      if (!anchor) throw new Error("Unknown PRIM3 unit");
      var row = rowByModule(anchor.id);
      var mastery = safeMastery(row);
      var prim = Object.assign({}, primState(row));
      prim[letter] = {
        completed: completed !== false,
        completed_at: completed === false ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: metadata && typeof metadata === "object" ? metadata : {}
      };
      var nextMastery = Object.assign({}, mastery, { prim: prim });
      return api("/v1/prim3/progress/" + anchor.id, { method: "POST", body: { mastery: nextMastery } });
    }).then(function () {
      return refresh();
    });
  }

  function wireRefresh() {
    var read = document.getElementById("markRead");
    var quiz = document.getElementById("quizForm");
    var reset = document.getElementById("resetProgress");
    if (read) read.addEventListener("click", function () { setTimeout(refresh, 700); });
    if (quiz) quiz.addEventListener("submit", function () { setTimeout(refresh, 900); });
    if (reset) reset.addEventListener("click", function () { setTimeout(refresh, 700); });
    window.addEventListener("focus", function () { refresh(); });
    refresh();
  }

  window.PRIM3_TRACKING = {
    refresh: refresh,
    summary: summary,
    recordModality: recordModality
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireRefresh, { once: true });
  else wireRefresh();
})();
