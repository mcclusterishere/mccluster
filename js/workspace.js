/* ============================================================
   THE WORKSPACE — which tenant this browser is operating on.

   Every backend room used to work this out for itself. studio.html ran
   its own org_members query, hardcoded the slug "mccluster", and parked
   the answer in localStorage.mcc_org_id; if that key was empty the whole
   media surface failed with no explanation. crm.html decided ownership
   by comparing a string the browser was holding. admin.html assumed the
   house because the house is the only tenant today.

   All three are the same bug wearing different clothes: the tenant was a
   BROWSER fact. A browser fact cannot be trusted by the server, cannot be
   checked, and cannot be handed to a second client — which is why none of
   those pages could be cloned for somebody else's shop.

   So the tenant is a SERVER fact now. This file asks /v1/workspaces/me
   once per page, and every room reads the answer from here.

   LOCALSTORAGE IS STILL USED, AND IT IS NOW ONLY A PREFERENCE. Somebody
   in two workspaces has to be able to switch and have the switch stick.
   So the chosen org is remembered — but it is VALIDATED against the
   server's list on every load, and silently dropped if the server does
   not agree the caller is in it. A stale or hand-edited key can no
   longer select a tenant; it can only fail to.

   THIS IS NOT THE AUTHORIZATION. Nothing here grants anything. The Worker
   checks membership again where the write actually happens. What this
   buys is that a page stops guessing, and that every page guesses the
   same way when it does.
   ============================================================ */
window.MCC_WORKSPACE = (function () {
  "use strict";

  var API = "https://api.mccluster.org";
  var PICK_STORE = "mcc_workspace_org";
  /* The key studio.html wrote. Read once for continuity so a person who
     had a workspace selected yesterday is not bounced to the default,
     then never written again. */
  var LEGACY_STORE = "mcc_org_id";

  var state = {
    ready: false,
    signedIn: false,
    profile: null,
    workspaces: [],
    orgId: null,
    role: null,
    error: null
  };
  var pending = null;
  var listeners = [];

  function store(read) {
    try { return read(); } catch (e) { return null; }
  }

  function token() {
    if (!window.MCC_SUPA || !window.MCC_SUPA.token) return Promise.resolve(null);
    return window.MCC_SUPA.token().catch(function () { return null; });
  }

  function remembered() {
    return store(function () { return localStorage.getItem(PICK_STORE); }) ||
           store(function () { return localStorage.getItem(LEGACY_STORE); }) || "";
  }

  function remember(orgId) {
    store(function () { localStorage.setItem(PICK_STORE, orgId); return 1; });
  }

  function forget() {
    store(function () { localStorage.removeItem(PICK_STORE); return 1; });
    store(function () { localStorage.removeItem(LEGACY_STORE); return 1; });
  }

  function find(orgId) {
    for (var i = 0; i < state.workspaces.length; i++) {
      if (state.workspaces[i].org_id === orgId) return state.workspaces[i];
    }
    return null;
  }

  function announce() {
    var snapshot = current();
    listeners.forEach(function (fn) {
      try { fn(snapshot); } catch (e) {}
    });
  }

  /* The selection, settled. A remembered choice wins only if the server
     still lists it and it is not switched off; otherwise the server's own
     default stands, and the stale key is cleared rather than left to
     mislead the next load. */
  function settle(payload) {
    state.profile = payload.profile || null;
    state.workspaces = payload.workspaces || [];
    state.signedIn = true;
    state.error = null;

    var wanted = remembered();
    var match = wanted ? find(wanted) : null;
    if (match && !match.enabled) match = null;
    if (wanted && !match) forget();

    var chosen = match || find(payload.default_org_id) || null;
    state.orgId = chosen ? chosen.org_id : null;
    state.role = chosen ? chosen.role : null;
    if (chosen) remember(chosen.org_id);
    state.ready = true;
    return current();
  }

  function signedOut(reason) {
    state.ready = true;
    state.signedIn = false;
    state.profile = null;
    state.workspaces = [];
    state.orgId = null;
    state.role = null;
    state.error = reason || null;
    return current();
  }

  function load() {
    return token().then(function (t) {
      if (!t) return signedOut(null);
      return fetch(API + "/v1/workspaces/me", {
        headers: { authorization: "Bearer " + t }
      }).then(function (r) {
        if (r.status === 401) return signedOut(null);
        if (!r.ok) throw new Error("workspace " + r.status);
        return r.json().then(settle);
      });
    }).catch(function (e) {
      /* A workspace that cannot be resolved is not the same as being
         signed out, and a room that treats it as such sends somebody to
         a login screen they do not need. Say which it is. */
      return signedOut(String((e && e.message) || e));
    }).then(function (snapshot) {
      announce();
      return snapshot;
    });
  }

  function current() {
    return {
      ready: state.ready,
      signedIn: state.signedIn,
      profile: state.profile,
      workspaces: state.workspaces.slice(),
      orgId: state.orgId,
      role: state.role,
      error: state.error
    };
  }

  /* Resolved once per page. Every room may call this; only the first call
     spends a request. */
  function ready() {
    if (!pending) pending = load();
    return pending;
  }

  function reload() {
    pending = load();
    return pending;
  }

  /* Switching workspaces. Refuses anything the server did not list, so a
     switcher cannot be talked into selecting a tenant the caller is not
     in — the request would be refused at the Worker anyway, but failing
     here means the page never renders as though it succeeded. */
  function select(orgId) {
    var match = find(orgId);
    if (!match || !match.enabled) return false;
    state.orgId = match.org_id;
    state.role = match.role;
    remember(match.org_id);
    announce();
    return true;
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  /* One authenticated call to the Worker with the workspace already on
     it, so no room has to remember to attach the org itself. */
  function api(path, options) {
    options = options || {};
    return ready().then(function () {
      return token();
    }).then(function (t) {
      if (!t) throw Object.assign(new Error("Not signed in"), { status: 401 });
      var headers = { "content-type": "application/json", authorization: "Bearer " + t };
      for (var k in options.headers || {}) headers[k] = options.headers[k];

      var url = API + path;
      var body = options.body;
      if (state.orgId) {
        if (body && typeof body === "object" && !(body instanceof String)) {
          if (body.org_id === undefined) body = Object.assign({}, body, { org_id: state.orgId });
        } else if (!body) {
          url += (url.indexOf("?") === -1 ? "?" : "&") + "org_id=" + encodeURIComponent(state.orgId);
        }
      }

      return fetch(url, {
        method: options.method || (body ? "POST" : "GET"),
        headers: headers,
        body: body && typeof body === "object" ? JSON.stringify(body) : body
      }).then(function (r) {
        return r.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
          if (!r.ok) {
            throw Object.assign(new Error((data && data.error) || ("request failed " + r.status)), {
              status: r.status, detail: data && data.detail
            });
          }
          return data;
        });
      });
    });
  }

  return {
    ready: ready,
    reload: reload,
    select: select,
    onChange: onChange,
    api: api,
    current: current,
    orgId: function () { return state.orgId; },
    role: function () { return state.role; },
    list: function () { return state.workspaces.slice(); },
    isOwner: function () { return state.role === "owner"; }
  };
})();
