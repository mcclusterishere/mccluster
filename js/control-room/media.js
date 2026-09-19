/* Create · generation.

   Owns the media generation lifecycle inside the Control Room's Create
   surface. This is not a second Studio: it renders one panel into the
   existing Create canvas and uses the existing canonical /v1/media routes.

   Submitting is not finishing. /v1/media/generate returns a queued job, and
   the job only reaches a result because GET /v1/media/jobs/{id} refreshes
   provider status, stores the produced assets and reconciles actual cost.
   So the console follows each job to a terminal state rather than reporting
   "queued" and walking away. */
(function () {
  "use strict";

  var fmt = window.CR.fmt, SRC = window.CR.sources;
  var esc = fmt.esc, text = fmt.text, titleCase = fmt.titleCase, ago = fmt.ago;
  var moneyCents = fmt.moneyCents, stateClass = fmt.stateClass, jsonText = fmt.jsonText;
  var durationBetween = fmt.durationBetween;

  var TERMINAL = ["completed", "failed", "cancelled"];
  /* Backoff in ms. The last value repeats; generation is slow and polling
     hard adds provider load for nothing. */
  var BACKOFF = [1500, 2000, 3000, 4000, 6000, 8000];
  var MAX_POLLS = 60;           /* ~6 minutes at the tail interval */
  var MAX_POLL_FAILURES = 3;    /* consecutive read failures before standing down */
  var BAKEOFF_MIN = 2, BAKEOFF_MAX = 5; /* enforced by the backend too */

  var ctx = null;
  var timers = {};

  var state = {
    catalog: null,        /* source result for /v1/media/models */
    modelId: null,        /* single-generation selection */
    bakeoff: {},          /* explicit multi-selection: { [modelId]: true } */
    mode: "single",       /* "single" | "bakeoff" */
    submitting: false,
    submitError: null,
    jobs: []              /* tracked lifecycle records, newest first */
  };

  function isTerminal(status) { return TERMINAL.indexOf(String(status || "").toLowerCase()) >= 0; }

  function models() { return SRC.pickRows(state.catalog, "models"); }
  function modelById(id) {
    return models().find(function (m) { return String(m.id) === String(id); }) || null;
  }
  function modelLabel(m) { return (m && (m.label || m.provider_model_id || m.id)) || "model"; }

  function selectedBakeoffIds() {
    return Object.keys(state.bakeoff).filter(function (id) { return state.bakeoff[id]; });
  }

  function loadCatalog(force) {
    if (state.catalog && !force) return Promise.resolve(state.catalog);
    return SRC.src(ctx.request("/v1/media/models")).then(function (result) {
      state.catalog = result;
      /* Default the single selection to the first enabled model so the
         control is never submitted with nothing chosen. */
      var list = SRC.pickRows(result, "models");
      if (!state.modelId && list.length) state.modelId = list[0].id;
      ctx.render();
      return result;
    });
  }

  /* ---- lifecycle --------------------------------------------------- */

  function track(job, label) {
    var record = {
      id: job && job.id,
      label: label || titleCase((job && job.capability) || "generation"),
      status: (job && job.status) || "queued",
      job: job || null,
      assets: [],
      startedAt: Date.now(),
      polls: 0,
      failures: 0,
      pollError: null,
      stopped: false,
      stoppedReason: ""
    };
    state.jobs.unshift(record);
    if (record.id) schedulePoll(record);
    else {
      /* Accepted without an id means nothing can be followed; say so rather
         than showing a spinner that will never resolve. */
      record.stopped = true;
      record.stoppedReason = "The backend accepted the request but returned no job id, so it cannot be followed.";
    }
    return record;
  }

  function schedulePoll(record) {
    if (record.stopped || isTerminal(record.status)) return;
    var delay = BACKOFF[Math.min(record.polls, BACKOFF.length - 1)];
    clearTimeout(timers[record.id]);
    timers[record.id] = setTimeout(function () { poll(record); }, delay);
  }

  function stop(record, reason) {
    record.stopped = true;
    record.stoppedReason = reason || "";
    clearTimeout(timers[record.id]);
    delete timers[record.id];
    ctx.render();
  }

  function poll(record) {
    if (record.stopped || isTerminal(record.status)) return;
    if (record.polls >= MAX_POLLS) {
      stop(record, "Stopped following this job after " + MAX_POLLS + " checks. It may still be running — reopen it from Library or Workload.");
      return;
    }
    record.polls += 1;
    SRC.src(ctx.request("/v1/media/jobs/" + encodeURIComponent(record.id))).then(function (result) {
      if (!result.ok) {
        record.failures += 1;
        record.pollError = result;
        if (record.failures >= MAX_POLL_FAILURES) {
          stop(record, "Could not read this job " + record.failures + " times in a row, so the console stopped following it. The job itself may still be running.");
          return;
        }
        ctx.render();
        schedulePoll(record);
        return;
      }
      record.failures = 0;
      record.pollError = null;
      var data = result.data || {};
      if (data.job) { record.job = data.job; record.status = data.job.status; }
      if (Array.isArray(data.assets)) record.assets = data.assets;
      if (isTerminal(record.status)) {
        clearTimeout(timers[record.id]);
        delete timers[record.id];
        ctx.onJobSettled(record);
      } else {
        schedulePoll(record);
      }
      ctx.render();
    });
  }

  function submit() {
    var prompt = String((document.getElementById("crGenPrompt") || {}).value || "").trim();
    if (!prompt) { state.submitError = SRC.badResult("failed", "A prompt is required.", 0); ctx.render(); return; }

    var budgetRaw = (document.getElementById("crGenBudget") || {}).value;
    var budget = budgetRaw ? Number(budgetRaw) : null;
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
      state.submitError = SRC.badResult("failed", "Budget must be a positive number of cents.", 0);
      ctx.render(); return;
    }

    var payload = { prompt: prompt };
    if (budget) payload.budget_cents = budget;
    var org = ctx.orgId();
    if (org) payload.org_id = org;

    var path, labels;
    if (state.mode === "bakeoff") {
      var ids = selectedBakeoffIds();
      /* The operator chooses the field. Nothing is auto-picked, because a
         bakeoff spends real money per model. */
      if (ids.length < BAKEOFF_MIN) {
        state.submitError = SRC.badResult("failed", "Select at least " + BAKEOFF_MIN + " models for a bakeoff.", 0);
        ctx.render(); return;
      }
      if (ids.length > BAKEOFF_MAX) {
        state.submitError = SRC.badResult("failed", "A bakeoff runs at most " + BAKEOFF_MAX + " models.", 0);
        ctx.render(); return;
      }
      payload.model_ids = ids;
      path = "/v1/media/bakeoff";
      labels = ids.map(function (id) { return modelLabel(modelById(id)); });
    } else {
      if (!state.modelId) {
        state.submitError = SRC.badResult("failed", "Select a model.", 0);
        ctx.render(); return;
      }
      payload.model_id = state.modelId;
      path = "/v1/media/generate";
      labels = [modelLabel(modelById(state.modelId))];
    }

    state.submitting = true; state.submitError = null; ctx.render();
    SRC.src(ctx.request(path, { method: "POST", body: payload })).then(function (result) {
      state.submitting = false;
      if (!result.ok) { state.submitError = result; ctx.render(); return; }
      var d = result.data || {};
      var created = [];
      if (d.job) created.push(d.job);
      if (Array.isArray(d.jobs)) created = created.concat(d.jobs.filter(Boolean));
      /* A bakeoff can partially fail; only the jobs that came back are
         followed, and the count shown is the count returned. */
      if (!created.length) {
        state.submitError = SRC.badResult("failed", "The request was accepted but no job was returned, so there is nothing to follow.", 0);
        ctx.render(); return;
      }
      created.forEach(function (job, i) { track(job, labels[i] || labels[0]); });
      ctx.render();
    });
  }

  function dismiss(jobId) {
    clearTimeout(timers[jobId]);
    delete timers[jobId];
    state.jobs = state.jobs.filter(function (r) { return String(r.id) !== String(jobId); });
    ctx.render();
  }

  function retry(jobId) {
    var record = state.jobs.find(function (r) { return String(r.id) === String(jobId); });
    if (!record) return;
    record.stopped = false; record.failures = 0; record.polls = 0; record.pollError = null;
    ctx.render();
    poll(record);
  }

  /* ---- rendering --------------------------------------------------- */

  function statusKind(status) {
    var s = String(status || "").toLowerCase();
    if (s === "completed") return "ok";
    if (s === "failed" || s === "cancelled") return "bad";
    if (s === "running") return "ai";
    return "info";
  }

  function renderJobCard(record) {
    var job = record.job || {};
    var live = !record.stopped && !isTerminal(record.status);
    /* Cost comes from the job row. estimated is what the preflight computed;
       actual is what the provider reconciliation settled. Neither is shown
       unless the backend put a number there. */
    var costs = [];
    if (job.actual_cost_cents !== null && job.actual_cost_cents !== undefined) costs.push("actual " + moneyCents(job.actual_cost_cents));
    else if (job.estimated_cost_cents !== null && job.estimated_cost_cents !== undefined) costs.push("est. " + moneyCents(job.estimated_cost_cents));

    var errorText = jsonText(job.error);
    var elapsed = isTerminal(record.status) && job.completed_at
      ? durationBetween(job.created_at || job.submitted_at, job.completed_at)
      : Math.max(1, Math.round((Date.now() - record.startedAt) / 1000)) + "s";

    var assetHtml = record.assets.length
      ? '<div class="cr-genjob__assets">' + record.assets.slice(0, 6).map(function (a) {
          var url = a.url || a.public_url || a.storage_url || a.signed_url || "";
          var isImage = url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
          return '<button class="cr-genasset" type="button" data-action="inspect-generated-asset" data-id="' + esc(a.id) + '">' +
            (isImage ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span>' + esc(titleCase(a.media_type || a.type || "asset")) + '</span>') +
            '</button>';
        }).join("") + '</div>'
      : "";

    return '<div class="cr-genjob">' +
      '<div class="cr-genjob__head">' +
        (live ? '<span class="cr-spin" aria-hidden="true"></span>' : "") +
        '<span class="' + stateClass(statusKind(record.status)) + '">' + esc(record.status || "queued") + '</span>' +
        '<b>' + esc(record.label) + '</b>' +
        '<span class="cr-genjob__meta">' + esc(elapsed) + (costs.length ? " · " + esc(costs.join(" ")) : "") + '</span>' +
        '<button class="cr-icon-btn" type="button" data-action="dismiss-generation" data-id="' + esc(record.id) + '" aria-label="Stop showing this job">×</button>' +
      '</div>' +
      (live ? '<p class="cr-genjob__note">Following this job until it finishes' + (record.polls ? " · check " + record.polls : "") + '.</p>' : "") +
      (errorText ? '<p class="cr-fail">' + esc(errorText) + '</p>' : "") +
      (record.pollError ? SRC.sourceBanner(record.pollError, "Job status") : "") +
      (record.stopped && record.stoppedReason ? '<p class="cr-genjob__note cr-genjob__note--stopped">' + esc(record.stoppedReason) +
        (record.id ? ' <button class="cr-btn cr-btn--ghost" type="button" data-action="resume-generation" data-id="' + esc(record.id) + '">Check again</button>' : "") + '</p>' : "") +
      assetHtml +
      (isTerminal(record.status) && record.status === "completed" && !record.assets.length
        ? '<p class="cr-genjob__note">Completed, but no asset rows reference this job.</p>' : "") +
      (record.id ? '<div class="cr-genjob__foot"><button class="cr-btn cr-btn--ghost" type="button" data-action="inspect-media-job" data-id="' + esc(record.id) + '">Open job</button></div>' : "") +
      '</div>';
  }

  function renderPanel() {
    var body;
    var list = models();

    if (!state.catalog) {
      body = '<div class="cr-panel__body"><p class="cr-muted">The model catalog has not been read yet.</p>' +
        '<button class="cr-btn cr-btn--primary" type="button" data-action="load-models">Load models</button></div>';
    } else if (!state.catalog.ok) {
      body = '<div class="cr-panel__body">' + SRC.sourceBanner(state.catalog, "Media models") + '</div>';
    } else if (!list.length) {
      body = '<div class="cr-panel__body"><div class="cr-canvas__empty"><div><strong>No models enabled</strong>' +
        '<div>The catalog read succeeded but returned no enabled media models, so there is nothing to generate with.</div></div></div></div>';
    } else {
      var chosen = selectedBakeoffIds();
      var picker = state.mode === "bakeoff"
        ? '<div class="cr-modelpick">' + list.map(function (m) {
            var on = Boolean(state.bakeoff[m.id]);
            return '<label class="cr-modelpick__item' + (on ? " is-on" : "") + '">' +
              '<input type="checkbox" data-bakeoff-model="' + esc(m.id) + '"' + (on ? " checked" : "") + '>' +
              '<span><b>' + esc(modelLabel(m)) + '</b><small>' + esc(m.capability || "") + '</small></span></label>';
          }).join("") + '</div>' +
          '<p class="cr-muted">' + chosen.length + ' of ' + BAKEOFF_MIN + '–' + BAKEOFF_MAX + ' models selected. Each one runs the prompt and spends against the budget separately.</p>'
        : '<select class="cr-select" id="crGenModel" aria-label="Model">' + list.map(function (m) {
            return '<option value="' + esc(m.id) + '"' + (String(m.id) === String(state.modelId) ? " selected" : "") + '>' +
              esc(modelLabel(m)) + ' · ' + esc(m.capability || "") + '</option>';
          }).join("") + '</select>';

      body = '<div class="cr-panel__body cr-gen">' +
        '<div class="cr-filterchips">' +
          '<button class="cr-chip' + (state.mode === "single" ? " is-on" : "") + '" type="button" data-gen-mode="single">One model</button>' +
          '<button class="cr-chip' + (state.mode === "bakeoff" ? " is-on" : "") + '" type="button" data-gen-mode="bakeoff">Bakeoff</button>' +
        '</div>' +
        picker +
        '<textarea class="cr-textarea" id="crGenPrompt" rows="3" placeholder="Describe what to generate…"></textarea>' +
        '<div class="cr-gen__row">' +
          '<input class="cr-input cr-input--sm" id="crGenBudget" type="number" min="1" placeholder="Budget (cents, optional)">' +
          '<button class="cr-btn cr-btn--primary" type="button" data-action="generate"' + (state.submitting ? " disabled" : "") + '>' +
            (state.submitting ? "Submitting…" : (state.mode === "bakeoff" ? "Run bakeoff" : "Generate")) + '</button>' +
        '</div>' +
        (state.submitError ? SRC.sourceBanner(state.submitError, "Generation") : "") +
        (state.jobs.length ? '<div class="cr-genjobs">' + state.jobs.map(renderJobCard).join("") + '</div>' : "") +
        '</div>';
    }
    return ctx.panel("Generate", state.jobs.length ? state.jobs.length + " tracked" : "real media compute", body, "cr-span-12");
  }

  /* Rebinds the panel's own controls after each render. */
  function bind(root) {
    if (!root) return;
    root.querySelectorAll("[data-gen-mode]").forEach(function (b) {
      b.addEventListener("click", function () { state.mode = b.getAttribute("data-gen-mode"); state.submitError = null; ctx.render(); });
    });
    root.querySelectorAll("[data-bakeoff-model]").forEach(function (b) {
      b.addEventListener("change", function () {
        state.bakeoff[b.getAttribute("data-bakeoff-model")] = b.checked;
        ctx.render();
      });
    });
    var sel = root.querySelector("#crGenModel");
    if (sel) sel.addEventListener("change", function () { state.modelId = sel.value; });
    var prompt = root.querySelector("#crGenPrompt");
    if (prompt) {
      prompt.value = state.draft || "";
      prompt.addEventListener("input", function () { state.draft = prompt.value; });
    }
  }

  function handleAction(action, el) {
    if (action === "load-models") { loadCatalog(true); return true; }
    if (action === "generate" || action === "bakeoff") { submit(); return true; }
    if (action === "dismiss-generation") { dismiss(el.getAttribute("data-id")); return true; }
    if (action === "resume-generation") { retry(el.getAttribute("data-id")); return true; }
    return false;
  }

  /* Any asset produced during this session, for the inspector to resolve
     even before the next full Library reload. */
  function generatedAssets() {
    return state.jobs.reduce(function (all, r) { return all.concat(r.assets || []); }, []);
  }
  function trackedJobs() { return state.jobs.map(function (r) { return r.job; }).filter(Boolean); }

  function stopAll() {
    Object.keys(timers).forEach(function (k) { clearTimeout(timers[k]); delete timers[k]; });
  }

  window.CR.media = {
    init: function (c) { ctx = c; },
    renderPanel: renderPanel,
    bind: bind,
    handleAction: handleAction,
    loadCatalog: loadCatalog,
    generatedAssets: generatedAssets,
    trackedJobs: trackedJobs,
    stopAll: stopAll,
    state: state
  };
})();
