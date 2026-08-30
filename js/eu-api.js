/* ============================================================
   EU — the Equity Uprise platform's data layer.

   Every Equity Uprise page (topics, fellowships, profile, dashboard,
   the desk) talks to THIS object and never to storage directly. Same
   law as js/backend.js, one floor up: features call an interface, the
   interface decides where the answer comes from.

   IT DOES NOT OWN A SESSION. Sign-in already lives in js/backend.js —
   window.MCC_SUPA hands out the project URL, the public anon key, and a
   fresh access token. A second auth system in the same house is two
   places for a permission bug to hide, so this file borrows and never
   builds. Load backend.js first; this degrades to signed-out reads if
   you don't.

   THE FALLBACK IS THE POINT. matthew.mccluster.org is a static site. A
   topic hub that renders nothing until a database answers is a topic hub
   that renders nothing on the first paint, on a bad train connection,
   and on the day the site deploys before the migration runs. So reads
   fall back to data/eu-topics.json and data/eu-fellowships.json, which
   are exported from the same seed (tools/eu-export-seed.sh). The
   database is preferred whenever it answers, because the desk edits the
   database, never the JSON.

   The anon key is public by design. Row Level Security in the database
   is the wall — see supabase/migrations/0017. No secret belongs here.
   ============================================================ */
window.EU = (function () {
  "use strict";

  var SUPA = window.MCC_SUPA || null;
  var ROOT = (function () {
    /* walls/ and closet/ live one level down; data/ is at the top */
    var p = location.pathname;
    return /\/(walls|closet|tracks|demos)\//.test(p) ? "../" : "";
  })();

  function url(path) { return SUPA ? SUPA.url + "/rest/v1/" + path : null; }

  /* ---------- reads that do not need a person ---------- */
  /* anon key only: RLS decides the rows, the key just gets us in the door */
  function pub(path) {
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return fetch(url(path), { headers: { apikey: SUPA.key, Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("eu " + r.status); return r.json(); });
  }

  /* ---------- reads and writes as the signed-in person ---------- */
  function auth(path, opts) {
    opts = opts || {};
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return SUPA.token().then(function (t) {
      if (!t) throw new Error("signed out");
      var h = { apikey: SUPA.key, Authorization: "Bearer " + t, "Content-Type": "application/json" };
      if (opts.prefer) h.Prefer = opts.prefer;
      return fetch(url(path), {
        method: opts.method || "GET",
        headers: h,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("eu " + r.status)); });
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    });
  }

  /* the front door: a stranger may speak. Insert-only, no read-back —
     the same shape as the CRM's lead drop in js/crm.js. */
  function drop(table, row) {
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return (SUPA.token ? SUPA.token() : Promise.resolve(null)).catch(function () { return null; })
      .then(function (t) {
        var h = { apikey: SUPA.key, "Content-Type": "application/json", Prefer: "return=minimal" };
        if (t) h.Authorization = "Bearer " + t;
        return fetch(url(table), { method: "POST", headers: h, body: JSON.stringify(row) });
      })
      .then(function (r) { if (!r.ok) throw new Error("eu " + r.status); return true; });
  }

  function rpc(fn, args) {
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return (SUPA.token ? SUPA.token() : Promise.resolve(null)).catch(function () { return null; })
      .then(function (t) {
        var h = { apikey: SUPA.key, "Content-Type": "application/json" };
        if (t) h.Authorization = "Bearer " + t;
        return fetch(SUPA.url + "/rest/v1/rpc/" + fn, { method: "POST", headers: h, body: JSON.stringify(args || {}) });
      })
      .then(function (r) { if (!r.ok) throw new Error("rpc " + r.status); return r.json(); });
  }

  /* ---------- the static mirror ---------- */
  var seedCache = {};
  function seed(name) {
    if (seedCache[name]) return seedCache[name];
    seedCache[name] = fetch(ROOT + "data/" + name + ".json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    return seedCache[name];
  }

  /* Database first, mirror second, and say which one answered so a page
     can be honest about it ("showing the shipped list" vs live). */
  function preferLive(live, fallback) {
    return live.then(function (rows) {
      if (rows && rows.length) return { rows: rows, live: true };
      return fallback().then(function (rows2) { return { rows: rows2 || [], live: false }; });
    }).catch(function () {
      return fallback().then(function (rows2) { return { rows: rows2 || [], live: false }; });
    });
  }

  /* ============================================================
     TOPICS
     ============================================================ */
  function topics() {
    return preferLive(
      pub("eu_topics?status=eq.active&select=*&order=ordinal.asc"),
      function () { return seed("eu-topics").then(function (j) { return j && j.topics; }); }
    );
  }

  function topic(slug) {
    return topics().then(function (res) {
      var hit = null;
      res.rows.forEach(function (t) { if (t.slug === slug) hit = t; });
      return hit;
    });
  }

  /* ============================================================
     PERSPECTIVES — what people said
     ============================================================ */
  /* Signed in is not the same as having a profile. eu_perspectives.profile_id
     is a foreign key into eu_profiles, so attaching a bare auth id — which
     is what "the user is signed in" gives you — fails the insert outright
     for anyone who has spoken before they ever filled a profile in. That is
     the common case, not the edge one. So the id is used only once a
     profile row is known to exist, and the perspective is filed
     unattached otherwise. Resolved once per page. */
  var profileKnown = null;
  function attachableId() {
    var id = uid();
    if (!id) return Promise.resolve(null);
    if (profileKnown === null) {
      profileKnown = auth("eu_profiles?id=eq." + id + "&select=id")
        .then(function (rows) { return !!(rows && rows.length); })
        .catch(function () { return false; });
    }
    return profileKnown.then(function (yes) { return yes ? id : null; });
  }

  function speak(p) {
    /* status is fixed here and enforced again by the insert policy: a
       perspective always lands in the queue, never straight on a page */
    return attachableId().then(function (id) {
      return dropPerspective(p, id);
    });
  }

  function dropPerspective(p, id) {
    return drop("eu_perspectives", {
      profile_id: id,
      topic_slug: p.topic_slug,
      body: String(p.body || "").slice(0, 8000),
      answers: p.answers || {},
      priority: p.priority || 3,
      display_name: p.anonymous ? "" : String(p.display_name || "").slice(0, 120),
      region: String(p.region || "").slice(0, 80),
      contact_email: String(p.contact_email || "").slice(0, 200),
      anonymous: !!p.anonymous,
      consent_public: p.consent_public !== false,
      source: p.source || "web",
      status: "new",
    });
  }

  function voices(topicSlug, limit) {
    var q = "eu_perspectives_public?select=*&order=created_at.desc&limit=" + (limit || 20);
    if (topicSlug) q += "&topic_slug=eq." + encodeURIComponent(topicSlug);
    return pub(q).catch(function () { return []; });
  }

  function counts() {
    return pub("eu_counts?select=*").then(function (r) { return r && r[0]; }).catch(function () { return null; });
  }

  /* ============================================================
     THE DIRECTORY
     ============================================================ */
  function fellowships(opts) {
    opts = opts || {};
    var q = "eu_fellowships?status=eq.published&select=*&order=deadline.asc.nullslast&limit=" + (opts.limit || 100);
    if (opts.topic) q += "&topic_slugs=cs.{" + encodeURIComponent(opts.topic) + "}";
    if (opts.tag) q += "&focus_tags=cs.{" + encodeURIComponent(opts.tag) + "}";
    return preferLive(
      pub(q),
      function () {
        return seed("eu-fellowships").then(function (j) {
          var rows = (j && j.fellowships) || [];
          if (opts.topic) rows = rows.filter(function (f) { return (f.topic_slugs || []).indexOf(opts.topic) > -1; });
          if (opts.tag) rows = rows.filter(function (f) { return (f.focus_tags || []).indexOf(opts.tag) > -1; });
          return rows;
        });
      }
    );
  }

  function sources() {
    return preferLive(
      pub("eu_fellowship_sources?active=eq.true&select=*&order=id.asc"),
      function () { return seed("eu-fellowships").then(function (j) { return j && j.sources; }); }
    );
  }

  /* Scored recommendations, with reasons. p_extra lets a signed-out
     visitor be matched from tags they ticked on the page — no account
     required to get a real answer. */
  function match(tags, limit) {
    return rpc("eu_match_fellowships", { p_profile: null, p_limit: limit || 12, p_extra: tags || [] })
      .catch(function () { return []; });
  }

  /* A host lists their own program. It lands pending whatever we send —
     the database coerces it (0017, eu_fellowships_guard). */
  function listFellowship(f) {
    return auth("eu_fellowships", {
      method: "POST",
      prefer: "return=representation",
      body: {
        slug: String(f.slug || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80),
        title: f.title, org: f.org || "", summary: f.summary || "", description: f.description || "",
        url: f.url || "", apply_url: f.apply_url || "",
        focus_tags: f.focus_tags || [], topic_slugs: f.topic_slugs || [], audience: f.audience || [],
        location: f.location || "", region: f.region || "", remote: !!f.remote,
        stipend: f.stipend || "", duration: f.duration || "", eligibility: f.eligibility || "",
        deadline_note: f.deadline_note || "", cost: f.cost || "free",
        status: "pending", source: "host",
      },
    });
  }

  /* ============================================================
     PROFILES — public to read, private to control
     ============================================================ */
  function uid() { return SUPA && SUPA.uid ? SUPA.uid() : null; }

  function me() {
    if (!uid()) return Promise.resolve(null);
    return auth("eu_profiles?id=eq." + uid() + "&select=*")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; })
      .catch(function () { return null; });
  }

  function profile(handle) {
    return pub("eu_profiles_public?handle=eq." + encodeURIComponent(String(handle).toLowerCase()) + "&select=*")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; })
      .catch(function () { return null; });
  }

  function directory(limit) {
    return pub("eu_profiles_public?select=*&order=created_at.desc&limit=" + (limit || 60)).catch(function () { return []; });
  }

  /* Upsert: the first save creates the row, later ones patch it. The
     role column is deliberately not settable from here — the trigger
     would ignore it anyway, and sending it would only teach the next
     reader that it works. */
  function saveProfile(p) {
    var id = uid();
    if (!id) return Promise.reject(new Error("signed out"));
    var row = {
      id: id,
      handle: p.handle, display_name: p.display_name,
      kind: p.kind || "person",
      headline: p.headline || "", bio: p.bio || "",
      location: p.location || "", region: p.region || "",
      show_location: !!p.show_location,
      links: p.links || [], interests: p.interests || [],
      goals: p.goals || "", open_to: p.open_to || [],
      visibility: p.visibility || "public",
    };
    if (p.role === "host") row.role = "host";   /* self-claimable; listings are moderated anyway */
    return auth("eu_profiles?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: row,
    });
  }

  function contact() {
    if (!uid()) return Promise.resolve(null);
    return auth("eu_profile_contact?id=eq." + uid() + "&select=*")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; })
      .catch(function () { return null; });
  }

  function saveContact(c) {
    var id = uid();
    if (!id) return Promise.reject(new Error("signed out"));
    return auth("eu_profile_contact?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        id: id, email: c.email || "", phone: c.phone || "",
        email_optin: !!c.email_optin, sms_optin: !!c.sms_optin,
        contact_note: c.contact_note || "", updated_at: new Date().toISOString(),
      },
    });
  }

  /* ============================================================
     SAVES AND THE APPLICATION TRACKER
     ============================================================ */
  function saves() {
    if (!uid()) return Promise.resolve([]);
    return auth("eu_saves?select=fellowship_id,at&order=at.desc").catch(function () { return []; });
  }

  function save(fellowshipId, on) {
    var id = uid();
    if (!id) return Promise.reject(new Error("signed out"));
    if (on === false) {
      return auth("eu_saves?profile_id=eq." + id + "&fellowship_id=eq." + fellowshipId, { method: "DELETE" });
    }
    return auth("eu_saves?on_conflict=profile_id,fellowship_id", {
      method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: { profile_id: id, fellowship_id: fellowshipId },
    });
  }

  function applications() {
    if (!uid()) return Promise.resolve([]);
    return auth("eu_applications?select=*&order=updated_at.desc").catch(function () { return []; });
  }

  function track(a) {
    var id = uid();
    if (!id) return Promise.reject(new Error("signed out"));
    var row = {
      profile_id: id, fellowship_id: a.fellowship_id || null,
      title: a.title || "", stage: a.stage || "interested",
      due_on: a.due_on || null, notes: a.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (a.id) {
      return auth("eu_applications?id=eq." + a.id, { method: "PATCH", prefer: "return=representation", body: row });
    }
    return auth("eu_applications", { method: "POST", prefer: "return=representation", body: row });
  }

  function untrack(id) {
    return auth("eu_applications?id=eq." + id, { method: "DELETE" });
  }

  /* ============================================================
     THE CONVERSATION
     ============================================================ */
  function anonKey() {
    var k = null;
    try { k = localStorage.getItem("eu_anon"); } catch (e) {}
    if (!k) {
      k = "a" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem("eu_anon", k); } catch (e) {}
    }
    return k;
  }

  function converse(p) {
    if (!SUPA) return Promise.reject(new Error("no backend"));
    return (SUPA.token ? SUPA.token() : Promise.resolve(null)).catch(function () { return null; })
      .then(function (t) {
        var h = { "Content-Type": "application/json", apikey: SUPA.key };
        if (t) h.Authorization = "Bearer " + t;
        return fetch(SUPA.url + "/functions/v1/eu-converse", {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            conversation_id: p.conversation_id || null,
            topic: p.topic || null,
            message: p.message,
            anon_key: anonKey(),
          }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.error) throw new Error(j.error); return j; });
  }

  function threads() {
    if (!uid()) return Promise.resolve([]);
    return auth("eu_conversations?select=*&order=last_at.desc").catch(function () { return []; });
  }

  function messages(conversationId) {
    return auth("eu_messages?conversation_id=eq." + conversationId + "&select=*&order=at.asc")
      .catch(function () { return []; });
  }

  /* ============================================================
     THE DESK — staff only. Every call below is gated by RLS on the
     server; the pages just avoid drawing doors that would not open.
     ============================================================ */
  function role() {
    return rpc("eu_role", {}).then(function (r) { return typeof r === "string" ? r : "visitor"; })
      .catch(function () { return "visitor"; });
  }

  var desk = {
    queue: function () {
      return auth("eu_perspectives?status=eq.new&select=*&order=created_at.desc&limit=200");
    },
    moderate: function (id, status) {
      return auth("eu_perspectives?id=eq." + id, {
        method: "PATCH", prefer: "return=minimal", body: { status: status },
      });
    },
    pendingFellowships: function () {
      return auth("eu_fellowships?status=in.(pending,draft)&select=*&order=created_at.desc&limit=200");
    },
    setFellowship: function (id, patch) {
      return auth("eu_fellowships?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: patch });
    },
    conversations: function (status) {
      var q = "eu_conversations?select=*&order=last_at.desc&limit=200";
      if (status) q += "&status=eq." + status;
      return auth(q);
    },
    people: function () {
      return auth("eu_profiles?select=id,handle,display_name,role,status,created_at&order=created_at.desc&limit=200");
    },
    setRole: function (id, r) {   /* admin only — RLS + the guard trigger both refuse anyone else */
      return auth("eu_profiles?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: { role: r } });
    },
    audit: function () {
      return auth("eu_audit?select=*&order=at.desc&limit=100");
    },
    topics: function () {
      return auth("eu_topics?select=*&order=ordinal.asc");
    },
    setTopic: function (slug, patch) {
      return auth("eu_topics?slug=eq." + encodeURIComponent(slug), {
        method: "PATCH", prefer: "return=minimal", body: patch,
      });
    },
    log: function (action, entity, entityId, detail) {
      return rpc("eu_log", { p_action: action, p_entity: entity || "", p_entity_id: String(entityId || ""), p_detail: detail || {} });
    },
  };

  return {
    ready: SUPA ? Promise.resolve(true) : Promise.resolve(false),
    hasBackend: !!SUPA,
    uid: uid,
    role: role,
    topics: topics, topic: topic,
    speak: speak, voices: voices, counts: counts,
    fellowships: fellowships, sources: sources, match: match, listFellowship: listFellowship,
    me: me, profile: profile, directory: directory, saveProfile: saveProfile,
    contact: contact, saveContact: saveContact,
    saves: saves, save: save,
    applications: applications, track: track, untrack: untrack,
    converse: converse, threads: threads, messages: messages,
    desk: desk,
  };
})();
