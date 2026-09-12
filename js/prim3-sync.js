(function () {
  "use strict";

  var STORAGE_KEY = "prim3_course_progress_v3";
  var BOOT_FLAG = "prim3_progress_bootstrap_v2";
  var SYNC_LABEL_ID = "prim3ProgressSync";

  function localState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        read: Array.isArray(parsed.read) ? parsed.read : [],
        passed: Array.isArray(parsed.passed) ? parsed.passed : [],
        scores: parsed.scores && typeof parsed.scores === "object" ? parsed.scores : {}
      };
    } catch (_) {
      return { read: [], passed: [], scores: {} };
    }
  }

  function writeState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function syncLabel(text, state) {
    var bar = document.getElementById("courseSync");
    if (!bar) return;
    var label = document.getElementById(SYNC_LABEL_ID);
    if (!label) {
      label = document.createElement("span");
      label.id = SYNC_LABEL_ID;
      label.style.marginLeft = "auto";
      label.style.fontSize = ".62rem";
      label.style.fontWeight = "900";
      label.style.letterSpacing = ".08em";
      bar.appendChild(label);
    }
    label.textContent = text;
    label.dataset.state = state || "account";
  }

  function parseJson(response) {
    return response.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!response.ok) {
        var message = data && (data.error || data.message);
        throw Object.assign(new Error(message || "PRIM3 progress sync failed"), { status: response.status, data: data });
      }
      return data;
    });
  }

  function api(path, init) {
    if (!window.MCC || typeof window.MCC.api !== "function") return Promise.reject(Object.assign(new Error("M Account unavailable"), { status: 401 }));
    return window.MCC.api(path, init || {}).then(parseJson);
  }

  function activeModuleId() {
    var node = document.getElementById("lessonNumber");
    var match = node && String(node.textContent || "").match(/M\d{2}/i);
    return match ? match[0].toUpperCase() : null;
  }

  function mergeRemote(rows) {
    var state = localState();
    var before = JSON.stringify(state);
    (rows || []).forEach(function (row) {
      var id = String(row.module_id || "").toUpperCase();
      if (!/^M\d{2}$/.test(id)) return;
      if (row.reading_completed_at) state.read.push(id);
      if (row.passed_at) state.passed.push(id);
      if (row.assessment_score !== null && row.assessment_score !== undefined) {
        var remoteScore = Number(row.assessment_score);
        var localScore = Number(state.scores[id]);
        state.scores[id] = Number.isFinite(localScore) ? Math.max(localScore, remoteScore) : remoteScore;
      }
    });
    state.read = unique(state.read);
    state.passed = unique(state.passed);
    writeState(state);
    return before !== JSON.stringify(state);
  }

  function accountSession() {
    if (!window.MCC || typeof window.MCC.refreshIfNeeded !== "function") return Promise.resolve(null);
    return window.MCC.refreshIfNeeded();
  }

  function bootstrap() {
    accountSession().then(function (session) {
      if (!session || !session.access_token) {
        sessionStorage.removeItem(BOOT_FLAG);
        syncLabel("M ACCOUNT · REQUIRED", "required");
        return null;
      }
      syncLabel("M ACCOUNT · SYNCING", "syncing");
      return api("/v1/prim3/progress").then(function (data) {
        var changed = mergeRemote(data && data.progress);
        syncLabel("M ACCOUNT · SYNCED", "synced");
        /* prim3.js snapshots local progress at boot. Reload once when the
           account has progress this browser did not yet know about. */
        if (changed && sessionStorage.getItem(BOOT_FLAG) !== "1") {
          sessionStorage.setItem(BOOT_FLAG, "1");
          location.reload();
        } else {
          sessionStorage.removeItem(BOOT_FLAG);
        }
      });
    }).catch(function (error) {
      if (error && error.status === 401) syncLabel("M ACCOUNT · SIGN IN AGAIN", "required");
      else syncLabel("M ACCOUNT · SYNC LATER", "error");
    });
  }

  function withAccount(action) {
    return accountSession().then(function (session) {
      if (!session || !session.access_token) {
        syncLabel("M ACCOUNT · REQUIRED", "required");
        return null;
      }
      return action();
    });
  }

  function pushReading() {
    var id = activeModuleId();
    if (!id) return;
    setTimeout(function () {
      var state = localState();
      if (state.read.indexOf(id) === -1) return;
      withAccount(function () {
        return api("/v1/prim3/progress/" + id, { method: "POST", body: { reading_completed: true } })
          .then(function () { syncLabel("M ACCOUNT · SYNCED", "synced"); });
      }).catch(function () { syncLabel("M ACCOUNT · SYNC LATER", "error"); });
    }, 0);
  }

  function pushAssessment() {
    var id = activeModuleId();
    if (!id) return;
    setTimeout(function () {
      var state = localState();
      var score = state.scores[id];
      if (score === undefined || score === null) return;
      withAccount(function () {
        return api("/v1/prim3/progress/" + id, { method: "POST", body: { reading_completed: state.read.indexOf(id) !== -1, assessment_score: Number(score) } })
          .then(function () { syncLabel("M ACCOUNT · SYNCED", "synced"); });
      }).catch(function () { syncLabel("M ACCOUNT · SYNC LATER", "error"); });
    }, 0);
  }

  function pushReset() {
    setTimeout(function () {
      var state = localState();
      if (state.read.length || state.passed.length || Object.keys(state.scores).length) return;
      withAccount(function () {
        return api("/v1/prim3/progress", { method: "DELETE" })
          .then(function () { syncLabel("M ACCOUNT · SYNCED", "synced"); });
      }).catch(function () { syncLabel("M ACCOUNT · SYNC LATER", "error"); });
    }, 0);
  }

  function wire() {
    var read = document.getElementById("markRead");
    var quiz = document.getElementById("quizForm");
    var reset = document.getElementById("resetProgress");
    if (read) read.addEventListener("click", pushReading);
    if (quiz) quiz.addEventListener("submit", pushAssessment);
    if (reset) reset.addEventListener("click", pushReset);
    bootstrap();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
})();
