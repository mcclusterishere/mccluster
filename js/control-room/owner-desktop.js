/* Typed WebView2 boundary for the signed-in McCluster owner chat. The page
   owns authentication. Only the bounded projections below leave the page. */
(function () {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const NODE = /^node_[0-9a-f]{24,64}$/;
  const MODELS = Object.freeze({
    "qwen3.8b.local": "qwen3:8b", "qwen3-vl.4b.local": "qwen3-vl:4b",
    "qwen3-vl.8b.local": "qwen3-vl:8b", "qwen3.14b.local": "qwen3:14b"
  });
  const TARGETS = ["ovh", "prime", "connected"];
  const FIELDS = {
    discover: [],
    stop: ["session_id", "thread_id", "turn_id", "target", "node_id", "implementation"],
    submit: ["session_id", "thread_id", "message_id", "target", "node_id", "implementation", "content"],
    get: ["session_id", "thread_id", "turn_id", "target", "node_id", "implementation"]
  };
  const failure = code => ({ status: "error", code });
  class BridgeError extends Error {}
  function requireValue(ok, code) { if (!ok) throw new BridgeError(code); }
  function validId(value, pattern) { return typeof value === "string" && value.length <= 80 && pattern.test(value); }
  function sameRoute(route, args) {
    return route && route.mode === "node" && route.target === args.target &&
      route.node_id === args.node_id && route.implementation === args.implementation;
  }
  function historyStatus(status) {
    if (["queued", "running"].includes(status)) return "pending";
    return ["done", "failed", "canceled"].includes(status) ? status : null;
  }
  function validArgs(op, args) {
    if (op === "history") {
      if (!args || typeof args !== "object" || Array.isArray(args) || !validId(args.session_id, UUID)) return false;
      const keys = Object.keys(args);
      return keys.every(key => key === "session_id" || key === "thread_id") &&
        (!Object.hasOwn(args, "thread_id") || validId(args.thread_id, UUID));
    }
    if (!Object.hasOwn(FIELDS, op) || !args || typeof args !== "object" || Array.isArray(args)) return false;
    const keys = Object.keys(args), fields = FIELDS[op];
    if (keys.length !== fields.length || !fields.every(key => Object.hasOwn(args, key))) return false;
    if (op === "discover") return true;
    if (!validId(args.thread_id, UUID) || !validId(args.session_id, UUID) ||
        !validId(args.node_id, NODE) || !TARGETS.includes(args.target) ||
        typeof args.implementation !== "string" || !Object.hasOwn(MODELS, args.implementation)) return false;
    return op !== "submit" ? validId(args.turn_id, UUID) :
      validId(args.message_id, UUID) && typeof args.content === "string" &&
      args.content.length <= 12000 && args.content.trim().length > 0;
  }
  function install(io) {
    const jobs = new Map();
    let session = null;
    function clear() {
      for (const job of jobs.values()) clearTimeout(job.timer);
      jobs.clear();
      session = null;
    }
    function identify() {
      const auth = io.access();
      if (!auth) { clear(); return null; }
      if (!session || session.principal !== auth.principal || session.org !== auth.org || session.gen !== auth.gen) {
        clear();
        session = { ...auth, id: io.uuid() };
      }
      return session;
    }
    async function execute(op, args, owner, check) {
      const org = owner.org;
      async function targets() {
        const support = await io.schema();
        check();
        const modes = support?.submit?.properties?.route?.properties?.target?.enum;
        if (!support?.canStop) return { targets: [], can_stop: false };
        requireValue(Array.isArray(modes) && TARGETS.every(key => modes.includes(key)), "UNSUPPORTED");
        const inventory = await io.devices(org);
        check();
        requireValue(Array.isArray(inventory?.devices), "UNAVAILABLE");
        const list = [];
        for (const device of inventory.devices) {
          if (!io.ready(device) || !validId(device.node_id, NODE) || !Array.isArray(device.models)) continue;
          for (const item of device.models) {
            if (item.ready !== true || item.target_ready !== true || !Object.hasOwn(MODELS, item.implementation) || item.model !== MODELS[item.implementation]) continue;
            list.push({ target: device.target, node_id: device.node_id, name: String(device.display_name || device.node_id).slice(0, 80),
              implementation: item.implementation, model: item.model });
            if (list.length === 64) return { targets: list, can_stop: true };
          }
        }
        return { targets: list, can_stop: true };
      }
      async function ownedThread() {
        const rows = await io.thread(org, args.thread_id);
        check();
        if (!Array.isArray(rows)) throw new BridgeError("UNAVAILABLE");
        if (!rows.length) return false;
        const t = rows[0];
        requireValue(rows.length === 1 && t.id === args.thread_id && t.org_id === org &&
          t.created_by === owner.principal && t.status === "active", "REJECTED");
        return true;
      }
      if (op === "discover") return { session_id: owner.id, ...await targets() };
      if (op === "history") {
        if (!args.thread_id) {
          const rows = await io.threads(org, owner.principal);
          requireValue(Array.isArray(rows), "UNAVAILABLE");
          const threads = rows.slice(0, 40).filter(t => validId(t.id, UUID) && t.org_id === org &&
            t.created_by === owner.principal && t.status === "active").map(t => ({
            thread_id: t.id, title: String(t.title || "New chat").slice(0, 160)
          }));
          return { threads };
        }
        requireValue(await ownedThread(), "REJECTED");
        const rows = await io.turns(org, owner.principal, args.thread_id);
        requireValue(Array.isArray(rows), "UNAVAILABLE");
        const turns = [];
        for (const row of rows.slice(0, 40).reverse()) {
          const route = row.route, status = historyStatus(row.status);
          if (row.org_id !== org || row.thread_id !== args.thread_id || row.role !== "user" || !validId(row.id, UUID) ||
              row.actor !== owner.principal || row.actor_kind !== "owner" || row.job !== row.id || route?.mode !== "node" ||
              !TARGETS.includes(route.target) || !validId(route.node_id, NODE) || !Object.hasOwn(MODELS, route.implementation) ||
              !status || typeof row.content !== "string" || row.content.length > 12000) continue;
          turns.push({ turn_id: row.id, target: route.target, node_id: route.node_id, name: route.node_id,
            implementation: route.implementation, model: MODELS[route.implementation], prompt: row.content, status });
        }
        return { thread_id: args.thread_id, turns };
      }

      if (op === "submit") {
        const available = await targets();
        requireValue(available.can_stop, "UNSUPPORTED");
        const list = available.targets;
        requireValue(list.some(t => t.target === args.target && t.node_id === args.node_id &&
          t.implementation === args.implementation), "UNAVAILABLE");
        if (!await ownedThread()) {
          check();
          await io.createThread(org, args.thread_id);
          check();
          requireValue(await ownedThread(), "REJECTED");
        }
        check();
        const route = { mode: "node", node_id: args.node_id, implementation: args.implementation, target: args.target };
        const accepted = await io.submit({ org_id: org, thread_id: args.thread_id, message_id: args.message_id,
          content: args.content.trim(), input_mode: "text", route });
        requireValue(accepted?.queued === true && accepted.thread_id === args.thread_id &&
          accepted.turn_id === args.message_id && accepted.user_message_id === args.message_id && sameRoute(accepted.route, args), "REJECTED");
        return { thread_id: args.thread_id, turn_id: args.message_id, status: "pending" };
      }
      requireValue(await ownedThread(), "REJECTED");
      const result = await io.get({ org_id: org, turn_id: args.turn_id });
      const job = result?.turn, user = result?.user_message, meta = user?.metadata;
      requireValue(job?.id === args.turn_id && job.org_id === org && job.job_type === "resident_ai_turn" &&
        user?.id === args.turn_id && user.org_id === org && user.thread_id === args.thread_id && user.role === "user" &&
        meta?.actor_user_id === owner.principal && meta.actor_kind === "owner" && meta.agent_job_id === args.turn_id &&
        sameRoute(meta.workspace_route, args), "REJECTED");
      const turn = { thread_id: args.thread_id, turn_id: args.turn_id };
      if (op === "stop") {
        requireValue(["queued", "running", "canceled"].includes(job.status), "REJECTED");
        check();
        const stopped = await io.stop({ org_id: org, turn_id: args.turn_id });
        requireValue(stopped?.stopped === true && stopped.status === "canceled" &&
          (!stopped.turn_id || stopped.turn_id === args.turn_id), "REJECTED");
        return { ...turn, status: "canceled" };
      }
      if (["queued", "running"].includes(job.status)) return { ...turn, status: "pending" };
      const reply = result.assistant_message, receipt = reply?.metadata, node = receipt?.node;
      if (job.status === "failed" || job.status === "canceled" || receipt?.inference === "refused") return { ...turn, status: "failed" };
      requireValue(job.status === "done" && reply?.role === "assistant" && reply.thread_id === args.thread_id &&
        reply.org_id === org && reply.id === job.input?.assistant_message_id && receipt?.agent_job_id === args.turn_id &&
        receipt.task_status === "done" && sameRoute(receipt.requested_route, args) && !receipt.fallback_reason &&
        node?.route === "fabric" && node.node_id === args.node_id && node.implementation === args.implementation &&
        reply.implementation === args.implementation && node.model === MODELS[args.implementation] && reply.model === node.model &&
        (args.target !== "prime" || node.hardware_mode === "gpu-verified") &&
        (args.target !== "ovh" || node.hardware_mode === "cpu-only") && validId(reply.compute_task_id, UUID) &&
        typeof reply.content === "string" && reply.content.length <= 30000 && reply.content.trim().length > 0, "REJECTED");
      return { ...turn, status: "done", target: args.target, node_id: node.node_id,
        node_name: String(node.node_name || node.node_id).slice(0, 80), implementation: node.implementation,
        model: node.model, hardware_mode: typeof node.hardware_mode === "string" ? node.hardware_mode.slice(0, 48) : null,
        compute_task_id: reply.compute_task_id, content: reply.content };
    }
    const api = Object.freeze({
      begin(id, op, input) {
        const owner = identify();
        if (!owner) return failure("OWNER_REQUIRED");
        if (!validId(id, UUID) || typeof op !== "string" || !validArgs(op, input)) return failure("REJECTED");
        if (op !== "discover" && input.session_id !== owner.id) return failure("CHANGED");
        if (jobs.has(id) || jobs.size >= 8) return failure("UNAVAILABLE");
        const args = { ...input }, job = { result: { status: "pending" }, expires: Date.now() + 60000 };
        jobs.set(id, job);
        job.timer = setTimeout(() => jobs.delete(id), 60000);
        function check() {
          requireValue(identify() === owner && jobs.get(id) === job && Date.now() < job.expires, "CHANGED");
        }
        execute(op, args, owner, check).then(value => {
          check(); job.result = { status: "ok", result: value };
        }).catch(error => {
          job.result = failure(error instanceof BridgeError ? error.message :
            error?.status === 401 || error?.status === 403 ? "OWNER_REQUIRED" : "UNAVAILABLE");
        });
        return { status: "pending" };
      },
      take(id) {
        if (!identify()) return failure("OWNER_REQUIRED");
        const job = validId(id, UUID) && jobs.get(id);
        if (!job || Date.now() >= job.expires) return failure("CHANGED");
        if (job.result.status !== "pending") { jobs.delete(id); clearTimeout(job.timer); }
        return job.result;
      }
    });
    return { api, clear };
  }
  window.CR = window.CR || {};
  window.CR.ownerDesktop = { install };
})();
