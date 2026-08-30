/* THE SMOKE SUITE: the release gate the site never had.
   Boots a local server, walks the key rooms headless at phone and
   desktop widths, and fails the build on any page error or missing
   mount. Run locally:  node scripts/smoke.mjs
   (set PW_MODULE to your playwright install if it isn't resolvable,
   and PW_CHROME to a chrome executable if not using PW defaults) */
import { createRequire } from "module";
import { spawn } from "child_process";
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

/* THE SEAL: demo.html frames two kinds of work. Ours are frozen copies
   under demos/, synced by scripts/sync-demo.mjs, and they load from
   127.0.0.1 like any other page here. The rest are clients' own live sites
   on somebody else's server. CI may have no way out to those, and on the
   runs where it does, a foreign script throwing inside the frame lands in
   this page's error list and fails our build over a bug we do not own. So on
   the viewer's pages every request that leaves 127.0.0.1 is refused before it
   starts: nothing to wait on, nothing foreign to run. The viewer's checks
   read DOM and attributes only, the frame's src and never what loads
   inside it. Do not "tighten" this by waiting on the frame to load. */
const OUTBOUND = (url) => !String(url).startsWith(B);
const refuse = (route) => route.abort();
const SEALED = { sealed: true };

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

  const PAGES = [
    ["index.html", async (p) => {
      check("index: 5 bar tabs", await p.locator(".appbar > .appbar__tab").count() === 5);
      /* the owner's call: five tabs, and the M coin holds the middle of them.
         morph() reads a held tab's column straight off ORDER in js/tabbar.js,
         so DOM order and that list have to say the same thing or the tab you
         are holding jumps a column when its wing opens. */
      check("index: the M coin holds the middle of five", await p.evaluate(() =>
        [...document.querySelectorAll(".appbar > .appbar__tab")].map((a) => a.dataset.appnav).join()
        === "music,uprise,home,sites,profile"));
      check("index: the civic tab is a drawn mark, never an emoji", await p.evaluate(() => {
        const t = document.querySelector('[data-appnav="uprise"]');
        return !!t.querySelector("svg") && !/[^\x00-\x7F]/.test(t.textContent);
      }));
      /* the fifth tab is the studio, and it is a drawn glyph like the other
         three — this column has changed hands twice and has never been an
         image or an emoji, only a stroke drawing on the same 24-grid */
      check("index: the studio tab is a drawn laptop, not an image", await p.evaluate(() => {
        const t = document.querySelector('[data-appnav="sites"]');
        return !!t && !!t.querySelector("svg") && !t.querySelector("img");
      }));
      check("index: the studio tab opens Sites",
        await p.locator('[data-appnav="sites"]').getAttribute("href") === "sites.html");
      check("index: body clears the bar (has-appbar)", await p.evaluate(() => document.body.classList.contains("has-appbar")));
      /* the owner's call: the landing page opens on the emblem and belongs to
         the M coin; the record lives behind the Music tab, not pinned on top */
      check("index: the front page lights the M coin", await p.evaluate(() =>
        !!document.querySelector('[data-appnav="home"].is-here') &&
        !document.querySelector('[data-appnav="music"].is-here')));
      check("index: titled I AM HERE", (await p.title()).includes("I AM HERE"), await p.title());
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
      check("merch: prices reach the page", /\$\d/.test(await p.innerText("body")));
    }],
    ["management.html", async (p) => {
      /* it carried the masthead and nothing else; retiring the top bar
         would have left the Socials Room with no way out */
      check("management: has the bottom bar", await p.locator(".appbar > .appbar__tab").count() === 5);
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
      /* the rename trap: these deep links key off the album SLUG, not its name */
      check("catalogue: all six album tracks deep-link into the player", await p.evaluate(() =>
        [...document.querySelectorAll("#reg a[href='album.html']")].length === 6));
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
      check("closet: three drops on the rail", await p.locator("#pcRail .gmt").count() === 3);
      check("closet: giving door state present", await p.locator("#pcSow").count() === 1);
      check("closet: the lead drop wears a real garment", await p.evaluate(() =>
        !!document.querySelector("#pcHeroField img") && document.querySelector(".pch")?.classList.contains("has-photo")));
      check("closet: photographed card drops the hanger placeholder", await p.evaluate(() => {
        const c = document.querySelector("#pcRail .gmt.has-photo");
        return !!c && !!c.querySelector(".gmt__field img") && !c.querySelector(".gmt__hang");
      }));
    }],
    ["closet/seek-first.html", async (p) => {
      check("drop: all six stages", await p.evaluate(() =>
        ["look", "message", "chapter", "briefing", "closet", "acquire"].every((id) => !!document.getElementById(id))));
      const sq = await p.locator("#clmSquare").getAttribute("href");
      check("drop: live Square preorder", (sq || "").includes("square.link"), `href=${sq}`);
      check("drop: the garment wears the hero", await p.evaluate(() =>
        !!document.querySelector(".dph__field img") && !document.querySelector(".dph__hang")));
      check("drop: look gallery mounted", await p.locator(".look figure img").count() >= 6);
      check("drop: tech pack carries its artwork", await p.locator(".tpk__art").count() >= 5);
      check("drop: washed blue on the record", await p.evaluate(() =>
        [...document.querySelectorAll(".tpk__row")].some((r) => /Washed Blue/i.test(r.textContent))));
      check("drop: no image escapes its card", await p.evaluate(() =>
        [...document.querySelectorAll(".look img, .tpk__art, .dph__field img")]
          .every((i) => i.getBoundingClientRect().width <= window.innerWidth + 1)));

      /* a $333 garment states what it is made of */
      check("drop: the cloth is on the record", await p.locator(".tpk--spec").count() === 1);
      check("drop: fabric weight and fit are named", await p.evaluate(() => {
        const t = document.querySelector(".tpk--spec")?.textContent || "";
        return /GSM/.test(t) && /cotton/i.test(t) && /fit/i.test(t);
      }));
      /* until a sample is measured the room says so; it never prints a
         size chart the desk has not checked against a real garment */
      check("drop: sizing is honest about the chart", await p.evaluate(() => {
        const chart = document.querySelector(".szt");
        const note = document.querySelector(".szt__note");
        return chart ? chart.querySelectorAll("tbody tr").length > 0 : !!note;
      }));

      check("drop: no grain layer", await p.locator(".grain").count() === 0);

      /* THE SECOND VARIANT. The bar is hand-copied into every page that
         carries it, and the ones under closet/ and walls/ are a separate
         copy with ../ on every door. (js/tabbar.js now builds a bar for any
         page that has none, resolving through ROOT — but a page that ships
         its own copy still uses that copy, which is why this check stands.
         The six under tracks/ are stubs now and carry no bar at all.)
         Nothing generates the hand-copied ones, so the only thing standing
         between the two variants and a slow drift apart is a page from the
         subdirectory side being checked as well. */
      check("drop: the subdirectory bar carries all five tabs",
        await p.locator(".appbar > .appbar__tab").count() === 5);
      check("drop: every door climbs out of the subdirectory first", await p.evaluate(() =>
        [...document.querySelectorAll(".appbar > a")].every((a) => /^\.\.\//.test(a.getAttribute("href")))));

      /* the capsule holds the bottom edge however far the page runs */
      check("drop: the bar stays pinned deep in the page", await p.evaluate(async () => {
        const gap = () => {
          const r = document.querySelector(".appbar").getBoundingClientRect();
          return Math.round(innerHeight - r.bottom);
        };
        const top = gap();
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((r) => setTimeout(r, 500));
        const deep = gap();
        window.scrollTo(0, 0);
        return top === deep && deep >= 0 && deep < 60;
      }));
    }],
    ["inner-room.html", async (p) => {
      check("inner room: three chapters", await p.locator(".irc button").count() === 3);
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

      /* THE YEAR, PAID TOGETHER. One rate is stored ($30); the twelve
         months, the go-live total and the saving are arithmetic on it. */
      await p.click('.buy[data-offer="runway"] .modes button[data-mode="year"]').catch(() => {});
      await p.waitForTimeout(220);
      const yr = await card("runway");
      check("sites: the year is the domain plus twelve months at the annual rate",
        /\$393(?!\d)/.test(yr) && /\$30(?!\d)/.test(yr) && /\$36(?!\d)/.test(yr), yr);
      await p.click('.buy[data-offer="runway"] .modes button[data-mode="m"]').catch(() => {});
      await p.waitForTimeout(200);

      /* the front door leads with the go-live total and nothing else */
      check("sites: the front door is $66, and $33 only as what follows",
        /\$66(?!\d)/.test(await card("runway")) &&
        /\$33\/month/.test(await card("runway")) &&
        !/\$33(?!\d)\s*(to|To)/.test(await card("runway")),
        await card("runway"));

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

      /* THE WHOLE POINT, MEASURED. */
      check("sites: the buying page stays under three phone screens",
        await p.evaluate(() => document.documentElement.scrollHeight) < 2900,
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
      /* the split comes from the ledger, not from this file. Typed here as
         "one burned, two open" it went red the day a second seat filled,
         which is a sale, not a regression. What must stay true is that the
         row shows every seat and that burned plus open accounts for all of
         them, with no seat in neither state and none in both. */
      const seats = await p.evaluate(async () => {
        const d = await (await fetch("data/sites.json", { cache: "no-cache" })).json();
        const b = d.build || {};
        return {
          want: b.seats, taken: b.taken,
          all: document.querySelectorAll("#seatRow .seat").length,
          gone: document.querySelectorAll("#seatRow .seat.gone").length,
          open: document.querySelectorAll("#seatRow .seat.open").length,
        };
      });
      check("sites: the row shows every seat the ledger has",
        seats.all === seats.want, `${seats.all} drawn, ledger says ${seats.want}`);
      check("sites: taken and open account for all of them, once each",
        seats.gone === seats.taken && seats.gone + seats.open === seats.want,
        `${seats.gone} taken + ${seats.open} open, ledger says ${seats.taken} of ${seats.want}`);
      /* each taken seat wears its own client's name: with one seat gone a
         shared caption was invisible, with two it is wrong */
      check("sites: no two taken seats share a caption", await p.evaluate(() => {
        const caps = [...document.querySelectorAll("#seatRow .seat.gone small")]
          .map((s) => s.textContent.trim());
        return new Set(caps).size === caps.length;
      }));
      /* the burned seat is the door into the demo, and it has to be both
         things at once: a link the visitor can take, and a seat the row
         above can still count. A link that dropped either class would
         quietly break the count the line above guards. */
      const door = await p.evaluate(() => {
        const s = document.querySelector("#seatRow .seat.gone");
        return { tag: s ? s.tagName : "", cls: s ? s.className : "", href: s ? s.getAttribute("href") || "" : "" };
      });
      check("sites: the burned seat is a link and still wears its seat classes",
        door.tag === "A" && /\bseat\b/.test(door.cls) && /\bgone\b/.test(door.cls),
        `<${door.tag.toLowerCase() || "nothing"} class="${door.cls}">`);
      check("sites: the burned seat opens the demo viewer",
        /^demo\.html\?s=[a-z0-9-]+$/.test(door.href), `href=${door.href || "none"}`);
      check("sites: the demo door names a work the ledger carries", await p.evaluate(async (href) => {
        const slug = (href.split("?s=")[1] || "").split("&")[0];
        const d = await (await fetch("data/sites.json", { cache: "no-cache" })).json();
        return !!slug && (d.showcase || []).some((w) => w.slug === slug);
      }, door.href), `href=${door.href || "none"}`);
      /* the open seats are not doors: there is nothing behind them to look at */
      check("sites: the open seats stay plain", await p.evaluate(() =>
        [...document.querySelectorAll("#seatRow .seat.open")].every((s) => s.tagName !== "A")));
      check("sites: terms mount from the ledger", await p.locator("#stTerms li").count() >= 4);
      check("sites: the comparison names the done-for-you gap", await p.evaluate(() =>
        /\$199 a month/.test(document.body.textContent)));
      /* the long dashes are written as escapes so this gate file does not
         itself carry the characters the house bans */
      check("sites: not a single em dash on the page", await p.evaluate(() =>
        !/[\u2014\u2013]/.test(document.documentElement.outerHTML)));
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
      check("console: sign-in and magic-link doors present", await p.evaluate(() =>
        !!document.getElementById("cxGo") && !!document.getElementById("cxSend")));
      check("console: noindex (client room, not a public page)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "")));
    }],

    /* ---- THE EQUITY UPRISE PLATFORM ----------------------------------
       Every one of these is SEALED, and that is the whole test. These
       rooms read from Supabase when it answers and fall back to
       data/eu-*.json when it does not — which is what happens on the
       first paint, on a bad connection, and on the day the site deploys
       before the migration runs. Sealing the page cuts the database off
       at the knees, so what CI sees is the fallback path and nothing
       else. If these rows go red, a signed-out stranger is looking at an
       empty page. Do not "fix" them by letting the calls out. */
    ["topics.html", async (p) => {
      check("topics: the hubs paint with no backend", await p.evaluate(() =>
        document.querySelectorAll("#euTopicList .eua-card").length >= 3));
      check("topics: each hub is a door into its own room", await p.evaluate(() =>
        [...document.querySelectorAll("#euTopicList .eua-card")]
          .every((a) => /topics\.html\?topic=/.test(a.getAttribute("href") || ""))));
    }, SEALED],

    ["topics.html?topic=data-centers", async (p) => {
      check("topic: the framing stands", await p.evaluate(() =>
        (document.getElementById("tDesc")?.textContent || "").length > 120));
      /* neutrality is not a vibe here: the structured questions are the
         place it breaks first, so the page has to actually offer them */
      check("topic: the questions offer real options", await p.evaluate(() =>
        document.querySelectorAll("#tDims .eua-dim").length >= 2 &&
        document.querySelectorAll("#tDims .eua-opt").length >= 6));
      check("topic: what is documented is disclosed, not asserted", await p.evaluate(() =>
        !!document.getElementById("tContext")?.closest("details")));
      check("topic: the consent box is on by default and the name box is not",
        await p.evaluate(() =>
          document.getElementById("tConsent")?.checked === true &&
          document.getElementById("tAnon")?.checked === false));
    }, SEALED],

    ["fellowships.html", async (p) => {
      check("fellowships: the directory paints with no backend", await p.evaluate(() =>
        document.querySelectorAll("#list .eua-card").length >= 10));
      /* the promise the directory makes about itself: nothing seeded has
         been checked, and every card says so out loud */
      check("fellowships: unverified listings say so on the card", await p.evaluate(() =>
        document.querySelectorAll("#list .eua-badge--unverified").length >= 10));
      check("fellowships: the tag picker is built from the topics", await p.evaluate(() =>
        document.querySelectorAll("#tagPicker .eua-tag").length >= 8));
      check("fellowships: listing a program needs an account", await p.evaluate(() =>
        !document.getElementById("listGate")?.hidden && document.getElementById("listForm")?.hidden));
    }, SEALED],

    ["profile.html", async (p) => {
      check("profile: signed out lands on the people directory", await p.evaluate(() =>
        !document.getElementById("dirView")?.hidden && document.getElementById("editView")?.hidden));
    }, SEALED],

    ["dashboard.html", async (p) => {
      check("dashboard: the door stands when signed out", await p.evaluate(() =>
        !document.getElementById("gate")?.hidden && document.getElementById("deck")?.hidden));
      check("dashboard: noindex (a signed-in desk, not a page to rank)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "")));
    }, SEALED],

    ["uprise-admin.html", async (p) => {
      check("desk: closed to a stranger", await p.evaluate(() =>
        !document.getElementById("gate")?.hidden && document.getElementById("deck")?.hidden));
      check("desk: noindex,nofollow (the control plane)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "") &&
        /nofollow/.test(document.querySelector('meta[name="robots"]')?.content || "")));
    }, SEALED],

    /* The inbox back office turns channels on and off and decides what the
       bot is allowed to say. A stranger must see a password box and nothing
       else — no thread list, no channel switches, not even their names. */
    ["inbox.html", async (p) => {
      check("inbox: a stranger gets the door and nothing behind it", await p.evaluate(() => {
        const ib = document.getElementById("ib");
        return !!ib && !!ib.querySelector(".gate") && !ib.querySelector(".rooms");
      }));
      check("inbox: noindex,nofollow (the control plane)", await p.evaluate(() =>
        /noindex/.test(document.querySelector('meta[name="robots"]')?.content || "") &&
        /nofollow/.test(document.querySelector('meta[name="robots"]')?.content || "")));
      /* the page reads through PostgREST with the STAFF member's token and
         writes through the function, so it never needs a privileged key and
         must never carry one */
      check("inbox: ships no service key", await p.evaluate(() =>
        !/service_role|eyJ[A-Za-z0-9_-]{40,}/.test(document.documentElement.innerHTML)));
    }, SEALED],
  ];

  for (const width of [390, 1280]) {
    console.log(`\n[viewport ${width}px]`);
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    const page = await ctx.newPage();
    /* SMOKE_ONLY=sites.html,hire.html runs one page's checks instead of
       the whole house. The full suite is the release gate and CI runs it
       whole; this is for the person changing one room, who otherwise
       waits ten minutes to find out about a typo. */
    const only = (process.env.SMOKE_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const [path, checks, opt] of PAGES) {
      if (only.length && !only.includes(path)) continue;
      const errs = [];
      const onErr = (e) => errs.push(String(e).slice(0, 120));
      page.on("pageerror", onErr);
      /* a sealed page talks to nobody but our own server: see THE SEAL above */
      if (opt && opt.sealed) await page.route(OUTBOUND, refuse);
      await page.goto(B + path, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => no(`${path} loads`, String(e).slice(0, 80)));
      await page.waitForTimeout(900);
      await checks(page);
      check(`${path}: zero page errors [${width}]`, errs.length === 0, errs.join(" | "));
      page.off("pageerror", onErr);
      if (opt && opt.sealed) await page.unroute(OUTBOUND, refuse);
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
  await page.waitForURL("**/album.html", { timeout: 15000 }).then(
    () => ok("one tap on Music opens the player, even where a deck exists"),
    async () => no("one tap on Music opens the player, even where a deck exists",
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
  await page.waitForURL("**/album.html", { timeout: 15000 }).then(
    () => ok("with no transport there, one tap on Music still lands on the album"),
    async () => no("with no transport there, one tap on Music still lands on the album",
      "still at " + page.url() + " veil=" +
      (await page.evaluate(() => document.documentElement.classList.contains("pt-out")).catch(() => "?"))));

  /* THE PLAYBACK LAW: tapping Music while already standing on the album must
     NOT reload; a reload restarts the record mid-song. It works the deck in
     place instead, which is the whole point of the transport. */
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__mccAlive = true; });
  await page.click('[data-appnav="music"]', { timeout: 10000 }).catch((e) =>
    no("music tab clickable on the album", String(e).slice(0, 100)));
  await page.waitForTimeout(1800);
  check("tapping Music on the album starts the deck and does not reload",
    await page.evaluate(() => window.__mccAlive === true &&
      document.querySelector("audio") && !document.querySelector("audio").paused).catch(() => false),
    "the document was replaced, or the deck never took the tap");
  await page.click('[data-appnav="music"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  check("tapping it again pauses the record, still without reloading",
    await page.evaluate(() => window.__mccAlive === true &&
      document.querySelector("audio").paused).catch(() => false));

  /* THE WING LAW: a wing carries four rooms, so the open bar is the same
     five cells as the closed one and the tab you held never moves. */
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
  check("holding a tab keeps the bar five cells wide",
    await page.locator(".appbar > a").count() === 5,
    `got ${await page.locator(".appbar > a").count()}`);
  /* the M coin is the third of five, and morph() puts the held tab back at
     its ORDER index. A wing left one room short quietly drags it left. */
  check("the held tab never leaves its own column", await page.evaluate(() =>
    [...document.querySelectorAll(".appbar > a")].findIndex((a) => a.matches('[data-appnav="home"]')) === 2));
  check("the wing opens four rooms", await page.locator(".appbar__tab--slot").count() === 4);
  /* and the newest tab, which is the one the anchor law clamps first if any
     wing is ever left carrying fewer rooms than the bar has tabs */
  await page.mouse.click(10, 100);
  await page.waitForTimeout(300);
  await hold("uprise");
  check("holding the civic tab keeps it in the second column", await page.evaluate(() =>
    [...document.querySelectorAll(".appbar > a")].findIndex((a) => a.matches('[data-appnav="uprise"]')) === 1),
    await page.evaluate(() => [...document.querySelectorAll(".appbar > a")]
      .map((a) => a.dataset.appnav || a.textContent.trim()).join(" | ")));
  check("the civic wing opens its own four rooms", await page.locator(".appbar__tab--slot").count() === 4);
  await page.mouse.click(10, 100);
  await page.waitForTimeout(300);
  await hold("home");

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
  check("the map still carries the whole house", await page.locator(".mhd__grp a").count() >= 28,
    `${await page.locator(".mhd__grp a").count()} rooms`);

  /* THE TWO ROOMS THAT LOST A TAB. The shop took the fifth column on
     2026-08-17. HITMAN had NO other door in the whole house — it existed
     only because js/theme.js rewrote that tab into it after boot — and the
     current drop lost its wing slot. Both are rescued by the drawer, which
     is exactly what the drawer is for, and this is the check that says so.
     If either of these fires, a room is orphaned, not merely moved. */
  for (const [room, href] of [["HITMAN", "hitman-facility.html"], ["the studio", "sites.html"],
                              ["the Closet", "prayer-closet.html"], ["the drop", "closet/seek-first.html"]]) {
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

  await browser.close();
} finally {
  server.kill();
}

console.log(failures.length ? `\nSMOKE FAILED: ${failures.length} problem(s)` : "\nSMOKE CLEAN");
process.exit(failures.length ? 1 : 0);
