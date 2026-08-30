/* ============================================================
   THE MAP: every room in the house, and the page's own action.

   This file used to inject a bar across the top of every page: the
   mark, five room links, a hamburger, a CTA pill. On a phone that bar
   was mostly hidden anyway; on a tablet or a desktop it meant the
   house showed TWO navigations at once, a row of tabs up top and the
   floating capsule down below. One house, one bar. The top bar is
   retired.

   What survives is the part that earned its keep:
   - THE MAP: the full drawer, every public room grouped, because a
     room reachable from nowhere may as well not exist. Its door is
     now the "Everything" slot in the bottom bar's HERE wing (see
     js/tabbar.js), or any [data-mh-open] button a page cares to add.
   - THE PAGE'S ACTION: data-mh-cta="Book a call|#book" still renders,
     now as a small pill riding just above the bottom capsule, near
     the thumb. On several pages it is the only door to the booking
     section, so it could not simply be deleted with the bar.

   Same laws as before: self-installing (one include, no markup),
   ROOT-aware so walls/ and tracks/ resolve one level down, painted
   from the shared tokens in css/style.css.

   Opt out or trim on a page with a body attribute:
     data-masthead="off"       owner desks and redirect stubs
     data-masthead="minimal"   checkout: no map, nothing to wander to
     data-masthead="deferred"  cinematic intros: the action stays
                               hidden until the page calls reveal()
   ============================================================ */
(function () {
  /* MCC POLISH LAYER — one injection, the whole house gets the gloss. */
  (function () {
    var s = document.createElement("style");
    s.id = "mcc-polish";
    s.textContent = `/* ============================================================
   MCC POLISH LAYER: the global "sexier" pass (2026-08-15)

   (Colon, not a long dash, and deliberately. This block is injected as
   real DOM on every page, so its comment text lands in outerHTML where
   the house's no-long-dash gate reads. The two long dashes elsewhere in
   this file are ordinary JS comments and never ship.)

   One additive layer over the flat house system. Nothing here moves
   structure, removes content, or adds a request: no new fonts, no new
   images, no blocking work. Every animation runs on transform/opacity
   (GPU) and is switched off under prefers-reduced-motion.

   What it adds, site-wide, on every page that wears style.css:
     1. A UNIFORM reveal system (.rv -> .rv.is-in). The pattern used to be
        copy-pasted per page with three different class names (.in / .on),
        so only four pages had it. This block makes one canonical version
        and accepts the legacy hooks, so the whole site reveals the same.
     2. Typography that moves: kickers get a drawn underline, display
        lines get a masked rise, links get a sliding underline.
     3. Surface polish: buttons get a light-sheen sweep, the appbar and
        brand mark get a glow, focus rings and selection get the house
        treatment.
   ============================================================ */

/* ---------- 0. reveal primitives ---------- */
/* The canonical hidden state. JS adds .is-in when the element scrolls into
   view; the legacy .in / .on hooks are honored so the four pages that
   already had their own reveal keep working with one shared style. */
.rv, [data-rv] {
  opacity: 0;
  transform: translateY(1.5rem);
  transition:
    opacity 0.7s ease,
    transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: var(--rv-d, 0s);
}
.rv.is-in, .rv.in, .rv.on,
[data-rv].is-in, [data-rv].in, [data-rv].on {
  opacity: 1;
  transform: none;
}

/* ---------- 1. kicker: the eyebrow gets a drawn underline ---------- */
/* .kicker is display:block elsewhere, so the line tracks the column width,
   not the word. inline-block keeps the sweep under the text itself. */
.kicker { position: relative; display: inline-block; }
.kicker::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -0.45em;
  height: 2px;
  width: 100%;
  background: linear-gradient(90deg, var(--ruby-hot), transparent);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) 0.1s;
}
.kicker.is-in::after, .is-in > .kicker::after, .is-in .kicker::after { transform: scaleX(1); }

/* ---------- 2. display lines: a masked rise for big headlines ---------- */
/* Applied to elements the page marks [data-rise] or .rise; the mask keeps
   descenders from clipping during the climb. */
[data-rise], .rise {
  display: inline-block;
  overflow: hidden;
  vertical-align: bottom;
}
[data-rise] > *, .rise > * {
  display: inline-block;
  transform: translateY(110%);
  transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: var(--rise-d, 0s);
}
.is-in [data-rise] > *, .is-in [data-rise] > *,
.is-in .rise > *, .is-in.rise > * { transform: translateY(0); }

/* ---------- 3. links: sliding underline instead of a color swap ---------- */
/* Scoped to running text and nav rows so buttons/tabs/cards (which carry
   their own hover) are not double-decorated. */
.site-foot__links a,
main p a:not(.btn):not(.appbar__tab):not([class*="card"]):not([class*="tile"]),
main li a:not(.btn),
.eu-ctas a {
  position: relative;
  text-decoration: none;
  background-image: linear-gradient(currentColor, currentColor);
  background-size: 0% 1.5px;
  background-repeat: no-repeat;
  background-position: left 96%;
  transition: background-size 0.35s cubic-bezier(0.2, 0.7, 0.2, 1), color 0.25s ease;
  padding-bottom: 1px;
}
.site-foot__links a:hover,
main p a:not(.btn):not(.appbar__tab):not([class*="card"]):not([class*="tile"]):hover,
main li a:not(.btn):hover,
.eu-ctas a:hover {
  background-size: 100% 1.5px;
  color: var(--ruby-hot);
}

/* ---------- 4. buttons: light-sheen sweep on hover ---------- */
/* .btn is already position:relative + isolate (line 1904). The sheen is a
   pseudo-element highlight that sweeps across on hover; overflow is clipped
   to the pill shape. transform/opacity only, so it costs one composite. */
.btn { overflow: hidden; }
.btn::before {
  content: "";
  position: absolute;
  top: 0; bottom: 0;
  left: -60%;
  width: 45%;
  background: linear-gradient(105deg, transparent, rgba(255,255,255,0.22) 50%, transparent);
  transform: skewX(-20deg) translateX(0);
  transition: transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: none;
  z-index: 1;
}
.btn:hover::before { transform: skewX(-20deg) translateX(340%); }
/* keep the label above the sheen */
.btn > * { position: relative; z-index: 2; }
/* a livelier press */
.btn:active { transform: translateY(1px) scale(0.97); transition-duration: 0.08s; }

/* ---------- 5. appbar: a breath of glow + livelier tabs ---------- */
.appbar__tab { transition: color 0.2s, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.25s; }
.appbar__tab:hover { transform: translateY(-3px); }
.appbar__tab:active { transform: translateY(0) scale(0.92); }
/* the center mark gets a slow ring pulse so the bar reads alive at rest */
.appbar__tab img, .appbar__m { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.appbar__tab:hover img, .appbar__tab:hover .appbar__m { transform: scale(1.12) rotate(-4deg); }

/* ---------- 6. brand mark: a soft glow so it reads as the house seal ---------- */
.brand__mark { filter: drop-shadow(0 0 0 rgba(229,56,59,0)); transition: filter 0.4s ease; }
.brand__mark:hover { filter: drop-shadow(0 4px 18px rgba(229,56,59,0.45)); }

/* ---------- 7. chrome: selection + focus get the house treatment ---------- */
::selection { background: var(--ruby-hot); color: #fff; text-shadow: none; }
:focus-visible {
  outline: 2px solid var(--ruby-hot);
  outline-offset: 3px;
  border-radius: 4px;
  box-shadow: 0 0 0 4px rgba(229,56,59,0.18);
}

/* ---------- 8. smooth in-page anchors (motion-safe only) ---------- */
html { scroll-behavior: smooth; }

/* ---------- reduced motion: everything above stands down ---------- */
@media (prefers-reduced-motion: reduce) {
  .rv, [data-rv] { opacity: 1 !important; transform: none !important; transition: none !important; }
  [data-rise] > *, .rise > * { transform: none !important; transition: none !important; }
  .btn::before { display: none; }
  .appbar__tab, .appbar__tab img, .appbar__m { transition: none; }
  .appbar__tab:hover { transform: none; }
  .kicker::after { transition: none; transform: scaleX(1); }
  html { scroll-behavior: auto; }
}
`;
    (document.head || document.documentElement).appendChild(s);
  })();

  "use strict";

  var mode = (document.body && document.body.getAttribute("data-masthead")) || "";
  if (mode === "off") return;

  /* where the house root sits, read off this script's own address,
     the same trick counter.js uses so a page in walls/ or tracks/
     links to the real rooms instead of phantom siblings */
  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/masthead\.js.*$/, "") : "";
  })();

  /* THE WHOLE HOUSE: the map is the orphan rescue. Every public
     room gets a door here, because a room reachable from nowhere may
     as well not exist: the archive and the production house were both
     unreachable before this list. The four
     wings of the bottom bar carry the sixteen rooms a visitor walks
     between daily; everything else lives here. */
  var DRAWER = [
    { group: "The album", rooms: [
      { href: "album.html",     label: "I AM HERE: play the album" },
      /* the six track pages are gone; the reel is where a record's film
         and its licensing door both live now, so the drawer names that
         instead of six doors into the same two things */
      { href: "films.html",     label: "Lyric videos: every record, with the words" },
    ] },
    { group: "The music", rooms: [
      { href: "catalogue.html", label: "The whole catalogue" },
      { href: "films.html",     label: "Lyric videos" },
      { href: "license.html",   label: "License the music" },
      { href: "sponsor.html",   label: "Sponsor the work" },
    ] },
    { group: "The work", rooms: [
      { href: "gallery.html",      label: "The gallery & print shop" },
      { href: "prints.html",       label: "The Print Shop" },
      { href: "gallery.html#shop", label: "Buy a print" },
      { href: "merch.html",        label: "The Rack: merch" },
      { href: "walls.html",        label: "Every wall" },
      { href: "portfolio.html",    label: "The full portfolio" },
      { href: "production.html",   label: "The production house" },
      { href: "management.html",   label: "The Socials Room" },
      { href: "archive.html",      label: "The archive" },
    ] },
    /* Equity Uprise is two halves and the map says so: the program page
       is the finished record, these are the rooms where the movement is
       used. A room reachable from nowhere may as well not exist, and
       that goes double for the ones a visitor is meant to come back to. */
    { group: "Equity Uprise", rooms: [
      { href: "equity-uprise.html", label: "The movement & the record" },
      { href: "topics.html",        label: "What we're listening about" },
      { href: "fellowships.html",   label: "The fellowship directory" },
      { href: "profile.html",       label: "People on the platform" },
      { href: "dashboard.html",     label: "Your Uprise desk" },
      { href: "fellowship.html",    label: "The Policy Fellowship terminal" },
      { href: "docket-516.html",    label: "Docket 516: the public record" },
    ] },
    /* The Closet shares the fifth tab's wing with the studio, so the map
       files them together: one column of the bar, one group here. Sites
       itself is listed under "The house" with the rest of the studio, not
       repeated here — the group is named for what is peculiar to it. */
    { group: "The Closet", rooms: [
      { href: "prayer-closet.html",  label: "The Closet: Season 001" },
      /* Season 001 was three drops and is one, in three colorways, by the
         owner's call. Seek First and Salt & Light are retired; their rooms
         and their redirects are gone with them. */
      { href: "closet/sent.html",    label: "The Halo Drop · Heav'Yeah" },
      { href: "inner-room.html",     label: "The Inner Room: read & pray" },
    ] },
    { group: "The house", rooms: [
      { href: "hire.html",      label: "Hire the desk" },
      { href: "sites.html",     label: "McCluster Sites: your site, run by the studio" },
      { href: "console.html",   label: "Client console" },
      { href: "onboard.html",   label: "Sites onboarding: walk the questions" },
      { href: "account.html",   label: "Your profile" },
      { href: "matthew-mccluster.html", label: "Who I am" },
      { href: "press.html",     label: "Press & citations" },
      { href: "ecosystem.html", label: "The ecosystem" },
      /* HITMAN used to be reachable only because js/theme.js rewrote the
         fifth tab into it after boot. That override was retired when the
         shop took the tab, so this line is now the page's only door.
         Deleting it orphans a whole room. */
      { href: "hitman-facility.html", label: "HITMAN: Prim3 Site 0" },
    ] },
  ];

  var CSS = "" +
    ".mh__mark{display:flex;align-items:center;gap:0.5rem;text-decoration:none;flex:none}" +
    ".mh__mark img{width:1.65rem;height:auto;display:block}" +
    ".mh__mark b{font-weight:800;font-size:0.72rem;letter-spacing:0.22em;text-transform:uppercase;color:var(--cream,#f4efe6)}" +
    /* the page's own action, riding above the one bar, near the thumb */
    ".mh__cta{position:fixed;z-index:199;right:clamp(0.9rem,4vw,2rem);" +
      "bottom:calc(var(--appbar-h,4.6rem) + 1.5rem + env(safe-area-inset-bottom));" +
      "text-decoration:none;font-family:var(--body,system-ui,sans-serif);font-weight:800;" +
      "font-size:0.72rem;letter-spacing:0.04em;color:#fff;" +
      "background:var(--metal,linear-gradient(165deg,#ff5a5c 0%,#e5383b 34%,#b3121b 58%,#ff6a6c 100%));" +
      "border-radius:100px;padding:0.62rem 1.15rem;white-space:nowrap;" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.5),0 14px 34px -12px rgba(0,0,0,0.8);" +
      "transition:opacity 0.5s ease,transform 0.5s ease}" +
    ".mh__cta.is-veiled{opacity:0;transform:translateY(0.6rem);pointer-events:none}" +
    /* the map: the whole house, so no room is an orphan */
    ".mhd{position:fixed;inset:0;z-index:215;display:none;overflow-y:auto;" +
      "background:rgba(7,5,4,0.97);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}" +
    "html[data-theme=\"light\"] .mhd{background:rgba(250,247,242,0.98)}" +
    ".mhd.on{display:block}" +
    ".mhd__in{max-width:60rem;margin:0 auto;padding:1rem clamp(1rem,4vw,2rem) 6rem;" +
      "font-family:var(--body,system-ui,sans-serif);color:var(--cream,#f4efe6)}" +
    ".mhd__bar{display:flex;align-items:center;justify-content:space-between;padding:0.35rem 0 2rem}" +
    ".mhd__x{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;width:2.5rem;height:2.5rem;" +
      "border-radius:100px;font-size:1.05rem;font-weight:800;color:var(--cream,#f4efe6);" +
      "background:linear-gradient(180deg,var(--glass-hi,rgba(255,255,255,0.12)),var(--glass-lo,rgba(255,255,255,0.045)));" +
      "box-shadow:inset 0 0 0 1px var(--edge,rgba(255,255,255,0.14))}" +
    ".mhd__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr));gap:2rem}" +
    ".mhd__grp b{display:block;font-weight:800;font-size:0.64rem;letter-spacing:0.24em;text-transform:uppercase;" +
      "color:var(--ruby-hot,#e5383b);margin-bottom:0.9rem}" +
    ".mhd__grp a{display:block;text-decoration:none;font-weight:700;font-size:1.02rem;" +
      "color:var(--cream,#f4efe6);padding:0.42rem 0;opacity:0.82;transition:opacity 0.2s ease}" +
    ".mhd__grp a:hover{opacity:1}" +
    /* the map clears the bottom capsule so the last room is tappable */
    ".mhd__in{padding-bottom:calc(6rem + var(--appbar-h,4.6rem))}";

  function esc(x) { var d = document.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; }

  /* which room are we standing in? paths one level deep (walls/, tracks/)
     keep their folder, so the map and the analytics can tell them apart */
  var here = (function () {
    var p = location.pathname.replace(/\/+$/, "/");
    var parts = p.split("/").filter(Boolean);
    var file = parts.length ? parts[parts.length - 1] : "";
    var dir = parts.length > 1 ? parts[parts.length - 2] : "";
    if (!file || file.indexOf(".html") === -1) return "index.html";
    return (dir === "walls" || dir === "tracks") ? dir + "/" + file : file;
  })();

  function build() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    /* the page's own action, declared on the body. It used to ride in
       the top bar; with no top bar it rides above the bottom capsule,
       because on several pages it is the ONLY door to the section it
       points at (nothing else on index.html or hire.html links #book) */
    var ctaRaw = (document.body.getAttribute("data-mh-cta") || "").split("|");
    var cta = null;
    if (mode !== "minimal" && ctaRaw.length === 2 && ctaRaw[0] && ctaRaw[1]) {
      cta = document.createElement("a");
      cta.className = "mh__cta";
      cta.setAttribute("data-cta", "masthead");
      cta.href = ctaRaw[1].charAt(0) === "#" ? ctaRaw[1] : ROOT + ctaRaw[1];
      cta.textContent = ctaRaw[0];
      if (mode === "deferred") cta.classList.add("is-veiled");
      document.body.appendChild(cta);

      /* ONE DOMINANT JOB OWNS THE FIRST VIEWPORT. On a page that opens with
         a hero, this pill was a third button arguing with the hero's own
         doors before the visitor had finished reading the name. It holds
         while the hero is on screen and arrives as the hero leaves. A page
         with no hero never sets the flag, so nothing there changes. */
      var hero = document.querySelector(".hero, #hero");
      if (hero) {
        /* Measured off the hero's bottom edge, not its intersection ratio:
           the hero is a sticky scene several viewports tall, so the ratio of
           it that happens to be on screen never reaches a useful threshold.
           What matters is whether the opening still owns the screen. */
        document.documentElement.classList.add("hero-hold");
        var pending = false;
        var settle = function () {
          pending = false;
          var bottom = hero.getBoundingClientRect().bottom;
          document.documentElement.classList.toggle("hero-hold", bottom > window.innerHeight * 0.6);
        };
        var onMove = function () {
          if (pending) return;
          pending = true;
          requestAnimationFrame(settle);
        };
        window.addEventListener("scroll", onMove, { passive: true });
        window.addEventListener("resize", onMove, { passive: true });
        settle();
      }

      /* the pill is a stand-in, never a duplicate. It exists because the
         section it points at is often far down the page with nothing else
         linking it. The moment you can actually SEE that section, or the
         page's own button for the same destination, the pill steps aside
         rather than sitting on top of it. */
      var watch = [];
      if (cta.getAttribute("href").charAt(0) === "#") {
        var target = document.getElementById(cta.getAttribute("href").slice(1));
        if (target) watch.push(target);
      }
      /* COMPARE THE DESTINATIONS, NOT THE STRINGS.
         This read getAttribute("href") on both sides. Setting cta.href
         resolves it, so the pill's attribute comes back absolute
         ("http://host/pay.html?...") while the page's own buttons carry
         what their markup says ("pay.html?..."), and the two never match.
         It went unnoticed for as long as every page's action was a
         "#fragment", which is what a buy button is -- got a pill that no
         longer recognised the button it stands in for, and sat on top of it. */
      var dest = function (el) {
        try { return new URL(el.getAttribute("href"), location.href).href; }
        catch (e) { return el.getAttribute("href"); }
      };
      var want = dest(cta);
      [].forEach.call(document.querySelectorAll("a[href]"), function (a) {
        if (a !== cta && dest(a) === want) watch.push(a);
      });
      if (watch.length && window.IntersectionObserver) {
        /* COUNT WHAT IS ON SCREEN, DO NOT ACCUMULATE GUESSES.

           This kept a running total and nudged it by one per entry, then
           clamped it at zero. With a single watched element that is the
           same thing as tracking state. With several -- which is what a
           page with three buy buttons has -- the first callback reports
           every one of them at once, so one visible and two not came to
           +1 -1 -1 = -1, clamped to 0, and the one that was genuinely on
           screen was forgotten. After that the pill sat on top of a
           button it was standing in for, and only on the widths where
           that button happened to be visible at rest.

           A list of what is currently intersecting cannot drift. */
        var onScreen = [];
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            var i = onScreen.indexOf(en.target);
            if (en.isIntersecting && i < 0) onScreen.push(en.target);
            else if (!en.isIntersecting && i > -1) onScreen.splice(i, 1);
          });
          cta.classList.toggle("is-veiled", onScreen.length > 0);
        /* no top inset: an anchor target is often a thin marker that lands
           flush against the top edge after a jump, and it still means the
           visitor has arrived. The bottom inset keeps a section barely
           peeking above the bar from counting as reached. */
        }, { rootMargin: "0px 0px -15% 0px" });
        watch.forEach(function (el) { io.observe(el); });
      }
    }

    var drawer = null;
    if (mode !== "minimal") {
      drawer = document.createElement("div");
      drawer.className = "mhd";
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-label", "Every room");
      drawer.innerHTML =
        '<div class="mhd__in"><div class="mhd__bar">' +
        '<a class="mh__mark" href="' + ROOT + 'index.html"><img src="' + ROOT + 'assets/img/m-mark.png" alt=""><b>McCluster</b></a>' +
        '<button class="mhd__x" type="button" data-mh-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:1em;height:1em;vertical-align:-2px"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
        '<div class="mhd__grid">' + DRAWER.map(function (g) {
          return '<div class="mhd__grp"><b>' + esc(g.group) + "</b>" +
            g.rooms.map(function (r) {
              return '<a href="' + ROOT + esc(r.href) + '">' + esc(r.label) + "</a>";
            }).join("") + "</div>";
        }).join("") + "</div></div>";
      document.body.appendChild(drawer);

      document.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("[data-mh-open]")) { openMap(); return; }
        if (e.target.closest && (e.target.closest("[data-mh-close]") || e.target === drawer)) closeMap();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && drawer.classList.contains("on")) closeMap();
      });
    }

    function openMap() {
      if (!drawer) return;
      drawer.classList.add("on");
      document.body.style.overflow = "hidden";
      if (window.MCC_TRACK) window.MCC_TRACK("masthead_rooms", { from: here });
    }
    function closeMap() {
      if (!drawer) return;
      drawer.classList.remove("on");
      document.body.style.overflow = "";
    }

    /* open() is how the bottom bar's Everything slot reaches the map.
       reveal()/veil() survive for the cinematic door, which now has only
       the page's action to bring in on the beat. */
    window.MCC_MASTHEAD = {
      open: openMap,
      close: closeMap,
      hasMap: function () { return !!drawer; },
      reveal: function () { if (cta) cta.classList.remove("is-veiled"); },
      veil: function () { if (cta) cta.classList.add("is-veiled"); },
      here: here,
      root: ROOT,
    };
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);

  /* ============================================================
     THE GLOBAL REVEAL — one observer for the whole house.

     The .rv pattern used to be copy-pasted per page with three
     different "shown" class names (.in on gallery/production/sites,
     .on in the closet), so only four pages revealed and the rest of
     the site just stood there. The mcc-polish style block at the top
     of this file now injects one canonical reveal that accepts all
     three hooks; this block is the observer that fires it on every
     page that includes this file.

     Two jobs:
       1. Observe every element already tagged .rv / [data-rv].
       2. On pages with NO .rv at all, tag the obvious content blocks
          (kickers, section heads, cards, buttons, foot links) so the
          reveal still reaches them. Pages with their own cinematic
          intro keep full control: .hero, the preloader, the VR cabin,
          and anything already mid-animation are never touched.

     Reduced motion and no-IO both fail open: everything is simply
     shown, never hidden waiting on a script that will not run.
     ============================================================ */
  (function () {
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var noIO = !("IntersectionObserver" in window);

    /* Never auto-reveal the pieces that own their entrance. */
    var EXCLUDE = ".preloader, .hero, .hero__title, .hero__line, .finale__title, " +
      ".workvr, .vrbrief, .soundask, .appbar, .mh__cta, .mhd, [data-no-rv]";

    function showAll(scope) {
      (scope || document).querySelectorAll(".rv, [data-rv]").forEach(function (el) {
        el.classList.add("is-in");
      });
    }

    if (reduce || noIO) {
      if (document.body) showAll();
      else document.addEventListener("DOMContentLoaded", function () { showAll(); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.06 });

    function arm() {
      /* If a page already tags its own reveals, honor exactly those. */
      var tagged = document.querySelectorAll(".rv, [data-rv]");
      if (tagged.length) {
        tagged.forEach(function (el) { io.observe(el); });
        return;
      }
      /* Otherwise reach for the obvious blocks, skipping the cinematic
         furniture and anything already inside an excluded subtree. */
      var seeds = document.querySelectorAll(
        "main section, main article, .kicker, .btn, .card, .case__inner, " +
        ".hire__disc-tile, .site-foot__links a, .site-foot__note"
      );
      var n = 0;
      seeds.forEach(function (el) {
        if (el.closest(EXCLUDE)) return;
        /* stagger siblings that arrive together, capped so long lists
           do not queue a second of delay at the bottom */
        el.classList.add("rv");
        el.style.setProperty("--rv-d", (Math.min(n % 6, 5) * 0.06).toFixed(2) + "s");
        n++;
        io.observe(el);
      });
    }

    if (document.body) arm();
    else document.addEventListener("DOMContentLoaded", arm);
  })();
})();
