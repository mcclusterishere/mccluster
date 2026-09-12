(function () {
  "use strict";

  var STORAGE_KEY = "prim3_course_progress_v3";
  var course = null;
  var modules = [];
  var activeId = null;
  var passMark = 80;

  /* The canonical PRIM3 repo publishes 21 episode/song units. McCluster turns
     every unit into three instructional modules: two small source-aligned
     concept clusters plus one infrastructure / CompTIA enrichment bridge.
     Do not collapse separate concept families back into one lesson. */
  var LESSONS = {
    M01: {
      title: "Alert Triage & Monitoring",
      summary: "Start with the smallest possible idea: an alert means investigate, not panic. Learn what monitoring sees, what an alert does and how to decide whether a signal deserves attention.",
      reading: [
        ["An alert is not proof", "Monitoring systems generate signals because a condition crossed a rule, threshold or behavioral expectation. That is a reason to inspect the situation, not a reason to assume the worst explanation is already proven."],
        ["Triage is prioritization", "Triage asks what happened, how reliable the signal is, what could be affected and what should be checked next. Strong responders compare multiple observations before escalating."],
        ["Monitoring is the collection layer", "Logs, sensors, service health, network telemetry and human reports can all contribute observations. The useful habit is to know which source produced a signal and what that source can and cannot prove."],
        ["Confidence comes from corroboration", "One noisy warning can be misleading. Independent supporting evidence raises confidence; contradictory evidence should lower it and change the next question."]
      ],
      terms: [["Alert","A notification that a monitored condition deserves attention."],["Monitoring","Continuous or repeated observation of systems and conditions."],["Triage","Prioritizing what needs attention first using evidence and potential impact."],["Telemetry","Operational data produced by systems, devices, sensors or software."],["Corroboration","Independent evidence that supports or challenges a claim."]],
      quiz: [
        {q:"What does an alert prove by itself?",a:["That an attack definitely happened","Only that a monitored condition deserves attention","That every system is compromised","That the highest-impact explanation is correct"],c:1},
        {q:"What is the purpose of triage?",a:["Delete noisy alerts","Prioritize investigation using evidence and impact","Expand access automatically","Disable every system"],c:1},
        {q:"Which is telemetry?",a:["A router log","A guess with no source","An undocumented rumor","A password policy only"],c:0},
        {q:"What raises confidence in a conclusion?",a:["Repeating the same source","Independent corroborating evidence","Ignoring contradictions","Choosing the scariest explanation"],c:1},
        {q:"What should happen when evidence contradicts the first theory?",a:["Hide the evidence","Adjust the theory and investigate further","Escalate anyway","Stop documenting"],c:1}
      ]
    },
    M02: {
      title: "Scope, Evidence & Search Policy",
      summary: "Now add boundaries. Learn what scope means, why evidence has to be preserved and why technical reachability never automatically creates permission to search.",
      reading: [
        ["Scope defines the boundary", "Scope tells a responder which systems, accounts, spaces, time windows and actions are authorized. A system can be technically reachable and still be outside the work you are allowed to perform."],
        ["Evidence should survive the response", "Relevant logs, camera records, alerts and reports can rotate, change or be overwritten. Preserve the information needed to explain what happened before routine cleanup destroys context."],
        ["Search and access are policy questions", "A technical tool may be capable of reading more than the mission permits. Professional work separates capability from authorization and escalates uncertainty instead of assuming access rights."],
        ["Document the decision trail", "Record what was observed, what was preserved, why an action was taken and where the authority came from. That trail is what makes later review possible."]
      ],
      terms: [["Scope","The defined boundary of authorized work."],["Evidence trail","A documented chain of observations and records supporting a conclusion."],["Authorization","Permission to perform a defined action."],["Retention","How long records or telemetry are preserved."],["Decision trail","Documentation of what was decided and why."]],
      quiz: [
        {q:"A reachable system is outside the approved scope. What should you do?",a:["Test it anyway","Treat reachability as permission","Stay inside the approved boundary and escalate the scope question","Delete the discovery"],c:2},
        {q:"Why preserve evidence early?",a:["Relevant records can rotate or change","It makes systems faster","It replaces authorization","It guarantees attribution"],c:0},
        {q:"What does scope define?",a:["Only the tool brand","Authorized systems, actions and boundaries","The attacker's identity","The final incident severity automatically"],c:1},
        {q:"Why document a decision trail?",a:["So later reviewers can understand the evidence and authority behind actions","To avoid accountability","To remove timestamps","To replace technical logs"],c:0},
        {q:"Capability and authorization are:",a:["Always the same","Separate questions","Only relevant to developers","Irrelevant during response"],c:1}
      ]
    },
    M03: {
      title: "Monitoring Infrastructure & Incident Response",
      summary: "Bridge the song into the real stack: where telemetry comes from, how alerts move, what incident-response workflow does and which infrastructure concepts the music does not have time to teach.",
      reading: [
        ["Where the signals come from", "Endpoints, network devices, applications, identity systems, environmental sensors and cloud services all produce different telemetry. A useful monitoring design knows the source, timestamp, retention window and limits of each record."],
        ["Collection is not the same as analysis", "A logging pipeline can collect large volumes of events while still failing to identify what matters. Monitoring architecture needs collection, normalization, correlation, alerting and a human or automated response workflow."],
        ["Incident response is a process", "A practical response moves through preparation, detection and analysis, containment, eradication, recovery and lessons learned. The exact labels vary by framework, but the idea is consistent: do not jump from alert straight to random action."],
        ["Exam bridge", "For CompTIA-oriented study, connect alerting to operational monitoring, log review, incident handling, change control and troubleshooting. The song is the mnemonic; this module supplies the infrastructure underneath it."]
      ],
      terms: [["Log source","A system or device that produces recorded events."],["Correlation","Relating multiple observations to identify a meaningful pattern."],["Containment","Limiting the spread or impact of an incident."],["Recovery","Returning systems to a trusted operational state."],["Change control","A documented process for planning and reviewing changes."]],
      quiz: [
        {q:"Which sequence best describes a monitoring pipeline?",a:["Collect, normalize/correlate, alert, respond","Alert, delete, guess, reboot","Search, exploit, publish, forget","Encrypt, format, print, archive"],c:0},
        {q:"Why identify the source of telemetry?",a:["Different sources prove different things and have different limits","Every log proves the same thing","Source identity does not matter","It removes the need for timestamps"],c:0},
        {q:"What is containment?",a:["Restoring every system immediately","Limiting incident spread or impact","Deleting the evidence","Writing a marketing report"],c:1},
        {q:"What is the role of the song in this course?",a:["Complete exam coverage","A mnemonic/retention layer reinforced by deeper coursework","A substitute for labs","A replacement for infrastructure study"],c:1},
        {q:"What does change control add to operations?",a:["A documented way to plan and review changes","Automatic permission for any action","A faster CPU","A public IP address"],c:0}
      ]
    },
    M04: {
      title: "White / Grey / Black Hat",
      summary: "Hat colors answer one question: what is the relationship to authorization and intent? Keep that separate from how much information a tester knows about the system.",
      reading: [
        ["Hat color is about authorization and intent", "White-hat activity is performed with authorization for a legitimate security purpose. Grey-hat behavior sits in a more ambiguous authorization space. Black-hat activity is malicious or unauthorized. The key distinction is not technical skill; it is the authority and intent surrounding the action."],
        ["Capability does not create permission", "A person may know how to scan, test or manipulate a system without having the right to do so. Professional security work starts with permission, scope and stop conditions."],
        ["Rules of engagement make permission usable", "Rules of engagement define who is authorized, what may be tested, when testing may happen, which systems are included and what conditions require the activity to stop."],
        ["Do not mix hats with boxes", "A white-hat tester can perform a black-box assessment. A black-hat actor can possess extensive internal knowledge. Hat color and box color describe different dimensions."]
      ],
      terms: [["White hat","Authorized security testing performed for a legitimate defensive purpose."],["Grey hat","Security activity with ambiguous or incomplete authorization, depending on context."],["Black hat","Malicious or unauthorized security activity."],["Rules of engagement","Written constraints governing an authorized assessment."],["Intent","The purpose behind an action."]],
      quiz: [
        {q:"Hat color primarily describes:",a:["How much source code is provided","Authorization and intent","Network speed","Operating-system family"],c:1},
        {q:"Can a white-hat tester perform a black-box assessment?",a:["Yes","No","Only on wireless systems","Only without permission"],c:0},
        {q:"What makes professional testing operationally safe?",a:["Unlimited access","Defined permission, scope and rules of engagement","Hiding findings","Skipping documentation"],c:1},
        {q:"Technical capability automatically provides authority.",a:["True","False","Only for administrators","Only for cloud systems"],c:1},
        {q:"Which term belongs to the authorization/intent dimension?",a:["White hat","White box","Full disk image","Source code"],c:0}
      ]
    },
    M05: {
      title: "White / Grey / Black Box",
      summary: "Box colors answer a different question: how much target knowledge is available to the tester? Learn this independently before combining it with authorization concepts.",
      reading: [
        ["White box means substantial internal knowledge", "A white-box assessment may include architecture details, credentials, source code, configurations, documentation or system images. The purpose is deep visibility, not a statement about the tester's ethics."],
        ["Black box means little or no internal knowledge", "A black-box assessment begins from an external or minimally informed perspective. It can be more realistic in some ways, but it may take longer to discover what a white-box assessor receives up front."],
        ["Grey box sits between them", "Grey-box testing supplies partial knowledge or limited credentials. It can focus testing on a realistic user or partner perspective without exposing every internal detail."],
        ["Knowledge changes coverage", "More internal knowledge can improve code review and configuration coverage. Less knowledge can better test discovery and external exposure. Neither approach is automatically better; the assessment goal determines the right model."]
      ],
      terms: [["White box","Assessment with substantial internal system knowledge."],["Grey box","Assessment with partial internal knowledge or limited access."],["Black box","Assessment with little or no internal system knowledge."],["Attack surface","Reachable components and interfaces exposed to interaction."],["Source code review","Reviewing application code to identify defects or security weaknesses."]],
      quiz: [
        {q:"Box color primarily describes:",a:["Tester ethics","Amount of target knowledge provided","Incident severity","Team color"],c:1},
        {q:"Which is most characteristic of white-box testing?",a:["No internal knowledge","Substantial architecture/source information","Unauthorized access","No documentation"],c:1},
        {q:"Grey-box testing usually provides:",a:["Partial knowledge or limited access","No scope","Unlimited authority","Only physical access"],c:0},
        {q:"Why choose black-box testing?",a:["To emulate a minimally informed external perspective","To guarantee full code coverage","To remove authorization","To avoid defining objectives"],c:0},
        {q:"Hat and box colors should be learned separately because:",a:["They describe different dimensions","They are identical labels","Only one appears in security work","Box colors describe ethics"],c:0}
      ]
    },
    M06: {
      title: "Pen-Test Infrastructure, Scope & Remediation",
      summary: "Now connect hats and boxes to the missing professional machinery: target inventory, scope boundaries, vulnerability workflow, evidence, reporting and remediation.",
      reading: [
        ["A test needs an inventory and boundary", "Before testing, define target systems, owners, network ranges, applications, accounts, excluded assets, test windows and emergency contacts. This converts abstract permission into an operational scope."],
        ["Attack surface is an infrastructure map", "Endpoints, services, ports, identity systems, applications, network paths and cloud resources all create different surfaces. Understanding the underlying architecture helps explain why a finding exists and what fixing it may affect."],
        ["Findings need a lifecycle", "A vulnerability is not finished when it is discovered. It should be validated, documented, prioritized, assigned for remediation, corrected and then retested where appropriate."],
        ["Exam bridge", "CompTIA-oriented study expects more than color vocabulary: authorization, assessment concepts, vulnerability management, reporting, controls and remediation all matter. This module intentionally fills that gap instead of pretending the song covers the whole domain."]
      ],
      terms: [["Target inventory","The defined list of systems and assets included in an assessment."],["Vulnerability management","The lifecycle of identifying, prioritizing, remediating and validating weaknesses."],["Finding","A documented issue supported by evidence."],["Remediation","Corrective work that reduces or removes a weakness."],["Retest","Verification that a remediation actually resolved the finding."]],
      quiz: [
        {q:"What turns general permission into an operational test boundary?",a:["A target inventory and written scope","A fast scanner","A public website","A team color"],c:0},
        {q:"What is an attack surface?",a:["Only open ports","The set of exposed components and interfaces that can be interacted with","A legal contract","A backup schedule"],c:1},
        {q:"A valid finding should normally lead to:",a:["Documentation, prioritization, remediation and validation","Immediate deletion of evidence","Unlimited expansion of scope","No follow-up"],c:0},
        {q:"Why include infrastructure in the course?",a:["It explains what the security concepts are actually operating on","It makes the song longer","It replaces authorization","It removes the need for troubleshooting"],c:0},
        {q:"What is a retest?",a:["Verification that a fix resolved the issue","A second unauthorized target","A new team color","A backup type"],c:0}
      ]
    }
  };

  var state = loadState();
  var els = {
    gate: document.getElementById("courseGate"), course: document.getElementById("course"),
    sync: document.getElementById("courseSync"), source: document.getElementById("courseSource"), feedState: document.getElementById("courseFeedState"),
    list: document.getElementById("moduleList"), empty: document.getElementById("lessonEmpty"), content: document.getElementById("lessonContent"),
    number: document.getElementById("lessonNumber"), title: document.getElementById("lessonTitle"), summary: document.getElementById("lessonSummary"), status: document.getElementById("lessonStatus"),
    season: document.getElementById("lessonSeason"), episode: document.getElementById("lessonEpisode"), song: document.getElementById("lessonSong"),
    objectives: document.getElementById("objectiveList"), concepts: document.getElementById("conceptList"), reading: document.getElementById("readingBody"), terms: document.getElementById("termList"),
    markRead: document.getElementById("markRead"), assessment: document.getElementById("assessmentSection"), assessmentRule: document.getElementById("assessmentRule"), quiz: document.getElementById("quizForm"), submit: document.getElementById("submitQuiz"), result: document.getElementById("quizResult"),
    musicTitle: document.getElementById("musicTitle"), musicCopy: document.getElementById("musicCopy"), watchTitle: document.getElementById("watchTitle"), watchCopy: document.getElementById("watchCopy"), labTitle: document.getElementById("labTitle"), labCopy: document.getElementById("labCopy"), labRoles: document.getElementById("labRoles"), sources: document.getElementById("sourceList"),
    progressPercent: document.getElementById("progressPercent"), progressBar: document.getElementById("progressBar"), passedCount: document.getElementById("passedCount"), moduleCount: document.getElementById("moduleCount"), passMark: document.getElementById("passMark"), continueCourse: document.getElementById("continueCourse"), reset: document.getElementById("resetProgress")
  };

  function h(value) { return String(value == null ? "" : value).replace(/[&<>\"]/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]; }); }
  function loadState() { try { var p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return { read:Array.isArray(p.read)?p.read:[], passed:Array.isArray(p.passed)?p.passed:[], scores:p.scores&&typeof p.scores==="object"?p.scores:{} }; } catch (_) { return {read:[],passed:[],scores:{}}; } }
  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {} }
  function has(list, id) { return list.indexOf(id) !== -1; }
  function lessonReady(id) { return !!LESSONS[id]; }
  function byId(id) { return modules.find(function (m) { return m.id === id; }); }
  function moduleIndex(id) { return modules.findIndex(function (m) { return m.id === id; }); }

  function isUnlocked(index) {
    if (index < 0 || !modules[index]) return false;
    if (index === 0) return true;
    var previous = modules[index - 1];
    if (!lessonReady(previous.id)) return false;
    return has(state.passed, previous.id);
  }

  function stateLabel(module, index) {
    if (module.status === "owner-source-required") return "SOURCE NEEDED";
    if (!lessonReady(module.id)) return isUnlocked(index) ? "BUILDING" : "LOCKED";
    if (has(state.passed, module.id)) return "PASSED";
    if (!isUnlocked(index)) return "LOCKED";
    return has(state.read, module.id) ? "ASSESS" : "OPEN";
  }

  function setSync(ok, label, detail) {
    if (!els.sync) return;
    els.sync.classList.toggle("is-live", !!ok);
    els.sync.classList.toggle("is-error", ok === false);
    els.source.textContent = detail;
    els.feedState.textContent = label;
  }

  function showGate(message) {
    if (els.course) els.course.hidden = true;
    if (els.gate) {
      els.gate.hidden = false;
      var note = els.gate.querySelector("[data-gate-note]");
      if (note && message) note.textContent = message;
    }
  }

  function normalizeCourse(data) {
    var c = data && data.course;
    if (!c || c.id !== "prim3-foundation-v2" || !Array.isArray(c.modules) || c.modules.length !== 63) throw new Error("Unexpected PRIM3 LMS course map");
    return c;
  }

  function fetchCourse() {
    if (!window.MCC || typeof window.MCC.api !== "function") return Promise.reject(new Error("M Account service unavailable"));
    return window.MCC.api("/v1/prim3/course").then(function (r) {
      if (!r.ok) throw Object.assign(new Error("McCluster API " + r.status), {status:r.status});
      return r.json();
    }).then(function (data) {
      course = normalizeCourse(data);
      setSync(true, data.source && data.source.cache === "hit" ? "SYNCED · CACHE" : "SYNCED · LIVE", "21 PRIM3 episode/song units → 63 focused LMS modules");
      return course;
    });
  }

  function renderProgress() {
    var total = modules.length || 63;
    var passed = state.passed.filter(function (id) { return !!byId(id); }).length;
    var pct = total ? Math.round((passed / total) * 100) : 0;
    els.passedCount.textContent = passed; els.moduleCount.textContent = total; els.passMark.textContent = passMark + "%"; els.progressPercent.textContent = pct + "%"; els.progressBar.style.width = pct + "%";
    var next = modules.find(function (m, i) { return lessonReady(m.id) && isUnlocked(i) && !has(state.passed, m.id); });
    if (next) { els.continueCourse.disabled = false; els.continueCourse.dataset.module = next.id; els.continueCourse.textContent = (next.id === "M01" ? "Start " : "Continue ") + next.id; }
    else { delete els.continueCourse.dataset.module; els.continueCourse.disabled = true; var building = modules.find(function (m, i) { return isUnlocked(i) && !lessonReady(m.id); }); els.continueCourse.textContent = building ? building.id + " lesson is in authoring" : "Current coursework complete"; }
  }

  function renderList() {
    els.list.innerHTML = "";
    for (var season = 1; season <= 7; season += 1) {
      var seasonModules = modules.filter(function (m) { return Number(m.season) === season; });
      if (!seasonModules.length) continue;
      var wrap = document.createElement("section"); wrap.className = "p3-season";
      var passed = seasonModules.filter(function (m) { return has(state.passed, m.id); }).length;
      var head = document.createElement("div"); head.className = "p3-season__head"; head.innerHTML = "<span>Season " + season + "</span><span>" + passed + "/" + seasonModules.length + " passed</span>"; wrap.appendChild(head);
      var currentUnit = null;
      seasonModules.forEach(function (module) {
        if (module.unit_id !== currentUnit) {
          currentUnit = module.unit_id;
          var unit = document.createElement("div"); unit.className = "p3-unit-label"; unit.innerHTML = "<b>" + h(module.unit_id) + " · " + h(module.song || "Owner Song #21") + "</b><span>" + h(module.episode_id) + " · " + h(module.episode_title) + "</span>"; wrap.appendChild(unit);
        }
        var index = moduleIndex(module.id), label = stateLabel(module, index);
        var button = document.createElement("button"); button.type = "button"; button.className = "p3-module";
        if (label === "PASSED") button.classList.add("is-passed"); if (label === "OPEN" || label === "ASSESS") button.classList.add("is-open"); if (label === "BUILDING" || label === "SOURCE NEEDED") button.classList.add("is-building"); if (activeId === module.id) button.classList.add("is-current");
        button.disabled = !isUnlocked(index) && label !== "SOURCE NEEDED";
        button.innerHTML = '<span class="p3-module__no">' + h(module.id) + '</span><span class="p3-module__title"><b>' + h(module.title) + '</b><small>' + h(module.part_label) + '</small></span><span class="p3-module__state">' + h(label) + '</span>';
        button.addEventListener("click", function () { openModule(module.id, true); }); wrap.appendChild(button);
      });
      els.list.appendChild(wrap);
    }
  }

  function renderReading(module, lesson) {
    var section = els.reading.closest(".p3-reading"); section.classList.toggle("is-building", !lesson);
    if (!lesson) {
      els.reading.innerHTML = '<div class="p3-build-note"><b>Focused lesson is still in authoring.</b><br>This slot is intentionally visible so the curriculum stays granular. PRIM3 supplies the episode/song source; McCluster will not issue credit until the conventional reading and assessment for this exact concept cluster are reviewed.</div>';
      els.terms.innerHTML = ""; els.markRead.disabled = true; els.markRead.textContent = "Reading in authoring"; return;
    }
    els.reading.innerHTML = lesson.reading.map(function (s) { return "<h3>" + h(s[0]) + "</h3><p>" + h(s[1]) + "</p>"; }).join("");
    els.terms.innerHTML = lesson.terms.map(function (t) { return "<dt>" + h(t[0]) + "</dt><dd>" + h(t[1]) + "</dd>"; }).join("");
    var read = has(state.read, module.id); els.markRead.disabled = read; els.markRead.textContent = read ? "Reading complete ✓" : "Mark reading complete"; els.markRead.classList.toggle("is-done", read);
  }

  function renderQuiz(module, lesson) {
    els.assessment.classList.toggle("is-building", !lesson);
    if (!lesson) { els.assessmentRule.textContent = "Assessment not published. No credit is issued until this focused LEARN module is authored and reviewed."; els.quiz.innerHTML = ""; els.result.textContent = ""; els.submit.disabled = true; return; }
    els.assessmentRule.textContent = "Score at least " + passMark + "% to pass this focused module and unlock the next one.";
    var read = has(state.read, module.id), passed = has(state.passed, module.id);
    els.quiz.innerHTML = lesson.quiz.map(function (q, qi) { return '<fieldset class="p3-question"><legend>' + (qi+1) + '. ' + h(q.q) + '</legend>' + q.a.map(function (a, ai) { return '<label><input type="radio" name="q'+qi+'" value="'+ai+'" '+(read?"":"disabled")+'><span>'+h(a)+'</span></label>'; }).join("") + '</fieldset>'; }).join("");
    els.submit.disabled = !read || passed; els.submit.textContent = passed ? "Module passed" : "Grade assessment"; els.result.textContent = !read ? "Complete the required reading to unlock the assessment." : (state.scores[module.id] != null ? "Best score: " + state.scores[module.id] + "%" : ""); els.result.className = state.scores[module.id] >= passMark ? "pass" : (state.scores[module.id] != null ? "fail" : "");
  }

  function renderCompanions(module) {
    els.musicTitle.textContent = module.song || "Owner Song #21 · protected open slot";
    els.musicCopy.textContent = module.song ? "REMEMBER: replay the song after this focused lesson. It is reinforcement, not a substitute for the coursework." : "No song is invented here. This source unit stays protected until the owner supplies Song #21.";
    els.watchTitle.textContent = module.episode_title; els.watchCopy.textContent = "WATCH: the canonical episode places this unit's concepts under story and operational pressure.";
    var labNames = module.labs ? Object.keys(module.labs).map(function (k) { return module.labs[k]; }) : [];
    els.labTitle.textContent = labNames.length ? "LAB · " + labNames.length + " role applications" : "LAB · awaiting source"; els.labCopy.textContent = labNames.length ? "Apply the ideas only in fictional, local, owned or explicitly authorized environments." : "No lab is assigned until the source exists.";
    els.labRoles.innerHTML = ["field_r","field_e","field_t"].map(function (key) { var labels={field_r:"FIELD-R · PICTURE",field_e:"FIELD-E · CONTROL",field_t:"FIELD-T · SYSTEM"}; return '<div><small>'+labels[key]+'</small><b>'+h((module.labs&&module.labs[key])||"Not assigned")+'</b></div>'; }).join("");
  }

  function openModule(id, scroll) {
    var module = byId(id), index = moduleIndex(id); if (!module || (!isUnlocked(index) && module.status !== "owner-source-required")) return;
    activeId = id; var lesson = LESSONS[id] || null; els.empty.hidden = true; els.content.hidden = false;
    els.number.textContent = "Module " + module.id + " · " + module.unit_id + " · Part " + module.part + "/3"; els.title.textContent = lesson ? lesson.title : module.title; els.summary.textContent = lesson ? lesson.summary : "This focused module is reserved in the 63-module curriculum. Its source concepts are mapped, but the conventional LEARN reading and assessment are still being authored.";
    els.season.textContent = "Season " + module.season; els.episode.textContent = module.episode_id; els.song.textContent = module.song ? "Song · " + module.song : "Song · Open slot";
    var label = stateLabel(module, index); els.status.textContent = label; els.status.classList.toggle("is-passed", label === "PASSED");
    els.objectives.innerHTML = (module.objectives || []).length ? module.objectives.map(function (o) { return "<li>" + h(o) + "</li>"; }).join("") : "<li>Awaiting owner source.</li>";
    els.concepts.innerHTML = (module.concepts || []).length ? module.concepts.map(function (c) { return "<span>" + h(c) + "</span>"; }).join("") : "<span>Protected open slot</span>";
    if (module.exam_alignment && module.exam_alignment.length) els.concepts.innerHTML += module.exam_alignment.map(function (e) { return '<span class="is-exam">Exam bridge · ' + h(e) + '</span>'; }).join("");
    renderReading(module, lesson); renderQuiz(module, lesson); renderCompanions(module); els.sources.innerHTML = (module.sources || []).map(function (s) { return "<li>" + h(s) + "</li>"; }).join(""); renderList(); if (scroll) document.getElementById("lessonPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }

  function markReading() { if (!activeId || !LESSONS[activeId] || has(state.read, activeId)) return; state.read.push(activeId); saveState(); openModule(activeId, false); }
  function gradeQuiz(event) {
    event.preventDefault(); var lesson=LESSONS[activeId], module=byId(activeId); if (!lesson || !module || !has(state.read, activeId)) return;
    var correct=0, answered=0; lesson.quiz.forEach(function(q,qi){var picked=els.quiz.querySelector('input[name="q'+qi+'"]:checked'); if(picked){answered+=1;if(Number(picked.value)===q.c)correct+=1;}});
    if(answered!==lesson.quiz.length){els.result.textContent="Answer every question before grading.";els.result.className="fail";return;}
    var score=Math.round((correct/lesson.quiz.length)*100); var previous=Number(state.scores[activeId]); state.scores[activeId]=Number.isFinite(previous)?Math.max(previous,score):score; if(score>=passMark&&!has(state.passed,activeId))state.passed.push(activeId); saveState(); renderProgress(); renderList(); openModule(activeId,false); els.result.textContent=score>=passMark?"Passed: "+score+"%. The next focused module is unlocked.":"Score: "+score+"%. Review this concept cluster and retake the assessment."; els.result.className=score>=passMark?"pass":"fail";
  }

  function wireCourse() {
    els.markRead.addEventListener("click", markReading); els.quiz.addEventListener("submit", gradeQuiz); els.continueCourse.addEventListener("click", function(){if(this.dataset.module)openModule(this.dataset.module,true);});
    els.reset.addEventListener("click", function(){if(!window.confirm("Reset all PRIM3 course progress for this account on this device?"))return; state={read:[],passed:[],scores:{}};saveState();activeId=null;els.content.hidden=true;els.empty.hidden=false;renderProgress();renderList();});
  }

  function start() {
    if (!window.MCC || typeof window.MCC.user !== "function") { showGate("Account service is still loading. Refresh in a moment."); return; }
    window.MCC.user().then(function (user) {
      if (!user) { showGate("Create or sign in to your free M Account to start PRIM3. The course itself is free."); return; }
      if (els.gate) els.gate.hidden = true; if (els.course) els.course.hidden = false; wireCourse();
      return fetchCourse().then(function (loaded) {
        modules = loaded.modules.slice().sort(function(a,b){return Number(a.sequence)-Number(b.sequence);}); passMark=Number(loaded.pass_mark||80); renderProgress(); renderList(); var next=modules.find(function(m,i){return lessonReady(m.id)&&isUnlocked(i)&&!has(state.passed,m.id);})||modules[0]; openModule(next.id,false);
      });
    }).catch(function (error) {
      if (error && error.status === 401) { showGate("Your M Account session expired. Sign in again to continue the free course."); return; }
      if (els.course) els.course.hidden = false; if (els.gate) els.gate.hidden = true; setSync(false,"OFFLINE","Course service unavailable"); els.list.innerHTML='<p class="p3-source-error"><b>PRIM3 course map could not load.</b><br>'+h(error&&error.message?error.message:"Unknown course error")+'</p>'; els.continueCourse.disabled=true;els.continueCourse.textContent="Course unavailable";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
})();
