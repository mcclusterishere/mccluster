/* McCluster Control Room v2
   Canonical operator architecture: Home / AI / Work / Create / Analytics / System / Apps.
   This browser client composes existing canonical APIs and Supabase records.
   It does not introduce a second backend, auth stack, job queue, CRM, or media store. */
(function () {
  "use strict";

  var API = "https://api.mccluster.org";
  var $ = function (id) { return document.getElementById(id); };
  var SURFACES = ["home", "ai", "work", "create", "analytics", "system", "apps"];
  var WORK_VIEWS = ["inbox", "pipeline", "people", "companies", "relationships", "clients", "tasks", "bookings", "orders", "projects", "payments", "deliverables", "renewals", "outreach", "operations"];
  var CREATE_VIEWS = ["projects", "library", "schedule", "channels", "instagram", "music", "action-network", "song-test"];
  var SYSTEM_VIEWS = ["command", "overview", "workload", "observability", "resources"];

  var state = {
    surface: "home",
    workView: "inbox",
    createView: "projects",
    systemView: "overview",
    health: null,
    status: null,
    apps: [],
    ai: null,
    aiHealth: null,
    aiThreads: [],
    aiMessages: {},
    selectedAiThreadId: null,
    aiChatPending: false,
    aiChatError: null,
    aiChatTask: null,
    aiChatDraft: "",
    aiVoiceListening: false,
    aiVoiceSpeaking: false,
    aiVoiceError: null,
    aiVoiceTranscript: "",
    coreBridge: null,
    coreTools: [],
    coreResume: null,
    commandResult: null,
    org: null,
    /* The membership row behind state.org — which workspace this operator
       is in and as what. Null means the server named none, which is not
       the same as the console failing to ask. */
    workspace: null,
    audit: [],
    threads: [],
    leads: [],
    siteRequests: [],
    jobs: [],
    mediaAssets: [],
    mediaJobs: [],
    campaigns: [],
    variants: [],
    publishJobs: [],
    posts: [],
    selectedProjectId: null,
    inspector: null,
    loading: false,
    error: null,
    refreshedAt: null,
    /* Per-source results. Keyed by the same names as the data fields above,
       so any view can ask why its list is short instead of guessing. */
    sources: {},
    selectedThreadId: null,
    transcripts: {},
    threadFilter: "all",
    jobFilter: "all",
    pipelineStage: "all",
    futureWork: {},
    observability: null,
    observabilitySeverity: "all",
    observabilitySource: "all",
    observabilitySearch: "",
    resources: null,
    publicRecord: null,
    socialAccounts: null,
    decisions: [],
    leadTotal: null,
    pending: {},
    drafts: {},
    search: ""
  };

  var FUTURE_WORK = {
    relationships: {
      endpoint: "/v1/work/relationships", collection: "relationships", title: "Relationships",
      singular: "relationship", summary: "The durable link between a person and a company, with owner, role, strength, state and history.",
      fields: [
        { key: "person_id", label: "Person ID", placeholder: "Canonical person UUID" },
        { key: "company_id", label: "Company ID", placeholder: "Canonical company UUID" },
        { key: "relationship_type", label: "Relationship type", placeholder: "client, partner, sponsor, vendor…" },
        { key: "status", label: "Status", placeholder: "active" },
        { key: "owner_id", label: "Owner ID", placeholder: "Operator UUID" },
        { key: "notes", label: "Notes", textarea: true, placeholder: "Relationship context" }
      ]
    },
    projects: {
      endpoint: "/v1/work/projects", collection: "projects", title: "Service Projects",
      singular: "project", summary: "Post-sale client work: scope, ownership, dates, budget, fulfillment and links back to orders.",
      fields: [
        { key: "name", label: "Project name", required: true, placeholder: "Client project" },
        { key: "client_id", label: "Client / person ID", placeholder: "Canonical person UUID" },
        { key: "company_id", label: "Company ID", placeholder: "Canonical company UUID" },
        { key: "order_id", label: "Order ID", placeholder: "Originating order UUID" },
        { key: "status", label: "Status", placeholder: "planned" },
        { key: "starts_at", label: "Starts", type: "datetime-local", instant: true },
        { key: "due_at", label: "Due", type: "datetime-local", instant: true },
        { key: "budget_cents", label: "Budget (USD)", type: "number", scale: 100, min: "0", step: "0.01" }
      ]
    },
    payments: {
      endpoint: "/v1/work/payments", collection: "payments", title: "Payments",
      singular: "payment", summary: "Payment state tied to clients, orders and projects without turning provider dashboards into the system of record.",
      fields: [
        { key: "client_id", label: "Client / person ID", placeholder: "Canonical person UUID" },
        { key: "order_id", label: "Order ID", placeholder: "Canonical order UUID" },
        { key: "project_id", label: "Project ID", placeholder: "Canonical project UUID" },
        { key: "amount_cents", label: "Amount (USD)", type: "number", scale: 100, required: true, min: "0", step: "0.01" },
        { key: "currency", label: "Currency", placeholder: "usd" },
        { key: "provider", label: "Provider", placeholder: "stripe / square" },
        { key: "status", label: "Status", placeholder: "pending" },
        { key: "external_id", label: "Provider reference", placeholder: "Provider payment/session ID" },
        { key: "due_at", label: "Due", type: "datetime-local", instant: true },
        { key: "paid_at", label: "Paid", type: "datetime-local", instant: true }
      ]
    },
    deliverables: {
      endpoint: "/v1/work/deliverables", collection: "deliverables", title: "Deliverables",
      singular: "deliverable", summary: "What the client is owed, where the artifact lives, and whether it has been reviewed and accepted.",
      fields: [
        { key: "project_id", label: "Project ID", required: true, placeholder: "Canonical project UUID" },
        { key: "title", label: "Deliverable", required: true, placeholder: "Final edit, site handoff, campaign report…" },
        { key: "kind", label: "Type", placeholder: "file, site, report, campaign…" },
        { key: "status", label: "Status", placeholder: "planned" },
        { key: "asset_id", label: "Asset ID", placeholder: "Media/library asset UUID" },
        { key: "approval_status", label: "Approval", placeholder: "pending" },
        { key: "due_at", label: "Due", type: "datetime-local", instant: true }
      ]
    },
    renewals: {
      endpoint: "/v1/work/renewals", collection: "renewals", title: "Renewals",
      singular: "renewal", summary: "Recurring client obligations and the next commercial decision after delivery.",
      fields: [
        { key: "relationship_id", label: "Relationship ID", placeholder: "Canonical relationship UUID" },
        { key: "project_id", label: "Project ID", placeholder: "Canonical project UUID" },
        { key: "title", label: "Renewal", required: true, placeholder: "Monthly management, annual hosting…" },
        { key: "status", label: "Status", placeholder: "upcoming" },
        { key: "renews_at", label: "Renews", type: "datetime-local", instant: true },
        { key: "amount_cents", label: "Amount (USD)", type: "number", scale: 100, min: "0", step: "0.01" },
        { key: "interval", label: "Interval", placeholder: "month / year" }
      ]
    }
  };

  var bridge = {
    /* Specialized products are Apps. Operator administration does not leave
       Control; former back-office room names are only routing aliases. */
    assetLab: { title: "Asset Lab", href: "asset-lab.html", subtitle: "Existing asset tool" },
    whip: { title: "Whip", href: "whip.html", subtitle: "Mobility product" },
    prim3: { title: "PRIM3", href: "prim3.html", subtitle: "Learning product" },
    halo: { title: "Hitman Halo", href: "auth/seek-first-handoff.html", subtitle: "Owner spatial intelligence workspace" },
    manufacture: { title: "WE Manufacture", href: "we-manufacture.html", subtitle: "Manufacturing workspace" },
    spatial: { title: "Spatial Intelligence", href: "auth/seek-first-handoff.html", subtitle: "Seek First console, signed in as you" }
  };

  /* Formatting and source-result primitives live in js/control-room/
     format.js and sources.js. Bound to locals so every call site below is
     unchanged. */
  var fmt = window.CR.fmt, SRC = window.CR.sources;
  var esc = fmt.esc, text = fmt.text, count = fmt.count, titleCase = fmt.titleCase;
  var ago = fmt.ago, moneyCents = fmt.moneyCents, formatDate = fmt.formatDate;
  var durationBetween = fmt.durationBetween, stateClass = fmt.stateClass, jsonText = fmt.jsonText;
  var okResult = SRC.okResult, badResult = SRC.badResult, classifySourceError = SRC.classifySourceError;
  var src = SRC.src, rowsOf = SRC.rowsOf, dataOf = SRC.dataOf, pickRows = SRC.pickRows;
  var sourceBanner = SRC.sourceBanner, sourceStates = SRC.sourceStates;
  var VOICE = window.CR.voice || null;

  function token() { return window.MCC_SUPA && window.MCC_SUPA.token ? window.MCC_SUPA.token() : Promise.resolve(null); }
  function sbBase() { return window.MCC_SUPA && window.MCC_SUPA.url; }
  function sbKey() { return window.MCC_SUPA && window.MCC_SUPA.key; }

  function request(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) throw new Error("signed out");
      var headers = { authorization: "Bearer " + t };
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      return fetch(API + path, {
        method: opts.method || "GET",
        headers: headers,
        cache: "no-store",
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }).then(function (r) {
        return r.text().then(function (body) {
          var data = null;
          try { data = body ? JSON.parse(body) : null; } catch (e) { data = { raw: body }; }
          if (!r.ok) {
            var err = new Error(data && (data.error || data.message) || ("HTTP " + r.status));
            err.status = r.status; err.detail = data; throw err;
          }
          return data;
        });
      });
    });
  }

  var coreRpcSeq = 1;
  function coreMcp(method, params) {
    return request("/v1/core/mcp", {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: "operator-" + Date.now() + "-" + (coreRpcSeq++),
        method: method,
        params: params || {}
      }
    }).then(function (rpc) {
      if (rpc && rpc.error) {
        var err = new Error(rpc.error.message || "Core MCP error");
        err.detail = rpc.error;
        throw err;
      }
      return rpc && rpc.result;
    });
  }

  function parseCoreToolResult(result) {
    if (result && result.isError) {
      var failed = result.content && result.content[0] && result.content[0].text;
      throw new Error(failed || "Core tool failed");
    }
    var raw = result && result.content && result.content[0] && result.content[0].text;
    if (!raw) return result;
    try { return JSON.parse(raw); } catch (e) { return { text: raw }; }
  }

  function unwrapCoreResult(value) {
    var current = value, depth = 0;
    while (current && current.result && typeof current.result === "object" && depth < 4) {
      current = current.result;
      depth += 1;
    }
    return current;
  }

  function callCoreTool(name, args) {
    return coreMcp("tools/call", { name: name, arguments: args || {} })
      .then(parseCoreToolResult)
      .then(unwrapCoreResult);
  }

  function coreToolAvailable(name) {
    return state.coreTools.some(function (tool) { return tool && tool.name === name; });
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function newAiTurnId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") throw new Error("Secure browser UUID generation is unavailable");
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function waitForComputeTask(taskId, attempts) {
    attempts = attempts || 45;
    if (!taskId || !state.org || !state.org.id) return Promise.reject(new Error("Compute task identity unavailable"));
    function poll(left) {
      return callCoreTool("compute.task.get", { org_id: state.org.id, task_id: taskId }).then(function (payload) {
        var task = payload && payload.task;
        if (!task) throw new Error("Compute task disappeared");
        state.commandResult = { kind: "ai", task: task };
        render();
        if (task.status === "done") return task;
        if (task.status === "failed" || task.status === "canceled") {
          throw new Error(task.last_error || ("Compute task " + task.status));
        }
        if (left <= 1) return task;
        return sleep(2000).then(function () { return poll(left - 1); });
      });
    }
    return poll(attempts);
  }

  function supa(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t || !sbBase() || !sbKey()) throw new Error("signed out");
      var headers = { apikey: sbKey(), Authorization: "Bearer " + t };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.prefer) headers.Prefer = opts.prefer;
      return fetch(sbBase() + "/rest/v1/" + path, {
        method: opts.method || "GET",
        headers: headers,
        cache: "no-store",
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }).then(function (r) {
        if (!r.ok) {
          /* The status has to travel with the error, otherwise the source
             classifier cannot tell a refused read (401/403) from a broken
             one (5xx) and reports every Supabase failure as "unavailable". */
          return r.text().then(function (body) {
            var detail = null;
            try { detail = body ? JSON.parse(body) : null; } catch (e) { detail = null; }
            var message = (detail && (detail.message || detail.hint || detail.error)) || ("Supabase " + r.status);
            throw Object.assign(new Error(message), { status: r.status, detail: detail });
          });
        }
        if (r.status === 204) return null;
        return r.json().catch(function () { return null; }).then(function (rows) {
          /* PostgREST reports the unpaginated total in Content-Range when
             asked, which is how a view can say "showing 50 of 812". */
          if (!opts.count) return rows;
          var range = r.headers.get("content-range") || "";
          var total = Number(String(range).split("/")[1]);
          return { rows: rows || [], total: Number.isFinite(total) ? total : null };
        });
      });
    });
  }


  function aiThreadById(id) {
    return state.aiThreads.find(function (thread) { return String(thread.id) === String(id); }) || null;
  }

  function aiMessagesFor(threadId) {
    return (threadId && state.aiMessages[threadId]) || [];
  }

  function aiTaskAnswer(task) {
    var output = task && task.output || {};
    var answer = output.content || output.text || output.answer;
    return typeof answer === "string" ? answer.trim() : "";
  }

  function aiVoiceCapabilities() {
    return VOICE && VOICE.capabilities
      ? VOICE.capabilities()
      : { recognition: false, synthesis: false, recognitionEngine: null };
  }

  function stopAiVoiceListening(discard) {
    if (discard && VOICE && VOICE.cancelListening) VOICE.cancelListening();
    else if (VOICE && VOICE.stopListening) VOICE.stopListening();
    state.aiVoiceListening = false;
    state.aiVoiceTranscript = "";
  }

  function stopAiVoiceSpeech() {
    if (VOICE && VOICE.cancelSpeech) VOICE.cancelSpeech();
    state.aiVoiceSpeaking = false;
  }

  function speakAiText(value) {
    var content = String(value || "").trim();
    var caps = aiVoiceCapabilities();
    if (!content || !caps.synthesis || !VOICE || !VOICE.speak) return false;
    state.aiVoiceError = null;
    return VOICE.speak(content, {
      lang: navigator.language || "en-US",
      onState: function (next) {
        state.aiVoiceSpeaking = Boolean(next && next.speaking);
        render();
      },
      onError: function (error) {
        state.aiVoiceSpeaking = false;
        state.aiVoiceError = error && error.message ? error.message : String(error || "Voice playback failed");
        render();
      }
    });
  }

  function startAiVoiceTurn() {
    var caps = aiVoiceCapabilities();
    if (!caps.recognition || !VOICE || !VOICE.startListening) {
      state.aiVoiceError = "Voice input is not available in this browser. You can still use the device keyboard dictation button or type.";
      render();
      return;
    }
    if (state.aiChatPending) {
      state.aiVoiceError = "Wait for the current AI turn to finish before starting another voice turn.";
      render();
      return;
    }

    state.aiVoiceError = null;
    state.aiVoiceTranscript = "";
    state.aiChatDraft = "";
    stopAiVoiceSpeech();

    VOICE.startListening({
      lang: navigator.language || "en-US",
      onState: function (next) {
        state.aiVoiceListening = Boolean(next && next.listening);
        render();
      },
      onTranscript: function (result) {
        var spoken = String(result && result.text || "").trim();
        state.aiVoiceTranscript = spoken;
        state.aiChatDraft = spoken;
        if (!result || !result.final) {
          render();
          return;
        }
        state.aiVoiceListening = false;
        state.aiVoiceTranscript = "";
        state.aiChatDraft = "";
        render();
        if (spoken) sendAiMessage(spoken, { inputMode: "voice", speakReply: true });
      },
      onError: function (error) {
        state.aiVoiceListening = false;
        state.aiVoiceError = error && error.message ? error.message : String(error || "Voice input failed");
        render();
      }
    });
  }

  function aiMessageById(id) {
    var messages = state.selectedAiThreadId ? aiMessagesFor(state.selectedAiThreadId) : [];
    return messages.find(function (message) { return String(message.id) === String(id); }) || null;
  }

  function loadAiMessages(threadId, force) {
    if (!threadId) return Promise.resolve([]);
    if (!force && state.aiMessages[threadId]) return Promise.resolve(state.aiMessages[threadId]);
    var key = "aiMessages:" + threadId;
    if (state.pending[key]) return Promise.resolve([]);
    state.pending[key] = true;
    return supa("ops_ai_messages?select=*&thread_id=eq." + encodeURIComponent(threadId) + "&order=created_at.asc&limit=200")
      .then(function (rows) {
        state.aiMessages[threadId] = Array.isArray(rows) ? rows : [];
        delete state.pending[key];
        delete state.pending[key + ":error"];
        render();
        var thread = aiThreadById(threadId);
        return reconcileAiTaskReplies(thread, state.aiMessages[threadId])
          .then(function (rows) { return reconcileResidentAiTurns(thread, rows); });
      })
      .catch(function (error) {
        delete state.pending[key];
        state.pending[key + ":error"] = classifySourceError(error);
        render();
        return [];
      });
  }

  function createAiThread() {
    if (!state.org || !state.org.id) return Promise.reject(new Error("McCluster organization is unavailable"));
    if (state.pending.aiThreadCreate) return Promise.reject(new Error("A new chat is already being created"));
    state.pending.aiThreadCreate = true;
    return supa("ops_ai_threads?select=*", {
      method: "POST",
      body: { org_id: state.org.id, title: "New chat" },
      prefer: "return=representation"
    }).then(function (rows) {
      var thread = Array.isArray(rows) ? rows[0] : null;
      if (!thread || !thread.id) throw new Error("Chat thread was not created");
      state.aiThreads.unshift(thread);
      state.selectedAiThreadId = thread.id;
      state.aiMessages[thread.id] = [];
      state.aiChatDraft = "";
      delete state.pending.aiThreadCreate;
      render();
      return thread;
    }).catch(function (error) {
      delete state.pending.aiThreadCreate;
      state.aiChatError = error.message || String(error);
      render();
      throw error;
    });
  }

  function saveAiMessage(thread, payload) {
    return supa("ops_ai_messages?select=*", {
      method: "POST",
      body: {
        thread_id: thread.id,
        org_id: thread.org_id,
        role: payload.role,
        content: payload.content,
        model: payload.model || null,
        implementation: payload.implementation || null,
        compute_task_id: payload.compute_task_id || null,
        metadata: payload.metadata || {}
      },
      prefer: "return=representation"
    }).then(function (rows) {
      var saved = Array.isArray(rows) ? rows[0] : null;
      if (!saved) throw new Error("Chat message was not persisted");
      return saved;
    });
  }

  function attachAiTaskToUserMessage(thread, message, task, taskError, attempts) {
    if (!message || !message.id || !task || !task.id) return Promise.reject(new Error("AI task link is incomplete"));
    attempts = Math.max(1, Number(attempts || 5));
    var metadata = Object.assign({}, message.metadata || {}, {
      capability: "ai.chat",
      task_status: task.status || "queued"
    });
    if (taskError) metadata.task_error = String(taskError).slice(0, 1000);
    else delete metadata.task_error;

    function persist(left) {
      return supa("ops_ai_messages?id=eq." + encodeURIComponent(message.id) + "&thread_id=eq." + encodeURIComponent(thread.id) + "&select=*", {
        method: "PATCH",
        body: { compute_task_id: task.id, metadata: metadata },
        prefer: "return=representation"
      }).then(function (rows) {
        var updated = Array.isArray(rows) ? rows[0] : null;
        if (!updated) throw new Error("AI task recovery link was not persisted");
        return updated;
      }).catch(function (error) {
        if (left <= 1) throw error;
        var delay = Math.min(2000, 250 * Math.pow(2, attempts - left));
        return sleep(delay).then(function () { return persist(left - 1); });
      });
    }

    return persist(attempts);
  }

  function persistAiAssistantFromTask(thread, task) {
    var answer = aiTaskAnswer(task);
    if (!answer) return Promise.reject(new Error("Local AI completed without response content"));
    var output = task.output || {};
    var body = {
      id: task.id,
      thread_id: thread.id,
      org_id: thread.org_id,
      role: "assistant",
      content: answer,
      model: output.model || null,
      implementation: task.implementation || task.selected_implementation || null,
      compute_task_id: task.id,
      metadata: { capability: "ai.chat", task_status: task.status }
    };
    return supa("ops_ai_messages?on_conflict=id&select=*", {
      method: "POST",
      body: body,
      prefer: "resolution=ignore-duplicates,return=representation"
    }).then(function (rows) {
      var saved = Array.isArray(rows) ? rows[0] : null;
      if (saved) return saved;
      return supa("ops_ai_messages?id=eq." + encodeURIComponent(task.id) + "&thread_id=eq." + encodeURIComponent(thread.id) + "&select=*&limit=1")
        .then(function (existing) {
          var row = Array.isArray(existing) ? existing[0] : null;
          if (!row) throw new Error("Completed AI reply could not be recovered");
          return row;
        });
    });
  }

  function reconcileAiTaskReplies(thread, messages) {
    if (!thread || !coreToolAvailable("compute.task.get")) return Promise.resolve(messages);
    var assistantTaskIds = new Set(messages.filter(function (m) { return m.role === "assistant" && m.compute_task_id; })
      .map(function (m) { return String(m.compute_task_id); }));
    var unresolved = messages.filter(function (m) {
      var status = m.metadata && m.metadata.task_status;
      return m.role === "user" && m.compute_task_id &&
        ["failed", "canceled"].indexOf(status) < 0 &&
        !assistantTaskIds.has(String(m.compute_task_id));
    });
    if (!unresolved.length) return Promise.resolve(messages);

    var key = "aiRecover:" + thread.id;
    if (state.pending[key]) return Promise.resolve(messages);
    state.pending[key] = true;
    var failures = [];

    function replaceLocalMessage(updated) {
      var list = state.aiMessages[thread.id] || [];
      var idx = list.findIndex(function (m) { return String(m.id) === String(updated.id); });
      if (idx >= 0) list[idx] = updated;
    }

    function addAssistant(saved) {
      var list = state.aiMessages[thread.id] || [];
      if (!list.some(function (m) { return String(m.id) === String(saved.id); })) list.push(saved);
    }

    function saveTerminal(userMessage, task, message) {
      return attachAiTaskToUserMessage(thread, userMessage, task, message).then(function (updated) {
        replaceLocalMessage(updated);
        failures.push(message);
      }).catch(function (persistError) {
        failures.push(message + "; recovery status save failed: " + (persistError.message || String(persistError)));
      });
    }

    function recoverOne(item) {
      if (!item) return Promise.resolve();
      var userMessage = item.userMessage;
      var task = item.task;
      state.aiChatTask = task;

      if (task.status === "done") {
        return persistAiAssistantFromTask(thread, task).then(addAssistant).catch(function (error) {
          failures.push(error.message || String(error));
        });
      }

      if (task.status === "failed" || task.status === "canceled") {
        return saveTerminal(userMessage, task, task.last_error || ("Saved AI compute task " + task.status));
      }

      state.aiChatPending = true;
      render();
      return waitForAiTask(task.id, 330).then(function (finished) {
        return persistAiAssistantFromTask(thread, finished).then(addAssistant);
      }).catch(function (error) {
        var terminal = error && error.task && ["failed", "canceled"].indexOf(error.task.status) >= 0;
        if (terminal) return saveTerminal(userMessage, error.task, error.message || String(error));
        failures.push(error.message || String(error));
      });
    }

    var inspections = unresolved.map(function (userMessage) {
      var taskId = String(userMessage.compute_task_id);
      return callCoreTool("compute.task.get", { org_id: state.org.id, task_id: taskId }).then(function (payload) {
        var task = payload && payload.task;
        if (!task) throw new Error("Saved AI compute task disappeared: " + taskId);
        return { userMessage: userMessage, task: task };
      }).catch(function (error) {
        failures.push(error.message || String(error));
        return null;
      });
    });

    return Promise.all(inspections).then(function (items) {
      return Promise.all(items.filter(Boolean).map(recoverOne));
    }).then(function () {
      state.aiMessages[thread.id].sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
      if (failures.length) state.aiChatError = "Saved AI turn recovery: " + failures.join(" | ");
      return state.aiMessages[thread.id];
    }).then(function (rows) {
      delete state.pending[key];
      state.aiChatPending = false;
      state.aiChatTask = null;
      render();
      return rows;
    }, function (error) {
      delete state.pending[key];
      state.aiChatPending = false;
      state.aiChatTask = null;
      state.aiChatError = "Saved AI turn recovery failed: " + (error.message || String(error));
      render();
      return state.aiMessages[thread.id] || messages;
    });
  }
  function reconcileResidentAiTurns(thread, messages) {
    if (!thread || !coreToolAvailable("core.ai.turn.get")) return Promise.resolve(messages);
    var assistantJobIds = new Set(messages.filter(function (m) {
      return m.role === "assistant" && m.metadata && m.metadata.agent_job_id;
    }).map(function (m) { return String(m.metadata.agent_job_id); }));
    var unresolved = messages.filter(function (m) {
      var meta = m.metadata || {};
      return m.role === "user" &&
        meta.execution_kind === "resident_ai_turn" &&
        meta.agent_job_id &&
        !assistantJobIds.has(String(meta.agent_job_id));
    });
    if (!unresolved.length) return Promise.resolve(messages);

    var key = "aiResidentRecover:" + thread.id;
    if (state.pending[key]) return Promise.resolve(messages);
    state.pending[key] = true;
    var pending = false;
    var failures = [];

    function replaceMessage(message) {
      if (!message || !message.id) return;
      var list = state.aiMessages[thread.id] || [];
      var idx = list.findIndex(function (m) { return String(m.id) === String(message.id); });
      if (idx >= 0) list[idx] = message;
      else list.push(message);
    }

    return Promise.all(unresolved.map(function (userMessage) {
      var turnId = String(userMessage.metadata.agent_job_id);
      return callCoreTool("core.ai.turn.get", { org_id: state.org.id, turn_id: turnId }).then(function (payload) {
        var turn = payload && payload.turn;
        if (!turn) throw new Error("Saved McCluster turn disappeared: " + turnId);
        if (payload.user_message) replaceMessage(payload.user_message);
        if (payload.assistant_message) replaceMessage(payload.assistant_message);
        if (turn.status === "queued" || turn.status === "running") pending = true;
        if (turn.status === "failed" || turn.status === "canceled") {
          failures.push(turn.last_error || ("Saved McCluster turn " + turn.status));
        }
      }).catch(function (error) {
        failures.push(error.message || String(error));
      });
    })).then(function () {
      delete state.pending[key];
      state.aiMessages[thread.id].sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
      if (failures.length) state.aiChatError = "Saved McCluster turn recovery: " + failures.join(" | ");
      state.aiChatPending = pending;
      state.aiChatTask = null;
      render();
      if (pending && state.surface === "ai" && String(state.selectedAiThreadId) === String(thread.id)) {
        setTimeout(function () { loadAiMessages(thread.id, true); }, 2500);
      }
      return state.aiMessages[thread.id];
    }, function (error) {
      delete state.pending[key];
      state.aiChatPending = false;
      state.aiChatTask = null;
      state.aiChatError = "Saved McCluster turn recovery failed: " + (error.message || String(error));
      render();
      return state.aiMessages[thread.id] || messages;
    });
  }

  function waitForResidentAiTurn(turnId, attempts) {
    attempts = attempts || 330;
    if (!turnId || !state.org || !state.org.id) return Promise.reject(new Error("Resident AI turn identity unavailable"));
    function poll(left) {
      return callCoreTool("core.ai.turn.get", { org_id: state.org.id, turn_id: turnId }).then(function (payload) {
        var turn = payload && payload.turn;
        if (!turn) throw new Error("Resident McCluster turn disappeared");
        state.aiChatTask = turn;
        render();
        if (turn.status === "done") {
          if (!payload.assistant_message) throw new Error("McCluster turn completed without a persisted assistant message");
          return payload;
        }
        if (turn.status === "failed" || turn.status === "canceled") {
          var terminalError = new Error(turn.last_error || ("McCluster turn " + turn.status));
          terminalError.turn = turn;
          throw terminalError;
        }
        if (left <= 1) {
          var timeoutError = new Error("McCluster is still working on this saved turn; you can close this window and return later.");
          timeoutError.turn = turn;
          throw timeoutError;
        }
        return sleep(2000).then(function () { return poll(left - 1); });
      });
    }
    return poll(attempts);
  }

  function waitForAiTask(taskId, attempts) {
    attempts = attempts || 60;
    if (!taskId || !state.org || !state.org.id) return Promise.reject(new Error("Compute task identity unavailable"));
    function poll(left) {
      return callCoreTool("compute.task.get", { org_id: state.org.id, task_id: taskId }).then(function (payload) {
        var task = payload && payload.task;
        if (!task) throw new Error("AI compute task disappeared");
        state.aiChatTask = task;
        render();
        if (task.status === "done") return task;
        if (task.status === "failed" || task.status === "canceled") {
          var terminalError = new Error(task.last_error || ("AI compute task " + task.status));
          terminalError.task = task;
          throw terminalError;
        }
        if (left <= 1) {
          var timeoutError = new Error("AI compute task did not reach a terminal state");
          timeoutError.task = task;
          throw timeoutError;
        }
        return sleep(2000).then(function () { return poll(left - 1); });
      });
    }
    return poll(attempts);
  }

  function sendAiMessage(value, opts) {
    opts = opts || {};
    var content = String(value || "").trim();
    if (!content || state.aiChatPending) return Promise.resolve();
    state.aiChatError = null;
    var inputMode = opts.inputMode === "voice" ? "voice" : "text";
    var threadPromise = state.selectedAiThreadId
      ? Promise.resolve(aiThreadById(state.selectedAiThreadId))
      : createAiThread();

    return threadPromise.then(function (thread) {
      if (!thread) throw new Error("Select or create a chat first");
      if (!coreToolAvailable("core.ai.turn.submit") || !coreToolAvailable("core.ai.turn.get")) {
        throw new Error("Durable McCluster turn service is not available on this deployment");
      }

      var messageId = newAiTurnId();
      var submittedAt = new Date().toISOString();
      var keepPendingAfterRecovery = false;
      var optimistic = {
        id: messageId,
        thread_id: thread.id,
        org_id: thread.org_id,
        role: "user",
        content: content,
        model: null,
        implementation: null,
        compute_task_id: null,
        metadata: {
          input_mode: inputMode,
          execution_kind: "resident_ai_turn",
          agent_job_id: messageId,
          task_status: "submitting"
        },
        created_at: submittedAt
      };

      state.aiChatPending = true;
      state.aiChatTask = null;
      state.aiChatDraft = "";
      var messages = aiMessagesFor(thread.id);
      messages.push(optimistic);
      state.aiMessages[thread.id] = messages;
      if (thread.title === "New chat") thread.title = content.replace(/\s+/g, " ").slice(0, 80);
      thread.last_message_at = submittedAt;
      render();

      return callCoreTool("core.ai.turn.submit", {
        org_id: thread.org_id,
        thread_id: thread.id,
        message_id: messageId,
        content: content,
        input_mode: inputMode
      }).then(function (queued) {
        if (!queued || !queued.turn_id) throw new Error("McCluster did not return a durable turn id");
        optimistic.metadata.task_status = queued.job_status || "queued";
        state.aiChatTask = { id: queued.turn_id, status: queued.job_status || "queued", job_type: "resident_ai_turn" };
        render();
        return waitForResidentAiTurn(queued.turn_id, 330);
      }).then(function (payload) {
        var list = state.aiMessages[thread.id] || [];
        if (payload.user_message) {
          var userIdx = list.findIndex(function (m) { return String(m.id) === String(payload.user_message.id); });
          if (userIdx >= 0) list[userIdx] = payload.user_message;
          else list.push(payload.user_message);
        }
        if (payload.assistant_message && !list.some(function (m) { return String(m.id) === String(payload.assistant_message.id); })) {
          list.push(payload.assistant_message);
        }
        list.sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
        state.aiMessages[thread.id] = list;
        if (payload.assistant_message) {
          thread.last_message_at = payload.assistant_message.created_at || thread.last_message_at;
          if (opts.speakReply) speakAiText(payload.assistant_message.content);
        }
        state.aiThreads.sort(function (a, b) {
          return new Date(b.last_message_at || b.updated_at || 0) - new Date(a.last_message_at || a.updated_at || 0);
        });
      }).catch(function (error) {
        state.aiChatError = error.message || String(error);
        return sleep(1000).then(function () {
          return loadAiMessages(thread.id, true).catch(function () { return []; });
        }).then(function (rows) {
          keepPendingAfterRecovery = state.aiChatPending === true;
          return rows;
        });
      }).then(function () {
        if (!keepPendingAfterRecovery) {
          state.aiChatPending = false;
          state.aiChatTask = null;
        }
        render();
      });
    }).catch(function (error) {
      state.aiChatError = error.message || String(error);
      state.aiChatPending = false;
      state.aiChatTask = null;
      render();
    });
  }

  function note(message, bad) { var n = $("cpNote"); if (!n) return; n.textContent = message || ""; n.className = "cr-note" + (bad ? " is-err" : ""); }

  function normalizeWorkView(v) {
    if (WORK_VIEWS.indexOf(v) >= 0) return v;
    if (["crm", "front-desk"].indexOf(v) >= 0) return "pipeline";
    if (["desk", "outreach-desk"].indexOf(v) >= 0) return "outreach";
    if (["admin", "back-office"].indexOf(v) >= 0) return "operations";
    if (["client-console", "console"].indexOf(v) >= 0) return "clients";
    return "inbox";
  }
  function normalizeCreateView(v) {
    if (CREATE_VIEWS.indexOf(v) >= 0) return v;
    if (["campaigns", "canvas", "studio"].indexOf(v) >= 0) return "projects";
    if (v === "assets") return "library";
    if (["calendar", "published"].indexOf(v) >= 0) return "schedule";
    if (["management", "socials", "socials-room"].indexOf(v) >= 0) return "channels";
    if (["social-agent", "ig", "reels"].indexOf(v) >= 0) return "instagram";
    if (["music-review", "vault", "lanes", "review-desk"].indexOf(v) >= 0) return "music";
    if (["action", "uprise", "mobilize"].indexOf(v) >= 0) return "action-network";
    return "projects";
  }
  function normalizeSystemView(v) {
    if (SYSTEM_VIEWS.indexOf(v) >= 0) return v;
    if (["agents", "runs"].indexOf(v) >= 0) return "workload";
    if (["infrastructure", "deployments"].indexOf(v) >= 0) return "overview";
    if (v === "logs") return "observability";
    if (["api", "integrations", "usage"].indexOf(v) >= 0) return "resources";
    return "overview";
  }
  function readHash() {
    var raw = (location.hash || "#home").slice(1).toLowerCase().split(":");
    state.surface = SURFACES.indexOf(raw[0]) >= 0 ? raw[0] : "home";
    if (state.surface === "work") state.workView = normalizeWorkView(raw[1]);
    if (state.surface === "create") state.createView = normalizeCreateView(raw[1]);
    if (state.surface === "system") state.systemView = normalizeSystemView(raw[1]);
  }
  function routeHash() {
    if (state.surface === "work") return "#work:" + state.workView;
    if (state.surface === "create") return "#create:" + state.createView;
    if (state.surface === "system") return "#system:" + state.systemView;
    return "#" + state.surface;
  }
  function setHash(replace) {
    var next = routeHash();
    if (location.hash === next) return;
    if (replace && history.replaceState) history.replaceState(null, "", next); else location.hash = next;
  }
  function setSurface(surface, view, replace) {
    if (SURFACES.indexOf(surface) < 0) return;
    if (state.surface === "ai" && surface !== "ai") {
      stopAiVoiceListening(true);
      stopAiVoiceSpeech();
    }
    state.surface = surface;
    if (surface === "work" && view) state.workView = normalizeWorkView(view);
    if (surface === "create") state.createView = normalizeCreateView(view);
    if (surface === "system") state.systemView = normalizeSystemView(view);
    state.selectedProjectId = null;
    closeInspector();
    setHash(replace);
    render();
    try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); }
  }
  function currentView() {
    if (state.surface === "work") return state.workView;
    if (state.surface === "create") return state.createView;
    if (state.surface === "system") return state.systemView;
    return state.surface;
  }

  function row(title, subtitle, value, kind, action, extra) {
    extra = extra || {};
    var attrs = action ? ' data-action="' + esc(action) + '"' : "";
    if (extra.key) attrs += ' data-key="' + esc(extra.key) + '"';
    if (extra.id) attrs += ' data-id="' + esc(extra.id) + '"';
    return '<button class="cr-row" type="button"' + attrs + '>' +
      '<span class="cr-row__main"><span class="cr-row__title">' +
      (kind ? '<span class="' + stateClass(kind) + '">' + esc(extra.badge || titleCase(kind)) + '</span>' : "") +
      '<span>' + esc(title) + '</span></span>' +
      (subtitle ? '<span class="cr-row__sub">' + esc(subtitle) + '</span>' : "") +
      '</span><span class="cr-row__value">' + esc(value || "›") + '</span></button>';
  }
  function panel(title, meta, body, span) {
    return '<section class="cr-panel ' + (span || "cr-span-6") + '"><header class="cr-panel__head"><h2>' + esc(title) + '</h2>' +
      (meta ? '<span class="cr-panel__meta">' + esc(meta) + '</span>' : "") + '</header>' + body + '</section>';
  }
  function empty(title, body, label, action) {
    return '<div class="cr-canvas__empty"><div><strong>' + esc(title) + '</strong><div>' + esc(body || "") + '</div>' +
      (label && action ? '<button class="cr-btn cr-btn--primary" type="button" data-action="' + esc(action) + '" style="margin-top:14px">' + esc(label) + '</button>' : "") + '</div></div>';
  }
  function viewOptions(values, selected) {
    return values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selected ? " selected" : "") + '>' + esc(titleCase(v)) + '</option>'; }).join("");
  }
  function renderHeader(title, subtitle, selector) {
    return '<header class="cr-surface__head"><div><h1 class="cr-surface__title">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="cr-surface__subtitle">' + esc(subtitle) + '</p>' : "") + '</div><div class="cr-surface__tools">' +
      (selector ? '<select id="crViewSelect" class="cr-select" aria-label="Change view">' + viewOptions(selector.values, selector.selected) + '</select>' : "") +
      '<button class="cr-btn cr-btn--ghost" type="button" data-action="refresh">Refresh</button></div></header>';
  }
  function kpi(label, value, sub) { return '<div class="cr-kpi"><div class="cr-kpi__label">' + esc(label) + '</div><div class="cr-kpi__value">' + esc(value) + '</div><div class="cr-kpi__sub">' + esc(sub || "") + '</div></div>'; }

  function renderNav() {
    document.querySelectorAll("[data-surface]").forEach(function (el) {
      var active = el.getAttribute("data-surface") === state.surface;
      el.classList.toggle("is-active", active);
      if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    if ($("crTopTitle")) $("crTopTitle").textContent = titleCase(state.surface);
  }
  function renderTopStatus() {
    var healthy = Boolean(state.health && state.health.ok);
    var dot = $("crHealthDot");
    if (dot) { dot.className = "cr-health-dot" + (healthy ? " is-up" : (state.error ? " is-down" : "")); dot.title = healthy ? "API healthy" : "API status unavailable"; }
    var email = state.status && state.status.operator && state.status.operator.email;
    if ($("crAccount")) $("crAccount").textContent = email ? email.charAt(0).toUpperCase() : "M";
    if ($("crAccountEmail")) $("crAccountEmail").textContent = email || "signed in";
  }

  function leadLane(r) {
    var c = String(r && r.campaign || "").toLowerCase();
    if (c === "print-shop") return "orders";
    if (c === "merch-shop") return "orders";
    if (c === "gallery-waitlist") return "waitlist";
    if (c === "tap-card") return "cards";
    return "bookings";
  }
  function contactFromThread(t) {
    var c = t && t.comms_contacts;
    if (Array.isArray(c)) c = c[0];
    return c || {};
  }
  function threadLabel(t) {
    var c = contactFromThread(t);
    return c.display_name || c.address || t.relay_address || "Conversation";
  }

  function attentionItems() {
    var items = [];
    if (!state.sources.health || !state.sources.health.ok) items.push({ title: "Edge health unreachable", sub: "api.mccluster.org/health did not respond.", kind: "bad", action: "system-overview" });
    else if (!state.health || !state.health.ok) items.push({ title: "API reports unhealthy", sub: "The edge responded but did not report healthy.", kind: "bad", action: "system-overview" });
    if (state.status && state.status.database && !state.status.database.reachable) items.push({ title: "Database unavailable", sub: "Canonical Supabase reachability failed.", kind: "bad", action: "system-overview" });
    if (state.aiHealth && state.aiHealth.stale) items.push({ title: "Host health is stale", sub: "Core has not recorded a fresh host health result.", kind: "warn", action: "system-workload" });
    var failed = state.jobs.filter(function (j) { return j.status === "failed"; });
    if (failed.length) items.push({ title: failed.length + " failed workload" + (failed.length === 1 ? "" : "s"), sub: "Inspect the execution queue and failure output.", kind: "bad", action: "system-workload" });
    var awaiting = state.threads.filter(function (t) { return threadInQueue(t, "inbound"); });
    if (awaiting.length) items.push({ title: awaiting.length + " conversation" + (awaiting.length === 1 ? "" : "s") + " awaiting a reply", sub: "The last message on these threads came in, not out.", kind: "warn", action: "work-inbox" });
    var human = state.threads.filter(threadOwned);
    if (human.length) items.push({ title: human.length + " conversation" + (human.length === 1 ? "" : "s") + " in your control", sub: "Automation is paused on these threads until you release them.", kind: "warn", action: "work-inbox" });
    /* A decision sitting at "proposed" is literally something waiting on the
       owner, so it belongs at the top of Needs you rather than in a room of
       its own. High and critical risk are called out separately because those
       are the ones that should not sit. */
    var pending = state.decisions.filter(function (d) { return (d.status || "") === "proposed"; });
    pending.filter(function (d) { return ["high", "critical"].indexOf(d.risk_class) >= 0; })
      .slice(0, 5)
      .forEach(function (d) {
        items.push({ title: d.title || "Decision awaiting you", sub: titleCase(d.risk_class) + " risk · proposed " + ago(d.created_at), kind: "bad", action: "inspect-decision", id: d.id });
      });
    var routine = pending.filter(function (d) { return ["high", "critical"].indexOf(d.risk_class) < 0; });
    if (routine.length) items.push({ title: routine.length + " decision" + (routine.length === 1 ? "" : "s") + " awaiting you", sub: "Proposed in the AI context plane, not yet approved or rejected.", kind: "warn", action: "inspect-decision", id: routine[0].id });

    var newLeads = state.leads.filter(function (l) { return (l.status || "new") === "new"; });
    if (newLeads.length) items.push({ title: newLeads.length + " lead" + (newLeads.length === 1 ? "" : "s") + " never answered", sub: "Still in the new stage in the canonical leads table.", kind: "warn", action: "work-pipeline" });
    /* A source that could not be read is itself something that needs the
       operator — a quiet screen must never be the result of a failed query. */
    Object.keys(state.sources).forEach(function (key) {
      var s = state.sources[key];
      if (s && !s.ok && s.state !== "unsupported") {
        items.push({ title: titleCase(key) + " could not be read", sub: s.message || ("Source state: " + s.state), kind: s.state === "unauthorized" ? "warn" : "bad", action: "system-observability" });
      }
    });
    return items;
  }

  /* What actually changed, read from the newest canonical record in each
     surface. Replaces the decorative signal graphic that showed nothing. */
  function recentActivity() {
    var items = [];
    function newest(rows, when) {
      return rows.slice().sort(function (a, b) { return new Date(when(b) || 0) - new Date(when(a) || 0); })[0];
    }
    var t = newest(state.threads, function (x) { return x.updated_at; });
    if (t) items.push({ title: threadLabel(t), sub: threadOwned(t) ? "You have this thread" : "Assistant handling", when: t.updated_at, kind: "ai", action: "inspect-thread", id: t.id, badge: "Message" });
    var l = newest(state.leads, function (x) { return x.at || x.created_at; });
    if (l) items.push({ title: l.name || l.email || "Lead", sub: text(l.want || l.campaign, "New business"), when: l.at || l.created_at, kind: "info", action: "inspect-lead", id: l.id, badge: "Lead" });
    var j = newest(state.jobs, function (x) { return x.updated_at || x.created_at; });
    if (j) items.push({ title: titleCase(j.job_type), sub: "Core workload · " + titleCase(j.status || ""), when: j.updated_at || j.created_at, kind: j.status === "failed" ? "bad" : "ai", action: "inspect-job", id: j.id, badge: "Job" });
    var a = newest(state.mediaAssets, function (x) { return x.created_at; });
    if (a) items.push({ title: assetName(a), sub: "Newest generated asset", when: a.created_at, kind: "ok", action: "inspect-asset", id: a.id, badge: "Asset" });
    var p = newest(state.posts, function (x) { return x.published_at; });
    if (p) items.push({ title: text(p.caption, "Published post"), sub: "Distribution", when: p.published_at, kind: "ok", action: "inspect-post", id: p.id, badge: "Post" });
    if (!items.length) items.push({ title: "No canonical activity", sub: "No conversation, lead, job, asset, or post was returned.", when: state.refreshedAt, kind: "info", action: "refresh", badge: "Idle" });
    return items.sort(function (x, y) { return new Date(y.when || 0) - new Date(x.when || 0); });
  }


  function renderAi() {
    if (!state.selectedAiThreadId && state.aiThreads.length) state.selectedAiThreadId = state.aiThreads[0].id;
    var selected = aiThreadById(state.selectedAiThreadId);
    var messages = selected ? aiMessagesFor(selected.id) : [];
    var messageError = selected && state.pending["aiMessages:" + selected.id + ":error"];
    var ready = coreToolAvailable("ai.chat");
    var voiceCaps = aiVoiceCapabilities();

    var threads = state.aiThreads.length
      ? state.aiThreads.map(function (thread) {
          return '<button class="cr-ai-thread' + (selected && String(selected.id) === String(thread.id) ? " is-on" : "") +
            '" type="button" data-action="ai-select-thread" data-id="' + esc(thread.id) + '">' +
            '<b>' + esc(thread.title || "New chat") + '</b><small>' + esc(ago(thread.last_message_at || thread.updated_at || thread.created_at)) + '</small></button>';
        }).join("")
      : '<p class="cr-muted" style="padding:4px 6px">No chats yet.</p>';

    var body;
    if (selected && state.pending["aiMessages:" + selected.id] && !messages.length) {
      body = '<div class="cr-ai-chat__empty"><strong>Loading this conversation…</strong><span>Reading durable messages from McCluster.</span></div>';
    } else if (!messages.length) {
      body = '<div class="cr-ai-chat__empty"><strong>Talk to your own AI.</strong><span>This conversation runs through McCluster Core to your self-hosted model and is stored in your own Supabase.</span></div>';
    } else {
      body = messages.map(function (message) {
        var mine = message.role === "user";
        var label = mine ? "You" : (message.role === "assistant" ? "McCluster AI" : titleCase(message.role));
        var detail = !mine && (message.model || message.implementation)
          ? " · " + [message.model, message.implementation].filter(Boolean).join(" · ")
          : "";
        var speakControl = !mine && voiceCaps.synthesis
          ? '<button class="cr-ai-voice-replay" type="button" data-action="ai-speak-message" data-id="' + esc(message.id) + '" aria-label="Speak this McCluster AI reply">Speak</button>'
          : "";
        return '<div class="cr-ai-message cr-ai-message--' + (mine ? "user" : "assistant") + '">' +
          '<div class="cr-ai-message__meta"><span>' + esc(label) + '</span><span>' + esc(ago(message.created_at)) + detail + '</span>' + speakControl + '</div>' +
          '<div class="cr-ai-message__body">' + esc(message.content || "") + '</div></div>';
      }).join("");
    }
    if (state.aiChatPending) {
      var taskStatus = state.aiChatTask && state.aiChatTask.status || "queued";
      var pendingCopy = taskStatus === "running"
        ? "Thinking on your compute…"
        : taskStatus === "leased"
          ? "Local compute reserved. Starting inference…"
          : "Queued for local compute. Your message is saved and has not been lost.";
      body += '<div class="cr-ai-message cr-ai-message--assistant cr-ai-message--pending"><div class="cr-ai-message__meta"><span>McCluster AI</span><span>' + esc(taskStatus) + '</span></div><div class="cr-ai-message__body"><span class="cr-spin"></span> ' + esc(pendingCopy) + '</div></div>';
    }

    return renderHeader("AI", "A persistent conversation with the resident McCluster model running through your own control plane.") +
      sourceBanner(state.sources.coreBridge, "Core bridge") +
      sourceBanner(state.sources.coreTools, "AI execution path") +
      sourceBanner(state.sources.aiThreads, "AI conversations") +
      '<div class="cr-ai-chat">' +
        '<aside class="cr-ai-chat__sidebar"><div class="cr-ai-chat__sidehead">' +
          '<button class="cr-btn cr-btn--primary" type="button" data-action="ai-new-thread"' + (state.pending.aiThreadCreate ? " disabled" : "") + '>+ New chat</button>' +
          '<span class="cr-ai-local">' + (ready ? "LOCAL READY" : "AI OFFLINE") + '</span></div>' +
          '<div class="cr-ai-chat__threads">' + threads + '</div></aside>' +
        '<section class="cr-ai-chat__main">' +
          '<header class="cr-ai-chat__head"><div><b>' + esc(selected ? selected.title : "McCluster AI") + '</b><p>ai.chat → McCluster compute fabric → self-hosted model</p></div><span class="cr-ai-local">' + (ready ? "QWEN LOCAL" : "CHECK CORE") + '</span></header>' +
          '<div class="cr-ai-chat__messages">' + (messageError ? sourceBanner(messageError, "Conversation") : "") + body + '</div>' +
          '<footer class="cr-ai-chat__composer">' +
            (state.aiChatError ? '<p class="cr-fail">' + esc(state.aiChatError) + '</p>' : "") +
            (state.aiVoiceError ? '<p class="cr-fail cr-ai-voice-error">' + esc(state.aiVoiceError) + '</p>' : "") +
            '<div class="cr-ai-chat__composerbox"><textarea class="cr-textarea" id="crAiComposer" rows="2" placeholder="' + (state.aiVoiceListening ? "Listening…" : "Message McCluster AI…") + '" aria-label="Message McCluster AI"' + (!ready || state.aiChatPending || state.aiVoiceListening ? " disabled" : "") + '></textarea>' +
            '<button class="cr-btn cr-btn--voice' + (state.aiVoiceListening ? " is-listening" : "") + '" type="button" data-action="ai-voice-toggle"' + (!ready || state.aiChatPending || !voiceCaps.recognition ? " disabled" : "") + ' aria-pressed="' + (state.aiVoiceListening ? "true" : "false") + '">' + (state.aiVoiceListening ? "Stop" : "Talk") + '</button>' +
            '<button class="cr-btn cr-btn--primary" type="button" data-action="ai-send"' + (!ready || state.aiChatPending || state.aiVoiceListening ? " disabled" : "") + '>Send</button></div>' +
            '<div class="cr-ai-voice-status" role="status" aria-live="polite">' +
              '<span>' + (voiceCaps.recognition ? (state.aiVoiceListening ? "Listening now" : "Mic ready") : "Mic unavailable") + '</span>' +
              '<span>' + (voiceCaps.synthesis ? (state.aiVoiceSpeaking ? "Speaking reply" : "Voice reply ready") : "Speech playback unavailable") + '</span>' +
              (state.aiVoiceSpeaking ? '<button class="cr-ai-voice-stop" type="button" data-action="ai-stop-speaking">Stop voice</button>' : "") +
              (state.aiVoiceTranscript ? '<span class="cr-ai-voice-transcript">Heard: ' + esc(state.aiVoiceTranscript) + '</span>' : "") +
            '</div>' +
            '<p class="cr-ai-chat__hint">Talk sends one voice turn and reads that reply aloud. Voice recognition is provided by your browser/device; the resulting text uses the same durable McCluster conversation. Enter sends text · Shift+Enter adds a line.</p>' +
          '</footer></section></div>';
  }

  function publicRecordLink(title, subtitle, href, value, external) {
    return '<a class="cr-row" href="' + esc(href) + '"' +
      (external ? ' target="_blank" rel="noopener noreferrer"' : "") + '>' +
      '<span class="cr-row__main"><span class="cr-row__title"><span>' + esc(title) + '</span></span>' +
      (subtitle ? '<span class="cr-row__sub">' + esc(subtitle) + '</span>' : "") +
      '</span><span class="cr-row__value">' + esc(value || "Open") + '</span></a>';
  }

  function renderPublicRecord() {
    var source = state.sources.publicRecord;
    var record = state.publicRecord;
    if (!record) {
      if (source && !source.ok) return '<div class="cr-panel__body">' + sourceBanner(source, "Public record") + '</div>';
      return '<div class="cr-panel__body cr-muted">Loading the canonical public authority sources…</div>';
    }

    var graph = record.entityGraph || {};
    var ledger = record.evidenceLedger || {};
    var sitemap = record.sitemapPages || {};
    var pages = Array.isArray(sitemap.pages) ? sitemap.pages.length : 0;
    var evidence = Array.isArray(ledger.items) ? ledger.items.filter(function (item) {
      return item && item.verification_status === "verified" && item.publish === true;
    }).length : 0;
    var occupations = graph.person && Array.isArray(graph.person.hasOccupation) ? graph.person.hasOccupation.length : 0;

    return '<div class="cr-panel__body">' +
      props([
        ["Indexable pages", pages],
        ["Published verified evidence", evidence],
        ["Occupation records", occupations],
        ["Entity graph updated", graph.updated_at || "—"]
      ]) +
      '<p class="cr-muted">Read-only snapshot from data/seo/entity-graph.json, data/seo/evidence-ledger.json and data/seo/sitemap-pages.json — the same files that drive the public site generators.</p></div>' +
      '<div class="cr-list">' +
        publicRecordLink("Newsroom", "Verified public evidence", "newsroom.html", "Open", false) +
        publicRecordLink("Recruiter role map", "Role-to-evidence routing", "engineering/recruiter-role-map.html", "Open", false) +
        publicRecordLink("XML sitemap", "Current indexable-page inventory", "sitemap.xml", "Open", false) +
        publicRecordLink("Google Search Console", "Indexing and search performance", "https://search.google.com/search-console", "Open", true) +
        publicRecordLink("Bing Webmaster Tools", "Bing and Copilot search console", "https://www.bing.com/webmasters/", "Open", true) +
      '</div>';
  }

  function renderHome() {
    var c = state.status && state.status.counts || {};
    var attention = attentionItems();
    var activeJobs = state.jobs.filter(function (j) { return ["queued", "running"].indexOf(j.status) >= 0; });
    var inboxRows = attention.length ? attention.map(function (it) { return row(it.title, it.sub, "Open", it.kind, it.action, { id: it.id, badge: it.kind === "bad" ? "Issue" : "Review" }); }).join("") :
      '<div class="cr-panel__body"><span class="' + stateClass("ok") + '">All clear</span><p class="cr-muted">No instrumented exception currently needs you.</p></div>';
    var workRows = activeJobs.slice(0, 6).map(function (j) {
      return row(titleCase(j.job_type), text(j.target_id, j.target_type), titleCase(j.status), j.status === "running" ? "ai" : "info", "inspect-job", { id: j.id, badge: j.status });
    }).join("") || '<div class="cr-panel__body cr-muted">No queued or running canonical jobs.</div>';

    return renderHeader("Home", "Exceptions first. Everything else stays quiet until it matters.") +
      '<section class="cr-command-hero"><h1>What do you want done?</h1><div class="cr-command-hero__box"><input id="crHeroInput" autocomplete="off" placeholder="Search, navigate, or give McCluster an objective…" aria-label="Search or command McCluster"><button class="cr-btn cr-btn--primary" type="button" data-action="hero-command">Go</button></div>' +
      '<div class="cr-quick"><button class="cr-chip" data-action="work-inbox">Inbox</button><button class="cr-chip" data-action="work-pipeline">Pipeline</button><button class="cr-chip" data-action="create-projects">Create</button><button class="cr-chip" data-action="system-workload">Workload</button><button class="cr-chip" data-action="apps">Apps</button></div></section>' +
      '<div class="cr-kpis">' +
      kpi("Conversations", String(state.threads.length || count(c.conversations)), "live work") +
      kpi("Open leads", String(state.leads.filter(function (x) { return x.status !== "closed"; }).length), "business") +
      kpi("Active jobs", String(activeJobs.length), "canonical workload") +
      kpi("Projects", String(state.campaigns.length), "creative") + '</div>' +
      '<div class="cr-grid cr-home-grid">' +
      panel("Needs you", attention.length ? attention.length + " item" + (attention.length === 1 ? "" : "s") : "clear", '<div class="cr-list">' + inboxRows + '</div>', "cr-span-7") +
      panel("Working now", activeJobs.length + " active", '<div class="cr-list">' + workRows + '</div>', "cr-span-5") +
      panel("Recent activity", "last change per surface", '<div class="cr-list">' + recentActivity().map(function (a) {
        return row(a.title, a.sub, ago(a.when), a.kind, a.action, a.id ? { id: a.id, badge: a.badge } : { badge: a.badge });
      }).join("") + '</div>', "cr-span-7") +
      panel("System pulse", state.health && state.health.ok ? "operational" : "check", '<div class="cr-list">' +
        row("API Worker", "api.mccluster.org", state.health && state.health.ok ? "Healthy" : "Check", state.health && state.health.ok ? "ok" : "bad", "system-overview") +
        row("Database", "Canonical Supabase", state.status && state.status.database && state.status.database.reachable ? "Healthy" : "Check", state.status && state.status.database && state.status.database.reachable ? "ok" : "warn", "system-overview") +
        row("Core", "ai_context-v4", state.ai && state.ai.ok ? "Healthy" : "Inspect", state.ai && state.ai.ok ? "ai" : "warn", "system-workload") +
      '</div>', "cr-span-5") +
      panel("Public record", "canonical search authority", renderPublicRecord(), "cr-span-12") + '</div>';
  }

  function unifiedInbox() {
    var items = [];
    state.threads.forEach(function (t) {
      items.push({ type: "Message", title: threadLabel(t), sub: t.mode === "human" ? "Human control" : "AI handling", when: t.updated_at || t.last_inbound_at, kind: t.mode === "human" ? "warn" : "ai", action: "inspect-thread", id: t.id });
    });
    state.leads.slice(0, 100).forEach(function (l) {
      items.push({ type: "Lead", title: l.name || l.email || "Lead", sub: l.want || l.note || l.campaign || "New business", when: l.at || l.created_at, kind: l.status === "new" ? "info" : "ok", action: "inspect-lead", id: l.id });
    });
    state.siteRequests.forEach(function (r) {
      items.push({ type: "Request", title: r.title || r.request_type || r.kind || "Site request", sub: r.status || r.page || "Client request", when: r.created_at || r.at, kind: "warn", action: "inspect-request", id: r.id });
    });
    return items.sort(function (a, b) { return new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime(); });
  }

  /* CONVERSATION OWNERSHIP.

     The one thing this screen must never be ambiguous about is who owns a
     thread. An operator typing into a conversation the assistant still
     controls — or assuming a handover happened when it did not — is the
     failure that matters, so ownership is stated in the list, in the
     header, and in the composer's enabled state, all read from `mode`. */
  function threadOwned(t) { return (t && t.mode) === "human"; }
  function ownerPill(t) { return threadOwned(t) ? '<span class="' + stateClass("ok") + '">You have it</span>' : '<span class="' + stateClass("ai") + '">Assistant</span>'; }

  var THREAD_QUEUES = [["all", "All"], ["human", "You have it"], ["assistant", "Assistant"], ["inbound", "Awaiting reply"]];
  function threadInQueue(t, queue) {
    if (queue === "human") return threadOwned(t);
    if (queue === "assistant") return !threadOwned(t);
    if (queue === "inbound") {
      var inbound = t.last_inbound_at ? new Date(t.last_inbound_at).getTime() : 0;
      var outbound = t.last_outbound_at ? new Date(t.last_outbound_at).getTime() : 0;
      return inbound > outbound;
    }
    return true;
  }

  var TRANSCRIPT_PAGE = 50;
  var DELIVERY_KIND = { delivered: "ok", sent: "ok", received: "info", queued: "warn", claimed: "warn", failed: "bad", suppressed: "bad" };
  function renderTranscript(threadId) {
    var result = state.transcripts[threadId];
    if (!result) return '<div class="cr-convo__body">' + empty("Loading conversation", "Reading the canonical transcript.") + '</div>';
    if (!result.ok) return '<div class="cr-convo__body">' + sourceBanner(result, "Transcript") + '</div>';
    var messages = (result.data && result.data.messages) || [];
    if (!messages.length) {
      return '<div class="cr-convo__body">' + empty("No messages yet", "This thread exists but carries no messages in comms_messages.") + '</div>';
    }
    /* Older messages are fetched on request rather than capped silently: a
       transcript that simply stops at N looks like the whole conversation. */
    var earlierBusy = state.pending["earlier:" + threadId];
    var earlierError = state.pending["earlierError:" + threadId];
    var head = result.data.has_more
      ? '<div class="cr-convo__earlier">' +
          '<button class="cr-btn cr-btn--ghost" type="button" data-action="load-earlier" data-id="' + esc(threadId) + '"' + (earlierBusy ? " disabled" : "") + '>' +
          (earlierBusy ? "Loading…" : "Load earlier messages") + '</button></div>'
      : '<p class="cr-convo__earlier cr-muted">Start of the conversation.</p>';
    return '<div class="cr-convo__body">' + head +
      (earlierError ? sourceBanner(earlierError, "Earlier messages") : "") +
      messages.map(function (m) {
      var out = m.direction === "outbound";
      var kind = DELIVERY_KIND[m.status] || "info";
      return '<div class="cr-msg' + (out ? " cr-msg--out" : "") + '">' +
        '<div class="cr-msg__meta"><span>' + esc(titleCase(m.sender_type || m.direction || "message")) + '</span>' +
        '<span>' + esc(ago(m.occurred_at || m.created_at)) + '</span>' +
        '<span class="' + stateClass(kind) + '">' + esc(m.status || "—") + '</span></div>' +
        '<div class="cr-msg__body">' + esc(m.body || "") + '</div></div>';
    }).join("") + '</div>';
  }

  function renderConversation(thread) {
    if (!thread) return '<div class="cr-convo">' + empty("Select a conversation", "Pick a thread to read its transcript and take control.") + '</div>';
    var owned = threadOwned(thread);
    var c = contactFromThread(thread);
    var sending = state.pending["send:" + thread.id];
    var switching = state.pending["mode:" + thread.id];
    var failure = state.pending["error:" + thread.id];
    return '<div class="cr-convo">' +
      '<header class="cr-convo__head"><div><b>' + esc(threadLabel(thread)) + '</b>' +
      '<p class="cr-muted">' + esc(c.address || thread.relay_address || "—") + ' · ' + esc(thread.channel || "sms") + ' · last activity ' + esc(ago(thread.updated_at)) + '</p></div>' +
      ownerPill(thread) + '</header>' +
      renderTranscript(thread.id) +
      (failure ? '<div class="cr-convo__error">' + sourceBanner(failure, "Last action") + '</div>' : "") +
      '<footer class="cr-convo__foot">' +
      '<textarea class="cr-textarea" id="crReply" rows="2" placeholder="' +
      (owned ? "Reply as the operator…" : "Take the thread over before replying.") + '"' + (owned && !sending ? "" : " disabled") + '></textarea>' +
      '<div class="cr-convo__actions">' +
      (owned
        ? '<button class="cr-btn cr-btn--primary" type="button" data-action="thread-send" data-id="' + esc(thread.id) + '"' + (sending ? " disabled" : "") + '>' + (sending ? "Queueing…" : "Send") + '</button>' +
          '<button class="cr-btn" type="button" data-action="thread-mode" data-id="' + esc(thread.id) + '" data-mode="release"' + (switching ? " disabled" : "") + '>' + (switching ? "Working…" : "Return to assistant") + '</button>'
        : '<button class="cr-btn" type="button" disabled title="Take the thread over first — the assistant currently owns it.">Send</button>' +
          '<button class="cr-btn cr-btn--primary" type="button" data-action="thread-mode" data-id="' + esc(thread.id) + '" data-mode="takeover"' + (switching ? " disabled" : "") + '>' + (switching ? "Working…" : "Take over") + '</button>') +
      '<button class="cr-btn cr-btn--ghost" type="button" data-action="inspect-thread" data-id="' + esc(thread.id) + '">Details</button>' +
      '</div></footer></div>';
  }

  function renderWorkInbox() {
    var threadsResult = state.sources.threads;
    var banners = sourceStates([["Conversations", threadsResult], ["Leads", state.sources.leads], ["Site requests", state.sources.siteRequests]]);
    var visible = state.threads.filter(function (t) { return threadInQueue(t, state.threadFilter); });
    var selected = state.threads.find(function (t) { return String(t.id) === String(state.selectedThreadId); }) || null;
    var other = unifiedInbox().filter(function (it) { return it.action !== "inspect-thread"; });

    var list = visible.length
      ? visible.map(function (t) {
          return '<button type="button" class="cr-thread' + (String(t.id) === String(state.selectedThreadId) ? " is-on" : "") + '" data-action="select-thread" data-id="' + esc(t.id) + '">' +
            '<span class="cr-thread__top"><b>' + esc(threadLabel(t)) + '</b><time>' + esc(ago(t.updated_at)) + '</time></span>' +
            '<span class="cr-thread__sub">' + ownerPill(t) + '<em>' + esc(t.channel || "sms") + '</em></span></button>';
        }).join("")
      : (threadsResult && threadsResult.ok
          ? '<div class="cr-board__empty">No conversations in this queue.</div>'
          : '<div class="cr-board__empty">Conversations could not be read.</div>');

    return banners + '<div class="cr-inbox">' +
      '<div class="cr-inbox__list"><div class="cr-filterchips cr-filterchips--inbox">' +
      THREAD_QUEUES.map(function (q) {
        var n = state.threads.filter(function (t) { return threadInQueue(t, q[0]); }).length;
        return '<button class="cr-chip' + (state.threadFilter === q[0] ? " is-on" : "") + '" type="button" data-thread-filter="' + q[0] + '">' + esc(q[1]) + ' <b>' + n + '</b></button>';
      }).join("") + '</div><div class="cr-threadlist">' + list + '</div>' +
      (other.length ? '<div class="cr-inbox__other"><h3>Other incoming work</h3><div class="cr-list">' +
        other.slice(0, 40).map(function (it) { return row(it.title, it.sub, ago(it.when), it.kind, it.action, { id: it.id, badge: it.type }); }).join("") + '</div></div>' : "") +
      '</div>' + renderConversation(selected) + '</div>';
  }

  /* Loads a transcript once per selection and re-renders when it lands.
     A failed read is stored as a failed result, never as an empty list. */
  var transcriptInflight = {};
  function loadTranscript(threadId, force) {
    if (!threadId) return Promise.resolve();
    if (state.transcripts[threadId] && !force) return Promise.resolve();
    /* A forced reload clears the cached transcript and re-renders, which is
       exactly the condition render()'s auto-load watches for — without this
       guard the two paths race and fetch the same thread twice. */
    if (transcriptInflight[threadId]) return transcriptInflight[threadId];
    delete state.transcripts[threadId];
    /* The request is started and registered BEFORE the loading render, because
       that render is what re-enters this function via render()'s auto-load. */
    var pending = src(request("/v1/comms/threads/" + encodeURIComponent(threadId) + "/messages?limit=" + TRANSCRIPT_PAGE)).then(function (result) {
      delete transcriptInflight[threadId];
      state.transcripts[threadId] = result;
      if (result.ok && result.data && result.data.thread) {
        var idx = state.threads.findIndex(function (t) { return String(t.id) === String(threadId); });
        if (idx >= 0) state.threads[idx] = Object.assign({}, state.threads[idx], result.data.thread);
      }
      render();
    });
    transcriptInflight[threadId] = pending;
    render(); /* shows the loading state; safe now that the guard is set */
    return pending;
  }

  /* Walks backwards through the thread with the server's keyset cursor and
     prepends the older page. Messages are keyed by id on merge because a
     cursor page can legitimately overlap the page before it. */
  function loadEarlier(threadId) {
    var current = state.transcripts[threadId];
    if (!current || !current.ok || !current.data || !current.data.has_more) return;
    if (state.pending["earlier:" + threadId]) return;
    state.pending["earlier:" + threadId] = true;
    render();
    var q = "/v1/comms/threads/" + encodeURIComponent(threadId) + "/messages?limit=" + TRANSCRIPT_PAGE +
      "&before=" + encodeURIComponent(current.data.next_before || "") +
      (current.data.next_before_id ? "&before_id=" + encodeURIComponent(current.data.next_before_id) : "");
    src(request(q)).then(function (page) {
      delete state.pending["earlier:" + threadId];
      if (!page.ok) { state.pending["earlierError:" + threadId] = page; render(); return; }
      delete state.pending["earlierError:" + threadId];
      var older = (page.data && page.data.messages) || [];
      var seen = {};
      var merged = older.concat(current.data.messages || []).filter(function (m) {
        if (seen[m.id]) return false;
        seen[m.id] = true;
        return true;
      });
      state.transcripts[threadId] = okResult(Object.assign({}, current.data, {
        messages: merged,
        has_more: Boolean(page.data && page.data.has_more),
        next_before: page.data && page.data.next_before,
        next_before_id: page.data && page.data.next_before_id
      }));
      render();
    });
  }

  /* The four persisted lead states. These are the states the `leads` table
     actually stores — the console does not invent a fifth. */
  var LEAD_STAGES = ["new", "replied", "booked", "closed"];
  var LEAD_STAGE_LABELS = { "new": "New", replied: "Contacted", booked: "Booked", closed: "Closed" };

  /* LEAD QUERY.

     Search runs on the server. Filtering the loaded page in the browser can
     only ever find leads that happened to be in it, so a search that came
     back empty could not be trusted to mean "no such lead". */
  var LEAD_PAGE = 200;
  var LEAD_SEARCH_COLUMNS = ["name", "email", "want", "note", "campaign", "source", "page"];

  function leadQueryPath(limit, offset) {
    var q = String(state.search || "").trim();
    var parts = ["select=*", "order=at.desc", "limit=" + limit, "offset=" + (offset || 0)];
    if (state.pipelineStage !== "all") parts.push("status=eq." + encodeURIComponent(state.pipelineStage));
    if (q) {
      /* PostgREST `or` with ilike. Commas and parens would break out of the
         filter group, so they are stripped rather than escaped. */
      var safe = q.replace(/[(),*]/g, " ").trim();
      if (safe) {
        parts.push("or=(" + LEAD_SEARCH_COLUMNS.map(function (c) {
          return c + ".ilike.*" + encodeURIComponent(safe) + "*";
        }).join(",") + ")");
      }
    }
    return "leads?" + parts.join("&");
  }

  function runLeadQuery(append) {
    var offset = append ? state.leads.length : 0;
    var key = leadQueryPath(LEAD_PAGE, offset);
    state.pending.leads = true;
    if (!append) state.leadTotal = null;
    render();
    return src(supa(key, { count: true, prefer: "count=exact" })).then(function (result) {
      delete state.pending.leads;
      /* A newer keystroke already superseded this response. */
      if (leadQueryPath(LEAD_PAGE, offset) !== key) return;
      state.sources.leads = result.ok ? okResult((result.data && result.data.rows) || []) : result;
      var rows = result.ok ? ((result.data && result.data.rows) || []) : [];
      state.leads = append ? state.leads.concat(rows) : rows;
      state.leadTotal = result.ok && result.data ? result.data.total : null;
      render();
    });
  }

  var leadSearchTimer = null;
  function scheduleLeadQuery() {
    clearTimeout(leadSearchTimer);
    leadSearchTimer = setTimeout(function () { runLeadQuery(false); }, 260);
  }

  /* The board renders whatever the current server query returned. */
  function pipelineLeads() { return state.leads; }

  /* States what the loaded rows actually represent: which query produced
     them, and how many the server says match it. */
  function leadScopeNote() {
    if (state.pending.leads) return '<p class="cr-derived">Querying leads…</p>';
    if (!state.sources.leads || !state.sources.leads.ok) return "";
    var bits = [];
    var q = String(state.search || "").trim();
    if (q) bits.push('matching "' + q + '"');
    if (state.pipelineStage !== "all") bits.push("in " + (LEAD_STAGE_LABELS[state.pipelineStage] || state.pipelineStage));
    var scope = bits.length ? " " + bits.join(" ") : "";
    if (state.leadTotal === null || state.leadTotal === undefined) {
      return '<p class="cr-derived">Showing ' + state.leads.length + ' lead' + (state.leads.length === 1 ? "" : "s") + scope + '. The server did not report a total.</p>';
    }
    if (state.leadTotal > state.leads.length) {
      return '<p class="cr-derived">Showing ' + state.leads.length + ' of ' + state.leadTotal + ' leads' + scope + '. Search runs on the server, so this covers every lead, not just the loaded page.</p>';
    }
    return '<p class="cr-derived">' + state.leadTotal + ' lead' + (state.leadTotal === 1 ? "" : "s") + scope + '.</p>';
  }

  function leadMore() {
    if (state.pending.leads) return "";
    if (state.leadTotal === null || state.leadTotal === undefined) return "";
    if (state.leads.length >= state.leadTotal) return "";
    return '<div class="cr-more"><button class="cr-btn" type="button" data-action="more-leads">Load ' +
      Math.min(LEAD_PAGE, state.leadTotal - state.leads.length) + ' more</button></div>';
  }

  function renderPipeline() {
    var banner = sourceBanner(state.sources.leads, "Leads");
    var leads = pipelineLeads();
    var stages = state.pipelineStage === "all" ? LEAD_STAGES : [state.pipelineStage];
    var board = '<div class="cr-board">' + stages.map(function (stage) {
      var rows = leads.filter(function (l) { return (l.status || "new") === stage; });
      return '<section class="cr-board__col"><header><span>' + esc(LEAD_STAGE_LABELS[stage] || titleCase(stage)) + '</span><b>' + rows.length + '</b></header><div class="cr-board__stack">' +
        (rows.length ? rows.map(function (l) {
          return '<button type="button" class="cr-card" data-action="inspect-lead" data-id="' + esc(l.id) + '"><strong>' + esc(l.name || l.email || "Lead") + '</strong><span>' + esc(l.want || l.campaign || "Inquiry") + '</span><small>' + esc(ago(l.at || l.created_at)) + '</small></button>';
        }).join("") : '<div class="cr-board__empty">' +
          (state.sources.leads && state.sources.leads.ok ? "No records" : "Not readable") + '</div>') + '</div></section>';
    }).join("") + '</div>';
    /* Counts are of the loaded set; the server's total for the current query
       is stated separately so a partial page is never mistaken for the whole
       pipeline. */
    var chips = '<div class="cr-filterchips"><button class="cr-chip' + (state.pipelineStage === "all" ? " is-on" : "") + '" type="button" data-stage-filter="all">All</button>' +
      LEAD_STAGES.map(function (s) {
        return '<button class="cr-chip' + (state.pipelineStage === s ? " is-on" : "") + '" type="button" data-stage-filter="' + s + '">' + esc(LEAD_STAGE_LABELS[s]) + '</button>';
      }).join("") + '</div>';
    return banner + chips + leadScopeNote() + board + leadMore();
  }

  function personRows() {
    var map = {};
    state.leads.forEach(function (l) {
      var key = String(l.email || l.name || l.id || "").toLowerCase(); if (!key) return;
      map[key] = map[key] || { id: l.id, name: l.name || l.email, contact: l.email || "", last: l.at || l.created_at, source: l.source || l.campaign || "lead", lead: l };
      if (new Date(l.at || l.created_at || 0) > new Date(map[key].last || 0)) map[key].last = l.at || l.created_at;
    });
    state.threads.forEach(function (t) {
      var c = contactFromThread(t); var key = String(c.address || c.display_name || t.id).toLowerCase();
      if (!map[key]) map[key] = { id: t.id, name: c.display_name || c.address || "Contact", contact: c.address || "", last: t.updated_at, source: "communications", thread: t };
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return new Date(b.last || 0) - new Date(a.last || 0); });
  }

  function renderTable(columns, rows, emptyText) {
    if (!rows.length) return '<div class="cr-canvas">' + empty(emptyText || "No records", "Nothing was returned by the canonical source for this view.") + '</div>';
    return '<div class="cr-table-wrap"><table class="cr-data-table"><thead><tr>' + columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr' + (r.action ? ' data-action="' + esc(r.action) + '" data-id="' + esc(r.id) + '" tabindex="0"' : "") + '>' + columns.map(function (c) { return '<td>' + (c.html ? c.html(r) : esc(text(r[c.key], ""))) + '</td>'; }).join("") + '</tr>'; }).join("") + '</tbody></table></div>';
  }

  /* States a view's real backing rather than letting a derived view imply a
     first-class record type that does not exist yet. */
  function derivedNote(text) { return '<p class="cr-derived">' + esc(text) + '</p>'; }

  function renderPeople() {
    var people = personRows();
    return sourceStates([["Leads", state.sources.leads], ["Conversations", state.sources.threads]]) +
      derivedNote("People are derived from canonical leads and conversation contacts. There is no separate people table yet, so a person exists here only where one of those records does.") +
      renderTable([
        { label: "Person", key: "name" }, { label: "Contact", key: "contact" }, { label: "Relationship", key: "source" },
        { label: "Last activity", html: function (r) { return esc(ago(r.last)); } }
      ], people.map(function (p) { p.action = p.thread ? "inspect-thread" : "inspect-lead"; return p; }), "No people yet");
  }

  function renderCompanies() {
    var companyMap = {};
    state.leads.forEach(function (l) {
      var name = l.company || l.organization || l.org_name || "";
      if (!name) return;
      var k = name.toLowerCase(); companyMap[k] = companyMap[k] || { name: name, people: 0, last: l.at || l.created_at, id: l.id };
      companyMap[k].people += 1;
    });
    var companies = Object.keys(companyMap).map(function (k) { return companyMap[k]; });
    /* Companies are real records now (out_companies via /v1/work/companies);
       a lead joins one through company_id. The free-text grouping below only
       shows legacy leads that carried a company string. */
    return sourceBanner(state.sources.leads, "Leads") + (window.CR.work ? window.CR.work.section("companies") : "") +
      (companies.length ? derivedNote("Legacy: grouped from a free-text company field on older leads. Create the company above to make it a record.") : "") +
      (companies.length ? renderTable([{ label: "Company", key: "name" }, { label: "People", key: "people" }, { label: "Last activity", html: function (r) { return esc(ago(r.last)); } }], companies, "No company records yet") : "");
  }

  function renderClients() {
    var rows = state.leads.filter(function (l) { return l.status === "booked" || l.status === "closed"; }).map(function (l) { return { id: l.id, action: "inspect-lead", name: l.name || l.email, service: l.want || l.campaign || "Client work", status: l.status, last: l.at || l.created_at }; });
    var requests = (state.siteRequests || []).map(function (r) {
      return { site: r.site_name || r.site_slug || r.site_id || "Client site", request: r.body || r.kind || "Site request", status: r.status || "new", last: r.created_at };
    });
    return sourceStates([["Leads", state.sources.leads], ["Site requests", state.sources.siteRequests]]) +
      derivedNote("Clients are booked/closed leads; site change requests stay beside them so the owner no longer needs a separate Business Console.") +
      '<div class="cr-grid">' +
        panel("Clients", rows.length + " records", renderTable([{ label: "Client", key: "name" }, { label: "Work", key: "service" }, { label: "State", key: "status" }, { label: "Last activity", html: function (r) { return esc(ago(r.last)); } }], rows, "No client records yet"), "cr-span-6") +
        panel("Site requests", requests.length + " requests", renderTable([{ label: "Site", key: "site" }, { label: "Request", key: "request" }, { label: "State", key: "status" }, { label: "Received", html: function (r) { return esc(ago(r.last)); } }], requests, "No site requests yet"), "cr-span-6") +
      '</div>';
  }

  function renderTasks() {
    var tasks = [];
    state.leads.filter(function (l) { return l.status !== "closed"; }).forEach(function (l) {
      tasks.push({ id: l.id, action: "inspect-lead", task: l.status === "new" ? "Reply to " + (l.name || l.email || "lead") : (l.status === "replied" ? "Advance " + (l.name || "lead") : "Confirm next step with " + (l.name || "client")), related: l.want || l.campaign || "Lead", due: l.at || l.created_at });
    });
    state.jobs.filter(function (j) { return j.status === "failed"; }).forEach(function (j) {
      tasks.push({ id: j.id, action: "inspect-job", task: "Resolve failed " + titleCase(j.job_type), related: text(j.target_id, j.target_type), due: j.updated_at || j.created_at });
    });
    return sourceStates([["Leads", state.sources.leads], ["Workload", state.sources.jobs]]) +
      (window.CR.work ? window.CR.work.section("tasks") : "") +
      derivedNote("Suggested next actions, implied by leads that have not closed and by failed Core jobs. They are not stored; create a task above to track one.") +
      renderTable([{ label: "Next action", key: "task" }, { label: "Related", key: "related" }, { label: "Since", html: function (r) { return esc(ago(r.due)); } }], tasks, "No open next actions");
  }

  function renderOrdersBookings(view) {
    var lane = view === "orders" ? "orders" : "bookings";
    var rows = state.leads.filter(function (l) { return leadLane(l) === lane; }).map(function (l) { return { id: l.id, action: "inspect-lead", name: l.name || l.email, item: l.want || l.note || l.campaign || titleCase(lane), status: l.status || "new", last: l.at || l.created_at }; });
    return sourceBanner(state.sources.leads, "Leads") +
      (window.CR.work ? window.CR.work.section(view === "orders" ? "orders" : "bookings") : "") +
      derivedNote("Incoming: leads routed to the " + lane + " lane by campaign. Turn one into a real " + (view === "orders" ? "order" : "booking") + " record above when it is agreed.") +
      renderTable([{ label: view === "orders" ? "Customer" : "Contact", key: "name" }, { label: view === "orders" ? "Order" : "Booking", key: "item" }, { label: "State", key: "status" }, { label: "Received", html: function (r) { return esc(ago(r.last)); } }], rows, "No " + view + " yet");
  }

  function futureWorkSlot(view) {
    return state.futureWork[view] || null;
  }

  function loadFutureWork(view, force) {
    var contract = FUTURE_WORK[view];
    if (!contract) return Promise.resolve();
    if (state.futureWork[view] && !force) return Promise.resolve();
    state.futureWork[view] = { loading: true, result: null };
    render();
    var query = state.org && state.org.id ? "?org_id=" + encodeURIComponent(state.org.id) : "";
    return src(request(contract.endpoint + query)).then(function (result) {
      state.futureWork[view] = { loading: false, result: result };
      render();
    });
  }

  function futureWorkRows(view) {
    var contract = FUTURE_WORK[view], slot = futureWorkSlot(view);
    var result = slot && slot.result;
    if (!contract || !result || !result.ok) return [];
    var data = result.data || {};
    if (Array.isArray(data)) return data;
    if (Array.isArray(data[contract.collection])) return data[contract.collection];
    if (Array.isArray(data.items)) return data.items;
    return [];
  }

  function futureWorkName(view, record) {
    record = record || {};
    if (view === "relationships") return record.label || record.relationship_type || "Relationship";
    if (view === "payments") return record.memo || record.description || (record.amount_cents != null ? moneyCents(record.amount_cents) : "Payment");
    return record.title || record.name || titleCase((FUTURE_WORK[view] && FUTURE_WORK[view].singular) || view);
  }

  function futureWorkRelated(record) {
    return record.company_name || record.client_name || record.person_name ||
      record.company_id || record.client_id || record.person_id || record.project_id || record.order_id || "—";
  }

  function futureFieldDisplay(field, value) {
    if (value === null || value === undefined || value === "") return "—";
    if (field.scale === 100) return moneyCents(value);
    if (field.instant) return formatDate(value);
    return text(value);
  }

  function futureInputValue(field, value) {
    if (value === null || value === undefined) return "";
    if (field.scale === 100) return (Number(value) / 100).toFixed(2);
    if (field.instant) {
      var d = new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    return String(value);
  }

  function futureFormHtml(view, record) {
    var contract = FUTURE_WORK[view];
    return '<div class="cr-gen">' + contract.fields.map(function (field) {
      var value = futureInputValue(field, record && record[field.key]);
      var id = "crFuture_" + field.key;
      if (field.textarea) {
        return '<textarea class="cr-textarea" id="' + esc(id) + '" rows="3" placeholder="' + esc(field.placeholder || field.label) + '"' +
          (field.required ? " required" : "") + '>' + esc(value) + '</textarea>';
      }
      return '<input class="cr-input" id="' + esc(id) + '" type="' + esc(field.type || "text") + '"' +
        (field.min !== undefined ? ' min="' + esc(field.min) + '"' : "") +
        (field.max !== undefined ? ' max="' + esc(field.max) + '"' : "") +
        (field.step !== undefined ? ' step="' + esc(field.step) + '"' : "") +
        (field.required ? " required" : "") +
        ' aria-label="' + esc(field.label) + '" placeholder="' + esc(field.placeholder || field.label) + '" value="' + esc(value) + '">';
    }).join("") + '</div>';
  }

  function openFutureWorkForm(view, id) {
    var contract = FUTURE_WORK[view];
    if (!contract) return;
    var record = id ? futureWorkRows(view).find(function (row) { return String(row.id) === String(id); }) : null;
    var slot = futureWorkSlot(view), result = slot && slot.result;
    var supported = Boolean(result && result.ok);
    var failure = state.pending["futureWorkError:" + view];
    openInspector({
      title: (record ? "Edit " : "New ") + titleCase(contract.singular),
      subtitle: "Work · " + contract.title,
      description: contract.summary,
      custom: futureFormHtml(view, record) +
        (!supported ? inspectorSection("Backend boundary",
          '<div class="cr-gap"><b>The Control UI contract is complete.</b><span>' +
          esc(contract.endpoint) + ' is not provisioned on the canonical Worker yet. These fields and record semantics are the interface the backend will satisfy.</span></div>') : "") +
        (failure ? inspectorSection("Not saved", sourceBanner(failure, contract.title)) : ""),
      actions: '<button class="cr-btn cr-btn--primary" type="button" data-action="future-work-save" data-view="' + esc(view) + '"' +
        (record ? ' data-id="' + esc(record.id) + '"' : "") + (supported || state.pending["futureWorkSave:" + view] ? "" : " disabled") +
        (state.pending["futureWorkSave:" + view] ? " disabled" : "") + '>' +
        (state.pending["futureWorkSave:" + view] ? "Saving…" : (record ? "Save changes" : "Create " + esc(contract.singular))) + '</button>',
      raw: record || { contract: contract.endpoint, fields: contract.fields },
      tabs: ["overview", "raw", "ai"]
    });
  }

  function inspectFutureWork(view, id) {
    var contract = FUTURE_WORK[view];
    var record = futureWorkRows(view).find(function (row) { return String(row.id) === String(id); });
    if (!contract || !record) return;
    openInspector({
      title: futureWorkName(view, record),
      subtitle: "Work · " + contract.title,
      description: contract.summary,
      props: contract.fields.map(function (field) { return [field.label, futureFieldDisplay(field, record[field.key])]; }),
      actions: '<button class="cr-btn cr-btn--primary" type="button" data-action="future-work-edit" data-view="' + esc(view) + '" data-id="' + esc(record.id) + '">Edit</button>',
      raw: record,
      tabs: ["overview", "activity", "related", "raw", "ai"]
    });
  }

  function renderFutureWork(view) {
    var contract = FUTURE_WORK[view], slot = futureWorkSlot(view);
    if (!contract) return "";
    if (!slot || slot.loading) {
      return '<div class="cr-grid">' +
        panel(contract.title, "canonical contract", '<div class="cr-panel__body"><p class="cr-muted">Checking ' + esc(contract.endpoint) + '…</p></div>', "cr-span-12") +
      '</div>';
    }
    var result = slot.result;
    var records = futureWorkRows(view);
    var banner = result && !result.ok ? sourceBanner(result, contract.title) : "";
    var contractNote = result && result.ok
      ? '<p class="cr-derived">Backed by ' + esc(contract.endpoint) + '. Records in this view are canonical, not derived.</p>'
      : '<div class="cr-gap"><b>Future-ready Control surface</b><span>The record model, create/edit form, inspector, route, empty/loading/error states and navigation are finished. The Worker route is the remaining plumbing.</span></div>';
    var rows = records.map(function (record) {
      return {
        id: record.id,
        action: "inspect-future-work:" + view,
        name: futureWorkName(view, record),
        related: futureWorkRelated(record),
        status: record.status || record.approval_status || "active",
        updated: record.updated_at || record.created_at || record.due_at || record.renews_at
      };
    });
    return banner + contractNote +
      '<div class="cr-kpis">' +
        kpi("Records", String(records.length), contract.singular + " objects") +
        kpi("Backend", result && result.ok ? "LIVE" : "PENDING", contract.endpoint) +
        kpi("Create", result && result.ok ? "READY" : "UI READY", "canonical mutation") +
        kpi("Inspect / edit", "READY", "same object surface") +
      '</div>' +
      renderTable([
        { label: contract.title.slice(0, -1), key: "name" },
        { label: "Related", key: "related" },
        { label: "State", key: "status" },
        { label: "Updated", html: function (r) { return r.updated ? esc(ago(r.updated)) : "—"; } }
      ], rows, "No " + contract.title.toLowerCase() + " yet");
  }

  function renderWorkView(view) {
    if (view === "outreach" || view === "operations") {
      return window.CR.workTools ? window.CR.workTools.render(view) : empty("Work tool unavailable", "The native Control module did not load.");
    }
    if (view === "inbox") return renderWorkInbox();
    if (view === "pipeline") return renderPipeline();
    if (view === "people") return renderPeople();
    if (view === "companies") return renderCompanies();
    if (view === "clients") return renderClients();
    if (view === "tasks") return renderTasks();
    if (FUTURE_WORK[view]) return renderFutureWork(view);
    return renderOrdersBookings(view);
  }
  function renderWork() {
    return renderHeader("Work", "One business graph from relationship through delivery and renewal. Views stay in Control even before every backing object is provisioned.", { values: WORK_VIEWS, selected: state.workView }) +
      '<div class="cr-workbar"><input class="cr-workbar__search" id="crWorkSearch" type="search" placeholder="Filter this view…" aria-label="Filter Work"><button class="cr-btn" data-action="filters">Filters</button><button class="cr-btn cr-btn--primary" data-action="new-work">+ New</button></div>' + (window.CR.work ? window.CR.work.renderForm() : "") + renderWorkView(state.workView);
  }

  function projectById(id) { return state.campaigns.find(function (c) { return String(c.id) === String(id); }); }
  function projectStats(id) {
    return {
      variants: state.variants.filter(function (x) { return String(x.campaign_id) === String(id); }).length,
      scheduled: state.publishJobs.filter(function (x) { return String(x.campaign_id) === String(id); }).length,
      posts: state.posts.filter(function (x) { return String(x.campaign_id) === String(id); }).length
    };
  }
  function renderProjectWorkspace(project) {
    var st = projectStats(project.id);
    var variants = state.variants.filter(function (x) { return String(x.campaign_id) === String(project.id); });
    var posts = state.posts.filter(function (x) { return String(x.campaign_id) === String(project.id); });
    return '<div class="cr-project-head"><button class="cr-btn cr-btn--ghost" data-action="close-project">← Projects</button><div><h2>' + esc(project.name || "Project") + '</h2><p>' + esc(project.objective || "Creative project") + '</p></div><span class="' + stateClass(project.status === "active" ? "ok" : "info") + '">' + esc(project.status || "draft") + '</span></div>' +
      '<div class="cr-kpis">' + kpi("Variants", String(st.variants), "generated") + kpi("Scheduled", String(st.scheduled), "distribution") + kpi("Published", String(st.posts), "live") + kpi("Source asset", project.source_asset_id ? "Linked" : "—", "context") + '</div>' +
      '<div class="cr-creative-canvas"><div class="cr-node cr-node--brief"><small>Brief</small><strong>' + esc(project.objective || project.name || "Project brief") + '</strong></div>' +
      '<div class="cr-node-link">→</div><div class="cr-node"><small>Variants</small><strong>' + st.variants + ' creative output' + (st.variants === 1 ? "" : "s") + '</strong></div>' +
      '<div class="cr-node-link">→</div><div class="cr-node"><small>Distribution</small><strong>' + (st.scheduled + st.posts) + ' post object' + ((st.scheduled + st.posts) === 1 ? "" : "s") + '</strong></div></div>' +
      '<div class="cr-grid">' + panel("Variants", variants.length + " total", '<div class="cr-list">' + (variants.slice(0, 8).map(function (v) {
        /* A publishable variant gets the real publish path; one without
           resolvable media does not, because the backend would refuse it. */
        return row(v.variant_key || "Variant", v.hook || v.hypothesis || "Generated creative",
          variantIsPublishable(v) ? "Publish" : (v.score == null ? titleCase(v.status || "") : "Score " + v.score),
          v.status === "ready" ? "ok" : "ai",
          variantIsPublishable(v) ? "open-publish" : "inspect-variant",
          { id: v.id, badge: v.status || "variant" });
      }).join("") || '<div class="cr-panel__body cr-muted">No variants yet.</div>') + '</div>', "cr-span-6") +
      panel("Published / queued", (st.scheduled + st.posts) + " items", '<div class="cr-list">' + (posts.slice(0, 8).map(function (p) { return row(p.caption || "Published post", p.publish_mode || "post", ago(p.published_at), "ok", "inspect-post", { id: p.id, badge: "Published" }); }).join("") || '<div class="cr-panel__body cr-muted">Nothing published yet.</div>') + '</div>', "cr-span-6") + '</div>';
  }

  /* Generation lives in js/control-room/media.js: catalog, explicit model
     selection, submission, and following each job to a terminal state. */
  function renderGenerator() { return window.CR.media.renderPanel(); }

  function renderProjects() {
    if (state.selectedProjectId) {
      var project = projectById(state.selectedProjectId);
      if (project) return renderProjectWorkspace(project);
      state.selectedProjectId = null;
    }
    var banner = sourceStates([["Projects", state.sources.campaigns], ["Variants", state.sources.variants]]);
    var generator = '<div class="cr-grid">' + renderGenerator() + '</div>';
    if (!state.campaigns.length) {
      return banner + generator + '<div class="cr-canvas">' + empty(
        state.sources.campaigns && state.sources.campaigns.ok ? "No creative projects yet" : "Projects not readable",
        state.sources.campaigns && state.sources.campaigns.ok
          ? "social_campaigns returned no rows. Generation above still runs against the canonical media backend."
          : "The project query did not succeed, so this is not a statement that no projects exist."
      ) + '</div>';
    }
    return banner + generator + '<div class="cr-project-grid">' + state.campaigns.map(function (c) {
      var st = projectStats(c.id);
      return '<button type="button" class="cr-project-card" data-action="open-project" data-id="' + esc(c.id) + '"><span class="' + stateClass(c.status === "active" ? "ok" : "info") + '">' + esc(c.status || "draft") + '</span><strong>' + esc(c.name || "Campaign") + '</strong><p>' + esc(c.objective || "Creative project") + '</p><footer><span>' + st.variants + ' variants</span><span>' + st.posts + ' published</span></footer></button>';
    }).join("") + '</div>';
  }

  function assetName(a) { return a.name || a.filename || a.file_name || a.kind || a.type || ("Asset " + String(a.id || "").slice(0, 8)); }
  function renderLibrary() {
    var banner = sourceStates([["Assets", state.sources.mediaAssets], ["Media jobs", state.sources.mediaJobs]]);
    if (!state.mediaAssets.length) {
      return banner + '<div class="cr-canvas">' + empty(
        state.sources.mediaAssets && state.sources.mediaAssets.ok ? "Library is empty" : "Library not readable",
        state.sources.mediaAssets && state.sources.mediaAssets.ok
          ? "media_assets returned no rows for this operator session."
          : "The asset query did not succeed, so this is not a statement that no assets exist.",
        "Open Asset Lab", "open-bridge:assetLab") + '</div>';
    }
    return banner + '<div class="cr-asset-grid">' + state.mediaAssets.slice(0, 120).map(function (a) {
      var url = a.url || a.public_url || a.storage_url || a.signed_url || "";
      var kind = a.media_type || a.type || a.kind || "asset";
      return '<button class="cr-asset-card" type="button" data-action="inspect-asset" data-id="' + esc(a.id) + '">' +
        (url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) ? '<img src="' + esc(url) + '" alt="">' : '<div class="cr-asset-card__placeholder">' + esc(titleCase(kind)) + '</div>') +
        '<strong>' + esc(assetName(a)) + '</strong><span>' + esc(titleCase(kind)) + '</span></button>';
    }).join("") + '</div>';
  }

  function renderSchedule() {
    var items = [];
    state.publishJobs.forEach(function (p) { items.push({ id: p.id, action: "inspect-publish", state: p.state || "queued", title: (p.payload && p.payload.caption) || "Scheduled post", when: p.scheduled_at, kind: p.state === "failed" ? "bad" : "info" }); });
    state.posts.forEach(function (p) { items.push({ id: p.id, action: "inspect-post", state: "published", title: p.caption || "Published post", when: p.published_at, kind: "ok" }); });
    items.sort(function (a, b) { return new Date(a.when || 0) - new Date(b.when || 0); });
    var banner = sourceStates([["Publish queue", state.sources.publishJobs], ["Published posts", state.sources.posts]]);
    var readable = state.sources.publishJobs && state.sources.publishJobs.ok && state.sources.posts && state.sources.posts.ok;
    if (!items.length) {
      return banner + '<div class="cr-canvas">' + empty(
        readable ? "Nothing scheduled" : "Schedule not readable",
        readable
          ? "social_publish_jobs and social_posts both returned no rows. There is nothing queued, scheduled, failed, or published."
          : "A publishing source did not respond, so this is not a statement that nothing is scheduled."
      ) + '</div>';
    }
    var counts = { queued: 0, scheduled: 0, failed: 0, published: 0 };
    items.forEach(function (it) { if (counts[it.state] === undefined) counts[it.state] = 0; counts[it.state] += 1; });
    var summary = '<div class="cr-filterchips">' + Object.keys(counts).map(function (k) {
      return '<span class="cr-chip is-static">' + esc(titleCase(k)) + ' <b>' + counts[k] + '</b></span>';
    }).join("") + '</div>';
    /* Distribution targets are real rows; a queue with no connected account
       cannot publish, and that is worth stating on this view. */
    var accounts = socialAccountRows();
    var accountNote = "";
    if (state.socialAccounts && state.socialAccounts.ok) {
      accountNote = accounts.length
        ? '<p class="cr-derived">Publishing to ' + accounts.length + ' connected account' + (accounts.length === 1 ? "" : "s") + ': ' +
            esc(accounts.map(function (a) { return (a.display_name || a.handle || a.external_account_id) + " (" + (a.platform || "?") + ")"; }).join(", ")) + '.</p>'
        : '<div class="cr-gap"><b>No connected social account.</b><span>social_accounts is empty for this organization, so nothing here can be published even where a variant is ready.</span></div>';
    } else if (state.socialAccounts && !state.socialAccounts.ok) {
      accountNote = sourceBanner(state.socialAccounts, "Social accounts");
    }
    return banner + accountNote + summary + '<div class="cr-schedule"><div class="cr-list">' + items.map(function (it) { return row(it.title, formatDate(it.when), titleCase(it.state), it.kind, it.action, { id: it.id, badge: it.state }); }).join("") + '</div></div>';
  }
  function renderCreate() {
    var body = state.createView === "projects" ? renderProjects()
      : state.createView === "library" ? renderLibrary()
      : state.createView === "channels" ? renderChannels()
      : state.createView === "instagram"
        ? (window.CR.instagram ? window.CR.instagram.render() : empty("Instagram unavailable", "The native Control module did not load."))
      : state.createView === "music"
        ? (window.CR.musicOps ? window.CR.musicOps.render() : empty("Music operations unavailable", "The native Control module did not load."))
      : state.createView === "action-network"
        ? (window.CR.actionNetwork ? window.CR.actionNetwork.render() : empty("Action Network unavailable", "The native Control module did not load."))
      : state.createView === "song-test"
        ? (window.CR.songTest ? window.CR.songTest.render() : empty("Song test unavailable", "The native Control module did not load."))
        : renderSchedule();
    return renderHeader("Create", "Projects, assets, publishing, channels, music operations and Action Network campaigns are views of one workspace.", { values: CREATE_VIEWS, selected: state.createView }) + body;
  }

  /* CHANNELS — where publishing actually points.

     Schedule could already queue a finished variant, and told anyone with
     no connected account to "connect an account before publishing" — with
     nothing anywhere in the console that could connect one. POST
     /v1/social/accounts and POST /v1/social/campaigns both existed and
     had never been called from anywhere. This is the room that calls them.

     CREDENTIALS ARE NOT COLLECTED HERE, and the form says so. The Worker
     refuses a client-supplied credential_ref outright and derives it from
     what is configured server-side, so an account registered here comes
     back 'disconnected' until that exists. Showing that plainly beats a
     form that looks like it connected something and did not. */
  function renderChannels() {
    var compose = window.CR.socialCompose ? '<div class="cro-grid cro-grid--2">' + window.CR.socialCompose.render() + '</div>' : "";
    var accounts = socialAccountRows();
    var banner = state.socialAccounts && !state.socialAccounts.ok
      ? sourceBanner(state.socialAccounts, "Social accounts") : "";
    var owner = state.workspace && state.workspace.role === "owner";

    var accountList = accounts.length
      ? '<div class="cr-list">' + accounts.map(function (a) {
          var connected = a.status === "connected";
          return row(
            a.display_name || a.handle || a.external_account_id,
            (a.platform || "unknown") + " · " + (a.handle || a.external_account_id),
            connected ? "Connected" : titleCase(a.status || "disconnected"),
            connected ? "ok" : "warn",
            "",
            { id: a.id, badge: connected ? "live" : "no creds" }
          );
        }).join("") + '</div>'
      : empty("No connected account",
          state.socialAccounts && state.socialAccounts.ok
            ? "social_accounts is empty for this workspace. Nothing can publish until one exists."
            : "The account list did not load, so this is not a statement that none exist.");

    var campaigns = state.campaigns || [];
    var campaignList = campaigns.length
      ? '<div class="cr-list">' + campaigns.slice(0, 25).map(function (c) {
          return row(c.name || "Untitled campaign",
            (c.objective || "growth") + (c.starts_at ? " · from " + formatDate(c.starts_at) : ""),
            titleCase(c.status || "draft"),
            c.status === "active" ? "ok" : "info",
            "", { id: c.id });
        }).join("") + '</div>'
      : empty("No campaigns", "social_campaigns has no rows for this workspace yet.");

    if (!owner) {
      return compose + banner +
        '<div class="cr-grid">' +
          panel("Accounts", accounts.length + " registered", '<div class="cr-panel__body">' + accountList + '</div>', "cr-span-6") +
          panel("Campaigns", campaigns.length + " total", '<div class="cr-panel__body">' + campaignList + '</div>', "cr-span-6") +
        '</div>' +
        '<div class="cr-gap"><b>Read only.</b><span>Registering an account or opening a campaign is owner work, and this session holds ' +
          esc(state.workspace ? state.workspace.role : "no role") + ' in this workspace.</span></div>';
    }

    var accountForm =
      '<div class="cr-panel__body"><div class="cr-gen">' +
        '<select class="cr-select" id="crAccPlatform" aria-label="Platform">' +
          viewOptions(["instagram", "tiktok", "youtube", "linkedin", "facebook"], "instagram") + '</select>' +
        '<input class="cr-input" id="crAccExternal" type="text" aria-label="Account id on that platform" placeholder="Account id on that platform">' +
        '<input class="cr-input" id="crAccHandle" type="text" aria-label="Handle" placeholder="Handle (optional)">' +
        '<input class="cr-input" id="crAccName" type="text" aria-label="Display name" placeholder="Display name (optional)">' +
        '<button class="cr-btn cr-btn--primary" type="button" data-action="connect-account"' +
          (state.pending.account ? " disabled" : "") + '>' + (state.pending.account ? "Registering…" : "Register account") + '</button>' +
      '</div>' + pendingNote("account") +
      '<p class="cr-derived">Credentials are never entered here. The Worker derives them from what is configured on the server and refuses a client-supplied one, so a new account stays <b>disconnected</b> until that exists.</p></div>';

    var campaignForm = accounts.length
      ? '<div class="cr-panel__body"><div class="cr-gen">' +
          '<select class="cr-select" id="crCmpAccount" aria-label="Account">' + accounts.map(function (a) {
            return '<option value="' + esc(a.id) + '">' + esc(a.display_name || a.handle || a.external_account_id) + ' · ' + esc(a.platform || "") + '</option>';
          }).join("") + '</select>' +
          '<input class="cr-input" id="crCmpName" type="text" aria-label="Campaign name" placeholder="Campaign name">' +
          '<select class="cr-select" id="crCmpObjective" aria-label="Objective">' +
            viewOptions(["growth", "conversion", "retention", "awareness"], "growth") + '</select>' +
          '<input class="cr-input" id="crCmpStarts" type="datetime-local" aria-label="Starts at (optional)">' +
          '<input class="cr-input" id="crCmpEnds" type="datetime-local" aria-label="Ends at (optional)">' +
          '<button class="cr-btn cr-btn--primary" type="button" data-action="create-campaign"' +
            (state.pending.campaign ? " disabled" : "") + '>' + (state.pending.campaign ? "Opening…" : "Open campaign") + '</button>' +
        '</div>' + pendingNote("campaign") + '</div>'
      : '<div class="cr-panel__body">' + empty("Register an account first", "A campaign belongs to an account, so there is nothing to attach one to yet.") + '</div>';

    return compose + banner +
      '<div class="cr-grid">' +
        panel("Accounts", accounts.length + " registered", '<div class="cr-panel__body">' + accountList + '</div>', "cr-span-6") +
        panel("Register an account", "social_accounts", accountForm, "cr-span-6") +
        panel("Campaigns", campaigns.length + " total", '<div class="cr-panel__body">' + campaignList + '</div>', "cr-span-6") +
        panel("Open a campaign", "social_campaigns", campaignForm, "cr-span-6") +
      '</div>';
  }

  /* One result line per form: busy, what failed, or what was created. */
  function pendingNote(key) {
    var failure = state.pending[key + "Error"];
    var done = state.pending[key + "Ok"];
    if (failure) {
      return '<p class="cr-derived"><span class="' + stateClass("bad") + '">Failed</span> ' +
        esc(failure.message || "That did not save.") + (failure.status ? " · HTTP " + failure.status : "") + '</p>';
    }
    if (done) return '<p class="cr-derived"><span class="' + stateClass("ok") + '">Created</span> ' + esc(done) + '</p>';
    return "";
  }

  function serviceRows() {
    var s = state.status || {};
    return [
      {
        key: "workspace",
        title: "Workspace",
        sub: state.workspace ? state.workspace.name + " · " + state.workspace.slug
          : state.sources.workspace && state.sources.workspace.ok ? "No workspace on this account"
          : "Workspace not resolved",
        value: state.workspace ? titleCase(state.workspace.role)
          : state.sources.workspace && state.sources.workspace.ok ? "None" : "Check",
        kind: state.workspace ? "ok" : (state.sources.workspace && state.sources.workspace.ok ? "warn" : "bad")
      },
      { key: "api", title: "Cloudflare / API", sub: "api.mccluster.org", value: state.health && state.health.ok ? "Healthy" : "Check", kind: state.health && state.health.ok ? "ok" : "bad" },
      { key: "db", title: "Supabase", sub: "Canonical data plane", value: s.database && s.database.reachable ? "Healthy" : "Check", kind: s.database && s.database.reachable ? "ok" : "warn" },
      {
        key: "core",
        title: "Core / AI",
        sub: state.coreBridge && state.coreBridge.signed_dispatch ? "Signed Cloudflare → Core MCP" : "Control bridge not verified",
        value: state.coreBridge && state.coreBridge.ok ? state.coreTools.length + " tools" : "Inspect",
        kind: state.coreBridge && state.coreBridge.ok ? "ai" : "warn"
      },
      { key: "host", title: "OVH host", sub: state.aiHealth && state.aiHealth.checked_at ? "Checked " + ago(state.aiHealth.checked_at) + " ago" : "No fresh host health", value: state.aiHealth && !state.aiHealth.stale ? titleCase(state.aiHealth.overall || "Healthy") : "Refresh", kind: state.aiHealth && !state.aiHealth.stale ? "ok" : "warn" },
      { key: "comms", title: "Communications", sub: state.threads.length + " thread" + (state.threads.length === 1 ? "" : "s"), value: "Live", kind: "info" },
      { key: "creative", title: "Creative", sub: state.mediaJobs.length + " media job" + (state.mediaJobs.length === 1 ? "" : "s"), value: state.mediaJobs.some(function (x) { return x.status === "failed"; }) ? "Check" : "Ready", kind: state.mediaJobs.some(function (x) { return x.status === "failed"; }) ? "warn" : "ok" }
    ];
  }
  function renderTopology() {
    return '<div class="cr-topology"><button class="cr-topology__node root" data-action="inspect-service" data-key="api"><b>Cloudflare</b><span>edge + worker</span></button>' +
      '<span class="cr-topology__edge e1"></span><button class="cr-topology__node db" data-action="inspect-service" data-key="db"><b>Supabase</b><span>data + auth</span></button>' +
      '<span class="cr-topology__edge e2"></span><button class="cr-topology__node core" data-action="inspect-service" data-key="core"><b>Core</b><span>objectives + jobs</span></button>' +
      '<span class="cr-topology__edge e3"></span><button class="cr-topology__node host" data-action="inspect-service" data-key="host"><b>OVH</b><span>runtime</span></button>' +
      '<span class="cr-topology__edge e4"></span><button class="cr-topology__node creative" data-action="inspect-service" data-key="creative"><b>Media / GPU</b><span>creative compute</span></button></div>';
  }
  function renderSystemOverview() {
    var services = serviceRows();
    return sourceStates([["Workspace", state.sources.workspace], ["Edge health", state.sources.health], ["Core bridge", state.sources.coreBridge], ["Durable resume", state.sources.coreResume], ["Operator status", state.sources.status], ["Core", state.sources.ai], ["Host health", state.sources.aiHealth], ["Audit ledger", state.sources.audit]]) +
      '<div class="cr-kpis">' + kpi("API", state.health && state.health.ok ? "UP" : "—", "edge") + kpi("Database", state.status && state.status.database && state.status.database.reachable ? "UP" : "—", "truth") + kpi("Jobs", String(state.jobs.filter(function (x) { return ["queued", "running"].indexOf(x.status) >= 0; }).length), "active") + kpi("Failures", String(state.jobs.filter(function (x) { return x.status === "failed"; }).length), "workload") + '</div>' +
      '<div class="cr-grid">' + panel("Live topology", "click a resource", '<div class="cr-panel__body">' + renderTopology() + '</div>', "cr-span-7") +
      panel("Services", "canonical status", '<div class="cr-list">' + services.map(function (s) { return row(s.title, s.sub, s.value, s.kind, "inspect-service", { key: s.key, badge: s.kind === "ai" ? "AI" : s.kind }); }).join("") + '</div>', "cr-span-5") + '</div>';
  }
  var JOB_FILTERS = ["all", "running", "queued", "failed", "done"];
  function renderWorkload() {
    var banner = sourceBanner(state.sources.jobs, "Workload (ops_agent_jobs)");
    var chips = '<div class="cr-workbar cr-workbar--system"><div class="cr-filterchips">' +
      JOB_FILTERS.map(function (f) {
        var n = f === "all" ? state.jobs.length : state.jobs.filter(function (j) { return j.status === f; }).length;
        return '<button class="cr-chip' + (state.jobFilter === f ? " is-on" : "") + '" type="button" data-job-filter="' + f + '">' + esc(titleCase(f)) + ' <b>' + n + '</b></button>';
      }).join("") + '</div>' +
      '<button class="cr-btn" type="button" data-action="refresh-health">Run system health</button></div>';

    if (!state.jobs.length) {
      return banner + chips + '<div class="cr-canvas">' + empty(
        state.sources.jobs && state.sources.jobs.ok ? "No workload records" : "Workload not readable",
        state.sources.jobs && state.sources.jobs.ok
          ? "ops_agent_jobs returned zero rows for this operator session."
          : "The workload query did not succeed, so this is not a statement that no work exists."
      ) + '</div>';
    }
    var filtered = state.jobFilter === "all" ? state.jobs : state.jobs.filter(function (j) { return j.status === state.jobFilter; });
    var rows = filtered.slice(0, 150).map(function (j) {
      return { id: j.id, action: "inspect-job", state: j.status, work: titleCase(j.job_type), target: text(j.target_id, j.target_type), age: ago(j.created_at), attempts: String(count(j.attempts)) + "/" + String(count(j.max_attempts) || 1) };
    });
    return banner + chips +
      renderTable([{ label: "State", html: function (r) { var k = r.state === "failed" ? "bad" : (r.state === "running" ? "ai" : (r.state === "done" ? "ok" : "info")); return '<span class="' + stateClass(k) + '">' + esc(r.state) + '</span>'; } }, { label: "Work", key: "work" }, { label: "Target", key: "target" }, { label: "Started", key: "age" }, { label: "Attempts", key: "attempts" }], rows, "No jobs in this filter");
  }
  /* Observability shows only what the backend actually recorded. There is no
     log pipeline to read, so this is the failure ledger the canonical tables
     already carry — never synthesized log lines. */
  function observedEvents() {
    var events = [];
    state.jobs.filter(function (j) { return j.status === "failed"; }).forEach(function (j) {
      events.push({ id: j.id, action: "inspect-job", severity: "ERROR", source: "Core", message: titleCase(j.job_type) + ": " + text(j.last_error, "job failed"), time: j.updated_at || j.created_at, kind: "bad" });
    });
    /* media_jobs.error is jsonb defaulting to '{}', which is truthy even when
       empty — reading it as a plain value puts "[object Object]" in front of
       an operator. jsonText resolves it to real text or nothing. */
    state.mediaJobs.filter(function (j) { return j.status === "failed"; }).forEach(function (j) {
      events.push({ id: j.id, action: "inspect-media-job", severity: "ERROR", source: "Media", message: jsonText(j.error) || jsonText(j.result && j.result.error) || "Media job failed", time: j.updated_at || j.created_at, kind: "bad" });
    });
    state.publishJobs.filter(function (p) { return p.state === "failed"; }).forEach(function (p) {
      events.push({ id: p.id, action: "inspect-publish", severity: "ERROR", source: "Social", message: text(p.last_error, "Publish job failed"), time: p.updated_at || p.scheduled_at, kind: "bad" });
    });
    if (state.aiHealth && state.aiHealth.stale) events.push({ id: "host", action: "inspect-service", severity: "WARN", source: "OVH", message: "Host health result is stale", time: state.aiHealth.checked_at, kind: "warn" });
    /* The ledger. Observability had only ever shown things that BROKE, so a
       privileged change that worked — somebody moving a lead, spending on
       media — left no trace on this screen at all. control_audit is the
       record of what was deliberately done, and it belongs next to the
       record of what failed. */
    state.audit.forEach(function (a) {
      var who = a.actor_kind === "user" ? "operator" : (a.actor_kind || "system");
      var what = a.resource_type ? a.resource_type + " " + text(a.resource_id, "") : "";
      var from = a.detail && a.detail.from, to = a.detail && a.detail.to;
      events.push({
        id: String(a.id), action: "inspect-audit", severity: "INFO", source: "Ledger",
        message: a.event + (what ? " · " + what : "") +
          (from && to ? " (" + from + " → " + to + ")" : "") + " · by " + who,
        time: a.at, kind: "info"
      });
    });
    Object.keys(state.sources).forEach(function (key) {
      var s = state.sources[key];
      /* A source the console could not read is itself an observable event —
         otherwise a broken read looks like a quiet system. */
      if (s && !s.ok) events.push({ id: key, action: "refresh", severity: s.state === "unsupported" ? "INFO" : "WARN", source: "Console", message: titleCase(key) + " source " + s.state + (s.message ? ": " + s.message : ""), time: state.refreshedAt, kind: s.state === "unsupported" ? "info" : "warn" });
    });
    return events.sort(function (a, b) { return new Date(b.time || 0) - new Date(a.time || 0); });
  }
  function loadObservability(force) {
    if (state.observability && !force) return Promise.resolve();
    state.observability = { loading: true, result: null };
    return src(request("/v1/observability/events?limit=150")).then(function (result) {
      state.observability = { loading: false, result: result };
      render();
    });
  }
  function observabilityRows() {
    var result = state.observability && state.observability.result;
    if (!result || !result.ok) return observedEvents();
    var data = result.data || {};
    var records = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
    return records.map(function (e, i) {
      var severity = String(e.severity || e.level || "INFO").toUpperCase();
      return {
        id: e.id || e.event_id || ("event-" + i),
        severity: severity,
        source: e.source || e.service || e.component || "System",
        message: e.message || e.event || e.name || "Recorded event",
        time: e.at || e.time || e.created_at || e.timestamp,
        trace_id: e.trace_id || e.correlation_id || e.request_id || "",
        request_id: e.request_id || "",
        span_id: e.span_id || "",
        kind: severity === "ERROR" || severity === "FATAL" ? "bad" : (severity === "WARN" || severity === "WARNING" ? "warn" : "info"),
        raw: e
      };
    });
  }
  function renderObservability() {
    var canonical = state.observability && state.observability.result;
    var events = observabilityRows();
    var sources = ["all"].concat(Array.from(new Set(events.map(function (e) { return e.source; }).filter(Boolean))).sort());
    var severity = state.observabilitySeverity;
    var source = state.observabilitySource;
    var q = state.observabilitySearch.trim().toLowerCase();
    events = events.filter(function (e) {
      if (severity !== "all" && String(e.severity).toUpperCase() !== severity.toUpperCase()) return false;
      if (source !== "all" && e.source !== source) return false;
      if (q && [e.source, e.message, e.trace_id, e.request_id, e.span_id].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var contractState = canonical && canonical.ok ? "Canonical event stream" : "Fallback ledger";
    var head = '<div class="cr-observe-head"><div><strong>Events</strong><span class="cr-live-dot">' + esc(contractState) + ' · snapshot ' + esc(ago(state.refreshedAt)) + ' old</span></div>' +
      '<button class="cr-btn cr-btn--ghost" type="button" data-action="reload-observability">Re-read</button></div>';
    var controls = '<div class="cr-gen">' +
      '<select class="cr-select" id="crObsSeverity" aria-label="Severity"><option value="all">All severities</option><option value="INFO">Info</option><option value="WARN">Warn</option><option value="ERROR">Error</option></select>' +
      '<select class="cr-select" id="crObsSource" aria-label="Source">' + sources.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v === "all" ? "All sources" : v) + '</option>'; }).join("") + '</select>' +
      '<input class="cr-input" id="crObsSearch" type="search" placeholder="Trace, request, source or message" value="' + esc(state.observabilitySearch) + '">' +
      '</div>';
    var sourceState = "";
    if (!state.observability || state.observability.loading) {
      sourceState = '<div class="cr-gap"><b>Reading canonical event contract</b><span>GET /v1/observability/events?limit=150</span></div>';
    } else if (canonical && !canonical.ok) {
      sourceState = sourceBanner(canonical, "Observability events") +
        '<div class="cr-gap"><b>UI contract is ready.</b><span>Until the retained event/trace pipeline exists, this view falls back to job failures, social/media failures, health state and control_audit. The eventual event contract already has UI space for trace_id, request_id and span_id.</span></div>';
    }
    if (!events.length) {
      return head + controls + sourceState + '<div class="cr-canvas">' + empty("No events in this filter", canonical && canonical.ok ? "The canonical event stream returned no matching records." : "No fallback ledger records match the current filter.") + '</div>';
    }
    return head + controls + sourceState +
      renderTable([{ label: "Time", html: function (r) { return esc(ago(r.time)); } },
        { label: "Severity", html: function (r) { return '<span class="' + stateClass(r.kind) + '">' + esc(r.severity) + '</span>'; } },
        { label: "Source", key: "source" },
        { label: "Trace", html: function (r) { return r.trace_id ? '<span class="cr-mono">' + esc(String(r.trace_id).slice(0, 18)) + '</span>' : "—"; } },
        { label: "Message", key: "message" }], events, "No events");
  }
  /* SOCIAL ACCOUNTS + PUBLISHING.

     POST /v1/social/publish exists and was never wired, so a finished variant
     could be looked at but not sent anywhere. Publishing needs a real target
     account, so the account list is read on demand when Create is opened. */
  function loadSocialAccounts(force) {
    if (state.socialAccounts && !force) return Promise.resolve();
    state.socialAccounts = null;
    return src(request("/v1/social/accounts")).then(function (result) {
      state.socialAccounts = result;
      render();
    });
  }
  function socialAccountRows() { return pickRows(state.socialAccounts, "accounts"); }

  function variantIsPublishable(v) {
    /* The backend accepts a variant only when it can resolve media from it. */
    return Boolean(v && (v.output_asset_id || v.video_asset_id));
  }

  function openPublish(variantId) {
    var v = findById(state.variants, variantId);
    if (!v) return;
    var accounts = socialAccountRows();
    var busy = state.pending["publish:" + variantId];
    var failure = state.pending["publishError:" + variantId];
    var done = state.pending["publishOk:" + variantId];

    var body;
    if (!state.socialAccounts) {
      body = inspectorSection("Target", '<p class="cr-muted">Reading connected social accounts…</p>');
      loadSocialAccounts();
    } else if (!state.socialAccounts.ok) {
      body = inspectorSection("Target", sourceBanner(state.socialAccounts, "Social accounts"));
    } else if (!accounts.length) {
      body = inspectorSection("Target", '<div class="cr-gap"><b>No social account is connected.</b>' +
        '<span>POST /v1/social/publish requires an account_id, and this workspace has no rows in social_accounts.</span>' +
        '<button class="cr-btn cr-btn--primary" type="button" data-action="create-channels" style="margin-top:12px">Register one in Channels</button></div>');
    } else {
      body = inspectorSection("Target", '<div class="cr-gen">' +
        '<select class="cr-select" id="crPubAccount" aria-label="Account">' + accounts.map(function (a) {
          return '<option value="' + esc(a.id) + '">' + esc(a.display_name || a.handle || a.external_account_id) + ' · ' + esc(a.platform || "") + '</option>';
        }).join("") + '</select>' +
        '<select class="cr-select" id="crPubMode" aria-label="Publish mode">' +
          '<option value="trial">trial</option><option value="reel">reel</option></select>' +
        '<textarea class="cr-textarea" id="crPubCaption" rows="2" placeholder="Caption (defaults to the variant caption)">' + esc(v.caption || "") + '</textarea>' +
        '<input class="cr-input" id="crPubWhen" type="datetime-local" aria-label="Schedule for (optional)">' +
        '</div>');
    }

    openInspector({
      title: "Publish " + (v.variant_key || "variant"),
      subtitle: "Create · Schedule",
      description: "Queues a real publish job through the canonical social backend.",
      props: [["Variant", v.variant_key], ["Status", v.status], ["Asset", v.output_asset_id || v.video_asset_id || "—"]],
      custom: body +
        (failure ? inspectorSection("Not queued", sourceBanner(failure, "Publish")) : "") +
        (done ? inspectorSection("Queued", '<p class="cr-muted">Publish job ' + esc(done) + ' created.</p>') : ""),
      actions: accounts.length && state.socialAccounts && state.socialAccounts.ok
        ? '<button class="cr-btn cr-btn--primary" type="button" data-action="publish-variant" data-id="' + esc(variantId) + '"' + (busy ? " disabled" : "") + '>' + (busy ? "Queueing…" : "Queue publish") + '</button>'
        : "",
      tabs: ["overview", "raw", "ai"], raw: v
    });
  }

  /* Resources reads the platform surfaces on demand rather than on every
     Control Room boot — they are only meaningful on this view. */
  function loadResources(force) {
    if (state.resources && !force) return Promise.resolve();
    state.resources = { loading: true };
    render();
    var orgQuery = state.org && state.org.id ? "&org_id=" + encodeURIComponent(state.org.id) : "";
    var budgetQuery = state.org && state.org.id ? "?org_id=" + encodeURIComponent(state.org.id) : "";
    return Promise.all([
      src(request("/v1/compute/balance")),
      src(request("/v1/platform/catalog")),
      src(request("/v1/developer/consumers")),
      src(request("/v1/media/usage?group_by=capability" + orgQuery)),
      src(request("/v1/media/budget" + budgetQuery))
    ]).then(function (r) {
      state.resources = { loading: false, balance: r[0], catalog: r[1], consumers: r[2], usage: r[3], budget: r[4] };
      render();
    });
  }
  function renderResources() {
    var providers = [
      { name: "Core / model routing", state: state.ai && state.ai.ok ? "Available through Core" : "Inspect Core", kind: state.ai && state.ai.ok ? "ai" : "warn" },
      { name: "Supabase", state: state.status && state.status.database && state.status.database.reachable ? "Connected" : "Check", kind: state.status && state.status.database && state.status.database.reachable ? "ok" : "warn" },
      { name: "Cloudflare", state: state.health && state.health.ok ? "Connected" : "Check", kind: state.health && state.health.ok ? "ok" : "warn" },
      { name: "Social channels", state: state.status && Array.isArray(state.status.channels) ? state.status.channels.filter(function (x) { return x.enabled; }).length + " enabled" : "Not reported", kind: "info" }
    ];

    var res = state.resources;
    var usage;
    if (!res) {
      usage = '<div class="cr-panel__body"><p class="cr-muted">Compute balance, platform catalog, and API consumers have not been read yet.</p>' +
        '<button class="cr-btn cr-btn--primary" type="button" data-action="load-resources">Read platform state</button></div>';
    } else if (res.loading) {
      usage = '<div class="cr-panel__body"><p class="cr-muted">Reading canonical platform state…</p></div>';
    } else {
      var balance = res.balance;
      var balanceBody;
      if (!balance.ok) balanceBody = sourceBanner(balance, "Compute balance");
      else {
        var b = balance.data || {};
        /* Only rendered because the backend returned these figures. Nothing
           here is derived, projected, or filled in when a field is absent. */
        var money = [];
        if (b.balance_cents !== undefined) money.push(["Balance", moneyCents(b.balance_cents)]);
        if (b.reserved_cents !== undefined) money.push(["Reserved", moneyCents(b.reserved_cents)]);
        if (b.spent_cents !== undefined) money.push(["Spent", moneyCents(b.spent_cents)]);
        if (b.currency) money.push(["Currency", b.currency]);
        balanceBody = money.length
          ? props(money)
          : '<p class="cr-muted">The balance endpoint responded but reported no monetary fields. No spend figure is shown because none was returned.</p>';
      }
      var consumerRows = pickRows(res.consumers, "consumers");
      /* Media spend, from the ledger. Shown because the backend settles these
         amounts — nothing here is computed by the browser. */
      var spendBody = "";
      var usageResult = res.usage;
      if (!usageResult) spendBody = "";
      else if (!usageResult.ok) spendBody = sourceBanner(usageResult, "Media spend");
      else {
        var t = (usageResult.data && usageResult.data.totals) || {};
        var spendRows = [["Settled", moneyCents(t.actual_cents)], ["Committed", moneyCents(t.committed_cents)]];
        if (t.unsettled_cents) spendRows.push(["Still in flight", moneyCents(t.unsettled_cents) + " (" + count(t.in_flight_jobs) + " job" + (count(t.in_flight_jobs) === 1 ? "" : "s") + ")"]);
        spendRows.push(["Jobs", String(count(t.jobs))]);
        spendBody = '<h3 class="cr-subhead">Media spend · last 30 days</h3>' + props(spendRows) +
          ((usageResult.data && usageResult.data.rows || []).length
            ? '<div class="cr-list">' + usageResult.data.rows.slice(0, 8).map(function (row2) {
                return row(titleCase(row2.key), count(row2.jobs) + " job" + (count(row2.jobs) === 1 ? "" : "s"), moneyCents(row2.committed_cents), "info", "system-resources");
              }).join("") + '</div>'
            : '<p class="cr-muted">No media jobs in this window.</p>');
      }

      var budgetBody = "";
      var budgetResult = res.budget;
      if (!budgetResult) {
        budgetBody = "";
      } else if (!budgetResult.ok) {
        budgetBody = '<h3 class="cr-subhead">Monthly media allowance</h3>' + sourceBanner(budgetResult, "Media allowance");
      } else {
        var budgetData = budgetResult.data || {};
        var mediaBudget = budgetData.budget || {};
        var monthly = budgetData.usage || {};
        var limit = mediaBudget.monthly_limit_cents;
        var committed = count(monthly.committed_cents);
        var percent = limit === null || limit === undefined || Number(limit) <= 0
          ? null : Math.round((committed / Number(limit)) * 100);
        var budgetState = mediaBudget.enabled
          ? moneyCents(limit) + " / month"
          : "Off";
        budgetBody = '<h3 class="cr-subhead">Monthly media allowance</h3>' +
          props([
            ["Enforcement", mediaBudget.enabled ? "On" : "Off"],
            ["Current month committed", moneyCents(committed)],
            ["Allowance", budgetState],
            ["Warn at", String(count(mediaBudget.warn_at_percent) || 80) + "%"],
            ["Used", percent === null ? "—" : String(percent) + "%"]
          ]) +
          '<div class="cr-gen">' +
            '<label class="cr-muted"><input id="crMediaBudgetEnabled" type="checkbox"' + (mediaBudget.enabled ? " checked" : "") + '> Enforce monthly cap</label>' +
            '<input class="cr-input" id="crMediaMonthlyCap" inputmode="decimal" type="number" min="0" step="0.01" placeholder="Monthly USD cap" value="' +
              (limit === null || limit === undefined ? "" : esc((Number(limit) / 100).toFixed(2))) + '">' +
            '<input class="cr-input" id="crMediaWarnAt" type="number" min="1" max="100" step="1" aria-label="Warn at percent" value="' + esc(String(count(mediaBudget.warn_at_percent) || 80)) + '">' +
            '<button class="cr-btn cr-btn--primary" type="button" data-action="save-media-budget"' + (state.pending.mediaBudget ? " disabled" : "") + '>' +
              (state.pending.mediaBudget ? "Saving…" : "Save allowance") + '</button>' +
          '</div>' +
          (state.pending.mediaBudgetError ? sourceBanner(state.pending.mediaBudgetError, "Media allowance") : "") +
          (state.pending.mediaBudgetOk ? '<p class="cr-muted">Monthly media allowance saved and enforced at the database boundary.</p>' : "");
      }

      usage = '<div class="cr-panel__body">' + balanceBody + spendBody + budgetBody +
        '<h3 class="cr-subhead">API consumers</h3>' +
        (!res.consumers.ok ? sourceBanner(res.consumers, "Developer consumers")
          : (consumerRows.length
            ? '<div class="cr-list">' + consumerRows.slice(0, 20).map(function (c) {
                /* Key material is never rendered; identity and state only. */
                return row(c.name || c.label || c.id, text(c.scope || c.plan, "consumer"), titleCase(c.status || "active"), c.status === "revoked" ? "bad" : "ok", "inspect-consumer", { id: c.id, badge: "API" });
              }).join("") + '</div>'
            : '<p class="cr-muted">No API consumers are registered.</p>')) + '</div>';
    }

    var catalogBody = !res || res.loading ? '<p class="cr-muted">Not read yet.</p>'
      : (!res.catalog.ok ? sourceBanner(res.catalog, "Platform catalog")
        : '<div class="cr-list">' + (pickRows(res.catalog, "products").length
          ? pickRows(res.catalog, "products").slice(0, 20).map(function (p) { return row(p.name || p.id, text(p.description, "Platform product"), text(p.status, "listed"), "info", "inspect-resource", { key: p.id || p.name }); }).join("")
          : '<p class="cr-muted">The catalog returned no products.</p>') + '</div>');

    return '<div class="cr-grid">' +
      panel("Connections", "provider state", '<div class="cr-list">' + providers.map(function (p) { return row(p.name, "Canonical connection", p.state, p.kind, "inspect-resource", { key: p.name, badge: p.kind }); }).join("") + '</div>', "cr-span-6") +
      panel("Usage & access", "only what the backend reports", usage, "cr-span-6") +
      panel("Platform catalog", "registered products", '<div class="cr-panel__body">' + catalogBody + '</div>', "cr-span-6") +
      panel("Applications", state.apps.length + " registered", sourceBanner(state.sources.apps, "Apps") + '<div class="cr-list">' +
        (state.apps.length ? state.apps.slice(0, 20).map(function (a) { return row(a.name || a.app_key, text(a.product_family, "registered application"), text(a.kind, "app"), "info", "apps"); }).join("")
          : '<p class="cr-panel__body cr-muted">No registered applications were returned.</p>') + '</div>', "cr-span-6") + '</div>';
  }
  function commandResultHtml() {
    var result = state.commandResult;
    if (!result) return '<p class="cr-muted">No command has run in this session.</p>';
    if (result.error) return '<div class="cr-gap"><b>Command failed</b><span>' + esc(result.error) + '</span></div>';
    if (result.kind === "ai" && result.task) {
      var task = result.task;
      var answer = task.output && (task.output.content || task.output.text || task.output.answer);
      return props([["Task", task.id], ["Status", task.status], ["Implementation", task.implementation || "automatic"], ["Updated", formatDate(task.updated_at)]]) +
        (answer ? inspectorSection("Home-base AI", '<p class="cr-muted">' + esc(answer) + '</p>') :
          '<p class="cr-muted">The durable compute task is ' + esc(task.status || "unknown") + '. This view polls the canonical task record; it does not invent a result.</p>');
    }
    return '<pre class="cr-code">' + esc(JSON.stringify(result.data || result, null, 2)) + '</pre>';
  }

  function pendingApprovalRows() {
    return state.coreResume && Array.isArray(state.coreResume.pending_approvals)
      ? state.coreResume.pending_approvals
      : [];
  }

  function renderPendingApprovals() {
    var approvals = pendingApprovalRows();
    if (!approvals.length) return '<p class="cr-muted">No control-plane approvals are waiting on you.</p>';
    return '<div class="cr-list">' + approvals.map(function (approval) {
      return '<div class="cr-row"><div class="cr-row__main"><b>' + esc(approval.capability || "Approval") + '</b>' +
        '<small>' + esc(approval.resource || "") + (approval.reason ? " · " + esc(approval.reason) : "") + '</small></div>' +
        '<div class="cr-row__end"><button class="cr-btn cr-btn--primary" type="button" data-action="approval-decide" data-id="' + esc(approval.id) + '" data-decision="approve">Approve</button>' +
        '<button class="cr-btn" type="button" data-action="approval-decide" data-id="' + esc(approval.id) + '" data-decision="deny">Deny</button></div></div>';
    }).join("") + '</div>';
  }

  function renderCommandCenter() {
    var tools = state.coreTools.map(function (tool) { return tool.name; });
    var bridgeOk = Boolean(state.coreBridge && state.coreBridge.ok && state.coreBridge.signed_dispatch);
    return sourceStates([["Core bridge", state.sources.coreBridge], ["Capabilities", state.sources.coreTools], ["Durable state", state.sources.coreResume]]) +
      '<div class="cr-kpis">' +
        kpi("Bridge", bridgeOk ? "SIGNED" : "CHECK", "Cloudflare → Core") +
        kpi("Capabilities", String(tools.length), "owner surface") +
        kpi("Home AI", coreToolAvailable("ai.chat") ? "READY" : "OFFLINE", "self-hosted compute") +
        kpi("Planner", coreToolAvailable("objective.plan") ? "READY" : "OFFLINE", "durable objectives") +
        kpi("Approvals", String(pendingApprovalRows().length), "owner decisions") +
      '</div>' +
      '<div class="cr-grid">' +
        panel("Command center", "same capability bus used by agents", '<div class="cr-panel__body">' +
          '<textarea id="crSystemCommand" class="cr-textarea" rows="5" placeholder="Tell the McCluster control plane what you want done…"></textarea>' +
          '<div class="cr-inspector__actions">' +
            '<button class="cr-btn cr-btn--primary" type="button" data-action="command-plan"' + (coreToolAvailable("objective.plan") ? "" : " disabled") + '>Plan objective</button>' +
            '<button class="cr-btn" type="button" data-action="command-ai"' + (coreToolAvailable("ai.chat") ? "" : " disabled") + '>Ask home AI</button>' +
            '<button class="cr-btn" type="button" data-action="command-research"' + (coreToolAvailable("research.web") ? "" : " disabled") + '>Research web</button>' +
            '<button class="cr-btn cr-btn--ghost" type="button" data-action="command-resume"' + (coreToolAvailable("core.resume") ? "" : " disabled") + '>Resume durable state</button>' +
          '</div></div>', "cr-span-7") +
        panel("Last command", "canonical result", '<div class="cr-panel__body">' + commandResultHtml() + '</div>', "cr-span-5") +
        panel("Owner approvals", pendingApprovalRows().length + " pending", '<div class="cr-panel__body">' + renderPendingApprovals() + '</div>', "cr-span-12") +
        panel("Control spine", "no assistant in the middle", '<div class="cr-panel__body">' +
          '<p class="cr-muted">Operator OS authenticates at Cloudflare, dispatches through the signed MCP bridge, Core resolves a stable capability, Supabase records durable work, and compute nodes execute it. Results return through the same path.</p>' +
          '<div class="cr-list">' +
            row("Cloudflare edge", "owner auth + signed dispatch", bridgeOk ? "Ready" : "Check", bridgeOk ? "ok" : "warn", "inspect-service", { key: "api", badge: "Edge" }) +
            row("Core broker", "capability routing + policy", state.coreBridge && state.coreBridge.ok ? "Ready" : "Check", state.coreBridge && state.coreBridge.ok ? "ai" : "warn", "inspect-service", { key: "core", badge: "Core" }) +
            row("Durable state", "Supabase objectives, jobs, approvals", state.coreResume ? "Ready" : "Check", state.coreResume ? "ok" : "warn", "inspect-service", { key: "db", badge: "State" }) +
            row("Self-hosted AI", "ai.chat via compute fabric", coreToolAvailable("ai.chat") ? "Ready" : "Check", coreToolAvailable("ai.chat") ? "ai" : "warn", "inspect-service", { key: "host", badge: "Compute" }) +
          '</div></div>', "cr-span-12") +
      '</div>';
  }

  function renderSystem() {
    var body = state.systemView === "command" ? renderCommandCenter()
      : (state.systemView === "overview" ? renderSystemOverview()
      : (state.systemView === "workload" ? renderWorkload()
      : (state.systemView === "observability" ? renderObservability() : renderResources())));
    return renderHeader("System", "Command, observe, and intervene through one canonical control plane.", { values: SYSTEM_VIEWS, selected: state.systemView }) + body;
  }

  function appCard(title, subtitle, href, meta, external) {
    return '<a class="cr-app-card" href="' + esc(href || "#") + '"' + (external ? ' target="_blank" rel="noopener"' : "") + '><strong>' + esc(title) + '</strong><small>' + esc(subtitle || "") + '</small><span class="cr-app-card__foot"><span>' + esc(meta || "Specialized app") + '</span><span>Open ↗</span></span></a>';
  }
  function renderAnalytics() {
    if (!window.CR.analytics) {
      return renderHeader("Analytics", "Traffic, audience, content and diagnostics in the canonical Control shell.") +
        '<div class="cr-canvas">' + empty("Analytics unavailable", "The native Analytics module did not load. Refresh Control Room; this surface will not fail silently.") + '</div>';
    }
    return '<div id="crAnalyticsMount"></div>';
  }

  function renderApps() {
    var registered = state.apps.map(function (a) { return appCard(a.name || a.app_key, [a.product_family, a.kind].filter(Boolean).join(" · ") || "Registered application", a.public_url || "#", a.app_key || "registered", true); }).join("") || '<div class="cr-panel__body cr-muted">No registered applications were returned.</div>';
    var specialty = [bridge.whip, bridge.spatial, bridge.prim3, bridge.halo, bridge.manufacture].map(function (a) { return appCard(a.title, a.subtitle, a.href, "Specialized workspace", a.external); }).join("");
    return renderHeader("Apps", "Specialized products stay one launch away without becoming permanent Control Room navigation.") + '<section class="cr-app-section"><div class="cr-panel__head"><h2>Registered applications</h2><span class="cr-panel__meta">' + state.apps.length + '</span></div><div class="cr-app-grid">' + registered + '</div></section><section class="cr-app-section"><div class="cr-panel__head"><h2>Specialized workspaces</h2></div><div class="cr-app-grid">' + specialty + '</div></section>';
  }

  function renderLoading() { return renderHeader(titleCase(state.surface), "Loading canonical McCluster state…") + '<div class="cr-canvas">' + empty("Loading", "Reading existing APIs and operator-visible records.") + '</div>'; }
  function render() {
    renderNav(); renderTopStatus();
    var root = $("crSurface"); if (!root) return;
    if (state.loading && !state.status && !state.health) root.innerHTML = renderLoading();
    else if (state.surface === "home") root.innerHTML = renderHome();
    else if (state.surface === "ai") root.innerHTML = renderAi();
    else if (state.surface === "work") root.innerHTML = renderWork();
    else if (state.surface === "create") root.innerHTML = renderCreate();
    else if (state.surface === "analytics") root.innerHTML = renderAnalytics();
    else if (state.surface === "system") root.innerHTML = renderSystem();
    else root.innerHTML = renderApps();
    bindSurfaceControls();
    if (state.surface === "analytics" && window.CR.analytics) {
      var analyticsHost = $("crAnalyticsMount");
      if (analyticsHost) {
        try {
          window.CR.analytics.mount(analyticsHost);
        } catch (analyticsErr) {
          analyticsHost.innerHTML = empty("Analytics failed to start", "The native Analytics module threw during startup. Refresh Control Room; if it repeats, inspect the browser console.");
          try { console.error("Control Analytics mount failed", analyticsErr); } catch (_) {}
        }
      }
    }
    /* Selecting a thread and landing on the inbox both need the transcript;
       doing it after render keeps the fetch out of the render path. */
    /* Create's own sources load when Create is opened, the same way the
       inbox loads a transcript — not behind a button the operator has to
       find first. */
    if (state.surface === "ai" && state.selectedAiThreadId && !state.aiMessages[state.selectedAiThreadId] && !state.pending["aiMessages:" + state.selectedAiThreadId]) {
      loadAiMessages(state.selectedAiThreadId);
    }
    if (state.surface === "create" && !state.socialAccounts && !state.pending.socialAccounts) {
      state.pending.socialAccounts = true;
      loadSocialAccounts().then(function () { delete state.pending.socialAccounts; });
    }
    if (state.surface === "create" && state.createView === "projects" && !state.pending.mediaModels && !window.CR.media.state.catalog) {
      state.pending.mediaModels = true;
      window.CR.media.loadCatalog().then(function () { delete state.pending.mediaModels; });
    }
    if (state.surface === "system" && state.systemView === "observability" && !state.observability && !state.pending.observability) {
      state.pending.observability = true;
      loadObservability(false).finally(function () { delete state.pending.observability; });
    }
    if (state.surface === "work" && FUTURE_WORK[state.workView] && !state.futureWork[state.workView] && !state.pending["futureWorkLoad:" + state.workView]) {
      var futureLoadView = state.workView;
      state.pending["futureWorkLoad:" + futureLoadView] = true;
      loadFutureWork(futureLoadView, false).finally(function () {
        delete state.pending["futureWorkLoad:" + futureLoadView];
      });
    }
    if (state.surface === "work" && state.workView === "inbox" && state.selectedThreadId && !state.transcripts[state.selectedThreadId] && !state.pending["transcript:" + state.selectedThreadId]) {
      state.pending["transcript:" + state.selectedThreadId] = true;
      var pendingId = state.selectedThreadId;
      loadTranscript(pendingId).then(function () { delete state.pending["transcript:" + pendingId]; });
    }
  }

  function inspectorSection(title, html) { return '<section class="cr-inspector__section"><h3>' + esc(title) + '</h3>' + html + '</section>'; }
  function props(rows) { return '<div class="cr-props">' + rows.map(function (r) { return '<div class="cr-prop"><span>' + esc(r[0]) + '</span><b>' + esc(text(r[1])) + '</b></div>'; }).join("") + '</div>'; }
  function renderInspectorTabs(active, tabs) {
    tabs = tabs || ["overview", "activity", "related", "ai"];
    $("crInspectorTabs").innerHTML = tabs.map(function (tab) { return '<button type="button" data-inspector-tab="' + tab + '" class="' + (tab === active ? "is-active" : "") + '">' + esc(titleCase(tab)) + '</button>'; }).join("");
  }
  function openInspector(data) {
    state.inspector = data || { title: "Details" };
    if (!state.inspector.tab) state.inspector.tab = "overview";
    var p = $("crInspector"); if (!p) return;
    p.classList.add("is-open"); p.setAttribute("aria-hidden", "false");
    if ($("crMain")) $("crMain").classList.add("has-inspector");
    renderInspector();
  }
  function closeInspector() {
    state.inspector = null;
    if ($("crInspector")) { $("crInspector").classList.remove("is-open"); $("crInspector").setAttribute("aria-hidden", "true"); }
    if ($("crMain")) $("crMain").classList.remove("has-inspector");
  }
  function aiComposer(context) {
    return '<div class="cr-ai-box"><textarea id="crAiContextInput" rows="4" placeholder="Ask McCluster about this…"></textarea><button class="cr-btn cr-btn--primary" type="button" data-action="ai-context" data-context="' + esc(context || "") + '">Send to Core</button></div>';
  }
  function renderInspector() {
    var d = state.inspector; if (!d) return;
    $("crInspectorTitle").textContent = d.title || "Details";
    $("crInspectorSub").textContent = d.subtitle || "McCluster Control Room";
    var tabs = d.tabs || ["overview", "activity", "related", "ai"];
    if (tabs.indexOf(d.tab) < 0) d.tab = tabs[0];
    renderInspectorTabs(d.tab, tabs);
    var html = "";
    if (d.tab === "overview") {
      if (d.props && d.props.length) html += inspectorSection("Overview", props(d.props));
      if (d.description) html += inspectorSection("Context", '<p class="cr-muted">' + esc(d.description) + '</p>');
      if (d.custom) html += d.custom;
      if (d.actions) html += '<div class="cr-inspector__actions">' + d.actions + '</div>';
    } else if (d.tab === "activity") {
      html = inspectorSection("Activity", d.activity || '<p class="cr-muted">Canonical events will appear here when available.</p>');
    } else if (d.tab === "related") {
      html = inspectorSection("Related", d.related || '<p class="cr-muted">Related records resolve through the existing McCluster object graph.</p>');
    } else if (d.tab === "raw") {
      html = inspectorSection("Raw", '<pre class="cr-raw">' + esc(JSON.stringify(d.raw || {}, null, 2)) + '</pre>');
    } else {
      html = inspectorSection("AI", '<p class="cr-muted">This sends context to canonical Core and creates a durable objective/reflection job.</p>' + aiComposer((d.title || "object") + ": " + (d.description || "")));
    }
    $("crInspectorBody").innerHTML = html || '<p class="cr-muted">No details available.</p>';
    bindActions($("crInspectorBody"));
  }

  function findById(rows, id) { return rows.find(function (r) { return String(r.id) === String(id); }); }
  function inspectLead(id) {
    var l = findById(state.leads, id); if (!l) return;
    var busy = state.pending["lead:" + id];
    var writeError = state.pending["leadError:" + id];
    var buttons = LEAD_STAGES.map(function (st) {
      return '<button class="cr-btn' + (l.status === st ? ' cr-btn--primary' : '') + '" type="button" data-action="lead-status" data-id="' + esc(l.id) + '" data-status="' + st + '"' + (busy ? " disabled" : "") + '>' + esc(LEAD_STAGE_LABELS[st]) + '</button>';
    }).join("");
    var custom = "";
    if (busy) custom += inspectorSection("Saving", '<p class="cr-muted">Writing the new stage to the canonical leads table…</p>');
    /* A refused write is reported, and the stage shown has already been
       rolled back to what the database still holds. */
    if (writeError) custom += inspectorSection("Stage not saved", sourceBanner(writeError, "leads update"));
    var related = '<div class="cr-list">' + (l.email
      ? state.threads.filter(function (t) { return String(contactFromThread(t).address || "").toLowerCase() === String(l.email).toLowerCase(); })
          .map(function (t) { return row(threadLabel(t), "Conversation", ago(t.updated_at), "ai", "inspect-thread", { id: t.id, badge: "Thread" }); }).join("")
      : "") + '</div>';
    openInspector({
      title: l.name || l.email || "Lead",
      subtitle: "Work · " + titleCase(l.status || "new"),
      description: l.note || l.want || "Business relationship",
      props: [["Email", l.email], ["Phone", l.phone], ["Status", l.status || "new"], ["Wants", l.want],
        ["Source", l.source || "direct"], ["Campaign", l.campaign], ["Page", l.page],
        ["Received", formatDate(l.at || l.created_at)]],
      custom: custom, actions: buttons,
      related: related.indexOf("cr-row") >= 0 ? related : '<p class="cr-muted">No conversation is linked to this lead by address.</p>',
      raw: l, tabs: ["overview", "related", "raw", "ai"]
    });
  }
  function inspectThread(id) {
    var t = findById(state.threads, id); if (!t) return;
    var c = contactFromThread(t); var human = threadOwned(t);
    var busy = state.pending["mode:" + t.id];
    var controls = '<button class="cr-btn cr-btn--primary" type="button" data-action="thread-mode" data-id="' + esc(t.id) + '" data-mode="' + (human ? "release" : "takeover") + '"' + (busy ? " disabled" : "") + '>' + (busy ? "Working…" : (human ? "Return to assistant" : "Take over")) + '</button>' +
      '<button class="cr-btn" type="button" data-action="thread-compose" data-id="' + esc(t.id) + '">Open conversation</button>';
    /* Activity is the delivery ledger: an operator chasing a message that
       never left needs to see the state the relay actually recorded. */
    var transcript = state.transcripts[t.id];
    var activity;
    if (!transcript) activity = '<p class="cr-muted">Open the conversation to load its delivery history.</p>';
    else if (!transcript.ok) activity = sourceBanner(transcript, "Transcript");
    else {
      var messages = (transcript.data && transcript.data.messages) || [];
      activity = messages.length
        ? '<div class="cr-trace">' + messages.slice(-12).map(function (m) {
            var cls = m.status === "failed" || m.status === "suppressed" ? "is-bad" : (m.status === "delivered" || m.status === "sent" ? "is-done" : "");
            return '<div class="' + cls + '">' + esc(titleCase(m.sender_type || m.direction)) + ' · ' + esc(m.status || "—") + ' <span>' + esc(formatDate(m.occurred_at || m.created_at)) + '</span></div>';
          }).join("") + '</div>'
        : '<p class="cr-muted">No messages recorded on this thread.</p>';
    }
    var failure = state.pending["error:" + t.id];
    openInspector({
      threadId: t.id,
      title: c.display_name || c.address || "Conversation",
      subtitle: human ? "You have it" : "Assistant handling",
      description: human ? "Automation is paused for this thread." : "The assistant may continue handling this thread under the existing communications policy.",
      props: [["Channel", t.channel || "sms"], ["Address", c.address || "—"], ["Mode", t.mode || "assistant"],
        ["Assistant", t.assistant_enabled === false ? "disabled" : "enabled"],
        ["Last inbound", formatDate(t.last_inbound_at)], ["Last outbound", formatDate(t.last_outbound_at)],
        ["Updated", formatDate(t.updated_at)]],
      custom: failure ? inspectorSection("Last action failed", sourceBanner(failure, "Thread action")) : "",
      actions: controls, activity: activity, raw: t, tabs: ["overview", "activity", "raw", "ai"]
    });
  }
  function payloadBlock(title, value) {
    if (value === null || value === undefined || (typeof value === "object" && !Object.keys(value).length)) return "";
    return inspectorSection(title, '<pre class="cr-raw">' + esc(typeof value === "string" ? value : JSON.stringify(value, null, 2)) + '</pre>');
  }
  function inspectJob(id) {
    var j = findById(state.jobs, id); if (!j) return;
    var failed = j.status === "failed";
    var activity = '<div class="cr-trace">' +
      '<div class="is-done">Created <span>' + esc(formatDate(j.created_at)) + '</span></div>' +
      (j.started_at ? '<div class="is-done">Started <span>' + esc(formatDate(j.started_at)) + '</span></div>' : "") +
      '<div class="' + (j.status === "running" ? "is-live" : (failed ? "is-bad" : "is-done")) + '">Execution <span>' + esc(titleCase(j.status || "unknown")) + '</span></div>' +
      (j.finished_at ? '<div class="is-done">Finished <span>' + esc(formatDate(j.finished_at)) + '</span></div>' : "") +
      (j.last_error ? '<div class="is-bad">Error <span>' + esc(j.last_error) + '</span></div>' : "") + '</div>';
    /* A failure is only useful if the operator can see what went in, what
       came back, and how long it ran — all of which the row already holds. */
    var detail = "";
    if (j.last_error) detail += inspectorSection("Failure", '<p class="cr-fail">' + esc(j.last_error) + '</p>');
    detail += payloadBlock("Input", j.payload || j.input);
    detail += payloadBlock("Result", j.result || j.output);
    openInspector({
      title: titleCase(j.job_type), subtitle: "Workload · " + titleCase(j.status),
      description: "Durable job in ops_agent_jobs.",
      props: [["Target", j.target_id || j.target_type], ["Target type", j.target_type], ["Priority", j.priority],
        ["Attempts", count(j.attempts) + "/" + count(j.max_attempts)],
        ["Run time", durationBetween(j.started_at || j.created_at, j.finished_at || j.updated_at)],
        ["Created", formatDate(j.created_at)], ["Updated", formatDate(j.updated_at)]],
      custom: detail, activity: activity, raw: j, tabs: ["overview", "activity", "raw", "ai"]
    });
  }
  /* Media jobs can come from the loaded snapshot or from a generation that
     is still being followed this session; both resolve here. */
  function allMediaJobs() { return state.mediaJobs.concat(window.CR.media.trackedJobs()); }
  function allMediaAssets() { return state.mediaAssets.concat(window.CR.media.generatedAssets()); }

  /* Proposed decisions are owner actions, not read-only records. The transition
     route changes status only; decision text remains immutable history. */
  function inspectDecision(id) {
    var d = findById(state.decisions, id) || state.decisions[0];
    if (!d) return;
    var risky = ["high", "critical"].indexOf(d.risk_class) >= 0;
    var busy = state.pending["decision:" + d.id];
    var failure = state.pending["decisionError:" + d.id];
    var waiting = d.status === "proposed"
      ? inspectorSection("Waiting on you",
          '<textarea class="cr-textarea" id="crDecisionNote" rows="3" placeholder="Optional resolution note"></textarea>' +
          (failure ? sourceBanner(failure, "Decision transition") : "") +
          '<p class="cr-muted">Approve or reject changes status only. The recorded decision text stays immutable.</p>')
      : "";
    openInspector({
      title: d.title || "Decision",
      subtitle: "Decision · " + titleCase(d.status || "proposed"),
      description: d.decision || d.rationale_summary || "Recorded in the private AI context plane.",
      props: [["Status", d.status], ["Risk", d.risk_class], ["Proposed", formatDate(d.created_at)],
        ["Proposed by", d.proposed_by], ["Resolved", formatDate(d.approved_at)], ["Resolved by", d.approved_by], ["Supersedes", d.supersedes_id]],
      custom: waiting +
        (risky ? inspectorSection("Risk", '<p class="cr-fail">' + esc(titleCase(d.risk_class)) + ' risk. This was flagged at record time.</p>') : ""),
      actions: d.status === "proposed"
        ? '<button class="cr-btn cr-btn--primary" type="button" data-action="decision-status" data-id="' + esc(d.id) + '" data-status="approved"' + (busy ? " disabled" : "") + '>' + (busy ? "Saving…" : "Approve") + '</button>' +
          '<button class="cr-btn" type="button" data-action="decision-status" data-id="' + esc(d.id) + '" data-status="rejected"' + (busy ? " disabled" : "") + '>Reject</button>'
        : "",
      related: d.source_conversation_id
        ? '<p class="cr-muted">Source conversation: <span class="cr-mono">' + esc(d.source_conversation_id) + '</span></p>'
        : '<p class="cr-muted">No source conversation is recorded on this decision.</p>',
      raw: d, tabs: ["overview", "related", "raw", "ai"]
    });
  }

  function inspectMediaJob(id) {
    var j = findById(allMediaJobs(), id); if (!j) return;
    var detail = "";
    var err = jsonText(j.error) || jsonText(j.result && j.result.error);
    if (err) detail += inspectorSection("Failure", '<p class="cr-fail">' + esc(err) + '</p>');
    detail += payloadBlock("Input", j.input || j.request);
    detail += payloadBlock("Result", j.result || j.output);
    /* Cost is shown only where the backend settled or estimated a number. */
    var cost = [];
    if (j.actual_cost_cents !== null && j.actual_cost_cents !== undefined) cost.push(["Actual cost", moneyCents(j.actual_cost_cents)]);
    if (j.estimated_cost_cents !== null && j.estimated_cost_cents !== undefined) cost.push(["Estimated cost", moneyCents(j.estimated_cost_cents)]);
    var assets = allMediaAssets().filter(function (a) { return String(a.job_id || a.media_job_id) === String(j.id); });
    openInspector({
      title: titleCase(j.capability || j.kind || "Media job"), subtitle: "Create · " + titleCase(j.status || "job"),
      description: "Canonical media_jobs record.",
      props: [["Status", j.status], ["Provider", j.provider], ["Model", j.provider_model_id || j.model_id],
        ["Run time", durationBetween(j.created_at || j.submitted_at, j.completed_at || j.updated_at)],
        ["Created", formatDate(j.created_at)], ["Completed", formatDate(j.completed_at)]].concat(cost),
      custom: detail,
      related: assets.length
        ? '<div class="cr-list">' + assets.map(function (a) { return row(assetName(a), "Produced asset", titleCase(a.media_type || a.type || "asset"), "ok", "inspect-asset", { id: a.id, badge: "Asset" }); }).join("") + '</div>'
        : '<p class="cr-muted">No asset rows reference this job.</p>',
      raw: j, tabs: ["overview", "related", "raw", "ai"]
    });
  }
  function inspectService(key) {
    var s = serviceRows().find(function (x) { return x.key === key; }) || { title: "System", sub: "McCluster", value: "Inspect" };
    var extra = [];
    if (key === "core" && state.ai) extra = [["Total jobs", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.total], ["Queued", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.queued], ["Running", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.running], ["Failed", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.failed]];
    if (key === "host" && state.aiHealth) extra = [["Overall", state.aiHealth.overall], ["Checked", formatDate(state.aiHealth.checked_at)], ["Stale", state.aiHealth.stale ? "yes" : "no"]];
    openInspector({ title: s.title, subtitle: "System resource", description: s.sub, props: [["State", s.value]].concat(extra), raw: key === "core" ? state.ai : (key === "host" ? state.aiHealth : state.status), tabs: ["overview", "activity", "raw", "ai"] });
  }
  function inspectAsset(id) {
    var a = findById(allMediaAssets(), id); if (!a) return;
    /* Lineage is only shown where a real job row backs it — an asset whose
       producing job is not in the snapshot says so instead of implying one. */
    var jobId = a.job_id || a.media_job_id;
    var job = jobId ? findById(allMediaJobs(), jobId) : null;
    var lineage = job
      ? '<div class="cr-list">' + row(titleCase(job.capability || job.kind || "Media job"), "Produced this asset", titleCase(job.status || ""), job.status === "failed" ? "bad" : "ok", "inspect-media-job", { id: job.id, badge: "Job" }) + '</div>'
      : (jobId ? '<p class="cr-muted">This asset references job ' + esc(jobId) + ', which is not in the current media job snapshot.</p>'
               : '<p class="cr-muted">No producing job is recorded on this asset.</p>');
    var url = a.url || a.public_url || a.storage_url || a.signed_url || "";
    openInspector({
      title: assetName(a), subtitle: "Create · Library", description: "Canonical media asset.",
      props: [["Type", a.media_type || a.type || a.kind], ["Created", formatDate(a.created_at)],
        ["Job", jobId || "—"], ["Provider", a.provider || job && job.provider || "—"],
        ["Model", a.model_id || job && (job.provider_model_id || job.model_id) || "—"]],
      custom: url ? inspectorSection("Source", '<a class="cr-btn" href="' + esc(url) + '" target="_blank" rel="noopener">Open original</a>') : "",
      related: lineage, raw: a, tabs: ["overview", "related", "raw", "ai"]
    });
  }
  function inspectVariant(id) { var v = findById(state.variants, id); if (!v) return; openInspector({ title: v.variant_key || "Variant", subtitle: "Create · Project", description: v.hypothesis || v.hook || "Creative variant", props: [["Status", v.status], ["Score", v.score], ["Media job", v.media_job_id], ["Created", formatDate(v.created_at)]], raw: v, tabs: ["overview", "related", "raw", "ai"] }); }
  function inspectPost(id) { var p = findById(state.posts, id); if (!p) return; openInspector({ title: "Published post", subtitle: "Create · Schedule", description: p.caption || "Published content", props: [["Mode", p.publish_mode], ["Published", formatDate(p.published_at)], ["Permalink", p.permalink || "—"]], raw: p, tabs: ["overview", "activity", "raw", "ai"] }); }
  function inspectPublish(id) {
    var p = findById(state.publishJobs, id); if (!p) return;
    var busy = state.pending["publishJob:" + p.id];
    var failure = state.pending["publishJobError:" + p.id];
    var actions = "";
    if (p.state === "failed") {
      actions = '<button class="cr-btn cr-btn--primary" type="button" data-action="publish-job-transition" data-id="' + esc(p.id) + '" data-verb="retry"' + (busy ? " disabled" : "") + '>' + (busy ? "Retrying…" : "Retry") + '</button>';
    } else if (p.state === "draft") {
      actions = '<button class="cr-btn cr-btn--primary" type="button" data-action="publish-job-transition" data-id="' + esc(p.id) + '" data-verb="approve"' + (busy ? " disabled" : "") + '>Approve & queue</button>' +
        '<button class="cr-btn" type="button" data-action="publish-job-transition" data-id="' + esc(p.id) + '" data-verb="cancel"' + (busy ? " disabled" : "") + '>Cancel</button>';
    } else if (p.state === "queued") {
      actions = '<button class="cr-btn" type="button" data-action="publish-job-transition" data-id="' + esc(p.id) + '" data-verb="cancel"' + (busy ? " disabled" : "") + '>' + (busy ? "Cancelling…" : "Cancel") + '</button>';
    }
    openInspector({
      title: "Publishing job", subtitle: "Create · Schedule",
      description: p.payload && p.payload.caption || "Scheduled distribution",
      props: [["State", p.state], ["Scheduled", formatDate(p.scheduled_at)], ["Mode", p.publish_mode || "—"],
        ["Attempts", p.attempts == null ? "—" : p.attempts], ["External media", p.external_media_id || "—"]],
      custom: (p.last_error ? inspectorSection("Last failure", '<p class="cr-fail">' + esc(p.last_error) + '</p>') : "") +
        (failure ? inspectorSection("Action failed", sourceBanner(failure, "Publishing")) : ""),
      actions: actions,
      raw: p, tabs: ["overview", "activity", "raw", "ai"]
    });
  }
  function inspectRequest(id) { var r = findById(state.siteRequests, id); if (!r) return; openInspector({ title: r.title || r.request_type || "Site request", subtitle: "Work · Request", description: r.note || r.description || "Client/site request", props: [["Status", r.status], ["Created", formatDate(r.created_at || r.at)]], raw: r }); }

  function openBridge(key) {
    var b = bridge[key]; if (!b) return;
    openInspector({ title: b.title, subtitle: "Existing specialized surface", description: b.subtitle, props: [["Authority", "Existing McCluster backend"], ["Migration", "No backend fork"]], actions: '<button class="cr-btn cr-btn--primary" data-open-href="' + esc(b.href) + '">Open</button>' });
  }

  function submitCoreTask(task, context) {
    var value = String(task || "").trim(); if (!value) return Promise.resolve();
    if (!state.org || !state.org.id) return Promise.reject(new Error("McCluster organization is unavailable"));
    var objective = context ? (context + "\n\n" + value) : value;
    return callCoreTool("objective.plan", {
      org_id: state.org.id,
      objective: objective,
      target_id: "McCluster",
      max_steps: 8,
      since_hours: 48,
      priority: 70
    }).then(function (result) {
      state.commandResult = { kind: "plan", data: result };
      openInspector({
        title: "Objective queued",
        subtitle: "Signed Core capability bus",
        description: value,
        props: [["Job", result.job_id], ["Type", result.job_type], ["Planner", "objective.plan"], ["Production mutation", result.safety && result.safety.production_mutation ? "allowed" : "blocked"]],
        raw: result,
        tabs: ["overview", "raw", "ai"]
      });
      load(true);
      return result;
    }).catch(function (e) {
      state.commandResult = { error: e.message || String(e) };
      openInspector({ title: "Core could not queue that", subtitle: "Command failed", description: e.message || String(e), props: [["Requested", value], ["Backend", "Signed /v1/core/mcp → objective.plan"]] });
    });
  }

  function handleCommand(query) {
    var q = String(query || "").trim(); var lower = q.toLowerCase(); if (!q) { openPalette(); return; }
    var routes = [
      /* Intents that land the operator on a specific object, not just a
         surface. Each one only fires where the backing data actually is. */
      [/\b(failed|failing|broken|errors?)\b/i, function () {
        state.jobFilter = "failed"; setSurface("system", "workload");
      }],
      [/\b(waiting|unanswered|needs? (a )?reply|awaiting)\b/i, function () {
        state.threadFilter = "inbound";
        var first = state.threads.filter(function (t) { return threadInQueue(t, "inbound"); })[0];
        if (first) state.selectedThreadId = first.id;
        setSurface("work", "inbox");
      }],
      [/\b(run|check) (system )?health\b/i, function () {
        setSurface("system", "workload");
        runAction("refresh-health", null);
      }],
      [/^(home|attention|today)$/i, function () { setSurface("home"); }],
      [/\b(ai|chat|qwen|home ai|mccluster ai)\b/i, function () { setSurface("ai"); }],
      [/\b(analytics|traffic|audience|insights|forensics|page views?|visitors?|sessions?)\b/i, function () { setSurface("analytics"); }],
      [/\b(outreach|outreach desk|email campaign|follow[- ]?up)\b/i, function () { setSurface("work", "outreach"); }],
      [/\b(back office|merch operations|operations desk)\b/i, function () { setSurface("work", "operations"); }],
      [/\b(client console|business console)\b/i, function () { setSurface("work", "clients"); }],
      [/\b(inbox|messages?|conversations?)\b/i, function () { setSurface("work", "inbox"); }],
      [/\b(pipeline|leads?|deals?|opportunit)/i, function () { setSurface("work", "pipeline"); }],
      [/\b(people|person|contacts?)\b/i, function () { setSurface("work", "people"); }],
      [/\b(companies|company|organizations?)\b/i, function () { setSurface("work", "companies"); }],
      [/\b(clients?)\b/i, function () { setSurface("work", "clients"); }],
      [/\b(tasks?|todo)\b/i, function () { setSurface("work", "tasks"); }],
      [/\b(orders?)\b/i, function () { setSurface("work", "orders"); }],
      [/\b(bookings?|appointments?)\b/i, function () { setSurface("work", "bookings"); }],
      [/\b(library|assets?)\b/i, function () { setSurface("create", "library"); }],
      [/\b(schedule|calendar|published|publishing)\b/i, function () { setSurface("create", "schedule"); }],
      [/\b(music review|creator review|vault|lanes?|catalogue|catalog|isrc)\b/i, function () { setSurface("create", "music"); }],
      [/\b(studio)\b/i, function () { setSurface("create", "projects"); }],
      [/\b(projects?|create|media|campaigns?|canvas)\b/i, function () { setSurface("create", "projects"); }],
      [/\b(workload|agents?|runs?|jobs?|core)\b/i, function () { setSurface("system", "workload"); }],
      [/\b(observability|logs?|traces?|incidents?)\b/i, function () { setSurface("system", "observability"); }],
      [/\b(resources?|usage|spend|providers?|integrations?|api keys?)\b/i, function () { setSurface("system", "resources"); }],
      [/\b(system|health|ovh|cloudflare|supabase|gpu|infrastructure)\b/i, function () { setSurface("system", "overview"); }],
      [/\b(apps?|whip|prim3|halo|spatial|manufacture)\b/i, function () { setSurface("apps"); }]
    ];
    for (var i = 0; i < routes.length; i += 1) { if (routes[i][0].test(lower)) { closePalette(); routes[i][1](); return; } }

    /* Open a named person before treating the text as an objective — typing
       a client's name should find them, not queue a Core task about them. */
    var lead = state.leads.find(function (l) {
      return [l.name, l.email].filter(Boolean).some(function (v) { return String(v).toLowerCase().indexOf(lower) >= 0; });
    });
    if (lead) { closePalette(); setSurface("work", "pipeline"); inspectLead(lead.id); return; }
    var thread = state.threads.find(function (t) {
      var c = contactFromThread(t);
      return [c.display_name, c.address].filter(Boolean).some(function (v) { return String(v).toLowerCase().indexOf(lower) >= 0; });
    });
    if (thread) { closePalette(); state.selectedThreadId = thread.id; setSurface("work", "inbox"); return; }
    var project = state.campaigns.find(function (c) { return String(c.name || "").toLowerCase().indexOf(lower) >= 0; });
    if (project) { closePalette(); state.selectedProjectId = project.id; setSurface("create", "projects"); state.selectedProjectId = project.id; render(); return; }

    closePalette(); submitCoreTask(q);
  }

  function paletteCommands() {
    return [
      ["Home", "Attention, signals, current work", "home"],
      ["McCluster AI", "Persistent chat with your self-hosted model", "ai"],
      ["Work · Inbox", "Unified incoming conversations", "work-inbox"],
      ["Work · Pipeline", "Leads and opportunities", "work-pipeline"],
      ["Work · People", "Canonical people", "work-people"],
      ["Work · Clients", "Client work and site requests", "work-clients"],
      ["Work · Outreach", "Templates and outbound follow-up", "work-outreach"],
      ["Work · Operations", "Orders, merch, walls and rights", "work-operations"],
      ["Create · Projects", "Creative objectives and media generation", "create-projects"],
      ["Create · Library", "Canonical assets", "create-library"],
      ["Create · Schedule", "Distribution and publishing", "create-schedule"],
      ["Create · Channels", "Social destinations and composer", "create-channels"],
      ["Create · Music", "Review, catalogue, rights and distribution", "create-music"],
      ["Analytics", "Traffic, audience, content, identity and forensics", "analytics"],
      ["System · Command", "Speak to the signed Core capability bus", "system-command"],
      ["System · Overview", "Topology and service health", "system-overview"],
      ["System · Workload", "Agents, jobs, queues", "system-workload"],
      ["System · Observability", "Events, traces, incidents", "system-observability"],
      ["System · Resources", "Providers, usage, API access", "system-resources"],
      ["Apps", "Specialized products", "apps"],
      ["Show failed work", "Workload, filtered to failures", "goto-failed"],
      ["Open waiting conversations", "Threads whose last message came in", "goto-waiting"],
      ["Run system health", "Ask Core for a fresh host health result", "refresh-health"]
    ];
  }
  function renderPalette(filter) {
    var q = String(filter || "").trim().toLowerCase(); var cmds = paletteCommands().filter(function (x) { return !q || (x[0] + " " + x[1]).toLowerCase().indexOf(q) >= 0; });
    $("crPaletteResults").innerHTML = cmds.length ? cmds.map(function (x, i) { return '<button class="cr-palette__item' + (i === 0 ? " is-active" : "") + '" type="button" data-action="' + x[2] + '"><span>' + esc(x[0]) + '</span><small>' + esc(x[1]) + '</small></button>'; }).join("") : '<button class="cr-palette__item" type="button" data-command-query="' + esc(filter) + '"><span>Give Core this objective</span><small>' + esc(filter) + '</small></button>';
    bindActions($("crPaletteResults"));
    $("crPaletteResults").querySelectorAll("[data-command-query]").forEach(function (b) { b.addEventListener("click", function () { handleCommand(b.getAttribute("data-command-query")); }); });
  }
  function openPalette() { var p = $("crPalette"); p.classList.add("is-open"); p.setAttribute("aria-hidden", "false"); var input = $("crPaletteInput"); input.value = ""; renderPalette(""); setTimeout(function () { input.focus(); }, 0); }
  function closePalette() { var p = $("crPalette"); p.classList.remove("is-open"); p.setAttribute("aria-hidden", "true"); }

  function runAction(action, el) {
    if (!action) return;
    if (action.indexOf("open-bridge:") === 0) { openBridge(action.split(":")[1]); return; }
    if (action.indexOf("inspect-future-work:") === 0) { inspectFutureWork(action.split(":")[1], el.getAttribute("data-id")); return; }
    /* Generation owns its own actions; everything else falls through. */
    if (window.CR.media.handleAction(action, el)) return;
    if (action === "home") setSurface("home");
    else if (action === "ai") setSurface("ai");
    else if (action === "ai-new-thread") { stopAiVoiceListening(true); stopAiVoiceSpeech(); createAiThread(); }
    else if (action === "ai-select-thread") { stopAiVoiceListening(true); stopAiVoiceSpeech(); state.selectedAiThreadId = el.getAttribute("data-id"); state.aiChatError = null; state.aiVoiceError = null; render(); }
    else if (action === "ai-send") { var aiInput = $("crAiComposer"); sendAiMessage(aiInput && aiInput.value, { inputMode: "text", speakReply: false }); }
    else if (action === "ai-voice-toggle") { if (state.aiVoiceListening) { stopAiVoiceListening(false); render(); } else startAiVoiceTurn(); }
    else if (action === "ai-stop-speaking") { stopAiVoiceSpeech(); render(); }
    else if (action === "ai-speak-message") { var voiceMessage = aiMessageById(el && el.getAttribute("data-id")); if (voiceMessage && voiceMessage.role === "assistant") speakAiText(voiceMessage.content); }
    else if (action === "work-inbox") setSurface("work", "inbox");
    else if (action === "work-pipeline") setSurface("work", "pipeline");
    else if (action === "work-people") setSurface("work", "people");
    else if (action === "work-clients") setSurface("work", "clients");
    else if (action === "work-outreach") setSurface("work", "outreach");
    else if (action === "work-operations") setSurface("work", "operations");
    else if (action === "analytics") setSurface("analytics");
    else if (action === "create-projects") setSurface("create", "projects");
    else if (action === "create-library") setSurface("create", "library");
    else if (action === "create-schedule") setSurface("create", "schedule");
    else if (action === "create-channels") setSurface("create", "channels");
    else if (action === "create-music") setSurface("create", "music");
    else if (action === "connect-account") {
      var platform = $("crAccPlatform") && $("crAccPlatform").value;
      var external = $("crAccExternal") && $("crAccExternal").value.trim();
      delete state.pending.accountOk;
      if (!external) {
        state.pending.accountError = badResult("failed", "The platform's own account id is required.", 0);
        render(); return;
      }
      var accBody = { platform: platform, external_account_id: external };
      var accHandle = $("crAccHandle") && $("crAccHandle").value.trim();
      var accName = $("crAccName") && $("crAccName").value.trim();
      if (accHandle) accBody.handle = accHandle;
      if (accName) accBody.display_name = accName;
      if (state.org && state.org.id) accBody.org_id = state.org.id;

      state.pending.account = true;
      delete state.pending.accountError;
      render();
      src(request("/v1/social/accounts", { method: "POST", body: accBody })).then(function (result) {
        delete state.pending.account;
        if (!result.ok) { state.pending.accountError = result; render(); return; }
        var acc = result.data && result.data.account;
        /* Say which of the two outcomes this was. A row in social_accounts
           with no credential cannot publish, and the form that created it
           is the right place to learn that. */
        state.pending.accountOk = acc && acc.status === "connected"
          ? "connected"
          : "registered, still disconnected until a server credential exists";
        loadSocialAccounts(true);
      });
    }
    else if (action === "create-campaign") {
      var cmpName = $("crCmpName") && $("crCmpName").value.trim();
      var cmpAccount = $("crCmpAccount") && $("crCmpAccount").value;
      delete state.pending.campaignOk;
      if (!cmpName || !cmpAccount) {
        state.pending.campaignError = badResult("failed", "A campaign needs a name and an account.", 0);
        render(); return;
      }
      var cmpBody = {
        account_id: cmpAccount,
        name: cmpName,
        objective: ($("crCmpObjective") && $("crCmpObjective").value) || "growth"
      };
      /* datetime-local has no zone; send a real instant. */
      var starts = $("crCmpStarts") && $("crCmpStarts").value;
      var ends = $("crCmpEnds") && $("crCmpEnds").value;
      if (starts) cmpBody.starts_at = new Date(starts).toISOString();
      if (ends) cmpBody.ends_at = new Date(ends).toISOString();
      if (state.org && state.org.id) cmpBody.org_id = state.org.id;

      state.pending.campaign = true;
      delete state.pending.campaignError;
      render();
      src(request("/v1/social/campaigns", { method: "POST", body: cmpBody })).then(function (result) {
        delete state.pending.campaign;
        if (!result.ok) { state.pending.campaignError = result; render(); return; }
        var campaign = result.data && result.data.campaign;
        state.pending.campaignOk = (campaign && campaign.name) || "campaign";
        /* It belongs on the list now, not after a reload. */
        if (campaign) state.campaigns.unshift(campaign);
        render();
      });
    }
    else if (action === "system-command") setSurface("system", "command");
    else if (action === "system-overview") setSurface("system", "overview");
    else if (action === "system-workload") setSurface("system", "workload");
    else if (action === "system-observability") setSurface("system", "observability");
    else if (action === "system-resources") setSurface("system", "resources");
    else if (action === "reload-observability") { state.observability = null; loadObservability(true); }
    else if (action === "save-media-budget") {
      if (!state.org || !state.org.id) return;
      var budgetEnabled = Boolean($("crMediaBudgetEnabled") && $("crMediaBudgetEnabled").checked);
      var capRaw = $("crMediaMonthlyCap") && $("crMediaMonthlyCap").value.trim();
      var warnRaw = $("crMediaWarnAt") && $("crMediaWarnAt").value.trim();
      var capCents = null;
      if (capRaw !== "") {
        var capDollars = Number(capRaw);
        if (!Number.isFinite(capDollars) || capDollars < 0) {
          state.pending.mediaBudgetError = badResult("failed", "Monthly cap must be a non-negative dollar amount.", 0);
          render(); return;
        }
        capCents = Math.round(capDollars * 100);
      }
      var warnAt = Number(warnRaw || 80);
      if (!Number.isInteger(warnAt) || warnAt < 1 || warnAt > 100) {
        state.pending.mediaBudgetError = badResult("failed", "Warning threshold must be an integer from 1 through 100.", 0);
        render(); return;
      }
      if (budgetEnabled && capCents === null) {
        state.pending.mediaBudgetError = badResult("failed", "Enter a monthly cap before turning enforcement on.", 0);
        render(); return;
      }

      state.pending.mediaBudget = true;
      delete state.pending.mediaBudgetError;
      delete state.pending.mediaBudgetOk;
      render();
      src(request("/v1/media/budget", {
        method: "PUT",
        body: {
          org_id: state.org.id,
          enabled: budgetEnabled,
          monthly_limit_cents: capCents,
          warn_at_percent: warnAt
        }
      })).then(function (result) {
        delete state.pending.mediaBudget;
        if (!result.ok) {
          state.pending.mediaBudgetError = result;
          render();
          return;
        }
        state.pending.mediaBudgetOk = true;
        delete state.pending.mediaBudgetError;
        return loadResources(true);
      });
    }
    else if (action === "apps") setSurface("apps");
    else if (action === "goto-failed") { state.jobFilter = "failed"; setSurface("system", "workload"); }
    else if (action === "goto-waiting") {
      state.threadFilter = "inbound";
      var waiting = state.threads.filter(function (t) { return threadInQueue(t, "inbound"); })[0];
      if (waiting) state.selectedThreadId = waiting.id;
      setSurface("work", "inbox");
    }
    else if (action === "refresh") load(true);
    else if (action === "hero-command") handleCommand($("crHeroInput") && $("crHeroInput").value);
    else if (action === "command-plan") {
      var planBox = $("crSystemCommand"), planText = planBox && planBox.value.trim();
      if (planText) submitCoreTask(planText);
    }
    else if (action === "command-ai") {
      var aiBox = $("crSystemCommand"), aiText = aiBox && aiBox.value.trim();
      if (!aiText || !state.org) return;
      state.commandResult = { kind: "ai", task: { status: "queueing" } }; render();
      callCoreTool("ai.chat", { prompt: aiText, temperature: 0.2 }).then(function (queued) {
        var task = queued && queued.task;
        if (!task || !task.id) throw new Error("Home AI did not return a durable compute task");
        state.commandResult = { kind: "ai", task: task }; render();
        return waitForComputeTask(task.id, 45);
      }).then(function (task) {
        state.commandResult = { kind: "ai", task: task }; render();
      }).catch(function (e) {
        state.commandResult = { error: e.message || String(e) }; render();
      });
    }
    else if (action === "command-research") {
      var researchBox = $("crSystemCommand"), researchText = researchBox && researchBox.value.trim();
      if (!researchText) return;
      state.commandResult = { kind: "research", data: { state: "running" } }; render();
      callCoreTool("research.web", { objective: researchText, limit: 6 }).then(function (result) {
        state.commandResult = { kind: "research", data: result }; render();
      }).catch(function (e) {
        state.commandResult = { error: e.message || String(e) }; render();
      });
    }
    else if (action === "command-resume") {
      if (!state.org) return;
      callCoreTool("core.resume", { org_id: state.org.id, since_hours: 24, limit: 25 }).then(function (result) {
        state.coreResume = result;
        state.commandResult = { kind: "resume", data: result }; render();
      }).catch(function (e) {
        state.commandResult = { error: e.message || String(e) }; render();
      });
    }
    else if (action === "approval-decide") {
      var approvalId = el && el.getAttribute("data-id");
      var decision = el && el.getAttribute("data-decision");
      if (!approvalId || !decision) return;
      state.pending["approval:" + approvalId] = true; render();
      request("/v1/ai/approvals/" + encodeURIComponent(approvalId) + "/decision", {
        method: "POST",
        body: { decision: decision }
      }).then(function (result) {
        delete state.pending["approval:" + approvalId];
        state.commandResult = { kind: "approval", data: result };
        return callCoreTool("core.resume", { org_id: state.org.id, since_hours: 24, limit: 25 });
      }).then(function (resume) {
        state.coreResume = resume;
        render();
      }).catch(function (e) {
        delete state.pending["approval:" + approvalId];
        state.commandResult = { error: e.message || String(e) };
        render();
      });
    }
    else if (action === "inspect-lead") inspectLead(el.getAttribute("data-id"));
    else if (action === "inspect-thread") inspectThread(el.getAttribute("data-id"));
    else if (action === "inspect-job") inspectJob(el.getAttribute("data-id"));
    else if (action === "inspect-service") inspectService(el.getAttribute("data-key"));
    else if (action === "inspect-asset") inspectAsset(el.getAttribute("data-id"));
    else if (action === "inspect-variant") inspectVariant(el.getAttribute("data-id"));
    else if (action === "inspect-post") inspectPost(el.getAttribute("data-id"));
    else if (action === "inspect-publish") inspectPublish(el.getAttribute("data-id"));
    else if (action === "inspect-request") inspectRequest(el.getAttribute("data-id"));
    else if (action === "open-project") { state.selectedProjectId = el.getAttribute("data-id"); render(); }
    else if (action === "close-project") { state.selectedProjectId = null; render(); }
    else if (action === "filters") {
      /* This used to open a panel that described filtering and filtered
         nothing. It now drives the same state the chips do, which is what
         makes it usable on a phone where the chip row is cramped. */
      var stageButtons = [["all", "All stages"]].concat(LEAD_STAGES.map(function (st) { return [st, LEAD_STAGE_LABELS[st]]; }))
        .map(function (pair) {
          return '<button class="cr-btn' + (state.pipelineStage === pair[0] ? " cr-btn--primary" : "") + '" type="button" data-action="set-stage" data-stage="' + esc(pair[0]) + '">' + esc(pair[1]) + '</button>';
        }).join("");
      var queueButtons = THREAD_QUEUES.map(function (q) {
        return '<button class="cr-btn' + (state.threadFilter === q[0] ? " cr-btn--primary" : "") + '" type="button" data-action="set-queue" data-queue="' + esc(q[0]) + '">' + esc(q[1]) + '</button>';
      }).join("");
      openInspector({
        title: "Filters", subtitle: "Work · " + titleCase(state.workView),
        description: "Stage filters the server lead query. Queue filters the loaded conversations.",
        custom: inspectorSection("Lead stage", '<div class="cr-inspector__actions">' + stageButtons + '</div>') +
          inspectorSection("Conversation queue", '<div class="cr-inspector__actions">' + queueButtons + '</div>') +
          inspectorSection("Search", '<p class="cr-muted">' +
            (state.search ? 'Filtering by "' + esc(state.search) + '". ' : "No search term. ") +
            'Lead search runs against the whole table, not just the loaded page.</p>' +
            (state.search ? '<button class="cr-btn" type="button" data-action="clear-search">Clear search</button>' : "")),
        tabs: ["overview"]
      });
    }
    else if (action === "set-stage") { state.pipelineStage = el.getAttribute("data-stage"); runLeadQuery(false); runAction("filters", el); }
    else if (action === "set-queue") { state.threadFilter = el.getAttribute("data-queue"); render(); runAction("filters", el); }
    else if (action === "clear-search") {
      state.search = "";
      var box = $("crWorkSearch"); if (box) box.value = "";
      runLeadQuery(false); closeInspector();
    }
    else if (action === "new-work") {
      /* Existing canonical records use work-records.js. Future post-sale
         objects use the same Control interaction contract now, even while
         their Worker routes are still capability-gated. */
      if (FUTURE_WORK[state.workView]) openFutureWorkForm(state.workView);
      else if (window.CR.work) window.CR.work.openForm(state.workView);
      else openInspector({ title: "Create a record", description: "The Work records module did not load, so nothing can be created from here right now.", tabs: ["overview"] });
    }
    else if (action === "future-work-edit") {
      openFutureWorkForm(el.getAttribute("data-view"), el.getAttribute("data-id"));
    }
    else if (action === "future-work-save") {
      var futureView = el.getAttribute("data-view");
      var futureId = el.getAttribute("data-id");
      var futureContract = FUTURE_WORK[futureView];
      if (!futureContract || !state.org || !state.org.id) return;
      var futureBody = { org_id: state.org.id };
      var futureInvalid = null;
      futureContract.fields.forEach(function (field) {
        var input = $("crFuture_" + field.key);
        var raw = input ? String(input.value || "").trim() : "";
        if (!raw) {
          if (field.required) futureInvalid = field.label + " is required.";
          return;
        }
        if (field.scale === 100) {
          var numeric = Number(raw);
          if (!Number.isFinite(numeric) || numeric < 0) { futureInvalid = field.label + " must be a non-negative number."; return; }
          futureBody[field.key] = Math.round(numeric * 100);
          return;
        }
        if (field.instant) {
          var instant = new Date(raw);
          if (Number.isNaN(instant.getTime())) { futureInvalid = field.label + " must be a valid date and time."; return; }
          futureBody[field.key] = instant.toISOString();
          return;
        }
        futureBody[field.key] = raw;
      });
      if (futureInvalid) {
        state.pending["futureWorkError:" + futureView] = badResult("failed", futureInvalid, 0);
        openFutureWorkForm(futureView, futureId);
        return;
      }
      state.pending["futureWorkSave:" + futureView] = true;
      delete state.pending["futureWorkError:" + futureView];
      openFutureWorkForm(futureView, futureId);
      src(request(futureContract.endpoint + (futureId ? "/" + encodeURIComponent(futureId) : ""), {
        method: futureId ? "PATCH" : "POST",
        body: futureBody
      })).then(function (result) {
        delete state.pending["futureWorkSave:" + futureView];
        if (!result.ok) {
          state.pending["futureWorkError:" + futureView] = result;
          openFutureWorkForm(futureView, futureId);
          return;
        }
        delete state.pending["futureWorkError:" + futureView];
        closeInspector();
        state.futureWork[futureView] = null;
        return loadFutureWork(futureView, true);
      });
    }
    else if (action === "select-thread") {
      state.selectedThreadId = el.getAttribute("data-id");
      delete state.pending["error:" + state.selectedThreadId];
      render(); /* render() owns transcript loading for the selected thread */
    }
    else if (action === "lead-status") {
      /* A status write that fails must not look like one that worked. The
         previous version had no rejection path at all, so a refused PATCH
         left the new status sitting on screen as if it had persisted. */
      var lid = el.getAttribute("data-id"), st = el.getAttribute("data-status");
      var lead = findById(state.leads, lid); if (!lead) return;
      var previous = lead.status;
      state.pending["lead:" + lid] = true; inspectLead(lid);
      supa("leads?id=eq." + encodeURIComponent(lid), { method: "PATCH", body: { status: st }, prefer: "return=minimal" })
        .then(function () { lead.status = st; delete state.pending["lead:" + lid]; delete state.pending["leadError:" + lid]; inspectLead(lid); render(); })
        .catch(function (e) {
          lead.status = previous;
          delete state.pending["lead:" + lid];
          state.pending["leadError:" + lid] = classifySourceError(e);
          inspectLead(lid); render();
        });
    } else if (action === "thread-mode") {
      var tid = el.getAttribute("data-id"), mode = el.getAttribute("data-mode");
      state.pending["mode:" + tid] = true; delete state.pending["error:" + tid]; render();
      request("/v1/comms/threads/" + encodeURIComponent(tid) + "/" + mode, { method: "POST", body: {} })
        .then(function () {
          /* Ownership is re-read, never assumed. The reload below merges the
             thread row the server returns, so if the handover did not
             actually take effect the console keeps showing the old owner
             instead of an optimistic flip the backend never made. */
          delete state.pending["mode:" + tid];
          return loadTranscript(tid, true);
        })
        .then(function () {
          render();
          if (state.inspector && state.inspector.threadId === tid) inspectThread(tid);
        })
        .catch(function (e) {
          delete state.pending["mode:" + tid];
          state.pending["error:" + tid] = classifySourceError(e);
          render();
        });
    } else if (action === "thread-compose") {
      var composeId = el.getAttribute("data-id");
      setSurface("work", "inbox");
      state.selectedThreadId = composeId;
      render();
    } else if (action === "thread-send") {
      var sendId = el.getAttribute("data-id");
      var box = $("crReply") || $("crThreadMessage");
      var body = box && box.value.trim();
      if (!body) { state.pending["error:" + sendId] = badResult("failed", "Nothing to send.", 0); render(); return; }
      state.pending["send:" + sendId] = true; delete state.pending["error:" + sendId]; render();
      request("/v1/comms/threads/" + encodeURIComponent(sendId) + "/send", { method: "POST", body: { body: body } })
        .then(function () {
          delete state.pending["send:" + sendId];
          delete state.drafts[sendId];
          var live = $("crReply"); if (live) live.value = "";
          return loadTranscript(sendId, true);
        })
        .catch(function (e) {
          delete state.pending["send:" + sendId];
          state.pending["error:" + sendId] = classifySourceError(e);
          render();
        });
    } else if (action === "inspect-resource") {
      /* These rows were rendered with an action that had no handler, so the
         click did nothing. A connection resolves to the service it actually
         is; a catalog product shows the record the catalog returned. */
      var rkey = el.getAttribute("data-key");
      var serviceKey = { "Core / model routing": "core", "Supabase": "db", "Cloudflare": "api" }[rkey];
      if (serviceKey) { inspectService(serviceKey); return; }
      var products = state.resources ? pickRows(state.resources.catalog, "products") : [];
      var product = products.find(function (p) { return String(p.id || p.name) === String(rkey); });
      if (product) {
        openInspector({
          title: product.name || product.id, subtitle: "System · Platform catalog",
          description: text(product.description, "Registered platform product"),
          props: [["Id", product.id], ["Status", product.status], ["Plan", product.plan]],
          raw: product, tabs: ["overview", "raw", "ai"]
        });
        return;
      }
      openInspector({
        title: text(rkey, "Resource"), subtitle: "System · Resources",
        description: "This connection is reported by the operator status payload. There is no dedicated endpoint behind it, so there is nothing further to open.",
        props: [["Resource", rkey]], tabs: ["overview", "ai"]
      });
    } else if (action === "load-resources") { loadResources(true); }
    else if (action === "inspect-consumer") {
      var consumers = state.resources ? pickRows(state.resources.consumers, "consumers") : [];
      var consumer = findById(consumers, el.getAttribute("data-id"));
      if (consumer) {
        /* Deliberately property-listed rather than raw-dumped: a consumer
           record can carry key material and this console does not render
           secrets it does not need to show. */
        openInspector({
          title: consumer.name || consumer.label || "API consumer", subtitle: "System · Resources",
          description: "Registered platform API consumer.",
          props: [["Status", consumer.status], ["Scope", consumer.scope], ["Plan", consumer.plan], ["Created", formatDate(consumer.created_at)]],
          tabs: ["overview", "ai"]
        });
      }
    }
    else if (action === "refresh-health") {
      state.pending.health = true; render();
      src(request("/v1/ai/system-health", { method: "POST", body: {} })).then(function (result) {
        delete state.pending.health;
        state.sources.aiHealth = result;
        if (result.ok) state.aiHealth = result.data;
        render();
      });
    }
    else if (action === "decision-status") {
      var decisionId = el.getAttribute("data-id");
      var decisionStatus = el.getAttribute("data-status");
      var decisionNote = $("crDecisionNote") && $("crDecisionNote").value.trim();
      state.pending["decision:" + decisionId] = true;
      delete state.pending["decisionError:" + decisionId];
      inspectDecision(decisionId);
      src(request("/v1/ai/decisions/" + encodeURIComponent(decisionId) + "/status", {
        method: "POST",
        body: { status: decisionStatus, note: decisionNote || "" }
      })).then(function (result) {
        delete state.pending["decision:" + decisionId];
        if (!result.ok) {
          state.pending["decisionError:" + decisionId] = result;
          inspectDecision(decisionId);
          return;
        }
        var resolved = result.data && result.data.decision;
        var current = findById(state.decisions, decisionId);
        if (resolved && current) Object.assign(current, resolved);
        delete state.pending["decisionError:" + decisionId];
        inspectDecision(decisionId);
        render();
      });
    }
    else if (action === "publish-job-transition") {
      var publishId = el.getAttribute("data-id");
      var publishVerb = el.getAttribute("data-verb");
      state.pending["publishJob:" + publishId] = true;
      delete state.pending["publishJobError:" + publishId];
      inspectPublish(publishId);
      src(request("/v1/social/publish/" + encodeURIComponent(publishId) + "/" + encodeURIComponent(publishVerb), {
        method: "POST", body: state.org && state.org.id ? { org_id: state.org.id } : {}
      })).then(function (result) {
        delete state.pending["publishJob:" + publishId];
        if (!result.ok) {
          state.pending["publishJobError:" + publishId] = result;
          inspectPublish(publishId);
          return;
        }
        var updatedPublish = result.data && result.data.publish_job;
        if (updatedPublish) state.publishJobs = state.publishJobs.map(function (row) { return String(row.id) === String(updatedPublish.id) ? updatedPublish : row; });
        delete state.pending["publishJobError:" + publishId];
        render();
        inspectPublish(publishId);
      });
    }
    else if (action === "inspect-media-job") { inspectMediaJob(el.getAttribute("data-id")); }
    else if (action === "inspect-generated-asset") { inspectAsset(el.getAttribute("data-id")); }
    else if (action === "inspect-decision") { inspectDecision(el.getAttribute("data-id")); }
    else if (action === "load-earlier") { loadEarlier(el.getAttribute("data-id")); }
    else if (action === "more-leads") { runLeadQuery(true); }
    else if (action === "open-publish") { openPublish(el.getAttribute("data-id")); }
    else if (action === "publish-variant") {
      var vid = el.getAttribute("data-id");
      var accountId = $("crPubAccount") && $("crPubAccount").value;
      if (!accountId) { state.pending["publishError:" + vid] = badResult("failed", "Select an account.", 0); openPublish(vid); return; }
      var when = $("crPubWhen") && $("crPubWhen").value;
      var pubBody = {
        account_id: accountId,
        variant_id: vid,
        publish_mode: ($("crPubMode") && $("crPubMode").value) || "trial"
      };
      var caption = $("crPubCaption") && $("crPubCaption").value.trim();
      if (caption) pubBody.caption = caption;
      /* datetime-local has no zone; send a real instant. */
      if (when) pubBody.scheduled_at = new Date(when).toISOString();
      if (state.org && state.org.id) pubBody.org_id = state.org.id;

      state.pending["publish:" + vid] = true;
      delete state.pending["publishError:" + vid];
      openPublish(vid);
      src(request("/v1/social/publish", { method: "POST", body: pubBody })).then(function (result) {
        delete state.pending["publish:" + vid];
        if (!result.ok) { state.pending["publishError:" + vid] = result; openPublish(vid); return; }
        var job = result.data && result.data.publish_job;
        state.pending["publishOk:" + vid] = (job && job.id) || "created";
        /* The new job belongs in Schedule immediately, not after a reload. */
        if (job) state.publishJobs.unshift(job);
        openPublish(vid); render();
      });
    }
    else if (action === "ai-context") {
      var q = $("crAiContextInput") && $("crAiContextInput").value.trim(); submitCoreTask(q, el.getAttribute("data-context"));
    } else if (action === "open-platform") {
      inspectService("api");
    }
  }

  function bindActions(root) {
    (root || document).querySelectorAll("[data-action]").forEach(function (el) {
      if (el.getAttribute("data-bound-action") === "1") return;
      el.setAttribute("data-bound-action", "1");
      el.addEventListener("click", function () { runAction(el.getAttribute("data-action"), el); });
    });
    (root || document).querySelectorAll("[data-open-href]").forEach(function (el) {
      if (el.getAttribute("data-bound-href") === "1") return;
      el.setAttribute("data-bound-href", "1");
      el.addEventListener("click", function () { location.href = el.getAttribute("data-open-href"); });
    });
    (root || document).querySelectorAll("tr[data-action]").forEach(function (tr) {
      if (tr.getAttribute("data-bound-key") === "1") return;
      tr.setAttribute("data-bound-key", "1");
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); runAction(tr.getAttribute("data-action"), tr); } });
    });
  }

  function filterCurrentView(query) {
    var q = String(query || "").trim().toLowerCase();
    document.querySelectorAll(".cr-canvas .cr-row, .cr-data-table tbody tr, .cr-board .cr-card").forEach(function (el) {
      el.style.display = !q || el.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
    });
  }
  function bindSurfaceControls() {
    bindActions($("crSurface"));
    window.CR.media.bind($("crSurface"));
    if (window.CR.workTools) window.CR.workTools.bind($("crSurface"));
    if (window.CR.socialCompose) window.CR.socialCompose.bind($("crSurface"));
    if (window.CR.instagram) window.CR.instagram.bind($("crSurface"));
    if (window.CR.musicOps) window.CR.musicOps.bind($("crSurface"));
    if (window.CR.actionNetwork) window.CR.actionNetwork.bind($("crSurface"));
    if (window.CR.songTest) window.CR.songTest.bind($("crSurface"));
    var select = $("crViewSelect");
    if (select) select.addEventListener("change", function () { if (state.surface === "work") setSurface("work", select.value); else if (state.surface === "create") setSurface("create", select.value); else if (state.surface === "system") setSurface("system", select.value); });
    var search = $("crWorkSearch");
    if (search) {
      search.value = state.search || "";
      search.addEventListener("input", function () {
        state.search = search.value;
        /* Work is backed by the leads table, so its search is a server query.
           The DOM filter still runs so thread rows in the same view narrow
           immediately while the query is in flight. */
        filterCurrentView(search.value);
        if (state.surface === "work") scheduleLeadQuery();
      });
    }
    var hero = $("crHeroInput"); if (hero) hero.addEventListener("keydown", function (e) { if (e.key === "Enter") handleCommand(hero.value); });

    /* These chips were rendered before but never bound, so the workload
       filters looked live and did nothing. They filter state now. */
    document.querySelectorAll("[data-thread-filter]").forEach(function (b) {
      b.addEventListener("click", function () { state.threadFilter = b.getAttribute("data-thread-filter"); render(); });
    });
    document.querySelectorAll("[data-job-filter]").forEach(function (b) {
      b.addEventListener("click", function () { state.jobFilter = b.getAttribute("data-job-filter"); render(); });
    });
    document.querySelectorAll("[data-stage-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.pipelineStage = b.getAttribute("data-stage-filter");
        /* The stage is part of the server query, not a client-side slice. */
        runLeadQuery(false);
      });
    });

    /* A re-render must not eat a half-written reply. */
    var reply = $("crReply");
    if (reply && state.selectedThreadId) {
      reply.value = state.drafts[state.selectedThreadId] || "";
      reply.addEventListener("input", function () { state.drafts[state.selectedThreadId] = reply.value; });
      reply.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          var send = document.querySelector('[data-action="thread-send"]');
          if (send && !send.disabled) send.click();
        }
      });
    }
    var aiComposerInput = $("crAiComposer");
    if (aiComposerInput) {
      aiComposerInput.value = state.aiChatDraft || "";
      aiComposerInput.addEventListener("input", function () { state.aiChatDraft = aiComposerInput.value; });
      aiComposerInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          var send = document.querySelector('[data-action="ai-send"]');
          if (send && !send.disabled) send.click();
        }
      });
    }
    var obsSeverity = $("crObsSeverity");
    if (obsSeverity) {
      obsSeverity.value = state.observabilitySeverity;
      obsSeverity.addEventListener("change", function () { state.observabilitySeverity = obsSeverity.value; render(); });
    }
    var obsSource = $("crObsSource");
    if (obsSource) {
      obsSource.value = state.observabilitySource;
      obsSource.addEventListener("change", function () { state.observabilitySource = obsSource.value; render(); });
    }
    var obsSearch = $("crObsSearch");
    if (obsSearch) {
      obsSearch.addEventListener("input", function () {
        state.observabilitySearch = obsSearch.value;
        clearTimeout(state.pending.observabilitySearchTimer);
        state.pending.observabilitySearchTimer = setTimeout(render, 120);
      });
    }
    if (state.search) filterCurrentView(state.search);
  }

  /* Which workspace this console is operating on, answered by the server.

     This was supa("orgs?slug=eq.mccluster&select=id,slug,name&limit=1") —
     a hardcoded slug, so Control Room could only ever open the house.
     A second tenant's operator got a console with no org, every scoped
     read silently empty, and nothing on screen saying why. */
  function discoverWorkspace() {
    return src(request("/v1/workspaces/me")).then(function (result) {
      var data = dataOf(result);
      var list = (data && data.workspaces) || [];
      var chosen = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].org_id === data.default_org_id) { chosen = list[i]; break; }
      }
      if (!chosen) {
        chosen = list.filter(function (w) { return w.enabled; })[0] || null;
      }
      return {
        source: result,
        membership: chosen,
        org: chosen ? { id: chosen.org_id, slug: chosen.slug, name: chosen.name } : null
      };
    });
  }
  function staticJson(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw Object.assign(new Error(path + " returned HTTP " + r.status), { status: r.status });
      return r.json();
    });
  }

  function loadPublicRecord() {
    return src(Promise.all([
      staticJson("data/seo/entity-graph.json"),
      staticJson("data/seo/evidence-ledger.json"),
      staticJson("data/seo/sitemap-pages.json")
    ]).then(function (r) {
      return { entityGraph: r[0], evidenceLedger: r[1], sitemapPages: r[2] };
    }));
  }

  function loadCreative(org) {
    var orgId = org && org.id;
    var scope = orgId ? "&org_id=eq." + encodeURIComponent(orgId) : "";
    return Promise.all([
      src(supa("media_assets?select=*&order=created_at.desc&limit=150")),
      src(supa("media_jobs?select=*&order=created_at.desc&limit=120")),
      src(supa("social_campaigns?select=*&order=created_at.desc&limit=100" + scope)),
      src(supa("social_variants?select=*&order=created_at.desc&limit=200" + scope)),
      src(supa("social_publish_jobs?select=*&order=scheduled_at.desc&limit=200" + scope)),
      src(supa("social_posts?select=*&order=published_at.desc&limit=200" + scope))
    ]).then(function (r) {
      return { mediaAssets: r[0], mediaJobs: r[1], campaigns: r[2], variants: r[3], publishJobs: r[4], posts: r[5] };
    });
  }

  function load(force) {
    if (state.loading && !force) return Promise.resolve();
    state.loading = true; state.error = null; render();
    var health = src(fetch(API + "/health", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw Object.assign(new Error("Edge health returned HTTP " + r.status), { status: r.status });
      return r.json();
    }));
    var publicRecord = loadPublicRecord();
    var authed = token().then(function (t) {
      if (!t) return { signedOut: true };
      return discoverWorkspace().then(function (ws) {
        var org = ws.org;
        /* No workspace is a state to render, not an exception to throw.
           The old code reached straight for org.id and died on a
           TypeError, which surfaced as a generic console error. */
        if (!org) return { workspace: ws, org: null };
        return Promise.all([
          src(request("/v1/core")),
          src(coreMcp("tools/list")),
          src(callCoreTool("core.resume", { org_id: org.id, since_hours: 24, limit: 25 })),
          src(request("/v1/status")), src(request("/v1/apps")), src(request("/v1/ai/status")), src(request("/v1/ai/system-health")),
          src(request("/v1/ai/decisions?limit=25")),
          src(request("/v1/comms/threads?limit=100")), src(supa(leadQueryPath(LEAD_PAGE, 0), { count: true, prefer: "count=exact" })),
          src(supa("site_requests?select=*&order=created_at.desc&limit=100")),
          src(supa("ops_agent_jobs?select=*&order=created_at.desc&limit=200")),
          src(supa("ops_ai_threads?select=*&org_id=eq." + encodeURIComponent(org.id) + "&status=eq.active&order=last_message_at.desc&limit=100")),
          loadCreative(org),
          src(request("/v1/audit/recent?limit=25&org_id=" + encodeURIComponent(org.id)))
        ]).then(function (r) {
          return {
            org: org, workspace: ws,
            coreBridge: r[0], coreTools: r[1], coreResume: r[2],
            status: r[3], apps: r[4], ai: r[5], aiHealth: r[6], decisions: r[7],
            threads: r[8], leads: r[9], siteRequests: r[10], jobs: r[11], aiThreads: r[12], creative: r[13],
            audit: r[14]
          };
        });
      });
    });
    return Promise.all([health, authed, publicRecord]).then(function (r) {
      var a = r[1] || {}; var c = a.creative || {};
      var signedOut = badResult("unauthorized", "This session is not signed in.", 401);
      state.sources = {
        health: r[0], coreBridge: a.coreBridge || signedOut, coreTools: a.coreTools || signedOut, coreResume: a.coreResume || signedOut,
        status: a.status || signedOut, apps: a.apps || signedOut, ai: a.ai || signedOut, aiHealth: a.aiHealth || signedOut,
        decisions: a.decisions || signedOut, threads: a.threads || signedOut, leads: a.leads || signedOut, siteRequests: a.siteRequests || signedOut, jobs: a.jobs || signedOut,
        aiThreads: a.aiThreads || signedOut,
        workspace: (a.workspace && a.workspace.source) || signedOut,
        audit: a.audit || signedOut,
        publicRecord: r[2],
        mediaAssets: c.mediaAssets || signedOut, mediaJobs: c.mediaJobs || signedOut, campaigns: c.campaigns || signedOut,
        variants: c.variants || signedOut, publishJobs: c.publishJobs || signedOut, posts: c.posts || signedOut
      };
      state.health = dataOf(state.sources.health); state.publicRecord = dataOf(state.sources.publicRecord); state.org = a.org || null;
      state.workspace = (a.workspace && a.workspace.membership) || null;
      state.audit = pickRows(state.sources.audit, "events");
      state.coreBridge = dataOf(state.sources.coreBridge);
      var coreToolsPayload = dataOf(state.sources.coreTools);
      state.coreTools = coreToolsPayload && Array.isArray(coreToolsPayload.tools) ? coreToolsPayload.tools : [];
      state.coreResume = dataOf(state.sources.coreResume);
      state.status = dataOf(state.sources.status); state.ai = dataOf(state.sources.ai); state.aiHealth = dataOf(state.sources.aiHealth);
      state.apps = pickRows(state.sources.apps, "apps");
      state.decisions = pickRows(state.sources.decisions, "decisions");
      state.threads = pickRows(state.sources.threads, "threads");
      /* The leads read is counted, so it returns {rows,total} rather than a
         bare array. Unwrap it and keep the source result array-shaped so
         every downstream reader stays unchanged. */
      var leadPayload = dataOf(state.sources.leads);
      state.leads = leadPayload && Array.isArray(leadPayload.rows) ? leadPayload.rows : rowsOf(state.sources.leads);
      state.leadTotal = leadPayload && leadPayload.total !== undefined ? leadPayload.total : null;
      if (state.sources.leads.ok) state.sources.leads = okResult(state.leads);
      state.siteRequests = rowsOf(state.sources.siteRequests); state.jobs = rowsOf(state.sources.jobs);
      state.aiThreads = rowsOf(state.sources.aiThreads);
      if (state.selectedAiThreadId && !aiThreadById(state.selectedAiThreadId)) state.selectedAiThreadId = null;
      if (!state.selectedAiThreadId && state.aiThreads.length) state.selectedAiThreadId = state.aiThreads[0].id;
      state.mediaAssets = rowsOf(state.sources.mediaAssets); state.mediaJobs = rowsOf(state.sources.mediaJobs);
      state.campaigns = rowsOf(state.sources.campaigns); state.variants = rowsOf(state.sources.variants);
      state.publishJobs = rowsOf(state.sources.publishJobs); state.posts = rowsOf(state.sources.posts);
      state.refreshedAt = new Date().toISOString();
      state.error = state.sources.status.ok ? null : state.sources.status.message || "Operator status unavailable";
    }).catch(function (e) { state.error = e.message || "Control Room state unavailable"; })
      .then(function () { state.loading = false; render(); });
  }

  function boot() { $("cpGate").hidden = true; $("crApp").hidden = false; readHash(); setHash(true); render(); load(); }
  function bindAuth() {
    $("cpIn").addEventListener("click", function () { var em = $("cpEmail").value.trim(), pw = $("cpPass").value; if (!em) { note("Email first.", true); return; } if (!pw) { note("Password required.", true); return; } var b = $("cpIn"); b.disabled = true; b.textContent = "Opening…"; window.MCC_AUTH.signInPassword(em, pw).then(boot).catch(function (e) { b.disabled = false; b.textContent = "Open Control Room"; note(String(e && e.message || e), true); }); });
    $("cpPass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("cpIn").click(); });
  }
  function bindShell() {
    document.querySelectorAll("[data-surface]").forEach(function (el) { el.addEventListener("click", function () { setSurface(el.getAttribute("data-surface")); }); });
    $("crCommandOpen").addEventListener("click", openPalette);
    $("crInspectorClose").addEventListener("click", closeInspector);
    $("crInspectorTabs").addEventListener("click", function (e) { var b = e.target.closest("[data-inspector-tab]"); if (!b || !state.inspector) return; state.inspector.tab = b.getAttribute("data-inspector-tab"); renderInspector(); });
    $("crPalette").addEventListener("click", function (e) { if (e.target === $("crPalette")) closePalette(); });
    $("crPaletteInput").addEventListener("input", function () { renderPalette($("crPaletteInput").value); });
    $("crPaletteInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = $("crPaletteResults").querySelector(".cr-palette__item"); if (first) first.click(); else handleCommand($("crPaletteInput").value); } });
    $("crAccount").addEventListener("click", function () { $("crAccountMenu").classList.toggle("is-open"); });
    $("crRefresh").addEventListener("click", function () { $("crAccountMenu").classList.remove("is-open"); load(true); });
    $("crOut").addEventListener("click", function () { window.MCC_AUTH.signOut().then(function () { location.reload(); }); });
    document.addEventListener("click", function (e) { if (!$("crAccountMenu").contains(e.target) && !$("crAccount").contains(e.target)) $("crAccountMenu").classList.remove("is-open"); });
    document.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); } if (e.key === "Escape") { if ($("crPalette").classList.contains("is-open")) closePalette(); else closeInspector(); } });
    window.addEventListener("hashchange", function () { readHash(); state.selectedProjectId = null; closeInspector(); render(); });
  }
  function tryResume() { token().then(function (t) { if (t && $("crApp").hidden) boot(); }); }
  /* The media module renders into the Create canvas and needs the shell's
     request client, panel chrome and render loop. It owns nothing else. */
  if (window.CR.analytics) window.CR.analytics.init({ request: request, supa: supa });
  if (window.CR.workTools) window.CR.workTools.init({
    request: request, supa: supa, render: render,
    refresh: function () { return load(true); },
    getState: function () { return state; }
  });
  if (window.CR.socialCompose) window.CR.socialCompose.init({ request: request, render: render });
  if (window.CR.instagram) window.CR.instagram.init({ request: request, render: render, org: function () { return state.org; } });
  if (window.CR.musicOps) window.CR.musicOps.init({ supa: supa, render: render });
  if (window.CR.actionNetwork) window.CR.actionNetwork.init({ supa: supa, request: request, render: render });
  if (window.CR.work) window.CR.work.init({
    request: request, render: render,
    orgId: function () { return state.org && state.org.id; },
    leads: function () { return state.leads || []; },
    refreshLeads: function () { runLeadQuery(false); }
  });
  if (window.CR.songTest) window.CR.songTest.init({ supa: supa, render: render });

  window.CR.media.init({
    request: request,
    panel: panel,
    render: render,
    orgId: function () { return state.org && state.org.id; },
    /* A finished job's output belongs in the canonical Library, so a settled
       job refreshes the asset and job sources rather than only living in the
       generation panel. */
    onJobSettled: function (record) {
      if (record.job) {
        var idx = state.mediaJobs.findIndex(function (j) { return String(j.id) === String(record.job.id); });
        if (idx >= 0) state.mediaJobs[idx] = record.job; else state.mediaJobs.unshift(record.job);
      }
      (record.assets || []).forEach(function (a) {
        if (!state.mediaAssets.some(function (x) { return String(x.id) === String(a.id); })) state.mediaAssets.unshift(a);
      });
    }
  });

  function init() { bindAuth(); bindShell(); bindActions(document); tryResume(); setTimeout(tryResume, 700); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
