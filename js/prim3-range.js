(function () {
  "use strict";

  var core = window.PRIM3_RANGE_CORE;
  var state = {
    user: null,
    progress: null,
    profile: null,
    session: null,
    selectedAdvantages: [],
    activeEvidenceId: null,
    lastMessage: ""
  };

  var els = {};

  function h(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  function parseJson(response) {
    return response.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!response.ok) {
        var message = data && (data.error || data.message);
        throw Object.assign(new Error(message || "PRIM3 range request failed"), { status: response.status, data: data });
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

  function m01Row(rows) {
    return (rows || []).find(function (row) { return String(row.module_id || "").toUpperCase() === "M01"; }) || null;
  }

  function getMastery() {
    return state.progress && state.progress.mastery && typeof state.progress.mastery === "object" && !Array.isArray(state.progress.mastery)
      ? state.progress.mastery
      : {};
  }

  function previousMission() {
    var mastery = getMastery();
    var missions = mastery.missions && typeof mastery.missions === "object" ? mastery.missions : {};
    return missions[core.missionId] && typeof missions[core.missionId] === "object" ? missions[core.missionId] : null;
  }

  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.dataset.kind = kind || "neutral";
  }

  function showGate(title, copy, action) {
    els.range.hidden = true;
    els.gate.hidden = false;
    els.gateTitle.textContent = title;
    els.gateCopy.textContent = copy;
    if (action) {
      els.gateAction.hidden = false;
      els.gateAction.textContent = action.label;
      els.gateAction.href = action.href;
    } else {
      els.gateAction.hidden = true;
    }
  }

  function scoreLabel(value) {
    return Math.round(Number(value || 0)) + "%";
  }

  function profileExplanation(profile) {
    if (profile.scaffolding === "HIGH") return "The range will remove nonmaterial noise and show stronger reasoning support. Required tools remain unchanged.";
    if (profile.scaffolding === "STANDARD") return "The range will include one nonmaterial signal and moderate reasoning support. Required tools remain unchanged.";
    return "The range will include more nonmaterial signals and less guidance. Required tools remain unchanged.";
  }

  function renderProfile() {
    var profile = state.profile;
    els.readinessValue.textContent = scoreLabel(profile.principles_readiness);
    els.technicalValue.textContent = profile.technical_challenge;
    els.scaffoldingValue.textContent = profile.scaffolding;
    els.creditValue.textContent = String(profile.preparation_credits);
    els.readinessNote.textContent = profileExplanation(profile);

    els.toolList.innerHTML = profile.minimum_required_toolset.map(function (tool) {
      var labels = {
        "evidence-viewer": "Evidence Viewer",
        "risk-register": "Risk Register",
        "control-catalog": "Control Catalog"
      };
      return "<li><b>READY</b><span>" + h(labels[tool] || tool) + "</span></li>";
    }).join("");

    var labels = {
      "reveal-one-source-provenance": ["Source Provenance", "Reveal the origin of each evidence item."],
      "remove-one-nonmaterial-distractor": ["Noise Reduction", "Remove one nonmaterial evidence item before deployment."],
      "preview-one-control-category": ["Control Preview", "Preview the category of the strongest control without revealing the exact answer."]
    };
    els.prepList.innerHTML = profile.allowed_preparation_advantages.map(function (id) {
      var item = labels[id];
      var disabled = profile.preparation_credits < 1 ? " disabled" : "";
      return '<label class="range-prep-option"><input type="checkbox" value="' + h(id) + '"' + disabled + '><span><b>' + h(item[0]) + '</b><small>' + h(item[1]) + '</small></span></label>';
    }).join("");
    els.prepHelp.textContent = profile.preparation_credits
      ? "Choose up to " + profile.preparation_credits + " preparation advantage" + (profile.preparation_credits === 1 ? "." : "s.")
      : "No preparation credits are available yet. The complete required toolset is still available.";

    Array.prototype.forEach.call(els.prepList.querySelectorAll("input"), function (input) {
      input.addEventListener("change", function () {
        var checked = Array.prototype.slice.call(els.prepList.querySelectorAll("input:checked"));
        if (checked.length > profile.preparation_credits) {
          input.checked = false;
          setStatus("Preparation credit limit reached.", "warn");
        }
        state.selectedAdvantages = Array.prototype.slice.call(els.prepList.querySelectorAll("input:checked")).map(function (node) { return node.value; });
      });
    });

    var previous = previousMission();
    if (previous) {
      els.history.hidden = false;
      els.history.innerHTML = "<b>Previous best</b><span>Technical mastery " + h(scoreLabel(previous.best_technical_mastery || previous.technical_mastery)) + "</span><span>Operational grade " + h(previous.best_operational_grade || previous.operational_grade || "Not graded") + "</span><span>Attempts " + h(previous.attempts || 1) + "</span>";
    } else {
      els.history.hidden = true;
    }
  }

  function classificationOptions(name) {
    var options = {
      threat: ["", "unauthorized access", "unauthorized modification", "service interruption", "malware infection"],
      vulnerability: ["", "overly broad role permissions", "shared administrator credential", "single point of failure", "normal storage growth"],
      likelihood: ["", "unlikely", "possible", "likely"],
      impact: ["", "low", "moderate", "high"],
      objective: ["", "confidentiality", "integrity", "availability"]
    };
    var empty = {
      threat: "Select threat",
      vulnerability: "Select vulnerability",
      likelihood: "Select likelihood",
      impact: "Select impact",
      objective: "Select security objective"
    };
    return options[name].map(function (value) {
      return '<option value="' + h(value) + '">' + h(value || empty[name]) + '</option>';
    }).join("");
  }

  function renderEvidence(variant) {
    var ids = state.session.available_evidence;
    var items = variant.evidence.filter(function (item) { return ids.indexOf(item.id) !== -1; });
    els.stageBody.innerHTML = '<div class="range-stage-copy"><p class="range-kicker">STAGE ONE · OBSERVE</p><h2>Separate evidence from assumption.</h2><p>Review the available evidence before you classify the risk. Material evidence must be examined before the Risk Register will accept a classification.</p></div>' +
      '<div class="range-evidence-layout"><div class="range-evidence-list">' + items.map(function (item) {
        var reviewed = state.session.reviewed_evidence_ids.indexOf(item.id) !== -1;
        return '<button type="button" class="range-evidence' + (reviewed ? ' is-reviewed' : '') + '" data-evidence="' + h(item.id) + '"><small>' + (reviewed ? 'REVIEWED' : 'UNREAD') + '</small><b>' + h(item.title) + '</b></button>';
      }).join("") + '</div><article class="range-evidence-detail" id="rangeEvidenceDetail"><p>Select an evidence item to inspect it.</p></article></div>' +
      '<div class="range-action-row"><button type="button" class="range-primary" id="commitObservation">Commit observation</button><span>Required trace: Evidence reviewed before classification</span></div>';

    Array.prototype.forEach.call(els.stageBody.querySelectorAll("[data-evidence]"), function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-evidence");
        state.session = core.reviewEvidence(state.session, id);
        state.activeEvidenceId = id;
        renderMission();
      });
    });
    var detail = els.stageBody.querySelector("#rangeEvidenceDetail");
    var current = items.find(function (item) { return item.id === state.activeEvidenceId; });
    if (current && detail) {
      var provenance = state.session.advantages.indexOf("reveal-one-source-provenance") !== -1
        ? '<small>Source: ' + h(current.provenance) + '</small>'
        : '<small>Source provenance available through preparation credit</small>';
      detail.innerHTML = provenance + "<h3>" + h(current.title) + "</h3><p>" + h(current.text) + "</p>";
    }
    els.stageBody.querySelector("#commitObservation").addEventListener("click", function () {
      var result = core.commitObservation(state.session);
      state.session = result.session;
      state.lastMessage = result.correct ? "Observation accepted. The Risk Register is open." : "Observation rejected. Review all material evidence before classification.";
      renderMission();
    });
  }

  function renderClassification() {
    var support = state.profile.scaffolding === "HIGH"
      ? '<aside class="range-guidance"><b>Reasoning support</b><p>Threat is the actor or event that can cause harm. Vulnerability is the weakness that makes harm possible. Likelihood estimates probability. Impact estimates consequence. Risk combines likelihood and impact in context.</p></aside>'
      : "";
    els.stageBody.innerHTML = '<div class="range-stage-copy"><p class="range-kicker">STAGE TWO · CLASSIFY</p><h2>Build a defensible risk statement.</h2><p>Use the evidence you reviewed. Do not classify from intuition alone.</p></div>' + support +
      '<form id="riskForm" class="range-form"><label><span>Threat</span><select name="threat" required>' + classificationOptions("threat") + '</select></label>' +
      '<label><span>Vulnerability</span><select name="vulnerability" required>' + classificationOptions("vulnerability") + '</select></label>' +
      '<label><span>Likelihood</span><select name="likelihood" required>' + classificationOptions("likelihood") + '</select></label>' +
      '<label><span>Impact</span><select name="impact" required>' + classificationOptions("impact") + '</select></label>' +
      '<label><span>Security objective most directly at risk</span><select name="objective" required>' + classificationOptions("objective") + '</select></label>' +
      '<button class="range-primary" type="submit">Commit classification</button></form>';
    els.stageBody.querySelector("#riskForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var form = new FormData(event.currentTarget);
      var answers = {};
      ["threat", "vulnerability", "likelihood", "impact", "objective"].forEach(function (key) { answers[key] = form.get(key); });
      var result = core.classifyRisk(state.session, answers);
      state.session = result.session;
      if (result.correct) {
        state.lastMessage = "Classification accepted. Control selection is unlocked.";
      } else if (state.profile.scaffolding === "HIGH" && result.fields && result.fields.length) {
        state.lastMessage = "Classification rejected. Recheck: " + result.fields.join(", ") + ".";
      } else {
        state.lastMessage = "Classification rejected. Reconcile the Risk Register with the evidence.";
      }
      renderMission();
    });
  }

  function renderControls(variant) {
    var preview = state.session.advantages.indexOf("preview-one-control-category") !== -1
      ? '<aside class="range-guidance"><b>Preparation intel</b><p>Strongest control category: ' + h(variant.controls.find(function (item) { return item.correct; }).category) + '.</p></aside>'
      : "";
    els.stageBody.innerHTML = '<div class="range-stage-copy"><p class="range-kicker">STAGE THREE · CONTROL</p><h2>Choose a proportional control.</h2><p>The strongest answer must address the material risk without creating a new unacceptable availability problem.</p></div>' + preview +
      '<div class="range-choice-grid">' + variant.controls.map(function (control) {
        return '<button type="button" class="range-choice" data-control="' + h(control.id) + '"><small>' + h(control.category) + '</small><span>' + h(control.label) + '</span></button>';
      }).join("") + '</div>';
    Array.prototype.forEach.call(els.stageBody.querySelectorAll("[data-control]"), function (button) {
      button.addEventListener("click", function () {
        var result = core.chooseControl(state.session, button.getAttribute("data-control"));
        state.session = result.session;
        state.lastMessage = result.correct ? "Control accepted. Verification is now required." : "Control rejected. The selected action does not reduce the material risk enough.";
        renderMission();
      });
    });
  }

  function renderVerification(variant) {
    els.stageBody.innerHTML = '<div class="range-stage-copy"><p class="range-kicker">STAGE FOUR · VERIFY</p><h2>Prove that the control worked.</h2><p>A control is not complete because it was selected. Choose the observation that would verify the intended security state.</p></div>' +
      '<div class="range-choice-grid">' + variant.verification.map(function (check) {
        return '<button type="button" class="range-choice" data-verification="' + h(check.id) + '"><span>' + h(check.label) + '</span></button>';
      }).join("") + '</div>';
    Array.prototype.forEach.call(els.stageBody.querySelectorAll("[data-verification]"), function (button) {
      button.addEventListener("click", function () {
        var result = core.verifyControl(state.session, button.getAttribute("data-verification"));
        state.session = result.session;
        state.lastMessage = result.correct ? "Verification accepted. Mission evidence is complete." : "Verification rejected. That observation does not prove the selected control changed the intended risk state.";
        renderMission();
        if (state.session.completed || state.session.failed) persistTerminalResult();
      });
    });
  }

  function renderDebrief(variant) {
    var score = core.scoreSession(state.session);
    var completeTitle = score.completed ? "Training Range complete." : "Training Range failed.";
    var outcome = score.completed
      ? "You completed the full evidence, classification, control, and verification cycle."
      : "The mission window expired before the full control cycle was verified.";
    els.stageBody.innerHTML = '<div class="range-stage-copy"><p class="range-kicker">DEBRIEF</p><h2>' + h(completeTitle) + '</h2><p>' + h(outcome) + '</p></div>' +
      '<div class="range-score-grid"><article><small>Technical mastery</small><b>' + h(scoreLabel(score.technical_mastery)) + '</b></article><article><small>Independence</small><b>' + h(scoreLabel(score.independence)) + '</b></article><article><small>Transfer</small><b>' + h(scoreLabel(score.transfer)) + '</b></article><article><small>Compliance</small><b>' + h(scoreLabel(score.compliance)) + '</b></article><article><small>Operational grade</small><b>' + h(score.operational_grade) + '</b></article></div>' +
      '<article class="range-debrief"><h3>Residual risk</h3><p>' + h(variant.residual) + '</p><h3>Evidence trace</h3><p>' + h(score.evidence_trace_ids.length ? score.evidence_trace_ids.join(" · ") : "No mastery trace completed") + '</p><h3>Remediation</h3><p>' + (score.technical_mastery < 100 ? 'Return to Module M01, Security Foundations and Risk, then replay the range.' : 'No required remediation. Replay to improve independence or operational grade.') + '</p></article>' +
      '<div class="range-action-row"><button type="button" class="range-primary" id="replayMission">Replay Training Range 01</button><a class="range-secondary-link" href="prim3.html">Return to Principles</a></div>';
    els.stageBody.querySelector("#replayMission").addEventListener("click", function () {
      state.session = null;
      state.lastMessage = "";
      renderBriefing();
    });
  }

  function renderMission() {
    var session = state.session;
    var variant = core.publicVariant(session.variant_id);
    els.mission.hidden = false;
    els.briefing.hidden = true;
    els.windowValue.textContent = String(session.window);
    els.missionState.textContent = session.mission_state;
    els.traceValue.textContent = String(session.evidence_trace_ids.length) + " of 4";
    els.variantValue.textContent = variant.id;
    els.missionTitle.textContent = variant.title;
    els.missionBrief.textContent = variant.briefing;
    els.message.textContent = state.lastMessage;
    els.message.hidden = !state.lastMessage;
    if (session.completed || session.failed || session.stage === "COMPLETE" || session.stage === "FAILED") {
      renderDebrief(variant);
      return;
    }
    if (session.stage === "EVIDENCE") renderEvidence(variant);
    else if (session.stage === "CLASSIFY") renderClassification(variant);
    else if (session.stage === "CONTROL") renderControls(variant);
    else if (session.stage === "VERIFY") renderVerification(variant);
  }

  function renderBriefing() {
    els.briefing.hidden = false;
    els.mission.hidden = true;
    var variant = core.publicVariant(state.profile.variant_id);
    els.briefVariant.textContent = variant.id;
    els.briefTitle.textContent = variant.title;
    els.briefCopy.textContent = variant.briefing;
    renderProfile();
  }

  function bestGrade(previousScore, previousGrade, score, grade) {
    return Number(score) >= Number(previousScore || 0) ? grade : previousGrade;
  }

  function persistTerminalResult() {
    if (!state.progress) return Promise.resolve();
    var score = core.scoreSession(state.session);
    var mastery = getMastery();
    var missions = mastery.missions && typeof mastery.missions === "object" ? Object.assign({}, mastery.missions) : {};
    var previous = previousMission() || {};
    var previousBestOperational = Number(previous.best_operational_score || previous.operational_score || 0);
    var nextMission = {
      attempts: Number(previous.attempts || 0) + 1,
      completed: Boolean(previous.completed || score.completed),
      completed_at: previous.completed_at || (score.completed ? new Date().toISOString() : null),
      last_attempt_at: new Date().toISOString(),
      variant_id: state.session.variant_id,
      technical_mastery: score.technical_mastery,
      independence: score.independence,
      transfer: score.transfer,
      compliance: score.compliance,
      operational_score: score.operational_score,
      operational_grade: score.operational_grade,
      best_technical_mastery: Math.max(Number(previous.best_technical_mastery || 0), score.technical_mastery),
      best_independence: Math.max(Number(previous.best_independence || 0), score.independence),
      best_transfer: Math.max(Number(previous.best_transfer || 0), score.transfer),
      best_compliance: Math.max(Number(previous.best_compliance || 0), score.compliance),
      best_operational_score: Math.max(previousBestOperational, score.operational_score),
      best_operational_grade: bestGrade(previousBestOperational, previous.best_operational_grade || previous.operational_grade, score.operational_score, score.operational_grade),
      evidence_trace_ids: score.evidence_trace_ids,
      technical_truth_locked_at_compile: true,
      minimum_required_tools_preserved: true
    };
    missions[core.missionId] = nextMission;
    var nextMastery = Object.assign({}, mastery, { missions: missions });
    setStatus("Saving mission evidence to M Account.", "syncing");
    return api("/v1/prim3/progress/M01", { method: "POST", body: { mastery: nextMastery } }).then(function (data) {
      if (data && data.progress) state.progress = data.progress;
      setStatus("Mission evidence saved to M Account.", "good");
      if (window.PRIM3_TRACKING && typeof window.PRIM3_TRACKING.refresh === "function") window.PRIM3_TRACKING.refresh();
    }).catch(function () {
      setStatus("Mission complete. Account sync will need another attempt.", "warn");
    });
  }

  function launchMission() {
    state.session = core.createSession(state.profile, state.selectedAdvantages);
    state.activeEvidenceId = null;
    state.lastMessage = "Mission deployed. Technical truth is now locked for this attempt.";
    renderMission();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function wire() {
    els.launch.addEventListener("click", launchMission);
  }

  function cacheElements() {
    els.gate = document.getElementById("rangeGate");
    els.gateTitle = document.getElementById("rangeGateTitle");
    els.gateCopy = document.getElementById("rangeGateCopy");
    els.gateAction = document.getElementById("rangeGateAction");
    els.range = document.getElementById("rangeShell");
    els.status = document.getElementById("rangeSyncStatus");
    els.briefing = document.getElementById("rangeBriefing");
    els.mission = document.getElementById("rangeMission");
    els.readinessValue = document.getElementById("readinessValue");
    els.technicalValue = document.getElementById("technicalValue");
    els.scaffoldingValue = document.getElementById("scaffoldingValue");
    els.creditValue = document.getElementById("creditValue");
    els.readinessNote = document.getElementById("readinessNote");
    els.toolList = document.getElementById("toolList");
    els.prepList = document.getElementById("prepList");
    els.prepHelp = document.getElementById("prepHelp");
    els.history = document.getElementById("rangeHistory");
    els.briefVariant = document.getElementById("briefVariant");
    els.briefTitle = document.getElementById("briefTitle");
    els.briefCopy = document.getElementById("briefCopy");
    els.launch = document.getElementById("launchRange");
    els.windowValue = document.getElementById("windowValue");
    els.missionState = document.getElementById("missionState");
    els.traceValue = document.getElementById("traceValue");
    els.variantValue = document.getElementById("variantValue");
    els.missionTitle = document.getElementById("missionTitle");
    els.missionBrief = document.getElementById("missionBrief");
    els.message = document.getElementById("rangeMessage");
    els.stageBody = document.getElementById("rangeStageBody");
  }

  function start() {
    cacheElements();
    if (!core) {
      showGate("Training Range unavailable", "The deterministic range core did not load.");
      return;
    }
    if (!window.MCC || typeof window.MCC.user !== "function") {
      showGate("M Account service unavailable", "Refresh after the account service loads.");
      return;
    }
    setStatus("Loading learner state.", "syncing");
    window.MCC.user().then(function (user) {
      if (!user) {
        showGate("M Account required", "Create or sign in to your free M Account before entering Training Range 01.", { label: "Open M Account", href: "account.html" });
        return null;
      }
      state.user = user;
      return api("/v1/prim3/progress");
    }).then(function (data) {
      if (!data) return;
      state.progress = m01Row(data.progress);
      if (!state.progress || !state.progress.passed_at) {
        showGate("Module M01 required", "Pass Security Foundations and Risk before entering Training Range 01. The mission measures application after instruction.", { label: "Return to Module M01", href: "prim3.html" });
        return;
      }
      state.profile = core.buildReadiness(state.progress, state.user.id);
      els.gate.hidden = true;
      els.range.hidden = false;
      setStatus("Readiness profile compiled.", "good");
      wire();
      renderBriefing();
    }).catch(function (error) {
      if (error && error.status === 401) {
        showGate("M Account session expired", "Sign in again before entering Training Range 01.", { label: "Sign in", href: "account.html" });
        return;
      }
      showGate("Training Range unavailable", error && error.message ? error.message : "The range could not load learner state.");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
