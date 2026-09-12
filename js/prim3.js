(function () {
  "use strict";

  var STORAGE_KEY = "prim3_course_progress_v3";
  var course = null;
  var modules = [];
  var activeId = null;
  var passMark = 80;

  /* The canonical PRIM3 repo publishes 21 episode and song units. McCluster turns
     every unit into three instructional modules: two small source aligned
     concept clusters plus one infrastructure and CompTIA enrichment bridge.
     Do not collapse separate concept families back into one lesson. */
  var LESSONS = {
    M01: {
      title: "Alerts, Monitoring and Triage",
      summary: "Learn the difference between an event, an alert and an incident. Then learn how monitoring creates signals, how triage ranks them and how evidence raises or lowers confidence before anyone acts.",
      reading: [
        ["What PRIM3 gives you", "High Alert repeats the idea of staying alert. The PRIM3 mission matrix turns that idea into alert state, monitoring, evidence and professional judgment. The Blip adds a story example where several records are compared before confidence in an identity is restored."],
        ["Start with three different words", "An event is something that happened. An alert is a notification that an event or condition deserves attention. An incident is an event or group of events that has been evaluated and determined to require a response. Keeping these words separate prevents panic and keeps decisions grounded in evidence."],
        ["What monitoring actually does", "Monitoring repeatedly observes systems and conditions so unusual or important activity can be noticed. It may watch login activity, network connections, application errors, device health, physical access, temperature, power or human reports. Monitoring gives you observations. It does not automatically give you the correct explanation."],
        ["Telemetry is the raw material", "Telemetry is operational data produced by systems, devices, sensors and software. A router log, an identity sign in record, a server error, a badge event and a temperature reading can all be telemetry. Each source sees a different part of reality, so every source has limits."],
        ["Baselines, thresholds and anomalies", "A baseline describes what normal activity usually looks like. A threshold is a defined point that can trigger attention. An anomaly is something that differs from expected behavior. An anomaly can be important, harmless or simply new, so it still needs analysis."],
        ["Triage asks simple questions", "Good triage asks what happened, which source observed it, how reliable that source is, what could be affected and what action is justified next. Triage is not about solving everything immediately. It is about deciding what deserves attention first and what evidence should be collected next."],
        ["Impact and confidence are different", "Impact asks how serious the outcome could be. Confidence asks how strongly the available evidence supports the current explanation. A high impact possibility with weak evidence may still deserve attention, but the responder should clearly communicate that uncertainty instead of presenting a guess as fact."],
        ["Corroboration changes confidence", "Corroboration means checking whether independent evidence supports the same conclusion. If a badge event, a camera record and an identity log all point to the same time and person, confidence rises. If the records conflict, confidence should fall and the next step should be more verification."],
        ["False positives and false negatives", "A false positive is an alert that looks like a problem but is not. A false negative is a real problem that monitoring fails to identify. Strong monitoring programs try to reduce both, but neither can be eliminated completely. That is why human judgment and multiple sources matter."],
        ["The Blip as a monitoring example", "In The Blip, Jordan is not discovered for the first time. New college enrollment data is compared with an older identity profile and the system restores confidence in a relationship that already existed. The lesson is that one new record is not the whole answer. The value comes from correlation, context and confidence."],
        ["The beginner workflow", "For this module, remember five verbs: observe, compare, prioritize, verify and warn. Observe the signal. Compare it with other evidence. Prioritize based on possible impact and confidence. Verify what can be verified. Warn the right person when the evidence justifies escalation."],
        ["PRIM3 field practice", "The Signal or Noise lab gives several weak anomalies from cameras, access logs, environmental alarms and staff reports. Only some of them support each other strongly enough to justify immediate action. Your job is to recognize the difference between activity that is merely unusual and activity that becomes meaningful when evidence connects." ]
      ],
      terms: [
        ["Event", "An observable occurrence in a system or environment."],
        ["Alert", "A notification that a monitored condition deserves attention."],
        ["Incident", "An event or group of events that has been evaluated and determined to require response."],
        ["Monitoring", "Repeated observation of systems and conditions so important changes can be noticed."],
        ["Telemetry", "Operational data produced by systems, devices, sensors or software."],
        ["Baseline", "A reference for what normal activity usually looks like."],
        ["Threshold", "A defined point that can trigger attention or an alert."],
        ["Anomaly", "Activity that differs from an expected pattern or baseline."],
        ["Indicator", "An observation that may support a conclusion about activity or risk."],
        ["Triage", "The process of deciding what deserves attention first and what should be checked next."],
        ["Corroboration", "Independent evidence that supports or challenges a conclusion."],
        ["Confidence", "How strongly the available evidence supports a conclusion."],
        ["False positive", "An alert that appears to indicate a problem when no relevant problem exists."],
        ["False negative", "A real problem that monitoring does not identify." ]
      ],
      quiz: [
        {q:"What is an event?",a:["Anything observable that happened","A confirmed security incident only","A warning that always proves compromise","A final report"],c:0},
        {q:"What is an alert?",a:["A notification that a condition deserves attention","Proof that an attacker succeeded","A completed investigation","A recovery plan"],c:0},
        {q:"When does an event become an incident in this lesson?",a:["Whenever a log exists","After evaluation shows that response is required","Whenever a device restarts","When a user complains"],c:1},
        {q:"What is telemetry?",a:["Operational data from systems, devices, sensors or software","A theory with no source","Only video footage","Only network traffic"],c:0},
        {q:"What does a baseline describe?",a:["What normal activity usually looks like","The strongest possible attack","The final incident report","An authorization form"],c:0},
        {q:"Why is an anomaly not automatically an incident?",a:["Unusual activity can have harmless or unknown explanations","Anomalies never matter","Incidents do not create anomalies","Monitoring systems cannot detect anomalies"],c:0},
        {q:"What is the main purpose of triage?",a:["Rank what deserves attention and decide what to check next","Disable every affected system immediately","Delete low priority records","Prove attribution before collecting evidence"],c:0},
        {q:"What is the difference between impact and confidence?",a:["Impact is possible seriousness while confidence is strength of evidence","They mean exactly the same thing","Impact measures time while confidence measures cost","Confidence is always high when impact is high"],c:0},
        {q:"What usually raises confidence in a conclusion?",a:["Independent evidence that supports the same explanation","Repeating one uncertain source many times","Ignoring conflicting information","Choosing the most serious explanation"],c:0},
        {q:"What does The Blip demonstrate in this module?",a:["Several records can be compared to restore confidence in an existing identity relationship","One record should always be trusted without comparison","Monitoring should reveal every detail to every user","Identity data never needs context"],c:0}
      ]
    },
    M02: {
      title: "Scope, Authorization and Evidence",
      summary: "Learn how scope sets boundaries, how authorization gives permission, how evidence is preserved and why technical access never automatically means that a responder is allowed to search or collect everything they can reach.",
      reading: [
        ["What PRIM3 gives you", "High Alert directly references the scope of work, the choice to decline searches and the use of waivers and paper evidence. The PRIM3 mission matrix turns those lines into scope, evidence trail, search policy, access policy and professional judgment."],
        ["Scope answers what is included", "Scope defines the systems, accounts, locations, time periods, people and actions that are included in approved work. Clear scope also identifies exclusions. A responder should know not only what can be touched, but what must not be touched."],
        ["Authorization answers who may act", "Authorization is permission from a person or process with the authority to grant it. A technical ability is not the same thing as authorization. Being able to open a file, query a database or enter a room does not automatically mean that the action is approved."],
        ["Technical access is not permission", "Security tools can often see more information than one task requires. Professional work uses only the access needed for the approved purpose. When authority is unclear, the correct action is to stop at the boundary, preserve what can be preserved lawfully and ask for clarification."],
        ["Search and access policy matter", "Organizations define who may search systems, review records, enter spaces and collect information. Laws and contractual duties may also affect those decisions. A beginner does not need to memorize every rule at once. The first habit is simple: know the authority for the action before taking the action."],
        ["Evidence is information used to support a conclusion", "Evidence can include logs, messages, configuration records, camera footage, device records, photographs, notes and witness reports. Evidence is useful only when its meaning and origin can be explained. A pile of data without context can create more confusion than clarity."],
        ["Provenance tells you where evidence came from", "Provenance records the source and history of information. A useful evidence record answers where the information came from, when it was collected, who collected it and what happened to it afterward. Provenance helps later reviewers judge reliability."],
        ["Integrity means the evidence stays trustworthy", "Integrity means information remains complete and protected from unauthorized alteration. Evidence handling should reduce unnecessary changes and should document actions that could affect the record. This matters even when the incident will never become a legal case."],
        ["Preserve what matters before it disappears", "Many systems rotate logs, overwrite storage or change state during normal operation. Preservation means identifying relevant information and retaining it before routine activity removes it. Preservation is not the same as collecting everything. Good judgment balances relevance, authority, privacy, storage and time."],
        ["Least privilege and need to know", "Least privilege means giving a person or process only the access required for the approved task. Need to know limits sensitive information to people whose work actually requires it. These ideas reduce unnecessary exposure during investigations and response."],
        ["Document the decision trail", "A decision trail records what was observed, what was done, why it was done, what authority supported it and what result followed. Clear records make later review, learning and accountability possible."],
        ["The Blip as an evidence example", "The Blip depends on new institutional data being compared with an older identity record. The system should not treat the newest record as magic truth. A trustworthy conclusion depends on source history, comparison and confidence. This makes provenance part of the story, not just a paperwork concept."],
        ["PRIM3 field practice", "Safe Perimeter Under Uncertainty teaches that a boundary must protect people without creating a new hazard. Preserve the One Useful Detail teaches that collecting everything can waste time while deleting too aggressively can destroy the evidence that matters. Both labs reward controlled judgment instead of maximum access." ]
      ],
      terms: [
        ["Scope", "The defined boundary of approved work."],
        ["Authorization", "Permission from an appropriate authority to perform a defined action."],
        ["Access control", "Rules and mechanisms that determine who or what may use a resource."],
        ["Least privilege", "Giving only the access required for an approved task."],
        ["Need to know", "Limiting sensitive information to people whose work requires it."],
        ["Evidence", "Information used to support or challenge a conclusion."],
        ["Provenance", "The source and history of information or evidence."],
        ["Integrity", "The condition of information remaining complete and protected from unauthorized alteration."],
        ["Retention", "How long records or information are preserved."],
        ["Preservation", "Protecting relevant information from loss, change or routine deletion."],
        ["Decision trail", "A record of what was decided, why it was decided and what authority supported the action."],
        ["Escalation", "Passing a question or issue to a person or process with greater authority or responsibility." ]
      ],
      quiz: [
        {q:"What does scope define?",a:["The approved boundary of systems, people, locations, times and actions","Only the brand of security tool","The final identity of an attacker","The speed of a network"],c:0},
        {q:"What does authorization provide?",a:["Permission to perform a defined action","Automatic access to every system","Proof that an alert is true","A backup copy"],c:0},
        {q:"A tool can open a record that is outside your approved task. What should you conclude?",a:["Technical access does not automatically create permission","The record is automatically in scope","Every reachable record must be collected","Authorization is no longer needed"],c:0},
        {q:"Why does provenance matter?",a:["It explains where information came from and how it was handled","It makes every source equally reliable","It removes the need for timestamps","It replaces authorization"],c:0},
        {q:"What does evidence integrity protect against?",a:["Unauthorized alteration or unexplained change","Every false positive","All storage limits","Every human mistake"],c:0},
        {q:"Why might evidence need early preservation?",a:["Logs and system state can change or be overwritten","Preservation increases processor speed","It automatically proves intent","It eliminates the need for review"],c:0},
        {q:"What is least privilege?",a:["Providing only the access needed for the approved task","Providing every available permission","Giving no one any access","Allowing users to choose their own authority"],c:0},
        {q:"What is the purpose of a decision trail?",a:["Show what happened, why actions were taken and what authority supported them","Hide uncertainty","Replace technical evidence","Remove accountability"],c:0},
        {q:"What should happen when the authority for an action is unclear?",a:["Stop at the boundary and escalate the question","Assume permission","Delete the evidence","Expand the scope yourself"],c:0},
        {q:"What do the Episode One labs teach about evidence and access?",a:["Good response uses controlled boundaries and preserves relevant information without collecting everything","Maximum access is always the safest choice","Evidence matters only in court","Boundaries should never change when safety changes"],c:0}
      ]
    },
    M03: {
      title: "Monitoring Infrastructure and Incident Response",
      summary: "Build the technical picture underneath High Alert. Learn where monitoring data comes from, how records move into a central monitoring system, how correlation creates useful alerts and how responders move from detection through containment and recovery.",
      reading: [
        ["What this module adds", "High Alert gives the mnemonic and PRIM3 supplies the concepts of monitoring, evidence, scope and judgment. This module adds infrastructure that the song does not attempt to teach, including endpoint records, network telemetry, identity logs, centralized monitoring, time synchronization, correlation, case management and incident response workflow."],
        ["Think of monitoring as a path", "A useful monitoring system has several stages. Something happens. A device or service records it. That record is collected. The record is moved to a place where it can be searched. Different records are normalized and compared. A rule or analyst identifies something important. An alert is created. A responder investigates and records the result."],
        ["Endpoint telemetry", "Endpoints include laptops, desktops, servers and other computing devices. Useful records can include operating system events, process activity, service activity, security software findings and device health. Endpoint detection and response tools can add deeper visibility into behavior on managed devices."],
        ["Identity telemetry", "Identity systems can record sign in attempts, authentication results, multifactor prompts, password changes, account creation, role changes and unusual access patterns. Identity records are especially important because many incidents involve valid accounts being misused rather than a device simply being broken."],
        ["Network telemetry", "Routers, switches, firewalls, virtual private network services, wireless controllers, domain name services and address assignment services can all create useful records. Network telemetry helps answer who communicated, when communication happened, which path was used and whether a connection was allowed or blocked."],
        ["Application and cloud telemetry", "Applications may record user actions, errors, database activity and service requests. Cloud platforms may record administrative actions, resource changes, access events and service health. These records help connect user behavior with what happened inside an application or cloud environment."],
        ["Physical and environmental telemetry", "Cybersecurity investigations can also use badge records, cameras, power alarms, temperature sensors and other physical observations. Episode One deliberately mixes technical and human evidence because real operations often cross both worlds."],
        ["Collection and transport", "Records have to reach the monitoring platform. Some systems use software agents. Some send records with protocols such as Syslog. Some are queried through an application programming interface. The important beginner question is whether the data reaches the collection point reliably and whether the collection method preserves useful context."],
        ["Time must make sense", "Correlation becomes difficult when devices disagree about time. Time synchronization helps records from different systems line up. A responder should know the time zone, clock source and timestamp format used by important systems. Without reliable time, a correct event can appear to happen in the wrong order."],
        ["Normalization makes different records comparable", "Different products describe similar events in different formats. Normalization converts useful fields into a consistent structure so searches and rules can work across many sources. Normalization does not prove that an event is malicious. It simply makes analysis easier."],
        ["Correlation connects weak signals", "Correlation compares events from different sources or times to find a meaningful pattern. One failed sign in may be ordinary. Repeated failures followed by a successful sign in from a new location and a privileged role change may deserve much more attention. Correlation is the technical idea underneath the restored confidence shown in The Blip."],
        ["What a SIEM does", "A security information and event management platform can centralize records, support searches, apply detection rules, correlate events and create alerts. A SIEM does not replace judgment. It helps analysts organize and inspect evidence at a scale that would be difficult to manage manually."],
        ["Alerts need case management", "Once an alert deserves investigation, the organization needs a place to record ownership, status, evidence, actions and decisions. This may be a security case system, ticket system or incident platform. Good case records stop investigations from becoming undocumented conversations that nobody can reconstruct later."],
        ["From alert to incident response", "Current NIST guidance treats incident response as part of cybersecurity risk management rather than a separate emergency activity. For a beginner, use a practical sequence: prepare, detect, analyze, contain, remove the cause, recover and improve. The exact labels can vary, but disciplined response is always better than random action."],
        ["Containment, removal and recovery are different", "Containment limits spread or impact. Removing the cause addresses the condition that allowed the incident to continue. Recovery returns systems to a trusted operational state. A responder should not confuse making a symptom disappear with proving that the underlying problem is gone."],
        ["Protect incident records", "Modern incident guidance emphasizes preserving the integrity and provenance of incident data and response records. That means the organization should know where records came from, protect them from unauthorized change and limit sensitive response information to appropriate people."],
        ["CompTIA bridge", "This module supports current Security Plus study in Security Operations and current Network Plus study in monitoring and troubleshooting. The goal is not to turn one PRIM3 module into complete exam preparation. The goal is to make sure the mnemonic is attached to the real infrastructure and operational thinking those certifications expect."],
        ["The complete Episode One mental model", "High Alert gives you the memory hook. The Blip gives you a story about correlation and confidence. Signal or Noise teaches triage. Safe Perimeter Under Uncertainty teaches controlled boundaries. Preserve the One Useful Detail teaches evidence preservation. The infrastructure layer explains how real systems produce, move, compare and protect the records that make those decisions possible." ]
      ],
      terms: [
        ["Endpoint", "A computing device such as a workstation, laptop or server that participates in an environment."],
        ["Log source", "A system, device or service that produces recorded events."],
        ["Endpoint detection and response", "Technology that monitors managed endpoints and supports investigation and response."],
        ["Identity provider", "A service that manages user identity and authentication for other systems."],
        ["Network telemetry", "Operational records describing network activity, paths, connections or device state."],
        ["Agent", "Software installed on a system to collect or send operational information."],
        ["Syslog", "A common standard for sending event messages from systems and network devices."],
        ["Application programming interface", "A defined way for software systems to request data or actions from each other."],
        ["Time synchronization", "Keeping system clocks aligned so events from different sources can be compared accurately."],
        ["Normalization", "Converting different record formats into a consistent structure for analysis."],
        ["Correlation", "Relating multiple observations to identify a meaningful pattern."],
        ["Security information and event management", "A platform that centralizes security records and supports search, detection, correlation and alerting."],
        ["Case management", "The process and system used to track investigation ownership, evidence, actions and status."],
        ["Containment", "Limiting the spread or impact of an incident."],
        ["Recovery", "Returning systems and services to a trusted operational state." ]
      ],
      quiz: [
        {q:"Which statement best describes the monitoring path taught in this module?",a:["Systems create records, records are collected and compared, meaningful activity creates alerts and responders investigate","Alerts appear without any source data","Every log goes directly to recovery","Monitoring begins only after an incident is closed"],c:0},
        {q:"Which source is most likely to record authentication results and role changes?",a:["An identity system","A temperature sensor only","A printer tray","A display cable"],c:0},
        {q:"Why is network telemetry useful?",a:["It can help show communication paths, times and allowed or blocked connections","It always proves who typed a command","It replaces endpoint records","It eliminates false positives"],c:0},
        {q:"Why is time synchronization important?",a:["It helps records from different systems line up in the correct order","It makes storage larger","It authorizes searches","It turns events into incidents automatically"],c:0},
        {q:"What is normalization?",a:["Converting different record formats into a consistent structure","Deleting unusual events","Giving every user the same permissions","Restoring a failed system"],c:0},
        {q:"What is correlation?",a:["Comparing related observations to identify a meaningful pattern","Copying one alert many times","Collecting data with no analysis","Changing timestamps"],c:0},
        {q:"What does a security information and event management platform help do?",a:["Centralize records, search them, correlate events and create alerts","Replace every responder","Grant authorization for investigations","Repair hardware automatically"],c:0},
        {q:"What is the difference between containment and recovery?",a:["Containment limits spread or impact while recovery returns trusted service","They are exactly the same action","Containment happens only after recovery","Recovery means deleting all evidence"],c:0},
        {q:"Why should incident records preserve provenance and integrity?",a:["So responders can explain where information came from and trust that it was not changed without authorization","So every alert becomes public","So retention rules no longer matter","So responders can avoid documenting actions"],c:0},
        {q:"What is the role of the CompTIA bridge in this module?",a:["Connect the PRIM3 mnemonic to monitoring, troubleshooting and security operations knowledge","Claim the song is complete exam preparation","Replace the assessment","Remove the need for technical study"],c:0}
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

  (function validateEpisodeOneCopy() {
    var forbidden = /[-\u2013\u2014]/;
    function walk(value, path) {
      if (typeof value === "string" && forbidden.test(value)) throw new Error("Episode One lesson copy contains forbidden dash punctuation at " + path);
      if (Array.isArray(value)) value.forEach(function (item, index) { walk(item, path + "." + index); });
      else if (value && typeof value === "object") Object.keys(value).forEach(function (key) { walk(value[key], path + "." + key); });
    }
    ["M01", "M02", "M03"].forEach(function (id) { walk(LESSONS[id], id); });
  })();

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
  function lessonText(value) { return h(String(value == null ? "" : value).replace(/[-\u2013\u2014]/g, " ").replace(/\s{2,}/g, " ")); }
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
          var unit = document.createElement("div"); unit.className = "p3-unit-label"; unit.innerHTML = "<b>" + lessonText(module.unit_id) + " · " + lessonText(module.song || "Owner Song #21") + "</b><span>" + lessonText(module.episode_id) + " · " + lessonText(module.episode_title) + "</span>"; wrap.appendChild(unit);
        }
        var index = moduleIndex(module.id), label = stateLabel(module, index);
        var button = document.createElement("button"); button.type = "button"; button.className = "p3-module";
        if (label === "PASSED") button.classList.add("is-passed"); if (label === "OPEN" || label === "ASSESS") button.classList.add("is-open"); if (label === "BUILDING" || label === "SOURCE NEEDED") button.classList.add("is-building"); if (activeId === module.id) button.classList.add("is-current");
        button.disabled = !isUnlocked(index) && label !== "SOURCE NEEDED";
        button.innerHTML = '<span class="p3-module__no">' + lessonText(module.id) + '</span><span class="p3-module__title"><b>' + lessonText(module.title) + '</b><small>' + lessonText(module.part_label) + '</small></span><span class="p3-module__state">' + lessonText(label) + '</span>';
        button.addEventListener("click", function () { openModule(module.id, true); }); wrap.appendChild(button);
      });
      els.list.appendChild(wrap);
    }
  }

  function renderReading(module, lesson) {
    var section = els.reading.closest(".p3-reading"); section.classList.toggle("is-building", !lesson);
    if (!lesson) {
      els.reading.innerHTML = '<div class="p3-build-note"><b>Focused lesson is still in authoring.</b><br>This slot is intentionally visible so the curriculum stays granular. PRIM3 supplies the episode and song source. McCluster will not issue credit until the conventional reading and assessment for this exact concept cluster are reviewed.</div>';
      els.terms.innerHTML = ""; els.markRead.disabled = true; els.markRead.textContent = "Reading in authoring"; return;
    }
    els.reading.innerHTML = lesson.reading.map(function (s) { return "<h3>" + lessonText(s[0]) + "</h3><p>" + lessonText(s[1]) + "</p>"; }).join("");
    els.terms.innerHTML = lesson.terms.map(function (t) { return "<dt>" + lessonText(t[0]) + "</dt><dd>" + lessonText(t[1]) + "</dd>"; }).join("");
    var read = has(state.read, module.id); els.markRead.disabled = read; els.markRead.textContent = read ? "Reading complete ✓" : "Mark reading complete"; els.markRead.classList.toggle("is-done", read);
  }

  function renderQuiz(module, lesson) {
    els.assessment.classList.toggle("is-building", !lesson);
    if (!lesson) { els.assessmentRule.textContent = "Assessment not published. No credit is issued until this focused LEARN module is authored and reviewed."; els.quiz.innerHTML = ""; els.result.textContent = ""; els.submit.disabled = true; return; }
    els.assessmentRule.textContent = "Score at least " + passMark + "% to pass this focused module and unlock the next one.";
    var read = has(state.read, module.id), passed = has(state.passed, module.id);
    els.quiz.innerHTML = lesson.quiz.map(function (q, qi) { return '<fieldset class="p3-question"><legend>' + (qi+1) + '. ' + lessonText(q.q) + '</legend>' + q.a.map(function (a, ai) { return '<label><input type="radio" name="q'+qi+'" value="'+ai+'" '+(read?"":"disabled")+'><span>'+lessonText(a)+'</span></label>'; }).join("") + '</fieldset>'; }).join("");
    els.submit.disabled = !read || passed; els.submit.textContent = passed ? "Module passed" : "Grade assessment"; els.result.textContent = !read ? "Complete the required reading to unlock the assessment." : (state.scores[module.id] != null ? "Best score: " + state.scores[module.id] + "%" : ""); els.result.className = state.scores[module.id] >= passMark ? "pass" : (state.scores[module.id] != null ? "fail" : "");
  }

  function renderCompanions(module) {
    els.musicTitle.textContent = lessonText(module.song || "Owner Song #21 · protected open slot");
    els.musicCopy.textContent = module.song ? "REMEMBER: replay the song after this focused lesson. It is reinforcement, not a substitute for the coursework." : "No song is invented here. This source unit stays protected until the owner supplies Song #21.";
    els.watchTitle.textContent = lessonText(module.episode_title); els.watchCopy.textContent = "WATCH: the canonical episode places this unit's concepts under story and operational pressure.";
    var labNames = module.labs ? Object.keys(module.labs).map(function (k) { return module.labs[k]; }) : [];
    els.labTitle.textContent = labNames.length ? "LAB · " + labNames.length + " role applications" : "LAB · awaiting source"; els.labCopy.textContent = labNames.length ? "Apply the ideas only in fictional, local, owned or explicitly authorized environments." : "No lab is assigned until the source exists.";
    els.labRoles.innerHTML = ["field_r","field_e","field_t"].map(function (key) { var labels={field_r:"FIELD R · PICTURE",field_e:"FIELD E · CONTROL",field_t:"FIELD T · SYSTEM"}; return '<div><small>'+labels[key]+'</small><b>'+lessonText((module.labs&&module.labs[key])||"Not assigned")+'</b></div>'; }).join("");
  }

  function openModule(id, scroll) {
    var module = byId(id), index = moduleIndex(id); if (!module || (!isUnlocked(index) && module.status !== "owner-source-required")) return;
    activeId = id; var lesson = LESSONS[id] || null; els.empty.hidden = true; els.content.hidden = false;
    els.number.textContent = "Module " + lessonText(module.id) + " · " + lessonText(module.unit_id) + " · Part " + module.part + "/3"; els.title.textContent = lesson ? lesson.title : lessonText(module.title); els.summary.textContent = lesson ? lesson.summary : "This focused module is reserved in the 63 module curriculum. Its source concepts are mapped, but the conventional LEARN reading and assessment are still being authored.";
    els.season.textContent = "Season " + module.season; els.episode.textContent = lessonText(module.episode_id); els.song.textContent = module.song ? "Song · " + lessonText(module.song) : "Song · Open slot";
    var label = stateLabel(module, index); els.status.textContent = label; els.status.classList.toggle("is-passed", label === "PASSED");
    els.objectives.innerHTML = (module.objectives || []).length ? module.objectives.map(function (o) { return "<li>" + lessonText(o) + "</li>"; }).join("") : "<li>Awaiting owner source.</li>";
    els.concepts.innerHTML = (module.concepts || []).length ? module.concepts.map(function (c) { return "<span>" + lessonText(c) + "</span>"; }).join("") : "<span>Protected open slot</span>";
    if (module.exam_alignment && module.exam_alignment.length) els.concepts.innerHTML += module.exam_alignment.map(function (e) { return '<span class="is-exam">Exam bridge · ' + lessonText(e) + '</span>'; }).join("");
    renderReading(module, lesson); renderQuiz(module, lesson); renderCompanions(module); els.sources.innerHTML = (module.sources || []).map(function (s) { return "<li>" + lessonText(s) + "</li>"; }).join(""); renderList(); if (scroll) document.getElementById("lessonPanel").scrollIntoView({behavior:"smooth",block:"start"});
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