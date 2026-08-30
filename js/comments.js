/* ============================================================
   THE ROOM: fans speak under the work.
   Mount with <div data-comments="subject"></div> (subject falls
   back to the page's filename). World reads; signed-in fans write
   (instant accounts count); the owner can sweep anything.
   If the table isn't live yet, the room says so and stays calm.
   ============================================================ */
(function () {
  "use strict";
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var OWNER = "matthew@mccluster.org";

  var mounts = document.querySelectorAll("[data-comments]");
  if (!mounts.length) return;

  var esc = function (x) { var d = document.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; };
  function ago(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    if (m < 1440) return Math.round(m / 60) + "h";
    return Math.round(m / 1440) + "d";
  }
  function me() { return (window.MCC_AUTH && MCC_AUTH.user && MCC_AUTH.user()) || null; }
  function isOwner() { var u = me(); return !!(u && (u.email || "").toLowerCase() === OWNER); }

  var CSS = document.createElement("style");
  CSS.textContent =
    '.cmroom{position:relative;z-index:2;max-width:44rem;margin:2.5rem auto 0;padding:0 clamp(1.1rem,4vw,2rem) 8rem;font-family:var(--ui,Manrope,sans-serif)}' +
    '.cmroom h3{font-weight:800;font-size:.7rem;letter-spacing:.3em;text-transform:uppercase;color:#e5383b;margin:0 0 .9rem}' +
    '.cm{border-radius:16px;padding:.8rem .95rem;margin-bottom:.55rem;background:linear-gradient(180deg,var(--glass-hi,rgba(255,255,255,.08)),var(--glass-lo,rgba(255,255,255,.03)));box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}' +
    '.cm b{font-weight:800;font-size:.84rem;color:var(--cream,#f2e9db)}' +
    '.cm .wh{float:right;font-weight:700;font-size:.68rem;color:var(--cream-dim,#a08f81)}' +
    '.cm p{margin:.3rem 0 0;font-weight:600;font-size:.88rem;line-height:1.5;color:var(--cream,#f2e9db)}' +
    '.cm .rm{margin-top:.4rem;-webkit-appearance:none;appearance:none;border:0;cursor:pointer;background:transparent;color:#e8a68a;font-weight:800;font-size:.68rem;padding:0}' +
    '.cmroom textarea,.cmroom input{width:100%;-webkit-appearance:none;appearance:none;border:0;margin-top:.5rem;font-family:inherit;font-weight:600;font-size:1rem;color:var(--cream,#f2e9db);border-radius:13px;padding:.75rem .9rem;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.13)}' +
    '.cmroom .go{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;touch-action:manipulation;margin-top:.6rem;font-family:inherit;font-weight:800;font-size:.88rem;color:#fff;background:var(--metal,#e5383b);border-radius:100px;padding:.75rem 1.5rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.6)}' +
    '.cmroom .note{font-weight:600;font-size:.8rem;color:var(--cream-dim,#a08f81);margin:.6rem 0 0}' +
    '.cmroom .note a{color:var(--cream,#f2e9db);font-weight:800}' +
    /* DAYLIGHT. Most of this room already turns with the house, because it
       asks for --cream and --cream-dim. Three things did not: the heading
       red, the remove button's peach, and every white hairline holding a
       card or a field together. On the bone coat the hairlines went white
       on white — the comment box lost its outline and the text field
       stopped looking like somewhere you could type. */
    'html[data-theme="light"] .cmroom h3{color:#a4101a}' +
    'html[data-theme="light"] .cm{box-shadow:inset 0 0 0 1px rgba(26,20,13,.12)}' +
    'html[data-theme="light"] .cm .rm{color:#9c4a24}' +
    'html[data-theme="light"] .cmroom textarea,html[data-theme="light"] .cmroom input{' +
      'background:rgba(255,255,255,.75);box-shadow:inset 0 0 0 1px rgba(26,20,13,.22)}';
  document.head.appendChild(CSS);

  mounts.forEach(function (mount) { room(mount); });

  function room(mount) {
    var subject = mount.getAttribute("data-comments") || location.pathname.split("/").pop() || "index.html";
    mount.innerHTML = '<div class="cmroom"><h3>The comments</h3><div data-list><p class="note">Opening the comments…</p></div><div data-write></div></div>';
    var list = mount.querySelector("[data-list]");
    var write = mount.querySelector("[data-write]");

    function load() {
      fetch(SB_URL + "/rest/v1/comments?subject=eq." + encodeURIComponent(subject) + "&select=id,at,uid,name,body&order=at.desc&limit=100", {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then(function (rows) {
        var u = me();
        list.innerHTML = rows.length ? rows.map(function (c) {
          var mine = u && u.id === c.uid;
          var flagMail = "mailto:matthew@mccluster.org?subject=" +
            encodeURIComponent("Flag a comment: " + c.id) +
            "&body=" + encodeURIComponent("This comment should be reviewed:\n\n“" + c.body + "” by " + c.name + "\n\nWhy: ");
          return '<div class="cm" data-id="' + c.id + '"><span class="wh">' + ago(c.at) + "</span><b>" + esc(c.name) + "</b>" +
            "<p>" + esc(c.body) + "</p>" +
            ((mine || isOwner()) ? '<button class="rm" type="button" data-rm>Take it back</button>'
              : '<a class="rm" href="' + flagMail + '" title="Report this comment to the desk">Flag</a>') + "</div>";
        }).join("") : '<p class="note">No one’s spoken yet. The first word is yours.</p>';
      }).catch(function () {
        list.innerHTML = '<p class="note">The comments open soon.</p>';
        write.innerHTML = "";
      });
    }

    function paintWrite() {
      var u = me();
      if (!u) {
        write.innerHTML = '<p class="note"><a href="account.html">Sign in</a> to speak. It takes one tap, no password.</p>';
        return;
      }
      var kept = "";
      try { kept = localStorage.getItem("mcc_fan_name") || ""; } catch (e) {}
      write.innerHTML =
        '<input name="cmName" placeholder="Your name" maxlength="60" value="' + esc(kept) + '">' +
        '<textarea name="cmBody" rows="3" maxlength="800" placeholder="Say it. It goes on the record."></textarea>' +
        '<button class="go" type="button" data-send>Post it &#8594;</button>' +
        '<p class="note" data-err hidden></p>';
    }

    mount.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-send]")) {
        var name = (mount.querySelector('[name="cmName"]') || {}).value || "";
        var body = (mount.querySelector('[name="cmBody"]') || {}).value || "";
        name = name.trim(); body = body.trim();
        var err = mount.querySelector("[data-err]");
        if (!name || !body) { err.textContent = "A name and the words, that’s all it takes."; err.hidden = false; return; }
        try { localStorage.setItem("mcc_fan_name", name); } catch (x) {}
        var btn = mount.querySelector("[data-send]");
        btn.disabled = true; btn.textContent = "Posting…";
        window.MCC_SUPA.token().then(function (t) {
          return fetch(SB_URL + "/rest/v1/comments", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + t, Prefer: "return=minimal" },
            body: JSON.stringify({ subject: subject, name: name, body: body }),
          });
        }).then(function (r) {
          if (!r.ok) throw new Error(r.status);
          if (window.MCC_TRACK) window.MCC_TRACK("comment_post", { subject: subject });
          mount.querySelector('[name="cmBody"]').value = "";
          btn.disabled = false; btn.textContent = "Post it →";
          load();
        }).catch(function () {
          btn.disabled = false; btn.textContent = "Post it →";
          err.textContent = "That didn’t land. Try again in a second.";
          err.hidden = false;
        });
        return;
      }
      var rm = e.target.closest && e.target.closest("[data-rm]");
      if (rm) {
        var id = rm.closest(".cm").getAttribute("data-id");
        window.MCC_SUPA.token().then(function (t) {
          return fetch(SB_URL + "/rest/v1/comments?id=eq." + id, {
            method: "DELETE",
            headers: { apikey: SB_KEY, Authorization: "Bearer " + t },
          });
        }).then(function () { load(); });
      }
    });

    load();
    paintWrite();
    setTimeout(paintWrite, 900); // the magic-link landing settles a beat after load
  }
})();
