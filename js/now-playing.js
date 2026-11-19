/* ============================================================
   NOW PLAYING — what every player tells the device before it plays.

   Matthew, 2026-11-19: "when I'm playing music and I leave the
   browser, it stops playing music ... Apple continues to play music."
   This is the one place the site speaks to the device about music,
   shared by every player: the album deck (album.html), the listen
   engine (js/music-engine.js), the pocket (js/pip.js) and the World
   soundtrack (js/world-audio-continuity.js). Each calls claim()
   right before it calls play().

   THE AUDIO SESSION. Safari (iOS and iPadOS 16.4 and later) lets a
   page say what kind of sound it makes: navigator.audioSession.type.
   "playback" is music: iOS keeps a playback session going when the
   screen locks or another app comes forward, and it ignores the
   silent switch, as Apple Music does. Chrome and Firefox have no such
   API, so claim() does nothing there. A session already set to
   "play-and-record" (a call or a recording on the page) is left alone.
   Setting it is the page's request; what iOS then does is Inferred
   until Matthew's own devices run the checklist
   (docs/music/MUSIC-RELEASE-20261119.md).

   THE IN-APP NOTE (decision D-6, a default pending Matthew's review).
   Most listeners of the last sixty days opened the album inside
   Instagram's own browser (music map 00, G-1). There the app, not this
   page, decides whether music keeps playing when the screen locks. On
   a music page inside such a browser one small line says where it
   does, until it is put away for the session; nothing redirects anyone.

   Slice M2 grows this file into the one Now Playing owner (title,
   artwork, the lock screen's buttons), so every player already loads
   it: the music pages carry it before their players, js/tabbar.js
   loads it before the World soundtrack, and the pocket waits for it.
   ============================================================ */
(function (root) {
  "use strict";
  if (root.MCC_NOW_PLAYING) return;
  var doc = root.document;

  function session() {
    var nav = root.navigator, s = nav && nav.audioSession;
    return s && typeof s === "object" ? s : null;
  }
  /* before every play(): this is music */
  function claim() {
    var s = session();
    if (!s) return false;
    try {
      if (s.type === "playback") return true;
      if (s.type === "play-and-record") return false;
      s.type = "playback";
      return s.type === "playback";
    } catch (e) { return false; }
  }

  /* the in-app browsers whose host app decides about background audio,
     by the name each puts in its user agent */
  var HOSTS = [
    ["Instagram", /\bInstagram\b/],
    ["Messenger", /MessengerForiOS|Orca-Android|\bMessenger\b/],
    ["Facebook", /FBAN\/|FBAV\/|FB_IAB|FBIOS|FB4A/],
    ["TikTok", /musical_ly|\bTikTok\b|trill_\d|BytedanceWebview/],
    ["Snapchat", /\bSnapchat\b/],
    ["LinkedIn", /LinkedInApp/],
    ["Line", /\bLine\/\d/],
    ["X", /\bTwitter/]
  ];
  function inApp(ua) {
    var s = String(ua == null ? (root.navigator && root.navigator.userAgent) || "" : ua);
    for (var i = 0; i < HOSTS.length; i++) if (HOSTS[i][1].test(s)) return HOSTS[i][0];
    return null;
  }

  var KEY = "mcc_inapp_note", TEXT = "To keep the music playing with your screen locked, open this page in Safari or Chrome.";
  function dismissed() { try { return root.sessionStorage.getItem(KEY) === "dismissed"; } catch (e) { return false; } }
  function remember() { try { root.sessionStorage.setItem(KEY, "dismissed"); } catch (e) {} }
  function track(action, host) { try { if (root.MCC_TRACK) root.MCC_TRACK("music_inapp_note", { action: action, host_app: host }); } catch (e) {} }
  function style() {
    if (doc.getElementById("mccNowPlayingStyle")) return;
    var css = doc.createElement("style");
    css.id = "mccNowPlayingStyle";
    /* phone first: one line that wraps, a 44 px target to put it away, no width of its own */
    css.textContent =
      ".np-hint{position:relative;z-index:2;display:flex;align-items:flex-start;gap:.5rem;box-sizing:border-box;max-width:100%;" +
        "margin:.5rem 0 .75rem;padding:.55rem .25rem .55rem .85rem;border-radius:14px;border:1px solid rgba(244,239,230,.16);" +
        "background:rgba(18,15,13,.86);color:#f4efe6;font:500 .82rem/1.45 var(--ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif)}" +
      ".np-hint p{flex:1 1 auto;min-width:0;margin:0;padding-top:.12rem}" +
      ".np-hint button{flex:0 0 auto;width:44px;height:44px;margin:-.5rem 0;border:0;border-radius:12px;background:transparent;" +
        "color:inherit;font-family:inherit;font-size:1.35rem;font-weight:400;line-height:1;cursor:pointer;opacity:.72}" +
      ".np-hint button:focus-visible{outline:2px solid currentColor;outline-offset:-4px;opacity:1}" +
      ".np-hint--light{background:rgba(255,252,247,.94);color:#17110c;border-color:rgba(23,17,12,.16)}" +
      "@media (min-width:700px){.np-hint{max-width:40rem}}";
    doc.head.appendChild(css);
  }
  /* the note wears the coat of the room it sits in, not the clock's: most
     music rooms stay dark by day and by night, and a light card in a dark
     room would shout. A page whose own surface is light gets the light coat. */
  function lightRoom() {
    try {
      var m = String(root.getComputedStyle(doc.body).backgroundColor || "").match(/[\d.]+/g);
      if (!m || m.length < 3 || (m.length > 3 && +m[3] === 0)) return false;
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.6;
    } catch (e) { return false; }
  }
  /* music pages only: a listening room or an artist's page, never a frame.
     Not the lyric video feed: it plays video, and no browser promises to
     keep a video playing with the screen locked, so the line would not be
     true there. */
  function musicPage() {
    var b = doc.body;
    if (!b || root.top !== root || b.classList.contains("music-room--music-videos")) return false;
    return b.classList.contains("music-room") || b.classList.contains("artist-page");
  }
  function mount() {
    var host = inApp();
    if (!host || !musicPage() || dismissed() || doc.querySelector(".np-hint")) return;
    style();
    var note = doc.createElement("aside");
    note.className = lightRoom() ? "np-hint np-hint--light" : "np-hint";
    note.setAttribute("role", "note");
    note.setAttribute("aria-label", "Listening tip");
    var p = doc.createElement("p");
    p.textContent = TEXT;
    var x = doc.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Dismiss this tip");
    x.textContent = "×";
    x.addEventListener("click", function () {
      remember();
      if (note.parentNode) note.parentNode.removeChild(note);
      track("dismiss", host);
    });
    note.appendChild(p);
    note.appendChild(x);
    /* under the page's own music bar, in the flow of the page: nothing is covered */
    var bar = doc.querySelector(".music-contextbar");
    if (bar && bar.parentNode) bar.parentNode.insertBefore(note, bar.nextSibling);
    else (doc.querySelector("main") || doc.body).insertBefore(note, (doc.querySelector("main") || doc.body).firstChild);
    track("view", host);
  }

  root.MCC_NOW_PLAYING = { claim: claim, supported: function () { return !!session(); }, inApp: inApp };
  if (doc && doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount);
  else if (doc && doc.body) mount();
})(window);
