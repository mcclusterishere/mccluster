/* Private project panel. The caller owns authorization, persistence and queue submission. */
(() => {
  "use strict";

  const models = {
    pooled: {
      name: "Pooled",
      equation: "ln D = a + b x",
      meaning: "Both activity groups share one level at 5.6 km and one slope across window sizes."
    },
    group_levels: {
      name: "Separate levels, shared slope",
      equation: "ln D = a + b x + c g",
      meaning: "High activity changes the level by c on the log scale. Both groups keep the same slope."
    },
    group_slopes: {
      name: "Separate levels and slopes",
      equation: "ln D = a + b x + c g + d g x",
      meaning: "Low activity has slope b. High activity has slope b + d and its own level at 5.6 km."
    }
  };

  // Invented classroom measurements at equal log-scale spacing, in units of day⁻¹.
  const toy = [[0.080, 0.060, 0.045], [0.240, 0.140, 0.090]];
  function toyPrediction(model, group, km) {
    const logs = toy.map(row => row.map(Math.log));
    // With x = [-ln 2, 0, ln 2], the OLS intercept is the mean and slope uses the endpoints.
    const levels = logs.map(row => (row[0] + row[1] + row[2]) / 3);
    const slopes = logs.map(row => (row[2] - row[0]) / (2 * Math.log(2)));
    const level = model === "pooled" ? (levels[0] + levels[1]) / 2 : levels[group];
    const slope = model === "group_slopes" ? slopes[group] : (slopes[0] + slopes[1]) / 2;
    return Math.exp(level + slope * Math.log(km / 5.6));
  }

  function option(value, label) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    return item;
  }

  function modelName(key) {
    return Object.hasOwn(models, key) ? models[key].name : "Unknown model";
  }

  function addFact(dl, term, value) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    dl.append(dt, dd);
    return dd;
  }

  function showDataset(get, dataset, previousWeek) {
    const dates = get("eq-observation");
    const summary = get("eq-dataset-summary");
    const pairs = dataset?.observations;
    if (!Array.isArray(pairs) || !pairs.length) {
      summary.textContent = "No dataset is available for this project.";
      get("eq-dataset-browser").hidden = true;
      return;
    }
    summary.textContent = dataset.title;
    get("eq-dataset-count").textContent = pairs.length + " satellite scene pairs · one sampled day per week";
    const source = get("eq-dataset-source");
    const creators = Array.isArray(dataset.creators) ? dataset.creators.join(" and ") : dataset.creators;
    addFact(source, "Data creators", creators + (dataset.year ? " (" + dataset.year + ")" : ""));
    addFact(source, "Derived data license", dataset.license);
    const ref = addFact(source, "Dataset DOI", dataset.doi);
    if (/^10\.\d{4,9}\/[^\s]+$/.test(dataset.doi)) {
      const link = document.createElement("a");
      link.href = "https://doi.org/" + dataset.doi;
      link.textContent = dataset.doi;
      ref.replaceChildren(link);
    }
    addFact(source, "Pilot commit", dataset.source_commit);
    addFact(source, "Derived observations SHA-256", dataset.observations_sha256);
    for (const pair of pairs) dates.append(option(pair.week, pair.start.slice(0, 10)));
    if (pairs.some(pair => pair.week === previousWeek)) dates.value = previousWeek;

    function showPair() {
      const pair = pairs[dates.selectedIndex];
      const observed = get("eq-observed-values");
      observed.replaceChildren();
      addFact(observed, "UTC scene interval", pair.start.replace("T", " ") + " to " + pair.end.replace("T", " "));
      addFact(observed, "West · 1.4 km activity proxy", pair.proxy_per_day.toFixed(6) + " per day");
      [2.8, 5.6, 11.2].forEach((km, i) => {
        addFact(observed, "East · " + km + " km deformation", pair.target_per_day[i].toFixed(6) + " per day");
      });
    }
    dates.addEventListener("change", showPair);
    showPair();
  }

  function completed(run) {
    return typeof run.result_sha256 === "string" && run.result_sha256.length === 64 &&
      Number.isFinite(run.held_out_mse);
  }

  function renderReceipts(container, runs) {
    container.replaceChildren();
    if (!runs.length) {
      container.textContent = "No saved runs in this project yet.";
      return;
    }
    for (const run of runs) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = modelName(run.scenario) + " · " + run.status +
        (completed(run) ? " · score " + run.held_out_mse.toFixed(6) : "");
      const dl = document.createElement("dl");
      addFact(dl, "Core job", run.job_id);
      if (completed(run) && Number.isInteger(run.folds)) addFact(dl, "Held-out weeks scored", String(run.folds));
      if (run.dataset_doi) addFact(dl, "Dataset DOI", run.dataset_doi);
      if (run.source_commit) addFact(dl, "Pilot commit", run.source_commit);
      if (run.observations_sha256) addFact(dl, "Derived observations SHA-256", run.observations_sha256);
      if (run.result_sha256) addFact(dl, "Result SHA-256", run.result_sha256);
      details.append(summary, dl);
      container.append(details);
    }
  }

  function render(container, { runs = [], dataset, onRun } = {}) {
    const get = id => container.querySelector("#" + id);
    const previous = get("eq-scenario")?.value;
    const previousWeek = get("eq-observation")?.value;
    const datasetOpen = get("eq-dataset")?.open ?? false;
    const previousGroup = get("eq-toy-group")?.value;
    const previousScale = get("eq-toy-scale")?.value;
    const previousA = get("eq-compare-a")?.value;
    const previousB = get("eq-compare-b")?.value;
    // The template is static. All project data enters the page through textContent.
    container.innerHTML = `
      <h2>Algorithms Lab</h2>
      <details id="eq-dataset">
        <summary>Browse research dataset</summary>
        <h3 id="eq-dataset-summary"></h3>
        <div id="eq-dataset-browser">
          <p id="eq-dataset-count"></p>
          <label for="eq-observation">Scene start date (UTC)</label>
          <select id="eq-observation"></select>
          <dl id="eq-observed-values" aria-live="polite"></dl>
          <details><summary>Dataset attribution and version</summary><dl id="eq-dataset-source"></dl></details>
        </div>
      </details>
      <label for="eq-scenario">Sea-ice model</label>
      <select id="eq-scenario"></select>
      <p class="eq-lab-equation" id="eq-equation"></p>
      <p id="eq-model-meaning"></p>
      <p><i>D</i> is deformation rate per day. <i>x</i> is ln(window size / 5.6 km).
        The activity group <i>g</i> is 0 for low and 1 for high. The fit minimizes squared
        errors in the natural log of the rate.</p>
      <details class="eq-toy">
        <summary>Try the model with practice data</summary>
        <p>These six invented rates fit two example days. Change the model, activity or window to see its fitted rate.</p>
        <table><caption>Practice observations · deformation per day</caption>
          <thead><tr><th scope="col">Activity</th><th scope="col">2.8 km</th><th scope="col">5.6 km</th><th scope="col">11.2 km</th></tr></thead>
          <tbody id="eq-toy-rows"></tbody>
        </table>
        <div class="eq-lab-fields">
          <div><label for="eq-toy-group">Practice activity</label>
          <select id="eq-toy-group"><option value="0">Low</option><option value="1">High</option></select></div>
          <div><label for="eq-toy-scale">Practice window</label>
          <select id="eq-toy-scale"><option value="2.8">2.8 km</option><option value="5.6" selected>5.6 km</option><option value="11.2">11.2 km</option></select></div>
        </div>
        <p><output id="eq-toy-result" for="eq-scenario eq-toy-group eq-toy-scale"></output></p>
      </details>
      <h3>Replay on MOSAiC observations</h3>
      <p>Fit the selected model to satellite-derived measurements. Each test withholds one
        week and excludes neighboring weeks and overlapping acquisitions from training.
        The median activity in the training weeks sets the cutoff between low and high activity.
        Lower mean squared log error across the held-out weeks is better.</p>
      <button id="eq-replay" type="button">Queue selected model</button>
      <p id="eq-lab-feedback" role="status"></p>
      <h3>Saved project runs</h3><div id="eq-lab-runs"></div>
      <h3>Compare held-out scores</h3>
      <div class="eq-lab-fields" id="eq-compare-fields">
        <div><label for="eq-compare-a">First run</label><select id="eq-compare-a"></select></div>
        <div><label for="eq-compare-b">Second run</label><select id="eq-compare-b"></select></div>
      </div><p id="eq-comparison" role="status"></p>`;

    showDataset(get, dataset, previousWeek);
    get("eq-dataset").open = datasetOpen;
    const select = get("eq-scenario");
    Object.entries(models).forEach(([key, model]) => select.append(option(key, model.name)));
    if (Object.hasOwn(models, previous)) select.value = previous;
    if (previousGroup) get("eq-toy-group").value = previousGroup;
    if (previousScale) get("eq-toy-scale").value = previousScale;
    toy.forEach((row, index) => {
      const tr = document.createElement("tr");
      const heading = document.createElement("th");
      heading.scope = "row";
      heading.textContent = index === 0 ? "Low" : "High";
      tr.append(heading);
      for (const rate of row) {
        const td = document.createElement("td");
        td.textContent = rate.toFixed(3);
        tr.append(td);
      }
      get("eq-toy-rows").append(tr);
    });

    function showModel() {
      const model = models[select.value];
      get("eq-equation").textContent = model.equation;
      get("eq-model-meaning").textContent = model.meaning;
      const prediction = toyPrediction(select.value, Number(get("eq-toy-group").value), Number(get("eq-toy-scale").value));
      get("eq-toy-result").textContent = "Fitted practice rate: " + prediction.toFixed(4) + " per day.";
    }
    for (const field of [select, get("eq-toy-group"), get("eq-toy-scale")]) field.addEventListener("change", showModel);
    showModel();
    const replay = get("eq-replay");
    replay.disabled = typeof onRun !== "function";
    replay.addEventListener("click", async () => {
      replay.disabled = true;
      try {
        await onRun(select.value);
      } catch {
        get("eq-lab-feedback").textContent = "Could not queue this run. Refresh the project and check its saved runs before retrying.";
      } finally {
        replay.disabled = false;
      }
    });

    renderReceipts(get("eq-lab-runs"), runs);
    const scored = runs.filter(completed);
    const comparison = get("eq-comparison");
    const fields = get("eq-compare-fields");
    if (scored.length < 2) {
      fields.hidden = true;
      comparison.textContent = "Complete two project runs to compare their scores.";
      return;
    }
    const first = get("eq-compare-a"), second = get("eq-compare-b");
    for (const run of scored) {
      const label = modelName(run.scenario);
      first.append(option(run.job_id, label));
      second.append(option(run.job_id, label));
    }
    first.value = scored.find(run => run.job_id === previousA)?.job_id ?? scored[0].job_id;
    second.value = scored.find(run => run.job_id === previousB)?.job_id ?? scored.find(run => run.job_id !== first.value).job_id;
    function compare() {
      const a = scored.find(run => run.job_id === first.value);
      const b = scored.find(run => run.job_id === second.value);
      if (a.job_id === b.job_id) {
        comparison.textContent = "Choose two different runs.";
        return;
      }
      if (!["dataset_doi", "source_commit", "observations_sha256"].every(key => a[key] && a[key] === b[key])) {
        comparison.textContent = "These runs use different or incomplete source records. Choose two runs from the same pilot revision.";
        return;
      }
      const diff = b.held_out_mse - a.held_out_mse;
      const verdict = diff === 0 ? "Both runs have the same score." :
        "The " + (diff < 0 ? "second" : "first") + " run has lower held-out error by " + Math.abs(diff).toFixed(6) + ".";
      comparison.textContent = "First " + a.held_out_mse.toFixed(6) + " · Second " + b.held_out_mse.toFixed(6) + ". " + verdict;
    }
    first.addEventListener("change", compare);
    second.addEventListener("change", compare);
    compare();
  }

  window.EquityQuantizedLab = Object.freeze({render});
})();
