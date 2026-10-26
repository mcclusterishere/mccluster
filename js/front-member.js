/* AN ACCOUNT'S FRONT PAGE, LOADED (front.html?u=<handle>).

   Owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this exact same experience ...
   my front page with a VR, with the scroll dependent video, all this."

   This reads the account's published page from the Worker (GET /v1/fronts/:handle), or, when the page sits in the
   account's own editor (front-studio.html, same origin), the draft the editor hands it. Then, before the scroll engine
   starts, it puts the account's words into the page (text only, never markup), its still, its soundtrack and its links,
   turns off any scene the account has no media for, and hands the settings to js/main.js as window.MCC_FRONT_SOURCE.
   The engine is the house page's own; it checks every value again as it reads it. */
(function (w, d) {
  "use strict";
  var API = "https://api.mccluster.org";
  var me = d.currentScript;
  var V = (function () { try { return new URL(me.src).searchParams.get("v") || ""; } catch (e) { return ""; } })();
  var params = new URLSearchParams(location.search);
  var handle = String(params.get("u") || "").toLowerCase();
  var HANDLE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
  var inStudio = false;
  try { inStudio = w.parent !== w && w.parent.location.origin === location.origin && /front-studio\.html$/.test(w.parent.location.pathname); } catch (e) {}
  d.documentElement.setAttribute("data-front-state", "loading");

  function text(el, v) { if (el) el.textContent = v == null ? "" : String(v); }
  function upper(v, max) { return String(v || "").toUpperCase().replace(/\s+/g, " ").trim().slice(0, max); }
  /* what an account that has typed nothing gets: its own name, its headline, its handle, and its profile */
  function words(page) {
    var c = page.config || {}, wd = c.words || {}, name = String(page.name || page.handle || "").trim();
    var parts = name.split(/\s+/), t1 = upper(parts[0] || page.handle, 14), t2 = upper(parts.slice(1).join(" "), 14);
    var profile = "mnet.html?view=profile&handle=" + encodeURIComponent(page.handle);
    return {
      eyebrow: wd.eyebrow || page.headline || "On McCluster",
      title1: wd.title1 || t1, title2: wd.title2 || (wd.title1 ? "" : t2),
      sub: wd.sub || "@" + page.handle,
      door1: wd.door1 || { label: "Follow me on the World", href: profile },
      door2: wd.door2 || null,
      gateKicker: wd.gateKicker || "360 · " + (name || page.handle),
      gateTitle: wd.gateTitle || "Look around.",
      gateLede: wd.gateLede || "Real 360 footage. It takes the page and your thumb while it plays, so it does not start until you say so.",
      cabinTag: wd.cabinTag || "360 · look around",
      nightKicker: wd.nightKicker || "Thanks for coming through",
      nightTitle1: wd.nightTitle1 || "STAY", nightTitle2: wd.nightTitle2 || (wd.nightTitle1 ? "" : "CLOSE"),
      links: Array.isArray(c.links) && c.links.length ? c.links : [{ label: "Follow me on the World", href: profile }],
      profile: safeHref(page.ownerHref) || profile
    };
  }
  /* a link stays on this site or is https (the same rule the Worker and js/main.js apply) */
  function safeHref(h) {
    h = typeof h === "string" ? h.trim() : "";
    if (/^https:\/\/[^\s"'<>]+$/i.test(h)) return h;
    return /^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[a-z0-9_./?#=&%-]+$/i.test(h) ? h : "";
  }
  function link(a, item) {
    var href = safeHref(item && item.href);
    if (!href) { a.hidden = true; return; }
    a.href = href;
    if (/^https:/i.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
  }
  function fill(page) {
    var t = words(page), c = page.config || {}, m = c.media || {};
    Array.prototype.forEach.call(d.querySelectorAll("[data-fw]"), function (el) { text(el, t[el.getAttribute("data-fw")]); });
    /* the hero's and the close's letters are built by the engine from data-word */
    Array.prototype.forEach.call(d.querySelectorAll("[data-fw-word]"), function (el) {
      var v = t[el.getAttribute("data-fw-word")] || "";
      el.setAttribute("data-word", v); text(el, v); el.hidden = !v;
    });
    Array.prototype.forEach.call(d.querySelectorAll("[data-fw-door]"), function (a) {
      var door = t[a.getAttribute("data-fw-door")];
      if (!door) { a.hidden = true; return; }
      text(a.querySelector("[data-fw-door-label]"), door.label);
      link(a, door);
    });
    Array.prototype.forEach.call(d.querySelectorAll("[data-fw-links]"), function (box) {
      box.textContent = "";
      t.links.forEach(function (item) { var a = d.createElement("a"); text(a, item.label); link(a, item); if (!a.hidden) box.appendChild(a); });
    });
    var prof = d.getElementById("frontProfile");
    if (prof) prof.href = t.profile;
    /* the still: the account's own, else its picture, behind a hero with no film */
    var still = d.getElementById("frontStill"), stillSrc = (m.still && m.still.src) || (!m.hero ? page.avatar : "");
    if (still && stillSrc) still.src = stillSrc;
    var audio = d.getElementById("track-whodidtheshoot");
    if (audio) {
      if (m.sound && m.sound.src) { var s = d.createElement("source"); s.src = m.sound.src; audio.appendChild(s); }
      else audio.parentNode.removeChild(audio);
    }
    d.title = (page.name || page.handle) + " · McCluster";
  }
  /* a scene the account has no media for is not shown: no empty film to scroll through */
  function settings(page) {
    var c = JSON.parse(JSON.stringify(page.config || {})), m = c.media || {};
    c.scenes = c.scenes || {};
    if (!m.scene1 && !m.scene2 && !m.cabin) c.scenes.vaunt = false;
    if (!m.night) c.scenes.night = false;
    c.scenes.world = true; // the shared World entry belongs to every public page
    return c;
  }
  function start(page) {
    fill(page);
    var config = settings(page);
    var project = w.MCC_FRONT_PROJECTS && w.MCC_FRONT_PROJECTS.get(params.get("project"));
    var isProject = !inStudio && project === page;
    if (isProject) {
      d.documentElement.setAttribute("data-front-project", params.get("project"));
      d.querySelectorAll('[data-project-detail]').forEach(function (el) { el.hidden = false; });
      var note = d.createElement('p'); note.className = 'front-project-note';
      note.textContent = 'Managed by ' + project.owner + '. ' + project.attribution;
      d.querySelector('.hero__content').appendChild(note);
      var profile = d.getElementById('frontProfile');
      profile.textContent = 'About ' + project.owner;
    }
    /* without the night film the close moves to the foot of the page */
    if (config.scenes.night === false) Array.prototype.forEach.call(d.querySelectorAll("[data-fw-foot]"), function (el) { el.hidden = false; });
    w.MCC_FRONT_SOURCE = { handle: page.handle, name: page.name || page.handle, config: config, studio: inStudio, project: isProject ? params.get("project") : null };
    d.documentElement.setAttribute("data-front-state", "ready");
    var s = d.createElement("script");
    s.src = "js/main.js" + (V ? "?v=" + encodeURIComponent(V) : "");
    d.body.appendChild(s);
  }
  function empty(title, why, links) {
    d.documentElement.setAttribute("data-front-state", "empty");
    var main = d.getElementById("top"); if (main) main.hidden = true;
    var foot = d.getElementById("frontFoot"); if (foot) foot.hidden = true;
    text(d.getElementById("frontEmptyTitle"), title);
    text(d.getElementById("frontEmptyText"), why);
    var box = d.getElementById("frontEmptyLinks");
    (links || []).forEach(function (item) { var a = d.createElement("a"); text(a, item.label); a.href = item.href; box.appendChild(a); });
    d.getElementById("frontEmpty").hidden = false;
  }

  if (inStudio) {
    /* the editor's preview: the draft comes from the editor itself, never from a URL */
    var asked = false;
    w.addEventListener("message", function (e) {
      if (e.origin !== location.origin || e.source !== w.parent || !e.data || e.data.type !== "mcc:front-draft" || asked) return;
      asked = true;
      var p = e.data.page;
      if (p && HANDLE.test(String(p.handle || ""))) start({ handle: p.handle, name: p.name, avatar: p.avatar, headline: p.headline, config: p.config || {} });
      else empty("Nothing to preview yet", "Your editor did not send a page.", []);
    });
    w.parent.postMessage({ type: "mcc:front-need-draft" }, location.origin);
    return;
  }
  if (params.has("project")) {
    var project = w.MCC_FRONT_PROJECTS && w.MCC_FRONT_PROJECTS.get(params.get("project"));
    if (project) start(project);
    else empty("No project here", "This link does not name a published project.", [{ label: "Matthew’s portfolio", href: "index.html" }]);
    return;
  }
  if (!HANDLE.test(handle)) { empty("No front page here", "This link does not name an account.", [{ label: "Make your own front page", href: "front-studio.html" }]); return; }
  fetch(API + "/v1/fronts/" + encodeURIComponent(handle), { headers: { accept: "application/json" }, credentials: "omit" })
    .then(function (r) { return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; }); })
    .then(function (res) {
      if (res.status === 200 && res.body && res.body.ok && res.body.config) { start(res.body); return; }
      var card = "member-front.html?handle=" + encodeURIComponent(handle) + "&card=1";
      if (res.status === 404) empty("No front page yet", "@" + handle + " has not published a front page.", [{ label: "See their profile", href: card }, { label: "Make your own front page", href: "front-studio.html" }]);
      else empty("This page cannot be read right now", "Try again in a moment.", [{ label: "See their profile", href: card }]);
    })
    .catch(function () { empty("This page cannot be read right now", "Try again in a moment.", [{ label: "See their profile", href: "member-front.html?handle=" + encodeURIComponent(handle) + "&card=1" }]); });
})(window, document);
