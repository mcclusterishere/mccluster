/* McCluster Control Room
   Six sections from ONE navigation definition (js/control-room/nav.js):
   Home / People / Sell / Create / Insights / System. The sidebar, the phone
   bottom bar, the More sheet, the ⌘K palette and the owner bar's destination
   panel all read NAV; old routes (#work:*, #create:*, #ai, #analytics,
   #system:*, #apps) land through each entry's `was` list.
   This browser client composes existing canonical APIs and Supabase records.
   It does not introduce a second backend, auth stack, job queue, CRM, or media store. */
(function () {
  "use strict";

  var API = "https://api.mccluster.org";
  var $ = function (id) { return document.getElementById(id); };
  var NAVI = window.CR && window.CR.nav;
  var NAV = NAVI.NAV;
  /* The renderers each NAV leaf names, grouped by the surface whose code
     draws them. Derived from NAV so there is no second list to drift. */
  function rendererViews(prefix) {
    return NAVI.leaves().map(function (l) { return l.leaf.renderer || ""; })
      .filter(function (r) { return r.indexOf(prefix + ".") === 0; })
      .map(function (r) { return r.slice(prefix.length + 1); });
  }
  var WORK_VIEWS = rendererViews("work");
  var CREATE_VIEWS = rendererViews("create");
  var SYSTEM_VIEWS = rendererViews("system");

  var state = {
    /* where the operator is, in NAV terms */
    route: "#home:today",
    leaf: null,
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
    aiMessagesHasMore: {},
    aiThreadOffset: 0,
    aiThreadHasMore: false,
    selectedAiThreadId: null,
    aiChatPending: false,
    aiChatError: null,
    aiChatTask: null,
    aiChatDraft: "",
    aiRuns: {},
    aiDrafts: {},
    aiHistorySearch: "",
    aiHistoryOpen: false,
    aiToolsOpen: false,
    aiPanel: "chat",
    aiRouteSelection: "auto",
    aiImplementation: "qwen3.8b.local",
    aiReviewOf: null,
    aiDevices: [],
    aiEnrollments: [],
    aiPairs: [],
    aiDevicesLoaded: false,
    aiDeviceError: null,
    aiPairError: null,
    aiDeviceNotice: null,
    aiEnrollmentAvailable: false,
    aiEnrollment: null,
    aiEnrollmentReveal: false,
    aiInstaller: null,
    aiInstallerLoaded: false,
    aiAddDeviceOpen: false,
    aiRenameId: null,
    aiRevokeId: null,
    aiCreatePairOpen: false,
    aiVoiceListening: false,
    aiVoiceSpeaking: false,
    aiVoiceError: null,
    aiVoiceTranscript: "",
    /* Images attached to the next turn ({ base64, bytes, width, height, preview,
       name }) and the owner's "Use the browser" switch (device-node slice N2). */
    aiAttachments: [],
    aiAllowBrowser: false,
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
    resources: null,
    observability: null,
    observabilityTrace: null,
    workspaces: [],
    recentErrors: null,
    observabilityFilters: { level: "all", kind: "all", window: 24, q: "" },
    publicRecord: null,
    socialAccounts: null,
    decisions: [],
    leadTotal: null,
    pending: {},
    drafts: {},
    search: "",
    /* A line the shell itself shows ({ text, reload }): why the page was
       concealed or reloaded. */
    notice: null
  };
  /* What a fresh page holds. An account change puts every field back to this
     value except the shell's own place (SHELL_KEYS), so a field added above
     later belongs to the account by default. (Audit A1.) */
  var STATE_TEMPLATE = JSON.stringify(state);

  var bridge = {
    /* Specialized products are Apps. Operator administration does not leave
       Control; former back-office room names are only routing aliases. */
    whip: { title: "Whip", href: "whip.html", subtitle: "Mobility product" },
    prim3: { title: "PRIM3", href: "prim3.html", subtitle: "Learning product" },
    /* HITMAN'S HALO ON THE GLOBE (owner, 2026-10-21: "fix the fact that the control room points to seek first"): the
       owner's full-screen globe with the Halo console open. Seek First (the retired console behind
       auth/seek-first-handoff.html) is no longer a door from here. */
    halo: { title: "Hitman’s Halo", href: "action-globe.html?explore=1&halo=1", subtitle: "World · Missions · People · Intelligence" },
    manufacture: { title: "WE Manufacture", href: "we-manufacture.html", subtitle: "Manufacturing workspace" }
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
  var OWNER_AI = window.CR.ownerAi;

  function selectedAiRun() { return state.aiRuns[state.selectedAiThreadId] || null; }
  function setAiRun(threadId, values) {
    if (!threadId) return;
    var previous = state.aiRuns[threadId] || {};
    /* A poll already in flight cannot undo a confirmed stop. A new turn has
       a new id and explicitly clears these flags when it is submitted. */
    if (previous.stopped && previous.task && values.task && previous.task.id === values.task.id && ["queued", "running"].indexOf(values.task.status) >= 0) return;
    state.aiRuns[threadId] = Object.assign({}, previous, values);
    syncSelectedAiRun();
  }
  function syncSelectedAiRun() {
    var run = selectedAiRun();
    state.aiChatPending = Boolean(run && run.pending);
    state.aiChatTask = run && run.task || null;
  }
  function aiRouteSupported() { return aiDeclared(aiToolSchema(state.coreTools, "core.ai.turn.submit"), "route"); }
  function selectedAiRoute() { return OWNER_AI.route(state.aiRouteSelection, state.aiImplementation); }
  function aiRouteProblem() {
    if (!aiRouteSupported()) return state.aiRouteSelection !== "auto" ? "This Core does not support choosing a worker yet." : "";
    var route = selectedAiRoute();
    if (state.aiReviewOf) {
      if (route.mode !== "node") return "Choose a specific second worker to review this saved result.";
      var reviewed = aiMessagesFor(state.selectedAiThreadId).find(function (message) { return message.role === "assistant" && message.metadata && message.metadata.agent_job_id === state.aiReviewOf; });
      if (reviewed && OWNER_AI.receipt(reviewed).node_id === route.node_id) return "Choose a different worker from the one that produced this answer.";
    }
    if (state.aiAttachments.length && route.mode === "pair") return "The shared-model route currently accepts text only. Remove the images or choose an individual vision worker.";
    if (state.aiAttachments.length && route.implementation === "qwen3.8b.local") return "Qwen3 8B handles text. Choose a ready vision model for these images, or remove the attachments.";
    if (route.mode === "node") {
      var d = state.aiDevices.find(function (x) { return OWNER_AI.deviceId(x) === route.node_id; });
      if (!d || !d.eligible) return "The selected device is unavailable. Choose another worker or Auto.";
      if (!(d.models || []).some(function (m) { return m.implementation === route.implementation && m.ready; })) return "The selected model is not ready on this device. Open Devices to test or prepare it.";
    }
    if (route.mode === "pair") {
      var pair = state.aiPairs.find(function (x) { return String(x.id || x.pair_id) === route.pair_id; });
      if (!pair || !(pair.ready === true)) return "Deep Reasoning is unavailable until this pair passes its shared-model benchmark.";
    }
    return "";
  }

  function token() { return window.MCC_SUPA && window.MCC_SUPA.token ? window.MCC_SUPA.token() : Promise.resolve(null); }
  function sbBase() { return window.MCC_SUPA && window.MCC_SUPA.url; }
  function sbKey() { return window.MCC_SUPA && window.MCC_SUPA.key; }

  /* Every private read below (the shell's, every per-view loader's, every
     action's and every module's that was handed request or supa) is made
     under the current account generation: see CONTROL AUTHORITY GENERATION. */
  function request(path, opts) {
    opts = opts || {};
    var gen = authority.gen;
    return fenced(gen, tokenFor(gen).then(function (t) {
      var headers = { authorization: "Bearer " + t };
      if (state.org && state.org.id) headers["x-mccluster-org-id"] = state.org.id;
      if (window.crypto && typeof window.crypto.randomUUID === "function") headers["x-mccluster-trace-id"] = window.crypto.randomUUID();
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      return fetch(API + path, {
        method: opts.method || "GET",
        headers: headers,
        cache: "no-store",
        signal: readSignal(opts.signal),
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
    }));
  }

  var coreRpcSeq = 1;
  function coreMcp(method, params, opts) {
    return request("/v1/core/mcp", {
      method: "POST",
      signal: opts && opts.signal,
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

  function callCoreTool(name, args, opts) {
    return coreMcp("tools/call", { name: name, arguments: args || {} }, opts)
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
    var gen = authority.gen;
    return fenced(gen, tokenFor(gen).then(function (t) {
      if (!sbBase() || !sbKey()) throw new Error("signed out");
      var headers = { apikey: sbKey(), Authorization: "Bearer " + t };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.prefer) headers.Prefer = opts.prefer;
      return fetch(sbBase() + "/rest/v1/" + path, {
        method: opts.method || "GET",
        headers: headers,
        cache: "no-store",
        signal: readSignal(opts.signal),
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
    }));
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
    return supa("ops_ai_messages?select=*&thread_id=eq." + encodeURIComponent(threadId) + "&order=created_at.desc&limit=200")
      .then(function (rows) {
        state.aiMessages[threadId] = (Array.isArray(rows) ? rows : []).sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
        state.aiMessagesHasMore[threadId] = Array.isArray(rows) && rows.length === 200;
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

  function loadEarlierAiMessages(threadId) {
    var key = "aiEarlier:" + threadId;
    if (!threadId || !aiBrowserOwner(state) || state.pending[key] || !state.aiMessagesHasMore[threadId]) return;
    var offset = aiMessagesFor(threadId).length;
    state.pending[key] = true; render();
    return supa("ops_ai_messages?select=*&thread_id=eq." + encodeURIComponent(threadId) + "&order=created_at.desc&limit=200&offset=" + offset).then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      rows.forEach(aiMergeMessage);
      state.aiMessages[threadId].sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
      state.aiMessagesHasMore[threadId] = rows.length === 200;
    }).catch(function (error) { if (state.selectedAiThreadId === threadId) state.aiChatError = "Earlier messages could not be read: " + (error.message || "Reconnect and try again."); }).then(function () { delete state.pending[key]; render(); });
  }

  function loadMoreAiThreads() {
    if (!aiBrowserOwner(state) || state.pending.aiMoreThreads || !state.aiThreadHasMore) return;
    state.pending.aiMoreThreads = true; render();
    return supa("ops_ai_threads?select=*&org_id=eq." + encodeURIComponent(state.org.id) + "&status=eq.active&order=last_message_at.desc&limit=100&offset=" + state.aiThreadOffset).then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      state.aiThreadOffset += rows.length; state.aiThreadHasMore = rows.length === 100;
      rows.forEach(function (thread) { if (!aiThreadById(thread.id)) state.aiThreads.push(thread); });
    }).catch(function (error) { state.aiChatError = "Earlier conversations could not be read: " + (error.message || "Reconnect and try again."); }).then(function () { delete state.pending.aiMoreThreads; render(); });
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
      syncSelectedAiRun();
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
        ["failed", "canceled"].indexOf(meta.task_status) < 0 &&
        !assistantJobIds.has(String(meta.agent_job_id));
    });
    if (!unresolved.length) {
      var savedRun = state.aiRuns[thread.id];
      if (savedRun && savedRun.task && assistantJobIds.has(String(savedRun.task.id))) {
        setAiRun(thread.id, { pending: false, progress: null, error: null, task: Object.assign({}, savedRun.task, { status: "done" }) });
        render();
      } else if (savedRun && savedRun.task) {
        var terminalUser = messages.find(function (message) { var meta = message.metadata || {}; return message.role === "user" && String(meta.agent_job_id) === String(savedRun.task.id) && ["failed", "canceled"].indexOf(meta.task_status) >= 0; });
        if (terminalUser) { setAiRun(thread.id, { pending: false, progress: null, stopped: terminalUser.metadata.task_status === "canceled", task: Object.assign({}, savedRun.task, { status: terminalUser.metadata.task_status }) }); render(); }
      }
      return Promise.resolve(messages);
    }

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
        if (turn.status === "queued" || turn.status === "running") {
          setAiRun(thread.id, { pending: true, task: turn, progress: payload.progress || null });
          pending = Boolean(state.aiRuns[thread.id] && state.aiRuns[thread.id].pending);
        }
        if (turn.status === "failed") {
          failures.push(turn.last_error || ("Saved McCluster turn " + turn.status));
        }
      }).catch(function (error) {
        failures.push(error.message || String(error));
      });
    })).then(function () {
      delete state.pending[key];
      state.aiMessages[thread.id].sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
      if (failures.length) {
        setAiRun(thread.id, { error: "Saved McCluster turn recovery: " + failures.join(" | ") });
        if (String(state.selectedAiThreadId) === String(thread.id)) state.aiChatError = state.aiRuns[thread.id].error;
      }
      setAiRun(thread.id, { pending: pending, progress: pending ? (state.aiRuns[thread.id] || {}).progress : null });
      render();
      if (pending && state.surface === "ai" && String(state.selectedAiThreadId) === String(thread.id)) {
        var snapshot = authoritySnapshot();
        setTimeout(function () { if (authorityHolds(snapshot)) loadAiMessages(thread.id, true); }, 2500);
      }
      return state.aiMessages[thread.id];
    }, function (error) {
      delete state.pending[key];
      setAiRun(thread.id, { pending: false, task: null });
      state.aiChatError = "Saved McCluster turn recovery failed: " + (error.message || String(error));
      render();
      return state.aiMessages[thread.id] || messages;
    });
  }

  function waitForResidentAiTurn(turnId, attempts, threadId) {
    attempts = attempts || 330;
    threadId = threadId || state.selectedAiThreadId;
    if (!turnId || !state.org || !state.org.id) return Promise.reject(new Error("Resident AI turn identity unavailable"));
    function poll(left) {
      return callCoreTool("core.ai.turn.get", { org_id: state.org.id, turn_id: turnId }).then(function (payload) {
        var turn = payload && payload.turn;
        if (!turn) throw new Error("Resident McCluster turn disappeared");
        var currentRun = state.aiRuns[threadId];
        if (currentRun && currentRun.stopped && currentRun.task && currentRun.task.id === turnId && turn.status !== "done") {
          var stoppedError = new Error("Stopped"); stoppedError.turn = currentRun.task; throw stoppedError;
        }
        if (!currentRun || !currentRun.task || currentRun.task.id === turnId) setAiRun(threadId, { task: turn, pending: turn.status === "queued" || turn.status === "running", progress: payload.progress || null });
        if (payload.user_message) aiMergeMessage(payload.user_message);
        if (payload.assistant_message) aiMergeMessage(payload.assistant_message);
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
        return sleep(payload.progress ? 750 : 2000).then(function () { return poll(left - 1); });
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

  /* What the running Core declares, from the tool list this page already
     read, and whether that list was read at all (its source result). */
  function aiCoreWord() {
    var listed = state.sources && state.sources.coreTools;
    return aiCoreSupport(state.coreTools, Boolean(listed && listed.ok));
  }

  function sendAiMessage(value, opts) {
    opts = opts || {};
    syncSelectedAiRun();
    var content = String(value || "").trim();
    if (!content || state.aiChatPending) return Promise.resolve();
    state.aiChatError = null;
    if (!aiBrowserOwner(state)) { state.aiChatError = "Sign in as the house owner to use this workspace."; render(); return Promise.resolve(); }
    var routeProblem = aiRouteProblem();
    if (routeProblem) { state.aiChatError = routeProblem; render(); return Promise.resolve(); }
    var requestedRoute = aiRouteSupported() ? selectedAiRoute() : null;
    var reviewOf = opts.reviewOfTurnId || state.aiReviewOf;
    if (reviewOf && (!requestedRoute || requestedRoute.mode !== "node")) { state.aiChatError = "Choose a specific second worker for this review."; render(); return Promise.resolve(); }
    if (reviewOf && !aiDeclared(aiToolSchema(state.coreTools, "core.ai.turn.submit"), "review_of_turn_id")) { state.aiChatError = "This Core does not support review jobs yet."; render(); return Promise.resolve(); }
    /* The Core's word on images and the browser, read before anything is
       created or shown as sent: a turn it would strip is refused here, with
       the attachments kept so they can be removed. */
    var support = aiCoreWord();
    if (state.aiAttachments.length && !support.turnImages) {
      state.aiChatError = aiCapabilityOff("images", support) + " Remove the image to send this turn.";
      render();
      return Promise.resolve();
    }
    var inputMode = opts.inputMode === "voice" ? "voice" : "text";
    var attachments = state.aiAttachments.slice();
    var allowBrowser = state.aiAllowBrowser === true && support.turnBrowser;
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
      var accepted = false;
      /* The attachments and the switch belong to this turn: taken now, so a
         second send cannot carry them twice. A switch left on while the Core
         stopped declaring the flag sends nothing. */
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
          task_status: "submitting",
          images: aiAttachmentImages(attachments),
          allow_browser: allowBrowser,
          route: requestedRoute,
          review_of_turn_id: reviewOf || null
        },
        created_at: submittedAt
      };

      setAiRun(thread.id, { pending: true, task: { id: messageId, status: "submitting" }, progress: null, error: null, stopRequested: false, stopped: false });
      state.aiChatDraft = "";
      state.aiDrafts[thread.id] = "";
      state.aiAttachments = [];
      state.aiReviewOf = null;
      var messages = aiMessagesFor(thread.id);
      messages.push(optimistic);
      state.aiMessages[thread.id] = messages;
      if (thread.title === "New chat") thread.title = content.replace(/\s+/g, " ").slice(0, 80);
      thread.last_message_at = submittedAt;
      render();

      var submission = aiTurnSubmission({
        org_id: thread.org_id,
        thread_id: thread.id,
        message_id: messageId,
        content: content,
        input_mode: inputMode
      }, attachments, allowBrowser, support);
      if (requestedRoute) submission.route = requestedRoute;
      if (reviewOf) submission.review_of_turn_id = reviewOf;
      return callCoreTool("core.ai.turn.submit", submission).then(function (queued) {
        if (!queued || !queued.turn_id) throw new Error("McCluster did not return a durable turn id");
        accepted = true;
        optimistic.metadata.task_status = queued.job_status || "queued";
        setAiRun(thread.id, { task: { id: queued.turn_id, status: queued.job_status || "queued", job_type: "resident_ai_turn" } });
        render();
        return waitForResidentAiTurn(queued.turn_id, 880, thread.id);
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
        var canceled = error.turn && error.turn.status === "canceled";
        var stillCurrent = state.aiRuns[thread.id] && state.aiRuns[thread.id].task && state.aiRuns[thread.id].task.id === messageId;
        if (stillCurrent) setAiRun(thread.id, { error: canceled ? null : error.message || String(error) });
        if (stillCurrent && String(state.selectedAiThreadId) === String(thread.id)) state.aiChatError = canceled ? null : error.message || String(error);
        return sleep(1000).then(function () {
          return loadAiMessages(thread.id, true).catch(function () { return []; });
        }).then(function (rows) {
          /* An explicit submit failure must not leave an unsent optimistic
             message spinning forever. If the save did succeed before a lost
             response, the canonical row and turn recovery take precedence. */
          if (!accepted && stillCurrent && !rows.some(function (m) { return String(m.id) === messageId; })) {
            optimistic.metadata.task_status = "failed";
            aiMergeMessage(optimistic);
            setAiRun(thread.id, { pending: false, task: { id: messageId, status: "failed" }, progress: null });
          }
          keepPendingAfterRecovery = Boolean(state.aiRuns[thread.id] && state.aiRuns[thread.id].pending);
          return rows;
        });
      }).then(function () {
        if (!keepPendingAfterRecovery && state.aiRuns[thread.id] && state.aiRuns[thread.id].task && state.aiRuns[thread.id].task.id === messageId) {
          setAiRun(thread.id, { pending: false, progress: null });
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

  /* ROUTING. Every hash, new or old, resolves through NAV. A leaf's
     renderer ("work.inbox", "create.music", "home.ask"…) names the code that
     draws it; the surface/view pair below is that code's own state, kept so
     the existing renderers and loaders run unchanged. */
  function applyLeaf(entry) {
    var leaf = entry.leaf, r = leaf.renderer || "";
    var dot = r.indexOf("."), kind = dot >= 0 ? r.slice(0, dot) : r, view = dot >= 0 ? r.slice(dot + 1) : "";
    state.leaf = entry;
    state.route = leaf.route;
    state.section = entry.section.id;
    if (kind === "work") { state.surface = "work"; state.workView = view; }
    else if (kind === "create") { state.surface = "create"; state.createView = view; }
    else if (kind === "system") { state.surface = "system"; state.systemView = view; }
    else if (kind === "analytics") { state.surface = "analytics"; state.analyticsSection = view; }
    else if (r === "home.today") state.surface = "home";
    else if (r === "home.ask") state.surface = "ai";
    else if (r === "apps") state.surface = "apps";
    else state.surface = r.replace(/\./g, "-") || "slot";
  }
  function readHash() {
    var resolved = NAVI.resolve(location.hash || "#home");
    applyLeaf(resolved.entry);
    return resolved;
  }
  function routeHash() { return state.route; }
  function setHash(replace) {
    var next = routeHash();
    if (location.hash === next) return;
    if (replace && history.replaceState) history.replaceState(null, "", next); else location.hash = next;
  }
  /* Go to a NAV route (new or old spelling). */
  function go(hash, replace) {
    var entry = NAVI.resolve(hash).entry;
    var before = state.surface;
    applyLeaf(entry);
    if (before === "ai" && state.surface !== "ai") { stopAiVoiceListening(true); stopAiVoiceSpeech(); }
    state.selectedProjectId = null;
    closeInspector();
    closeMore();
    setHash(replace);
    render();
    try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); }
  }
  /* The old surface/view call sites keep working: they name an old route,
     and NAV says where it lives now. */
  function setSurface(surface, view, replace) {
    var old = surface === "work" || surface === "create" || surface === "system" ? "#" + surface + ":" + (view || "") : "#" + surface;
    go(old, replace);
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
  function renderHeader(title, subtitle) {
    return '<header class="cr-surface__head"><div><h1 class="cr-surface__title">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="cr-surface__subtitle">' + esc(subtitle) + '</p>' : "") + '</div></header>';
  }
  function kpi(label, value, sub) { return '<div class="cr-kpi"><div class="cr-kpi__label">' + esc(label) + '</div><div class="cr-kpi__value">' + esc(value) + '</div><div class="cr-kpi__sub">' + esc(sub || "") + '</div></div>'; }

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

  /* A fresh host health result in which Core found something wrong: its
     overall is "degraded" or "fail", and `health.degradation` names each
     finding (a reconcile cycle that failed at a stage, a ledger drift). The
     tile and Needs you both read this, so a finding is never left to the
     tile's text and the raw inspector alone. A stale result has its own
     notice; a healthy one has none. */
  function hostHealthProblem() {
    var h = state.aiHealth;
    if (!h || h.stale || (h.overall !== "degraded" && h.overall !== "fail")) return null;
    var found = h.health && Array.isArray(h.health.degradation) ? h.health.degradation : [];
    var named = found.filter(function (d) { return d && d.code; })
      .sort(function (a, b) { return (b.severity === "critical") - (a.severity === "critical"); })
      .map(function (d) {
        var stage = d.detail && (d.detail.stage || d.detail.last_cycle_stage);
        return d.code + (stage ? " (stage " + stage + ")" : "");
      });
    return {
      kind: h.overall === "fail" ? "bad" : "warn",
      title: "OVH host health is " + (h.overall === "fail" ? "failing" : "degraded"),
      sub: named.length
        ? named.slice(0, 3).join(" · ") + (named.length > 3 ? " · +" + (named.length - 3) + " more" : "")
        : "Core reports the host " + h.overall + " without naming a finding."
    };
  }

  function attentionItems() {
    var items = [];
    if (!state.sources.health || !state.sources.health.ok) items.push({ title: "Edge health unreachable", sub: "api.mccluster.org/health did not respond.", kind: "bad", action: "system-overview" });
    else if (!state.health || !state.health.ok) items.push({ title: "API reports unhealthy", sub: "The edge responded but did not report healthy.", kind: "bad", action: "system-overview" });
    if (state.status && state.status.database && !state.status.database.reachable) items.push({ title: "Database unavailable", sub: "Canonical Supabase reachability failed.", kind: "bad", action: "system-overview" });
    if (state.aiHealth && state.aiHealth.stale) items.push({ title: "Host health is stale", sub: "Core has not recorded a fresh host health result.", kind: "warn", action: "system-workload" });
    var hostProblem = hostHealthProblem();
    if (hostProblem) items.push({ title: hostProblem.title, sub: hostProblem.sub, kind: hostProblem.kind, action: "system-overview" });
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

    /* Retained errors from the owner-gated event stream (System ·
       Observability). Absent for a non-owner, whose read is refused. */
    if (state.recentErrors && state.recentErrors.count) {
      var latestError = state.recentErrors.latest || {};
      items.push({ title: state.recentErrors.count + (state.recentErrors.more ? "+" : "") + " error log " + (state.recentErrors.count === 1 ? "entry" : "entries") + " in the last 24 hours", sub: "Not an incident count. Latest: " + text(latestError.event_name || latestError.route, "event") + " · " + ago(latestError.occurred_at || latestError.created_at), kind: "bad", action: "observe-errors" });
    }
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


  // Shows what the resident turn checked on the web so grounded evidence
  // remains inspectable even if the local model omits inline citations.
  function aiResearchHtml(message) {
    var research = message.metadata && message.metadata.current_research;
    if (!research || !research.attempted) return "";
    var sources = (Array.isArray(research.sources) ? research.sources : []).filter(function (source) {
      return source && /^https?:\/\//i.test(String(source.url || ""));
    });
    if (!research.ok || !sources.length) {
      return '<div class="cr-ai-research cr-ai-research--none">' +
        esc(research.ok ? "Checked the web · no results · answer may be out of date" : "Web check failed · answer may be out of date") + '</div>';
    }
    var when = research.fetched_at ? " · " + ago(research.fetched_at) : "";
    return '<details class="cr-ai-research"><summary>Checked the web · ' + sources.length + " source" + (sources.length === 1 ? "" : "s") + esc(when) + '</summary><ol>' +
      sources.map(function (source) {
        return '<li><a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(source.title || source.url) + '</a></li>';
      }).join("") + '</ol></details>';
  }

  /* AI ATTACHMENTS, VISION AND BROWSER TURNS (device-node slice N2,
     docs/control-plane/AGENT-NODE-BROWSER.md). Pure helpers first: the image
     budget and the request shapes, the owner-only switch rule, and the
     renderers for user images, screenshots, the action log, the node badge,
     live steps and refusals. scripts/test/control-ai-browser.test.mjs runs
     this block as it stands. The Core validates every image again from its
     bytes and gates the browser independently of the switch; this page only
     sends the flag the owner set. */
  var AI_IMAGE_MAX = 2;
  var AI_IMAGE_MAX_BYTES = 200000;
  var AI_IMAGE_MAX_SIDE = 1280;
  var AI_IMAGE_QUALITIES = [0.6, 0.45, 0.3];
  var AI_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
  var AI_LOG_MAX = 100;
  var AI_ERROR_COPY = {
    LOCAL_AI_NO_VISION_NODE: "No vision node is live",
    AI_CHAT_NO_VISION_NODE: "No vision node is live",
    BROWSER_UNAVAILABLE: "Browser unavailable on the node",
    BROWSER_NOT_ALLOWED: "Browser not allowed for this turn",
    BROWSER_OWNER_REQUIRED: "Browser turns are owner-only",
    BROWSER_POLICY_EMPTY: "No allowed sites yet",
    BROWSER_HOST_NOT_ALLOWED: "That site is not on the node's allowlist",
    BROWSER_PRIVATE_ADDRESS: "That address is private and was refused",
    BROWSER_TASK_TIMEOUT: "The browser task ran out of time",
    BROWSER_BUSY: "The node's browser is busy"
  };
  function aiImageScale(width, height) {
    var w = Math.max(1, Math.round(Number(width) || 1)), hgt = Math.max(1, Math.round(Number(height) || 1));
    var longest = Math.max(w, hgt);
    if (longest <= AI_IMAGE_MAX_SIDE) return { width: w, height: hgt };
    var factor = AI_IMAGE_MAX_SIDE / longest;
    return { width: Math.max(1, Math.round(w * factor)), height: Math.max(1, Math.round(hgt * factor)) };
  }
  function aiImageBudget(attachments, incoming) {
    var have = Array.isArray(attachments) ? attachments.length : 0;
    var more = Number(incoming) || 0;
    if (more <= 0) return { ok: false, reason: "Choose an image to attach." };
    if (have + more > AI_IMAGE_MAX) return { ok: false, reason: "At most " + AI_IMAGE_MAX + " images per turn (" + have + " attached already)." };
    return { ok: true, reason: "" };
  }
  function aiImageAccepted(bytes) { var n = Number(bytes); return n > 0 && n <= AI_IMAGE_MAX_BYTES; }
  function aiBase64FromDataUrl(value) { var str = String(value || ""); var at = str.indexOf(","); return str.indexOf("data:") === 0 && at >= 0 ? str.slice(at + 1) : str; }
  function aiBase64Bytes(b64) { var str = String(b64 || ""); if (!str) return 0; var pad = /==$/.test(str) ? 2 : (/=$/.test(str) ? 1 : 0); return Math.floor(str.length * 3 / 4) - pad; }
  function aiBase64Valid(b64) { var str = String(b64 || ""); return str.length > 0 && str.length % 4 === 0 && AI_BASE64.test(str); }
  function aiAttachmentImages(attachments) {
    return (Array.isArray(attachments) ? attachments : []).map(function (a) { return a && a.base64; }).filter(aiBase64Valid);
  }
  /* WHAT THE RUNNING CORE HONOURS, in its own words (deploy-readiness review,
     2026-11-18). A field counts only when the Core's tools/list, the list this
     page already reads through the owner's bridge, declares it in that tool's
     input schema: images and allow_browser on core.ai.turn.submit,
     messages[].images on ai.chat. The Core on OVH at build eb942248 declares
     none of them; it would drop a turn's images and the browser flag in
     silence and hand an image to a text model, so against it the controls stay
     off and one honest line says so. browser.act is agent-only and never
     listed over MCP (AGENT-NODE-BROWSER.md), so the durable turn's
     allow_browser is the Core's word that it honours the browser; whether a
     browser node is live stays the readiness line's job. No backend call: the
     tool list is already in hand.
     A tool list that could not be read (the bridge did not answer, a refused
     read, nothing read yet) is not a Core that declares nothing: the controls
     stay off, and the line says the page does not know, never that the Core
     refuses (review LDR-F3, 2026-11-18). */
  var AI_CAPABILITY_OFF = {
    images: "Attach image is off: the Core running now does not accept images in a turn.",
    browser: "Use the browser is off: the Core running now does not honour browser turns."
  };
  var AI_CAPABILITY_WHY = {
    images: "Its tool list declares no images field on core.ai.turn.submit; attach comes back once the running Core declares one.",
    browser: "Its tool list declares no allow_browser field on core.ai.turn.submit; the switch comes back once the running Core declares one."
  };
  var AI_CAPABILITY_UNKNOWN = {
    images: "Attach image is off: the Core's tool list has not been read, so whether it accepts images is not known.",
    browser: "Use the browser is off: the Core's tool list has not been read, so whether it honours browser turns is not known."
  };
  var AI_CAPABILITY_UNKNOWN_WHY = {
    images: "Attach comes back once the Core's tool list is read and declares an images field on core.ai.turn.submit.",
    browser: "The switch comes back once the Core's tool list is read and declares an allow_browser field on core.ai.turn.submit."
  };
  function aiToolSchema(tools, name) {
    var list = Array.isArray(tools) ? tools : [];
    for (var i = 0; i < list.length; i += 1) {
      var tool = list[i];
      if (tool && tool.name === name) return tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : null;
    }
    return null;
  }
  function aiDeclared(schema, key) {
    var props = schema && schema.properties && typeof schema.properties === "object" ? schema.properties : null;
    return Boolean(props && Object.prototype.hasOwnProperty.call(props, key) && props[key] && typeof props[key] === "object");
  }
  /* `listed` is whether the tool list was read at all (its source result is
     ok); without it nothing is declared and nothing is known. */
  function aiCoreSupport(tools, listed) {
    if (listed !== true) return { known: false, turnImages: false, turnBrowser: false, chatImages: false };
    var turn = aiToolSchema(tools, "core.ai.turn.submit");
    var chat = aiToolSchema(tools, "ai.chat");
    var messages = chat && chat.properties && chat.properties.messages;
    var item = messages && typeof messages === "object" && messages.items && typeof messages.items === "object" ? messages.items : null;
    return { known: true, turnImages: aiDeclared(turn, "images"), turnBrowser: aiDeclared(turn, "allow_browser"), chatImages: aiDeclared(item, "images") };
  }
  /* the line in place of a control that is off: the Core's own word when its
     tool list was read, and "not known" when it was not */
  function aiCapabilityOff(kind, support) {
    return (support && support.known ? AI_CAPABILITY_OFF : AI_CAPABILITY_UNKNOWN)[kind];
  }
  function aiCapabilityLine(kind, support) {
    var known = Boolean(support && support.known);
    return '<p class="cr-ai-capability" data-ai-capability="' + esc(kind) + '" data-ai-capability-basis="' + (known ? "declared" : "unknown") + '" title="' +
      esc((known ? AI_CAPABILITY_WHY : AI_CAPABILITY_UNKNOWN_WHY)[kind]) + '">' + esc(aiCapabilityOff(kind, support)) + '</p>';
  }
  /* The durable turn: the fields every Core knows, plus images and
     allow_browser only when set and only to a Core that declares them. A
     field that Core does not declare is refused here, before anything is
     sent or shown as sent, never dropped in silence. */
  function aiTurnSubmission(base, attachments, allowBrowser, support) {
    var submission = Object.assign({}, base);
    var images = aiAttachmentImages(attachments);
    if (images.length && !(support && support.turnImages)) throw new Error(aiCapabilityOff("images", support) + " Remove the image to send this turn.");
    if (allowBrowser === true && !(support && support.turnBrowser)) throw new Error(aiCapabilityOff("browser", support));
    if (images.length) submission.images = images;
    if (allowBrowser === true) submission.allow_browser = true;
    return submission;
  }
  /* "Ask home AI" (ai.chat): the prompt form, or the messages form when an
     image rides along (Ollama reads messages[].images), and only to an
     ai.chat that declares messages[].images: anything else would hand the
     image to whatever text model the fabric picks. */
  function aiChatRequest(text, attachments, chatImages) {
    var images = aiAttachmentImages(attachments);
    if (!images.length) return { prompt: text, temperature: 0.2 };
    if (chatImages !== true) throw new Error("Ask home AI takes no image here: the Core running now sends ai.chat to a text model.");
    return { messages: [{ role: "user", content: text, images: images }], temperature: 0.2 };
  }
  /* The switch renders for the owner of the house workspace, and only when the
     running Core declares allow_browser; the server decides again on every
     turn. The owner is told why when it is off; nobody else hears of it. */
  function aiBrowserOwner(st) {
    return Boolean(st && st.workspace && st.workspace.role === "owner" && isHouseWorkspace(st.org));
  }
  function aiBrowserSwitchVisible(st, support) {
    return aiBrowserOwner(st) && Boolean(support && support.turnBrowser);
  }
  function aiErrorCopy(code) {
    var key = String(code || "");
    if (!key) return "";
    return AI_ERROR_COPY[key] || key.replace(/_/g, " ").toLowerCase();
  }
  function aiErrorHtml(message) {
    var meta = (message && message.metadata) || {};
    if (!meta.error_code) return "";
    return '<div class="cr-ai-refused"><b>' + esc(aiErrorCopy(meta.error_code)) + '</b> <code>' + esc(meta.error_code) + '</code></div>';
  }
  function aiHostOf(url) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ""));
    return m ? m[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "").toLowerCase() : "";
  }
  function aiKb(bytes) {
    var n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    return n >= 1024 ? (Math.round(n / 102.4) / 10) + " KB" : n + " B";
  }
  function aiRate(node) {
    var live = Number(node && node.generation_tokens_per_second);
    if (Number.isFinite(live) && live > 0) return " · " + (Math.round(live * 10) / 10) + " tok/s";
    var measured = Number(node && node.measured_generation_tokens_per_second);
    if (Number.isFinite(measured) && measured > 0) return " · " + (Math.round(measured * 10) / 10) + " tok/s (measured)";
    return "";
  }
  /* Which node answered: name, hardware mode (or route) and the rate the
     task measured, from the assistant message's metadata.node. */
  function aiNodeBadgeHtml(message) {
    var node = message && message.metadata && message.metadata.node;
    if (!node || typeof node !== "object" || !(node.node_name || node.node_id)) return "";
    var where = node.hardware_mode || node.route || "node";
    var title = [node.site, node.implementation, node.model, node.node_id].filter(Boolean).join(" · ");
    return '<span class="cr-ai-node" title="' + esc(title) + '">' + esc(node.node_name || node.node_id) + ' · ' + esc(where) + esc(aiRate(node)) + '</span>';
  }
  function aiStepText(step) {
    return [step.index, step.type, step.outcome].filter(function (v) { return v !== null && v !== undefined && v !== ""; }).join(" ");
  }
  /* The browser turn's record on the assistant message: a collapsed block
     with the tasks, the last screenshots (bounded, inline) and the action
     log. Only valid base64 reaches an <img>; a data: prefix never does. */
  function aiBrowserHtml(message) {
    var browser = message && message.metadata && message.metadata.browser;
    if (!browser || typeof browser !== "object") return "";
    var tasks = Array.isArray(browser.tasks) ? browser.tasks : [];
    var shots = (Array.isArray(browser.screenshots) ? browser.screenshots : []).filter(function (shot) { return shot && aiBase64Valid(shot.base64); });
    var log = Array.isArray(browser.action_log) ? browser.action_log : [];
    if (!tasks.length && !shots.length && !log.length) return "";
    var steps = 0, hosts = [];
    tasks.forEach(function (task) {
      steps += Array.isArray(task && task.steps) ? task.steps.length : 0;
      var host = aiHostOf(task && task.page && task.page.url);
      if (host && hosts.indexOf(host) < 0) hosts.push(host);
    });
    var summary = "Browser: " + steps + " step" + (steps === 1 ? "" : "s") + (hosts.length ? " on " + hosts.join(", ") : "");
    var taskLines = tasks.map(function (task) {
      var page = task.page || {};
      var count = Array.isArray(task.steps) ? task.steps.length : 0;
      return '<div class="cr-ai-browser__task' + (task.ok === false ? " is-bad" : "") + '">' + esc([task.task_id || "task", task.ok === false ? "refused or failed" : "ok", count + " step" + (count === 1 ? "" : "s"), page.title || aiHostOf(page.url), task.node_id].filter(Boolean).join(" · ")) + '</div>';
    }).join("");
    var figures = shots.map(function (shot) {
      var size = shot.width && shot.height ? shot.width + "×" + shot.height : "";
      return '<figure><img src="data:image/jpeg;base64,' + shot.base64 + '" alt="Screenshot from the node browser, step ' + esc(shot.step) + '"><figcaption>' + esc([shot.task_id, "step " + shot.step, size, aiKb(shot.bytes)].filter(Boolean).join(" · ")) + '</figcaption></figure>';
    }).join("");
    var shown = log.slice(0, AI_LOG_MAX);
    var logLines = shown.map(function (entry) {
      var bad = entry && (entry.outcome === "refused" || entry.outcome === "failed");
      return '<li' + (bad ? ' class="is-bad"' : "") + '>' + esc([entry.index, entry.type, entry.host, entry.outcome, entry.code].filter(function (v) { return v !== null && v !== undefined && v !== ""; }).join(" ")) + '</li>';
    }).join("");
    var more = log.length > shown.length ? '<p class="cr-muted">' + esc(log.length - shown.length) + ' more entries in the Core record.</p>' : "";
    var droppedCount = Number(browser.dropped_screenshots) || 0;
    var dropped = droppedCount > 0 ? '<p class="cr-muted">' + esc(droppedCount) + ' older screenshot' + (droppedCount === 1 ? "" : "s") + ' dropped to keep the message small.</p>' : "";
    return '<details class="cr-ai-browser"><summary>' + esc(summary) + '</summary>' + taskLines + figures + dropped +
      (logLines ? '<ol class="cr-ai-browser__log">' + logLines + '</ol>' + more : "") + '</details>';
  }
  function aiUserImagesHtml(message) {
    var images = message && message.metadata && Array.isArray(message.metadata.images) ? message.metadata.images.filter(aiBase64Valid) : [];
    if (!images.length) return "";
    return '<div class="cr-ai-message__images">' + images.map(function (b64, i) {
      return '<img src="data:image/jpeg;base64,' + b64 + '" alt="Attached image ' + (i + 1) + '">';
    }).join("") + '</div>';
  }
  /* Live steps while the turn runs: the Core checkpoints browser_act receipts
     into the user message's metadata.tool_receipts after every call. */
  function aiReceiptStepsHtml(userMessage) {
    var receipts = userMessage && userMessage.metadata && Array.isArray(userMessage.metadata.tool_receipts) ? userMessage.metadata.tool_receipts : [];
    var browser = receipts.filter(function (receipt) { return receipt && receipt.tool === "browser_act"; });
    if (!browser.length) return "";
    return '<div class="cr-ai-steps">' + browser.map(function (receipt) {
      var steps = Array.isArray(receipt.steps) ? receipt.steps : [];
      var head = ["browser_act", receipt.task_id || "task", steps.length + " step" + (steps.length === 1 ? "" : "s"), aiHostOf(receipt.page && receipt.page.url) || (receipt.page && receipt.page.title) || ""].filter(Boolean).join(" · ") + (receipt.ok === false ? " · refused or failed" : "");
      var lines = steps.map(function (step) {
        var bad = step.outcome === "refused" || step.outcome === "failed";
        return '<span' + (bad ? ' class="is-bad"' : "") + '>' + esc(aiStepText(step)) + (step.code ? " · " + esc(aiErrorCopy(step.code)) : "") + '</span>';
      }).join("");
      return '<div><b>' + esc(head) + '</b>' + lines + '</div>';
    }).join("") + '</div>';
  }
  /* What the page can honestly say about the browser: browser.act is not
     listed over MCP, so the only evidence is the last browser turn. */
  function aiBrowserReadiness(messages) {
    var list = Array.isArray(messages) ? messages : [];
    for (var i = list.length - 1; i >= 0; i -= 1) {
      var m = list[i];
      if (!m || m.role !== "assistant") continue;
      var meta = m.metadata || {};
      if (meta.error_code && /^BROWSER_/.test(String(meta.error_code))) return { state: "unavailable", text: "browser: " + aiErrorCopy(meta.error_code) + " (" + ago(m.created_at) + " ago)" };
      var tasks = meta.browser && Array.isArray(meta.browser.tasks) ? meta.browser.tasks : [];
      if (tasks.length) return { state: "ready", text: "browser: ready on " + ((meta.node && meta.node.node_name) || tasks[0].node_id || "a node") + " (last browser turn " + ago(m.created_at) + " ago)" };
    }
    return { state: "unknown", text: "browser: unknown until the first browser turn (the node advertises it to the Core, not to this page)" };
  }
  /* END AI ATTACHMENTS */

  /* The browser-side half: reading the chosen files, downscaling on a canvas
     and encoding JPEG down the quality ladder until the Core's cap holds. */
  function aiReadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file is not an image this browser can read: " + (file.name || "image"))); };
      img.src = url;
    });
  }
  function aiEncodeImage(img) {
    var size = aiImageScale(img.naturalWidth || img.width, img.naturalHeight || img.height);
    var canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size.width, size.height);
    for (var i = 0; i < AI_IMAGE_QUALITIES.length; i += 1) {
      var dataUrl = canvas.toDataURL("image/jpeg", AI_IMAGE_QUALITIES[i]);
      var b64 = aiBase64FromDataUrl(dataUrl);
      var bytes = aiBase64Bytes(b64);
      if (aiImageAccepted(bytes) && aiBase64Valid(b64)) return { base64: b64, bytes: bytes, width: size.width, height: size.height, quality: AI_IMAGE_QUALITIES[i], preview: dataUrl };
    }
    return null;
  }
  function addAiAttachments(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve();
    var budget = aiImageBudget(state.aiAttachments, list.length);
    if (!budget.ok) { state.aiChatError = budget.reason; render(); return Promise.resolve(); }
    state.aiChatError = null;
    return list.reduce(function (chain, file) {
      return chain.then(function () {
        return aiReadImageFile(file).then(function (img) {
          var encoded = aiEncodeImage(img);
          if (!encoded) throw new Error("Image is too large after downscaling (" + (file.name || "image") + "): it stays above " + Math.round(AI_IMAGE_MAX_BYTES / 1000) + " KB at the lowest JPEG quality.");
          encoded.name = file.name || "";
          state.aiAttachments.push(encoded);
        });
      });
    }, Promise.resolve()).catch(function (error) {
      state.aiChatError = error.message || String(error);
    }).then(function () { render(); });
  }
  /* A message the Core hands back mid-turn (the user message with its
     receipts) replaces the optimistic one in place so live steps render. */
  function aiMergeMessage(message) {
    if (!message || !message.id || !message.thread_id) return;
    var list = state.aiMessages[message.thread_id];
    if (!Array.isArray(list)) return;
    var idx = list.findIndex(function (m) { return String(m.id) === String(message.id); });
    if (idx >= 0) list[idx] = message; else list.push(message);
  }

  function loadOwnerDevices(force) {
    if (!aiBrowserOwner(state) || !coreToolAvailable("core.compute.devices.list") || state.pending.aiDevices || (!force && state.aiDevicesLoaded)) return Promise.resolve();
    state.pending.aiDevices = true;
    loadAiInstaller();
    var snapshot = authoritySnapshot();
    return Promise.all([
      callCoreTool("core.compute.devices.list", { org_id: state.org.id }),
      coreToolAvailable("core.compute.pairs.list") ? callCoreTool("core.compute.pairs.list", { org_id: state.org.id }).catch(function (error) { return { pairs: [], error: error.message || "Pair readiness could not be read." }; }) : Promise.resolve({ pairs: [] })
    ]).then(function (values) {
      if (!authorityHolds(snapshot)) return;
      state.aiDevices = Array.isArray(values[0].devices) ? values[0].devices : [];
      state.aiEnrollments = Array.isArray(values[0].enrollments) ? values[0].enrollments : [];
      state.aiEnrollmentAvailable = values[0].enrollment_available === true;
      state.aiPairs = Array.isArray(values[1].pairs) ? values[1].pairs : [];
      state.aiPairError = values[1].error || null;
      state.aiDeviceError = null;
    }).catch(function (error) {
      if (authorityHolds(snapshot)) state.aiDeviceError = error.message || "Devices could not be read. Try Refresh devices.";
    }).then(function () {
      if (!authorityHolds(snapshot)) return;
      state.aiDevicesLoaded = true; delete state.pending.aiDevices; render();
      if (state.surface === "ai" && state.aiPanel === "devices") {
        clearTimeout(state.pending.aiDeviceTimer);
        state.pending.aiDeviceTimer = setTimeout(function () {
          if (authorityHolds(snapshot) && state.surface === "ai" && state.aiPanel === "devices") loadOwnerDevices(true);
        }, 5000);
      }
    });
  }
  function loadAiInstaller() {
    if (state.aiInstallerLoaded || state.pending.aiInstaller) return;
    state.pending.aiInstaller = true;
    var snapshot = authoritySnapshot();
    /* Public package metadata, never enrollment material. A missing package
       keeps the reviewed-checkout instructions visible instead of a dead link. */
    fetch("downloads/mccluster-macos-worker.manifest.json", { cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer" }).then(function (response) {
      if (!response.ok) throw new Error("Mac package unavailable");
      return response.json();
    }).then(function (manifest) {
      if (!authorityHolds(snapshot)) return;
      if (manifest.schema !== "mccluster-macos-worker-package/1" || manifest.filename !== "mccluster-macos-worker.zip" || manifest.archive_root !== "mccluster-macos-worker" || !/^[a-f0-9]{64}$/.test(manifest.sha256 || "") || manifest.credential_input !== "hidden-terminal-stdin") throw new Error("Mac package manifest unverified");
      state.aiInstaller = { sha256: manifest.sha256, bytes: manifest.bytes, physical_mac_verified: manifest.physical_mac_verified === true };
    }).catch(function () { if (authorityHolds(snapshot)) state.aiInstaller = null; }).then(function () {
      if (!authorityHolds(snapshot)) return;
      state.aiInstallerLoaded = true; delete state.pending.aiInstaller;
      if (state.surface === "ai" && state.aiPanel === "devices") render();
    });
  }
  function aiCopyText(value, button) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) { state.aiDeviceNotice = "Clipboard is unavailable here. Select and copy the displayed text."; render(); return; }
    navigator.clipboard.writeText(String(value || "")).then(function () {
      if (button && button.isConnected) button.textContent = "Copied";
    }).catch(function () { state.aiDeviceNotice = "Clipboard access was refused. Select and copy the displayed text."; render(); });
  }
  function aiSetupDownload() {
    if (!state.aiEnrollment || !state.aiEnrollment.setup) return;
    /* A fixed allowlist prevents any future credential field from entering the file. */
    var source = state.aiEnrollment.setup, setup = {};
    ["org_id", "compute_url", "enrollment_id", "display_name", "platform", "implementation", "model", "context", "max_leases"].forEach(function (key) { if (source[key] !== undefined) setup[key] = source[key]; });
    var blob = new Blob([JSON.stringify(setup, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "mccluster-device-setup.json"; anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function issueAiEnrollment(enrollmentId) {
    if (state.pending.aiDeviceMutation || !aiBrowserOwner(state)) return;
    var snapshot = authoritySnapshot();
    var nameInput = $("crAiDeviceName"), name = nameInput && nameInput.value.trim();
    var existing = state.aiEnrollments.find(function (e) { return String(e.enrollment_id || e.id) === String(enrollmentId); });
    if (existing) name = existing.display_name;
    if (!name) { state.aiDeviceError = "Give this Mac a name so you can recognize it in chat."; render(); return; }
    var args = { org_id: state.org.id, display_name: name, platform: "darwin" };
    if (enrollmentId) args.enrollment_id = enrollmentId;
    state.pending.aiDeviceMutation = true; state.aiDeviceError = null; state.aiEnrollment = null; render();
    return callCoreTool("core.compute.enrollment.create", args).then(function (result) {
      if (!authorityHolds(snapshot)) return;
      if (!result.credential || !result.enrollment_id || !result.setup || !Number.isFinite(Date.parse(result.expires_at))) throw new Error("Core did not return a complete enrollment. Try again.");
      state.aiEnrollment = result; state.aiEnrollmentReveal = false; state.aiAddDeviceOpen = true;
      var id = result.enrollment_id;
      setTimeout(function () {
        if (authorityHolds(snapshot) && state.aiEnrollment && state.aiEnrollment.enrollment_id === id && Date.parse(state.aiEnrollment.expires_at) <= Date.now()) {
          state.aiEnrollment.credential = null; state.aiEnrollmentReveal = false; render();
        }
      }, Math.max(0, Date.parse(result.expires_at) - Date.now()) + 50);
      return loadOwnerDevices(true);
    }).catch(function (error) { if (authorityHolds(snapshot)) state.aiDeviceError = error.message || "Enrollment could not be created."; }).then(function () { if (authorityHolds(snapshot)) { delete state.pending.aiDeviceMutation; render(); } });
  }
  function mutateAiDevice(nodeId, action) {
    if (state.pending.aiDeviceMutation || !aiBrowserOwner(state)) return;
    var args = { org_id: state.org.id, node_id: nodeId, action: action };
    if (action === "rename") { args.display_name = $("crAiRename") && $("crAiRename").value.trim(); if (!args.display_name) return; }
    state.pending.aiDeviceMutation = true; state.aiDeviceError = null; render();
    callCoreTool("core.compute.device.update", args).then(function (result) {
      state.aiRenameId = null; state.aiRevokeId = null;
      state.aiDeviceNotice = action === "revoke" ? "Device revoked. New leases are blocked. " + (result.in_flight_policy || "Active work follows the existing lease rules.") : (action === "rename" ? "Device renamed." : action === "pause" ? "Device paused. It will not take new work." : "Device resumed. Waiting for a healthy heartbeat.");
      return loadOwnerDevices(true);
    }).catch(function (error) { state.aiDeviceError = error.message || "Device action failed."; }).then(function () { delete state.pending.aiDeviceMutation; render(); });
  }
  function testAiDevice(nodeId) {
    if (state.pending.aiDeviceMutation) return;
    state.pending.aiDeviceMutation = true; state.aiDeviceError = null; render();
    callCoreTool("core.compute.device.test", { org_id: state.org.id, node_id: nodeId }).then(function (result) {
      state.aiDeviceNotice = "Test queued on this device. Its status will update when the real job finishes.";
      return loadOwnerDevices(true);
    }).catch(function (error) { state.aiDeviceError = error.message || "The device test could not start."; }).then(function () { delete state.pending.aiDeviceMutation; render(); });
  }
  function createAiPair() {
    if (state.pending.aiDeviceMutation) return;
    var first = $("crAiPairFirst") && $("crAiPairFirst").value, second = $("crAiPairSecond") && $("crAiPairSecond").value;
    var name = $("crAiPairName") && $("crAiPairName").value.trim();
    if (!first || !second || first === second || !name) { state.aiDeviceError = "Name the pair and choose two different enrolled Macs."; render(); return; }
    state.pending.aiDeviceMutation = true; state.aiDeviceError = null; render();
    callCoreTool("core.compute.pair.create", { org_id: state.org.id, name: name, node_ids: [first, second] }).then(function () {
      state.aiCreatePairOpen = false;
      state.aiDeviceNotice = "Pair created. Deep Reasoning stays unavailable until a supported local runtime passes the shared-model benchmark.";
      return loadOwnerDevices(true);
    }).catch(function (error) { state.aiDeviceError = error.message || "The pair could not be created."; }).then(function () { delete state.pending.aiDeviceMutation; render(); });
  }
  function benchmarkAiPair(pairId) {
    if (state.pending.aiDeviceMutation) return;
    state.pending.aiDeviceMutation = true; state.aiDeviceError = null; render();
    callCoreTool("core.compute.pair.benchmark", { org_id: state.org.id, pair_id: pairId }).then(function (result) {
      state.aiDeviceNotice = result.queued ? "Shared-model benchmark queued. Both Macs must be available on the local network." : "No benchmark was queued. Check the pair's readiness details.";
      return loadOwnerDevices(true);
    }).catch(function (error) { state.aiDeviceError = error.message || "A supported distributed runtime is not ready on these Macs."; }).then(function () { delete state.pending.aiDeviceMutation; render(); });
  }
  function renderAiDevices() {
    var ae = OWNER_AI.esc, busy = state.pending.aiDeviceMutation ? " disabled" : "";
    var available = coreToolAvailable("core.compute.devices.list");
    if (!available) return '<section class="cr-ai-devices"><h2>Devices</h2><p class="cr-ai-capability">Device management is unavailable on the running Core. The owner device tools must be deployed before setup can begin.</p></section>';
    var enrollment = state.aiEnrollment;
    if (enrollment && Date.parse(enrollment.expires_at) <= Date.now()) enrollment.credential = null;
    var add = "";
    if (state.aiAddDeviceOpen) {
      if (!enrollment) add = '<section class="cr-ai-setup"><h3>Add a Mac</h3><p>Use this Mac, or start here and finish on another Mac. The worker runs only after you explicitly install it. Wi-Fi is enough.</p><label>Device name<input id="crAiDeviceName" class="cr-input" data-ai-preserve autocomplete="off" maxlength="80" placeholder="Studio iMac"></label><button class="cr-btn cr-btn--primary" type="button" data-action="ai-enroll"' + busy + '>Create setup</button><p class="cr-muted">Starting on your laptop? Create setup now, then sign in to this workspace on the target Mac and choose Finish setup below.</p></section>';
      else {
        var command = 'node ' + (state.aiInstaller ? 'mccluster-macos-worker/' : '') + 'core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json';
        var packageStep = state.aiInstaller ? '<p>Download and unzip the reviewed worker package on this Mac. Install Node 20 or newer and Ollama, then run <code>ollama pull qwen3:8b</code>. Keep Ollama local.</p><a class="cr-btn" href="downloads/mccluster-macos-worker.zip" download>Download Mac worker</a><details class="cr-ai-receipt"><summary>Package checksum</summary><span>SHA-256 ' + ae(state.aiInstaller.sha256) + '</span></details>' + (state.aiInstaller.physical_mac_verified ? '' : '<p class="cr-muted">Installer tests pass in the test environment. Installation on a physical Mac still needs verification.</p>') : '<p>The downloadable package is unavailable on this deployment. Use the reviewed McCluster worker checkout. Install Node 20 or newer and Ollama, then run <code>ollama pull qwen3:8b</code>. Keep Ollama local.</p>';
        add = '<section class="cr-ai-setup" aria-label="Mac setup"><div class="cr-ai-sectionhead"><h3>Set up ' + ae(enrollment.display_name) + '</h3><button class="cr-ai-textbtn" type="button" data-action="ai-forget-enrollment">Close setup</button></div><ol class="cr-ai-setup__steps"><li><b>On the target Mac</b>' + packageStep + '</li><li><b>Save the setup file beside the worker folder</b><p>This file contains the coordinator address and device settings. It contains no credential.</p><button class="cr-btn" type="button" data-action="ai-download-setup">Download setup file</button></li><li><b>Install the worker</b><pre class="cr-ai-setup__command"><code id="crAiSetupCommand">' + ae(command) + '</code></pre><button class="cr-btn" type="button" data-action="ai-copy-setup-command">Copy setup command</button></li><li><b>Paste the credential only at the installer’s private prompt</b><p>Single use · expires ' + ae(formatDate(enrollment.expires_at)) + '. It must never go into a command or address bar.</p>' +
          (enrollment.credential ? '<div class="cr-ai-credential"><input id="crAiCredential" type="' + (state.aiEnrollmentReveal ? "text" : "password") + '" value="' + ae(enrollment.credential) + '" readonly autocomplete="off" spellcheck="false" aria-label="Single-use enrollment credential"><button class="cr-btn" type="button" data-action="ai-reveal-credential">' + (state.aiEnrollmentReveal ? "Hide" : "Reveal") + '</button><button class="cr-btn" type="button" data-action="ai-copy-credential">Copy credential</button></div>' : '<p class="cr-ai-capability">Credential expired or cleared. Choose Finish setup to issue a new one.</p>') +
          '</li></ol><p class="cr-muted">One active job · Qwen3 8B · 4K test context. The installer creates and protects this Mac’s own signing key. Open this workspace on the Mac to finish there; no credential is carried in the link.</p></section>';
      }
    }
    var cards = state.aiDevices.map(function (device) {
      var id = OWNER_AI.deviceId(device), s = OWNER_AI.deviceState(device), canUse = s !== "revoked" && s !== "offline";
      var memory = Number(device.memory_bytes) > 0 ? Math.round(Number(device.memory_bytes) / 1073741824) + " GB" : "Memory not reported";
      var details = [device.platform || "Platform not reported", device.arch, memory, (Number(device.active_jobs) || 0) + " active job" + (Number(device.active_jobs) === 1 ? "" : "s")].filter(Boolean).join(" · ");
      var rename = state.aiRenameId === id ? '<div class="cr-ai-inlineform"><label>Device name<input id="crAiRename" class="cr-input" data-ai-preserve maxlength="80" value="' + ae(OWNER_AI.deviceName(device)) + '"></label><button class="cr-btn" type="button" data-action="ai-device-save-name" data-id="' + ae(id) + '"' + busy + '>Save name</button></div>' : "";
      var revoke = state.aiRevokeId === id ? '<div class="cr-ai-revoke"><p>Revoke ' + ae(OWNER_AI.deviceName(device)) + '? New leases stop immediately. Active work follows the existing lease rules. Returning this device requires a fresh enrollment.</p><button class="cr-btn cr-btn--danger" type="button" data-action="ai-device-confirm-revoke" data-id="' + ae(id) + '"' + busy + '>Revoke device</button> <button class="cr-btn" type="button" data-action="ai-device-cancel-revoke">Keep device</button></div>' : "";
      var models = (device.models || []).map(function (m) { return ae(m.model || m.implementation) + (m.ready ? " · ready" : " · not ready"); }).join(", ");
      var cleanup = device.cleanup_required ? '<details class="cr-ai-receipt"><summary>Local model cleanup is required</summary><p>On this Mac, use its paired-runtime checkout and existing private configuration. The repair verifies an idle runtime and sends a signed receipt; then click Resume here.</p>' + (OWNER_AI.cleanupCommand(device) ? '<pre class="cr-ai-setup__command"><code>' + ae(OWNER_AI.cleanupCommand(device)) + '</code></pre><button class="cr-btn" type="button" data-action="ai-copy-cleanup" data-id="' + ae(id) + '">Copy local repair command</button>' : '<p>The coordinator has not supplied a cleanup reservation. Refresh devices before repairing.</p>') + '</details>' : '';
      return '<article class="cr-ai-device" data-ai-device="' + ae(id) + '"><div class="cr-ai-sectionhead"><h3>' + ae(OWNER_AI.deviceName(device)) + '</h3><span class="cr-ai-state cr-ai-state--' + ae(s) + '">' + ae(OWNER_AI.stateLabel(device)) + '</span></div><p class="cr-ai-device__spec">' + ae(details) + '</p><p>' + ae(OWNER_AI.recovery(device)) + '</p><p class="cr-ai-device__models">' + (models || "No model reported yet") + '</p><small>Last seen ' + ae(ago(device.last_seen_at)) + '</small>' +
        (device.test && device.test.status && device.test.status !== "done" ? '<p class="cr-ai-device__test">Device test: ' + ae(device.test.status) + '</p>' : "") + cleanup + rename + revoke +
        '<div class="cr-ai-device__actions"><button class="cr-btn" type="button" data-action="ai-device-rename" data-id="' + ae(id) + '"' + busy + '>Rename</button>' +
        (s !== "revoked" ? '<button class="cr-btn" type="button" data-action="ai-device-' + (s === "paused" ? "resume" : "pause") + '" data-id="' + ae(id) + '"' + (busy || s === 'paused' && device.resume_available === false ? ' disabled' : '') + '>' + (s === "paused" ? "Resume" : "Pause") + '</button><button class="cr-btn" type="button" data-action="ai-device-test" data-id="' + ae(id) + '"' + (busy || !canUse || s === "paused" ? " disabled" : "") + '>Test device</button><button class="cr-ai-textbtn" type="button" data-action="ai-device-revoke" data-id="' + ae(id) + '"' + busy + '>Revoke</button>' : "") + '</div></article>';
    }).join("");
    var pending = state.aiEnrollments.map(function (item) {
      return '<article class="cr-ai-device cr-ai-device--pending"><div class="cr-ai-sectionhead"><h3>' + ae(item.display_name || "New Mac") + '</h3><span class="cr-ai-state">Pending</span></div><p>' + ae(item.recovery || "Sign in on the target Mac to finish installing its worker.") + '</p><small>' + (item.expired ? "Previous credential expired" : "Credential expires " + ae(formatDate(item.expires_at))) + '</small><button class="cr-btn" type="button" data-action="ai-finish-enrollment" data-id="' + ae(item.enrollment_id || item.id) + '"' + busy + '>Finish setup</button></article>';
    }).join("");
    var macs = state.aiDevices.filter(function (d) { return d.platform === "darwin" && d.state !== "revoked"; });
    var macOptions = '<option value="">Choose a Mac</option>' + macs.map(function (d) { return '<option value="' + ae(OWNER_AI.deviceId(d)) + '">' + ae(OWNER_AI.deviceName(d)) + '</option>'; }).join("");
    var pairForm = state.aiCreatePairOpen ? '<div class="cr-ai-setup"><h3>Create a pair</h3><label>Pair name<input id="crAiPairName" class="cr-input" data-ai-preserve maxlength="80" placeholder="Studio pair"></label><div class="cr-ai-formrow"><label>First Mac<select id="crAiPairFirst" class="cr-select" data-ai-preserve>' + macOptions + '</select></label><label>Second Mac<select id="crAiPairSecond" class="cr-select" data-ai-preserve>' + macOptions + '</select></label></div><p>Creating a pair does not combine memory by itself. A supported distributed runtime must see both Macs locally and pass a shared-model test.</p><button class="cr-btn cr-btn--primary" type="button" data-action="ai-pair-save"' + busy + '>Create pair</button></div>' : "";
    var pairCards = state.aiPairs.map(function (pair) {
      var ready = pair.ready === true, benchmark = pair.benchmark || {};
      var pairLabel = ready ? "Ready" : ({ testing: "Testing", reserved: "Reserved", draining: "Waiting for current jobs", running: "Running", cleanup: "Freeing model memory" })[pair.state] || "Unavailable";
      var peaks = (benchmark.devices || []).map(function (measured) { var named = state.aiDevices.find(function (device) { return OWNER_AI.deviceId(device) === measured.node_id; }); return '<li>' + ae(named ? OWNER_AI.deviceName(named) : measured.node_id) + ': peak ' + ae(measured.peak_memory_bytes != null ? (Number(measured.peak_memory_bytes) / 1073741824).toFixed(2) + ' GB' : 'not reported') + '</li>'; }).join('');
      return '<article class="cr-ai-device"><div class="cr-ai-sectionhead"><h3>' + ae(pair.name || "Mac pair") + '</h3><span class="cr-ai-state' + (ready ? ' cr-ai-state--test_passed' : '') + '">' + ae(pairLabel) + '</span></div><p>' + ae(pair.unavailable_reason || pair.reason || pair.recovery || (ready ? "Shared-model benchmark passed. Both workers are reserved together for Deep Reasoning." : "Exact hardware and model setup is unverified. Install a supported runtime on both Macs, then run the benchmark.")) + '</p><p class="cr-ai-device__spec">' + ae(benchmark.model_id || pair.model_id || "Qwen3.5 27B · MLX 4-bit candidate") + '</p>' +
        (benchmark.model_revision ? '<p class="cr-ai-device__spec">Model revision: ' + ae(benchmark.model_revision) + '</p>' : '') +
        (benchmark.time_to_first_token_ms != null ? '<p>First token ' + ae(benchmark.time_to_first_token_ms) + ' ms · ' + ae(benchmark.output_tokens_per_second || "not reported") + ' tok/s</p>' + (peaks ? '<ul class="cr-ai-device__metrics">' + peaks + '</ul>' : '<p class="cr-muted">Per-device peak memory not reported.</p>') + (benchmark.runtime ? '<p class="cr-ai-device__spec">' + ae([benchmark.runtime.name, benchmark.runtime.version, benchmark.runtime.commit].filter(Boolean).join(' · ')) + '</p>' : '') : '<p class="cr-muted">No real-device performance measurements yet.</p>') +
        '<button class="cr-btn" type="button" data-action="ai-pair-benchmark" data-id="' + ae(pair.id || pair.pair_id) + '"' + (busy || !coreToolAvailable("core.compute.pair.benchmark") ? " disabled" : "") + '>Run shared-model benchmark</button></article>';
    }).join("");
    return '<section class="cr-ai-devices"><div class="cr-ai-sectionhead"><div><h2>Your workers</h2><p>McCluster Core on OVH coordinates the queue. Each device connects outward; Ollama stays local.</p></div><button class="cr-btn cr-btn--primary" type="button" data-action="ai-add-device"' + (busy || !state.aiEnrollmentAvailable ? " disabled" : "") + '>Add this device</button><button class="cr-btn" type="button" data-action="ai-refresh-devices"' + (state.pending.aiDevices ? " disabled" : "") + '>Refresh devices</button></div>' +
      (state.aiDeviceError ? '<p class="cr-fail" role="alert">' + ae(state.aiDeviceError) + '</p>' : '') + (state.aiDeviceNotice ? '<p class="cr-ai-notice" role="status">' + ae(state.aiDeviceNotice) + '</p>' : '') +
      (!state.aiEnrollmentAvailable ? '<p class="cr-ai-capability">Enrollment is unavailable on this Core. Its enrollment service must be configured before a worker can be added.</p>' : '') + add +
      '<div class="cr-ai-devicegrid">' + cards + pending + (!cards && !pending ? '<div class="cr-ai-blank"><h3>' + (state.pending.aiDevices ? "Reading devices…" : "Add your first worker") + '</h3><p>A browser session is your remote control. Install the worker explicitly on each Mac that should do the work.</p></div>' : '') + '</div>' +
      '<section class="cr-ai-pairs"><div class="cr-ai-sectionhead"><div><h2>Deep Reasoning pairs</h2><p>Two enrolled Macs, one verified shared-model runtime. Model traffic stays on their local network.</p></div><button class="cr-btn" type="button" data-action="ai-pair-create"' + (busy || macs.length < 2 || !coreToolAvailable("core.compute.pair.create") ? " disabled" : "") + '>Create pair</button></div>' + (state.aiPairError ? '<p class="cr-ai-capability">Pair readiness unavailable: ' + ae(state.aiPairError) + '</p>' : '') + pairForm +
      '<div class="cr-ai-devicegrid">' + (pairCards || '<div class="cr-ai-blank"><h3>Not verified on your Macs yet</h3><p>Start with two independent Qwen3 8B workers. A pair becomes ready only after local discovery, memory checks and a shared-model benchmark pass. A 27B model is a candidate, not a fit guarantee.</p></div>') + '</div></section></section>';
  }

  function renderAiRuns() {
    var ae = OWNER_AI.esc, rows = [];
    Object.keys(state.aiMessages).forEach(function (threadId) {
      var messages = state.aiMessages[threadId] || [], thread = aiThreadById(threadId);
      messages.filter(function (m) { return m.role === "user" && m.metadata && m.metadata.agent_job_id; }).forEach(function (m) {
        var id = m.metadata.agent_job_id;
        var reply = messages.find(function (a) { return a.role === "assistant" && a.metadata && a.metadata.agent_job_id === id; });
        var run = state.aiRuns[threadId], task = run && run.task && run.task.id === id ? run.task : null;
        var status = task && task.status || m.metadata.task_status || (reply ? "done" : "unknown");
        rows.push({ threadId: threadId, title: thread && thread.title || "Conversation", when: m.created_at, status: status, prompt: m.content, receipt: reply ? OWNER_AI.receipt(reply) : null });
      });
    });
    rows.sort(function (a, b) { return new Date(b.when || 0) - new Date(a.when || 0); });
    return '<section class="cr-ai-runs"><h2>Run history</h2><p>Saved runs from the conversations you have opened. Open an older conversation to load its runs.</p>' + (rows.length ? rows.map(function (run) {
      return '<article class="cr-ai-run"><div class="cr-ai-sectionhead"><button type="button" class="cr-ai-textbtn" data-action="ai-select-thread" data-id="' + ae(run.threadId) + '">' + ae(run.title) + '</button><span class="cr-ai-state">' + ae(run.status === "canceled" ? "Stopped" : titleCase(run.status)) + '</span></div><p>' + ae(String(run.prompt || "").slice(0, 180)) + '</p><small>' + ae(ago(run.when)) + (run.receipt ? ' · ' + ae(run.receipt.label) : ' · Device not yet reported') + '</small>' + (run.receipt && run.receipt.fallback ? '<p class="cr-ai-fallback">Fallback: ' + ae(run.receipt.fallback) + '</p>' : '') + '</article>';
    }).join("") : '<div class="cr-ai-blank"><h3>Your work will appear here</h3><p>Each accepted message is saved with its durable run. Returning to a conversation reconnects to its progress.</p></div>') + '</section>';
  }

  function renderAi() {
    if (!OWNER_AI) return empty("AI workspace unavailable", "Reload the page to load the workspace controls.");
    if (!aiBrowserOwner(state)) return '<section class="cr-ai-owner-gate"><h2>Owner AI workspace</h2><p>Sign in as the McCluster house owner to chat with your models and manage your devices.</p><p>The server verifies this access on every request.</p></section>';
    var ae = OWNER_AI.esc;
    if (!state.selectedAiThreadId && state.aiThreads.length) state.selectedAiThreadId = state.aiThreads[0].id;
    syncSelectedAiRun();
    var selected = aiThreadById(state.selectedAiThreadId), messages = selected ? aiMessagesFor(selected.id) : [];
    var messageError = selected && state.pending["aiMessages:" + selected.id + ":error"];
    var ready = coreToolAvailable("core.ai.turn.submit") && coreToolAvailable("core.ai.turn.get");
    var support = aiCoreWord();
    var voiceCaps = aiVoiceCapabilities(), run = selectedAiRun(), problem = aiRouteProblem();
    var runningCount = Object.keys(state.aiRuns).filter(function (id) { return state.aiRuns[id].pending; }).length;
    var workspaceHead = '<header class="cr-ai-workspace__head"><div><span class="cr-ai-eyebrow">Equity Upreneurs · owner workspace</span><h1>McCluster AI</h1><p>Think, build, and review with your own workers.</p></div><div class="cr-ai-workspace__state"><span class="cr-ai-state' + (ready ? ' cr-ai-state--connected' : '') + '">' + (ready ? 'Core connected' : 'Core unavailable') + '</span>' + (runningCount ? '<span>' + runningCount + ' active run' + (runningCount === 1 ? '' : 's') + '</span>' : '') + '</div></header>';
    var tabs = '<div class="cr-ai-localnav" aria-label="AI workspace views">' + [["chat", "Chat"], ["devices", "Devices"], ["runs", "Run history"]].map(function (item) {
      return '<button class="cr-ai-localnav__tab' + (state.aiPanel === item[0] ? ' is-on' : '') + '" type="button" data-action="ai-panel" data-panel="' + item[0] + '" aria-pressed="' + (state.aiPanel === item[0]) + '">' + item[1] + '</button>';
    }).join("") + '</div>';
    var banners = sourceBanner(state.sources.coreBridge, "Core bridge") + sourceBanner(state.sources.coreTools, "AI execution path") + sourceBanner(state.sources.aiThreads, "AI conversations");
    if (state.aiPanel === "devices") return '<div class="cr-ai-workspace">' + workspaceHead + tabs + banners + renderAiDevices() + '</div>';
    if (state.aiPanel === "runs") return '<div class="cr-ai-workspace">' + workspaceHead + tabs + banners + renderAiRuns() + '</div>';

    var threads = state.aiThreads.length ? state.aiThreads.map(function (thread) {
      var active = state.aiRuns[thread.id] && state.aiRuns[thread.id].pending;
      var search = [thread.title || "", (state.aiMessages[thread.id] || []).map(function (m) { return m.content || ""; }).join(" ")].join(" ").toLowerCase();
      var hidden = state.aiHistorySearch && search.indexOf(state.aiHistorySearch.toLowerCase()) < 0;
      return '<button class="cr-ai-thread' + (selected && String(selected.id) === String(thread.id) ? " is-on" : "") + '" type="button" data-action="ai-select-thread" data-id="' + ae(thread.id) + '" data-ai-history-search="' + ae(search.slice(0, 6000)) + '"' + (hidden ? ' hidden' : '') + '><b>' + ae(thread.title || "New chat") + '</b><small>' + (active ? '<span class="cr-ai-running-dot"></span> Working · ' : '') + ae(ago(thread.last_message_at || thread.updated_at || thread.created_at)) + '</small></button>';
    }).join("") : '<p class="cr-muted">No conversations yet.</p>';
    var body;
    if (selected && state.pending["aiMessages:" + selected.id] && !messages.length) body = '<div class="cr-ai-chat__empty"><strong>Opening your conversation…</strong><span>Restoring saved messages and run status.</span></div>';
    else if (!messages.length) body = '<div class="cr-ai-chat__empty"><img class="cr-ai-empty-mark" src="assets/img/equity-uprise-mark-white.png" alt=""><span class="cr-ai-eyebrow">One workspace, wherever you are</span><strong>What are we working on?</strong><span>Choose a model and a worker, or let Auto find an available machine. Your accepted work continues when you close this window.</span><div class="cr-ai-starters"><button class="cr-btn" type="button" data-action="ai-starter" data-prompt="Help me plan the next steps for my project.">Plan a project</button><button class="cr-btn" type="button" data-action="ai-starter" data-prompt="Help me work through this problem step by step.">Work through a problem</button></div></div>';
    else body = messages.map(function (message) {
      var mine = message.role === "user", meta = message.metadata || {}, receipt = OWNER_AI.receipt(message);
      var label = mine ? "You" : message.role === "assistant" ? "McCluster AI" : titleCase(message.role);
      var status = mine && ["failed", "canceled"].indexOf(meta.task_status) >= 0 ? ' · ' + (meta.task_status === 'canceled' ? 'Stopped' : 'Failed') : '';
      var speak = !mine && voiceCaps.synthesis ? '<button class="cr-ai-textbtn" type="button" data-action="ai-speak-message" data-id="' + ae(message.id) + '" aria-label="Speak this McCluster AI reply">Speak</button>' : '';
      var controls = !mine ? '<div class="cr-ai-message__actions"><button class="cr-ai-textbtn" type="button" data-action="ai-copy-message" data-id="' + ae(message.id) + '">Copy</button>' + speak + '<button class="cr-ai-textbtn" type="button" data-action="ai-retry" data-id="' + ae(message.id) + '"' + (state.aiChatPending ? ' disabled' : '') + '>Retry</button>' + (receipt.turn_id && aiDeclared(aiToolSchema(state.coreTools, "core.ai.turn.submit"), "review_of_turn_id") ? '<button class="cr-ai-textbtn" type="button" data-action="ai-review" data-id="' + ae(message.id) + '"' + (state.aiChatPending ? ' disabled' : '') + '>Review on another worker</button>' : '') + '</div>' : (status ? '<button class="cr-ai-textbtn" type="button" data-action="ai-retry" data-id="' + ae(message.id) + '"' + (state.aiChatPending ? ' disabled' : '') + '>Retry with current selection</button>' : '');
      var runReceipt = !mine ? '<details class="cr-ai-receipt"><summary>' + ae(receipt.label) + '</summary>' + (receipt.turn_id ? '<span>Run ' + ae(receipt.turn_id) + '</span>' : '<span>This older reply has no durable run receipt.</span>') + (receipt.node_id ? '<span>Worker ' + ae(receipt.node_id) + '</span>' : '') + '</details>' + (receipt.fallback ? '<p class="cr-ai-fallback">Fallback: ' + ae(receipt.fallback) + '</p>' : '') : '';
      return '<article class="cr-ai-message cr-ai-message--' + (mine ? "user" : "assistant") + '" data-ai-message="' + ae(message.id) + '"><div class="cr-ai-message__meta"><span>' + ae(label) + '</span><span>' + ae(ago(message.created_at) + status) + '</span>' + (mine ? '' : aiNodeBadgeHtml(message)) + '</div>' + (mine ? aiUserImagesHtml(message) : '') + '<div class="cr-ai-message__body' + (mine ? '' : ' cr-ai-markdown') + '">' + (mine ? ae(message.content || "") : OWNER_AI.markdown(message.content || "")) + '</div>' + (mine ? '' : aiErrorHtml(message) + aiResearchHtml(message) + aiBrowserHtml(message)) + runReceipt + controls + '</article>';
    }).join("");
    if (selected && state.aiMessagesHasMore[selected.id]) body = '<div class="cr-ai-earlier"><button class="cr-btn" type="button" data-action="ai-earlier-messages"' + (state.pending['aiEarlier:' + selected.id] || state.aiChatPending ? ' disabled' : '') + '>Load earlier messages</button></div>' + body;
    if (state.aiChatPending) {
      var progress = run && run.progress || {}, taskStatus = progress.status || state.aiChatTask && state.aiChatTask.status || "queued";
      var pendingCopy = taskStatus === "running" ? "Working on your request…" : taskStatus === "leased" ? "Worker reserved. Loading the model…" : taskStatus === "submitting" ? "Saving your message…" : "Queued. Your message is saved.";
      var lastUser = messages.filter(function (m) { return m.role === "user"; }).pop();
      body += '<article class="cr-ai-message cr-ai-message--assistant cr-ai-message--pending"><div class="cr-ai-message__meta" role="status"><span>McCluster AI</span><span>' + ae(taskStatus) + '</span>' + (progress.node ? '<span class="cr-ai-node">' + ae(OWNER_AI.nodeLabel(progress.node)) + '</span>' : '') + '</div><div class="cr-ai-message__body cr-ai-markdown" id="crAiProgress">' + (progress.content ? OWNER_AI.markdown(progress.content) : '<span class="cr-spin"></span> ' + ae(pendingCopy)) + '</div>' + (progress.fallback_reason ? '<p class="cr-ai-fallback">Fallback: ' + ae(progress.fallback_reason) + '</p>' : '') + aiReceiptStepsHtml(lastUser) + '</article>';
    }
    var modelOptions = [{ implementation: "qwen3.8b.local", model: "qwen3:8b" }];
    state.aiDevices.forEach(function (device) { (device.models || []).forEach(function (model) { if (model.implementation && !modelOptions.some(function (x) { return x.implementation === model.implementation; })) modelOptions.push(model); }); });
    var pairSelected = selectedAiRoute().mode === 'pair';
    if (pairSelected) modelOptions = [{ implementation: 'qwen3.5.27b.pair', model: 'Qwen3.5 27B · MLX 4-bit' }];
    var modelSelect = '<label class="cr-ai-picker"><span>Model</span><select id="crAiModel" aria-label="Model"' + (!aiRouteSupported() || state.aiChatPending || pairSelected ? ' disabled' : '') + '>' + modelOptions.map(function (model) { return '<option value="' + ae(model.implementation) + '"' + (state.aiImplementation === model.implementation || pairSelected ? ' selected' : '') + '>' + ae(model.model || model.implementation) + '</option>'; }).join("") + '</select></label>';
    var deviceOptions = '<option value="auto"' + (state.aiRouteSelection === 'auto' ? ' selected' : '') + '>Auto · healthy worker</option>' + state.aiDevices.map(function (device) { var value = 'node:' + OWNER_AI.deviceId(device); return '<option value="' + ae(value) + '"' + (state.aiRouteSelection === value ? ' selected' : '') + '>' + ae(OWNER_AI.deviceName(device)) + (device.eligible ? Number(device.active_jobs) > 0 ? ' · busy' : '' : ' · ' + ae(OWNER_AI.stateLabel(device))) + '</option>'; }).join("");
    deviceOptions += state.aiPairs.length ? state.aiPairs.map(function (pair) { var value = 'pair:' + (pair.id || pair.pair_id); return '<option value="' + ae(value) + '"' + (state.aiRouteSelection === value ? ' selected' : '') + '>Deep Reasoning · ' + ae(pair.name || 'Mac pair') + (pair.ready === true ? '' : ' · unavailable') + '</option>'; }).join("") : '<option disabled>Deep Reasoning · pair not verified</option>';
    var deviceSelect = '<label class="cr-ai-picker"><span>Run on</span><select id="crAiDevice" aria-label="Run on"' + (!aiRouteSupported() || state.aiChatPending ? ' disabled' : '') + '>' + deviceOptions + '</select></label>';
    var attachRow = (support.turnImages ? '<div class="cr-ai-attach"><button class="cr-btn cr-ai-attach__btn" type="button" data-action="ai-attach"' + (!ready || state.aiChatPending || state.aiAttachments.length >= AI_IMAGE_MAX ? ' disabled' : '') + '>Attach image</button><input id="crAiAttach" type="file" accept="image/*" multiple class="cr-ai-attach__input" aria-label="Attach up to two images" tabindex="-1"><span class="cr-ai-attach__hint" id="crAiAttachHint">' + state.aiAttachments.length + '/2 images · resized on this device</span></div>' : aiCapabilityLine('images', support)) +
      (state.aiAttachments.length ? '<div class="cr-ai-thumbs">' + state.aiAttachments.map(function (a, i) { return '<div class="cr-ai-thumb"><img src="' + ae(a.preview) + '" alt="' + ae(a.name || 'Attached image') + '"><button class="cr-ai-thumb__remove" type="button" data-action="ai-remove-attachment" data-index="' + i + '" aria-label="Remove image">×</button><span class="cr-ai-thumb__meta">' + ae((a.width && a.height ? a.width + '×' + a.height + ' · ' : '') + aiKb(a.bytes)) + '</span></div>'; }).join('') + '</div>' : '');
    var browserSwitch = '';
    if (aiBrowserSwitchVisible(state, support)) {
      var readiness = aiBrowserReadiness(messages);
      browserSwitch = '<div class="cr-ai-browser-switch"><span class="cr-ai-browser-switch__text"><b>Use the browser</b><span>' + (state.aiAllowBrowser ? 'Enabled for this turn on an allowed device.' : 'Off for this turn.') + '</span><span class="cr-ai-browser-switch__ready" data-ai-browser-ready="' + ae(readiness.state) + '">' + ae(readiness.text) + '</span></span><button class="cr-switch' + (state.aiAllowBrowser ? ' is-on' : '') + '" type="button" role="switch" aria-checked="' + state.aiAllowBrowser + '" aria-label="Use the browser for this turn" data-action="ai-browser-toggle"' + (!ready || state.aiChatPending ? ' disabled' : '') + '></button></div>';
    } else browserSwitch = aiCapabilityLine('browser', support);
    return '<div class="cr-ai-workspace">' + workspaceHead + tabs + banners + '<div class="cr-ai-chat"><details class="cr-ai-chat__sidebar" id="crAiHistory"' + (state.aiHistoryOpen ? ' open' : '') + '><summary>Conversations <span>' + state.aiThreads.length + '</span></summary><div class="cr-ai-chat__sidehead"><button class="cr-btn cr-btn--primary" type="button" data-action="ai-new-thread"' + (state.pending.aiThreadCreate ? ' disabled' : '') + '>+ New chat</button><label class="sr-only" for="crAiHistorySearch">Search loaded conversations</label><input id="crAiHistorySearch" class="cr-input" type="search" placeholder="Search loaded chats" value="' + ae(state.aiHistorySearch) + '"></div><div class="cr-ai-chat__threads">' + threads + '</div>' + (state.aiThreadHasMore ? '<button class="cr-ai-textbtn" type="button" data-action="ai-more-threads"' + (state.pending.aiMoreThreads ? ' disabled' : '') + '>Load earlier conversations</button>' : '') + '<div class="cr-ai-history__foot"><span>Search covers loaded titles and messages in opened chats.</span><a href="#create:projects" data-nav-route="#create:projects">Open projects</a><span>Linking projects to chats needs implementation.</span></div></details><section class="cr-ai-chat__main"><header class="cr-ai-chat__head"><div><b>' + ae(selected ? selected.title : 'New conversation') + '</b><p>' + (state.aiChatPending ? 'You can start another conversation while this job runs.' : 'Saved across devices through your owner account.') + '</p></div><button class="cr-ai-textbtn" type="button" data-action="ai-refresh-thread">Reconnect</button></header><div class="cr-ai-chat__messages" id="crAiMessages">' + (messageError ? sourceBanner(messageError, 'Conversation') : '') + body + '</div><footer class="cr-ai-chat__composer">' +
      (state.aiChatError ? '<p class="cr-fail" role="alert">' + ae(state.aiChatError) + '</p>' : '') + (state.aiVoiceError ? '<p class="cr-fail cr-ai-voice-error">' + ae(state.aiVoiceError) + '</p>' : '') +
      (state.aiReviewOf ? '<div class="cr-ai-notice">Reviewing a saved result. Choose a different worker below.<button class="cr-ai-textbtn" type="button" data-action="ai-cancel-review">Cancel review</button></div>' : '') +
      '<div class="cr-ai-routing">' + modelSelect + deviceSelect + '</div>' + (problem ? '<p class="cr-ai-route-error" role="status">' + ae(problem) + '</p>' : '') + (!aiRouteSupported() ? '<p class="cr-ai-capability">Device routing needs the updated Core. This deployment uses its existing automatic route.</p>' : '') +
      '<div class="cr-ai-chat__composerbox"><textarea class="cr-textarea" id="crAiComposer" rows="3" placeholder="Message McCluster…" aria-label="Message McCluster AI"' + (!ready || state.aiChatPending || state.aiVoiceListening ? ' disabled' : '') + '></textarea><div class="cr-ai-composer__actions"><details class="cr-ai-compose-tools" id="crAiComposeTools"><summary>Attachments &amp; tools</summary><div>' + attachRow + browserSwitch + '<p class="cr-muted">Document uploads and project knowledge need implementation. Images use a compatible vision model.</p></div></details><button class="cr-btn cr-btn--voice' + (state.aiVoiceListening ? ' is-listening' : '') + '" type="button" data-action="ai-voice-toggle"' + (!ready || state.aiChatPending || !voiceCaps.recognition ? ' disabled' : '') + ' aria-pressed="' + state.aiVoiceListening + '">' + (state.aiVoiceListening ? 'Stop mic' : 'Talk') + '</button>' +
      (state.aiChatPending ? '<button class="cr-btn cr-btn--danger" type="button" data-action="ai-stop"' + (!coreToolAvailable('core.ai.turn.stop') || !state.aiChatTask || state.aiChatTask.status === 'submitting' || run && run.stopRequested ? ' disabled' : '') + '>' + (run && run.stopRequested ? 'Stopping…' : 'Stop') + '</button>' : '<button class="cr-btn cr-btn--primary" type="button" data-action="ai-send"' + (!ready || state.aiVoiceListening || problem ? ' disabled' : '') + '>Send</button>') + '</div></div>' +
      (state.aiVoiceListening || state.aiVoiceSpeaking || state.aiVoiceTranscript ? '<div class="cr-ai-voice-status" role="status"><span>' + (state.aiVoiceListening ? 'Listening…' : state.aiVoiceSpeaking ? 'Speaking reply' : '') + '</span>' + (state.aiVoiceTranscript ? '<span>' + ae(state.aiVoiceTranscript) + '</span>' : '') + (state.aiVoiceSpeaking ? '<button class="cr-ai-textbtn" type="button" data-action="ai-stop-speaking">Stop voice</button>' : '') + '</div>' : '') +
      '<p class="cr-ai-chat__hint">Enter to send · Shift+Enter for a new line. Talk uses your browser’s speech service. Closing this page leaves accepted work running.</p></footer></section></div></div>';
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
      '<div class="cr-aireply"><span><b>AI reply</b> · ' + esc(owned ? "off: you have this thread. Turn it on and McCluster answers again." : "on: McCluster answers this thread. Turn it off to take it over.") +
      ' <a href="#people:inbox:ai-reply" data-nav-route="#people:inbox:ai-reply">AI reply settings</a></span>' +
      '<button class="cr-switch' + (owned ? "" : " is-on") + '" type="button" role="switch" aria-checked="' + (!owned) + '" aria-label="AI reply for this thread" data-action="thread-mode" data-id="' + esc(thread.id) + '" data-mode="' + (owned ? "release" : "takeover") + '"' + (switching ? " disabled" : "") + '></button></div>' +
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
    /* Leads belong to the active workspace. Leads with no org predate
       tenancy and are the house pipeline (workers/mccluster/src/leads.js),
       so only the house workspace includes them. */
    var orgId = state.org && state.org.id ? encodeURIComponent(state.org.id) : null;
    var orgClause = orgId ? (isHouseWorkspace(state.org) ? "or(org_id.eq." + orgId + ",org_id.is.null)" : "org_id.eq." + orgId) : null;
    var search = null;
    if (q) {
      /* PostgREST `or` with ilike. Commas and parens would break out of the
         filter group, so they are stripped rather than escaped. */
      var safe = q.replace(/[(),*]/g, " ").trim();
      if (safe) {
        search = "or(" + LEAD_SEARCH_COLUMNS.map(function (c) {
          return c + ".ilike.*" + encodeURIComponent(safe) + "*";
        }).join(",") + ")";
      }
    }
    var clauses = [orgClause, search].filter(Boolean);
    if (clauses.length) parts.push("and=(" + clauses.join(",") + ")");
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

  function renderWorkView(view) {
    if (view === "outreach" || view === "operations") {
      return window.CR.workTools ? window.CR.workTools.render(view) : empty("Work tool unavailable", "The native Control module did not load.");
    }
    if (view === "inbox") return renderWorkInbox();
    if (view === "desk-bot") {
      return derivedNote("The desk bot's back office: what it may say (the knowledge base), what it cost today, every message a platform refused, its channels and its tools. Each action is the inbox edge function, with your session.") +
        (window.CR.deskBot ? window.CR.deskBot.render() : empty("Desk bot unavailable", "The native Control module did not load."));
    }
    if (view === "pipeline") return renderPipeline();
    if (view === "people") return renderPeople();
    if (view === "companies") return renderCompanies();
    if (view === "clients") return renderClients();
    if (view === "tasks") return renderTasks();
    if (POST_SALE_NOTES[view]) {
      return derivedNote(POST_SALE_NOTES[view]) + (window.CR.work ? window.CR.work.section(view) : empty("Work records unavailable", "The native Control module did not load."));
    }
    return renderOrdersBookings(view);
  }
  /* The post-sale graph (workers/mccluster/src/work.js). Each is a stored,
     org-scoped record linked to the canonical company / person / order. */
  var POST_SALE_NOTES = {
    relationships: "A relationship links this workspace to a company, contact or lead (client, partner, sponsor, vendor…). It points at the canonical records; nothing is copied. History opens everything linked to it.",
    projects: "Post-sale service projects, linked to the company, relationship and the order they came from. History opens deliverables, payments, renewals, tasks and the audit trail.",
    deliverables: "What each project owes the client, where the artifact lives, and its approval. Approval is stamped with who and when. A client-facing approval portal is not built yet: approval here is the owner's.",
    payments: "McCluster's service-payment ledger. You record what was billed and received; every entry is labelled owner-recorded until a Stripe or Square reconciler verifies it. Product checkouts (prints, music, merch) keep their own payment truth in their order tables.",
    renewals: "Recurring obligations and the next commercial decision: hosting, management, retainers. A renewal can point at the site account, API subscription or offering it renews."
  };
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
          : "The asset query did not succeed, so this is not a statement that no assets exist.") + '</div>';
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
      : state.createView === "clipping"
        ? (window.CR.clipping ? window.CR.clipping.render() : empty("Clipping unavailable", "The native Control module did not load."))
      : state.createView === "action-network"
        ? (window.CR.actionNetwork ? window.CR.actionNetwork.render() : empty("Equity Uprise unavailable", "The native Control module did not load."))
      : state.createView === "funding"
        ? (window.CR.fundingIntelligence ? window.CR.fundingIntelligence.render() : empty("Funding Intelligence unavailable", "The module did not load."))
      : state.createView === "song-test"
        ? (window.CR.songTest ? window.CR.songTest.render() : empty("Song test unavailable", "The native Control module did not load."))
      : state.createView === "build"
        ? (window.CR.buildCode ? window.CR.buildCode.render() : empty("Build unavailable", "The native Control module did not load."))
      : state.createView === "front-page"
        ? (window.CR.frontPage ? window.CR.frontPage.render() : empty("Front page unavailable", "The native Control module did not load."))
        : renderSchedule();
    return body;
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
    var hostProblem = hostHealthProblem();
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
      { key: "host", title: "OVH host", sub: state.aiHealth && state.aiHealth.checked_at ? "Checked " + ago(state.aiHealth.checked_at) + " ago" : "No fresh host health", value: state.aiHealth && !state.aiHealth.stale ? titleCase(state.aiHealth.overall || "Healthy") : "Refresh", kind: !state.aiHealth || state.aiHealth.stale ? "warn" : hostProblem ? hostProblem.kind : "ok" },
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
    var summary = window.CR.systemSummary;
    var flow = summary ? summary.dependencies({api: state.health && state.health.ok, database: state.status && state.status.database && state.status.database.reachable, core: state.coreBridge && state.coreBridge.ok, at: state.refreshedAt}) : renderTopology();
    return sourceStates([["Workspace", state.sources.workspace], ["Edge health", state.sources.health], ["Core bridge", state.sources.coreBridge], ["Durable resume", state.sources.coreResume], ["Operator status", state.sources.status], ["Core", state.sources.ai], ["Host health", state.sources.aiHealth], ["Audit ledger", state.sources.audit]]) +
      '<div class="cr-kpis">' + kpi("API", state.health && state.health.ok ? "UP" : "—", "edge") + kpi("Database", state.status && state.status.database && state.status.database.reachable ? "UP" : "—", "truth") + kpi("Jobs", String(state.jobs.filter(function (x) { return ["queued", "running"].indexOf(x.status) >= 0; }).length), "active") + kpi("Failures", String(state.jobs.filter(function (x) { return x.status === "failed"; }).length), "workload") + '</div>' +
      '<div class="cr-grid">' + panel("Service dependencies", "select a service to inspect", '<div class="cr-panel__body">' + flow + '</div>', "cr-span-7") +
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
  /* RETAINED OBSERVABILITY. One canonical, owner-gated event contract
     (GET /v1/observability/events) carries Worker requests, domain events
     (audited mutations, paid media, AI decisions, publishing) and Core job,
     capability and resident-AI events. A trace or a record opens as a
     timeline; the canonical failure and audit ledger below stays as context
     and links into the same traces. */
  function observabilityQuery(extra) {
    var q = "org_id=" + encodeURIComponent(state.org.id);
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null && extra[k] !== "") q += "&" + k + "=" + encodeURIComponent(extra[k]);
    });
    return "/v1/observability/events?" + q;
  }
  function loadObservability(force, older) {
    if (state.pending.observability) return Promise.resolve();
    if (state.observability && !force && !older) return Promise.resolve();
    if (!state.org || !state.org.id) return Promise.resolve();
    var f = state.observabilityFilters;
    var cursor = older && state.observability && state.observability.ok && state.observability.data ? state.observability.data.next_cursor : null;
    if (older && !cursor) return Promise.resolve();
    state.pending.observability = true;
    render();
    return src(request(observabilityQuery({
      limit: 100,
      since: new Date(Date.now() - f.window * 60 * 60 * 1000).toISOString(),
      level: f.level === "all" ? "" : f.level,
      event_kind: f.kind === "all" ? "" : f.kind,
      cursor: cursor
    }))).then(function (result) {
      if (older && result.ok && state.observability && state.observability.ok) {
        var merged = pickRows(state.observability, "events").concat(pickRows(result, "events"));
        result.data = Object.assign({}, result.data, { events: merged });
      }
      state.observability = result;
      delete state.pending.observability;
      render();
    });
  }
  function loadRecentErrors() {
    state.recentErrors = null;
    if (!state.org || !state.org.id) return Promise.resolve();
    return src(request(observabilityQuery({ level: "error", limit: 50, since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }))).then(function (result) {
      if (!result.ok) return;
      var events = pickRows(result, "events");
      state.recentErrors = { count: events.length, more: Boolean(result.data && result.data.has_more), latest: events[0] || null };
      render();
    });
  }
  function retainedObservabilityEvents() {
    return state.observability && state.observability.ok ? pickRows(state.observability, "events") : [];
  }
  function obsLabel(e) {
    if (e.event_kind === "request" || (!e.event_name && e.method)) return [e.method, e.route].filter(Boolean).join(" ");
    return e.event_name || e.route || "event";
  }
  function obsOutcome(e) {
    if (e.status_code !== null && e.status_code !== undefined) return String(e.status_code) + (e.outcome && e.outcome !== "ok" ? " · " + e.outcome : "");
    return e.outcome || "—";
  }
  function obsKind(e) { return e.level === "error" ? "bad" : (e.level === "warn" ? "warn" : "info"); }
  function obsRows(events) {
    return events.map(function (e) {
      return {
        id: e.id, action: "inspect-observation", time: e.occurred_at || e.created_at,
        level: String(e.level || "info").toUpperCase(), kind: obsKind(e), label: obsLabel(e),
        source: [e.source || "worker", e.event_kind].filter(Boolean).join(" · "),
        outcome: obsOutcome(e), duration: e.duration_ms == null ? "—" : e.duration_ms + " ms",
        resource: e.resource_type ? e.resource_type + (e.resource_id ? " " + String(e.resource_id).slice(0, 8) : "") : "—",
        trace: e.trace_id ? String(e.trace_id).slice(0, 8) : "—"
      };
    });
  }
  var OBS_COLUMNS = [
    { label: "Time", html: function (r) { return esc(ago(r.time)); } },
    { label: "Level", html: function (r) { return '<span class="' + stateClass(r.kind) + '">' + esc(r.level) + '</span>'; } },
    { label: "Event", key: "label" },
    { label: "Source", key: "source" },
    { label: "Outcome", key: "outcome" },
    { label: "Duration", key: "duration" },
    { label: "Record", key: "resource" },
    { label: "Trace", key: "trace" }
  ];
  /* A trace button: by trace id, or by the record the events are about. */
  function traceButton(target, label) {
    if (!target) return "";
    if (target.trace_id) return '<button class="cr-btn cr-btn--ghost" type="button" data-action="observe-trace" data-trace="' + esc(target.trace_id) + '">' + esc(label || "Open trace") + '</button>';
    if (target.resource_type && target.resource_id) return '<button class="cr-btn cr-btn--ghost" type="button" data-action="observe-resource" data-resource-type="' + esc(target.resource_type) + '" data-resource-id="' + esc(target.resource_id) + '">' + esc(label || "Events for this record") + '</button>';
    return "";
  }
  function openTrace(target, title) {
    if (!state.org || !state.org.id || !target) return Promise.resolve();
    var query = target.trace_id ? { trace_id: target.trace_id } : { resource_type: target.resource_type, resource_id: target.resource_id };
    state.observabilityTrace = { target: target, title: title || (target.trace_id ? "Trace " + String(target.trace_id).slice(0, 8) : target.resource_type + " " + String(target.resource_id).slice(0, 8)), loading: true, result: null };
    closeInspector();
    setSurface("system", "observability");
    return src(request(observabilityQuery(Object.assign({ limit: 200 }, query)))).then(function (result) {
      if (!state.observabilityTrace || state.observabilityTrace.target !== target) return;
      state.observabilityTrace.loading = false;
      state.observabilityTrace.result = result;
      render();
    });
  }
  function renderTracePanel() {
    var t = state.observabilityTrace; if (!t) return "";
    var head = '<div class="cr-observe-head"><div><strong>' + esc(t.title) + '</strong><span class="cr-live-dot">' +
      (t.target.trace_id ? "every event sharing this trace" : "every event about this record") + '</span></div>' +
      '<button class="cr-btn cr-btn--ghost" type="button" data-action="close-trace">Close</button></div>';
    if (t.loading) return head + '<div class="cr-canvas">' + empty("Reading trace", "Loading retained events for this trace.") + '</div>';
    if (!t.result || !t.result.ok) return head + sourceBanner(t.result, "Trace");
    var events = pickRows(t.result, "events").slice().sort(function (a, b) {
      return new Date(a.occurred_at || a.created_at) - new Date(b.occurred_at || b.created_at) || Number(a.id) - Number(b.id);
    });
    if (!events.length) return head + '<div class="cr-canvas">' + empty("No retained events", "Nothing in the retention window carries this " + (t.target.trace_id ? "trace" : "record") + ". Info events are kept 14 days, warnings and errors 90.") + '</div>';
    var first = new Date(events[0].occurred_at || events[0].created_at).getTime();
    var timeline = '<div class="cr-trace cr-trace--obs">' + events.map(function (e) {
      var offset = Math.max(0, new Date(e.occurred_at || e.created_at).getTime() - first);
      var cls = e.level === "error" ? "is-bad" : (e.level === "warn" ? "is-live" : "is-done");
      return '<div class="' + cls + '" data-action="inspect-trace-event" data-id="' + esc(e.id) + '" tabindex="0">' +
        '<b>' + esc(obsLabel(e)) + '</b><span>+' + esc(String(offset)) + ' ms · ' + esc([e.source || "worker", obsOutcome(e), e.duration_ms == null ? "" : e.duration_ms + " ms"].filter(Boolean).join(" · ")) + '</span>' +
        (e.message && e.event_kind !== "request" ? '<span>' + esc(String(e.message).slice(0, 160)) + '</span>' : "") + '</div>';
    }).join("") + '</div>';
    return head + timeline;
  }
  function renderObservability() {
    var f = state.observabilityFilters;
    var retained = retainedObservabilityEvents();
    var q = f.q.trim().toLowerCase();
    if (q) retained = retained.filter(function (e) {
      return [e.event_name, e.route, e.message, e.trace_id, e.request_id, e.resource_type, e.resource_id, e.source].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    var fallback = observedEvents();
    var data = state.observability && state.observability.ok ? state.observability.data || {} : {};
    var head = '<div class="cr-observe-head"><div><strong>Events</strong><span class="cr-live-dot">retained · last ' + esc(f.window >= 24 ? (f.window / 24) + "d" : f.window + "h") + '</span></div>' +
      '<button class="cr-btn cr-btn--ghost" type="button" data-action="load-observability"' + (state.pending.observability ? " disabled" : "") + '>' + (state.pending.observability ? "Reading…" : "Re-read") + '</button></div>';
    var controls = '<div class="cr-gen cr-observe-filters">' +
      '<select class="cr-select" id="crObsLevel" aria-label="Level">' + [["all", "All levels"], ["info", "Info"], ["warn", "Warn"], ["error", "Error"]].map(function (o) { return '<option value="' + o[0] + '"' + (f.level === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select>' +
      '<select class="cr-select" id="crObsKind" aria-label="Kind">' + [["all", "All kinds"], ["request", "Requests"], ["domain", "Changes"], ["job", "Jobs"], ["dependency", "Providers"], ["capability", "Capabilities"], ["scheduled", "Scheduled"]].map(function (o) { return '<option value="' + o[0] + '"' + (f.kind === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select>' +
      '<select class="cr-select" id="crObsWindow" aria-label="Window">' + [[1, "1 hour"], [24, "24 hours"], [168, "7 days"], [720, "30 days"]].map(function (o) { return '<option value="' + o[0] + '"' + (f.window === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select>' +
      '<input class="cr-input" id="crObsSearch" type="search" placeholder="Event, route, trace or record" value="' + esc(f.q) + '">' +
      '</div>';

    var retainedBody;
    if (state.pending.observability && !state.observability) {
      retainedBody = '<div class="cr-canvas">' + empty("Reading retained events", "Loading the owner-gated observability tail.") + '</div>';
    } else if (state.observability && !state.observability.ok) {
      retainedBody = sourceBanner(state.observability, "Observability events");
    } else if (!retained.length) {
      retainedBody = '<div class="cr-canvas">' + empty("No retained events", "Nothing matches in this window. Fast successful reads are not retained; mutations, failures, slow reads, provider calls and Core work are.") + '</div>';
    } else {
      retainedBody = renderTable(OBS_COLUMNS, obsRows(retained), "No retained events") +
        (data.has_more ? '<div class="cr-panel__body"><button class="cr-btn cr-btn--ghost" type="button" data-action="observability-older"' + (state.pending.observability ? " disabled" : "") + '>Load older</button></div>' : "");
    }

    var fallbackBody = fallback.length
      ? renderTable([
          { label: "Time", html: function (r) { return esc(ago(r.time)); } },
          { label: "Severity", html: function (r) { return '<span class="' + stateClass(r.kind) + '">' + esc(r.severity) + '</span>'; } },
          { label: "Source", key: "source" },
          { label: "Message", key: "message" }
        ], fallback, "No canonical context events")
      : '<p class="cr-panel__body cr-muted">No failed canonical jobs and no recent privileged audit entries in the loaded snapshot.</p>';

    var summary = window.CR.systemSummary ? window.CR.systemSummary.render(retained, {loaded: Boolean(state.observability && state.observability.ok), pending: state.pending.observability, hasMore: data.has_more}) : "";
    return renderTracePanel() + head + controls + summary +
      '<p class="cr-derived">Retained events are org-scoped and owner-only. Worker requests are kept after the operator is verified as a member of this workspace; request bodies, prompts and credentials are never stored. Info events are kept 14 days, warnings and errors 90. Open any failure, job, media job, publish job or ledger entry to see its trace.</p>' +
      retainedBody +
      '<details class="cr-system-evidence"><summary>Job failures, recorded changes &amp; unreadable sources</summary><p>Supporting records from the current snapshot. A recorded change is not necessarily a failure. A source warning means this screen could not read that data; it does not prove the service is down. These records can overlap the events above and are not added to the error count.</p>' + fallbackBody + '</details>';
  }
  /* SOCIAL ACCOUNTS + PUBLISHING.

     POST /v1/social/publish exists and was never wired, so a finished variant
     could be looked at but not sent anywhere. Publishing needs a real target
     account, so the account list is read on demand when Create is opened. */
  function loadSocialAccounts(force) {
    if (state.socialAccounts && !force) return Promise.resolve();
    state.socialAccounts = null;
    /* Before the first load has committed the workspace is not known yet, not
       absent: the render after that commit reads the list. (A page reloaded
       for another account lands on the view it was on, often this one.) */
    if ((!state.org || !state.org.id) && !state.refreshedAt) return Promise.resolve();
    if (!state.org || !state.org.id) { state.socialAccounts = badResult("failed", "No workspace is selected, so there are no social accounts to read."); render(); return Promise.resolve(); }
    return src(request("/v1/social/accounts?org_id=" + encodeURIComponent(state.org.id))).then(function (result) {
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
    var orgId = state.org && state.org.id;
    var mediaUsage = orgId
      ? src(request("/v1/media/usage?org_id=" + encodeURIComponent(orgId) + "&group_by=capability"))
      : Promise.resolve(badResult("failed", "Workspace identity is unavailable.", 400));
    var mediaBudget = orgId
      ? src(request("/v1/media/budget?org_id=" + encodeURIComponent(orgId)))
      : Promise.resolve(badResult("failed", "Workspace identity is unavailable.", 400));
    return Promise.all([
      src(request("/v1/compute/balance")),
      src(request("/v1/platform/catalog")),
      src(request("/v1/developer/consumers")),
      mediaUsage,
      mediaBudget
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
      if (budgetResult && !budgetResult.ok) {
        budgetBody = '<h3 class="cr-subhead">Monthly media allowance</h3>' + sourceBanner(budgetResult, "Media allowance");
      } else if (budgetResult && budgetResult.ok) {
        var budget = budgetResult.data && budgetResult.data.budget || {};
        var dollars = budget.monthly_limit_cents === null || budget.monthly_limit_cents === undefined
          ? ""
          : (Number(budget.monthly_limit_cents) / 100).toFixed(2);
        var saveBusy = state.pending.mediaBudgetSave;
        var saveError = state.pending.mediaBudgetError;
        budgetBody = '<h3 class="cr-subhead">Monthly media allowance</h3>' +
          '<div class="cr-gen">' +
            '<label class="cr-muted"><input id="crMediaBudgetEnabled" type="checkbox"' + (budget.enabled ? " checked" : "") + '> Enforce monthly cap</label>' +
            '<input class="cr-input" id="crMediaBudgetUsd" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Monthly limit (USD)" value="' + esc(dollars) + '">' +
            '<input class="cr-input" id="crMediaBudgetWarn" type="number" min="1" max="100" step="1" inputmode="numeric" aria-label="Warning threshold percent" value="' + esc(budget.warn_at_percent == null ? 80 : budget.warn_at_percent) + '">' +
            '<button class="cr-btn cr-btn--primary" type="button" data-action="save-media-budget"' + (saveBusy ? " disabled" : "") + '>' + (saveBusy ? "Saving…" : "Save allowance") + '</button>' +
          '</div>' +
          '<p class="cr-muted">The database refuses a new paid FAL job when this organization would exceed the enabled monthly cap. Warning threshold is reserved for operator alerts.</p>' +
          (saveError ? sourceBanner(saveError, "Media allowance update") : "");
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
    return body;
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
    var specialty = [bridge.whip, bridge.prim3, bridge.halo, bridge.manufacture].map(function (a) { return appCard(a.title, a.subtitle, a.href, "Specialized workspace", a.external); }).join("");
    return (window.CR.productReadiness ? window.CR.productReadiness.render() : '') + '<section class="cr-app-section"><div class="cr-panel__head"><h2>Registered applications</h2><span class="cr-panel__meta">' + state.apps.length + '</span></div><div class="cr-app-grid">' + registered + '</div></section><section class="cr-app-section"><div class="cr-panel__head"><h2>Specialized workspaces</h2></div><div class="cr-app-grid">' + specialty + '</div></section>';
  }

  /* ---------------------------------------------------------------------
     NAVIGATION CHROME — all of it from NAV.
     One <nav id="crSections">: the floating bottom bar on a phone (the
     `phone` sections plus More), the sidebar from 1024px. The section head
     carries the item tabs and, where an item has views, a segmented control.
     --------------------------------------------------------------------- */
  function navIcon(name, attrs) { return NAVI.icon(name, attrs); }
  function sectionBadge(id) {
    if (id === "people") return state.threads.filter(function (t) { return threadInQueue(t, "inbound"); }).length;
    if (id === "sell") return openOrders().length;
    return 0;
  }
  function renderNav() {
    var host = $("crSections");
    var current = state.leaf || NAVI.resolve(state.route);
    var sec = current.section ? current.section.id : "home";
    /* the shared bar's Control panel shows the same counts as the sections */
    window.CR.navBadges = { people: sectionBadge("people"), sell: sectionBadge("sell") };
    if (host) {
      var items = NAV.map(function (s) {
        var on = s.id === sec, badge = sectionBadge(s.id);
        var subs = '<ul class="cr-sections__subs">' + s.items.map(function (it) {
          var here = on && current.item && current.item.id === it.id;
          return '<li><a href="' + esc(it.route) + '" data-nav-route="' + esc(it.route) + '"' + (here ? ' class="is-on" aria-current="page"' : "") + '>' + esc(it.label) + '</a></li>';
        }).join("") + '</ul>';
        return '<li class="' + (s.phone ? "is-phone" : "is-overflow") + '"><a class="cr-sections__item' + (on ? " is-active" : "") + '" href="' + esc(s.route) + '" data-nav-route="' + esc(s.route) + '" data-section="' + esc(s.id) + '"' + (on ? ' aria-current="true"' : "") + '>' +
          navIcon(s.icon) + '<span class="cr-sections__label">' + esc(s.label) + '</span>' +
          (badge ? '<span class="cr-sections__badge" aria-label="' + badge + ' waiting">' + (badge > 99 ? "99+" : badge) + '</span>' : "") + '</a>' + subs + '</li>';
      }).join("");
      var overflowOn = NAVI.moreSections().some(function (s) { return s.id === sec; });
      var healthy = Boolean(state.health && state.health.ok);
      host.innerHTML =
        '<a class="cr-sections__brand" href="#home:today" data-nav-route="#home:today" aria-label="Control Room home"><img src="assets/img/hm-mark-wide.webp" alt=""><b>Home</b></a>' +
        '<ul class="cr-sections__list">' + items +
        '<li class="is-more"><button class="cr-sections__item' + (overflowOn ? " is-active" : "") + '" type="button" id="crMore" aria-haspopup="dialog" aria-expanded="false" aria-controls="crMoreSheet">' + navIcon("more") + '<span class="cr-sections__label">More</span></button></li></ul>' +
        '<div class="cr-sections__foot"><span class="cr-health-dot' + (healthy ? " is-up" : (state.error ? " is-down" : "")) + '"></span>' + esc(healthy ? "All systems healthy" : (state.error ? "Check system health" : "Checking health")) + ' · PROD</div>';
      var more = $("crMore"); if (more) more.addEventListener("click", openMore);
      host.querySelectorAll("[data-nav-route]").forEach(function (a) {
        a.addEventListener("click", function (e) {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
          e.preventDefault(); go(a.getAttribute("data-nav-route"));
        });
      });
    }
    /* Owner, 2026-11-02: always a way back to Control's home. The title is
       a crumb: "Control" (a link to Home → Today) then the section you're in. */
    var title = $("crTopTitle");
    if (title) {
      var atHome = sec === "home" && (!current.item || current.item.id === "today");
      title.innerHTML = atHome
        ? '<span class="cr-crumb__home" aria-current="page">Home</span>'
        : '<a class="cr-crumb__home" href="#home:today" data-nav-route="#home:today">Home</a><span class="cr-crumb__sep" aria-hidden="true">›</span><span class="cr-crumb__here">' + esc(current.section ? current.section.label : "Home") + '</span>';
      var back = title.querySelector("a[data-nav-route]");
      if (back) back.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault(); go("#home:today");
      });
    }
  }
  function openMore() {
    var sheet = $("crMoreSheet"); if (!sheet) return;
    sheet.innerHTML = '<div class="cr-more__box" role="document"><p class="cr-eyebrow">More</p><ul class="cr-more__list">' +
      NAVI.moreSections().map(function (s) {
        return '<li><a class="cr-rowi cr-rowi--link" href="' + esc(s.route) + '" data-nav-route="' + esc(s.route) + '"><span class="cr-ico">' + navIcon(s.icon) + '</span><span class="cr-rowi__main"><span class="cr-rowi__title">' + esc(s.label) + '</span><span class="cr-rowi__sub">' + esc(s.items.map(function (x) { return x.label; }).join(" · ")) + '</span></span></a></li>';
      }).join("") + '</ul><button class="cr-btn cr-btn--ghost" type="button" data-more-close>Close</button></div>';
    sheet.hidden = false; sheet.classList.add("is-open");
    var more = $("crMore"); if (more) more.setAttribute("aria-expanded", "true");
    sheet.querySelectorAll("[data-nav-route]").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); go(a.getAttribute("data-nav-route")); });
    });
    var close = sheet.querySelector("[data-more-close]"); if (close) { close.addEventListener("click", closeMore); }
    var first = sheet.querySelector("a"); if (first) first.focus();
  }
  function closeMore() {
    var sheet = $("crMoreSheet"); if (!sheet || sheet.hidden) return;
    sheet.hidden = true; sheet.classList.remove("is-open"); sheet.innerHTML = "";
    var more = $("crMore"); if (more) { more.setAttribute("aria-expanded", "false"); }
  }
  function sectionHead(entry, right) {
    var s = entry.section, it = entry.item;
    var title = entry.view && it.views && it.views.length > 1 ? it.label : (entry.leaf.label || it.label);
    var counts = { inbox: state.threads.filter(function (t) { return threadInQueue(t, "inbound"); }).length, orders: openOrders().length };
    var tabs = '<nav class="cr-tabs" aria-label="' + esc(s.label) + ' views">' + s.items.map(function (x) {
      var on = x.id === it.id;
      return '<a class="cr-tab' + (on ? " is-on" : "") + '" href="' + esc(x.route) + '" data-nav-route="' + esc(x.route) + '"' + (on ? ' aria-current="page"' : "") + '>' + esc(x.label) + (counts[x.id] ? '<b>' + counts[x.id] + '</b>' : "") + '</a>';
    }).join("") + '</nav>';
    if (s.id === "people") {
      var groups = [["Messages", ["inbox"]], ["People", ["contacts", "companies", "clients"]], ["Follow-through", ["deals", "outreach"]]];
      var activeGroup = groups.filter(function (g) { return g[1].indexOf(it.id) >= 0; })[0];
      tabs = '<nav class="cr-inbox-categories" aria-label="Inbox categories">' + groups.map(function (g) {
        var target = s.items.filter(function (x) { return x.id === g[1][0]; })[0];
        var on = g === activeGroup;
        return '<div class="cr-inbox-category"><a class="cr-tab' + (on ? ' is-on' : '') + '" href="' + esc(target.route) + '" data-nav-route="' + esc(target.route) + '"' + (on ? ' aria-current="true"' : '') + '>' + esc(g[0]) + '</a></div>';
      }).join('') + '</nav>';
      if (activeGroup && activeGroup[1].length > 1) tabs += '<nav class="cr-tabs" aria-label="' + esc(activeGroup[0]) + ' views">' + s.items.filter(function (x) { return activeGroup[1].indexOf(x.id) >= 0; }).map(function (x) {
        return '<a class="cr-tab' + (x.id === it.id ? ' is-on' : '') + '" href="' + esc(x.route) + '" data-nav-route="' + esc(x.route) + '"' + (x.id === it.id ? ' aria-current="page"' : '') + '>' + esc(x.label) + '</a>';
      }).join('') + '</nav>';
    }
    var views = it.views && it.views.length > 1 ? '<nav class="cr-seg cr-seg--views" aria-label="' + esc(it.label) + '">' + it.views.map(function (vw) {
      var on = entry.view && vw.id === entry.view.id;
      return '<a href="' + esc(vw.route) + '" data-nav-route="' + esc(vw.route) + '"' + (on ? ' class="is-on" aria-current="page"' : "") + '>' + esc(vw.label) + '</a>';
    }).join("") + '</nav>' : "";
    /* The conversation workspace owns its one page heading. Keep the Home
       tabs from the shared navigation without a second title above it. */
    if (entry.leaf.renderer === "home.ask") return tabs + views;
    return '<header class="cr-head"><div class="cr-head__titles"><p class="cr-eyebrow">' + esc(s.label) + '</p><h1 class="cr-h1">' + esc(title) + '</h1></div>' +
      '<div class="cr-head__tools">' + (right || "") + '<button class="cr-btn cr-btn--ghost cr-btn--sm" type="button" data-action="refresh">Refresh</button></div></header>' + tabs + views;
  }
  function bindNavLinks(root) {
    (root || document).querySelectorAll("[data-nav-route]").forEach(function (a) {
      if (a.getAttribute("data-bound-route") === "1" || (a.closest && a.closest("#crSections"))) return;
      a.setAttribute("data-bound-route", "1");
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault(); go(a.getAttribute("data-nav-route"));
      });
    });
  }

  /* ---------------------------------------------------------------------
     SHARED ROW SHAPE (Needs you, Working now, pulse, orders).
     --------------------------------------------------------------------- */
  function pill(kind, label) { return '<span class="cr-pill cr-pill--' + esc(kind) + '">' + esc(label) + '</span>'; }
  function rowi(icon, cls, kind, title, sub, right) {
    return '<li class="cr-rowi"><span class="cr-ico cr-ico--' + esc(cls) + '">' + navIcon(icon) + '</span><span class="cr-rowi__main"><span class="cr-rowi__kind">' + esc(kind) + '</span><span class="cr-rowi__title">' + esc(title) + '</span>' + (sub ? '<span class="cr-rowi__sub">' + esc(sub) + '</span>' : "") + '</span>' + (right || "") + '</li>';
  }
  function actBtn(label, action, attrs, primary) {
    return '<button class="cr-btn cr-btn--sm' + (primary ? " cr-btn--primary" : "") + '" type="button" data-action="' + esc(action) + '"' + (attrs || "") + '>' + esc(label) + '</button>';
  }
  function routeBtn(label, route) { return '<a class="cr-btn cr-btn--sm" href="' + esc(route) + '" data-nav-route="' + esc(route) + '">' + esc(label) + '</a>'; }
  function moneyOf(cents, cur) {
    if (cents == null || isNaN(Number(cents))) return "";
    try { return (Number(cents) / 100).toLocaleString(undefined, { style: "currency", currency: String(cur || "usd").toUpperCase() }); } catch (e) { return "$" + (Number(cents) / 100).toFixed(2); }
  }
  function workRows(kind) {
    var W = window.CR.work && window.CR.work.state;
    return W && W.rows && Array.isArray(W.rows[kind]) ? W.rows[kind] : [];
  }
  function ensureWork(kinds) { if (window.CR.work && window.CR.work.ensure && state.org) window.CR.work.ensure(kinds); }

  /* ---------------------------------------------------------------------
     SELL · ORDERS — one list built from the sources that already exist.
     Nothing is merged at the table level: each row says where it lives.
       leads (print-shop / merch-shop / booking lanes)  → Prints, Merch, Bookings
       /v1/work/orders, /v1/work/bookings records       → Orders, Bookings
       music_orders (the owner's own, RLS)              → Music
       window.CR.marketplace.orders() when #679 lands   → Marketplace
     --------------------------------------------------------------------- */
  var ORDER_TYPES = [["all", "All"], ["prints", "Prints"], ["merch", "Merch"], ["bookings", "Bookings"], ["music", "Music"], ["marketplace", "Marketplace"], ["records", "Records"]];
  var ORDER_ICON = { prints: "frame", merch: "shirt", bookings: "cal", music: "note", marketplace: "store", records: "bag" };
  /* A good read is kept until Refresh (load(true)) asks again; a failed one
     is shown but never cached: it is retried on Refresh, or on the next
     render once a minute has passed, so a render never loops on a failure. */
  var MUSIC_RETRY_MS = 60000;
  function loadMusicOrders(force) {
    if (!state.org || state.pending.musicOrders) return;
    if (!force && state.musicOrders && state.musicOrders.ok) return;
    if (!force && state.musicOrders && !state.musicOrders.ok && Date.now() - (state.musicOrdersAt || 0) < MUSIC_RETRY_MS) return;
    state.pending.musicOrders = true;
    src(supa("music_orders?select=id,amount_cents,currency,status,customer_email,metadata,paid_at,created_at&order=created_at.desc&limit=100")).then(function (r) {
      state.musicOrders = r; state.musicOrdersAt = Date.now(); delete state.pending.musicOrders; render();
    });
  }
  /* /v1/work/{kind} rows carry their lifecycle in `state` (workers/mccluster/
     src/work.js); `status` is only a fallback for an older row shape. */
  function workState(r, fallback) { return (r && (r.state || r.status)) || fallback; }
  function allOrders() {
    var out = [];
    (state.leads || []).forEach(function (l) {
      var c = String(l.campaign || "").toLowerCase();
      var type = c === "print-shop" ? "prints" : c === "merch-shop" ? "merch" : (leadLane(l) === "bookings" && /book|session|portrait|shoot/i.test(c + " " + (l.want || "")) ? "bookings" : null);
      if (!type) return;
      out.push({ key: "lead:" + l.id, type: type, title: l.want || l.note || titleCase(type), who: l.name || l.email || "Customer", when: l.at || l.created_at,
        status: l.status || "new", open: (l.status || "new") === "new" || l.status === "replied", total: null, action: "inspect-lead", id: l.id, source: "Lead" });
    });
    workRows("orders").forEach(function (o) {
      out.push({ key: "order:" + o.id, type: "records", title: o.title || "Order", who: "", when: o.placed_at || o.created_at, status: workState(o, "open"),
        open: ["open", "paid", "in_production"].indexOf(workState(o, "open")) >= 0, total: moneyOf(o.amount_cents, o.currency), route: "#sell:orders:order-records", source: "Order record" });
    });
    workRows("bookings").forEach(function (b) {
      out.push({ key: "booking:" + b.id, type: "bookings", title: b.title || "Booking", who: [b.location, b.starts_at ? formatDate(b.starts_at) : ""].filter(Boolean).join(" · "), when: b.created_at || b.starts_at, status: workState(b, "proposed"),
        open: ["proposed", "confirmed"].indexOf(workState(b, "proposed")) >= 0, total: null, route: "#sell:orders:booking-records", source: "Booking record" });
    });
    rowsOf(state.musicOrders || okResult([])).forEach(function (m) {
      out.push({ key: "music:" + m.id, type: "music", title: (m.metadata && (m.metadata.track_title || m.metadata.title)) || "Music order", who: m.customer_email || "", when: m.paid_at || m.created_at,
        status: m.status || "pending", open: m.status === "pending", total: moneyOf(m.amount_cents, m.currency), route: "#sell:music:catalog", source: "music_orders" });
    });
    var mk = window.CR.marketplace;
    if (mk && typeof mk.orders === "function") {
      try {
        (mk.orders() || []).forEach(function (o) {
          out.push({ key: "mk:" + o.id, type: "marketplace", title: o.title || "Marketplace order", who: o.who || o.customer || "", when: o.when || o.created_at, status: o.state || o.status || "open",
            open: o.open !== false, total: o.total || moneyOf(o.amount_cents, o.currency), route: "#sell:store:marketplace", source: "Marketplace" });
        });
      } catch (e) { /* the module owns its own errors */ }
    }
    return out.sort(function (a, b) { return new Date(b.when || 0) - new Date(a.when || 0); });
  }
  function openOrders() { return allOrders().filter(function (o) { return o.open; }); }
  function orderStateKind(o) {
    var s = String(o.status || "").toLowerCase();
    if (/fail|cancel|refund|lapsed|closed/.test(s)) return s === "closed" ? "ok" : "bad";
    if (/paid|fulfilled|completed|shipped|delivered|confirmed|booked/.test(s)) return "ok";
    if (/new|open|pending|proposed|in_production|replied/.test(s)) return "warn";
    return "info";
  }
  function renderSellOrders() {
    ensureWork(["orders", "bookings", "companies"]); loadMusicOrders();
    var all = allOrders();
    var type = state.orderType || "all", phase = state.orderPhase || "open";
    var typed = all.filter(function (o) { return type === "all" || o.type === type; });
    var shown = typed.filter(function (o) { return phase === "open" ? o.open : phase === "done" ? !o.open && orderStateKind(o) !== "bad" : orderStateKind(o) === "bad"; });
    var week = Date.now() - 7 * 86400000;
    var chips = '<div class="cr-chips" role="group" aria-label="Order type">' + ORDER_TYPES.map(function (t) {
      var n = t[0] === "all" ? all.length : all.filter(function (o) { return o.type === t[0]; }).length;
      return '<button class="cr-chip' + (type === t[0] ? " is-on" : "") + '" type="button" data-order-type="' + t[0] + '" aria-pressed="' + (type === t[0]) + '">' + esc(t[1]) + ' <b>' + n + '</b></button>';
    }).join("") + '</div>';
    var seg = '<div class="cr-seg" role="group" aria-label="Order state">' + [["open", "Open"], ["done", "Done"], ["problems", "Problems"]].map(function (p) {
      return '<button type="button" data-order-phase="' + p[0] + '"' + (phase === p[0] ? ' class="is-on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + p[1] + '</button>';
    }).join("") + '</div>';
    var rows = shown.length ? shown.slice(0, 200).map(function (o) {
      var act = o.action ? ' data-action="' + esc(o.action) + '" data-id="' + esc(o.id) + '"' : ' data-nav-route="' + esc(o.route) + '"';
      return '<li><button class="cr-order" type="button"' + act + '><span class="cr-ico cr-ico--order">' + navIcon(ORDER_ICON[o.type] || "bag") + '</span>' +
        '<span class="cr-order__main">' + esc(o.title) + '</span>' +
        '<span class="cr-order__meta">' + esc([titleCase(o.type), o.who, ago(o.when)].filter(Boolean).join(" · ")) + '</span>' +
        '<span class="cr-order__type">' + esc(titleCase(o.type)) + '</span><span class="cr-order__cust">' + esc(o.who || "—") + '</span><span class="cr-order__when">' + esc(ago(o.when)) + '</span>' +
        '<span class="cr-order__state">' + pill(orderStateKind(o), titleCase(o.status)) + '</span><span class="cr-order__val">' + esc(o.total || "—") + '</span></button></li>';
    }).join("") : '<li class="cr-empty-row">' + esc(all.length ? "Nothing " + (phase === "open" ? "open" : phase === "done" ? "finished" : "failed or refunded") + " in this type." : "No orders came back from any source yet.") + '</li>';
    var problems = all.filter(function (o) { return orderStateKind(o) === "bad"; }).length;
    return sourceStates([["Leads", state.sources.leads], ["Music orders", state.musicOrders]]) +
      '<div class="cr-kpis2">' +
        kpi2("Open", String(all.filter(function (o) { return o.open; }).length), "across all types") +
        kpi2("New · 7 days", String(all.filter(function (o) { return new Date(o.when || 0).getTime() > week; }).length), "every source") +
        kpi2("Bookings", String(all.filter(function (o) { return o.type === "bookings" && o.open; }).length), "open") +
        kpi2("Problems", String(problems), problems ? "failed, cancelled or refunded" : "none") +
      '</div>' + chips +
      '<section class="cr-panel2"><header class="cr-panel2__head"><h2>' + esc(type === "all" ? "All orders" : titleCase(type)) + '</h2>' + seg + '</header>' +
      '<div class="cr-ohead" aria-hidden="true"><span></span><span>Order</span><span>Type</span><span>Customer</span><span>When</span><span>Status</span><span>Total</span></div>' +
      '<ul class="cr-orders">' + rows + '</ul></section>' +
      derivedNote("One list over the existing order sources: print and merch shop leads, Work order and booking records, your music orders and, once it ships, the marketplace. Each row opens where that order lives; the tables are not merged.");
  }
  function kpi2(label, value, sub) { return '<div class="cr-kpi2"><div class="cr-kpi2__label">' + esc(label) + '</div><div class="cr-kpi2__value">' + esc(value) + '</div><div class="cr-kpi2__sub">' + esc(sub || "") + '</div></div>'; }

  /* ---------------------------------------------------------------------
     HOME · TODAY — the AI bar, the numbers, Needs you, Working now, pulse.
     --------------------------------------------------------------------- */
  function needsYou() {
    var items = [];
    pendingApprovalRows().forEach(function (a) {
      items.push(rowi("check", "approve", "Approval · " + (a.capability || "owner decision"), a.resource || a.capability || "Approval", a.reason || "",
        '<span class="cr-rowi__actions">' + actBtn("Approve", "approval-decide", ' data-id="' + esc(a.id) + '" data-decision="approve"', true) + actBtn("Deny", "approval-decide", ' data-id="' + esc(a.id) + '" data-decision="deny"') + '</span>'));
    });
    openOrders().filter(function (o) { return o.type !== "records" || o.status === "paid"; }).slice(0, 5).forEach(function (o) {
      var btn = o.action ? actBtn("Open", o.action, ' data-id="' + esc(o.id) + '"') : routeBtn("Open", o.route);
      items.push(rowi(ORDER_ICON[o.type] || "bag", "order", "New order · " + titleCase(o.type), o.title, [o.who, o.total, ago(o.when)].filter(Boolean).join(" · "), btn));
    });
    state.threads.filter(function (t) { return threadInQueue(t, "inbound"); }).slice(0, 5).forEach(function (t) {
      items.push(rowi("chat", "msg", "Unanswered · " + ago(t.last_inbound_at || t.updated_at), threadLabel(t), (t.channel || "message") + (threadOwned(t) ? " · you have it" : " · assistant"), actBtn("Reply", "open-thread", ' data-id="' + esc(t.id) + '"')));
    });
    var mk = window.CR.marketplace;
    if (mk && typeof mk.applications === "function") {
      try {
        (mk.applications() || []).slice(0, 5).forEach(function (a) {
          items.push(rowi("store", "seller", "Seller application", a.name || "Seller", a.summary || "Marketplace", routeBtn("Review", "#sell:store:marketplace")));
        });
      } catch (e) { /* the module owns its own errors */ }
    }
    workRows("renewals").filter(function (r) { return workState(r) === "lapsed"; }).slice(0, 5).forEach(function (r) {
      items.push(rowi("warn", "bad", "Renewal lapsed", r.title || "Renewal", [moneyOf(r.amount_cents, r.currency), r.renews_at ? "renewed by " + formatDate(r.renews_at) : ""].filter(Boolean).join(" · "), routeBtn("View", "#sell:payments:renewals")));
    });
    workRows("payments").filter(function (p) { return workState(p) === "failed"; }).slice(0, 5).forEach(function (p) {
      items.push(rowi("warn", "bad", "Payment failed", p.title || "Payment", [moneyOf(p.amount_cents, p.currency), p.provider].filter(Boolean).join(" · "), routeBtn("View", "#sell:payments:payments")));
    });
    attentionItems().filter(function (it) { return !/awaiting a reply/.test(it.title); }).forEach(function (it) {
      items.push(rowi(it.kind === "bad" ? "warn" : "spark", it.kind === "bad" ? "bad" : "approve", it.kind === "bad" ? "Issue" : "Review", it.title, it.sub, actBtn("Open", it.action, it.id ? ' data-id="' + esc(it.id) + '"' : "")));
    });
    return items;
  }
  function workingNow() {
    var items = [];
    if (state.aiChatPending) items.push(rowi("spark", "approve", "AI · " + ((state.aiChatTask && state.aiChatTask.status) || "queued"), "McCluster is answering", "Ask McCluster", pill("ai", "Running")));
    state.jobs.filter(function (j) { return ["queued", "running"].indexOf(j.status) >= 0; }).slice(0, 6).forEach(function (j) {
      items.push(rowi("system", "msg", "Core · " + titleCase(j.status), titleCase(j.job_type), text(j.target_id, j.target_type), actBtn(titleCase(j.status), "inspect-job", ' data-id="' + esc(j.id) + '"')));
    });
    allMediaJobs().filter(function (j) { return ["queued", "running", "processing"].indexOf(j.status) >= 0; }).slice(0, 3).forEach(function (j) {
      items.push(rowi("frame", "msg", "Media · " + titleCase(j.status), titleCase(j.kind || j.job_type || "generation"), ago(j.created_at), actBtn("Open", "inspect-media-job", ' data-id="' + esc(j.id) + '"')));
    });
    state.publishJobs.filter(function (p) { return ["queued", "draft", "publishing"].indexOf(p.state) >= 0; }).slice(0, 3).forEach(function (p) {
      items.push(rowi("frame", "msg", "Publish · " + titleCase(p.state), titleCase(p.platform || "post"), p.scheduled_at ? "Scheduled " + formatDate(p.scheduled_at) : "", routeBtn("Open", "#create:publish:schedule")));
    });
    return items;
  }
  function lastAiReply() {
    var id = state.selectedAiThreadId; if (!id) return null;
    var list = aiMessagesFor(id).filter(function (m) { return m.role === "assistant" && m.content; });
    return list.length ? list[list.length - 1] : null;
  }
  function renderToday() {
    ensureWork(["orders", "bookings", "renewals", "payments"]); loadMusicOrders();
    var now = new Date();
    var eyebrow = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
    var needs = needsYou(), working = workingNow();
    var waiting = state.threads.filter(function (t) { return threadInQueue(t, "inbound"); });
    var oldest = waiting.map(function (t) { return t.last_inbound_at || t.updated_at; }).sort()[0];
    var reply = lastAiReply();
    var ready = coreToolAvailable("ai.chat");
    var ask = '<section class="cr-ask cr-full" aria-label="Ask McCluster">' +
      '<div class="cr-ask__row"><input id="crHeroInput" autocomplete="off" placeholder="Ask McCluster, or tell it what to do…" aria-label="Ask McCluster, search, or give it an objective">' +
      '<button class="cr-btn cr-btn--primary" type="button" data-action="hero-command">' + navIcon("spark", ' width="16" height="16"') + 'Go</button></div>' +
      '<div class="cr-ask__chips">' +
        (waiting.length ? '<button class="cr-chip" type="button" data-action="goto-waiting">Open the ' + waiting.length + ' unanswered</button>' : "") +
        '<button class="cr-chip" type="button" data-nav-route="#sell:orders:all">Orders to fill</button>' +
        '<button class="cr-chip" type="button" data-action="goto-failed">Show failed work</button>' +
        '<button class="cr-chip" type="button" data-nav-route="#home:ask">Open the chat</button>' +
        '<button class="cr-chip" type="button" data-nav-route="#create:publish:schedule">What is scheduled?</button></div>' +
      '<div class="cr-answer"><span class="cr-dot-ai">' + navIcon("spark", ' width="13" height="13"') + '</span><span>' +
        (reply ? '<b>McCluster:</b> ' + esc(String(reply.content).slice(0, 280)) + (String(reply.content).length > 280 ? "…" : "")
          : '<b>McCluster</b> ' + esc(ready ? "is ready. Ask a question here, or open the chat for the full thread." : "is offline on this deployment; commands still route and queue.")) +
      '</span></div></section>';
    var kpis = '<div class="cr-kpis2 cr-full">' +
      kpi2("Needs you", String(needs.length), needs.length ? "items below" : "all clear") +
      kpi2("Open orders", String(openOrders().length), "every source") +
      kpi2("Unanswered", String(waiting.length), oldest ? "oldest " + ago(oldest) : "none waiting") +
      kpi2("Running now", String(working.length), "jobs and publishing") + '</div>';
    var pulse = [
      rowi("system", "order", "API Worker", "api.mccluster.org", state.health && state.health.ok ? "Edge responding" : "Edge health unavailable", pill(state.health && state.health.ok ? "ok" : "bad", state.health && state.health.ok ? "Healthy" : "Check")),
      rowi("system", "order", "Database", "Canonical Supabase", state.status && state.status.database && state.status.database.reachable ? "Reachable" : "Not confirmed", pill(state.status && state.status.database && state.status.database.reachable ? "ok" : "warn", state.status && state.status.database && state.status.database.reachable ? "Healthy" : "Check")),
      rowi("system", "order", "Core", "OVH McCluster Core", "ai_context-v4", pill(state.ai && state.ai.ok ? "ok" : "warn", state.ai && state.ai.ok ? "Healthy" : "Inspect"))
    ].join("");
    return '<header class="cr-head"><div class="cr-head__titles"><p class="cr-eyebrow">' + esc(eyebrow) + '</p><h1 class="cr-h1">Today</h1></div><div class="cr-head__tools"><button class="cr-btn cr-btn--ghost cr-btn--sm" type="button" data-action="refresh">Refresh</button></div></header>' +
      sectionTabsOnly() +
      '<div class="cr-today">' + ask + kpis +
        '<section class="cr-panel2"><header class="cr-panel2__head"><h2>Needs you</h2><span class="cr-panel2__meta">' + (needs.length ? needs.length + " item" + (needs.length === 1 ? "" : "s") : "clear") + '</span></header>' +
          (needs.length ? '<ul class="cr-rows">' + needs.join("") + '</ul>' : '<div class="cr-panel2__body">' + pill("ok", "All clear") + '<p class="cr-muted">Nothing instrumented needs you right now.</p></div>') + '</section>' +
        '<div class="cr-col">' +
          '<section class="cr-panel2"><header class="cr-panel2__head"><h2>Working now</h2><span class="cr-panel2__meta">' + working.length + ' active</span></header>' +
            (working.length ? '<ul class="cr-rows">' + working.join("") + '</ul>' : '<div class="cr-panel2__body cr-muted">No queued or running work.</div>') + '</section>' +
          '<section class="cr-panel2"><header class="cr-panel2__head"><h2>System pulse</h2><span class="cr-panel2__meta">' + (state.health && state.health.ok ? "operational" : "check") + '</span></header><ul class="cr-rows">' + pulse + '</ul></section>' +
        '</div>' +
        '<div class="cr-grid cr-full">' +
          panel("Recent activity", "last change per surface", '<div class="cr-list">' + recentActivity().map(function (a) {
            return row(a.title, a.sub, ago(a.when), a.kind, a.action, a.id ? { id: a.id, badge: a.badge } : { badge: a.badge });
          }).join("") + '</div>', "cr-span-6") +
          panel("Public record", "canonical search authority", renderPublicRecord(), "cr-span-12") +
        '</div>' +
      '</div>';
  }
  function sectionTabsOnly() {
    var entry = state.leaf; if (!entry) return "";
    var s = entry.section;
    return '<nav class="cr-tabs" aria-label="' + esc(s.label) + ' views">' + s.items.map(function (x) {
      var on = x.id === entry.item.id;
      return '<a class="cr-tab' + (on ? " is-on" : "") + '" href="' + esc(x.route) + '" data-nav-route="' + esc(x.route) + '"' + (on ? ' aria-current="page"' : "") + '>' + esc(x.label) + '</a>';
    }).join("") + '</nav>';
  }

  /* ---------------------------------------------------------------------
     INSIGHTS · HALO — One Halo (docs/control-plane/HALO-ADMIN-GLOBE.md):
     every Halo door opens the four screens on the globe, never another app.
     --------------------------------------------------------------------- */
  function renderHalo() {
    var href = (window.CR.workspaceCore && window.CR.workspaceCore.HALO_PAGE) || bridge.halo.href;
    return '<section class="cr-panel2 cr-halo"><header class="cr-panel2__head"><h2>Hitman’s Halo</h2><span class="cr-panel2__meta">owner only</span></header>' +
      '<div class="cr-panel2__body"><p>The owner’s four screens on the globe: World, Missions, People and Intelligence. One Halo, on its own full-screen page; its feeds keep their own owner checks.</p>' +
      '<p><a class="cr-btn cr-btn--primary" href="' + esc(href) + '">' + navIcon("globe", ' width="16" height="16"') + 'Open the Halo globe</a></p>' +
      '<p class="cr-muted">The analytics globe stays inside Insights → Overview, where it keeps its camera and selection between chapters.</p></div></section>';
  }

  /* ---------------------------------------------------------------------
     MOUNT POINTS — a NAV view whose module is not loaded yet. A later PR
     registers window.CR.<module> = { render, bind?, init? } and nothing in
     the shell changes.
     --------------------------------------------------------------------- */
  function renderSlot(entry) {
    var mod = entry.leaf.module, M = mod && window.CR[mod];
    if (M && typeof M.render === "function") {
      try { return M.render(entry.leaf.id); } catch (e) { return empty(entry.leaf.label + " failed to start", "The module threw while rendering. Refresh Control Room."); }
    }
    return '<div class="cr-slot" data-cr-slot="' + esc(mod || entry.leaf.id) + '"><strong>' + esc(entry.leaf.label) + ' is not available yet</strong>' +
      '<p class="cr-muted">This view has its place in Control. It appears here as soon as its module (window.CR.' + esc(mod || entry.leaf.id) + ') is loaded; nothing is shown until it is real.</p></div>';
  }

  /* ---------------------------------------------------------------------
     LEAF BODIES — the existing renderers, without their old page headers.
     --------------------------------------------------------------------- */
  function workChrome() {
    return '<div class="cr-workbar"><input class="cr-workbar__search" id="crWorkSearch" type="search" placeholder="Filter this view…" aria-label="Filter this view"><button class="cr-btn cr-btn--primary" type="button" data-action="new-work">+ New</button></div>' + (window.CR.work ? window.CR.work.renderForm() : "");
  }
  function leafBody(entry) {
    var r = entry.leaf.renderer || "";
    if (r === "home.ask") return renderAi();
    if (r === "sell.orders") return renderSellOrders();
    if (r === "insights.halo") return renderHalo();
    if (r === "slot") return renderSlot(entry);
    if (r === "apps") return renderApps();
    if (state.surface === "work") return (["inbox", "desk-bot"].indexOf(state.workView) >= 0 ? "" : workChrome()) + renderWorkView(state.workView);
    if (state.surface === "create") return renderCreate();
    if (state.surface === "system") return renderSystem();
    return empty("Nothing here", "This route has no view.");
  }
  function renderLeaf() {
    var entry = state.leaf || NAVI.resolve(state.route).entry;
    if (state.surface === "home") return renderToday();
    return sectionHead(entry) + '<div class="cr-leaf" data-cr-leaf="' + esc(entry.leaf.route) + '">' + leafBody(entry) + '</div>';
  }

  function renderLoading() {
    var entry = state.leaf || NAVI.resolve(state.route).entry;
    return sectionHead(entry) + '<div class="cr-canvas">' + empty("Loading", "Reading existing APIs and operator-visible records.") + '</div>';
  }
  /* The analytics deck's own chapter tabs are the Insights items. Keep the
     address bar and the sidebar on the chapter the deck is showing. */
  function syncInsightsRoute() {
    var S = window.CR.analytics && window.CR.analytics.state;
    if (!S || state.surface !== "analytics") return;
    var leaf = NAVI.leaves().filter(function (l) { return l.leaf.renderer === "analytics." + S.section; })[0];
    if (!leaf || leaf.leaf.route === state.route) return;
    applyLeaf(leaf); state.analyticsApplied = leaf.leaf.route;
    if (history.replaceState) history.replaceState(null, "", leaf.leaf.route);
    renderNav();
  }
  /* The shell's own line: why the page was concealed, or is reloading. */
  function noticeHtml() {
    var n = state.notice; if (!n || !n.text) return "";
    var buttons = (authority.reloading ? "" : '<button class="cr-btn cr-btn--ghost cr-btn--sm" type="button" data-action="dismiss-notice">Dismiss</button> ') +
      (n.reload || authority.reloading ? '<button class="cr-btn cr-btn--primary cr-btn--sm" type="button" data-action="reload-control">Reload Admin Home</button>' : "");
    return '<div class="cr-gap" role="status" data-cr-notice><b>' + esc(n.text) + '</b>' + (buttons ? '<span>' + buttons + '</span>' : "") + '</div>';
  }
  function render() {
    renderNav(); renderTopStatus();
    var root = $("crSurface"); if (!root) return;
    /* Progress paints must preserve the draft, focus, setup fields, and the
       reader's scroll position. Credentials are deliberately excluded. */
    var aiFields = [], aiFocus = null, aiScroll = null;
    if (state.surface === "ai" && aiBrowserOwner(state) && !authority.reloading) {
      root.querySelectorAll("[data-ai-preserve]").forEach(function (input) { aiFields.push({ id: input.id, value: input.value }); });
      var active = document.activeElement;
      if (active && active.id && root.contains(active) && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(active.tagName) && active.id !== "crAiCredential") aiFocus = { id: active.id, start: active.selectionStart, end: active.selectionEnd };
      var oldMessages = $("crAiMessages");
      if (oldMessages) aiScroll = { thread: oldMessages.getAttribute("data-thread-id"), top: oldMessages.scrollTop, atEnd: oldMessages.scrollHeight - oldMessages.clientHeight - oldMessages.scrollTop < 80 };
    }
    var section = state.leaf ? state.leaf.section.id : "home";
    /* A page being replaced shows only why (and a way to reload by hand if
       the browser held the reload back). */
    if (authority.reloading) { root.innerHTML = '<div class="cr-canvas">' + noticeHtml() + '</div>'; root.setAttribute("data-cr-mount", "notice"); bindActions(root); return; }
    if (state.loading && !state.status && !state.health && state.surface !== "analytics") root.innerHTML = noticeHtml() + renderLoading();
    /* Analytics keeps its mount between Control Room repaints: it owns its own
       paint, and its globe frame (the 60/40 layout) would reload the Earth on
       every unrelated state change if the mount were rebuilt. */
    else if (state.surface === "analytics") {
      if (!(root.getAttribute("data-cr-mount") === "analytics" && $("crAnalyticsMount"))) root.innerHTML = renderAnalytics();
    }
    else root.innerHTML = noticeHtml() + renderLeaf();
    root.setAttribute("data-cr-mount", state.surface === "analytics" ? "analytics" : "leaf");
    root.setAttribute("data-cr-surface", section);
    root.setAttribute("data-cr-route", state.route);
    /* the page knows its surface: Analytics runs full-bleed on a phone (css/control-analytics.css) */
    document.body.setAttribute("data-cr-surface", state.surface);
    document.body.setAttribute("data-cr-section", section);
    bindNavLinks(root);
    bindSurfaceControls();
    aiFields.forEach(function (field) { var input = $(field.id); if (input && input.hasAttribute("data-ai-preserve")) input.value = field.value; });
    if (aiFocus) {
      var focus = $(aiFocus.id);
      if (focus && !focus.disabled) { focus.focus({ preventScroll: true }); if (typeof aiFocus.start === "number" && focus.setSelectionRange && !/^(search|email|number)$/.test(focus.type)) { try { focus.setSelectionRange(aiFocus.start, aiFocus.end); } catch (_) {} } }
    }
    var messagesMount = $("crAiMessages");
    if (messagesMount) {
      messagesMount.setAttribute("data-thread-id", state.selectedAiThreadId || "");
      messagesMount.scrollTop = !aiScroll || aiScroll.thread !== String(state.selectedAiThreadId || "") || aiScroll.atEnd ? messagesMount.scrollHeight : aiScroll.top;
    }
    if (state.surface === "analytics" && window.CR.analytics) {
      var analyticsHost = $("crAnalyticsMount");
      if (analyticsHost) {
        if (state.analyticsApplied !== state.route && state.analyticsSection) {
          window.CR.analytics.state.section = state.analyticsSection;
          state.analyticsApplied = state.route;
        }
        if (analyticsHost.getAttribute("data-cr-sync") !== "1") {
          analyticsHost.setAttribute("data-cr-sync", "1");
          ["click", "keyup", "touchend"].forEach(function (type) {
            analyticsHost.addEventListener(type, function () { setTimeout(syncInsightsRoute, 30); }, { passive: true });
          });
        }
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
    if (state.surface === "ai" && aiBrowserOwner(state) && state.selectedAiThreadId && !state.aiMessages[state.selectedAiThreadId] && !state.pending["aiMessages:" + state.selectedAiThreadId]) {
      loadAiMessages(state.selectedAiThreadId);
    }
    if (state.surface === "ai" && aiBrowserOwner(state) && !state.aiDevicesLoaded) loadOwnerDevices(false);
    if (state.surface === "create" && !state.socialAccounts && !state.pending.socialAccounts) {
      state.pending.socialAccounts = true;
      loadSocialAccounts().then(function () { delete state.pending.socialAccounts; });
    }
    if (state.surface === "create" && state.createView === "projects" && !state.pending.mediaModels && !window.CR.media.state.catalog) {
      state.pending.mediaModels = true;
      window.CR.media.loadCatalog().then(function () { delete state.pending.mediaModels; });
    }
    if (state.surface === "work" && state.workView === "inbox" && state.selectedThreadId && !state.transcripts[state.selectedThreadId] && !state.pending["transcript:" + state.selectedThreadId]) {
      state.pending["transcript:" + state.selectedThreadId] = true;
      var pendingId = state.selectedThreadId;
      loadTranscript(pendingId).then(function () { delete state.pending["transcript:" + pendingId]; });
    }
    if (state.surface === "system" && state.systemView === "observability" && !state.observability && !state.pending.observability) {
      loadObservability(false);
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
      custom: detail, activity: activity, raw: j, tabs: ["overview", "activity", "raw", "ai"],
      actions: traceButton({ trace_id: (j.input && j.input.trace_id) || j.id }, "Open job trace")
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
      actions: (j.routing && j.routing.trace_id ? traceButton({ trace_id: j.routing.trace_id }) : "") + traceButton({ resource_type: "media_job", resource_id: j.id }),
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
    var busy = state.pending["publishMove:" + p.id];
    var failure = state.pending["publishMoveError:" + p.id];
    var canCancel = ["draft", "queued"].indexOf(p.state) >= 0 && !p.external_creation_id;
    var canRetry = p.state === "failed" && !p.external_media_id;
    var actions = "";
    if (canRetry) actions += '<button class="cr-btn cr-btn--primary" type="button" data-action="retry-publish" data-id="' + esc(p.id) + '"' + (busy ? " disabled" : "") + '>' + (busy ? "Retrying…" : "Retry") + '</button>';
    if (canCancel) actions += '<button class="cr-btn" type="button" data-action="cancel-publish" data-id="' + esc(p.id) + '"' + (busy ? " disabled" : "") + '>Cancel</button>';
    actions += traceButton({ resource_type: "social_publish_job", resource_id: p.id });
    openInspector({
      title: "Publishing job",
      subtitle: "Create · Schedule",
      description: p.payload && p.payload.caption || "Scheduled distribution",
      props: [["State", p.state], ["Scheduled", formatDate(p.scheduled_at)], ["Mode", p.publish_mode || "—"],
        ["Attempts", p.attempts], ["Meta container", p.external_creation_id || "—"], ["Published media", p.external_media_id || "—"]],
      custom: (p.last_error ? inspectorSection("Last failure", '<p class="cr-fail">' + esc(p.last_error) + '</p>') : "") +
        (failure ? inspectorSection("Action failed", sourceBanner(failure, "Publish recovery")) : "") +
        (p.state === "processing" ? inspectorSection("In flight", '<p class="cr-muted">Meta already has a creation container. Control will not offer cancellation once publishing has crossed that boundary.</p>') : ""),
      actions: actions,
      raw: p,
      tabs: ["overview", "activity", "raw", "ai"]
    });
  }
  function inspectRequest(id) { var r = findById(state.siteRequests, id); if (!r) return; openInspector({ title: r.title || r.request_type || "Site request", subtitle: "Work · Request", description: r.note || r.description || "Client/site request", props: [["Status", r.status], ["Created", formatDate(r.created_at || r.at)]], raw: r }); }
  function observationById(id) {
    var pool = retainedObservabilityEvents();
    if (state.observabilityTrace && state.observabilityTrace.result && state.observabilityTrace.result.ok) pool = pool.concat(pickRows(state.observabilityTrace.result, "events"));
    return pool.find(function (row) { return String(row.id) === String(id); });
  }
  function inspectObservation(id) {
    var e = observationById(id);
    if (!e) return;
    var actions = traceButton({ trace_id: e.trace_id }) +
      (e.resource_type && e.resource_id ? traceButton({ resource_type: e.resource_type, resource_id: e.resource_id }) : "");
    openInspector({
      title: obsLabel(e),
      subtitle: "System · Observability · " + titleCase(e.event_kind || "event"),
      description: e.message || "Retained observability event.",
      props: [
        ["Level", e.level], ["Outcome", e.outcome], ["Status", e.status_code], ["Duration", e.duration_ms == null ? "—" : e.duration_ms + " ms"],
        ["Source", e.source], ["Service", e.service], ["Route", e.route],
        ["Record", e.resource_type ? e.resource_type + " " + text(e.resource_id, "") : "—"],
        ["Trace", e.trace_id], ["Request", e.request_id], ["Span", e.span_id], ["Parent span", e.parent_span_id],
        ["Actor", e.actor_user_id], ["Occurred", formatDate(e.occurred_at || e.created_at)], ["Stored", formatDate(e.created_at)]
      ],
      actions: actions,
      raw: e,
      tabs: ["overview", "raw", "ai"]
    });
  }
  function inspectAudit(id) {
    var a = (state.audit || []).find(function (row) { return String(row.id) === String(id); });
    if (!a) return;
    var trace = a.detail && a.detail.trace && a.detail.trace.trace_id;
    openInspector({
      title: a.event,
      subtitle: "System · Ledger",
      description: "Privileged change recorded in control_audit.",
      props: [["Actor", a.actor_user_id || a.actor_kind], ["Capability", a.capability], ["Record", a.resource_type ? a.resource_type + " " + text(a.resource_id, "") : "—"], ["At", formatDate(a.at)], ["Trace", trace || "not recorded (before tracing)"]],
      actions: trace ? traceButton({ trace_id: trace }) : (a.resource_type && a.resource_id ? traceButton({ resource_type: a.resource_type, resource_id: a.resource_id }) : ""),
      raw: a,
      tabs: ["overview", "raw", "ai"]
    });
  }

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
      [/\b(desk bot|knowledge( base)?|kb|refusals?|refused|bot spend)\b/i, function () { setSurface("work", "desk-bot"); }],
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

    /* A question goes to the resident model's durable chat (the old AI
       surface, now Home → Ask McCluster); anything else is an objective. */
    if (/\?\s*$|^(what|why|how|when|who|which|where|is|are|can|should|do|does|did)\b/i.test(q) && coreToolAvailable("ai.chat")) {
      closePalette(); go("#home:ask"); sendAiMessage(q, { inputMode: "text", speakReply: false }); return;
    }
    closePalette(); submitCoreTask(q);
  }

  /* ⌘K: every NAV leaf (searchable by its old names through `was`), then
     the three object shortcuts. Typing anything else hands it to McCluster. */
  function paletteCommands(q) {
    var nav = NAVI.search(q).map(function (e) { return { label: e.label, blurb: e.blurb, route: e.route, group: e.group }; });
    var verbs = [
      { label: "Show failed work", blurb: "Workload, filtered to failures", action: "goto-failed", group: "Do" },
      { label: "Open waiting conversations", blurb: "Threads whose last message came in", action: "goto-waiting", group: "Do" },
      { label: "Run system health", blurb: "Ask Core for a fresh host health result", action: "refresh-health", group: "Do" }
    ].filter(function (x) { var t = String(q || "").trim().toLowerCase(); return !t || (x.label + " " + x.blurb).toLowerCase().indexOf(t) >= 0; });
    return nav.concat(verbs);
  }
  function renderPalette(filter) {
    var q = String(filter || "").trim();
    var cmds = paletteCommands(q);
    var html = "", last = "";
    if (q) html += '<button class="cr-palette__item cr-palette__item--ask" type="button" data-command-query="' + esc(q) + '"><span>Ask McCluster: “' + esc(q) + '”</span><small>Search, open a person or project, or hand it over as an objective</small></button>';
    cmds.forEach(function (x, i) {
      if (!q && x.group !== last) { html += '<div class="cr-palette__group" role="presentation">' + esc(x.group) + '</div>'; last = x.group; }
      html += '<button class="cr-palette__item' + (i === 0 && !q ? " is-active" : "") + '" type="button"' + (x.route ? ' data-palette-route="' + esc(x.route) + '"' : ' data-action="' + esc(x.action) + '"') + '><span>' + esc(x.label) + '</span><small>' + esc(x.blurb) + '</small></button>';
    });
    $("crPaletteResults").innerHTML = html || '<p class="cr-muted">Nothing matches.</p>';
    bindActions($("crPaletteResults"));
    $("crPaletteResults").querySelectorAll("[data-palette-route]").forEach(function (b) { b.addEventListener("click", function () { closePalette(); go(b.getAttribute("data-palette-route")); }); });
    $("crPaletteResults").querySelectorAll("[data-command-query]").forEach(function (b) { b.addEventListener("click", function () { handleCommand(b.getAttribute("data-command-query")); }); });
  }
  function openPalette() { var p = $("crPalette"); p.classList.add("is-open"); p.setAttribute("aria-hidden", "false"); var input = $("crPaletteInput"); input.value = ""; renderPalette(""); setTimeout(function () { input.focus(); }, 0); }
  function closePalette() { var p = $("crPalette"); p.classList.remove("is-open"); p.setAttribute("aria-hidden", "true"); }

  function handleOwnerAiAction(action, el) {
    var id = el && el.getAttribute("data-id");
    if (action === "ai-panel") {
      state.aiPanel = el.getAttribute("data-panel");
      if (state.aiPanel !== "devices") { state.aiEnrollment = null; state.aiEnrollmentReveal = false; state.aiAddDeviceOpen = false; }
      render(); if (state.aiPanel === "devices") loadOwnerDevices(true);
    } else if (action === "ai-new-thread") {
      stopAiVoiceListening(true); stopAiVoiceSpeech(); state.aiPanel = "chat"; state.aiChatError = null; state.aiReviewOf = null; state.aiAttachments = [];
      createAiThread().catch(function () {});
    } else if (action === "ai-select-thread") {
      stopAiVoiceListening(true); stopAiVoiceSpeech();
      if (state.selectedAiThreadId) state.aiDrafts[state.selectedAiThreadId] = state.aiChatDraft;
      state.selectedAiThreadId = id; state.aiPanel = "chat"; state.aiChatDraft = state.aiDrafts[id] || "";
      state.aiChatError = state.aiRuns[id] && state.aiRuns[id].error || null;
      state.aiVoiceError = null; state.aiReviewOf = null; state.aiAttachments = []; syncSelectedAiRun(); render();
    } else if (action === "ai-refresh-thread") {
      if (state.selectedAiThreadId) loadAiMessages(state.selectedAiThreadId, true);
      loadOwnerDevices(true);
    } else if (action === "ai-earlier-messages") {
      loadEarlierAiMessages(state.selectedAiThreadId);
    } else if (action === "ai-more-threads") {
      loadMoreAiThreads();
    } else if (action === "ai-starter") {
      state.aiChatDraft = el.getAttribute("data-prompt") || ""; render(); if ($("crAiComposer")) $("crAiComposer").focus();
    } else if (action === "ai-copy-code") {
      var code = el.closest(".cr-ai-code"); aiCopyText(code && code.querySelector("code").textContent, el);
    } else if (action === "ai-copy-message") {
      var copied = aiMessageById(id); if (copied) aiCopyText(copied.content, el);
    } else if (action === "ai-retry") {
      var original = aiMessageById(id), all = aiMessagesFor(state.selectedAiThreadId), user = original;
      if (original && original.role !== "user") {
        var turnId = original.metadata && original.metadata.agent_job_id;
        user = all.find(function (m) { return m.role === "user" && m.metadata && m.metadata.agent_job_id === turnId; });
        if (!user) user = all.slice(0, all.indexOf(original)).filter(function (m) { return m.role === "user"; }).pop();
      }
      if (user) {
        state.aiAttachments = ((user.metadata && user.metadata.images) || []).filter(aiBase64Valid).map(function (b64) { return { base64: b64, preview: "data:image/jpeg;base64," + b64, bytes: aiBase64Bytes(b64), name: "Retried image" }; });
        sendAiMessage(user.content, { inputMode: "text", speakReply: false });
      }
    } else if (action === "ai-review") {
      var reviewed = aiMessageById(id); if (!reviewed) return true;
      state.aiReviewOf = reviewed.metadata && reviewed.metadata.agent_job_id;
      state.aiRouteSelection = "auto";
      state.aiChatDraft = "Review this saved answer for accuracy, missing evidence and practical improvements. Explain any corrections clearly.";
      render(); if ($("crAiDevice")) $("crAiDevice").focus();
    } else if (action === "ai-cancel-review") {
      state.aiReviewOf = null; render();
    } else if (action === "ai-stop") {
      var threadId = state.selectedAiThreadId, run = selectedAiRun(), task = run && run.task;
      if (!task || !task.id || !coreToolAvailable("core.ai.turn.stop")) return true;
      setAiRun(threadId, { stopRequested: true }); render();
      callCoreTool("core.ai.turn.stop", { org_id: state.org.id, turn_id: task.id }).then(function () {
        setAiRun(threadId, { pending: false, task: Object.assign({}, task, { status: "canceled" }), progress: null, stopped: true });
        render(); return loadAiMessages(threadId, true);
      }).catch(function (error) { setAiRun(threadId, { stopRequested: false }); if (state.selectedAiThreadId === threadId) state.aiChatError = error.message || "Stop was not confirmed. Reconnect to check the run."; render(); });
    } else if (action === "ai-refresh-devices") loadOwnerDevices(true);
    else if (action === "ai-add-device") { state.aiAddDeviceOpen = true; state.aiEnrollment = null; state.aiDeviceError = null; render(); }
    else if (action === "ai-enroll") issueAiEnrollment(null);
    else if (action === "ai-finish-enrollment") issueAiEnrollment(id);
    else if (action === "ai-forget-enrollment") { state.aiEnrollment = null; state.aiEnrollmentReveal = false; state.aiAddDeviceOpen = false; render(); }
    else if (action === "ai-reveal-credential") { state.aiEnrollmentReveal = !state.aiEnrollmentReveal; render(); }
    else if (action === "ai-copy-credential") { if (state.aiEnrollment && state.aiEnrollment.credential) aiCopyText(state.aiEnrollment.credential, el); }
    else if (action === "ai-copy-setup-command") aiCopyText($("crAiSetupCommand") && $("crAiSetupCommand").textContent, el);
    else if (action === "ai-download-setup") aiSetupDownload();
    else if (action === "ai-copy-cleanup") { var heldDevice = state.aiDevices.find(function (device) { return OWNER_AI.deviceId(device) === id; }); aiCopyText(OWNER_AI.cleanupCommand(heldDevice), el); }
    else if (action === "ai-device-rename") { state.aiRenameId = id; render(); }
    else if (action === "ai-device-save-name") mutateAiDevice(id, "rename");
    else if (action === "ai-device-pause") mutateAiDevice(id, "pause");
    else if (action === "ai-device-resume") mutateAiDevice(id, "resume");
    else if (action === "ai-device-test") testAiDevice(id);
    else if (action === "ai-device-revoke") { state.aiRevokeId = id; render(); }
    else if (action === "ai-device-cancel-revoke") { state.aiRevokeId = null; render(); }
    else if (action === "ai-device-confirm-revoke") mutateAiDevice(id, "revoke");
    else if (action === "ai-pair-create") { state.aiCreatePairOpen = true; render(); }
    else if (action === "ai-pair-save") createAiPair();
    else if (action === "ai-pair-benchmark") benchmarkAiPair(id);
    else return false;
    return true;
  }

  function runAction(action, el) {
    if (!action) return;
    if (action.indexOf("ai-") === 0 && handleOwnerAiAction(action, el)) return;
    if (action.indexOf("open-bridge:") === 0) { openBridge(action.split(":")[1]); return; }
    /* Generation owns its own actions; everything else falls through. */
    if (window.CR.media.handleAction(action, el)) return;
    if (action === "home") setSurface("home");
    else if (action === "open-thread") { state.threadFilter = "all"; state.selectedThreadId = el && el.getAttribute("data-id"); go("#people:inbox:conversations"); }
    else if (action === "ai") setSurface("ai");
    else if (action === "ai-new-thread") { stopAiVoiceListening(true); stopAiVoiceSpeech(); createAiThread(); }
    else if (action === "ai-select-thread") { stopAiVoiceListening(true); stopAiVoiceSpeech(); state.selectedAiThreadId = el.getAttribute("data-id"); state.aiChatError = null; state.aiVoiceError = null; render(); }
    else if (action === "ai-send") { var aiInput = $("crAiComposer"); sendAiMessage(aiInput && aiInput.value, { inputMode: "text", speakReply: false }); }
    else if (action === "ai-attach") { var picker = $("crAiAttach"); if (picker) picker.click(); }
    else if (action === "ai-remove-attachment") { var at = Number(el && el.getAttribute("data-index")); if (Number.isInteger(at) && at >= 0) state.aiAttachments.splice(at, 1); render(); }
    else if (action === "ai-browser-toggle") { state.aiAllowBrowser = !state.aiAllowBrowser; render(); }
    else if (action === "ai-voice-toggle") { if (state.aiVoiceListening) { stopAiVoiceListening(false); render(); } else startAiVoiceTurn(); }
    else if (action === "ai-stop-speaking") { stopAiVoiceSpeech(); render(); }
    else if (action === "ai-speak-message") { var voiceMessage = aiMessageById(el && el.getAttribute("data-id")); if (voiceMessage && voiceMessage.role === "assistant") speakAiText(voiceMessage.content); }
    else if (action === "work-inbox") setSurface("work", "inbox");
    else if (action === "work-desk-bot") setSurface("work", "desk-bot");
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
    else if (action === "create-funding") setSurface("create", "funding");
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
    else if (action === "apps") setSurface("apps");
    else if (action === "goto-failed") { state.jobFilter = "failed"; setSurface("system", "workload"); }
    else if (action === "goto-waiting") {
      state.threadFilter = "inbound";
      var waiting = state.threads.filter(function (t) { return threadInQueue(t, "inbound"); })[0];
      if (waiting) state.selectedThreadId = waiting.id;
      setSurface("work", "inbox");
    }
    else if (action === "refresh") load(true);
    else if (action === "dismiss-notice") { state.notice = null; render(); }
    else if (action === "reload-control") location.reload();
    else if (action === "hero-command") handleCommand($("crHeroInput") && $("crHeroInput").value);
    else if (action === "command-plan") {
      var planBox = $("crSystemCommand"), planText = planBox && planBox.value.trim();
      if (planText) submitCoreTask(planText);
    }
    else if (action === "command-ai") {
      var aiBox = $("crSystemCommand"), aiText = aiBox && aiBox.value.trim();
      if (!aiText || !state.org) return;
      state.commandResult = { kind: "ai", task: { status: "queueing" } }; render();
      callCoreTool("ai.chat", aiChatRequest(aiText, [])).then(function (queued) {
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
    else if (action === "retry-publish" || action === "cancel-publish") {
      var publishJobId = el.getAttribute("data-id");
      var publishAction = action === "retry-publish" ? "retry" : "cancel";
      if (!state.org || !state.org.id) {
        state.pending["publishMoveError:" + publishJobId] = badResult("failed", "Workspace identity is unavailable.", 400);
        inspectPublish(publishJobId);
        return;
      }
      state.pending["publishMove:" + publishJobId] = true;
      delete state.pending["publishMoveError:" + publishJobId];
      inspectPublish(publishJobId);
      src(request("/v1/social/publish/" + encodeURIComponent(publishJobId) + "/" + publishAction, {
        method: "POST",
        body: { org_id: state.org.id }
      })).then(function (result) {
        delete state.pending["publishMove:" + publishJobId];
        if (!result.ok) {
          state.pending["publishMoveError:" + publishJobId] = result;
          inspectPublish(publishJobId);
          return;
        }
        delete state.pending["publishMoveError:" + publishJobId];
        var moved = result.data && result.data.publish_job;
        var current = findById(state.publishJobs, publishJobId);
        if (moved && current) Object.assign(current, moved);
        inspectPublish(publishJobId);
        render();
      });
    }
    else if (action === "inspect-request") inspectRequest(el.getAttribute("data-id"));
    else if (action === "inspect-observation") inspectObservation(el.getAttribute("data-id"));
    else if (action === "load-observability") loadObservability(true);
    else if (action === "observability-older") loadObservability(false, true);
    else if (action === "observe-errors") { state.observabilityFilters.level = "error"; state.observability = null; setSurface("system", "observability"); }
    else if (action === "observe-trace") openTrace({ trace_id: el.getAttribute("data-trace") });
    else if (action === "observe-resource") openTrace({ resource_type: el.getAttribute("data-resource-type"), resource_id: el.getAttribute("data-resource-id") });
    else if (action === "close-trace") { state.observabilityTrace = null; render(); }
    else if (action === "inspect-trace-event") inspectObservation(el.getAttribute("data-id"));
    else if (action === "inspect-audit") inspectAudit(el.getAttribute("data-id"));
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
      /* Records are created through the Worker's /v1/work routes
         (js/control-room/work-records.js); the legacy CRM creator is no
         longer the way in. */
      if (window.CR.work) window.CR.work.openForm(state.workView);
      else openInspector({ title: "Create a record", description: "The Work records module did not load, so nothing can be created from here right now.", tabs: ["overview"] });
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
    else if (action === "save-media-budget") {
      var budgetOrgId = state.org && state.org.id;
      var enabledBox = $("crMediaBudgetEnabled");
      var amountBox = $("crMediaBudgetUsd");
      var warnBox = $("crMediaBudgetWarn");
      var amountText = amountBox ? amountBox.value.trim() : "";
      var amountUsd = amountText === "" ? null : Number(amountText);
      var warnPercent = warnBox ? Number(warnBox.value) : 80;
      if (!budgetOrgId) {
        state.pending.mediaBudgetError = badResult("failed", "Workspace identity is unavailable.", 400);
        render();
        return;
      }
      if (amountUsd !== null && (!Number.isFinite(amountUsd) || amountUsd < 0)) {
        state.pending.mediaBudgetError = badResult("failed", "Monthly limit must be a non-negative dollar amount.", 400);
        render();
        return;
      }
      if (!Number.isInteger(warnPercent) || warnPercent < 1 || warnPercent > 100) {
        state.pending.mediaBudgetError = badResult("failed", "Warning threshold must be from 1 to 100.", 400);
        render();
        return;
      }
      var enabledBudget = Boolean(enabledBox && enabledBox.checked);
      if (enabledBudget && amountUsd === null) {
        state.pending.mediaBudgetError = badResult("failed", "Enter a monthly limit before enabling the cap.", 400);
        render();
        return;
      }
      state.pending.mediaBudgetSave = true;
      delete state.pending.mediaBudgetError;
      render();
      src(request("/v1/media/budget?org_id=" + encodeURIComponent(budgetOrgId), {
        method: "PATCH",
        body: {
          enabled: enabledBudget,
          monthly_limit_cents: amountUsd === null ? null : Math.round(amountUsd * 100),
          warn_at_percent: warnPercent
        }
      })).then(function (result) {
        delete state.pending.mediaBudgetSave;
        if (!result.ok) state.pending.mediaBudgetError = result;
        else {
          delete state.pending.mediaBudgetError;
          if (state.resources) state.resources.budget = result;
        }
        render();
      });
    }
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
    else if (action === "inspect-media-job") { inspectMediaJob(el.getAttribute("data-id")); }
    else if (action === "inspect-generated-asset") { inspectAsset(el.getAttribute("data-id")); }
    else if (action === "inspect-decision") { inspectDecision(el.getAttribute("data-id")); }
    else if (action === "decision-status") {
      var decisionId = el.getAttribute("data-id");
      var decisionStatus = el.getAttribute("data-status");
      var decisionNote = $("crDecisionNote") && $("crDecisionNote").value.trim();
      state.pending["decision:" + decisionId] = true;
      delete state.pending["decisionError:" + decisionId];
      inspectDecision(decisionId);
      src(request("/v1/ai/decisions/" + encodeURIComponent(decisionId) + "/status" + (state.org && state.org.id ? "?org_id=" + encodeURIComponent(state.org.id) : ""), {
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
    if (window.CR.productReadiness) window.CR.productReadiness.bind($("crSurface"), { request: request, orgId: state.org && state.org.id });
    bindActions($("crSurface"));
    window.CR.media.bind($("crSurface"));
    if (window.CR.workTools) window.CR.workTools.bind($("crSurface"));
    if (window.CR.deskBot) window.CR.deskBot.bind($("crSurface"));
    if (window.CR.socialCompose) window.CR.socialCompose.bind($("crSurface"));
    if (window.CR.instagram) window.CR.instagram.bind($("crSurface"));
    if (window.CR.musicOps) window.CR.musicOps.bind($("crSurface"));
    if (window.CR.actionNetwork) window.CR.actionNetwork.bind($("crSurface"));
    if (window.CR.fundingIntelligence) window.CR.fundingIntelligence.bind($("crSurface"));
    if (window.CR.clipping) window.CR.clipping.bind($("crSurface"));
    if (window.CR.songTest) window.CR.songTest.bind($("crSurface"));
    if (window.CR.buildCode) window.CR.buildCode.bind($("crSurface"));
    if (window.CR.frontPage) window.CR.frontPage.bind($("crSurface"));
    /* a NAV mount point whose module has registered binds its own view */
    var slotMod = state.leaf && state.leaf.leaf.renderer === "slot" && window.CR[state.leaf.leaf.module];
    if (slotMod && typeof slotMod.bind === "function") slotMod.bind($("crSurface"), { request: request, orgId: state.org && state.org.id });
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

    /* Observability filters: level, kind and window are server queries; the
       text box narrows what is already loaded without a round trip. */
    [["crObsLevel", "level"], ["crObsKind", "kind"], ["crObsWindow", "window"]].forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.addEventListener("change", function () {
        state.observabilityFilters[pair[1]] = pair[1] === "window" ? Number(el.value) || 24 : el.value;
        loadObservability(true);
      });
    });
    var obsSearch = $("crObsSearch");
    if (obsSearch) obsSearch.addEventListener("input", function () {
      state.observabilityFilters.q = obsSearch.value;
      clearTimeout(state.pending.obsSearchTimer);
      state.pending.obsSearchTimer = setTimeout(function () {
        render();
        var again = $("crObsSearch");
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 200);
    });

    /* These chips were rendered before but never bound, so the workload
       filters looked live and did nothing. They filter state now. */
    document.querySelectorAll("[data-order-type]").forEach(function (b) {
      b.addEventListener("click", function () { state.orderType = b.getAttribute("data-order-type"); render(); });
    });
    document.querySelectorAll("[data-order-phase]").forEach(function (b) {
      b.addEventListener("click", function () { state.orderPhase = b.getAttribute("data-order-phase"); render(); });
    });
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
    var aiAttach = $("crAiAttach");
    if (aiAttach) aiAttach.addEventListener("change", function () { addAiAttachments(aiAttach.files); });
    var aiHistory = $("crAiHistory");
    if (aiHistory) aiHistory.addEventListener("toggle", function () { if (aiHistory.isConnected) state.aiHistoryOpen = aiHistory.open; });
    var aiTools = $("crAiComposeTools");
    if (aiTools) { aiTools.open = state.aiToolsOpen; aiTools.addEventListener("toggle", function () { if (aiTools.isConnected) state.aiToolsOpen = aiTools.open; }); }
    var aiSearch = $("crAiHistorySearch");
    if (aiSearch) aiSearch.addEventListener("input", function () {
      state.aiHistorySearch = aiSearch.value;
      var query = aiSearch.value.trim().toLowerCase();
      document.querySelectorAll("[data-ai-history-search]").forEach(function (item) { item.hidden = query && item.getAttribute("data-ai-history-search").indexOf(query) < 0; });
    });
    var aiModel = $("crAiModel");
    if (aiModel) aiModel.addEventListener("change", function () { state.aiImplementation = aiModel.value; render(); });
    var aiDevice = $("crAiDevice");
    if (aiDevice) aiDevice.addEventListener("change", function () { state.aiRouteSelection = aiDevice.value; state.aiChatError = null; render(); });
    var aiComposerInput = $("crAiComposer");
    if (aiComposerInput) {
      aiComposerInput.value = state.aiChatDraft || "";
      aiComposerInput.addEventListener("input", function () { state.aiChatDraft = aiComposerInput.value; if (state.selectedAiThreadId) state.aiDrafts[state.selectedAiThreadId] = aiComposerInput.value; });
      aiComposerInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          var send = document.querySelector('[data-action="ai-send"]');
          if (send && !send.disabled) send.click();
        }
      });
    }
    if (state.search) filterCurrentView(state.search);
  }

  /* Which workspace this console is operating on, answered by the server.

     This was supa("orgs?slug=eq.mccluster&select=id,slug,name&limit=1") —
     a hardcoded slug, so Control Room could only ever open the house.
     A second tenant's operator got a console with no org, every scoped
     read silently empty, and nothing on screen saying why. */
  /* WORKSPACE. The owner may hold several (the house plus client
     workspaces). The chosen one rides in ?org= so a reload or a shared link
     keeps it, with localStorage as a per-viewer fallback; it is only honoured
     when it is one of the caller's own enabled memberships. Every scoped read
     and write below uses state.org.id. */
  var ORG_KEY = "mcc.control.org";
  function preferredOrgId() {
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(location.search).get("org"); } catch (e) { fromUrl = null; }
    if (fromUrl) return fromUrl;
    try { return window.localStorage.getItem(ORG_KEY); } catch (e) { return null; }
  }
  function isHouseWorkspace(org) { return Boolean(org) && org.slug === "mccluster" && org.kind === "studio"; }
  /* Answers which workspace a load is for. It writes nothing: load() commits
     the list with everything else, at its commit boundary. */
  function discoverWorkspace(signal) {
    return src(request("/v1/workspaces/me", { signal: signal })).then(function (result) {
      var data = dataOf(result);
      var list = (data && data.workspaces) || [];
      var wanted = preferredOrgId();
      var chosen = null;
      for (var i = 0; i < list.length; i++) {
        if (wanted && list[i].org_id === wanted && list[i].enabled) { chosen = list[i]; break; }
      }
      for (var j = 0; !chosen && j < list.length; j++) {
        if (list[j].org_id === data.default_org_id) chosen = list[j];
      }
      if (!chosen) {
        chosen = list.filter(function (w) { return w.enabled; })[0] || null;
      }
      return {
        source: result,
        workspaces: list,
        membership: chosen,
        org: chosen ? { id: chosen.org_id, slug: chosen.slug, name: chosen.name, kind: chosen.kind, role: chosen.role } : null
      };
    });
  }
  /* Switching reloads Control on the new workspace, so no module can carry
     another tenant's cached rows across. */
  function switchWorkspace(orgId) {
    var known = (state.workspaces || []).some(function (w) { return w.org_id === orgId && w.enabled; });
    if (!known || (state.org && state.org.id === orgId)) return;
    try { window.localStorage.setItem(ORG_KEY, orgId); } catch (e) { /* storage blocked: ?org= still carries it */ }
    var url = new URL(location.href);
    url.searchParams.set("org", orgId);
    location.assign(url.toString());
  }
  function renderWorkspaceSwitcher() {
    var wrap = $("crOrgWrap"), select = $("crOrgSelect");
    if (!wrap || !select) return;
    var list = (state.workspaces || []).filter(function (w) { return w.enabled || (state.org && w.org_id === state.org.id); });
    if (list.length < 2) { wrap.hidden = true; return; }
    select.innerHTML = list.map(function (w) {
      return '<option value="' + esc(w.org_id) + '"' + (state.org && w.org_id === state.org.id ? " selected" : "") + '>' +
        esc((w.name || w.slug || "Workspace") + " · " + (w.role || "member")) + '</option>';
    }).join("");
    wrap.hidden = false;
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

  function loadCreative(org, signal) {
    var orgId = org && org.id;
    var scope = orgId ? "&org_id=eq." + encodeURIComponent(orgId) : "";
    var opts = { signal: signal };
    return Promise.all([
      src(supa("media_assets?select=*&order=created_at.desc&limit=150" + scope, opts)),
      src(supa("media_jobs?select=*&order=created_at.desc&limit=120" + scope, opts)),
      src(supa("social_campaigns?select=*&order=created_at.desc&limit=100" + scope, opts)),
      src(supa("social_variants?select=*&order=created_at.desc&limit=200" + scope, opts)),
      src(supa("social_publish_jobs?select=*&order=scheduled_at.desc&limit=200" + scope, opts)),
      src(supa("social_posts?select=*&order=published_at.desc&limit=200" + scope, opts))
    ]).then(function (r) {
      return { mediaAssets: r[0], mediaJobs: r[1], campaigns: r[2], variants: r[3], publishJobs: r[4], posts: r[5] };
    });
  }

  /* CONTROL AUTHORITY GENERATION. One lifecycle for the whole default shell,
     not only the opt-in ?workspace=1 presentation (audit A1, 2026-11-09;
     close-out 2026-11-10).

     - The generation is the stored session's subject. Sign-out, another
       account in another tab, a page restored from the back/forward cache
       into another account, and a session that ends inside this tab (a
       refused token refresh) each move it.
     - Moving it resets every per-account field of `state` to a fresh page's
       value (everything but the shell's place, SHELL_KEYS) and clears the
       shell's DOM that held account data, synchronously, before anything
       can render again. Unsent drafts belong to the account and go too.
     - Every private read goes through request() or supa(): the shell's,
       every per-view loader's, every action's and every module's that was
       handed them. A read carries the generation it was made under; its
       outcome (data or failure) is never delivered once the generation has
       moved, so nothing can commit it, and the generation's reads are
       aborted when it ends.
     - A page that has held one account's data is never reused for another.
       A sign-out shows the gate. One that no module heard (another tab, a
       restored page, a session that ended in this tab) also replaces the
       page, and so does any sign-in after a sign-out, or another account
       while the page is open. Reloading is the only conceal that also
       reaches the module caches outside this file (analytics, work records,
       media and the rest), as switchWorkspace already does for a workspace;
       the account menu's own sign-out reloads after its in-tab event.
     - A same-account token refresh keeps the subject, so it keeps the
       generation, the reads in flight and the unsent drafts.
     - load() commits only if it is still the newest load of the current
       generation, principal and selected workspace. An older load is
       dropped without touching what a newer one committed. */
  var authority = { gen: 0, principal: undefined, abort: null, scope: null, seq: 0, held: false, spent: false, reloading: false };
  function jwtSubject(token) {
    try {
      var raw = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (raw.length % 4) raw += "=";
      var payload = JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(raw), function (c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      }).join("")));
      return payload && payload.sub ? String(payload.sub) : null;
    } catch (e) { return null; }
  }
  function principalOf(token) { return token ? (jwtSubject(token) || "opaque") : null; }
  function storedPrincipal() {
    var raw = null;
    try { raw = window.localStorage.getItem("mccdb_session"); } catch (e) { raw = null; }
    if (!raw) return null;
    try { var s = JSON.parse(raw); return s && s.access_token ? principalOf(s.access_token) : null; } catch (e) { return null; }
  }
  function authorityOrg() {
    var org = null;
    try { org = preferredOrgId(); } catch (e) { org = null; }
    return org || null;
  }
  function authoritySnapshot() { return { gen: authority.gen, principal: storedPrincipal(), org: authorityOrg() }; }
  function authorityHolds(snap) {
    return snap.gen === authority.gen && snap.principal === storedPrincipal() && snap.org === authorityOrg();
  }
  /* The token for a private read made under generation `gen`. No token, or a
     token for another subject, means the session changed without an event
     this tab heard: the generation is reconciled first, so the read is never
     sent, or answered, for the wrong account. */
  function tokenFor(gen) {
    return token().then(function (t) {
      var who = principalOf(t);
      if (authority.principal !== undefined && who !== authority.principal) reconcileAuthority(null);
      if (!t) throw new Error("signed out");
      if (gen !== authority.gen || (authority.principal !== undefined && who !== authority.principal)) throw new Error("The signed-in account changed.");
      authority.held = true;
      return t;
    });
  }
  /* Delivers a read's outcome only while its generation is current;
     otherwise it never settles, so no caller can commit it. */
  function fenced(gen, promise) {
    function never() { return new Promise(function () {}); }
    return promise.then(function (value) { return gen === authority.gen ? value : never(); },
      function (error) { if (gen !== authority.gen) return never(); throw error; });
  }
  /* A read runs under its caller's signal (a load's) and the generation's,
     so ending the generation aborts every read it started. */
  function readSignal(own) {
    if (typeof AbortController !== "function") return own;
    if (!authority.scope) authority.scope = new AbortController();
    var scope = authority.scope.signal;
    if (!own) return scope;
    return typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function" ? AbortSignal.any([own, scope]) : own;
  }
  /* The shell's place survives an account change; nothing else in `state`. */
  var SHELL_KEYS = ["route", "leaf", "section", "surface", "workView", "createView", "systemView", "analyticsSection", "analyticsApplied", "health", "publicRecord"];
  function concealPrivateState() {
    if (authority.abort) { try { authority.abort.abort(); } catch (e) {} authority.abort = null; }
    if (authority.scope) { try { authority.scope.abort(); } catch (e) {} authority.scope = null; }
    stopAiVoiceListening(true); stopAiVoiceSpeech();
    clearTimeout(leadSearchTimer); leadSearchTimer = null;
    if (state.pending && state.pending.obsSearchTimer) clearTimeout(state.pending.obsSearchTimer);
    var fresh = JSON.parse(STATE_TEMPLATE);
    Object.keys(state).forEach(function (k) { if (SHELL_KEYS.indexOf(k) < 0 && !(k in fresh)) delete state[k]; });
    Object.keys(fresh).forEach(function (k) { if (SHELL_KEYS.indexOf(k) < 0) state[k] = fresh[k]; });
    transcriptInflight = {};
    closeInspector(); closeMore();
    /* closeInspector() only hides it: its title, subtitle and tabs still
       name the record that was open. */
    ["crInspectorBody", "crInspectorTabs", "crPaletteResults", "crOrgSelect"].forEach(function (id) { var node = $(id); if (node) node.innerHTML = ""; });
    var title = $("crInspectorTitle"); if (title) title.textContent = "Details";
    var sub = $("crInspectorSub"); if (sub) sub.textContent = "McCluster Admin Home";
    var input = $("crPaletteInput"); if (input) input.value = "";
    var palette = $("crPalette"); if (palette) { palette.classList.remove("is-open"); palette.setAttribute("aria-hidden", "true"); }
    var wrap = $("crOrgWrap"); if (wrap) wrap.hidden = true;
    var menu = $("crAccountMenu"); if (menu) menu.classList.remove("is-open");
  }
  /* Says why, wherever the viewer is looking: the gate's note and the shell. */
  function announce(text, reload) {
    state.error = text; state.notice = { text: text, reload: Boolean(reload) };
    note(text);
  }
  var NOTICE_KEY = "mcc.control.notice";
  /* Replaces a page that held one account's data instead of reusing it.
     `after` rides across the reload so the next page can say why; `gate`
     marks a line that belongs on the sign-in gate only. */
  function reloadControl(text, after, gate) {
    announce(text);
    if (authority.reloading) return;
    authority.reloading = true;
    try { if (after) window.sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ text: after, gate: Boolean(gate), at: Date.now() })); } catch (e) {}
    try { location.reload(); } catch (e) {}
  }
  function takeCarriedNotice() {
    var raw = null;
    try { raw = window.sessionStorage.getItem(NOTICE_KEY); if (raw) window.sessionStorage.removeItem(NOTICE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var carried = JSON.parse(raw);
      if (!carried || !carried.text || Date.now() - Number(carried.at || 0) > 120000) return;
      if (carried.gate) note(String(carried.text));
      else { announce(String(carried.text)); state.error = null; }
    } catch (e) {}
  }
  /* Called on every account-lifecycle signal. Returns true when the
     principal changed (or a sign-out was signalled) and the page was
     concealed. */
  function reconcileAuthority(detail) {
    var now = storedPrincipal(), before = authority.principal;
    /* An in-tab sign-out event: every module on the page heard it too. */
    var signalled = Boolean(detail && detail.signed_in === false);
    if (!signalled && now === before) return false;
    authority.gen += 1; authority.principal = now;
    if (authority.held) authority.spent = true;
    concealPrivateState();
    if (signalled || now === null) {
      var app = $("crApp"), gate = $("cpGate");
      if (app) app.hidden = true;
      if (gate) gate.hidden = false;
      announce("Signed out. Sign in to open Admin Home.");
      /* A sign-out no module heard (another tab, a restored page, a session
         that ended inside this tab) leaves their caches full: replace the page. */
      if (!signalled && authority.spent) reloadControl("Signed out. Sign in to open Admin Home.", "Signed out. Sign in to open Admin Home.", true);
    } else if (authority.spent) {
      if (before) reloadControl("Account changed. Reloading Admin Home for the account now signed in.", "Account changed. Admin Home was reloaded for the account now signed in.");
      else reloadControl("Reloading Admin Home for the account now signed in.");
    }
    try { render(); } catch (e) {}
    return true;
  }
  function bindAuthorityLifecycle() {
    authority.principal = storedPrincipal();
    takeCarriedNotice();
    window.addEventListener("mcc:auth-changed", function (e) { reconcileAuthority(e && e.detail); });
    window.addEventListener("storage", function (e) { if (!e || e.key === null || e.key === "mccdb_session") reconcileAuthority(null); });
    window.addEventListener("pageshow", function (e) { if (e && e.persisted) reconcileAuthority(null); });
  }
  function load(force) {
    /* A concealed page (spent) loads nothing again: it is replaced instead. */
    if (authority.reloading || authority.spent) return Promise.resolve();
    if (state.loading && !force) return Promise.resolve();
    if (force) state.notice = null;
    state.loading = true; state.error = null; render();
    var snap = authoritySnapshot();
    if (authority.principal === undefined) authority.principal = snap.principal;
    var seq = authority.seq += 1;
    if (authority.abort) { try { authority.abort.abort(); } catch (e) {} }
    var ac = typeof AbortController === "function" ? new AbortController() : null;
    authority.abort = ac;
    var signal = ac ? ac.signal : undefined;
    var health = src(fetch(API + "/health", { cache: "no-store", signal: signal }).then(function (r) {
      if (!r.ok) throw Object.assign(new Error("Edge health returned HTTP " + r.status), { status: r.status });
      return r.json();
    }));
    var publicRecord = loadPublicRecord();
    var authed = token().then(function (t) {
      if (!t) return { signedOut: true };
      /* The token that answers must belong to the principal this load was
         started for. A refreshed token for the same subject passes. */
      if (principalOf(t) !== snap.principal) return { stale: true };
      authority.held = true;
      return discoverWorkspace(signal).then(function (ws) {
        var org = ws.org;
        /* No workspace is a state to render, not an exception to throw.
           The old code reached straight for org.id and died on a
           TypeError, which surfaced as a generic console error. */
        if (!org) return { workspace: ws, org: null };
        return Promise.all([
          src(request("/v1/core", { signal: signal })),
          src(coreMcp("tools/list", {}, { signal: signal })),
          src(callCoreTool("core.resume", { org_id: org.id, since_hours: 24, limit: 25 }, { signal: signal })),
          src(request("/v1/status", { signal: signal })), src(request("/v1/apps", { signal: signal })), src(request("/v1/ai/status", { signal: signal })), src(request("/v1/ai/system-health", { signal: signal })),
          src(request("/v1/ai/decisions?limit=25&org_id=" + encodeURIComponent(org.id), { signal: signal })),
          src(request("/v1/comms/threads?limit=100", { signal: signal })), src(supa(leadQueryPath(LEAD_PAGE, 0), { count: true, prefer: "count=exact", signal: signal })),
          src(supa("site_requests?select=*&order=created_at.desc&limit=100", { signal: signal })),
          src(supa("ops_agent_jobs?select=*&org_id=eq." + encodeURIComponent(org.id) + "&order=created_at.desc&limit=200", { signal: signal })),
          src(supa("ops_ai_threads?select=*&org_id=eq." + encodeURIComponent(org.id) + "&status=eq.active&order=last_message_at.desc&limit=100", { signal: signal })),
          loadCreative(org, signal),
          src(request("/v1/audit/recent?limit=25&org_id=" + encodeURIComponent(org.id), { signal: signal }))
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
      /* A newer load, or a newer account, owns the page now: this result is
         dropped without touching anything that belongs to it. */
      if (seq !== authority.seq || snap.gen !== authority.gen) return;
      var a = r[1] || {}; var c = a.creative || {};
      /* The commit boundary: a result read for a principal or a workspace
         that is no longer the stored one is discarded, never rendered. An
         account that changed without an event this tab heard is reconciled
         here (gate or reload); a workspace switched in another tab ends this
         generation's reads and says so. */
      if (a.stale || (a.signedOut && snap.principal !== null) || !authorityHolds(snap)) {
        if (reconcileAuthority(null)) return;
        authority.gen += 1;
        concealPrivateState();
        if (snap.org !== authorityOrg()) announce("The selected workspace changed in another tab while Admin Home was loading. Reload Admin Home to open it.", true);
        else announce("Admin Home could not confirm the signed-in account. Reload Admin Home.", true);
        return;
      }
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
      state.workspaces = (a.workspace && a.workspace.workspaces) || [];
      state.health = dataOf(state.sources.health); state.publicRecord = dataOf(state.sources.publicRecord); state.org = a.org || null; renderWorkspaceSwitcher(); loadRecentErrors();
      /* Refresh re-reads the per-view sources too, not just the shell's. */
      if (force && state.musicOrders) loadMusicOrders(true);
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
      state.aiThreadOffset = state.aiThreads.length; state.aiThreadHasMore = state.aiThreads.length === 100;
      if (state.selectedAiThreadId && !aiThreadById(state.selectedAiThreadId)) state.selectedAiThreadId = null;
      if (!state.selectedAiThreadId && state.aiThreads.length) state.selectedAiThreadId = state.aiThreads[0].id;
      state.mediaAssets = rowsOf(state.sources.mediaAssets); state.mediaJobs = rowsOf(state.sources.mediaJobs);
      state.campaigns = rowsOf(state.sources.campaigns); state.variants = rowsOf(state.sources.variants);
      state.publishJobs = rowsOf(state.sources.publishJobs); state.posts = rowsOf(state.sources.posts);
      state.refreshedAt = new Date().toISOString();
      state.error = state.sources.status.ok ? null : state.sources.status.message || "Operator status unavailable";
    }).catch(function (e) { if (seq === authority.seq && snap.gen === authority.gen) state.error = e.message || "Control Room state unavailable"; })
      .then(function () {
        /* Only the newest load ends the loading state it started. */
        if (seq !== authority.seq) return;
        if (authority.abort === ac) authority.abort = null;
        state.loading = false; render();
      });
  }

  function boot() {
    if (authority.reloading) return;
    /* A page that already held one account's data opens no second session:
       signing in again reloads it. */
    if (authority.spent) { reloadControl("Opening Admin Home for the account now signed in."); return; }
    authority.held = true;
    $("cpGate").hidden = true; $("crApp").hidden = false; readHash(); setHash(true); render(); load();
  }
  function bindAuth() {
    $("cpIn").addEventListener("click", function () { var em = $("cpEmail").value.trim(), pw = $("cpPass").value; if (!em) { note("Email first.", true); return; } if (!pw) { note("Password required.", true); return; } var b = $("cpIn"); b.disabled = true; b.textContent = "Opening…"; window.MCC_AUTH.signInPassword(em, pw).then(boot).catch(function (e) { b.disabled = false; b.textContent = "Open Control Room"; note(String(e && e.message || e), true); }); });
    $("cpPass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("cpIn").click(); });
  }
  function bindShell() {
    var sheet = $("crMoreSheet");
    if (sheet) sheet.addEventListener("click", function (e) { if (e.target === sheet) closeMore(); });
    $("crCommandOpen").addEventListener("click", openPalette);
    $("crInspectorClose").addEventListener("click", closeInspector);
    $("crInspectorTabs").addEventListener("click", function (e) { var b = e.target.closest("[data-inspector-tab]"); if (!b || !state.inspector) return; state.inspector.tab = b.getAttribute("data-inspector-tab"); renderInspector(); });
    $("crPalette").addEventListener("click", function (e) { if (e.target === $("crPalette")) closePalette(); });
    $("crPaletteInput").addEventListener("input", function () { renderPalette($("crPaletteInput").value); });
    var orgSelect = $("crOrgSelect");
    if (orgSelect) orgSelect.addEventListener("change", function () { switchWorkspace(orgSelect.value); });
    $("crPaletteInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = $("crPaletteResults").querySelector("[data-palette-route],[data-action]"); if (first) first.click(); else handleCommand($("crPaletteInput").value); } });
    $("crAccount").addEventListener("click", function () { $("crAccountMenu").classList.toggle("is-open"); });
    $("crRefresh").addEventListener("click", function () { $("crAccountMenu").classList.remove("is-open"); load(true); });
    $("crOut").addEventListener("click", function () { window.MCC_AUTH.signOut().then(function () { location.reload(); }); });
    document.addEventListener("click", function (e) { if (!$("crAccountMenu").contains(e.target) && !$("crAccount").contains(e.target)) $("crAccountMenu").classList.remove("is-open"); });
    document.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); } if (e.key === "Escape") { if ($("crPalette").classList.contains("is-open")) closePalette(); else if ($("crMoreSheet") && !$("crMoreSheet").hidden) { closeMore(); if ($("crMore")) $("crMore").focus(); } else closeInspector(); } });
    window.addEventListener("hashchange", function () {
      if (location.hash === state.route) return;
      var before = state.surface;
      readHash(); setHash(true);
      if (before === "ai" && state.surface !== "ai") { stopAiVoiceListening(true); stopAiVoiceSpeech(); state.aiEnrollment = null; state.aiEnrollmentReveal = false; state.aiAddDeviceOpen = false; }
      state.selectedProjectId = null; closeInspector(); closeMore(); render();
    });
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
  if (window.CR.deskBot) window.CR.deskBot.init({ render: render, workspace: function () { return state.org; }, ready: function () { return Boolean(state.refreshedAt || state.error); } });
  if (window.CR.socialCompose) window.CR.socialCompose.init({ request: request, render: render });
  if (window.CR.instagram) window.CR.instagram.init({ request: request, render: render, org: function () { return state.org; } });
  if (window.CR.musicOps) window.CR.musicOps.init({ supa: supa, render: render });
  if (window.CR.actionNetwork) window.CR.actionNetwork.init({ supa: supa, request: request, render: render });
  if (window.CR.fundingIntelligence) window.CR.fundingIntelligence.init({ request: request, render: render });
  if (window.CR.clipping) window.CR.clipping.init({ supa: supa, render: render, org: function () { return state.org; } });
  if (window.CR.work) window.CR.work.init({
    request: request, render: render,
    orgId: function () { return state.org && state.org.id; },
    leads: function () { return state.leads || []; },
    refreshLeads: function () { runLeadQuery(false); }
  });
  if (window.CR.songTest) window.CR.songTest.init({ supa: supa, render: render });
  if (window.CR.buildCode) window.CR.buildCode.init({ request: request, render: render, orgId: function () { return state.org && state.org.id; } });
  if (window.CR.frontPage) window.CR.frontPage.init({ request: request, render: render });

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

  function init() { state.aiHistoryOpen = Boolean(window.matchMedia && window.matchMedia("(min-width:960px)").matches); bindAuthorityLifecycle(); bindAuth(); bindShell(); bindActions(document); tryResume(); setTimeout(tryResume, 700); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
