/* ============================================================
   THE DESK — the chat on this site.

   Of everything the owner asked to connect, this is the one channel
   that needs nobody's permission: no app review, no business
   verification, no per-message fee. A visitor is already here and
   already interested. docs/social-connections.md is the checked account
   of why the others are harder, and what each one actually allows.

   IT DOES NOT OWN A SESSION, and it does not want one. A visitor talking
   to the desk is anonymous: the widget mints a random key, keeps it in
   localStorage, and that key IS the identity. No email is asked for, no
   account is needed, nothing is set that a cookie banner would have to
   confess to. If the visitor clears their browser they are a new person,
   which is the correct trade for asking them for nothing.

   IT NEVER WRITES A MESSAGE. Every write goes through the `inbox` edge
   function on the service role. The browser says what its own visitor
   typed; it cannot set `direction`, cannot mark anything delivered, and
   cannot read another thread — the RLS has no policy that would let it.

   IT FAILS QUIET. If Supabase is unreachable, or the site channel is
   switched off, the launcher never draws. A chat bubble that opens onto
   an error is worse than no bubble: it promises a person and delivers a
   spinner.
   ============================================================ */
window.MCC_DESK = (function () {
  /* true when this page hosts the conversation itself rather than
     offering it from the corner. Set once, in build(). */
  var inline = false;
  "use strict";

  var KEY_STORE = "mcc_desk_key";
  var OPEN_STORE = "mcc_desk_open";
  var root = null, list = null, input = null, launcher = null;
  var booted = false, sending = false;

  function supa() {
    return window.MCC_SUPA && window.MCC_SUPA.url ? window.MCC_SUPA : null;
  }

  /* The visitor key. 32 url-safe characters from crypto, which is what
     the function validates against — a key it did not issue in that shape
     is refused rather than given a thread. */
  function visitorKey() {
    var k = null;
    try { k = localStorage.getItem(KEY_STORE); } catch (e) {}
    if (k && /^[A-Za-z0-9_-]{16,64}$/.test(k)) return k;
    var b = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(b);
    k = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { localStorage.setItem(KEY_STORE, k); } catch (e) {}
    return k;
  }

  function call(action, extra) {
    var S = supa();
    if (!S) return Promise.reject(new Error("no backend"));
    // WHOSE inbox this chat belongs to. One deployment now serves more
    // than one site, so the widget says which; window.MCC_ORG lets a
    // customer's page set their own without a second build of this file.
    var body = {
      action: action,
      org: window.MCC_ORG || "mccluster",
      visitor_key: visitorKey(),
      page: location.pathname,
    };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    return fetch(S.url + "/functions/v1/inbox", {
      method: "POST",
      headers: { "content-type": "application/json", apikey: S.key, Authorization: "Bearer " + S.key },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error("desk " + r.status);
      return r.json();
    });
  }

  /* ---------- drawing ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Bare URLs become links, and nothing else in a message is ever treated
     as markup. The bot's replies are owner-authored, but a message body
     also comes back from the database, and one day from a webhook — so
     this escapes first and linkifies second, never the other way round. */
  function withLinks(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, function (u) {
      return '<a href="' + u + '" rel="noopener">' + u + "</a>";
    });
  }

  function bubble(m) {
    var mine = m.direction === "in";
    var li = document.createElement("div");
    li.className = "dsk__m " + (mine ? "dsk__m--me" : "dsk__m--them");
    li.innerHTML = withLinks(m.body);
    return li;
  }

  function paint(messages) {
    if (!list) return;
    list.innerHTML = "";
    (messages || []).forEach(function (m) { list.appendChild(bubble(m)); });
    list.scrollTop = list.scrollHeight;
  }

  function push(m) {
    if (!list) return;
    list.appendChild(bubble(m));
    list.scrollTop = list.scrollHeight;
  }

  function typing(on) {
    if (!list) return;
    var t = list.querySelector(".dsk__typing");
    if (on && !t) {
      t = document.createElement("div");
      t.className = "dsk__m dsk__m--them dsk__typing";
      t.innerHTML = "<i></i><i></i><i></i>";
      list.appendChild(t);
      list.scrollTop = list.scrollHeight;
    } else if (!on && t) { t.remove(); }
  }

  /* ---------- talking ---------- */

  function say() {
    if (sending || !input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    sending = true;
    push({ direction: "in", body: text });
    typing(true);
    call("say", { body: text })
      .then(function (r) {
        typing(false);
        (r.replies || []).forEach(function (rep, i) {
          /* the delay is cosmetic and small: it keeps two scripted lines
             from landing in the same frame, which reads as a form
             submission rather than an answer */
          setTimeout(function () { push({ direction: "out", body: rep.body }); }, i * 550);
        });
      })
      .catch(function () {
        typing(false);
        push({ direction: "out", body: "That did not send. Email matthew@mccluster.org and it will reach him directly." });
      })
      .then(function () { sending = false; });
  }

  function open() {
    if (!root) return;
    root.hidden = false;
    root.classList.add("is-open");
    if (!inline) { try { sessionStorage.setItem(OPEN_STORE, "1"); } catch (e) {} }
    if (input) input.focus();
    call("open", {}).then(function (r) {
      if (r.messages && r.messages.length) paint(r.messages);
    }).catch(function () {});
  }

  function close() {
    if (!root || inline) return;      // nothing to fold away to

    root.classList.remove("is-open");
    root.hidden = true;
    try { sessionStorage.removeItem(OPEN_STORE); } catch (e) {}
    if (launcher) launcher.focus();
  }

  /* WHERE THE CHAT LIVES.

     By default this is a bubble in the corner: a thing you can go and
     find when the page has not answered your question. On a page that
     puts the conversation FIRST, that is the wrong shape entirely — the
     chat is not an escape hatch there, it is the content. A page marks
     the spot with [data-desk-inline] and the same widget mounts into it
     with no launcher, no corner, and no way to dismiss it, because there
     is nothing behind it to dismiss it back to.

     One widget, two shapes. Forking it would mean two send paths and one
     of them going stale. */
  function host() {
    return document.querySelector("[data-desk-inline]");
  }

  function build() {
    var slot = host();

    if (slot) {
      inline = true;
    } else {
      launcher = document.createElement("button");
      launcher.className = "dsk-launch";
      launcher.type = "button";
      launcher.setAttribute("aria-label", "Open the desk chat");
      launcher.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.6-.34L4.6 20.7l1.3-3.6A6.9 6.9 0 0 1 3.5 12.2C3.5 8.2 7.3 5 12 5s8.5 3.2 8.5 7.2z"/>' +
        "</svg>";
      launcher.addEventListener("click", open);
      document.body.appendChild(launcher);
    }

    root = document.createElement("section");
    root.className = inline ? "dsk dsk--inline" : "dsk";
    root.hidden = !inline;
    root.setAttribute("aria-label", "Chat with the desk");
    root.innerHTML =
      '<header class="dsk__top">' +
        '<span class="dsk__who"><b>The desk</b><small>A person reads everything here</small></span>' +
        (inline ? "" : '<button class="dsk__x" type="button" aria-label="Close the chat">&times;</button>') +
      "</header>" +
      '<div class="dsk__list" role="log" aria-live="polite"></div>' +
      '<form class="dsk__bar">' +
        '<input class="dsk__in" type="text" autocomplete="off" placeholder="Say something…" aria-label="Your message" maxlength="2000">' +
        '<button class="dsk__go" type="submit" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5L20 4l-7 16-2.3-6.4z"/></svg>' +
        "</button>" +
      "</form>";
    (slot || document.body).appendChild(root);

    list = root.querySelector(".dsk__list");
    input = root.querySelector(".dsk__in");
    var x = root.querySelector(".dsk__x");
    if (x) x.addEventListener("click", close);
    root.querySelector(".dsk__bar").addEventListener("submit", function (e) { e.preventDefault(); say(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root && !inline && !root.hidden) close();
    });
  }

  /* ---------- boot ----------
     The channel row is asked FIRST, before anything is drawn. If the
     owner switches the site channel off in the database, the launcher
     never appears — the off switch is real, not cosmetic. */
  function boot() {
    if (booted) return;
    if (document.body.hasAttribute("data-no-desk")) return;
    var S = supa();
    if (!S) return;
    booted = true;
    fetch(S.url + "/rest/v1/inbox_channels?key=eq.site&select=enabled", {
      headers: { apikey: S.key, Authorization: "Bearer " + S.key },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!rows || !rows.length || !rows[0].enabled) return;
        build();
        if (inline) { open(); return; }
        var wasOpen = null;
        try { wasOpen = sessionStorage.getItem(OPEN_STORE); } catch (e) {}
        if (wasOpen) open();
      })
      .catch(function () { /* fail quiet: no bubble is better than a broken one */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }

  return { open: open, close: close, boot: boot, inline: function () { return inline; } };
})();
