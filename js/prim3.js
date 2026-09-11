(function () {
  "use strict";

  var STORAGE_KEY = "prim3_foundation_progress_v1";
  var PASS_MARK = 0.8;

  var modules = [
    {
      id: "01",
      title: "Authorization, Hats & Team Roles",
      short: "Permission, scope and security-team roles",
      summary: "Separate authorization and intent from testing knowledge, then identify the major offensive, defensive and oversight team roles used throughout PRIM3.",
      objectives: [
        "Distinguish white-, grey- and black-hat activity by authorization and intent.",
        "Distinguish white-, grey- and black-box testing by how much system knowledge the tester receives.",
        "Identify red, blue, purple and white team responsibilities.",
        "Explain why permission, scope, documentation and remediation are baseline professional requirements."
      ],
      reading: [
        ["Two different classification systems", "PRIM3 uses both hat colors and box colors, but they answer different questions. Hat color describes the relationship to authorization and intent. Box color describes how much information a tester is given about the target before an assessment begins. A white-hat tester can therefore perform a black-box assessment, and a white-box assessment can still be performed by an authorized security team."],
        ["White hat and explicit authorization", "The source material frames white-hat work as a permitted penetration-test mission: the tester knows the assignment is authorized, tests the system under agreed conditions, documents findings and produces a report explaining how to fix them. In professional practice, the written scope and rules of engagement determine what is actually permitted."],
        ["Grey and black hat", "PRIM3's creative material uses grey hat for activity that sits between clearly authorized professional testing and openly malicious behavior, and black hat for hostile activity. The LMS baseline is stricter than the story world: if you do not own a system or have explicit permission to test it, do not treat it as a PRIM3 lab target."],
        ["Red, blue, purple and white teams", "The red team models offensive behavior so an organization can discover weaknesses. The blue team detects, prevents and responds to attacks. Purple-team work deliberately connects offense and defense so findings become defensive improvements. In PRIM3's team-color source, the white team writes or referees the penetration-test rules. The same source also introduces yellow as developers, orange as offensive security development and green as defensive security development."],
        ["The professional loop", "A conventional assessment has a beginning and an end: authorization, scope, controlled testing, evidence, reporting, remediation and retesting. PRIM3's labs sit inside that loop. Entertainment can dramatize what an adversary might do; coursework and labs remain bounded by authorization." ]
      ],
      note: "PRIM3 source basis: “White Grey Black Hat” and “Red Blue Purple White Team.” The LMS adds an explicit authorization rule for every practical exercise.",
      terms: [
        ["Authorization", "Explicit permission to perform the agreed security activity."],
        ["Scope", "The systems, techniques, time window and boundaries included in an assessment."],
        ["White box", "Testing with extensive internal knowledge of the system."],
        ["Black box", "Testing with little or no prior internal knowledge."],
        ["Red team", "Offensive security function that emulates adversary behavior within an authorized exercise."],
        ["Blue team", "Defensive security function focused on prevention, detection and response."],
        ["Purple team", "Collaborative practice that turns red-team findings into blue-team improvements."],
        ["Rules of engagement", "Written constraints that define what an authorized assessment may and may not do."]
      ],
      quiz: [
        {q:"What most clearly separates the white-hat mission described in the PRIM3 source from hostile activity?", a:["It uses only open-source tools","It has permission and a defined mission","It always has source code","It never tests a live system"], c:1},
        {q:"What does a box color primarily describe?", a:["The tester's job title","The severity of the findings","How much target-system knowledge the tester receives","Which operating system is being tested"], c:2},
        {q:"Which team is primarily defensive?", a:["Red","Blue","Purple","Yellow"], c:1},
        {q:"What is the core purpose of purple-team work?", a:["Replace the blue team","Combine offense and defense so findings improve defenses","Approve corporate budgets","Write malware"], c:1},
        {q:"Before a PRIM3 practical exercise touches a real system, what must exist?", a:["A public IP address","A vulnerability scanner","Ownership or explicit authorization","A black-box designation"], c:2}
      ],
      companions: {
        music:["White Grey Black Hat + Red Blue Purple White Team","Use the hooks to remember the difference between hats, boxes and team functions after the conventional lesson is complete."],
        watch:["Pilot Episode 0 · command structure","Use the show to identify where offensive, defensive, intelligence and command roles appear in the story. Narrative roles are not a substitute for the formal definitions."],
        lab:["Rules-of-engagement simulator","Given fictional engagements, classify what is authorized, out of scope or prohibited, then assign the correct red/blue/purple/white role."]
      }
    },
    {
      id: "02",
      title: "OSINT & Information Boundaries",
      short: "Open sources, validation and collection boundaries",
      summary: "Learn what open-source intelligence is, where it comes from and where legitimate open-source collection stops.",
      objectives: [
        "Define OSINT using publicly or openly available sources.",
        "Recognize social platforms, forums, public records and vulnerability databases as possible source categories.",
        "Separate open-source collection from unauthorized access to private or proprietary information.",
        "Apply source validation and documentation before using collected information."
      ],
      reading: [
        ["What OSINT means", "The PRIM3 OSINT source explicitly anchors open-source intelligence in public sources and names social media and forums as examples. OSINT is not defined by a special hacking tool; it is defined by collecting and analyzing information that is lawfully available from open sources."],
        ["Useful source categories", "Depending on the research question, open sources can include public websites, official records, social platforms, forums, technical documentation, vulnerability databases, public advisories, maps, archives and openly published datasets. The task is to collect only what is relevant, preserve where it came from and evaluate whether it is reliable."],
        ["The boundary matters", "The creative source also describes proprietary information, infiltration and other conduct that is not ordinary open-source collection. The conventional curriculum draws a hard line: bypassing access controls, impersonating a user, taking private data or entering a restricted system without authorization is outside this OSINT lesson."],
        ["Collection is not verification", "A public claim can still be wrong, outdated, manipulated or stripped of context. Record the source, date, claim and confidence level. Prefer primary sources when possible and corroborate material facts before turning a collection into an intelligence judgment."],
        ["Minimize what you keep", "Professional collection should be purposeful. Gather what the objective requires, avoid unnecessary personal data, protect sensitive working notes and document why a source matters. More data is not automatically better intelligence."]
      ],
      note: "PRIM3 source basis: “OSINT.” The source's criminal-story references are treated as narrative material, not as authorized OSINT procedure.",
      terms: [
        ["OSINT", "Intelligence produced from publicly or openly available information."],
        ["Primary source", "A source closest to the original event, record, statement or dataset."],
        ["Corroboration", "Checking an important claim against independent evidence."],
        ["Provenance", "A record of where information came from and how it was collected."],
        ["Collection requirement", "The question or information need that determines what should be gathered."],
        ["Confidence", "An analyst's stated level of certainty based on source quality and corroboration."]
      ],
      quiz: [
        {q:"Which description best matches OSINT in the PRIM3 source?", a:["Any data stored on the internet","Information collected from public/open sources","Only intelligence from social media","Private data obtained without attribution"], c:1},
        {q:"Which action crosses the boundary of this OSINT lesson?", a:["Reading a public advisory","Checking an official public record","Bypassing a login to obtain restricted data","Comparing two public reports"], c:2},
        {q:"Why should a researcher preserve provenance?", a:["To make the report longer","To show where information came from and support verification","To avoid using primary sources","To hide collection dates"], c:1},
        {q:"A public post makes an important claim. What should happen next?", a:["Treat public availability as proof","Corroborate it with reliable independent evidence","Delete the source URL","Assume newer posts are more accurate"], c:1},
        {q:"What should control how much information is collected?", a:["Whatever is easiest to scrape","The defined collection requirement","The number of available tools","How interesting the subject is"], c:1}
      ],
      companions: {
        music:["OSINT","Use the repeated public-source hook as a memory anchor for the definition, then return to the LMS distinction between open information and restricted data."],
        watch:["Pilot Episode 0 · intelligence picture","Watch how multiple signals become a decision picture, then identify which details would require validation before a real analyst relied on them."],
        lab:["Fictional-source triage","Sort a fictional case packet into open, restricted, unreliable and corroborated sources. No live-person investigation is required."]
      }
    },
    {
      id: "03",
      title: "Network Media & Wireless Defense",
      short: "Bound/unbound media, Wi-Fi threats and controls",
      summary: "Build a conventional foundation in how data travels, then apply it to common wireless-security risks and defensive controls.",
      objectives: [
        "Differentiate bound and unbound network media.",
        "Recognize common physical media and the role of radio/light transmission.",
        "Explain the defensive significance of rogue access points and evil-twin networks.",
        "Identify WPA3, modern encryption and wireless intrusion detection/prevention as defensive controls."
      ],
      reading: [
        ["Network media", "The “Ghost in the Wires” source defines network infrastructure in terms of how computers transfer data and divides media into bound and unbound forms. Bound media uses a physical path such as copper or fiber. Unbound media carries signals through space, such as radio or light."],
        ["Physical media", "Copper Ethernet, coaxial cable and fiber optic cable each move signals differently and have different distance, bandwidth, interference and installation characteristics. The exact connector or category matters operationally, but the first learning objective is simpler: know whether the path is physical and what kind of signal it carries."],
        ["Wireless impersonation risk", "The PRIM3 wireless songs repeatedly reference evil-twin and rogue-access-point scenarios. Defensively, the concern is that a device may connect to an unauthorized network that imitates or competes with a trusted one. Users should verify networks, organizations should inventory authorized access points, and monitoring should flag unexpected wireless infrastructure."],
        ["Defensive controls", "The “Got WiFi?” source names wireless intrusion prevention, WPA3 and AES. At the LMS level, remember the roles: secure authentication and encryption protect traffic, configuration reduces exposure, patching removes known weaknesses, and wireless monitoring helps identify unexpected devices or behavior."],
        ["Think in layers", "A wireless problem can be physical, link-layer, authentication, configuration or user-behavior related. Do not jump straight to a tool. Start by identifying the layer, the expected state and the observable deviation."]
      ],
      note: "PRIM3 source basis: “Ghost in the Wires,” “Got WiFi?” and “Evil Twin.” Offensive imagery is converted into defensive recognition and mitigation objectives.",
      terms: [
        ["Bound media", "A transmission medium with a physical path, such as copper or fiber."],
        ["Unbound media", "Transmission through space, commonly using radio or light."],
        ["Rogue access point", "An unauthorized wireless access point present in an environment."],
        ["Evil twin", "A deceptive wireless network designed to resemble a trusted network."],
        ["WPA3", "A modern Wi-Fi security standard for authentication and traffic protection."],
        ["WIPS", "Wireless intrusion prevention system; technology used to detect and respond to suspicious wireless activity."]
      ],
      quiz: [
        {q:"Which is an example of bound network media?", a:["Radio","Fiber optic cable","Free-space infrared","Wi-Fi"], c:1},
        {q:"What is the primary defensive concern with an evil-twin network?", a:["It uses too much bandwidth","It can impersonate a trusted wireless network","It is always physically wired","It prevents all encryption"], c:1},
        {q:"What is a rogue access point?", a:["Any access point using WPA3","An unauthorized access point in the environment","A router with two antennas","A public DNS server"], c:1},
        {q:"Which source-named control is specifically associated with modern Wi-Fi protection?", a:["RAID 1","WPA3","CapEx","SaaS"], c:1},
        {q:"What should a troubleshooter identify before choosing a tool?", a:["The layer, expected state and observed deviation","The most expensive scanner","A public target","A password list"], c:0}
      ],
      companions: {
        music:["Ghost in the Wires + Got WiFi? + Evil Twin","Use the songs to rehearse media, wireless-threat and defense vocabulary after learning the formal definitions."],
        watch:["Pilot Episode 0 · communications layer","Identify where communications infrastructure affects command and coordination, then separate cinematic effects from real network concepts."],
        lab:["Rogue-network analyst","Inspect a fictional wireless inventory and alert log, identify the anomalous access point and choose defensive next steps."]
      }
    },
    {
      id: "04",
      title: "Malware, Patching & Secure Code",
      short: "Malware families, updates and application defenses",
      summary: "Recognize major malware categories and connect software maintenance, input handling, code integrity and testing to risk reduction.",
      objectives: [
        "Recognize common malware categories named in the PRIM3 material.",
        "Explain why patching and supported software reduce exposure to known vulnerabilities.",
        "Describe input validation and code signing as security controls.",
        "Differentiate static and dynamic code analysis at a high level."
      ],
      reading: [
        ["Malware is a category, not one behavior", "“Virus Types” names worms, keylogging, Trojan horses, ransomware, spyware, rootkits and fileless malware among its concepts. These labels describe different propagation, persistence, disguise or impact patterns. Defensive analysis begins by identifying observable behavior rather than assuming every malicious program behaves the same way."],
        ["Patching closes known gaps", "“Patch Work” centers the idea of applying updates and explicitly references secure coding practices. Patching is basic vulnerability management: inventory supported assets, prioritize relevant fixes, test where appropriate, deploy, verify and monitor. A patch program is strongest when it is routine instead of emergency-only."],
        ["Validate inputs", "The same source says to validate input and protect application integrity. Input validation checks whether data matches the format, type, length and rules the application expects. Validation is one layer of defense; output encoding, parameterized interfaces, authorization and secure defaults may also be needed depending on the application."],
        ["Code integrity", "Code signing provides evidence that software came from an expected signer and has not been altered since signing. It does not prove the code has no vulnerabilities, but it helps establish provenance and integrity in a software-distribution process."],
        ["Static and dynamic analysis", "Static analysis examines code or compiled artifacts without running the program. Dynamic analysis observes the program while it executes. They reveal different classes of issues and are complementary rather than interchangeable." ]
      ],
      note: "PRIM3 source basis: “Virus Types,” “Patch Work” and “App Attacks.” The foundation lesson focuses on recognition and defense rather than exploit execution.",
      terms: [
        ["Ransomware", "Malware that restricts access to data or systems and demands payment or another action."],
        ["Spyware", "Software designed to collect information about a user or system without appropriate consent."],
        ["Trojan", "Malicious software disguised as or delivered through something that appears legitimate."],
        ["Patch", "A software or firmware update that fixes defects, including security vulnerabilities."],
        ["Input validation", "Checking incoming data against the application's expected rules before processing it."],
        ["Static analysis", "Analysis performed without executing the target program."],
        ["Dynamic analysis", "Analysis that observes software during execution."],
        ["Code signing", "Cryptographic signing used to support software provenance and integrity checks."]
      ],
      quiz: [
        {q:"Which malware type is primarily associated with encrypting or denying access to data for extortion?", a:["Ransomware","Firmware","Hypervisor","Compiler"], c:0},
        {q:"What is the main security purpose of patching?", a:["Increase screen resolution","Address known software or firmware defects and vulnerabilities","Replace all user training","Guarantee zero-day prevention"], c:1},
        {q:"What does input validation do?", a:["Checks incoming data against expected rules","Encrypts every database automatically","Replaces authorization","Signs source-code commits"], c:0},
        {q:"How do static and dynamic analysis differ at a high level?", a:["Static runs the program; dynamic never does","Static examines without execution; dynamic observes execution","They are identical","Dynamic is only for hardware"], c:1},
        {q:"What does code signing most directly support?", a:["Unlimited administrator access","Software provenance and integrity verification","Wireless range","RAID performance"], c:1}
      ],
      companions: {
        music:["Virus Types + Patch Work","Use the malware families and patching hooks as recall prompts, then use the LMS terms for precise definitions."],
        watch:["Pilot Episode 0 · system compromise","Treat the episode as threat-model discussion: identify what would need monitoring, recovery and validation rather than reproducing attack behavior."],
        lab:["Defender decision lab","Given fictional endpoint and application alerts, classify likely risk categories and choose patching, isolation, validation or investigation responses."]
      }
    },
    {id:"05",title:"Application Security",short:"RBAC, XSS, injection and review",planned:true},
    {id:"06",title:"Cloud Fundamentals",short:"Compute, storage, networking and analytics",planned:true},
    {id:"07",title:"Cloud Service & Cost Models",short:"IaaS, PaaS, SaaS, CapEx and OpEx",planned:true},
    {id:"08",title:"Hardware & Installation",short:"Core components and installation models",planned:true},
    {id:"09",title:"Storage, RAID & Continuity",short:"RAID plus hot, warm and cold sites",planned:true},
    {id:"10",title:"Data Breach Detection & Response",short:"Indicators, access review and response",planned:true},
    {id:"11",title:"IoT Security",short:"Specialized devices, defaults and hardening",planned:true}
  ];

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        read: Array.isArray(parsed.read) ? parsed.read : [],
        passed: Array.isArray(parsed.passed) ? parsed.passed : [],
        scores: parsed.scores && typeof parsed.scores === "object" ? parsed.scores : {}
      };
    } catch (e) {
      return {read: [], passed: [], scores: {}};
    }
  }

  var state = loadState();
  var activeId = null;
  var els = {
    list: document.getElementById("moduleList"),
    empty: document.getElementById("lessonEmpty"),
    content: document.getElementById("lessonContent"),
    number: document.getElementById("lessonNumber"),
    title: document.getElementById("lessonTitle"),
    summary: document.getElementById("lessonSummary"),
    status: document.getElementById("lessonStatus"),
    objectives: document.getElementById("objectiveList"),
    reading: document.getElementById("readingBody"),
    terms: document.getElementById("termList"),
    markRead: document.getElementById("markRead"),
    quiz: document.getElementById("quizForm"),
    submit: document.getElementById("submitQuiz"),
    result: document.getElementById("quizResult"),
    musicTitle: document.getElementById("musicTitle"),
    musicCopy: document.getElementById("musicCopy"),
    watchTitle: document.getElementById("watchTitle"),
    watchCopy: document.getElementById("watchCopy"),
    labTitle: document.getElementById("labTitle"),
    labCopy: document.getElementById("labCopy"),
    progressPercent: document.getElementById("progressPercent"),
    progressBar: document.getElementById("progressBar"),
    passedCount: document.getElementById("passedCount"),
    moduleCount: document.getElementById("moduleCount"),
    continueCourse: document.getElementById("continueCourse"),
    reset: document.getElementById("resetProgress")
  };

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function includes(list, id) { return list.indexOf(id) !== -1; }
  function liveIndex(id) { return modules.findIndex(function (m) { return m.id === id; }); }
  function isUnlocked(index) {
    if (modules[index].planned) return false;
    if (index === 0) return true;
    return includes(state.passed, modules[index - 1].id);
  }

  function moduleState(module, index) {
    if (module.planned) return "PLANNED";
    if (includes(state.passed, module.id)) return "PASSED";
    if (isUnlocked(index)) return includes(state.read, module.id) ? "ASSESS" : "OPEN";
    return "LOCKED";
  }

  function renderProgress() {
    var passed = state.passed.filter(function (id) { return modules.some(function (m) { return m.id === id; }); }).length;
    var pct = Math.round((passed / modules.length) * 100);
    els.passedCount.textContent = passed;
    els.moduleCount.textContent = modules.length;
    els.progressPercent.textContent = pct + "%";
    els.progressBar.style.width = pct + "%";
    var next = modules.find(function (m, i) { return !m.planned && isUnlocked(i) && !includes(state.passed, m.id); });
    if (next) {
      els.continueCourse.disabled = false;
      els.continueCourse.textContent = (next.id === "01" ? "Start" : "Continue") + " Module " + next.id;
      els.continueCourse.dataset.module = next.id;
    } else {
      els.continueCourse.disabled = true;
      els.continueCourse.textContent = "Live foundation modules complete";
      delete els.continueCourse.dataset.module;
    }
  }

  function renderList() {
    els.list.innerHTML = "";
    modules.forEach(function (module, index) {
      var status = moduleState(module, index);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "p3-module";
      if (status === "PASSED") button.classList.add("is-passed");
      if (status === "OPEN" || status === "ASSESS") button.classList.add("is-open");
      if (activeId === module.id) button.classList.add("is-current");
      button.disabled = !isUnlocked(index);
      button.setAttribute("data-module", module.id);
      button.innerHTML = '<span class="p3-module__no">' + module.id + '</span>' +
        '<span class="p3-module__title"><b>' + module.title + '</b><small>' + module.short + '</small></span>' +
        '<span class="p3-module__state">' + status + '</span>';
      button.addEventListener("click", function () { openModule(module.id, true); });
      els.list.appendChild(button);
    });
  }

  function renderReading(module) {
    els.reading.innerHTML = module.reading.map(function (section) {
      return "<h3>" + section[0] + "</h3><p>" + section[1] + "</p>";
    }).join("") + "<aside><b>Source note.</b> " + module.note + "</aside>";
    els.terms.innerHTML = module.terms.map(function (term) {
      return "<dt>" + term[0] + "</dt><dd>" + term[1] + "</dd>";
    }).join("");
  }

  function renderQuiz(module) {
    var hasRead = includes(state.read, module.id);
    els.quiz.innerHTML = module.quiz.map(function (question, qi) {
      var choices = question.a.map(function (answer, ai) {
        return '<label><input type="radio" name="q' + qi + '" value="' + ai + '" ' + (hasRead ? "" : "disabled") + '><span>' + answer + '</span></label>';
      }).join("");
      return '<fieldset class="p3-question"><legend>' + (qi + 1) + '. ' + question.q + '</legend>' + choices + '</fieldset>';
    }).join("");
    els.submit.disabled = !hasRead || includes(state.passed, module.id);
    els.submit.textContent = includes(state.passed, module.id) ? "Module passed" : "Grade assessment";
    els.result.textContent = !hasRead ? "Complete the required reading to unlock the assessment." : "";
    els.result.className = "";
    if (state.scores[module.id] != null) {
      var score = state.scores[module.id];
      els.result.textContent = "Last score: " + score + "%";
      els.result.className = score >= PASS_MARK * 100 ? "pass" : "fail";
    }
  }

  function renderCompanions(module) {
    els.musicTitle.textContent = module.companions.music[0];
    els.musicCopy.textContent = module.companions.music[1];
    els.watchTitle.textContent = module.companions.watch[0];
    els.watchCopy.textContent = module.companions.watch[1];
    els.labTitle.textContent = module.companions.lab[0];
    els.labCopy.textContent = module.companions.lab[1];
  }

  function openModule(id, scroll) {
    var index = liveIndex(id);
    if (index < 0 || !isUnlocked(index)) return;
    var module = modules[index];
    activeId = id;
    els.empty.hidden = true;
    els.content.hidden = false;
    els.number.textContent = "Module " + module.id;
    els.title.textContent = module.title;
    els.summary.textContent = module.summary;
    els.objectives.innerHTML = module.objectives.map(function (objective) { return "<li>" + objective + "</li>"; }).join("");
    var passed = includes(state.passed, id);
    els.status.textContent = passed ? "PASSED" : "IN PROGRESS";
    els.status.classList.toggle("is-passed", passed);
    renderReading(module);
    var read = includes(state.read, id);
    els.markRead.textContent = read ? "Reading complete ✓" : "Mark reading complete";
    els.markRead.classList.toggle("is-done", read);
    els.markRead.disabled = read;
    renderQuiz(module);
    renderCompanions(module);
    renderList();
    if (scroll) document.getElementById("lessonPanel").scrollIntoView({behavior:"smooth", block:"start"});
  }

  function markReading() {
    if (!activeId || includes(state.read, activeId)) return;
    state.read.push(activeId);
    saveState();
    openModule(activeId, false);
  }

  function gradeQuiz(event) {
    event.preventDefault();
    if (!activeId || !includes(state.read, activeId)) return;
    var module = modules[liveIndex(activeId)];
    var correct = 0;
    var answered = 0;
    module.quiz.forEach(function (question, qi) {
      var picked = els.quiz.querySelector('input[name="q' + qi + '"]:checked');
      if (picked) {
        answered += 1;
        if (Number(picked.value) === question.c) correct += 1;
      }
    });
    if (answered !== module.quiz.length) {
      els.result.textContent = "Answer every question before grading.";
      els.result.className = "fail";
      return;
    }
    var score = Math.round((correct / module.quiz.length) * 100);
    state.scores[module.id] = score;
    if (score >= PASS_MARK * 100 && !includes(state.passed, module.id)) state.passed.push(module.id);
    saveState();
    renderProgress();
    renderList();
    openModule(module.id, false);
    els.result.textContent = score >= PASS_MARK * 100 ? "Passed: " + score + "%. The next live module is unlocked." : "Score: " + score + "%. Review the lesson and retake the assessment.";
    els.result.className = score >= PASS_MARK * 100 ? "pass" : "fail";
  }

  els.markRead.addEventListener("click", markReading);
  els.quiz.addEventListener("submit", gradeQuiz);
  els.continueCourse.addEventListener("click", function () {
    if (this.dataset.module) openModule(this.dataset.module, true);
  });
  els.reset.addEventListener("click", function () {
    if (!window.confirm("Reset all PRIM3 foundation progress on this device?")) return;
    state = {read: [], passed: [], scores: {}};
    saveState();
    activeId = null;
    els.content.hidden = true;
    els.empty.hidden = false;
    renderProgress();
    renderList();
  });

  renderProgress();
  renderList();
  var initial = modules.find(function (m, i) { return !m.planned && isUnlocked(i) && !includes(state.passed, m.id); }) || modules[0];
  openModule(initial.id, false);
})();
