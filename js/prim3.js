(function () {
  "use strict";

  var STORAGE_KEY = "prim3_course_progress_v4";
  var LESSONS = window.PRIM3_LESSONS || {};
  var course = null;
  var modules = [];
  var activeId = null;
  var passMark = 80;

  var state = loadState();
  var els = {
    gate: document.getElementById("courseGate"),
    course: document.getElementById("course"),
    sync: document.getElementById("courseSync"),
    source: document.getElementById("courseSource"),
    feedState: document.getElementById("courseFeedState"),
    list: document.getElementById("moduleList"),
    empty: document.getElementById("lessonEmpty"),
    content: document.getElementById("lessonContent"),
    number: document.getElementById("lessonNumber"),
    title: document.getElementById("lessonTitle"),
    summary: document.getElementById("lessonSummary"),
    status: document.getElementById("lessonStatus"),
    season: document.getElementById("lessonSeason"),
    episode: document.getElementById("lessonEpisode"),
    song: document.getElementById("lessonSong"),
    objectives: document.getElementById("objectiveList"),
    concepts: document.getElementById("conceptList"),
    reading: document.getElementById("readingBody"),
    terms: document.getElementById("termList"),
    markRead: document.getElementById("markRead"),
    assessment: document.getElementById("assessmentSection"),
    assessmentRule: document.getElementById("assessmentRule"),
    quiz: document.getElementById("quizForm"),
    submit: document.getElementById("submitQuiz"),
    result: document.getElementById("quizResult"),
    companions: document.querySelector(".p3-companions"),
    musicTitle: document.getElementById("musicTitle"),
    musicCopy: document.getElementById("musicCopy"),
    watchTitle: document.getElementById("watchTitle"),
    watchCopy: document.getElementById("watchCopy"),
    labTitle: document.getElementById("labTitle"),
    labCopy: document.getElementById("labCopy"),
    labRoles: document.getElementById("labRoles"),
    sources: document.getElementById("sourceList"),
    progressPercent: document.getElementById("progressPercent"),
    progressBar: document.getElementById("progressBar"),
    passedCount: document.getElementById("passedCount"),
    moduleCount: document.getElementById("moduleCount"),
    passMark: document.getElementById("passMark"),
    continueCourse: document.getElementById("continueCourse"),
    reset: document.getElementById("resetProgress")
  };

  function h(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (c) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c];
    });
  }

  function lessonText(value) {
    return h(String(value == null ? "" : value).replace(/[-\u2013\u2014]/g, " ").replace(/\s{2,}/g, " "));
  }

  function loadState() {
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

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function has(list, id) { return list.indexOf(id) !== -1; }
  function lessonReady(id) { return !!LESSONS[id]; }
  function byId(id) { return modules.find(function (module) { return module.id === id; }); }
  function moduleIndex(id) { return modules.findIndex(function (module) { return module.id === id; }); }

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
    if (!els.gate) return;
    els.gate.hidden = false;
    var note = els.gate.querySelector("[data-gate-note]");
    if (note && message) note.textContent = message;
  }

  function normalizeCourse(data) {
    var c = data && data.course;
    if (!c || c.id !== "prim3-foundation-v3" || c.schema_version !== "3.0.0" || !Array.isArray(c.modules) || c.modules.length !== 66) {
      throw new Error("Unexpected PRIM3 LMS course map");
    }
    if (Number(c.foundation_module_count) !== 3 || Number(c.song_aligned_module_count) !== 63 || Number(c.source_unit_count) !== 21) {
      throw new Error("Unexpected PRIM3 curriculum structure");
    }
    return c;
  }

  function fetchCourse() {
    if (!window.MCC || typeof window.MCC.api !== "function") return Promise.reject(new Error("M Account service unavailable"));
    return window.MCC.api("/v1/prim3/course").then(function (response) {
      if (!response.ok) throw Object.assign(new Error("McCluster API " + response.status), { status: response.status });
      return response.json();
    }).then(function (data) {
      course = normalizeCourse(data);
      setSync(
        true,
        data.source && data.source.cache === "hit" ? "SYNCED · CACHE" : "SYNCED · LIVE",
        "3 certification foundations plus 21 PRIM3 units equals 66 focused LMS modules"
      );
      return course;
    });
  }

  function renderProgress() {
    var total = modules.length || 66;
    var passed = state.passed.filter(function (id) { return !!byId(id); }).length;
    var percent = total ? Math.round((passed / total) * 100) : 0;
    els.passedCount.textContent = passed;
    els.moduleCount.textContent = total;
    els.passMark.textContent = passMark + "%";
    els.progressPercent.textContent = percent + "%";
    els.progressBar.style.width = percent + "%";

    var next = modules.find(function (module, index) {
      return lessonReady(module.id) && isUnlocked(index) && !has(state.passed, module.id);
    });
    if (next) {
      els.continueCourse.disabled = false;
      els.continueCourse.dataset.module = next.id;
      els.continueCourse.textContent = (next.id === "M01" ? "Start " : "Continue ") + next.id;
      return;
    }
    delete els.continueCourse.dataset.module;
    els.continueCourse.disabled = true;
    var building = modules.find(function (module, index) { return isUnlocked(index) && !lessonReady(module.id); });
    els.continueCourse.textContent = building ? building.id + " lesson is in authoring" : "Current coursework complete";
  }

  function appendModuleButton(wrap, module) {
    var index = moduleIndex(module.id);
    var label = stateLabel(module, index);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "p3-module";
    if (label === "PASSED") button.classList.add("is-passed");
    if (label === "OPEN" || label === "ASSESS") button.classList.add("is-open");
    if (label === "BUILDING" || label === "SOURCE NEEDED") button.classList.add("is-building");
    if (activeId === module.id) button.classList.add("is-current");
    button.disabled = !isUnlocked(index) && label !== "SOURCE NEEDED";
    button.innerHTML = '<span class="p3-module__no">' + lessonText(module.id) + '</span>' +
      '<span class="p3-module__title"><b>' + lessonText(module.title) + '</b><small>' + lessonText(module.part_label) + '</small></span>' +
      '<span class="p3-module__state">' + lessonText(label) + '</span>';
    button.addEventListener("click", function () { openModule(module.id, true); });
    wrap.appendChild(button);
  }

  function renderFoundationList() {
    var foundation = modules.filter(function (module) { return module.foundation === true; });
    if (!foundation.length) return;
    var wrap = document.createElement("section");
    wrap.className = "p3-season p3-foundation-group";
    var passed = foundation.filter(function (module) { return has(state.passed, module.id); }).length;
    var head = document.createElement("div");
    head.className = "p3-season__head";
    head.innerHTML = "<span>Certification Foundation</span><span>" + passed + "/" + foundation.length + " passed</span>";
    wrap.appendChild(head);
    var note = document.createElement("div");
    note.className = "p3-unit-label";
    note.innerHTML = "<b>NO SONG OR EPISODE</b><span>Security Plus and Network Plus groundwork before the album begins</span>";
    wrap.appendChild(note);
    foundation.forEach(function (module) { appendModuleButton(wrap, module); });
    els.list.appendChild(wrap);
  }

  function renderList() {
    els.list.innerHTML = "";
    renderFoundationList();

    for (var season = 1; season <= 7; season += 1) {
      var seasonModules = modules.filter(function (module) { return Number(module.season) === season && module.foundation !== true; });
      if (!seasonModules.length) continue;
      var wrap = document.createElement("section");
      wrap.className = "p3-season";
      var passed = seasonModules.filter(function (module) { return has(state.passed, module.id); }).length;
      var head = document.createElement("div");
      head.className = "p3-season__head";
      head.innerHTML = "<span>Season " + season + "</span><span>" + passed + "/" + seasonModules.length + " passed</span>";
      wrap.appendChild(head);

      var currentUnit = null;
      seasonModules.forEach(function (module) {
        if (module.unit_id !== currentUnit) {
          currentUnit = module.unit_id;
          var unit = document.createElement("div");
          unit.className = "p3-unit-label";
          unit.innerHTML = "<b>" + lessonText(module.unit_id) + " · " + lessonText(module.song || "Open song slot") + "</b>" +
            "<span>" + lessonText(module.episode_id) + " · " + lessonText(module.episode_title) + "</span>";
          wrap.appendChild(unit);
        }
        appendModuleButton(wrap, module);
      });
      els.list.appendChild(wrap);
    }
  }

  function renderReading(module, lesson) {
    var section = els.reading.closest(".p3-reading");
    section.classList.toggle("is-building", !lesson);
    if (!lesson) {
      els.reading.innerHTML = '<div class="p3-build-note"><b>Focused lesson is still in authoring.</b><br>This slot is intentionally visible so the 66 module curriculum stays granular. Credit is not issued until this exact lesson and assessment are reviewed.</div>';
      els.terms.innerHTML = "";
      els.markRead.disabled = true;
      els.markRead.textContent = "Reading in authoring";
      return;
    }
    els.reading.innerHTML = lesson.reading.map(function (sectionItem) {
      return "<h3>" + lessonText(sectionItem[0]) + "</h3><p>" + lessonText(sectionItem[1]) + "</p>";
    }).join("");
    els.terms.innerHTML = lesson.terms.map(function (term) {
      return "<dt>" + lessonText(term[0]) + "</dt><dd>" + lessonText(term[1]) + "</dd>";
    }).join("");
    var read = has(state.read, module.id);
    els.markRead.disabled = read;
    els.markRead.textContent = read ? "Reading complete ✓" : "Mark reading complete";
    els.markRead.classList.toggle("is-done", read);
  }

  function renderQuiz(module, lesson) {
    els.assessment.classList.toggle("is-building", !lesson);
    if (!lesson) {
      els.assessmentRule.textContent = "Assessment not published. No credit is issued until this focused module is authored and reviewed.";
      els.quiz.innerHTML = "";
      els.result.textContent = "";
      els.submit.disabled = true;
      return;
    }
    els.assessmentRule.textContent = "Score at least " + passMark + "% to pass this focused module and unlock the next one.";
    var read = has(state.read, module.id);
    var passed = has(state.passed, module.id);
    els.quiz.innerHTML = lesson.quiz.map(function (question, questionIndex) {
      return '<fieldset class="p3-question"><legend>' + (questionIndex + 1) + '. ' + lessonText(question.q) + '</legend>' +
        question.a.map(function (answer, answerIndex) {
          return '<label><input type="radio" name="q' + questionIndex + '" value="' + answerIndex + '" ' + (read ? "" : "disabled") + '><span>' + lessonText(answer) + '</span></label>';
        }).join("") + '</fieldset>';
    }).join("");
    els.submit.disabled = !read || passed;
    els.submit.textContent = passed ? "Module passed" : "Grade assessment";
    els.result.textContent = !read ? "Complete the required reading to unlock the assessment." : (state.scores[module.id] != null ? "Best score: " + state.scores[module.id] + "%" : "");
    els.result.className = state.scores[module.id] >= passMark ? "pass" : (state.scores[module.id] != null ? "fail" : "");
  }

  function renderCompanions(module) {
    if (module.foundation === true) {
      els.companions.hidden = true;
      return;
    }
    els.companions.hidden = false;
    els.musicTitle.textContent = lessonText(module.song || "Open song slot");
    els.musicCopy.textContent = module.song ? "REMEMBER: replay the song after this focused lesson. It reinforces the coursework but does not replace it." : "This source unit has no published song yet.";
    els.watchTitle.textContent = lessonText(module.episode_title || "Episode source pending");
    els.watchCopy.textContent = "WATCH: the canonical episode places this unit's concepts under story and operational pressure.";
    var labNames = module.labs ? Object.keys(module.labs).map(function (key) { return module.labs[key]; }) : [];
    els.labTitle.textContent = labNames.length ? "LAB · " + labNames.length + " role applications" : "LAB · awaiting source";
    els.labCopy.textContent = labNames.length ? "Apply the ideas only in fictional, local, owned or explicitly authorized environments." : "No lab is assigned until the source exists.";
    els.labRoles.innerHTML = ["field_r", "field_e", "field_t"].map(function (key) {
      var labels = { field_r: "FIELD R · PICTURE", field_e: "FIELD E · CONTROL", field_t: "FIELD T · SYSTEM" };
      return '<div><small>' + labels[key] + '</small><b>' + lessonText((module.labs && module.labs[key]) || "Not assigned") + '</b></div>';
    }).join("");
  }

  function openModule(id, scroll) {
    var module = byId(id);
    var index = moduleIndex(id);
    if (!module || (!isUnlocked(index) && module.status !== "owner-source-required")) return;
    activeId = id;
    var lesson = LESSONS[id] || null;
    els.empty.hidden = true;
    els.content.hidden = false;

    if (module.foundation === true) {
      els.number.textContent = "Module " + lessonText(module.id) + " · Certification Foundation";
      els.season.textContent = "Foundation";
      els.episode.textContent = "No episode attached";
      els.song.textContent = "No song attached";
    } else {
      els.number.textContent = "Module " + lessonText(module.id) + " · " + lessonText(module.unit_id) + " · Part " + module.part + "/3";
      els.season.textContent = "Season " + module.season;
      els.episode.textContent = lessonText(module.episode_id);
      els.song.textContent = module.song ? "Song · " + lessonText(module.song) : "Song · Open slot";
    }

    els.title.textContent = lesson ? lesson.title : lessonText(module.title);
    els.summary.textContent = lesson ? lesson.summary : "This focused module is reserved in the 66 module curriculum. Its concepts are mapped, but the conventional reading and assessment are still being authored.";
    var label = stateLabel(module, index);
    els.status.textContent = label;
    els.status.classList.toggle("is-passed", label === "PASSED");
    els.objectives.innerHTML = (module.objectives || []).length ? module.objectives.map(function (objective) {
      return "<li>" + lessonText(objective) + "</li>";
    }).join("") : "<li>Awaiting source.</li>";
    els.concepts.innerHTML = (module.concepts || []).length ? module.concepts.map(function (concept) {
      return "<span>" + lessonText(concept) + "</span>";
    }).join("") : "<span>Concept mapping pending</span>";
    if (module.exam_alignment && module.exam_alignment.length) {
      els.concepts.innerHTML += module.exam_alignment.map(function (exam) {
        return '<span class="is-exam">Exam bridge · ' + lessonText(exam) + '</span>';
      }).join("");
    }
    renderReading(module, lesson);
    renderQuiz(module, lesson);
    renderCompanions(module);
    els.sources.innerHTML = (module.sources || []).map(function (source) { return "<li>" + lessonText(source) + "</li>"; }).join("");
    renderList();
    if (scroll) document.getElementById("lessonPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function markReading() {
    if (!activeId || !LESSONS[activeId] || has(state.read, activeId)) return;
    state.read.push(activeId);
    saveState();
    openModule(activeId, false);
  }

  function gradeQuiz(event) {
    event.preventDefault();
    var lesson = LESSONS[activeId];
    var module = byId(activeId);
    if (!lesson || !module || !has(state.read, activeId)) return;
    var correct = 0;
    var answered = 0;
    lesson.quiz.forEach(function (question, questionIndex) {
      var picked = els.quiz.querySelector('input[name="q' + questionIndex + '"]:checked');
      if (!picked) return;
      answered += 1;
      if (Number(picked.value) === question.c) correct += 1;
    });
    if (answered !== lesson.quiz.length) {
      els.result.textContent = "Answer every question before grading.";
      els.result.className = "fail";
      return;
    }
    var score = Math.round((correct / lesson.quiz.length) * 100);
    var previous = Number(state.scores[activeId]);
    state.scores[activeId] = Number.isFinite(previous) ? Math.max(previous, score) : score;
    if (score >= passMark && !has(state.passed, activeId)) state.passed.push(activeId);
    saveState();
    renderProgress();
    renderList();
    openModule(activeId, false);
    els.result.textContent = score >= passMark ? "Passed: " + score + "%. The next focused module is unlocked." : "Score: " + score + "%. Review this concept cluster and retake the assessment.";
    els.result.className = score >= passMark ? "pass" : "fail";
  }

  function wireCourse() {
    els.markRead.addEventListener("click", markReading);
    els.quiz.addEventListener("submit", gradeQuiz);
    els.continueCourse.addEventListener("click", function () {
      if (this.dataset.module) openModule(this.dataset.module, true);
    });
    els.reset.addEventListener("click", function () {
      if (!window.confirm("Reset all PRIM3 course progress for this account on this device?")) return;
      state = { read: [], passed: [], scores: {} };
      saveState();
      activeId = null;
      els.content.hidden = true;
      els.empty.hidden = false;
      renderProgress();
      renderList();
    });
  }

  function start() {
    if (!window.MCC || typeof window.MCC.user !== "function") {
      showGate("Account service is still loading. Refresh in a moment.");
      return;
    }
    window.MCC.user().then(function (user) {
      if (!user) {
        showGate("Create or sign in to your free M Account to start PRIM3. The course itself is free.");
        return null;
      }
      if (els.gate) els.gate.hidden = true;
      if (els.course) els.course.hidden = false;
      wireCourse();
      return fetchCourse().then(function (loaded) {
        modules = loaded.modules.slice().sort(function (a, b) { return Number(a.sequence) - Number(b.sequence); });
        passMark = Number(loaded.pass_mark || 80);
        renderProgress();
        renderList();
        var next = modules.find(function (module, index) {
          return lessonReady(module.id) && isUnlocked(index) && !has(state.passed, module.id);
        }) || modules[0];
        openModule(next.id, false);
        return loaded;
      });
    }).catch(function (error) {
      if (error && error.status === 401) {
        showGate("Your M Account session expired. Sign in again to continue the free course.");
        return;
      }
      if (els.course) els.course.hidden = false;
      if (els.gate) els.gate.hidden = true;
      setSync(false, "OFFLINE", "Course service unavailable");
      els.list.innerHTML = '<p class="p3-source-error"><b>PRIM3 course map could not load.</b><br>' + h(error && error.message ? error.message : "Unknown course error") + '</p>';
      els.continueCourse.disabled = true;
      els.continueCourse.textContent = "Course unavailable";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();