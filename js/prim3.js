(function () {
  "use strict";

  var STORAGE_KEY = "prim3_course_progress_v2";
  var API_URL = "https://api.mccluster.org/v1/prim3/course";
  var FALLBACK_URL = "https://raw.githubusercontent.com/mcclusterishere/Prim3/main/learning/course/course-feed.json";
  var course = null;
  var modules = [];
  var activeId = null;
  var passMark = 80;

  /* Conventional lessons are authored in McCluster; canonical module identity,
     objectives, songs, episodes and labs come from PRIM3. Never manufacture
     a lesson merely because a story module exists. */
  var LESSONS = {
    M01: {
      title: "High Alert: Triage, Scope & Evidence",
      summary: "Build the basic incident-response habit: observe first, correlate evidence, establish a safe boundary, and preserve the detail that matters before acting.",
      reading: [
        ["Alert is a decision state, not proof", "An alert tells you that something deserves attention. It does not prove the first explanation is correct. PRIM3's opening lab deliberately gives multiple weak signals and requires correlation before escalation. The professional habit is to compare evidence, rank confidence and document why an event deserves priority."],
        ["Scope keeps response controlled", "A responder needs to know what system, property, account or process is actually under review. Scope prevents a legitimate response from becoming an uncontrolled search. When scope is uncertain, preserve evidence and escalate the authorization question instead of treating access as unlimited."],
        ["Preserve before cleanup", "Logs, camera records, environmental alarms and staff reports can rotate out or be overwritten. The technical task is not to collect everything forever; it is to identify and preserve the telemetry that supports or disproves the incident picture."],
        ["Professional judgment", "The R/E/T labs divide the problem into picture, physical safety and technical preservation. A strong response coordinates those functions instead of letting one urgent signal consume the entire operation."]
      ],
      terms: [["Alert triage","Prioritizing alerts using relevance, confidence and potential impact."],["Scope","The defined boundary of authorized work or investigation."],["Evidence trail","The documented chain of observations and records supporting a conclusion."],["Telemetry","Recorded operational data from systems, sensors, logs or monitoring tools."],["Confidence","How strongly the available evidence supports a conclusion."]],
      quiz: [
        {q:"What should happen before a weak alert is treated as confirmed?",a:["Delete unrelated logs","Correlate it with supporting evidence","Expand scope automatically","Assume the highest-impact explanation"],c:1},
        {q:"Why does scope matter during response?",a:["It defines authorized boundaries","It guarantees every alert is real","It replaces evidence","It increases network speed"],c:0},
        {q:"What is the goal of preserving telemetry?",a:["Store every byte forever","Keep relevant evidence before it rotates out or changes","Avoid documenting decisions","Disable all systems"],c:1},
        {q:"Which PRIM3 function focuses most directly on the incident picture and warning?",a:["Field-R","Field-E","Field-T","None"],c:0},
        {q:"A safe first response to uncertainty is to:",a:["Act outside scope","Preserve evidence and escalate the authorization question","Erase noisy records","Treat inference as fact"],c:1}
      ]
    },
    M02: {
      title: "Authorization, Hats & Testing Knowledge",
      summary: "Separate authorization and intent from testing knowledge, then use rules of engagement to keep technical capability inside a professional mission.",
      reading: [
        ["Hats and boxes answer different questions", "Hat color describes the relationship to authorization and intent. Box color describes how much information a tester receives about the target. An authorized white-hat tester can perform a black-box assessment; the terms are not interchangeable."],
        ["Permission is operational", "The PRIM3 mission model treats authorization as gameplay rather than an invisible wall. A system can be technically reachable and still be out of scope. Capability is not authority."],
        ["Rules of engagement", "Professional testing begins with written boundaries: what may be tested, when, by whom, with which techniques and under which stop conditions. Findings are documented so they can become remediation rather than uncontrolled action."],
        ["Scope states", "PRIM3's Permission Slip mission formalizes AUTHORIZED, OBSERVE-ONLY, OUT-OF-SCOPE, EMERGENCY-ELIGIBLE and UNKNOWN-SCOPE. Those states force the learner to distinguish what can be done from what may be done and what is actually known."]
      ],
      terms: [["Authorization","Explicit permission to perform the agreed security activity."],["Rules of engagement","Written constraints that define an authorized assessment."],["White box","Testing with substantial internal system knowledge."],["Black box","Testing with little or no internal knowledge."],["Attack surface","The set of reachable components and interfaces that may be exposed to interaction."],["Remediation","Corrective work that reduces or removes a documented weakness."]],
      quiz: [
        {q:"What most clearly separates an authorized white-hat mission from hostile activity?",a:["The operating system","Permission and defined scope","A public IP address","Source-code access"],c:1},
        {q:"What does a box color primarily describe?",a:["Tester intent","How much target knowledge is provided","Finding severity","Team seniority"],c:1},
        {q:"A system is technically reachable but marked OUT-OF-SCOPE. What is the professional action?",a:["Test it anyway","Treat reachability as permission","Do not interact beyond the agreed boundary","Hide the discovery"],c:2},
        {q:"Which phrase captures the lesson's central distinction?",a:["Capability is authority","Capability is not authority","Knowledge replaces scope","Scope replaces evidence"],c:1},
        {q:"What should follow a valid finding?",a:["Uncontrolled exploitation","Documentation and remediation","Deletion of evidence","Automatic public disclosure"],c:1}
      ]
    },
    M03: {
      title: "OSINT & Information Boundaries",
      summary: "Collect from openly available sources, preserve provenance, corroborate important claims and keep open-source work separate from unauthorized access.",
      reading: [
        ["Open-source intelligence", "PRIM3's OSINT source explicitly begins with public sources, social media and forums. The important boundary is availability: OSINT uses information lawfully available from open sources; bypassing access controls is not ordinary open-source collection."],
        ["Collection is not verification", "A public claim can be wrong, stale, duplicated, manipulated or stripped of context. Record where it came from and compare it against independent evidence before turning it into an intelligence judgment."],
        ["Provenance and confidence", "Analysts need a traceable source trail. Provenance captures where a fact came from; confidence communicates how strongly the evidence supports the conclusion. The PRIM3 lab makes the learner assign confidence instead of treating every item as equally reliable."],
        ["Minimize the collection", "Gather what the defined requirement needs. More information is not automatically better intelligence, especially when it adds irrelevant personal data or obscures the facts that actually answer the question."]
      ],
      terms: [["OSINT","Intelligence produced from publicly or openly available information."],["Primary source","A source closest to the original event, record, statement or dataset."],["Corroboration","Checking an important claim against independent evidence."],["Provenance","A record of where information came from and how it was collected."],["Confidence","A stated level of certainty based on source quality and corroboration."]],
      quiz: [
        {q:"Which description best matches OSINT?",a:["Any data reachable with a browser","Information collected from public/open sources","Only social-media content","Private data obtained without attribution"],c:1},
        {q:"Which action crosses the boundary of this lesson?",a:["Reading a public advisory","Checking an official record","Bypassing a login to obtain restricted data","Comparing two public reports"],c:2},
        {q:"Why preserve provenance?",a:["To support verification and source tracing","To make a report longer","To avoid primary sources","To hide collection dates"],c:0},
        {q:"A public post makes an important claim. What should happen next?",a:["Treat public availability as proof","Corroborate it with reliable evidence","Delete its source information","Assume it is current"],c:1},
        {q:"What should determine how much information is collected?",a:["The defined collection requirement","Whatever is easiest to scrape","The number of tools available","How interesting the target seems"],c:0}
      ]
    },
    M04: {
      title: "The Human Layer: Social Engineering Defense",
      summary: "Recognize manipulation, verify identity and claims, preserve suspicious communications and keep verification proportional to the evidence.",
      reading: [
        ["People are part of the system", "Social engineering targets trust, urgency, authority, familiarity and routine. A secure technical system can still be exposed when a person is pushed into accepting an unverified claim."],
        ["Verify the claim, not the pressure", "Phishing, smishing, pretexts and spoofed identities try to make verification feel inconvenient or urgent. The defensive response is to use an independent trusted channel and confirm the person, request and authority before acting."],
        ["Do not create a second incident", "PRIM3's Field-E lab emphasizes verification without panic. Indiscriminate lockdown or public accusations can disrupt operations and expose innocent people. Verification should be controlled, documented and proportional."],
        ["Preserve evidence", "Suspicious messages and account events may be needed for investigation. Classify and isolate the risk while retaining useful evidence rather than immediately destroying the material that explains what happened."]
      ],
      terms: [["Social engineering","Manipulating people or social processes to obtain access, information or action."],["Phishing","Deceptive messaging intended to induce a recipient to reveal information or take an unsafe action."],["Smishing","Phishing delivered through SMS or similar text messaging."],["Pretext","A fabricated scenario used to make a request appear legitimate."],["Spoofing","Making an identity, address or signal appear to come from a trusted source."],["Independent verification","Confirming a claim through a separate trusted channel."]],
      quiz: [
        {q:"What is the safest response to an urgent identity claim?",a:["Trust urgency","Verify through an independent trusted channel","Forward it widely","Disable all accounts"],c:1},
        {q:"What is a pretext?",a:["A fabricated scenario supporting a deceptive request","A network cable","A backup site","An encryption algorithm"],c:0},
        {q:"Why avoid indiscriminate lockdown during verification?",a:["It can create unnecessary operational and human consequences","It makes passwords longer","It prevents logging","It guarantees the attacker leaves"],c:0},
        {q:"What should happen to a suspicious message needed for investigation?",a:["Destroy it immediately","Preserve relevant evidence while isolating risk","Reply with credentials","Publish it"],c:1},
        {q:"Which layer does social engineering primarily exploit?",a:["Human trust and process","Only fiber optics","Only storage arrays","Only CPU scheduling"],c:0}
      ]
    },
    M05: {
      title: "Security Team Roles & Exercise Control",
      summary: "Know who is attacking, defending, building, coordinating and refereeing an exercise—and know when a real incident means the exercise must stop.",
      reading: [
        ["Red and blue", "The PRIM3 team-role source describes Red as offense and Blue as defense. Red models adversary behavior inside an authorized exercise; Blue protects, detects and responds."],
        ["Purple is the learning bridge", "Purple work connects offensive observations with defensive telemetry and remediation. The point is not merely to run two teams at once; it is to make the defensive system measurably better because the exercise happened."],
        ["White controls the exercise", "The source frames White Team as the rule/referee function. Exercise control defines boundaries, distinguishes planned injects from real incidents and has authority to stop or redirect an exercise when safety or reality requires it."],
        ["Builders matter too", "The song also introduces Yellow as developers, Orange as offensive security development and Green as defensive security development. The important lesson is functional responsibility: builders, testers and defenders contribute different evidence and controls."]
      ],
      terms: [["Red team","Authorized offensive security function that emulates adversary behavior."],["Blue team","Defensive function focused on prevention, detection and response."],["Purple team","Collaborative practice that converts offensive findings into defensive improvement."],["White team","Exercise-control/referee function responsible for rules and deconfliction."],["Deconfliction","Separating planned exercise activity from real incidents or unrelated operations."],["After-action learning","Structured review that turns exercise evidence into improvements."]],
      quiz: [
        {q:"Which team is primarily defensive?",a:["Red","Blue","Purple","White"],c:1},
        {q:"What is the purpose of purple-team work?",a:["Replace Blue","Connect offensive findings to defensive improvement","Approve budgets","Run payroll"],c:1},
        {q:"Who controls rules and deconfliction in the PRIM3 team model?",a:["White Team","Red Team","Yellow Team","Green Team"],c:0},
        {q:"A real incident begins during an exercise. What must the organization be able to do?",a:["Keep pretending it is simulated","Distinguish reality from the exercise and re-role responders","Delete telemetry","Ignore safety"],c:1},
        {q:"What makes an exercise valuable after it ends?",a:["After-action learning and remediation","More simulated alerts only","Keeping findings secret from defenders","Removing all scope"],c:0}
      ]
    },
    M06: {
      title: "Wireless Defense: Signal, Service & Trust",
      summary: "Separate radio signal from usable service, identify unauthorized wireless infrastructure and restore an approved responder path safely.",
      reading: [
        ["Signal is not service", "A device can show strong radio coverage and still fail authentication, backhaul, routing or service dependencies. PRIM3's Dead Air lab deliberately separates the physical presence of signal from a working trusted channel."],
        ["Authorized coverage", "A rogue access point is wireless infrastructure that is not authorized for the environment. An evil-twin scenario imitates a trusted network identity. Defenders need an inventory of approved infrastructure plus monitoring that can identify unexpected sources."],
        ["Wireless protection", "The PRIM3 source names WPA3, AES and WIPS as defensive concepts. At this level, know their roles: authentication/encryption protect the connection and traffic, while wireless monitoring helps discover suspicious devices, interference or policy violations."],
        ["Restore the whole path", "A trusted responder channel needs viable radio coverage, power, backhaul and authentication. Fixing only the strongest visible signal is not enough; validate the connection end to end."]
      ],
      terms: [["Rogue access point","An unauthorized wireless access point in an environment."],["Evil twin","A deceptive wireless network designed to resemble a trusted network."],["WPA3","A modern Wi-Fi security standard for authentication and traffic protection."],["WIPS","Wireless intrusion prevention system used to detect and respond to suspicious wireless activity."],["Backhaul","The network path connecting an access network to upstream services."],["Spectrum","The range of radio frequencies used for wireless communication."]],
      quiz: [
        {q:"Strong Wi-Fi bars but failed authentication demonstrate what distinction?",a:["Signal is not the same as service","Every access point is trusted","WPA3 removes backhaul","Radio equals routing"],c:0},
        {q:"What is a rogue access point?",a:["Any WPA3 network","An unauthorized access point","A wired switch","A DNS record"],c:1},
        {q:"What is the defensive concern with an evil twin?",a:["It can imitate a trusted wireless network","It always has weak signal","It requires fiber","It prevents all monitoring"],c:0},
        {q:"Which source-named control monitors suspicious wireless activity?",a:["WIPS","RAID 1","CapEx","SaaS"],c:0},
        {q:"What should be validated after restoring a responder channel?",a:["Only signal strength","The end-to-end path including authentication and backhaul","Only the SSID spelling","Only device battery"],c:1}
      ]
    }
  };

  var state = loadState();
  var els = {
    sync: document.getElementById("courseSync"), source: document.getElementById("courseSource"), feedState: document.getElementById("courseFeedState"),
    list: document.getElementById("moduleList"), empty: document.getElementById("lessonEmpty"), content: document.getElementById("lessonContent"),
    number: document.getElementById("lessonNumber"), title: document.getElementById("lessonTitle"), summary: document.getElementById("lessonSummary"), status: document.getElementById("lessonStatus"),
    season: document.getElementById("lessonSeason"), episode: document.getElementById("lessonEpisode"), song: document.getElementById("lessonSong"),
    objectives: document.getElementById("objectiveList"), concepts: document.getElementById("conceptList"), reading: document.getElementById("readingBody"), terms: document.getElementById("termList"),
    markRead: document.getElementById("markRead"), assessment: document.getElementById("assessmentSection"), assessmentRule: document.getElementById("assessmentRule"), quiz: document.getElementById("quizForm"), submit: document.getElementById("submitQuiz"), result: document.getElementById("quizResult"),
    musicTitle: document.getElementById("musicTitle"), musicCopy: document.getElementById("musicCopy"), watchTitle: document.getElementById("watchTitle"), watchCopy: document.getElementById("watchCopy"), labTitle: document.getElementById("labTitle"), labCopy: document.getElementById("labCopy"), labRoles: document.getElementById("labRoles"), sources: document.getElementById("sourceList"),
    progressPercent: document.getElementById("progressPercent"), progressBar: document.getElementById("progressBar"), passedCount: document.getElementById("passedCount"), moduleCount: document.getElementById("moduleCount"), passMark: document.getElementById("passMark"), continueCourse: document.getElementById("continueCourse"), reset: document.getElementById("resetProgress")
  };

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { read: Array.isArray(parsed.read) ? parsed.read : [], passed: Array.isArray(parsed.passed) ? parsed.passed : [], scores: parsed.scores && typeof parsed.scores === "object" ? parsed.scores : {} };
    } catch (e) { return { read: [], passed: [], scores: {} }; }
  }
  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }
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
    if (module.status === "owner-source-required") return "OPEN SLOT";
    if (!lessonReady(module.id)) return isUnlocked(index) ? "BUILDING" : "LOCKED";
    if (has(state.passed, module.id)) return "PASSED";
    if (!isUnlocked(index)) return "LOCKED";
    return has(state.read, module.id) ? "ASSESS" : "OPEN";
  }

  function setSync(ok, label, detail) {
    els.sync.classList.toggle("is-live", !!ok);
    els.sync.classList.toggle("is-error", ok === false);
    els.source.textContent = detail;
    els.feedState.textContent = label;
  }

  function normalizeFeed(payload) {
    var c = payload && payload.course ? payload.course : null;
    if (!c || c.id !== "prim3-foundation" || !Array.isArray(c.modules) || c.modules.length !== 21) throw new Error("Unexpected PRIM3 course feed");
    return c;
  }

  function fetchCourse() {
    return fetch(API_URL, { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("McCluster API " + r.status); return r.json(); })
      .then(function (data) {
        course = normalizeFeed(data.course ? data : {course:data});
        setSync(true, data.source && data.source.cache === "hit" ? "SYNCED · CACHE" : "SYNCED · LIVE", "PRIM3 main → McCluster API");
        return course;
      })
      .catch(function () {
        return fetch(FALLBACK_URL, { headers: { accept: "application/json" } })
          .then(function (r) { if (!r.ok) throw new Error("PRIM3 fallback " + r.status); return r.json(); })
          .then(function (data) {
            course = normalizeFeed(data);
            setSync(false, "DIRECT FALLBACK", "PRIM3 main · McCluster API preview not deployed yet");
            return course;
          });
      });
  }

  function renderProgress() {
    var total = modules.length || 21;
    var passed = state.passed.filter(function (id) { return !!byId(id); }).length;
    var pct = total ? Math.round((passed / total) * 100) : 0;
    els.passedCount.textContent = passed;
    els.moduleCount.textContent = total;
    els.passMark.textContent = passMark + "%";
    els.progressPercent.textContent = pct + "%";
    els.progressBar.style.width = pct + "%";
    var next = modules.find(function (m, i) { return lessonReady(m.id) && isUnlocked(i) && !has(state.passed, m.id); });
    if (next) {
      els.continueCourse.disabled = false;
      els.continueCourse.dataset.module = next.id;
      els.continueCourse.textContent = (next.id === "M01" ? "Start " : "Continue ") + next.id;
    } else {
      delete els.continueCourse.dataset.module;
      els.continueCourse.disabled = true;
      var firstBuilding = modules.find(function (m, i) { return isUnlocked(i) && !lessonReady(m.id); });
      els.continueCourse.textContent = firstBuilding ? firstBuilding.id + " lesson is in authoring" : "Current coursework complete";
    }
  }

  function renderList() {
    els.list.innerHTML = "";
    for (var season = 1; season <= 7; season += 1) {
      var seasonModules = modules.filter(function (m) { return Number(m.season) === season; });
      if (!seasonModules.length) continue;
      var wrap = document.createElement("section"); wrap.className = "p3-season";
      var passed = seasonModules.filter(function (m) { return has(state.passed, m.id); }).length;
      var head = document.createElement("div"); head.className = "p3-season__head";
      head.innerHTML = "<span>Season " + season + "</span><span>" + passed + "/" + seasonModules.length + " passed</span>";
      wrap.appendChild(head);
      seasonModules.forEach(function (module) {
        var index = moduleIndex(module.id), label = stateLabel(module, index);
        var button = document.createElement("button");
        button.type = "button"; button.className = "p3-module";
        if (label === "PASSED") button.classList.add("is-passed");
        if (label === "OPEN" || label === "ASSESS") button.classList.add("is-open");
        if (label === "BUILDING" || label === "OPEN SLOT") button.classList.add("is-building");
        if (activeId === module.id) button.classList.add("is-current");
        button.disabled = !isUnlocked(index) && label !== "OPEN SLOT";
        var subtitle = (module.song || "Owner Song #21") + " · " + module.episode_title;
        button.innerHTML = '<span class="p3-module__no">' + module.id + '</span><span class="p3-module__title"><b>' + module.episode_title + '</b><small>' + subtitle + '</small></span><span class="p3-module__state">' + label + '</span>';
        button.addEventListener("click", function () { openModule(module.id, true); });
        wrap.appendChild(button);
      });
      els.list.appendChild(wrap);
    }
  }

  function renderReading(module, lesson) {
    var readingSection = els.reading.closest(".p3-reading");
    readingSection.classList.toggle("is-building", !lesson);
    if (!lesson) {
      els.reading.innerHTML = '<div class="p3-build-note"><b>Conventional lesson not published yet.</b><br>The PRIM3 repository is already supplying this module’s canonical concepts, objectives, episode, song and lab map. McCluster will not invent a test until the LEARN layer is authored and reviewed.</div>';
      els.terms.innerHTML = "";
      els.markRead.disabled = true;
      els.markRead.textContent = "Reading in authoring";
      return;
    }
    els.reading.innerHTML = lesson.reading.map(function (s) { return "<h3>" + s[0] + "</h3><p>" + s[1] + "</p>"; }).join("");
    els.terms.innerHTML = lesson.terms.map(function (t) { return "<dt>" + t[0] + "</dt><dd>" + t[1] + "</dd>"; }).join("");
    var read = has(state.read, module.id);
    els.markRead.disabled = read;
    els.markRead.textContent = read ? "Reading complete ✓" : "Mark reading complete";
    els.markRead.classList.toggle("is-done", read);
  }

  function renderQuiz(module, lesson) {
    els.assessment.classList.toggle("is-building", !lesson);
    if (!lesson) {
      els.assessmentRule.textContent = "Assessment not published. This module cannot issue credit until the conventional LEARN layer is complete.";
      els.quiz.innerHTML = ""; els.result.textContent = ""; els.submit.disabled = true;
      return;
    }
    els.assessmentRule.textContent = "Score at least " + passMark + "% to pass this module and unlock the next module.";
    var read = has(state.read, module.id), passed = has(state.passed, module.id);
    els.quiz.innerHTML = lesson.quiz.map(function (q, qi) {
      return '<fieldset class="p3-question"><legend>' + (qi + 1) + '. ' + q.q + '</legend>' + q.a.map(function (a, ai) {
        return '<label><input type="radio" name="q' + qi + '" value="' + ai + '" ' + (read ? "" : "disabled") + '><span>' + a + '</span></label>';
      }).join("") + '</fieldset>';
    }).join("");
    els.submit.disabled = !read || passed;
    els.submit.textContent = passed ? "Module passed" : "Grade assessment";
    els.result.textContent = !read ? "Complete the required reading to unlock the assessment." : (state.scores[module.id] != null ? "Last score: " + state.scores[module.id] + "%" : "");
    els.result.className = state.scores[module.id] >= passMark ? "pass" : (state.scores[module.id] != null ? "fail" : "");
  }

  function renderCompanions(module) {
    els.musicTitle.textContent = module.song || "Owner Song #21 · protected open slot";
    els.musicCopy.textContent = module.song ? "Retention layer: replay the song after study to rehearse this module’s vocabulary and mental model." : "No song is invented here. PRIM3 keeps this slot open until the owner supplies Song #21.";
    els.watchTitle.textContent = module.episode_title;
    els.watchCopy.textContent = "Narrative layer: the canonical episode applies the same concept set through character pressure and operational consequence.";
    var labNames = module.labs ? Object.keys(module.labs).map(function (k) { return module.labs[k]; }) : [];
    els.labTitle.textContent = labNames.length ? "PLAY · " + labNames.length + " role applications" : "LAB · awaiting source";
    els.labCopy.textContent = labNames.length ? "Application layer: technical correctness, evidence and tactical decisions are scored separately from entertainment." : "The protected open module has no lab until its owner source exists.";
    els.labRoles.innerHTML = ["field_r","field_e","field_t"].map(function (key) {
      var labels = {field_r:"FIELD-R · PICTURE",field_e:"FIELD-E · CONTROL",field_t:"FIELD-T · SYSTEM"};
      return '<div><small>' + labels[key] + '</small><b>' + ((module.labs && module.labs[key]) || "Not assigned") + '</b></div>';
    }).join("");
  }

  function openModule(id, scroll) {
    var module = byId(id), index = moduleIndex(id);
    if (!module || (!isUnlocked(index) && module.status !== "owner-source-required")) return;
    activeId = id; var lesson = LESSONS[id] || null;
    els.empty.hidden = true; els.content.hidden = false;
    els.number.textContent = "Module " + module.id;
    els.title.textContent = lesson ? lesson.title : module.episode_title;
    els.summary.textContent = lesson ? lesson.summary : "Canonical course metadata is connected. The required LEARN lesson and assessment are still in authoring.";
    els.season.textContent = "Season " + module.season;
    els.episode.textContent = module.episode_id;
    els.song.textContent = module.song ? "Song · " + module.song : "Song · Open slot";
    var label = stateLabel(module, index);
    els.status.textContent = label;
    els.status.classList.toggle("is-passed", label === "PASSED");
    els.objectives.innerHTML = (module.objectives || []).length ? module.objectives.map(function (o) { return "<li>" + o + "</li>"; }).join("") : "<li>Awaiting owner source.</li>";
    els.concepts.innerHTML = (module.concepts || []).length ? module.concepts.map(function (c) { return "<span>" + c + "</span>"; }).join("") : "<span>Protected open slot</span>";
    renderReading(module, lesson); renderQuiz(module, lesson); renderCompanions(module);
    els.sources.innerHTML = (module.sources || []).map(function (s) { return "<li>" + s + "</li>"; }).join("");
    renderList();
    if (scroll) document.getElementById("lessonPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function markReading() {
    if (!activeId || !LESSONS[activeId] || has(state.read, activeId)) return;
    state.read.push(activeId); saveState(); openModule(activeId, false);
  }

  function gradeQuiz(event) {
    event.preventDefault();
    var lesson = LESSONS[activeId], module = byId(activeId);
    if (!lesson || !module || !has(state.read, activeId)) return;
    var correct = 0, answered = 0;
    lesson.quiz.forEach(function (q, qi) {
      var picked = els.quiz.querySelector('input[name="q' + qi + '"]:checked');
      if (picked) { answered += 1; if (Number(picked.value) === q.c) correct += 1; }
    });
    if (answered !== lesson.quiz.length) { els.result.textContent = "Answer every question before grading."; els.result.className = "fail"; return; }
    var score = Math.round((correct / lesson.quiz.length) * 100); state.scores[activeId] = score;
    if (score >= passMark && !has(state.passed, activeId)) state.passed.push(activeId);
    saveState(); renderProgress(); renderList(); openModule(activeId, false);
    els.result.textContent = score >= passMark ? "Passed: " + score + "%. The next module is unlocked." : "Score: " + score + "%. Review the lesson and retake the assessment.";
    els.result.className = score >= passMark ? "pass" : "fail";
  }

  els.markRead.addEventListener("click", markReading);
  els.quiz.addEventListener("submit", gradeQuiz);
  els.continueCourse.addEventListener("click", function () { if (this.dataset.module) openModule(this.dataset.module, true); });
  els.reset.addEventListener("click", function () {
    if (!window.confirm("Reset all PRIM3 course progress on this device?")) return;
    state = {read:[],passed:[],scores:{}}; saveState(); activeId = null; els.content.hidden = true; els.empty.hidden = false; renderProgress(); renderList();
  });

  fetchCourse().then(function (loaded) {
    modules = loaded.modules.slice().sort(function (a,b) { return Number(a.sequence) - Number(b.sequence); });
    passMark = Number(loaded.pass_mark || 80);
    renderProgress(); renderList();
    var next = modules.find(function (m, i) { return lessonReady(m.id) && isUnlocked(i) && !has(state.passed, m.id); }) || modules[0];
    openModule(next.id, false);
  }).catch(function (error) {
    setSync(false, "OFFLINE", "Course feed unavailable");
    els.list.innerHTML = '<p class="p3-source-error"><b>PRIM3 course map could not load.</b><br>' + (error && error.message ? error.message : "Unknown feed error") + '</p>';
    els.continueCourse.disabled = true; els.continueCourse.textContent = "Course source unavailable";
  });
})();
