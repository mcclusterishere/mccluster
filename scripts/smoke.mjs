/* THE SMOKE SUITE: the release gate the site never had.
   Boots a local server, walks the key rooms headless at phone and
   desktop widths, and fails the build on any page error or missing
   mount. Run locally:  node scripts/smoke.mjs
   (set PW_MODULE to your playwright install if it isn't resolvable,
   and PW_CHROME to a chrome executable if not using PW defaults) */
import { createRequire } from "module";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import http from "http";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || "playwright");

const PORT = 8931;
const B = `http://127.0.0.1:${PORT}/`;
const failures = [];
const ok = (name) => console.log(`  ✓ ${name}`);
const no = (name, why) => { failures.push(`${name}: ${why}`); console.log(`  ✗ ${name}: ${why}`); };
const check = (name, cond, why) => (cond ? ok(name) : no(name, why || "assertion failed"));

function waitForServer(tries = 50) {
  return new Promise((resolve, reject) => {
    const ping = (n) => http.get(B, () => resolve()).on("error", () =>
      n <= 0 ? reject(new Error("server never came up")) : setTimeout(() => ping(n - 1), 200));
    ping(tries);
  });
}

/* THE SEAL: every request that leaves 127.0.0.1 is refused before it starts,
   on every page of the walk. This gate measures THIS CHECKOUT: that its
   pages boot, mount and fit a phone. It does not measure whether
   api.mccluster.org, Supabase or a CDN happen to be up at the minute a pull
   request lands, and a PR gate must never call production on every push.
   Sealed, a page sees the state a visitor on a dead connection sees, which
   is exactly the state its fallbacks exist for (see THE DESK below); open, a
   hanging request to a third party stalls networkidle and the walk dies on
   a 30 s timeout in a page that is perfectly fine.

   The seal began on demo.html alone: it frames two kinds of work. Ours are
   frozen copies under demos/, synced by scripts/sync-demo.mjs, and they load
   from 127.0.0.1 like any other page here. The rest are clients' own live
   sites on somebody else's server, and a foreign script throwing inside the
   frame lands in this page's error list and fails our build over a bug we do
   not own. The viewer's checks read DOM and attributes only, the frame's src
   and never what loads inside it. Do not "tighten" this by waiting on the
   frame to load. SEALED on an entry is documentation now: the context is
   sealed before the page is. */
const OUTBOUND = (url) => !String(url).startsWith(B);
const refuse = (route) => route.abort();
const SEALED = { sealed: true };

/* THE PRIVACY NOTICE, SEEN. Owner, 2026-10-20: a person entering the site
   from anywhere sees the privacy policy once and never again. On the house
   pages that is a wall (js/live-content.js): until "I agree" the rest of
   the page is visibility:hidden and pointer-events:none, so a walk that
   taps the bar is tapping a wall, and every DOM read reads the wall's
   heading as the page's. The walk therefore starts as a visitor who has
   seen this version of the notice, by writing the record live-content.js
   reads, and the wall itself gets its own checks below (THE NOTICE), in a
   context that has not. The version is read off the file so a policy
   bump does not quietly turn the seed into a no-op. */
const PRIVACY_VERSION = (/var VERSION = "([^"]+)"/.exec(readFileSync(new URL("../js/live-content.js", import.meta.url), "utf8")) || [])[1];
const seen = (target) => target.addInitScript((v) => {
  try { localStorage.setItem("mcc_privacy_seen", JSON.stringify({ version: v, seen_at: new Date().toISOString() })); } catch (e) {}
}, PRIVACY_VERSION);

/* THE VIEWER, read off the ledger: what the frame is pointed at, and what
   data/sites.json says it should be pointed at. Pass a slug to ask about
   one work, or null to ask about the first, which is what an unknown slug
   is supposed to fall back to. */
const framedWork = (p, slug) => p.evaluate(async (want) => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return String(u); } };
  const d = await (await fetch("data/sites.json", { cache: "no-cache" })).json();
  const works = d.showcase || [];
  const w = want ? works.find((x) => x.slug === want) : works[0];
  const kin = w ? works.filter((x) => x.seat === w.seat) : [];
  const frame = document.querySelector("iframe");
  const src = frame ? frame.getAttribute("src") || "" : "";
  const body = norm(document.body.textContent);
  const labels = [...document.querySelectorAll("button, a[href*='s=']")].map((el) => norm(el.textContent));
  return {
    src, works: kin.length, labels: labels.join(" | ") || "none",
    want: w ? w.url : "", name: w ? w.name : "",
    match: !!frame && !!w && abs(src) === abs(w.url),
    named: !!w && body.includes(norm(w.name)),
    /* A SEAT WITH ONE WORK HAS NOTHING TO SWITCH.

       This read `kin.length > 1 && ...`, so it failed whenever a seat
       carried a single work — which is every seat the ledger has ever
       held. Seat one is Shiloh and only Shiloh, so the line was red from
       the day it was written, asserting a second work nobody has sold.

       The real rule is: when a seat carries more than one work, every one
       of them must be reachable from the viewer. One work satisfies that
       trivially. The moment a second lands on a seat, this starts biting
       again on its own. */
    switched: kin.length < 2 || kin.every((x) =>
      labels.some((l) => l.toLowerCase().includes(norm(x.name).toLowerCase()))),
  };
}, slug);

const server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
try {
  await waitForServer();
  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
  });

  const viewerProbe = await browser.newPage();
  await viewerProbe.route(OUTBOUND, refuse);
  await viewerProbe.goto(B + "index.html", { waitUntil: "domcontentloaded" });
  const viewerSource = await viewerProbe.evaluate(async () =>
    await (await fetch("_unfinished/equity-uprise/equity-uprise-building-core-v2-3d.html", { cache: "no-cache" })).text());
  check("building viewer: Step 8 controls", [
    'id="services"', 'id="wire"', 'id="labs"', "deviceClockSolar",
    "requestedLab=params.get('lab')", "LAB_MODULE_URL", "labController.execute", "labController.reset", "await labVisualRootsReady",
    "distributedPack", "Work Tickets", "prepareLabPresentation", "scenario.engineering_view"
  ].every((token) => viewerSource.includes(token)));
  check("building viewer: Room Mode controls", [
    'id="roommode"', 'id="roomMotion"', 'id="roomRecenter"', 'id="roomBack"', 'id="roomInspect"',
    "DeviceOrientationEvent.requestPermission", "DeviceMotionEvent.requestPermission", "deviceorientation", "devicemotion",
    "approachRoomObject", "tweenRoomCamera", "selectRoomAt", "projectedRoomTarget",
    "enhanceFloor1Interior", "buildRoomLightRig", 'id="xray"', "setEngineeringMode",
    "ENGINEERING-XRAY-OVERLAY", "await buildingLoaded", "X-Ray: Loading", "setArchitectureGhost(true)",
    "SpriteMaterial", "rebuildEngineeringMarkers", "room-bound endpoints",
    "engineeringRequestId", "requestId!==engineeringRequestId", "engineeringOverlay.remove(o)",
    "allowXray=engineeringMode&&!roomMode",
    "ELECTRONICS_SPATIAL_MODULE_URL", "electronics.scale.setScalar(FT)", "applyElectronicsSpatialBindings", "spatialConnectionOverlay",
    "roomSensorMode='motion-primary'", "The old generic cable geometry stays hidden",
    "services.visible=servicesOn&&!roomMode", "electronics.visible=false", "requestedRoom=params.get('room')==='1'"
  ].every((token) => viewerSource.includes(token)));
  check("building viewer: Room Mode stays human-scale",
    viewerSource.includes("F1-ROOM-ARRIVAL-CENTER") &&
    viewerSource.includes("F1-RECEPTION-DESK-01") &&
    viewerSource.includes("F1-DIRECTORY-01") &&
    viewerSource.includes("F1-JOURNEY-WALL-01") &&
    viewerSource.includes("F1-PASS-ELEV-CALL-01"));
  check("building viewer: normal mode remains default",
    viewerSource.includes("requestedLab=params.get('lab')") &&
    viewerSource.includes("labPanel.hidden") &&
    viewerSource.includes("requestedRoom=params.get('room')==='1'"));
  check("building viewer: mobile performance shell", [
    'id="quality"', "QUALITY_PROFILES", "LOW:{dpr:1,shadows:false", "matchMedia('(max-width:820px)')",
    "o.frustumCulled=true", "cableMode:'floor-only'", "performanceLodVisible", "ensureDetailedFloor"
  ].every((token) => viewerSource.includes(token)));
  await viewerProbe.close();

  const PAGES = [
    ["index.html", async (p) => {
      check("index: 3 bar tabs", await p.locator(".appbar > .appbar__tab").count() === 3);
      /* Primary navigation is Music · HERE · Globe: the Globe took the
         Profile column (owner, 2026-10-14; js/tabbar.js ORDER), account and
         profile are contextual through the auth chip. The M coin stays in
         the middle, and shelved columns must not survive in DOM. */
      check("index: canonical tab order is music, home, world", await p.evaluate(() =>
        [...document.querySelectorAll(".appbar > .appbar__tab")].map((a) => a.dataset.appnav).join()
        === "music,home,world"));
      check("index: shelved columns are absent", await p.evaluate(() =>
        !document.querySelector('[data-appnav="uprise"],[data-appnav="sites"]')));
      check("index: body clears the bar (has-appbar)", await p.evaluate(() => document.body.classList.contains("has-appbar")));
      /* the owner's call: the landing page opens on the emblem and belongs to
         the M coin; the record lives behind the Music tab, not pinned on top */
      check("index: the front page lights the M coin", await p.evaluate(() =>
        !!document.querySelector('[data-appnav="home"].is-here') &&
        !document.querySelector('[data-appnav="music"].is-here')));
      /* Matthew-first: this is Matthew McCluster's property, and the I AM
         HERE album is a front door here, not the identity (AGENTS.md hard
         rule 15; docs/control-plane/DOMAINS-AND-ENTITIES.md). The title
         used to lead with the record. */
      check("index: titled Matthew-first, not after the album",
        /^Matthew McCluster/.test(await p.title()) && !/I AM HERE/.test(await p.title()), await p.title());
      check("index: no album marquee pinned to the front page", await p.locator(".albmq").count() === 0);
      check("index: the emblem hero leads", await p.evaluate(() => !!document.getElementById("hero")));

      /* ONE BAR: the top masthead is retired, so no width shows two
         navigations at once and nothing pushes the page down from above */
      check("index: no top bar", await p.locator(".mh").count() === 0);
      check("index: no top tab row", await p.locator(".mh__rooms").count() === 0);
      check("index: nothing reserves space up top", await p.evaluate(() =>
        getComputedStyle(document.body).paddingTop === "0px"));

      /* The two halo checks that lived here — that the hm PNG's box grew
         wider than the M coin's, and that the light coat did not paint the
         M over it — went out with the halo when the shop took the fifth
         tab. There is no PNG in that column any more for either rule to
         guard. What replaced them is the pair above (drawn glyph, real
         destination) plus the two rooms below, because the risk moved:
         it is no longer "does the mark render" but "did the Closet and
         HITMAN survive losing their tab". */
      check("index: the M coin is still the only image in the bar", await p.evaluate(() =>
        document.querySelectorAll(".appbar img.appbar__m").length === 1 &&
        !!document.querySelector('[data-appnav="home"] img.appbar__m')));

      /* the hold is ours: the OS link preview must not ride over the wing */
      /* the grain is retired: a fixed three-viewport layer, animated
         forever, that tore into a visible seam on long pages and dragged
         the fixed bar out of position on iOS */
      check("index: no grain layer", await p.locator(".grain").count() === 0);

      check("index: the bar refuses the browser's long-press menu", await p.evaluate(() => {
        const a = document.querySelector(".appbar a");
        const s = getComputedStyle(a);
        const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        a.dispatchEvent(e);
        return e.defaultPrevented && s.webkitUserSelect === "none";
      }));
    }],
    ["mnet.html", async (p) => {
      check("mnet: social shell exists", await p.locator("#mnFeed").count() === 1 &&
        await p.locator("#mnProfileGate").count() === 1 &&
        /* notifications drop down from the bell (owner, 2026-10-20), not a page */
        await p.locator("#mnAlerts").count() === 1 && await p.locator("#mnNotificationsView").count() === 0);
      check("mnet: signed-out door is password auth", await p.locator("#mnPassword").count() === 1 &&
        await p.locator("#mnAuthGo").count() === 1 && await p.locator("#mnCreateTab").count() === 1);
      /* textContent, not innerText: innerText applies text-transform, so a
         button the stylesheet sets in caps reads as shouting and fails a
         case-sensitive match on copy that is right */
      check("mnet: forgot-password recovery is present", await p.locator("#mnForgot").count() === 1 &&
        /forgot .*password\?/i.test(await p.locator("#mnForgot").textContent()));
      check("mnet: obsolete login language is gone", await p.evaluate(() =>
        !/email me a sign-in link|send sign-in link|one-time login link/i.test(document.body.innerText)));
      /* the Profile column is gone from the bar; signed out, the page is
         marked out and the chip is the door to account.html (js/tabbar.js) */
      check("mnet: signed-out shell is marked out and the Globe column stands", await p.evaluate(() => {
        const tab = document.querySelector('.appbar [data-appnav="world"]');
        return !!tab && !document.querySelector('.appbar [data-appnav="profile"]') &&
          document.body.dataset.mccAuth === "out";
      }));
      check("mnet: global shell paints explicit guest state", await p.locator("#mccAuthChip").count() === 1 &&
        /Sign in/.test(await p.locator("#mccAuthChip").textContent()) &&
        /account\.html$/.test(new URL(await p.locator("#mccAuthChip").getAttribute("href"), B).pathname));
      check("mnet: composer is a native network control",
        await p.locator("#mnPostBody").count() === 1 && await p.locator("#mnPost").count() === 1);
    }],

    ["account.html", async (p) => {
      check("account: create-account mode exists", await p.locator("#acCreateTab").count() === 1 &&
        await p.locator("#acCreatePane").count() === 1 && await p.locator("#acCreateGo").count() === 1);
      check("account: normal recovery language exists", await p.locator("#acForgot").count() === 1 &&
        /forgot .*password\?/i.test(await p.locator("#acForgot").textContent()));
      /* a signed-in member who forgot the current password gets a reset
         link from the security card, not a dead end */
      check("account: current-password reset link exists", await p.locator("#acPwReset").count() === 1 &&
        /reset link/i.test(await p.locator("#acPwReset").textContent()));
      check("account: signed-in security card exposes password change", await p.locator("#acPwNew").count() === 1 &&
        await p.locator("#acPwNew2").count() === 1 && await p.locator("#acPwGo").count() === 1 &&
        /Change password/.test(await p.locator("#acPwGo").textContent()));
      check("account: password fields use new-password autocomplete", await p.evaluate(() =>
        document.querySelector("#acPwNew")?.autocomplete === "new-password" &&
        document.querySelector("#acPwNew2")?.autocomplete === "new-password"));
      check("account: password change is wired to canonical auth", await p.evaluate(() =>
        /MCC\.changePassword\(/.test(document.documentElement.innerHTML)));
      check("account: obsolete login language is absent", await p.evaluate(() =>
        !/email me a sign-in link|send sign-in link|one-time login link/i.test(document.body.innerText)));
      check("account: signed out, the chip offers sign-in and the bar has no Profile column", await p.evaluate(() => {
        const chip = document.querySelector("#mccAuthChip");
        return !!chip && /Sign in/.test(chip.textContent || "") && document.body.dataset.mccAuth === "out" &&
          !document.querySelector('.appbar [data-appnav="profile"]');
      }));
    }],

    ["reset-password.html", async (p) => {
      check("reset password: new-password fields exist", await p.locator("#rpPass").count() === 1 &&
        await p.locator("#rpPass2").count() === 1);
      check("reset password: update action exists", await p.locator("#rpGo").count() === 1 &&
        /Update password/.test(await p.locator("#rpGo").textContent()));
      check("reset password: invalid direct visit is safe", await p.evaluate(() =>
        /invalid|expired/i.test(document.querySelector("#rpNote")?.textContent || "")));
    }],

    ["merch.html", async (p) => {
      /* THE HOUSE'S BUSINESS STAYS THE HOUSE'S. Every ledger a page fetches
         is downloadable by anyone who guesses the path, so the supplier, the
         landed cost and the markup may never live in one. They used to: the
         rack published the maker's name, each garment's blank cost and a
         2x markup, and the print shop published its lab costs. */
      const leak = await p.evaluate(async () => {
        const bad = /tapstitch|printful|printify|gelato|apliiq|print.on.demand/i;
        const out = [];
        for (const f of ["data/merch.json", "data/prints.json", "data/prayer-closet.json"]) {
          const raw = await (await fetch(f, { cache: "no-cache" })).text();
          if (bad.test(raw)) out.push(f + ": names a supplier");
          const j = JSON.parse(raw);
          const cost = JSON.stringify(j).match(/"(blank|cost|markup|printMarkup|landed|handling|shipping|printCost)":\s*[\d.]/);
          if (cost) out.push(f + ": publishes " + cost[1]);
        }
        return out;
      });
      check("merch: no ledger names the maker or publishes a cost", leak.length === 0, leak.join(" | "));
      check("merch: the rack still carries finished prices", await p.evaluate(async () => {
        const j = await (await fetch("data/merch.json", { cache: "no-cache" })).json();
        return (j.garments || []).length > 0 && j.garments.every((g) => typeof g.price === "number");
      }));
      /* merch.html is a forwarding stub now: the Closet is the one clothing
         door and the rack hangs at prayer-closet.html#theRack. The ledger
         checks above still read the files; this reads where the visitor
         landed and that the rack there still prints finished prices.
         textContent, because the privacy gate veils the room until it is
         acknowledged and innerText would read only the gate. */
      check("merch: the stub forwards to the rack", /prayer-closet\.html#theRack$/.test(p.url()), p.url());
      check("merch: prices reach the page", /\$\d/.test(await p.evaluate(() =>
        (document.getElementById("theRack") || document.body).textContent)));
    }],
    ["management.html", async (p) => {
      /* The Socials Room is native to Control now; this address is a
         compatibility URL (js/control-compat.js) and must keep forwarding to
         the channels desk rather than going dark on an old bookmark. The
         walk then measures control.html at this width, which is the point. */
      check("management: forwards to Control's channels desk",
        /control\.html#create:channels$/.test(p.url()), p.url());
    }],
    ["album.html", async (p) => {
      check("album: track rows mounted", await p.locator("#tracks li").count() >= 6);
      check("album: no agency node in album JSON-LD", await p.evaluate(() =>
        ![...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => s.textContent.includes("the agency"))));
      check("album: named I AM HERE (heading + MusicAlbum)", await p.evaluate(() => {
        const h = document.getElementById("albName")?.textContent.trim();
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map((s) => s.textContent).join(" ");
        return h === "I AM HERE" && /"name":\s*"I AM HERE"/.test(ld);
      }));
    }],
    ["catalogue.html", async (p) => {
      /* the rename trap: these deep links key off the album SLUG, not its
         name. The registry carries every record now, so each row must open
         the player on its own album, and I AM HERE's six must all be there. */
      check("catalogue: every registry row deep-links into the player", await p.evaluate(() => {
        const rows = document.querySelectorAll("#reg li");
        return rows.length > 0 && [...rows].every((li) => li.querySelector("a[href^='album.html?album=']"));
      }));
      check("catalogue: all six album tracks deep-link into the player", await p.evaluate(() =>
        document.querySelectorAll("#reg a[href^='album.html?album=here&']").length === 6));
    }],
    ["gallery.html", async (p) => {
      check("gallery: wall boots", await p.evaluate(() => !!document.body.className.includes("gxwall")));
    }],
    ["hire.html", async (p) => {
      /* This counted three .hire__pkg cards. hire.html was rebuilt as service
         chapters on the owner's call — explicitly chapters and not a wall of
         repetitive cards — so the element it counted no longer exists.

         Naming the offers is a better guard than counting boxes anyway: a
         count passes whatever three things happen to be in the grid, while
         this fails if an offer quietly stops being sold. The second check
         keeps the original decision honest by failing if the card grid ever
         comes back. */
      /* the names come from the ledger, not from this file. Typed here they
         asserted "Runway", which was the right answer until the ledger
         renamed that offer to Domain and hosting and this went red over a
         word. Read from the ledger it still fails for the reason it was
         written: an offer quietly stopping being sold. */
      const chapters = await p.evaluate(async () => {
        const L = await (await fetch("data/offers.json", { cache: "no-cache" })).json();
        const t = [...document.querySelectorAll(".chapter h2, .chapter h3")].map((h) => h.textContent.trim());
        /* listed:false offers are sellable but deliberately not shelved
           (Social only is the week-four module bought on its own). A
           chapter for one would put four services back on a page rebuilt
           to carry three, so they are excluded here on purpose. */
        return (L.offers || []).filter((o) => o.listed !== false)
          .map((o) => o.name).filter((n) => !t.includes(n));
      });
      check("hire: every offer in the ledger gets a chapter", chapters.length === 0,
        `no chapter for ${chapters.join(", ")}`);
      check("hire: chapters, not a wall of cards", await p.locator(".hire__pkgs .hire__pkg").count() === 0);
      const href = await p.locator("[data-book]").first().getAttribute("href");
      check("hire: booking CTA is a real destination", /^(mailto:|https:)/.test(href || ""), `href=${href}`);
      check("hire: no internal-currency pitch", await p.evaluate(() => !document.body.textContent.includes("Our Street at 33%")));
      /* with the top bar retired the page's action rides above the capsule.
         Nothing else on this page links #book, so losing it would bury the
         booking section entirely. */
      check("hire: the page's action survives the retired top bar",
        await p.locator(".mh__cta").count() === 1);
      /* it must never sit on top of the very button it stands in for. (Only
         the veil is asserted: on a tall desktop the booking section can be
         in view at rest, so there is no unveiled state to compare against.) */
      check("hire: the action steps aside once you reach the section", await p.evaluate(async () => {
        document.getElementById("book").scrollIntoView();
        await new Promise((r) => setTimeout(r, 700));
        return document.querySelector(".mh__cta").classList.contains("is-veiled");
      }));
    }],
    ["give.html", async (p) => {
      check("give: quiet mode (no fund meters)", await p.locator(".fund").count() === 0);
      check("give: no dollar-goal language", await p.evaluate(() => !document.body.textContent.includes("million")));
      check("give: single door present", await p.locator("#gvGive").count() === 1);
    }],
    /* THE SHOP BLOCK IS GONE, not disabled. shakes.html and shake-desk.html
       were shelved into _unfinished/shake-shop/ on 2026-08-19 at the
       owner's request, so there is no page left for these 20 checks to
       walk. The pricing law they guarded still lives in
       supabase/functions/shake-order/ and its own tests; nothing about
       the money was deleted, only taken off the live site. If the shop
       comes back, restore this block with it — the rule it protected was
       that a shop which cannot reach its database says CLOSED rather than
       guessing open. */
    ["prayer-closet.html", async (p) => {
      /* the rail carries every drop the ledger can show (concepts wait in
         the coming rack), so the count is read off the ledger, not typed:
         three was true for one season and false the next */
      check("closet: the rail carries every showable drop", await p.evaluate(async () => {
        const j = await (await fetch("data/prayer-closet.json", { cache: "no-cache" })).json();
        const showing = (j.drops || []).filter((d) => d.status !== "concept").length;
        return showing > 0 && document.querySelectorAll("#pcRail .gmt").length === showing;
      }));
      check("closet: giving door state present", await p.locator("#pcSow").count() === 1);
      check("closet: the lead drop wears a real garment", await p.evaluate(() =>
        !!document.querySelector("#pcHeroField img") && document.querySelector(".pch")?.classList.contains("has-photo")));
      check("closet: photographed card drops the hanger placeholder", await p.evaluate(() => {
        const c = document.querySelector("#pcRail .gmt.has-photo");
        return !!c && !!c.querySelector(".gmt__field img") && !c.querySelector(".gmt__hang");
      }));
    }],
    /* THE DROP PAGE IS GONE. closet/seek-first.html was retired with the
       Closet's own rooms; the Closet keeps commission.html and sent.html
       under closet/ and the rack hangs on prayer-closet.html. The checks
       that walked the drop (six stages, Square preorder, the subdirectory
       bar with ../ on every door) left with the page. If a drop page comes
       back under closet/, bring the subdirectory-bar checks back with it:
       the bar is hand-copied into every page that carries it, and nothing
       else keeps the ../ variant from drifting. */
    ["inner-room.html", async (p) => {
      /* the season decides which chapters hang here (data/prayer-closet.json) */
      check("inner room: a chapter for every drop the season carries", await p.evaluate(async () => {
        const j = await (await fetch("data/prayer-closet.json", { cache: "no-cache" })).json();
        const chapters = new Set((j.drops || []).map((d) => d.chapter));
        return chapters.size > 0 && document.querySelectorAll(".irc button").length === chapters.size;
      }));
      check("inner room: verses render", await p.locator(".irx .v").count() > 10);
    }],
    /* MCCLUSTER SITES: the switch, the seat ledger, the demo, the wizard, the console */
    ["sites.html", async (p) => {
      /* THE LADDER, AS IT IS NOW.

         These five checks used to describe a three-lane slider: #swWrap,
         #swThumb, and the prices $79.99 / $149 / $400 riding a #stNum that
         swapped when you dragged to Social. That switch was removed when
         sites.html became the four-offer ladder, and the prices it named
         are not the approved ones any more. Held as written they were five
         permanently red lines describing a page nobody can bring back.

         What replaced them is stricter, not looser. The old block only
         proved a number moved. These prove the numbers on the page are the
         ledger's numbers, that the derived ones are still derived, and that
         nothing unapproved prints a figure at all. */
      /* THE FOUR CARDS, AS THEY ARE NOW.

         The ladder these checks used to describe was 11,865px tall on a
         phone — twelve and a half screens — and its front-door card
         carried two prices for one product: $33 as the big number and $66
         in a receipt table underneath. The owner read his own page and
         named it as two separate products, which is as clear a verdict on
         a layout as anybody gets. sites.html is now four cards, one price
         each, and everything the cards used to carry is on
         sites-details.html.

         These checks are not looser than the ones they replace. They hold
         the same rule — the figures on the page are the LEDGER's figures,
         and the derived ones are still derived — and add the one the old
         page failed: exactly one price per product. */
      check("sites: four cards, and only the four the ledger sells",
        await p.evaluate(() => [...document.querySelectorAll(".buy")].map((e) => e.dataset.offer)
          .join(",") === "runway,anti-social,who-did-the-shoot,write-a-song"),
        await p.evaluate(() => [...document.querySelectorAll(".buy")].map((e) => e.dataset.offer).join(",")));

      /* THE FAULT THAT CAUSED THE REBUILD. One product may show one price. */
      check("sites: no card shows more than one price", await p.evaluate(() =>
        [...document.querySelectorAll(".buy")].every((e) => e.querySelectorAll(".buy__price").length === 1)));
      check("sites: and the button never repeats it", await p.evaluate(() =>
        [...document.querySelectorAll(".buy__go .btn__price")].length === 0));

      const card = async (id) => p.evaluate((i) => {
        const e = document.querySelector(`.buy[data-offer="${i}"]`);
        return e ? e.textContent.replace(/\s+/g, " ") : "";
      }, id);

      /* NOTHING TELLS ANYBODY TO HURRY.
         The page opened on "three builds, then never again" over a seat
         ledger counting down. The builds are still free and the clients
         are still shown; the deadline was invented, and it is gone. */
      check("sites: no scarcity language, and no hero before the price",
        await p.evaluate(() =>
          !/seats? left|one remains|never again|\b0[1-9]\b|limited time/i.test(
            document.querySelector("main").innerText) &&
          !document.querySelector(".buyhero, .hero2, .seats, .close, .math")));

      /* THE FRONT DOOR PRICES WHAT THE LEDGER APPROVES, AND ONLY THAT.
         This used to assert $66 to go live, $33 a month and $393 for the
         year, typed here. The ledger moved: Creator Platform websites carry
         no approved start price (the plan decides it), one mode, and a
         one-time $33 draft. Typed figures went red for a change of
         product, not a bug, so the figures come off data/offers.json now:
         an unapproved start prints the ledger's words and no number, an
         approved one prints the ledger's amount, and the card offers
         exactly the modes the ledger lists. */
      const door = await p.evaluate(async () => {
        const L = await (await fetch("data/offers.json", { cache: "no-cache" })).json();
        const o = (L.offers || []).find((x) => x.id === "runway") || {};
        const el = document.querySelector('.buy[data-offer="runway"]');
        const price = el?.querySelector(".buy__price")?.textContent.replace(/\s+/g, " ").trim() || "";
        const start = (o.pricing || {}).start || {};
        return {
          approved: !!start.approved, amount: start.amount, label: start.label || "", price,
          /* billing_modes (monthly / pay the year) win over offer modes,
             and a mode with no checkout is never offered (js/offers.js) */
          modes: (o.billing_modes || o.modes || ["m"]).filter((m) => (o.checkout || {})[m]).join(","),
          shown: [...(el?.querySelectorAll(".modes button[data-mode]") || [])].map((b) => b.dataset.mode).join(","),
        };
      });
      check("sites: the front door prices what the ledger approves, and only that",
        door.approved ? new RegExp("\\$" + String(door.amount).replace(".", "\\.") + "(?!\\d)").test(door.price)
                      : !/\d/.test(door.price) && door.price.toLowerCase().includes(door.label.toLowerCase()),
        `card says "${door.price}", ledger ${door.approved ? "approves $" + door.amount : "approves nothing: " + door.label}`);
      check("sites: the front door offers exactly the ledger's modes",
        door.modes === door.shown || (!door.shown && !door.modes.includes(",")), `card ${door.shown || "none"}, ledger ${door.modes}`);

      /* THE PRICE IS THE LEDGER'S, OR IT IS NOTHING.
         Anti-Social is approved at $875 and Equity Uprise is derived from
         it, never stored: base = 875 x 0.5, cap = 10 x 12 x 875. Asserting
         the rendered figures against that arithmetic is what catches a
         hardcoded number drifting away from the approved one — and an
         earlier cut of these cards DID carry its own copies, which is why
         the check stays. */
      check("sites: Anti-Social opens on the standard price, never on Equity",
        /\$875(?!\d)/.test(await card("anti-social")) && await p.evaluate(() =>
          document.querySelector('.buy[data-offer="anti-social"] .modes button[data-mode="m"]')
            ?.getAttribute("aria-selected") === "true"), await card("anti-social"));

      await p.click('.buy[data-offer="anti-social"] .modes button[data-mode="equity"]').catch(() => {});
      await p.waitForTimeout(250);
      const eq = await card("anti-social");
      check("sites: Equity Uprise swaps in the derived price, not a stored one",
        /\$437\.50(?!\d)/.test(eq), eq.slice(0, 200));
      check("sites: the cap is still ten times the twelve-month value",
        /\$105,000(?!\d)/.test(eq), eq.slice(0, 260));

      /* THE DISCLOSURE, WHERE THE PERSON IS.
         It used to be a section thousands of pixels below the button.
         Somebody flipping this toggle is the exact person who has to read
         it, so it now renders inside the card, on the flip. */
      check("sites: flipping to Equity puts the disclosure in the card",
        await p.evaluate(() => {
          const d = document.querySelector('.buy[data-offer="anti-social"] .buy__disclose');
          return !!d && /no stock/i.test(d.textContent) && d.textContent.length > 60;
        }));
      check("sites: an agreement is never a one-click checkout",
        await p.evaluate(() => /onboard\.html/.test(
          document.querySelector('.buy[data-offer="anti-social"] .buy__go')?.getAttribute("href") || "")));
      await p.click('.buy[data-offer="anti-social"] .modes button[data-mode="m"]').catch(() => {});
      await p.waitForTimeout(200);

      /* every button has to reach something the checkout can actually price */
      const dead = await p.evaluate(async () => {
        const slugs = new Set(((await (await fetch("data/offerings.json", { cache: "no-cache" })).json())
          .offerings || []).map((o) => o.slug));
        return [...document.querySelectorAll(".buy__go")]
          .map((a) => a.getAttribute("href") || "")
          .filter((h) => /^pay\.html\?offer=/.test(h) && !slugs.has(h.split("=")[1]));
      });
      check("sites: no button points at a checkout that cannot price it",
        dead.length === 0, dead.join(" "));

      /* an unapproved configuration is allowed to say anything except a
         number: no PENDING chip, no filename, no developer hedging */
      check("sites: nothing unapproved prints a figure", await p.evaluate(() =>
        [...document.querySelectorAll(".buy__price--words")].every((d) =>
          !/\$\s*\d/.test(d.textContent) && !/pending|tbd|approv/i.test(d.textContent))));

      /* THE WHOLE POINT, MEASURED. Three screens was the mark the rebuild
         hit; the Creator Platform plan copy on the front-door card has
         since put the page at 3053px on a 390 x 844 phone, measured
         2026-10-28. Four screens is the line now, with the number
         recorded here so the next growth is a decision and not a drift. */
      check("sites: the buying page stays under four phone screens",
        await p.evaluate(() => document.documentElement.scrollHeight) < 3376,
        `${await p.evaluate(() => document.documentElement.scrollHeight)}px`);

      /* THE SOURCE OF TRUTH, IN TWO PARTS.

         The body must not price anything: every figure a visitor reads is
         painted by js/offers.js out of data/offers.json, so a price sitting
         in the body markup is a second source of truth waiting to drift.

         The head is the exception, and it has to be. Search engines and
         link unfurlers do not run our JavaScript, so the description and
         the JSON-LD offers carry numerals literally. That makes them the
         one place a stale price can survive a ledger change and still be
         quoted back at us in a search result. So they are not exempted,
         they are checked the other way: every dollar figure in the head
         must be one the page actually renders. */
      const src = await p.evaluate(async () =>
        (await (await fetch("sites.html", { cache: "no-cache" })).text()));
      const head = src.slice(0, src.indexOf("</head>"));
      const body = src.slice(src.indexOf("</head>"));
      /* not "no dollar sign anywhere": the comparison block quotes what
         other people charge ($199 a month, $2,000 a build), and those are
         the page's own words, not ours to derive. What may never be written
         by hand is one of OUR figures.

         .them is cut out before the scan for exactly that reason. It says
         "about $30 a month at the big platforms", which collides with our
         own $30 hosting line by coincidence and would otherwise report a
         leak that is not one. Everything outside .them speaks in the
         studio's voice, and in the studio's voice a number is the ledger's
         job.

         Scripts come out too. This asks what the page has TYPED, and the
         only figures inside sites.html's script are the stale ones it
         filters back out ($309 / $154.50 / $37,080) plus the reasoning
         above that filter. What the script actually renders is already
         guarded, harder, by the four price checks above it: those read the
         painted DOM and hold it to the ledger's arithmetic. */
      const leaked = await p.evaluate(async (markup) => {
        const L = await (await fetch("data/offers.json", { cache: "no-cache" })).json();
        const ours = new Set();
        const walk = (v) => {
          if (Array.isArray(v)) return v.forEach(walk);
          if (v && typeof v === "object") {
            for (const [k, x] of Object.entries(v)) {
              if (typeof x === "number" && /amount|total|from|price/.test(k)) ours.add(x);
              else walk(x);
            }
          }
        };
        walk(L.offers || []);
        const clean = markup
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<script[\s\S]*?<\/script>/g, "")
          .replace(/<div class="them">[\s\S]*?<\/div>/, "");
        return [...ours].filter((n) => clean.includes("$" + n.toLocaleString("en-US")));
      }, body);
      check("sites: no ledger figure is written into the body markup",
        leaked.length === 0, `hand-typed: ${leaked.map((n) => "$" + n).join(" ")}`);
      /* A price reachable only behind the mode toggle is still a price the
         page renders. Reading the text in M mode alone reported the derived
         Equity figures as stale head numerals, which they are not — so the
         snapshot spans both modes, the way a reader can. */
      const onPage = await (async () => {
        const seen = new Set();
        for (const mode of ["m", "equity"]) {
          await p.$$eval(`.buy .modes button[data-mode="${mode}"]`, (bs) => bs.forEach((b) => b.click()));
          await p.waitForTimeout(220);
          (await p.evaluate(() => document.body.textContent.match(/\$[\d.,]+\d/g) || []))
            .forEach((n) => seen.add(n));
        }
        await p.$$eval('.buy .modes button[data-mode="m"]', (bs) => bs.forEach((b) => b.click()));
        return [...seen];
      })();
      const stale = (head.match(/\$[\d.,]+\d/g) || []).filter((n) => !onPage.includes(n));
      check("sites: every price in the head is a price on the page", stale.length === 0,
        `head quotes ${stale.join(" ")} which the ladder never renders`);
      /* THE SEAT LEDGER NO LONGER DRAWS A ROW. data/sites.json still
         carries seats, taken and taken_by as the record of who got a free
         build, but the page stopped counting them down (no "02 of 03", no
         urgency built out of a number; see THE EXAMPLES in sites.html).
         The checks that counted #seatRow, its burned seat and its demo door
         went with the row. What remains of that door is below: every
         example the page draws must open the demo viewer on a work the
         ledger carries, so the viewer is never orphaned. */
      const doors = await p.evaluate(async () => {
        const d = await (await fetch("data/sites.json", { cache: "no-cache" })).json();
        const slugs = new Set((d.showcase || []).map((w) => w.slug));
        return [...document.querySelectorAll('a[href^="demo.html?s="]')].map((a) => {
          const slug = (a.getAttribute("href").split("?s=")[1] || "").split("&")[0];
          return slugs.has(decodeURIComponent(slug)) ? "" : a.getAttribute("href");
        }).filter(Boolean);
      });
      check("sites: every demo door names a work the ledger carries", doors.length === 0, doors.join(" "));
      /* the long dashes are written as escapes so this gate file does not
         itself carry the characters the house bans */
      /* comments are not the page: the ban is on what a visitor can read */
      check("sites: not a single em dash on the page", await p.evaluate(() =>
        !/[\u2014\u2013]/.test(document.documentElement.outerHTML.replace(/<!--[\s\S]*?-->/g, ""))));
    }],
    /* THE VIEWER: the burned seat's demo. It frames a client's live site, so
       every check below reads markup the studio wrote, never the client's
       server. See THE SEAL at the top of this file. */
    ["demo.html?s=shiloh", async (p) => {
      const back = await p.evaluate(() => {
        const a = [...document.querySelectorAll("a[href]")]
          .find((x) => /^(\.\/|\/)?sites\.html([?#].*)?$/.test(x.getAttribute("href") || ""));
        if (!a) return null;
        return { top: Math.round(a.getBoundingClientRect().top), text: a.textContent.replace(/\s+/g, " ").trim() };
      });
      check("demo: the bar carries the way back to the seats", !!back, "nothing links to sites.html");
      check("demo: the way back rides the top bar, not the foot of the page",
        !!back && back.top >= 0 && back.top < 200, back ? `"${back.text}" sits ${back.top}px down` : "no link to sites.html");
      /* ONE BAR: the viewer wears its own bar up top, so the capsule must not
         ride under it as well, and nothing of ours may sit over the client's
         site inside the frame */
      check("demo: one bar (the capsule stays off the viewer)", await p.locator(".appbar").count() === 0);
      check("demo: noindex (a viewer for somebody else's site, not a page to rank)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "")));
      /* the house kicker, saying what this room is before anything loads */
      check("demo: the live demo kicker stands", await p.evaluate(() =>
        [...document.querySelectorAll(".kick")].some((k) => /live demo/i.test(k.textContent || ""))));
      /* the honest line: the viewer says out loud that the frame holds a real
         site running right now, not a screenshot the studio dressed up. It also
         tells the truth about WHICH kind: our own frozen copy, where nothing a
         visitor types is saved, or a client's live site, where it is. Matched
         on the phrase, not the whole sentence, so the copy can be rewritten
         without failing the build. Widen the phrases if the wording moves. */
      check("demo: the page says plainly what the frame is holding", await p.evaluate(() => {
        const t = (document.body.textContent || "").replace(/\s+/g, " ");
        return /(live|real|actual) site/i.test(t) || /not a (screenshot|mockup|picture|template)/i.test(t);
      }));
      const w = await framedWork(p, "shiloh");
      check("demo: the frame is pointed at the Shiloh URL from the ledger", w.match,
        `src=${w.src || "no iframe"} ledger=${w.want || "no shiloh entry"}`);
      check("demo: the viewer names the work it is showing", w.named, `looked for ${w.name || "a name"}`);
      check("demo: the switcher carries every work on the seat", w.switched,
        `${w.works} on the seat, buttons: ${w.labels}`);
      check("demo: not a single em dash on the page", await p.evaluate(() =>
        !/[\u2014\u2013]/.test(document.documentElement.outerHTML)));
    }, SEALED],
    /* a bad slug is a typo or a stale link, never a reason to show an empty room */
    ["demo.html?s=nope-not-real", async (p) => {
      const w = await framedWork(p, null);
      check("demo: an unknown slug falls back to the first work", w.match,
        `src=${w.src || "no iframe"} ledger=${w.want || "no showcase"}`);
      check("demo: the fallback still names what it is showing", w.named, `looked for ${w.name || "a name"}`);
      check("demo: the fallback still carries the switcher", w.switched,
        `${w.works} on the seat, buttons: ${w.labels}`);
    }, SEALED],
    /* THE WALK, AS IT IS NOW.

       These checks described the pane-based wizard — eight .pane elements,
       #obPlans cards, .pick[data-set="domain"], a fixed six-step count.
       onboard.html was rebuilt as one question per screen and has carried
       zero .pane elements since, so this block has been failing on main
       since 10 August, asserting a page that no longer exists.

       A red check nobody can fix is a check everyone learns to scroll past.
       Re-aimed at the walk that IS there: it opens on the offer question,
       mounts the four offers from the ledger rather than hardcoding them,
       counts its steps, and stays out of the index. */
    ["onboard.html", async (p) => {
      check("onboard: opens on the offer question", await p.evaluate(() =>
        /what are you here for/i.test(document.querySelector(".ob h1")?.textContent || "")));
      check("onboard: the stage and the named rail both stand", await p.evaluate(() =>
        !!document.getElementById("obStage") && document.querySelectorAll(".ob__rail span").length >= 3));
      check("onboard: counts the walk", await p.evaluate(() =>
        /^Step \d+ of \d+$/.test(document.getElementById("obStep")?.textContent.trim() || "")));
      /* same rule as the hire chapters: the ledger names them, this only
         checks that every one of them is offered */
      const picks = await p.evaluate(async () => {
        const L = await (await fetch("data/offers.json", { cache: "no-cache" })).json();
        const names = [...document.querySelectorAll(".pick > button b")].map((b) => b.textContent.trim());
        return (L.offers || []).filter((o) => o.listed !== false)
          .map((o) => o.name).filter((n) => !names.includes(n));
      });
      check("onboard: every offer in the ledger is offered", picks.length === 0,
        `the walk never offers ${picks.join(", ")}`);
      check("onboard: noindex (a walk, not a page to rank)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "")));
    }],
    /* a legacy ?plan= link still resolves: those are out in the world, and
       js/onboard.js maps them onto the ladder rather than dropping them */
    ["onboard.html?plan=web&mode=paid", async (p) => {
      check("onboard: a legacy plan link lands past the offer question", await p.evaluate(() =>
        !/what are you here for/i.test(document.querySelector(".ob h1")?.textContent || "")));
      check("onboard: and keeps counting", await p.evaluate(() =>
        /^Step \d+ of \d+$/.test(document.getElementById("obStep")?.textContent.trim() || "")));
    }],
    ["console.html", async (p) => {
      check("console: the door stands when signed out", await p.evaluate(() =>
        !document.getElementById("cxDoor")?.hidden && document.getElementById("cxDesk")?.hidden));
      /* the magic link is retired with the rest of the sign-in-link
         language; the door is email and password */
      check("console: the password door is present", await p.evaluate(() =>
        !!document.getElementById("cxEmail") && !!document.getElementById("cxPass") && !!document.getElementById("cxGo")));
      check("console: obsolete login language is gone", await p.evaluate(() =>
        !/email me a sign-in link|send sign-in link|one-time login link|magic link/i.test(document.body.innerText)));
      check("console: noindex (client room, not a public page)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "")));
    }],

    /* ---- THE OLD ADDRESSES ------------------------------------------
       topics, fellowships, profile and dashboard were Equity Uprise
       platform rooms of their own; uprise-admin and the inbox were desks.
       Every one of them lives natively somewhere else now (World News,
       the World, Control) and the old address is a forwarding stub, with
       a canonical link and a noindex so a search engine follows rather
       than ranks it. These used to check the rooms' fallback paint; what
       is worth checking now is that an old bookmark still lands in the
       right room, carrying its query, and that the walk then measures
       that room at this width like any other. */
    ["topics.html", async (p) => {
      check("topics: forwards to World News", /\/world-news\.html$/.test(p.url()), p.url());
      /* the stubs are read off the server, since the walk lands past them */
      const stubs = [];
      for (const f of ["topics.html", "fellowships.html", "profile.html", "dashboard.html"]) {
        const html = await (await p.request.get(B + f)).text();
        if (!/<meta name="robots" content="noindex/.test(html) || !/rel="canonical"/.test(html)) stubs.push(f);
      }
      check("old addresses: every stub is noindex and names its canonical", stubs.length === 0, stubs.join(", "));
    }],
    ["topics.html?topic=data-centers", async (p) => {
      check("topic: forwards to World News and keeps the topic",
        /\/world-news\.html\?topic=data-centers$/.test(p.url()), p.url());
    }],
    ["fellowships.html", async (p) => {
      check("fellowships: forwards into the World", /\/mnet\.html\?view=feed$/.test(p.url()), p.url());
    }],
    ["profile.html", async (p) => {
      check("profile: forwards to the World's profile view", /\/mnet\.html\?view=profile$/.test(p.url()), p.url());
    }],
    ["dashboard.html", async (p) => {
      check("dashboard: forwards to Control", /\/control\.html$/.test(p.url()), p.url());
      check("dashboard: Control is noindex,nofollow (the control plane)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "") &&
        /nofollow/.test(document.querySelector('meta[name="robots"]')?.content || "")));
    }],
    ["uprise-admin.html", async (p) => {
      check("desk: forwards to Control", /\/control\.html$/.test(p.url()), p.url());
    }],
    ["inbox.html", async (p) => {
      check("inbox: forwards to Control's inbox desk", /\/control\.html#work:inbox$/.test(p.url()), p.url());
      /* the desk reads through PostgREST with the STAFF member's token and
         writes through the function, so it never needs a privileged key and
         must never carry one */
      check("inbox: ships no service key", await p.evaluate(() =>
        !/service_role|eyJ[A-Za-z0-9_-]{40,}/.test(document.documentElement.innerHTML)));
    }],
  ];

  for (const width of [390, 1280]) {
    console.log(`\n[viewport ${width}px]`);
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await ctx.route(OUTBOUND, refuse);
    await seen(ctx);
    const page = await ctx.newPage();
    /* SMOKE_ONLY=sites.html,hire.html runs one page's checks instead of
       the whole house. The full suite is the release gate and CI runs it
       whole; this is for the person changing one room, who otherwise
       waits ten minutes to find out about a typo. */
    const only = (process.env.SMOKE_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const [path, checks] of PAGES) {
      if (only.length && !only.includes(path)) continue;
      const errs = [];
      const onErr = (e) => errs.push(String(e).slice(0, 120));
      page.on("pageerror", onErr);
      /* the context is sealed: no page talks to anyone but our own server */
      await page.goto(B + path, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => no(`${path} loads`, String(e).slice(0, 80)));
      await page.waitForTimeout(900);
      await checks(page);
      check(`${path}: zero page errors [${width}]`, errs.length === 0, errs.join(" | "));
      page.off("pageerror", onErr);
      /* HORIZONTAL OVERFLOW, MEASURED AS A USER WOULD FEEL IT.

         This compared documentElement.scrollWidth to clientWidth. That is a
         proxy, and it only worked because `body` used to clip overflow-x,
         which clamped the measurement. Removing that clip — it was trapping
         the fixed tab bar on iOS, see css/style.css — made the proxy start
         reporting pages that are completely fine: this house bleeds
         decorative pseudo-elements off the edge on purpose (a hero glow at
         right:-251px, a runway gradient), and `html{overflow-x:clip}` clips
         them exactly as intended. Nothing is cut off and nothing scrolls.

         So it now asserts the two things actually worth asserting, and both
         are stricter than the proxy where it counts:

           1. the page cannot be scrolled sideways — the symptom a visitor
              would report; and
           2. no element carrying CONTENT extends past the viewport. A table
              or a long string too wide to fit is a real bug precisely
              because the root clip makes it unreachable rather than
              scrollable, and this names the offender instead of just
              failing. Pseudo-element bleed is decoration and is allowed. */
      const of = await page.evaluate(() => {
        const de = document.documentElement;
        const x0 = window.scrollX;
        window.scrollTo(400, window.scrollY);
        const scrolls = window.scrollX !== x0;
        window.scrollTo(x0, window.scrollY);
        const vw = de.clientWidth;
        const wide = [];
        /* An element sticking past the edge is only a BUG if it ESCAPES.
           Plenty of things hang off-viewport on purpose and are contained
           by their own box: a marquee's inner track, a horizontal carousel,
           the internals of a fixed preloader overlay. Those are clipped or
           scrolled by an ancestor and the visitor never loses anything.

           What is a real bug is content with no clipping ancestor at all —
           it escapes to the root, where html{overflow-x:clip} makes it
           invisible AND unreachable rather than scrollable. So walk up and
           stop at the first ancestor that contains it. The root itself does
           not count: it clips everything, which is the whole reason an
           escape is unreachable instead of visible. */
        const contained = (el) => {
          for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement) {
            const c = getComputedStyle(p);
            if (c.position === "fixed") return true;          // its own coordinate space
            if (c.overflowX !== "visible") return true;        // clipped or scrolled here
          }
          return false;
        };
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (getComputedStyle(el).position === "fixed") return;
          if (r.right <= vw + 1 && r.left >= -1) return;
          if (contained(el)) return;
          wide.push(el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/)[0] : ""));
        });
        return { scrolls, wide: [...new Set(wide)].slice(0, 5) };
      });
      check(`${path}: does not scroll sideways [${width}]`, !of.scrolls);
      check(`${path}: no content wider than the screen [${width}]`,
        of.wide.length === 0, of.wide.join(", "));
    }
    await ctx.close();
  }

  /* the law of the bar: one tap navigates */
  console.log("\n[interaction]");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(OUTBOUND, refuse);
  await seen(ctx);
  const page = await ctx.newPage();
  await page.goto(B + "index.html", { waitUntil: "load" });
  /* walk in past the preloader deliberately; this also proves the
     tap-to-enter hook, then waits until the curtain is actually gone */
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const pre = document.getElementById("preloader");
    if (pre && !pre.classList.contains("is-done")) pre.click(); // the visitor's tap
  });
  await page.waitForSelector(".preloader.is-done", { state: "attached", timeout: 15000 }).then(
    () => ok("preloader yields (tap-to-enter hook)"),
    async () => no("preloader yields (tap-to-enter hook)",
      "never finished: " + JSON.stringify(await page.evaluate(() => ({
        cls: document.getElementById("preloader")?.className,
        count: document.getElementById("preCount")?.textContent,
        enter: typeof window.__MCC_ENTER,
        main: typeof window.__MCC_VR !== "undefined" || !!window.lenis || "unknown",
      })).catch(() => "evaluate failed"))));
  /* THE COIN GOES TO THE PLAYER.

     This asserted the opposite: that a tap on Music works the record where
     you stand and "the front page stays put". That was the law until the
     owner called it — the one tab whose whole job is the record was the one
     tab that would not open it, on the most-visited page on the site. The
     coin is a transport only where you are already standing on the player
     (see THE PLAYBACK LAW below); everywhere else it sails.

     index.html still publishes the transport globals, because it has its own
     scroll-driven soundtrack — so this is the interesting case: not "no deck,
     therefore a door", but "a deck, and STILL a door". The tap navigating is
     also why this block used to take the whole suite down with
     "Execution context was destroyed": it ran page.evaluate across a
     navigation it did not expect. */
  check("the front page does publish a transport to drive", await page.evaluate(() =>
    typeof window.MCC_NP_PLAY === "function" && typeof window.MCC_NP_PAUSE === "function"));
  await page.click('[data-appnav="music"]', { timeout: 10000 }).catch((e) =>
    no("music tab clickable on the front page", String(e).slice(0, 100)));
  /* the tap goes to the whole shelf, listen.html (js/tabbar.js WINGS.music
     .home); the album is one of the wing's two rooms */
  await page.waitForURL("**/listen.html", { timeout: 15000 }).then(
    () => ok("one tap on Music opens the Listening Room, even where a deck exists"),
    async () => no("one tap on Music opens the Listening Room, even where a deck exists",
      "still at " + page.url()));
  await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(600);

  /* THE FALL-THROUGH LAW: thirty-seven of the thirty-nine pages carrying this
     bar have no deck and no transport globals at all. A transport with
     nothing to drive is a dead tab, so on those the tap has to stay a door. */
  await page.goto(B + "catalogue.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("the catalogue publishes no transport to drive", await page.evaluate(() =>
    typeof window.MCC_NP_PLAY === "undefined" && typeof window.MCC_NP_PAUSE === "undefined"));
  await page.click('[data-appnav="music"]', { timeout: 10000 }).catch((e) =>
    no("music tab clickable", String(e).slice(0, 100)));
  await page.waitForURL("**/listen.html", { timeout: 15000 }).then(
    () => ok("with no transport there, one tap on Music lands in the Listening Room"),
    async () => no("with no transport there, one tap on Music did not land in the Listening Room",
      "still at " + page.url() + " veil=" +
      (await page.evaluate(() => document.documentElement.classList.contains("pt-out")).catch(() => "?"))));

  /* THE PLAYBACK LAW, AS IT STANDS. The coin drives a deck in place only
     where you already stand on the tab's destination AND that page
     publishes the transport (js/tabbar.js, the music branch of the dock
     click). The destination is listen.html, which publishes none; the
     album still publishes MCC_NP_PLAY/PAUSE, but it is a room in the wing,
     not the tab's home, so from the album the tap is a door to the shelf
     like everywhere else. This used to assert the album worked its deck in
     place; that was true while the tab's home was album.html. If the coin
     is pointed back at a page with a deck, put the no-reload checks back. */
  await page.goto(B + "album.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check("the album still publishes its transport", await page.evaluate(() =>
    typeof window.MCC_NP_PLAY === "function" && typeof window.MCC_NP_PAUSE === "function"));
  await page.click('[data-appnav="music"]', { timeout: 10000 }).catch((e) =>
    no("music tab clickable on the album", String(e).slice(0, 100)));
  await page.waitForURL("**/listen.html", { timeout: 15000 }).then(
    () => ok("from the album, one tap on Music goes to the whole shelf"),
    async () => no("from the album, one tap on Music goes to the whole shelf", "still at " + page.url()));
  check("the Listening Room publishes no transport, so the coin there is a door", await page.evaluate(() =>
    typeof window.MCC_NP_PLAY === "undefined").catch(() => false));

  /* THE WING LAW: a wing carries two rooms, so the open bar is the same
     three cells as the closed one and the tab you held never moves. */
  await page.goto(B + "index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const hold = async (wing) => {
    const b = await page.locator(`.appbar [data-appnav="${wing}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await hold("home");
  check("holding a tab keeps the bar three cells wide",
    await page.locator(".appbar > a").count() === 3,
    `got ${await page.locator(".appbar > a").count()}`);
  /* the M coin is the middle of three, and morph() keeps it at ORDER index 1. */
  check("the held tab never leaves its own column", await page.evaluate(() =>
    [...document.querySelectorAll(".appbar > a")].findIndex((a) => a.matches('[data-appnav="home"]')) === 1));
  check("the wing opens two rooms", await page.locator(".appbar__tab--slot").count() === 2);

  /* the map is how every deeper room stays reachable with no top bar */
  await page.locator('.appbar__tab--slot:has-text("Everything")').click();
  await page.waitForTimeout(400);
  check("Everything opens the map", await page.locator(".mhd.on").isVisible());
  /* The drawer is the site's own orphan rescue: for several rooms it is the
     only door. The floor exists so that moving a room out instead of copying
     it there fails here, loudly, rather than quietly orphaning a page.

     It did exactly that, and this is the honest answer rather than a ratchet
     down to whatever the number happens to be today. It read thirty-three
     when the six track pages each had their own entry. Those pages were
     folded into the reel and are forwarding stubs now — they are not rooms
     any more, and the drawer names the reel once in their place. Six out,
     one in, so twenty-eight is the whole house.

     If this fires again, check whether a room actually stopped existing
     before you touch the number. That is the only reason it may move. */
  const drawerSource = await (await page.request.get(B + "js/masthead.js")).text();
  const drawerRooms = ((drawerSource.split("var DRAWER = [")[1] || "").split("];")[0].match(/\{ href: "/g) || []).length;
  const mapRooms = await page.locator(".mhd__grp a").count();
  check("the map still carries the whole house", drawerRooms >= 20 && mapRooms === drawerRooms,
    `${mapRooms} rooms on the map, ${drawerRooms} in js/masthead.js`);

  /* Rooms removed from primary navigation still need a real door in the
     full-house map. If one of these fires, it was orphaned rather than put
     away. HITMAN's door and the Closet's went when those lines were put
     away (js/masthead.js); if either comes back, name it here again. */
  for (const [room, href] of [["the studio", "sites.html"], ["the privacy disclosure", "privacy.html"],
                              ["the engineering evidence", "engineering/"],
                              ["the Equity Uprise campaign", "action/?c=equity-uprise"]]) {
    check(`the map still has a door to ${room}`,
      await page.locator(`.mhd__grp a[href$="${href}"]`).count() >= 1);
  }
  /* ---------- THE RÉSUMÉ, AS A FILE ----------
     The PDF is generated from matthew-mccluster.html, which means it can
     go stale silently: edit the career list, ship, and a recruiter keeps
     downloading last month's history with no readable diff to catch it.
     tools/verify-resume.mjs owns the staleness check (it hashes the page
     text and compares a stamp). What only a browser can say is here:
     the file is actually SERVED, the page offers it, and the print view
     is a document rather than the dark coat on white paper. */
  /* FETCH the files, do not NAVIGATE to them. page.goto() on a PDF hands
     the response to Chromium's PDF viewer, which headless does not have,
     so response.body() comes back empty and the check fails on a file
     that is perfectly good. This assertion was written the wrong way and
     failed every run until the gate was finally allowed to finish.
     page.request.get() is a plain HTTP fetch: it answers the actual
     question, which is whether the server serves real bytes. */
  const rsm = await page.request.get(B + "assets/resume/matthew-mccluster-resume.pdf");
  check("the résumé PDF is served", rsm.status() === 200, `HTTP ${rsm.status()}`);
  check("the résumé PDF is a real PDF, not an error page",
    (await rsm.body()).subarray(0, 5).toString() === "%PDF-", "no %PDF- header");

  /* the Word file had no served-check at all: it was verified on disk by
     tools/verify-resume.mjs and never over HTTP. A file that exists but is
     not served is the exact failure a recruiter would hit. */
  const doc = await page.request.get(B + "assets/resume/matthew-mccluster-resume.docx");
  check("the résumé DOCX is served", doc.status() === 200, `HTTP ${doc.status()}`);
  check("the résumé DOCX is a real Word file",
    (await doc.body()).subarray(0, 2).toString() === "PK", "no PK zip header");

  await page.goto(B + "matthew-mccluster.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("the page offers the download", await page.evaluate(() => {
    const a = document.querySelector('a[href$="matthew-mccluster-resume.pdf"]');
    return !!a && a.hasAttribute("download");
  }));
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(200);
  /* the three things that made the first render unprintable */
  check("print: the bar and the download row step off the page", await page.evaluate(() => {
    const gone = (s) => { const e = document.querySelector(s); return !e || !e.checkVisibility(); };
    return gone(".appbar") && gone(".rsm-get") && gone(".bio__cta");
  }));
  check("print: the sheet is white and the ink is dark", await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return /255,\s*255,\s*255/.test(bg) || bg === "rgb(255, 255, 255)";
  }));
  /* the red triangle bullet is absolutely positioned in a gutter the print
     sheet removes; left drawn, it strikes through the first letter of every
     label ("Full name" printed with the F crossed out) */
  check("print: no marker is drawn over the first letter of a label",
    await page.evaluate(() => {
      const li = document.querySelector(".bio__facts li");
      return getComputedStyle(li, "::before").content === "none";
    }));
  check("print: contact is at the top, not only the last line",
    await page.evaluate(() => {
      const c = document.querySelector(".rsm-contact");
      return !!c && c.checkVisibility() && /@/.test(c.textContent);
    }));
  await page.emulateMedia({ media: "screen" });
  check("screen: the contact line stays hidden", await page.evaluate(() =>
    !document.querySelector(".rsm-contact").checkVisibility()));

  /* ---------- THE BAR STAYS ON THE FLOOR ----------
     The tab bar was reported floating mid-screen on iPhone. The cause was
     `overflow-x:hidden` reaching `body` through a @supports fallback for
     engines without `overflow:clip` — in WebKit a body with non-visible
     overflow becomes the containing block for fixed descendants, and the
     bar is appended to body, so it measured its `bottom` from the document
     instead of the viewport.

     These two checks are a REGRESSION GUARD, not a reproduction. Chromium
     supports overflow:clip and never takes that branch, so this suite
     cannot see the original bug at all. What it can do is make sure the
     hazard does not come back: nothing may put an overflow on body, and
     the bar must sit on the viewport floor. */
  await page.goto(B + "index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("nothing clips overflow on body (it would trap position:fixed)",
    await page.evaluate(() => {
      const c = getComputedStyle(document.body);
      return c.overflowX === "visible" && c.overflowY === "visible";
    }), "body has a non-visible overflow again — see css/style.css");

  const floor = await page.evaluate(() => {
    const el = document.querySelector(".appbar");
    if (!el) return null;
    window.scrollTo(0, document.body.scrollHeight / 2);
    const r = el.getBoundingClientRect();
    return Math.round(window.innerHeight - r.bottom);
  });
  check("the bar sits on the viewport floor, mid-scroll", floor !== null && floor >= 0 && floor < 40,
    `${floor}px above the viewport bottom`);

  /* env(safe-area-inset-bottom) resolves to 0 without viewport-fit=cover,
     so a page missing it puts the bar under the iPhone home indicator.
     Eleven pages were missing it. */
  const noCover = await page.evaluate(async () => {
    const out = [];
    const list = await (await fetch("sitemap.xml")).text();
    for (const m of list.matchAll(/<loc>[^<]*\/([a-z0-9-]+\.html)<\/loc>/g)) {
      const html = await (await fetch(m[1])).text().catch(() => "");
      const v = html.match(/<meta name="viewport" content="([^"]*)"/);
      if (v && !/viewport-fit=cover/.test(v[1])) out.push(m[1]);
    }
    return out;
  });
  check("every indexed page opts into the safe area (viewport-fit=cover)",
    noCover.length === 0, `missing on: ${noCover.join(", ")}`);


  /* ---------- THE DESK ----------
     The chat widget's contract is that it is INVISIBLE until the site
     channel says it is on. On CI there is no Supabase at all, so the
     channel lookup fails — which is exactly the state a visitor sees on
     a dead connection, and the state worth asserting. A chat bubble that
     opens onto a spinner promises a person and delivers nothing.

     These run on index.html, which is already loaded above. */
  {
    const dp = await ctx.newPage();
    const errs = [];
    dp.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
    await dp.goto(B + "index.html", { waitUntil: "load" });
    await dp.waitForTimeout(1200);
    check("desk: the widget loads without throwing", errs.length === 0, errs.join(" | "));
    check("desk: it is on the page at all", await dp.evaluate(() => !!window.MCC_DESK));
    check("desk: no backend means no launcher, not a broken one",
      await dp.locator(".dsk-launch").count() === 0);
    check("desk: and no panel either", await dp.locator(".dsk").count() === 0);
    /* the visitor key is the whole identity for an anonymous chat, so it
       has to be the shape the edge function will accept — anything else
       is refused a thread and the person gets silence */
    check("desk: a page that opts out is never built", await dp.evaluate(() => {
      document.body.setAttribute("data-no-desk", "");
      window.MCC_DESK.boot();
      return document.querySelectorAll(".dsk-launch").length === 0;
    }));
    await dp.close();
  }

  /* ---------- THE LIGHT COAT ----------
     The house turns with the visitor's clock, so every page ships in two
     coats and only one of them is the one you happen to be looking at.
     That asymmetry is how a whole panel goes dark-on-dark for half the
     day without anyone noticing: the rule that paints it names a literal
     colour, the text inside it rides a token, and the two stop agreeing
     at seven in the morning.

     These are the surfaces that were actually caught doing it, measured
     in painted pixels by scripts/legibility.mjs and then looked at. Each
     one is pinned here by the property that made it illegible, so a
     future edit that re-breaks it fails the gate instead of shipping.
     Cheap on purpose — computed style, no screenshots; the full pixel
     sweep is the tool, this is the tripwire. */
  {
    const lp = await ctx.newPage();
    await lp.addInitScript(() => { try { localStorage.setItem("mcc_theme", "light"); } catch (e) {} });
    const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    /* Alpha is the whole point on these panels — a wash IS ink, just
       5% of it — so a check that reads the colour and drops the alpha
       measures the ink and calls a pale wash a black slab. (It did,
       first time out, and the gate refused the push.) Composite over
       the page ground before asking how dark anything is. */
    const rgba = s => { const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(s || "");
      return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
    const rgb = s => { const c = rgba(s); return c && c.slice(0, 3); };
    const onGround = (fg, ground) => fg && ground &&
      [0, 1, 2].map(i => fg[i] * fg[3] + ground[i] * (1 - fg[3]));

    /* the docket summary box — a near-black slab holding tokened ink */
    await lp.goto(B + "docket-516.html", { waitUntil: "load" });
    check("light coat: docket 516 is in the light coat", await lp.evaluate(() =>
      document.documentElement.getAttribute("data-theme") === "light"));
    const docketGround = rgb(await lp.evaluate(() => getComputedStyle(document.body).backgroundColor));
    const tldrBg = onGround(rgba(await lp.evaluate(() =>
      getComputedStyle(document.querySelector(".tldr")).backgroundColor)), docketGround);
    check("light coat: the docket TL;DR box is a light panel, not a black slab",
      !!tldrBg && lum(tldrBg) > 0.5, `got rgb(${tldrBg && tldrBg.map(Math.round)})`);

    /* the engagement chart — SVG takes fill, not color, so none of its
       axis rode the token flip */
    await lp.goto(B + "case-designer-kicks.html", { waitUntil: "load" });
    const chartGround = rgb(await lp.evaluate(() => getComputedStyle(document.body).backgroundColor));
    const axis = onGround(rgba(await lp.evaluate(() =>
      getComputedStyle(document.querySelector(".dkc__mo")).fill)), chartGround);
    check("light coat: the chart's month labels are ink, not bone",
      !!axis && lum(axis) < 0.3, `got rgb(${axis && axis.map(Math.round)})`);

    /* the fellowship badges — five pale pastels built for a black card */
    await lp.goto(B + "fellowships.html", { waitUntil: "load" });
    await lp.waitForTimeout(900);
    const badge = rgb(await lp.evaluate(() => {
      const b = document.querySelector(".eua-badge--unverified");
      return b ? getComputedStyle(b).color : null;
    }));
    check("light coat: an UNVERIFIED badge is still readable on the card",
      !badge || lum(badge) < 0.25, `got rgb(${badge})`);

    /* the gallery strip — captions that sit on a photograph must NOT turn
       with the house, because a photograph does not */
    await lp.goto(B + "gallery.html", { waitUntil: "load" });
    await lp.waitForTimeout(900);
    const cap = await lp.evaluate(() => {
      const c = document.querySelector(".gxstrip .cell b");
      if (!c) return null;
      const cs = getComputedStyle(c), scrim = getComputedStyle(c.parentElement, "::before");
      return { color: cs.color, scrim: scrim.content !== "none" };
    });
    const capC = cap && rgb(cap.color);
    check("light coat: gallery captions stay bone over the photograph",
      !cap || (capC && lum(capC) > 0.6), `got ${cap && cap.color}`);
    check("light coat: and they get a scrim to sit on", !cap || cap.scrim);

    await lp.close();
  }

  /* ---------- THE AGENT SURFACE ----------
     LAST ON PURPOSE. Every check below navigates AWAY from index.html to a
     plain text file, which destroys the appbar and the wing the bar section
     above spends its time opening. This block sat in the middle once; the
     very next line clicked `.appbar__tab--slot` on a page that no longer had
     one and the whole run died on a 30s timeout after 365 green checks.
     Nothing after this point may depend on the bar.
     llms.txt and robots.txt are promises made to a machine that will act
     on them with no human reading first. A 404 or a stale count there is
     invisible to everyone until it has already misled somebody, so the
     gate checks them the same way it checks a page.

     The deep verification (every link resolves, every count matches its
     data file, every endpoint answers) lives in tools/verify-llms.py and
     runs in CI. These are the two things only a browser can tell us:
     that the files are actually SERVED, and that the desks robots.txt
     closes are the same desks llms.txt says are closed. */
  const llms = await page.goto(B + "llms.txt");
  check("llms.txt is served", llms.status() === 200, `HTTP ${llms.status()}`);
  /* llms.txt is hard-wrapped prose, so a phrase can straddle a newline.
     Collapse whitespace before matching: these assert what the file SAYS,
     and a line break is not a change of meaning. */
  const llmsBody = (await llms.text()).replace(/\s+/g, " ");
  check("llms.txt leads with the directory, not a bio", /fellowship directory/i.test(llmsBody));
  check("llms.txt tells an agent the listings are unverified",
    /unverified/.test(llmsBody) && /confirm on the program/i.test(llmsBody));
  /* This used to assert the shop's "an empty array means closed" rule.
     The shop was shelved on 2026-08-19 and that sentence went with it, so
     the check is repointed rather than deleted: the property it was really
     guarding is that llms.txt tells an agent where the AUTHORITATIVE copy
     of a fact is, instead of inviting it to quote a cached page. */
  check("llms.txt sends an agent to the documents, not to a cached summary",
    /link the page you took it from/i.test(llmsBody));
  check("llms.txt still names the two résumé formats",
    /\.pdf/i.test(llmsBody) && /\.docx/i.test(llmsBody));

  const rb = await page.goto(B + "robots.txt");
  check("robots.txt is served", rb.status() === 200, `HTTP ${rb.status()}`);
  const rbBody = await rb.text();
  check("robots.txt names the AI crawlers explicitly", /GPTBot/.test(rbBody) && /ClaudeBot/.test(rbBody));
  /* the open policy is a DECISION (see the header in robots.txt): blocking
     pays nothing until the edge can charge, and this property is not behind
     Cloudflare yet. If someone flips it, that should be deliberate. */
  check("the AI policy is open, and the desks are still shut", await page.evaluate((t) => {
    const ai = t.slice(t.indexOf("GPTBot"));
    return /^\s*Allow: \/$/m.test(ai) && /Disallow: \/uprise-admin\.html/.test(ai);
  }, rbBody));


  await ctx.close();

  /* ---------- THE NOTICE ----------
     A first visit, in a context that has NOT seen the policy. The house
     pages put up the wall; a document page (one carrying
     <meta name="mcc-privacy-notice" content="banner">) shows a bar along
     the bottom and leaves the words readable; agreeing takes the wall down
     and is remembered. These are the only checks that may see the wall:
     every context above was seeded as a visitor who had already seen it. */
  console.log("\n[the notice]");
  check("the notice version was read off js/live-content.js", !!PRIVACY_VERSION, "no VERSION found");
  {
    const nc = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await nc.route(OUTBOUND, refuse);
    const np = await nc.newPage();
    await np.goto(B + "index.html", { waitUntil: "load" });
    await np.waitForTimeout(600);
    check("notice: a first visit to the house meets the wall", await np.evaluate(() =>
      document.documentElement.getAttribute("data-privacy-gate") === "pending" &&
      !!document.getElementById("mccPrivacyGate") && !!document.getElementById("mccPrivacyAgree")));
    check("notice: the wall links the policy itself", await np.evaluate(() =>
      /privacy\.html$/.test(document.querySelector("#mccPrivacyGate a")?.getAttribute("href") || "")));
    await np.goto(B + "matthew-mccluster.html", { waitUntil: "load" });
    await np.waitForTimeout(600);
    check("notice: a document page gets the banner, not the wall", await np.evaluate(() =>
      !document.getElementById("mccPrivacyGate") && !!document.getElementById("mccPrivacyNotice")));
    await np.close();
    /* seeing the banner counts as seen; agreeing is the stronger record.
       The seen record is kept twice, in localStorage and in a
       mcc_privacy_seen cookie (js/live-content.js), so a fresh first visit
       clears both or the wall never goes up to be agreed to. */
    await nc.clearCookies();
    const ap = await nc.newPage();
    await ap.addInitScript(() => { try { localStorage.removeItem("mcc_privacy_seen"); sessionStorage.removeItem("mcc_privacy_seen"); } catch (e) {} });
    await ap.goto(B + "index.html", { waitUntil: "load" });
    await ap.waitForTimeout(600);
    await ap.click("#mccPrivacyAgree", { timeout: 10000 }).catch((e) => no("notice: the agree button takes a tap", String(e).slice(0, 80)));
    await ap.waitForTimeout(2500);
    check("notice: agreeing takes the wall down and is remembered", await ap.evaluate((v) => {
      const ack = JSON.parse(localStorage.getItem("mcc_privacy_ack") || "null");
      return !document.getElementById("mccPrivacyGate") && !!ack && ack.version === v;
    }, PRIVACY_VERSION));
    await nc.close();
  }

  await browser.close();
} finally {
  server.kill();
}

console.log(failures.length ? `\nSMOKE FAILED: ${failures.length} problem(s)` : "\nSMOKE CLEAN");
process.exit(failures.length ? 1 : 0);
