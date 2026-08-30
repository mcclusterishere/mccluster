/* ============================================================
   THE BAR: one tap goes where it says. That's the whole grammar.
   A tap on any tab or wing slot navigates immediately, like every
   app on earth. The wings survive as a held-press flourish: hold a
   tab ~450ms and it morphs open in place (the anchor law holds:
   the held tab never moves); hold a slot and its peek card rises.
   Release before the threshold and it's just a tap. Nothing needs
   teaching, so the old first-boot Walk tutorial is retired.
   ============================================================ */
(function () {
  "use strict";
  /* where the house root sits, read off this script's own address, so a
     page in walls/, tracks/, or closet/ morphs its wings into real rooms
     instead of phantom siblings (the same trick masthead.js uses) */
  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/tabbar\.js.*$/, "") : "";
  })();

  /* ---------- THE BAR EXISTS WHEREVER THIS SCRIPT DOES ----------

     The bar was twenty lines of inline SVG pasted into each page, and
     `if (!dock) return` meant a page that had not been pasted into simply
     had no bar — no way home, no way to the record. That was twenty-eight
     pages, including every wall, the travel desk and the whole checkout.
     Keeping it markup also meant the emblems lived in seventy places at
     once, and a page in walls/ needed every href rewritten by hand.

     So the markup becomes a fallback the script can build. Pages that
     already carry the bar are untouched — theirs is found and used as-is,
     which keeps album.html's id="appbarNP" hook and anything else a page
     has wired to its own copy. Pages that do not get this one, with every
     path resolved through ROOT so a wall two directories deep gets real
     doors instead of phantom siblings. */
  var EQ_PATHS =
    '<path d="M0 5.01H11.59V8.64H3.84V12.41H10.7V16.05H3.84V20.24H11.8V24H0Z"/>' +
    '<rect x="14.82" y="11.25" width="8.57" height="2.6" rx="0.5"/>' +
    '<rect x="14.82" y="16.05" width="8.57" height="2.61" rx="0.5"/>';
  /* The shop's glyph. It lives up here beside EQ_PATHS rather than down in
     ICONS because buildBar() runs before ICONS is assigned — the bar has to
     be able to draw itself at the top of the file. ICONS.laptop below is
     this same string, so the tab and its wing slot are the one drawing. */
  var LAPTOP =
    '<path d="M5.2 5.6h13.6a1.4 1.4 0 0 1 1.4 1.4v8.4H3.8V7a1.4 1.4 0 0 1 1.4-1.4z"/>' +
    '<path d="M2.2 15.4h19.6l-1 2a1.6 1.6 0 0 1-1.5.9H4.7a1.6 1.6 0 0 1-1.5-.9z"/>';

  /* THE FIFTH TAB IS A CONVERSATION NOW, NOT A CATALOGUE.
     The laptop said "here is a page of things"; the bubble says "ask me".
     LAPTOP is kept because the wing's icon map still names it, and a
     glyph nobody draws is cheaper than a lookup that returns nothing. */
  var CHAT =
    '<path d="M4.4 4.9h15.2a1.6 1.6 0 0 1 1.6 1.6v8.2a1.6 1.6 0 0 1-1.6 1.6H10l-4.5 3.4v-3.4H4.4a1.6 1.6 0 0 1-1.6-1.6V6.5a1.6 1.6 0 0 1 1.6-1.6z"/>' +
    '<path d="M7.6 9.3h8.8"/><path d="M7.6 12.2h5.6"/>';

  function eqSvg(np) {
    var a = np ? ' class="np-arrow"' : '', b = np ? ' class="np-bar"' : '';
    return '<svg class="appbar__eq" viewBox="0 0 45.7 24" aria-hidden="true">' + EQ_PATHS +
      '<path' + a + ' d="M26.2 16.4C32 15 37.4 11.6 42 5.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path' + a + ' d="M45.6 0.4 44.9 6.5 39.9 2.8Z"/>' +
      '<rect' + b + ' x="25.99" y="18.8" width="4.05" height="5.2" rx="0.7"/>' +
      '<rect' + b + ' x="31.21" y="16.88" width="3.98" height="7.12" rx="0.7"/>' +
      '<rect' + b + ' x="36.43" y="14.06" width="4.05" height="9.94" rx="0.7"/>' +
      '<rect' + b + ' x="41.64" y="10.63" width="4.05" height="13.37" rx="0.7"/></svg>';
  }
  function buildBar() {
    var nav = document.createElement("nav");
    nav.className = "appbar";
    nav.setAttribute("aria-label", "Sections");
    nav.innerHTML =
      '<a class="appbar__tab" id="appbarNP" href="' + ROOT + 'album.html" data-appnav="music">' +
        eqSvg(true) + '<span>Music</span></a>' +
      '<a class="appbar__tab" href="' + ROOT + 'equity-uprise.html" data-appnav="uprise">' +
        eqSvg(false) + '<span>Equity Uprise</span></a>' +
      '<a class="appbar__tab" href="' + ROOT + 'index.html" data-appnav="home">' +
        '<img class="appbar__m" src="' + ROOT + 'assets/img/m-mark.png" alt=""><span>HERE</span></a>' +
      /* THE FIFTH TAB IS THE STUDIO.
         This column has changed hands twice. It carried the halo and
         opened the Prayer Closet; the shake run took it on 2026-08-17;
         the owner shelved the shake shop on 2026-08-19 and gave the
         column to McCluster Sites, which is the thing on this site that
         actually takes money from strangers today. It wears a laptop.

         The Closet did not lose anything either time: it is the second
         slot of this wing, one hold away, with the Inner Room and Give. */
      '<a class="appbar__tab" href="' + ROOT + 'sites.html" data-appnav="sites">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + CHAT + '</svg><span>Chat</span></a>' +
      '<a class="appbar__tab" href="' + ROOT + 'account.html" data-appnav="profile">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/>' +
        '<path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg><span>Profile</span></a>';
    document.body.appendChild(nav);
    return nav;
  }

  /* THE OPT-OUT IS ABOUT THE PAGE, NOT ABOUT THE MARKUP.

     This used to be checked only when a page had NO bar of its own, so
     data-no-appbar silently did nothing on the ~30 pages that ship the bar
     as hand-written markup — the attribute was there, read, and ignored.
     It now means what it says: this page has no bar. If one was written
     into the HTML anyway, it is removed rather than left, because a nav
     hidden with CSS still reaches a screen reader and still takes tab
     focus.

     matthew-mccluster.html is the first real user: it is the page a hiring
     manager opens from a job application, and a bar reading
     "Music · Equity Uprise · HERE · Shakes · Profile" is not what that
     visitor should be handed. */
  var dock = document.querySelector(".appbar");
  if (document.body.hasAttribute("data-no-appbar")) {
    if (dock && dock.parentNode) dock.parentNode.removeChild(dock);
    return;
  }
  if (!dock) dock = buildBar();

  /* the page tail clears the bar; the padding rule existed in the
     stylesheet for months while nothing ever applied the class */
  document.body.classList.add("has-appbar");

  /* the map is a door, not a room: this sentinel sits where a path would
     and hands off to the drawer in js/masthead.js */
  var MAP = "#map";

  /* slots: [href, icon, label, peek {ic, title, sub, dyn}]: the twenty
     rooms a visitor walks between live in the five wings; the rest of the
     house is one slot away, behind Everything */
  var WINGS = {
    /* the trim law, restated for five tabs: a wing carries exactly FOUR
       rooms, so an open wing is the same FIVE-cell bar you started with.
       The tab you held keeps its own column and the other four cells become
       its rooms: the bar never changes width, it changes contents.
       This is not decoration. morph() sizes the open bar off slots.length
       (see the anchor law below), so a wing that carries three rooms while
       the closed bar carries five tabs makes the capsule visibly shrink by
       a cell on every long-press and shoves the held tab out of its column.
       If a tab is ever added or removed, every wing changes with it. */
    music: {
      home: "album.html",
      slots: [
        ["album.html", "note", "The album", { title: "I AM HERE, the album",
          sub: "Six tracks in the site's own player: the deck, lock-screen controls, and a memory. It picks up where you left off." }],
        ["films.html", "film", "Lyric Videos", { title: "Lyric videos, one swipe",
          sub: "The whole catalog as lyric videos. Swipe, and every record plays its own scene-cut film with the words live on the picture." }],
        ["catalogue.html", "disc", "Catalogue", { title: "The whole catalogue",
          sub: "Every record in one room, with the credits, the runtime, and where each one streams." }],
        ["license.html", "card", "License", { title: "License the music",
          sub: "Sync, film, ads, church rooms: what the record costs to use, who to ask, and what comes back signed." }],
      ],
    },
    uprise: {
      home: "equity-uprise.html",
      slots: [
        ["equity-uprise.html", "rise", "The Uprise", { title: "Equity Uprise",
          sub: "The movement, the fellowship and the platform in one room: what it is, who carries it, and what it has already moved." }],
        ["fellowship.html", "folk", "Fellowship", { title: "The Policy Fellowship",
          sub: "The intake for the policy fellowship: seventeen questions, no account, and a reply from a person." }],
        ["docket-516.html", "folder", "Docket 516", { title: "Docket 516, the archive",
          sub: "The flagship case: the 115-kV rebuild, the filings index, and the remand that followed. Every document links to the Council's own copy." }],
        ["verify.html", "seal", "Get Verified", { title: "Get M-Verified",
          sub: "The verification desk: how the cohort is checked, and what the mark on a name is actually claiming." }],
      ],
    },
    home: {
      home: "index.html",
      slots: [
        ["hire.html", "case", "Hire", { title: "Hire the agency",
          sub: "Brand films, photography, web builds, campaign strategy. One team, start to finish." }],
        /* Sites moved to its own tab on 2026-08-19; the Console takes the
           freed slot rather than leaving a gap, because a client who is
           already paying should not have to go through Profile to file a
           change. It keeps its Profile slot too — one room, two doors. */
        ["console.html", "desk", "Console", { title: "The client console",
          sub: "If the studio runs your site, this is your back room: file a change, watch it land, see your plan." }],
        ["gallery.html", "frame", "The Gallery", { title: "The Gallery",
          sub: "Photography and film in one wall: the events, the covers, the runways, the print shop behind them." }],
        [MAP, "grid", "Everything", { title: "Every room in the house",
          sub: "The full map: the tracks, the gallery, the print shop, the archive, the desks. Everything the five wings do not carry." }],
      ],
    },
    /* THE FIFTH WING, REPOINTED AGAIN. It was the Closet's, then the shake
       run's, and from 2026-08-19 it is the studio's. Sites moved up out of
       the home wing to take the column; the home wing gave its freed slot
       to the Console, so the client back room is one tap from the front
       door instead of buried under Profile.

       The Closet, the Inner Room and Give keep their slots exactly as they
       were, so nothing that was one tap away has become unreachable. */
    sites: {
      home: "sites.html",
      slots: [
        /* The wing's first slot is the same door the tab is, so it says
           the same thing. The old copy also carried "$87 a month", which
           is not a price this business has charged for a long time --
           the kind of number that only survives because nobody reads a
           tooltip. Prices are not typed here any more; the conversation
           quotes them from the ledger. */
        ["sites.html", "chat", "Chat", { title: "Talk to the desk",
          sub: "Ask what it costs, check whether your address is free, and buy it in the same conversation. A person reads all of it." }],
        ["prayer-closet.html", "hang", "The Closet", { title: "Prayer Closet",
          sub: "Limited drops with meaning behind the garment. Season 001 cuts three hoodie-and-jogger sets from the book of Matthew." }],
        ["inner-room.html", "lamp", "Inner Room", { title: "The Inner Room",
          sub: "The chapters behind the garments: read, study, pray, keep your notes. Free, always; no purchase opens this door." }],
        ["give.html", "gift", "Give", { title: "Support the work",
          sub: "Give once, sponsor a season, or back a fund by name." }],
      ],
    },
    profile: {
      home: "account.html",
      slots: [
        ["account.html", "key", "Sign in", { title: "Your account",
          sub: "A sign-in link lands in your email, no password. Your record with the agency lives here.",
          dyn: function () {
            var u = window.MCC_AUTH && window.MCC_AUTH.user && window.MCC_AUTH.user();
            return u ? "Signed in as " + (u.email || "your instant account") + ". Your bookings and receipts are on the record." : null;
          } }],
        ["console.html", "desk", "Console", { title: "The client console",
          sub: "If the studio runs your site, this is your back room: file a change, watch it land, see your plan." }],
        ["shots.html", "shot", "Shot Wall", { title: "The Shot Wall",
          sub: "Were you at the event? Find your photo on the wall. The first one's free with a follow, the whole pack is a few dollars." }],
        ["press.html", "paper", "Press Kit", { title: "Press and media kit",
          sub: "The bio, the headshots, the logo files and the credential scans, in the sizes a newsroom asks for." }],
      ],
    },
  };
  /* every wing door resolves against the house root, wherever the page
     sits. The map is not a room, so it never takes a path. */
  Object.keys(WINGS).forEach(function (k) {
    WINGS[k].home = ROOT + WINGS[k].home;
    WINGS[k].slots.forEach(function (s) { if (s[0] !== MAP) s[0] = ROOT + s[0]; });
  });
  /* ORDER is the bar's DOM order, and morph() reads it as such: the column a
     held tab keeps is its index here, so this list and the hand-written
     markup in every page must stay in step. The M coin sits in the middle of
     five by the owner's instruction, so uprise goes between music and home. */
  var ORDER = ["music", "uprise", "home", "sites", "profile"];
  /* the coin: the wing this page lives in wears the filled gold circle */
  var PAGE_WING = {
    "album.html": "music", "films.html": "music", "catalogue.html": "music",
    "license.html": "music",
    /* the civic world got its own tab, so the four rooms that used to sit
       under the M coin by default now light their own */
    "equity-uprise.html": "uprise", "docket-516.html": "uprise",
    "fellowship.html": "uprise", "verify.html": "uprise", "feed.html": "uprise",
    /* the front door is the house: the landing page opens on the emblem,
       so / and /index.html light the M coin; the record lives behind Music */
    "": "home", "index.html": "home",
    "hire.html": "home",
    "ecosystem.html": "home",
    "portfolio.html": "home", "shots.html": "home", "production.html": "home", "archive.html": "home", "gallery.html": "home", "prints.html": "home",
    "account.html": "profile", "pay.html": "profile", "console.html": "profile", "onboard.html": "profile",
    "press.html": "profile", "matthew-mccluster.html": "profile", "crm.html": "profile",
    /* the fifth wing: the studio and the rooms it shares a column with.
       shakes.html and shake-desk.html are not listed because they are not
       served any more — see _unfinished/README.md. */
    "sites.html": "sites",
    "prayer-closet.html": "sites", "inner-room.html": "sites",
    "seek-first.html": "sites", "salt-and-light.html": "sites",
    "sent.html": "sites", "give.html": "sites"
    /* policy.html and policy-memo-dna.html carry the bar now but claim no
       wing: the site's own ledger files them under matthew, and neither page
       says the word "uprise" anywhere. Lighting a coin there would be an
       editorial claim the pages do not make. Left for the owner to call. */
  };
  var hereTab = dock.querySelector('[data-appnav="' + (PAGE_WING[location.pathname.split("/").pop()] || "") + '"]');
  if (hereTab) hereTab.classList.add("is-here");
  var HOME_BAR = dock.innerHTML;
  var wingOn = null;

  var ICONS = {
    film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 5v4M12 5v4M17 5v4"/>',
    note: '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>',
    case: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="M11 11L20 2"/><path d="M17 5l2.5 2.5M14.5 7.5L17 10"/>',
    card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 3.5L17 11H5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    news: '<rect x="3" y="4.5" width="15" height="15" rx="2"/><path d="M18 8h1.5a1.5 1.5 0 0 1 1.5 1.5V17a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="M6.5 8.5h8M6.5 12h8M6.5 15.5h5"/>',
    desk: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    hang: '<path d="M12 6a2 2 0 1 1 2-2"/><path d="M12 6l8.2 5.8a1.5 1.5 0 0 1-.9 2.7H4.7a1.5 1.5 0 0 1-.9-2.7z"/><path d="M6.5 14.5V20M17.5 14.5V20"/>',
    shot: '<path d="M3 8.5a2 2 0 0 1 2-2h2.2l1.3-2h6.8l1.3 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.8" r="3.6"/>',
    lamp: '<path d="M12 20V7"/><path d="M12 7c-2.6-2.2-5.6-2.6-8-2v12c2.4-.6 5.4-.2 8 2 2.6-2.2 5.6-2.6 8-2V5c-2.4-.6-5.4-.2-8 2z"/>',
    /* the fifth wing's set, plus the four rooms the older wings gained when
       every wing went from three slots to four. Drawn in the same 24-grid,
       single-weight stroke as the rest: no fills, no emoji, nothing that
       needs a font to arrive before the bar can be read. */
    frame: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.4" cy="9.8" r="1.7"/><path d="M3.6 17l4.9-4.4 3.9 3.4 3-2.5 5.1 4.2"/>',
    gift: '<rect x="3" y="9.5" width="18" height="10.5" rx="2"/><path d="M3 13.2h18M12 9.5V20"/><path d="M12 9.5C10.6 6.2 8.7 4.8 7.4 5.7c-1.3 1 .3 3.8 4.6 3.8 4.3 0 5.9-2.8 4.6-3.8-1.3-.9-3.2.5-4.6 3.8z"/>',
    rise: '<path d="M4 20h16"/><path d="M4 15.4l5.1-5 3.7 3.2 6.4-6.9"/><path d="M14.6 6.7H20v5.2"/>',
    folk: '<circle cx="9.2" cy="8.4" r="3.2"/><path d="M3.1 19a6.1 6.1 0 0 1 12.2 0"/><path d="M16.4 6.7a3.2 3.2 0 0 1 0 5.9"/><path d="M17.3 14a6.1 6.1 0 0 1 3.6 5"/>',
    seal: '<path d="M12 3.2l7 2.9v5.2c0 4.2-2.8 7.5-7 8.5-4.2-1-7-4.3-7-8.5V6.1z"/><path d="M8.9 11.9l2.2 2.2 4.1-4.4"/>',
    paper: '<path d="M6 3.2h8.4L19 7.8V20.8H6z"/><path d="M14.2 3.2v4.8H19"/><path d="M9 12.4h7M9 16h7"/>',
    laptop: LAPTOP,
    chat: CHAT,
  };
  function ic(k) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[k] || ICONS.desk) + "</svg>";
  }
  function emit(n, d) { try { window.dispatchEvent(new CustomEvent(n, { detail: d || {} })); } catch (e) {} }

  /* THE TRANSPORT STATE. SOUND_ON is the single source of truth for whether
     a record is running. The two pages that own a deck announce it on
     mcc:nowplaying -- album.html off the deck's own play/pause events, and
     js/main.js from inside setSound() -- and nothing in here ever reads the
     class back off the DOM to find out.
     It is painted, never remembered: HOME_BAR is a boot-time snapshot of the
     bar's HTML, and both morph() and revert() rebuild the bar out of it, so
     a class on a tab does not survive a wing opening and closing mid-song.
     Every rebuild calls paintSound() for exactly that reason. */
  var SOUND_ON = false;
  function paintSound() {
    var mt = dock.querySelector('[data-appnav="music"]');
    if (!mt) return;
    /* one class, one meaning: is-sound swaps the tab's play triangle for the
       pause glyph. The stylesheet also carried an is-playing equaliser dance
       that nothing had ever applied to a tab; with the tab now drawn as a
       transport button there is no equaliser left to dance, so those rules
       went out of css/style.css rather than getting a first user here. */
    mt.classList.toggle("is-sound", SOUND_ON);
  }
  window.addEventListener("mcc:nowplaying", function (e) {
    SOUND_ON = !!(e.detail && e.detail.playing);
    paintSound();
  });

  /* the same idiom both of the album's own transport buttons use: ask what
     the deck is doing, then do the other thing. SOUND_ON stands in for
     deck.paused, because the bar cannot see the deck from here. */
  function transport() {
    var was = SOUND_ON;
    if (!was) window.MCC_NP_PLAY();
    else window.MCC_NP_PAUSE();
    if (window.MCC_TRACK) window.MCC_TRACK("bar_transport", { play: !was, page: location.pathname.split("/").pop() });
    /* both implementations announce for themselves, so the wire is normally
       already live by the time this runs. If one ever does not -- a deck that
       refuses to start, some later third implementation that forgets -- then
       say out loud the one thing we can still see for certain, which is that
       nothing is playing. js/volumecall.js and the sound beacon in
       js/main.js both listen here and would otherwise sit holding a state
       the bar has already left. */
    setTimeout(function () {
      if (SOUND_ON !== was) return; // the page answered; nothing to add
      if (!was) return;             // we asked for sound and got none: already silent, already painted
      SOUND_ON = false;
      paintSound();
      emit("mcc:nowplaying", { title: "I AM HERE", href: ROOT + "album.html", playing: false });
    }, 0);
  }

  /* the veil the departure rides behind */
  var veil = document.createElement("div");
  veil.className = "pt-veil";
  document.body.appendChild(veil);
  function veilOn() { document.documentElement.classList.add("pt-out"); }
  function veilOff() { document.documentElement.classList.remove("pt-out"); }

  /* "/" and "/index.html" are the same document. Fold the implicit filename
     away so tapping the M tab while standing at the root reads as a no-op
     (scroll to top) instead of a pointless full reload. */
  function samePath(a) { return a.replace(/(^|\/)index\.html$/, "$1"); }
  /* is this destination the page we are standing on? */
  function onPage(dest) {
    if (!dest) return false;
    try {
      return samePath(new URL(dest, location.href).pathname) === samePath(location.pathname);
    } catch (e) { return false; }
  }

  /* the map slot: hand off to the drawer instead of sailing anywhere */
  function openMap() {
    unpeek();
    if (window.MCC_MASTHEAD && window.MCC_MASTHEAD.open) {
      window.MCC_MASTHEAD.open();
      revert();
      return true;
    }
    return false;
  }

  function sail(dest, wait) {
    if (dest === MAP) { if (openMap()) return; dest = ROOT + "index.html"; }
    unpeek();
    var url = null;
    try { url = new URL(dest, location.href); } catch (e) {}
    if (url && samePath(url.pathname) === samePath(location.pathname) && url.search === location.search) {
      veilOff(); revert();
      if (url.hash) location.hash = url.hash;
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    veilOn();
    setTimeout(function () { location.href = dest; }, wait);
  }

  /* ---------- THE PEEK: one tap on a slot shows the room's widget ---------- */
  var peekEl = null, peekFor = null;
  function unpeek() {
    if (peekEl && peekEl.parentNode) peekEl.parentNode.removeChild(peekEl);
    peekEl = null; peekFor = null;
  }
  function peek(slotHref) {
    if (peekFor === slotHref) { unpeek(); return; } // tap the same slot again: the card folds
    unpeek();
    var def = null;
    Object.keys(WINGS).forEach(function (k) {
      WINGS[k].slots.forEach(function (s) { if (s[0] === slotHref) def = s; });
    });
    if (!def || !def[3]) { sail(slotHref, 460); return; }
    var p = def[3];
    var sub = (p.dyn && p.dyn()) || p.sub;
    peekFor = slotHref;
    peekEl = document.createElement("div");
    peekEl.className = "dk-peek";
    peekEl.innerHTML =
      '<div class="dk-peek__card">' +
      '<div class="dk-peek__top"><span class="dk-peek__ic">' + ic(def[1]) + "</span>" +
      "<span><b>" + p.title + "</b><small>" + sub + "</small></span></div>" +
      '<div class="dk-peek__acts">' +
      '<button class="dk-peek__go" type="button" data-peek-go="' + slotHref + '">Step inside &#8594;</button>' +
      '<button class="dk-peek__alt" type="button" data-peek-no>Not yet</button>' +
      "</div></div>";
    document.body.appendChild(peekEl);
    peekEl.addEventListener("click", function (e) {
      var go = e.target.closest && e.target.closest("[data-peek-go]");
      if (go) { sail(go.getAttribute("data-peek-go"), 460); return; }
      if (e.target.closest && e.target.closest("[data-peek-no]")) unpeek();
    });
    emit("mcc:bar-peek", { href: slotHref });
  }

  function morph(key) {
    var w = WINGS[key];
    if (!w || wingOn === key) return;
    veilOff();
    unpeek();
    wingOn = key;
    dock.classList.add("appbar--morph");
    /* anchor law: the tapped tab holds its cell, untouched */
    var tmp = document.createElement("div");
    tmp.innerHTML = HOME_BAR;
    var anchor = tmp.querySelector('[data-appnav="' + key + '"]');
    if (anchor) anchor.classList.add("appbar__tab--wing", "is-active");
    var slotHtml = w.slots.map(function (s) {
      return '<a class="appbar__tab appbar__tab--slot" href="' + s[0] + '" data-dock="' + s[0] + '">' +
        ic(s[1]) + "<span>" + s[2] + "</span></a>";
    });
    /* the anchor law, kept exactly: a wing carries four rooms, so the open
       bar has the same five cells as the closed one, and the tab you are
       holding simply stays in its own column. It does not move at all.
       The clamp is the law's own backstop, not a layout rule: if a wing is
       ever left short a slot, the held tab gets dragged left into a column
       that is not its own. That is the symptom to look for. */
    var total = slotHtml.length + 1;
    var anchorAt = Math.min(ORDER.indexOf(key), total - 1);
    var cells = [], si = 0;
    for (var i = 0; i < total; i++) {
      if (i === anchorAt) cells.push(anchor ? anchor.outerHTML : "");
      else cells.push(slotHtml[si++]);
    }
    dock.innerHTML = cells.join("");
    paintSound(); // the anchor is a fresh copy off HOME_BAR; it knows nothing yet
    emit("mcc:bar-morph", { wing: key });
  }

  function revert() {
    if (!wingOn) return;
    unpeek();
    wingOn = null;
    dock.classList.remove("appbar--morph");
    dock.innerHTML = HOME_BAR;
    paintSound(); // the snapshot is from boot, when nothing was playing yet
  }

  /* the hold belongs to the bar, not to the browser. Without this, a long
     press on a tab raises the phone's own link preview (iOS peek, Android
     context menu) right over the wing that is trying to open. The CSS half
     of the fix lives with .appbar in css/style.css. */
  dock.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  dock.addEventListener("dragstart", function (e) { e.preventDefault(); });

  var LP_MS = 450;
  var lpTimer = null, lpFired = false, lpX = 0, lpY = 0;
  dock.addEventListener("pointerdown", function (e) {
    var a = e.target.closest && e.target.closest("a[data-dock],a[data-appnav]");
    if (!a || !dock.contains(a)) return;
    lpFired = false; lpX = e.clientX; lpY = e.clientY;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(function () {
      lpFired = true;
      var key = a.getAttribute("data-appnav");
      var slot = a.getAttribute("data-dock");
      if (key && WINGS[key]) { if (wingOn === key) revert(); else morph(key); }
      else if (slot) peek(slot);
    }, LP_MS);
  });
  dock.addEventListener("pointermove", function (e) {
    if (Math.abs(e.clientX - lpX) > 8 || Math.abs(e.clientY - lpY) > 8) clearTimeout(lpTimer);
  });
  ["pointerup", "pointercancel"].forEach(function (ev) {
    dock.addEventListener(ev, function () { clearTimeout(lpTimer); });
  });

  dock.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[data-dock],a[data-appnav]");
    if (!a || !dock.contains(a)) return;
    e.preventDefault();
    if (lpFired) { lpFired = false; return; } // the hold already did its work
    var key = a.getAttribute("data-appnav");
    var slot = a.getAttribute("data-dock");
    var w = key ? WINGS[key] : null;
    /* THE MUSIC TAB TAKES YOU TO THE PLAYER.

       It used to run the transport on ANY page that published the deck
       globals. Two pages publish them -- album.html, which IS the player,
       and index.html through js/main.js, which has its own scroll-driven
       soundtrack. So on the home page the coin started and stopped that
       soundtrack and never sailed, and there was no way to reach the player
       from the bar at all: the one tab whose whole job is the record was
       the one tab that would not open it.

       The home page keeps its own sound control (the SOUND button, top
       right), so nothing is lost there. The coin is a transport only where
       you are already standing on the player -- tapping it there should
       drive the deck, not sail to the page you are on -- and everywhere
       else it goes to the player, which is what it looks like it does.

       A held press never reaches this line (the lpFired gate above swallows
       it), so hold-to-open-the-music-wing is untouched. */
    var dest = w ? w.home : (slot || a.getAttribute("href"));

    /* THE CHAT TAB OPENS THE CHAT, RATHER THAN SAILING TO A PAGE THAT
       HAS ONE. Twelve pages already carry the desk widget; on those,
       navigating away to go and talk is a page load for nothing, and it
       loses whatever the visitor was reading. Where the widget is not
       loaded the tab still sails to sites.html, which is the
       conversation with a page around it. */
    if (key === "sites" && window.MCC_DESK && typeof window.MCC_DESK.open === "function") {
      window.MCC_DESK.open();
      if (window.MCC_TRACK) window.MCC_TRACK("chat_open", { from: "appbar" });
      return;
    }

    if (key === "music" && onPage(dest) &&
        typeof window.MCC_NP_PLAY === "function" &&
        typeof window.MCC_NP_PAUSE === "function") { transport(); return; }
    sail(dest, 460);
  });

  /* tap anywhere off the bar (and off a peek): everything folds home */
  document.addEventListener("pointerdown", function (e) {
    if (e.target.closest && (e.target.closest(".appbar") || e.target.closest(".dk-peek") || e.target.closest(".dockwalk"))) return;
    if (peekEl) unpeek();
    if (wingOn) revert();
  }, true);
  window.addEventListener("pageshow", function () { clearTimeout(lpTimer); veilOff(); unpeek(); revert(); });

  window.MCC_BAR = { morph: morph, revert: revert, peek: peek, wing: function () { return wingOn; } };
  if (window.MCC_TRACK) window.MCC_TRACK("bar_boot", { page: location.pathname.split("/").pop() });

})();
