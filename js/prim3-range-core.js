(function (root) {
  "use strict";

  var MISSION_ID = "TR01-RISK-AND-CONTROLS";
  var REQUIRED_TRACES = ["E-TR01-OBSERVE", "E-TR01-CLASSIFY", "E-TR01-CONTROL", "E-TR01-VERIFY"];
  var REQUIRED_TOOLS = ["evidence-viewer", "risk-register", "control-catalog"];
  var PREPARATION_ADVANTAGES = [
    "reveal-one-source-provenance",
    "remove-one-nonmaterial-distractor",
    "preview-one-control-category"
  ];

  var VARIANTS = {
    "TR01-A": {
      id: "TR01-A",
      title: "Access Exposure",
      focus: "security.confidentiality",
      briefing: "A student services application is functioning normally, but a routine access review suggests that more staff can view protected student records than their jobs require.",
      evidence: [
        { id: "A1", title: "Access review", material: true, provenance: "Identity governance export", text: "Thirty four staff accounts can open the protected advising record. Only nine of those accounts belong to the advising role." },
        { id: "A2", title: "Audit sample", material: true, provenance: "Application audit log", text: "Several successful record views came from staff roles that have no advising responsibility. No approved exception is attached to those accounts." },
        { id: "A3", title: "Capacity alert", material: false, provenance: "Infrastructure monitor", text: "Storage utilization increased from forty one percent to forty four percent during the same week." },
        { id: "A4", title: "Duplicate ticket", material: false, provenance: "Service desk queue", text: "A duplicate ticket reports that the application home page loaded slowly for one user." }
      ],
      classification: {
        threat: "unauthorized access",
        vulnerability: "overly broad role permissions",
        likelihood: "likely",
        impact: "high",
        objective: "confidentiality"
      },
      controls: [
        { id: "A-C1", category: "Access control", label: "Reduce permissions to approved job roles, require role review, and retain access audit records.", correct: true },
        { id: "A-C2", category: "Availability", label: "Add a second application server and leave current permissions unchanged.", correct: false },
        { id: "A-C3", category: "Awareness", label: "Send a general reminder email without changing access rights.", correct: false }
      ],
      verification: [
        { id: "A-V1", label: "Confirm that only approved advising roles retain record access and that denied attempts are logged.", correct: true },
        { id: "A-V2", label: "Confirm that storage utilization remains below fifty percent.", correct: false },
        { id: "A-V3", label: "Confirm that every employee received the reminder email.", correct: false }
      ],
      residual: "Residual risk remains because authorized users can still misuse legitimate access, so auditing and periodic review remain necessary."
    },
    "TR01-B": {
      id: "TR01-B",
      title: "Unapproved Record Change",
      focus: "security.integrity",
      briefing: "A scholarship eligibility record changed after approval. The service remained available, but the change cannot be tied to one accountable administrator.",
      evidence: [
        { id: "B1", title: "Change history", material: true, provenance: "Application change log", text: "The eligibility value changed from approved to denied at 14:18. The event records a shared administrator account rather than an individual identity." },
        { id: "B2", title: "Administrator review", material: true, provenance: "Identity inventory", text: "Four staff members know the same administrator credential. Multifactor authentication is not required for that shared account." },
        { id: "B3", title: "Network health", material: false, provenance: "Network monitor", text: "Campus latency stayed within normal range during the change window." },
        { id: "B4", title: "Printer ticket", material: false, provenance: "Service desk queue", text: "A nearby office reported a paper jam twenty minutes later." }
      ],
      classification: {
        threat: "unauthorized modification",
        vulnerability: "shared administrator credential",
        likelihood: "possible",
        impact: "high",
        objective: "integrity"
      },
      controls: [
        { id: "B-C1", category: "Identity and change control", label: "Replace the shared administrator account with individual privileged identities, require multifactor authentication, and log approved changes.", correct: true },
        { id: "B-C2", category: "Capacity", label: "Increase application memory without changing administrator access.", correct: false },
        { id: "B-C3", category: "Physical", label: "Move the office printer and leave the shared account active.", correct: false }
      ],
      verification: [
        { id: "B-V1", label: "Confirm that privileged changes identify one administrator, require the approved authentication flow, and appear in the change record.", correct: true },
        { id: "B-V2", label: "Confirm that the printer can produce a test page.", correct: false },
        { id: "B-V3", label: "Confirm that average network latency did not change.", correct: false }
      ],
      residual: "Residual risk remains because privileged users can still make harmful changes, so approval, review, and audit evidence remain necessary."
    },
    "TR01-C": {
      id: "TR01-C",
      title: "Single Service Failure",
      focus: "security.availability",
      briefing: "A required enrollment service stopped responding during a registration period. Evidence shows that one avoidable dependency can interrupt the entire service path.",
      evidence: [
        { id: "C1", title: "Service event", material: true, provenance: "Availability monitor", text: "The enrollment application became unavailable when its only active application instance stopped. No healthy secondary instance was available." },
        { id: "C2", title: "Recovery note", material: true, provenance: "Operations record", text: "An operator restored service manually after twenty seven minutes. The service has no tested automatic failover path." },
        { id: "C3", title: "Access review", material: false, provenance: "Identity governance export", text: "The application owner completed the quarterly access review two days earlier." },
        { id: "C4", title: "Theme request", material: false, provenance: "Product backlog", text: "A user requested a new dark theme for the registration page." }
      ],
      classification: {
        threat: "service interruption",
        vulnerability: "single point of failure",
        likelihood: "possible",
        impact: "high",
        objective: "availability"
      },
      controls: [
        { id: "C-C1", category: "Resilience", label: "Add a tested redundant service path with monitored failover and a documented recovery procedure.", correct: true },
        { id: "C-C2", category: "Confidentiality", label: "Encrypt an already encrypted database again without adding service redundancy.", correct: false },
        { id: "C-C3", category: "Cosmetic", label: "Prioritize the dark theme request and leave the single service dependency unchanged.", correct: false }
      ],
      verification: [
        { id: "C-V1", label: "Simulate loss of the active instance and confirm that service continues through the approved redundant path within the recovery target.", correct: true },
        { id: "C-V2", label: "Confirm that the dark theme appears correctly on one browser.", correct: false },
        { id: "C-V3", label: "Confirm that the quarterly access review is signed.", correct: false }
      ],
      residual: "Residual risk remains because redundant components can still share hidden dependencies, so failover testing and dependency review remain necessary."
    }
  };

  function clamp(value, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function unique(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
  }

  function stableHash(value) {
    var hash = 2166136261;
    var input = String(value || "prim3");
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function missionHistory(progressRow) {
    var mastery = progressRow && progressRow.mastery && typeof progressRow.mastery === "object" ? progressRow.mastery : {};
    var missions = mastery.missions && typeof mastery.missions === "object" ? mastery.missions : {};
    return missions[MISSION_ID] && typeof missions[MISSION_ID] === "object" ? missions[MISSION_ID] : null;
  }

  function conceptScoreMap(progressRow) {
    var mastery = progressRow && progressRow.mastery && typeof progressRow.mastery === "object" ? progressRow.mastery : {};
    var candidates = [
      mastery.concept_mastery,
      mastery.conceptMastery,
      mastery.principles && mastery.principles.concepts
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && typeof candidates[i] === "object" && !Array.isArray(candidates[i])) return candidates[i];
    }
    return {};
  }

  function initialIndependence(progressRow, history) {
    if (history && Number.isFinite(Number(history.independence))) return clamp(history.independence, 0, 100);
    var attempts = Number(progressRow && progressRow.assessment_attempts || 0);
    if (attempts <= 1) return 85;
    if (attempts === 2) return 75;
    return 65;
  }

  function buildReadiness(progressRow, learnerSeed) {
    var score = clamp(progressRow && progressRow.assessment_score, 0, 100);
    var history = missionHistory(progressRow);
    var independence = initialIndependence(progressRow, history);
    var transfer = history && Number.isFinite(Number(history.transfer)) ? clamp(history.transfer, 0, 100) : 50;
    var technical = score >= 70 ? "APPLIED" : "FOUNDATION";
    var scaffolding = score < 65 || independence < 60 ? "HIGH" : (score < 80 || independence < 75 ? "STANDARD" : "LOW");
    var credits = score >= 94 && independence >= 85 ? 2 : (score >= 84 && independence >= 75 ? 1 : 0);
    var conceptScores = conceptScoreMap(progressRow);
    var cia = ["security.confidentiality", "security.integrity", "security.availability"];
    var weakest = cia.filter(function (id) { return Number.isFinite(Number(conceptScores[id])); })
      .sort(function (a, b) { return Number(conceptScores[a]) - Number(conceptScores[b]); });
    var variantIds = ["TR01-A", "TR01-B", "TR01-C"];
    var variantId;
    if (weakest.length && Number(conceptScores[weakest[0]]) < 70) {
      variantId = weakest[0] === cia[0] ? "TR01-A" : (weakest[0] === cia[1] ? "TR01-B" : "TR01-C");
    } else {
      variantId = variantIds[stableHash(String(learnerSeed || "learner") + ":" + String(history && history.attempts || 0)) % variantIds.length];
    }
    return {
      profile_version: "1.0.0",
      mission_id: MISSION_ID,
      principles_readiness: Math.round(score),
      independence: Math.round(independence),
      transfer: Math.round(transfer),
      technical_challenge: technical,
      tactical_challenge: "STORY",
      scaffolding: scaffolding,
      preparation_credits: credits,
      allowed_preparation_advantages: PREPARATION_ADVANTAGES.slice(),
      minimum_required_toolset: REQUIRED_TOOLS.slice(),
      granted_toolset: REQUIRED_TOOLS.slice(),
      variant_id: variantId,
      fairness: {
        required_tools_removed_for_low_mastery: false,
        technical_truth_locked_at_compile: true,
        threat_logic_can_read_hidden_mastery: false
      }
    };
  }

  function normalizeAdvantages(profile, selected) {
    var allowed = profile && profile.allowed_preparation_advantages || [];
    var credits = clamp(profile && profile.preparation_credits, 0, 2);
    return unique(selected).filter(function (id) { return allowed.indexOf(id) !== -1; }).slice(0, credits);
  }

  function availableEvidence(variant, scaffolding, advantages) {
    var material = variant.evidence.filter(function (item) { return item.material; });
    var distractors = variant.evidence.filter(function (item) { return !item.material; });
    var budget = scaffolding === "HIGH" ? 0 : (scaffolding === "STANDARD" ? 1 : 2);
    if (advantages.indexOf("remove-one-nonmaterial-distractor") !== -1) budget = Math.max(0, budget - 1);
    return material.concat(distractors.slice(0, budget));
  }

  function createSession(profile, selectedAdvantages) {
    if (!profile || profile.mission_id !== MISSION_ID) throw new Error("Training Range readiness profile required");
    var variant = VARIANTS[profile.variant_id];
    if (!variant) throw new Error("Approved Training Range variant required");
    var advantages = normalizeAdvantages(profile, selectedAdvantages);
    return {
      mission_id: MISSION_ID,
      variant_id: variant.id,
      stage: "EVIDENCE",
      mission_state: "STABLE",
      window: 8,
      mistakes: 0,
      reviewed_evidence_ids: [],
      evidence_trace_ids: [],
      advantages: advantages,
      control_attempts: 0,
      classification_attempts: 0,
      verification_attempts: 0,
      completed: false,
      failed: false,
      available_evidence: availableEvidence(variant, profile.scaffolding, advantages).map(function (item) { return item.id; })
    };
  }

  function cloneSession(session) {
    return JSON.parse(JSON.stringify(session));
  }

  function stageFailure(session) {
    if (session.window <= 0 && !session.completed) {
      session.window = 0;
      session.failed = true;
      session.stage = "FAILED";
      session.mission_state = "TERMINAL";
    } else if (session.window <= 2 && !session.completed) {
      session.mission_state = "CRITICAL";
    } else if (session.window <= 5 && !session.completed) {
      session.mission_state = "DEGRADED";
    }
    return session;
  }

  function spend(session, correct) {
    session.window -= 1;
    if (!correct) session.mistakes += 1;
    return stageFailure(session);
  }

  function reviewEvidence(session, evidenceId) {
    var next = cloneSession(session);
    if (next.stage !== "EVIDENCE" || next.failed) return next;
    if (next.available_evidence.indexOf(evidenceId) !== -1) {
      next.reviewed_evidence_ids = unique(next.reviewed_evidence_ids.concat([evidenceId]));
    }
    return next;
  }

  function commitObservation(session) {
    var next = cloneSession(session);
    if (next.stage !== "EVIDENCE" || next.failed) return { session: next, correct: false, code: "WRONG_STAGE" };
    var variant = VARIANTS[next.variant_id];
    var required = variant.evidence.filter(function (item) { return item.material; }).map(function (item) { return item.id; });
    var correct = required.every(function (id) { return next.reviewed_evidence_ids.indexOf(id) !== -1; });
    spend(next, correct);
    if (correct && !next.failed) {
      next.evidence_trace_ids = unique(next.evidence_trace_ids.concat(["E-TR01-OBSERVE"]));
      next.stage = "CLASSIFY";
    }
    return { session: next, correct: correct, code: correct ? "OBSERVED" : "MATERIAL_EVIDENCE_MISSING" };
  }

  function classifyRisk(session, answers) {
    var next = cloneSession(session);
    if (next.stage !== "CLASSIFY" || next.failed) return { session: next, correct: false, code: "WRONG_STAGE", fields: [] };
    var variant = VARIANTS[next.variant_id];
    var expected = variant.classification;
    var fields = ["threat", "vulnerability", "likelihood", "impact", "objective"];
    next.classification_attempts += 1;
    var wrong = fields.filter(function (field) { return String(answers && answers[field] || "").toLowerCase() !== String(expected[field]).toLowerCase(); });
    var correct = wrong.length === 0;
    spend(next, correct);
    if (correct && !next.failed) {
      next.evidence_trace_ids = unique(next.evidence_trace_ids.concat(["E-TR01-CLASSIFY"]));
      next.stage = "CONTROL";
    }
    return { session: next, correct: correct, code: correct ? "CLASSIFIED" : "CLASSIFICATION_REJECTED", fields: wrong };
  }

  function chooseControl(session, controlId) {
    var next = cloneSession(session);
    if (next.stage !== "CONTROL" || next.failed) return { session: next, correct: false, code: "WRONG_STAGE" };
    var variant = VARIANTS[next.variant_id];
    var control = variant.controls.find(function (item) { return item.id === controlId; });
    next.control_attempts += 1;
    var correct = Boolean(control && control.correct);
    spend(next, correct);
    if (correct && !next.failed) {
      next.selected_control_id = control.id;
      next.evidence_trace_ids = unique(next.evidence_trace_ids.concat(["E-TR01-CONTROL"]));
      next.stage = "VERIFY";
    }
    return { session: next, correct: correct, code: correct ? "CONTROL_ACCEPTED" : "CONTROL_REJECTED" };
  }

  function verifyControl(session, verificationId) {
    var next = cloneSession(session);
    if (next.stage !== "VERIFY" || next.failed) return { session: next, correct: false, code: "WRONG_STAGE" };
    var variant = VARIANTS[next.variant_id];
    var check = variant.verification.find(function (item) { return item.id === verificationId; });
    next.verification_attempts += 1;
    var correct = Boolean(check && check.correct);
    spend(next, correct);
    if (correct && !next.failed) {
      next.evidence_trace_ids = unique(next.evidence_trace_ids.concat(["E-TR01-VERIFY"]));
      next.completed = true;
      next.stage = "COMPLETE";
      next.mission_state = "STABLE";
    }
    return { session: next, correct: correct, code: correct ? "VERIFIED" : "VERIFICATION_REJECTED" };
  }

  function scoreSession(session) {
    var traces = unique(session && session.evidence_trace_ids || []);
    var technical = Math.round((REQUIRED_TRACES.filter(function (id) { return traces.indexOf(id) !== -1; }).length / REQUIRED_TRACES.length) * 100);
    var mistakes = Number(session && session.mistakes || 0);
    var independence = clamp(100 - mistakes * 15, 0, 100);
    var transfer = session && session.completed ? (Number(session.control_attempts || 0) <= 1 ? 100 : 80) : (traces.indexOf("E-TR01-CONTROL") !== -1 ? 60 : 0);
    var compliance = traces.indexOf("E-TR01-OBSERVE") !== -1 ? (traces.indexOf("E-TR01-VERIFY") !== -1 ? 100 : 70) : 40;
    var operational = clamp(100 - mistakes * 10 - (8 - Number(session && session.window || 0)) * 2, 0, 100);
    if (!(session && session.completed)) operational = Math.min(operational, 59);
    var grade = operational >= 90 ? "A" : (operational >= 80 ? "B" : (operational >= 70 ? "C" : (operational >= 60 ? "D" : "F")));
    return {
      technical_mastery: technical,
      independence: Math.round(independence),
      transfer: Math.round(transfer),
      compliance: Math.round(compliance),
      operational_score: Math.round(operational),
      operational_grade: grade,
      completed: Boolean(session && session.completed),
      failed: Boolean(session && session.failed),
      evidence_trace_ids: traces
    };
  }

  function publicVariant(variantId) {
    var variant = VARIANTS[variantId];
    if (!variant) return null;
    return JSON.parse(JSON.stringify(variant));
  }

  root.PRIM3_RANGE_CORE = Object.freeze({
    missionId: MISSION_ID,
    requiredTools: REQUIRED_TOOLS.slice(),
    preparationAdvantages: PREPARATION_ADVANTAGES.slice(),
    requiredTraces: REQUIRED_TRACES.slice(),
    variants: JSON.parse(JSON.stringify(VARIANTS)),
    buildReadiness: buildReadiness,
    createSession: createSession,
    reviewEvidence: reviewEvidence,
    commitObservation: commitObservation,
    classifyRisk: classifyRisk,
    chooseControl: chooseControl,
    verifyControl: verifyControl,
    scoreSession: scoreSession,
    publicVariant: publicVariant,
    stableHash: stableHash
  });
})(typeof window !== "undefined" ? window : globalThis);
