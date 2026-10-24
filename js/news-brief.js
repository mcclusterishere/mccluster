/* THE MORNING BRIEF page (brief.html). Reads yesterday's per-country briefs from /v1/news-briefs
   (workers/mccluster/src/news-briefs.js), shows them with every source linked out, reads one live as a teleprompter,
   and publishes the version a person edits as their own World post. Nothing is published without that tap. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = { day: "", country: "", data: null, brief: null, timer: 0, speed: 3, playing: false, lock: null };
  var ALL = "AF AL DZ AO AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW".split(" ");

  function name(iso) { try { return new Intl.DisplayNames([navigator.language || "en"], { type: "region" }).of(iso) || iso; } catch (_) { return iso; } }
  function status(text, kind) { var s = $("nbStatus"); s.textContent = text || ""; s.dataset.kind = kind || ""; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(v) { try { var u = new URL(String(v)); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ""; } catch (_) { return ""; } }
  function nyYesterday() {
    var p = {}; new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - 864e5);
    return d.toISOString().slice(0, 10);
  }
  function api(path, init) {
    if (!window.MCC || !MCC.api) return Promise.reject(Object.assign(new Error("Sign in with your M Account to read the briefs."), { status: 401 }));
    return MCC.api(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw Object.assign(new Error(data.error || data.message || "Briefs are unavailable right now."), { status: res.status });
        return data;
      });
    });
  }
  /* "[3][17]" become links to the numbered sources; the words around them stay text */
  function cited(text, sources) {
    var byN = {}; (sources || []).forEach(function (s) { byN[s.n] = s; });
    return esc(text).replace(/\[(\d{1,3})\]/g, function (all, n) {
      var s = byN[n], url = s && safeUrl(s.url);
      return url ? '<a class="nb__cite" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow" title="' + esc(s.domain + ": " + s.title) + '">' + n + "</a>" : "";
    });
  }
  function spoken(text) { return String(text || "").replace(/\s*\[\d{1,3}\]/g, "").trim(); }
  function fillList(id, items, sources) { $(id).innerHTML = (items || []).map(function (t) { return "<li>" + cited(t, sources) + "</li>"; }).join(""); $(id).closest("section").hidden = !(items || []).length; }

  function paintCountries() {
    var mine = state.data && state.data.owner ? ALL : (state.data && state.data.countries) || [];
    var have = {}; (state.data && state.data.briefs || []).forEach(function (b) { have[b.country] = b; });
    var order = Object.keys(have).concat(mine.filter(function (c) { return !have[c]; }).sort(function (a, b) { return name(a).localeCompare(name(b)); }));
    $("nbCountry").innerHTML = order.map(function (iso) {
      var b = have[iso], tag = b ? (b.status === "done" ? "" : b.status === "failed" ? " · needs attention" : b.status === "no_coverage" ? " · no monitored coverage" : " · being written") : " · not asked for";
      return '<option value="' + esc(iso) + '">' + esc(name(iso) + tag) + "</option>";
    }).join("");
    if (!state.country || order.indexOf(state.country) < 0) state.country = order[0] || "";
    $("nbCountry").value = state.country;
  }
  function paintBrief() {
    var b = (state.data && state.data.briefs || []).filter(function (x) { return x.country === state.country; })[0] || null;
    state.brief = b && b.status === "done" ? b : null;
    $("nbBrief").hidden = !state.brief;
    $("nbAsk").hidden = !!state.brief || !state.country;
    if (!state.brief) {
      $("nbAskText").textContent = !b ? "No brief has been written for " + name(state.country) + " on " + state.day + "."
        : b.status === "no_coverage" ? "No usable headlines were retained for this edition. This does not mean nothing happened."
        : b.status === "failed" ? "The brief for " + name(state.country) + " needs review in Control after its bounded attempts." : "The brief for " + name(state.country) + " is being written. Check back in a few minutes.";
      $("nbAskGo").hidden = !!b;
      $("nbAskGo").textContent = b && b.status === "failed" ? "Try again" : "Write this brief";
      return;
    }
    $("nbMeta").textContent = name(b.country) + " · " + b.day + " · " + (b.timezone || "America/New_York") + " · from " + (b.headline_count || b.sources.length) + " monitored headlines · draft needs human review" + (b.late ? " · completed after deadline" : "") + (b.coverage && b.coverage.truncated ? " · source scan capped" : "");
    $("nbOverview").innerHTML = cited(b.overview, b.sources);
    fillList("nbHappened", b.happened, b.sources); fillList("nbMay", b.may_mean, b.sources); fillList("nbUncertain", b.uncertain, b.sources);
    $("nbSources").innerHTML = b.sources.map(function (s) {
      return '<li value="' + esc(s.n) + '"><a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(s.title) + "</a> <span>" + esc(s.domain) + "</span></li>";
    }).join("");
  }
  function load() {
    status("Opening the briefs…");
    return api("/v1/news-briefs?day=" + encodeURIComponent(state.day)).then(function (data) {
      state.data = data; status(""); paintCountries(); paintBrief(); loadLeads();
    }).catch(function (e) {
      $("nbBrief").hidden = true; $("nbAsk").hidden = true;
      status(e.status === 403 ? "Briefs are for the house owner and region leaders." : e.message, "error");
    });
  }
  function ask(again) {
    var go = again ? $("nbAgain") : $("nbAskGo"); go.disabled = true;
    api("/v1/news-briefs/request", { method: "POST", body: { country: state.country, day: state.day, again: !!again } }).then(function (r) {
      status(r.queued ? "Writing the brief for " + name(state.country) + " from " + r.headlines + " headlines. It takes a few minutes." : r.status === "no_coverage" ? "No monitored headlines were retained for this edition." : "This edition already exists. Its evidence snapshot is retained for review.");
      return load();
    }).catch(function (e) { status(e.message, "error"); }).finally(function () { go.disabled = false; });
  }

  /* -------- read it live -------- */
  // names said with "the": the United States, the United Kingdom, the Philippines…
  var THE = { US: 1, GB: 1, NL: 1, PH: 1, AE: 1, BS: 1, GM: 1, DO: 1, CF: 1, CD: 1, CG: 1, MV: 1, MH: 1, SB: 1, VA: 1, CZ: 0 };
  function said(iso) { return (THE[iso] ? "the " : "") + name(iso); }
  function prompterText(b) {
    var parts = ["Good morning. Here is what happened yesterday in " + said(b.country) + ".", spoken(b.overview)];
    if (b.happened.length) parts.push("What happened.", b.happened.map(spoken).join("\n\n"));
    if (b.may_mean.length) parts.push("What it may mean today.", b.may_mean.map(spoken).join("\n\n"));
    if (b.uncertain.length) parts.push("Still uncertain.", b.uncertain.map(spoken).join("\n\n"));
    parts.push("Sources are linked in the post. None of this is financial advice.");
    return parts.join("\n\n");
  }
  function tick() {
    var box = $("nbPrompterText");
    box.scrollTop += state.speed * 0.6;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) togglePlay(false);
  }
  function togglePlay(on) {
    state.playing = typeof on === "boolean" ? on : !state.playing;
    clearInterval(state.timer); if (state.playing) state.timer = setInterval(tick, 40);
    $("nbPlay").textContent = state.playing ? "Pause" : "Start"; $("nbPlay").setAttribute("aria-pressed", String(state.playing));
  }
  function setSpeed(d) { state.speed = Math.max(1, Math.min(9, state.speed + d)); $("nbSpeed").textContent = "Speed " + state.speed; }
  function openPrompter() {
    if (!state.brief) return;
    $("nbPrompterText").textContent = prompterText(state.brief); $("nbPrompterText").scrollTop = 0;
    $("nbPrompter").hidden = false; document.documentElement.classList.add("nb--live"); $("nbPlay").focus();
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { state.lock = l; }).catch(function () {}); } catch (_) {}
    if (window.MCC_TRACK) MCC_TRACK("brief_read_live", { country: state.brief.country, day: state.brief.day });
  }
  function closePrompter() {
    togglePlay(false); $("nbPrompter").hidden = true; document.documentElement.classList.remove("nb--live");
    try { if (state.lock) state.lock.release(); } catch (_) {} state.lock = null; $("nbLive").focus();
  }

  /* -------- publish as my post -------- */
  function postText(b) {
    var lines = [name(b.country) + ", " + b.day + ": what happened, and what it may mean today", "", spoken(b.overview)];
    if (b.happened.length) lines.push("", "What happened:", b.happened.slice(0, 6).map(function (t) { return "• " + spoken(t); }).join("\n"));
    if (b.may_mean.length) lines.push("", "What it may mean today:", b.may_mean.slice(0, 4).map(function (t) { return "• " + spoken(t); }).join("\n"));
    var domains = []; b.sources.forEach(function (s) { if (domains.indexOf(s.domain) < 0) domains.push(s.domain); });
    lines.push("", "From " + b.sources.length + " headlines (" + domains.slice(0, 6).join(", ") + (domains.length > 6 ? " and more" : "") + "). Not financial advice.");
    return lines.join("\n").slice(0, 2000);
  }
  function count() { var n = $("nbPostText").value.length; $("nbPostCount").textContent = n + " / 2000"; $("nbPublishGo").disabled = !n || n > 2000; }
  /* the headlines the brief cites, in the order it cites them; at most twelve go with a newsroom article */
  function citedSources(b) {
    var seen = {}, out = [];
    [b.overview].concat(b.happened, b.may_mean).join(" ").replace(/\[(\d{1,3})\]/g, function (_, n) {
      var s = b.sources.filter(function (x) { return String(x.n) === n; })[0];
      if (s && !seen[n] && out.length < 12) { seen[n] = true; out.push({ title: s.title, url: s.url }); }
      return _;
    });
    return out;
  }
  function openPublish() {
    if (!state.brief) return;
    $("nbPostText").value = postText(state.brief); count(); $("nbPublishStatus").textContent = "";
    // the newsroom is the house owner's: the Worker checks again (platform-api.js)
    $("nbNewsroomRow").hidden = !(state.data && state.data.owner);
    $("nbPublish").showModal(); $("nbPostText").focus();
  }
  function publish(ev) {
    ev.preventDefault();
    var body = $("nbPostText").value.trim(); if (!body) return;
    var news = !$("nbNewsroomRow").hidden && $("nbNewsroom").checked;
    var draft = { body: body, visibility: "public" };
    if (news) { draft.newsroom = true; draft.newsroom_note = "morning_brief"; draft.newsroom_sources = citedSources(state.brief); }
    $("nbPublishGo").disabled = true; $("nbPublishStatus").textContent = "Publishing…";
    api("/v1/mnet/posts?app_key=mnet-web", { method: "POST", body: draft }).then(function (out) {
      if (window.MCC_TRACK) MCC_TRACK("brief_published", { country: state.brief.country, day: state.brief.day, newsroom: news });
      $("nbPublish").close();
      var id = out && out.post && out.post.id;
      if (news && id && /^[0-9a-f-]{36}$/i.test(id)) {
        status("Published on the World feed under your name, and in the newsroom: ", "ok");
        var a = document.createElement("a"); a.href = "https://mccluster.org/news/" + id; a.target = "_blank"; a.rel = "noopener"; a.textContent = "read the article";
        $("nbStatus").appendChild(a);
      } else status("Published on the World feed under your name.", "ok");
    }).catch(function (e) { $("nbPublishStatus").textContent = e.message; }).finally(function () { $("nbPublishGo").disabled = false; });
  }

  /* -------- region leaders (house owner only) -------- */
  function loadLeads() {
    if (!state.data || !state.data.owner) { $("nbLeads").hidden = true; return; }
    $("nbLeads").hidden = false;
    if (!$("nbLeadCountry").options.length) $("nbLeadCountry").innerHTML = ALL.slice().sort(function (a, b) { return name(a).localeCompare(name(b)); })
      .map(function (iso) { return '<option value="' + iso + '">' + esc(name(iso)) + "</option>"; }).join("");
    api("/v1/news-briefs/leads").then(function (r) {
      if (!r.available) { $("nbLeadList").innerHTML = ""; $("nbLeadStatus").textContent = "Region leader management is not available yet."; $("nbLeadForm").hidden = true; return; }
      $("nbLeadForm").hidden = false;
      $("nbLeadList").innerHTML = r.leads.length ? r.leads.map(function (l) {
        return "<li>" + esc(l.name) + " · " + esc(name(l.country)) + ' <button class="nb__button" type="button" data-unlead="' + esc(l.m_uid) + '" data-country="' + esc(l.country) + '">Remove</button></li>';
      }).join("") : "<li>No region leaders yet.</li>";
    }).catch(function (e) { $("nbLeadStatus").textContent = e.message; });
  }
  function changeLead(method, body) {
    $("nbLeadStatus").textContent = method === "POST" ? "Granting…" : "Removing…";
    api("/v1/news-briefs/leads", { method: method, body: body }).then(function () {
      $("nbLeadStatus").textContent = method === "POST" ? "Granted." : "Removed."; $("nbLeadHandle").value = ""; loadLeads();
    }).catch(function (e) { $("nbLeadStatus").textContent = e.message; });
  }

  function boot() {
    $("nbLeadForm").addEventListener("submit", function (e) { e.preventDefault(); changeLead("POST", { handle: $("nbLeadHandle").value, country: $("nbLeadCountry").value }); });
    $("nbLeadList").addEventListener("click", function (e) { var b = e.target.closest("[data-unlead]"); if (b) changeLead("DELETE", { m_uid: b.getAttribute("data-unlead"), country: b.getAttribute("data-country") }); });
    var q=new URLSearchParams(location.search), day=q.get('day'); state.country=/^[A-Z]{2}$/.test(q.get('country')||'')?q.get('country'):''; state.day = /^\d{4}-\d{2}-\d{2}$/.test(day||'')&&day<=nyYesterday()?day:nyYesterday(); $("nbDay").value = state.day; $("nbDay").max = nyYesterday();
    var back=document.createElement("a");back.href="action-globe.html?explore=1&halo=intel&section=briefs&item=brief:"+encodeURIComponent(state.country);back.textContent="← Back to Halo briefs";$("nbTitle").before(back);
    $("nbDay").addEventListener("change", function () { if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) { state.day = this.value; load(); } });
    $("nbCountry").addEventListener("change", function () { state.country = this.value; paintBrief(); });
    $("nbAskGo").addEventListener("click", function () { ask(false); });
    $("nbAgain").addEventListener("click", function () { ask(true); });
    $("nbLive").addEventListener("click", openPrompter);
    $("nbPlay").addEventListener("click", function () { togglePlay(); });
    $("nbSlower").addEventListener("click", function () { setSpeed(-1); });
    $("nbFaster").addEventListener("click", function () { setSpeed(1); });
    $("nbDone").addEventListener("click", closePrompter);
    document.addEventListener("keydown", function (e) {
      if ($("nbPrompter").hidden) return;
      if (e.key === "Escape") closePrompter(); else if (e.key === " " && e.target === document.body) { e.preventDefault(); togglePlay(); }
    });
    $("nbPublishOpen").addEventListener("click", openPublish);
    $("nbPublishCancel").addEventListener("click", function () { $("nbPublish").close(); });
    $("nbPostText").addEventListener("input", count);
    $("nbPublishForm").addEventListener("submit", publish);
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
