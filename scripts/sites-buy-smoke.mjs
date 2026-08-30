/* THE BUY PAGE, DRIVEN.
 *
 * sites.html exists to be bought from. So the checks are about that and
 * nothing else: how tall it is, how many prices each card shows, whether
 * the button goes somewhere that can actually take money, and whether
 * flipping to Equity Uprise puts the disclosure in front of the person
 * flipping it.
 *
 *     node scripts/sites-buy-smoke.mjs
 *
 * Serves the repo itself. PW_MODULE / PW_CHROME as in scripts/smoke.mjs.
 */
import { createRequire } from "module";
import http from "http";
import { readFile } from "fs/promises";
import { extname, join, normalize } from "path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || "playwright");

const PORT = 8934;
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
                ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml",
                ".webp":"image/webp", ".jpg":"image/jpeg", ".woff2":"font/woff2" };
const server = http.createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split("?")[0]));
  try {
    const b = await readFile(join(ROOT, p === "/" ? "index.html" : p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

let fail = 0;
const check = (n, ok, extra) => {
  console.log((ok ? "  ok    " : "  FAIL  ") + n + (ok || !extra ? "" : "\n        " + extra));
  if (!ok) fail++;
};

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});

/* The four offerings the cards may send somebody to. A button pointing at
   a slug the checkout does not know is a dead end that looks alive. */
const OFFERINGS = new Set(
  (JSON.parse(await readFile(join(ROOT, "data/offerings.json"), "utf8")).offerings || [])
    .map((o) => o.slug),
);

for (const width of [390, 1280]) {
  console.log(`\n[viewport ${width}px]`);
  const ctx = await b.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${PORT}`)
    ? r.continue() : r.fulfill({ status: 204, body: "" }));

  await p.goto(`http://127.0.0.1:${PORT}/sites.html`, { waitUntil: "networkidle", timeout: 25000 });
  await p.waitForTimeout(1400);

  const cards = await p.$$eval(".buy", (els) => els.map((e) => ({
    id: e.dataset.offer,
    prices: e.querySelectorAll(".buy__price").length,
    // every place a dollar figure could appear inside the card
    dollarBits: (e.textContent.match(/\$[\d,]+/g) || []),
    ctas: e.querySelectorAll(".buy__go").length,
    href: e.querySelector(".buy__go")?.getAttribute("href") || "",
    label: e.querySelector(".buy__go")?.textContent.trim() || "",
    modes: e.querySelectorAll(".modes button").length,
  })));

  check("four cards, and only four", cards.length === 4,
    cards.map((c) => c.id).join(", "));
  check("the cards are the four products on sale",
    JSON.stringify(cards.map((c) => c.id)) ===
    JSON.stringify(["runway", "anti-social", "who-did-the-shoot", "write-a-song"]),
    cards.map((c) => c.id).join(", "));

  // the fault that started this: one product wearing two prices
  for (const c of cards) {
    check(`${c.id}: exactly one price block`, c.prices === 1, `${c.prices}`);
    check(`${c.id}: one button, one label`, c.ctas === 1 && c.label.length > 0, c.label);
  }
  check("runway says $66 and never $33 above the fold",
    cards[0].dollarBits.filter((d) => d === "$66").length === 1,
    cards[0].dollarBits.join(" "));

  // a button has to reach something that can take money
  for (const c of cards) {
    const m = /^pay\.html\?offer=([a-z0-9-]+)$/.exec(c.href);
    check(`${c.id}: the button reaches a real checkout`, !!m && OFFERINGS.has(m[1]), c.href);
  }

  check("every card offers exactly two ways to pay",
    cards.every((c) => c.modes === 2), cards.map((c) => `${c.id}:${c.modes}`).join(" "));

  /* NOTHING ON THIS PAGE TELLS ANYBODY TO HURRY.
     It used to open on "three builds, then never again" over a seat
     ledger counting down. The builds are still free and the clients are
     still shown; the deadline was invented and it is gone. */
  const pressure = await p.evaluate(() => {
    /* What a reader sees, which is not what textContent returns: script
       bodies and the sitewide nav are in <body> and are neither of them
       this page making an argument. The nav is checked once, on its own,
       below — a scarcity word hiding in a menu label is still a scarcity
       word, and one was. */
    const t = document.querySelector("main").innerText;
    return ["never again", "seat", "seats left", "one remains", "limited",
            "hurry", "act now", "while they last", "closes"]
      .filter((w) => new RegExp(w, "i").test(t));
  });
  check("no scarcity language anywhere on the page", pressure.length === 0, pressure.join(", "));
  const navPressure = await p.evaluate(() => {
    const t = [...document.querySelectorAll("nav a, .mast a, [aria-label] a")]
      .map((a) => a.textContent).join(" ");
    return ["seat", "never again", "limited", "hurry", "while they last"].filter((w) => new RegExp(w, "i").test(t));
  });
  check("nor hiding in a nav label", navPressure.length === 0, navPressure.join(", "));
  check("the fifth tab is the chat, not a catalogue",
    await p.evaluate(() => {
      const t = document.querySelector('[data-appnav="sites"]');
      return !!t && /chat/i.test(t.textContent) && !/sites/i.test(t.textContent.trim());
    }));
  check("and no hero standing between the reader and the first price",
    await p.evaluate(() => !document.querySelector(".buyhero, .hero2, .seats, .close, .math")));
  check("the first thing on the page is the count, then a card",
    await p.evaluate(() => {
      const first = document.querySelector("main .buys > *");
      return first && first.classList.contains("buys__k");
    }));

  /* THE YEAR. One rate is stored ($30); the year, the go-live total and
     the saving are all arithmetic on it. Asserting the arithmetic is what
     catches one of the three being typed by hand later. */
  await p.click('.buy[data-offer="runway"] .modes button[data-mode="year"]');
  await p.waitForTimeout(300);
  const yr = await p.$eval('.buy[data-offer="runway"]', (e) => ({
    price: e.querySelector(".buy__price").textContent,
    after: (e.querySelector(".buy__after") || {}).textContent || "",
    href: e.querySelector(".buy__go").getAttribute("href"),
  }));
  check("the year is $393 — the domain plus twelve months at $30",
    /\$393(?!\d)/.test(yr.price), yr.price);
  check("and says what it saves, derived, not asserted",
    /\$36(?!\d)/.test(yr.after) && /\$30(?!\d)/.test(yr.after), yr.after);
  check("the year has its own checkout, not the monthly one",
    yr.href === "pay.html?offer=domain-hosting-year", yr.href);
  await p.click('.buy[data-offer="runway"] .modes button[data-mode="m"]');
  await p.waitForTimeout(250);
  check("flipping back restores $66",
    /\$66(?!\d)/.test(await p.$eval('.buy[data-offer="runway"] .buy__price', (e) => e.textContent)));

  /* ============================================================
     THE ADDRESS BOX

     "Get the address" used to take money for a name nobody had looked
     up. These checks are about the four ways that can still go wrong,
     because each one of them ends with a charged card and an address
     the buyer cannot have:

       a taken name offered as a button
       an unanswered lookup dressed up as available
       an ending we do not sell wearing a price
       a registry price that is not the price this card charges

     The registry is stubbed, deliberately. What is under test is what
     the CARD does with an answer, and a test that needed the real
     internet to say "taken" would be testing whether google.com is
     still registered.
     ============================================================ */
  const FIXTURE = {
    // free at the card's own price: the one case that becomes a button
    "openname": [
      { name: "openname.com", tld: "com", available: true,  sellable: true,  price: 33, note: null },
      { name: "openname.net", tld: "net", available: true,  sellable: true,  price: 33, note: null },
      { name: "openname.org", tld: "org", available: false, sellable: true,  price: 33, note: null },
    ],
    // nothing free
    "takenname": [
      { name: "takenname.com", tld: "com", available: false, sellable: true, price: 33, note: null },
      { name: "takenname.net", tld: "net", available: false, sellable: true, price: 33, note: null },
    ],
    // the registry did not answer
    "quietname": [
      { name: "quietname.com", tld: "com", available: null, sellable: true, price: 33, note: null },
    ],
    // free, ours to look up, not ours to sell in one tap
    "somename.io": [
      { name: "somename.io", tld: "io", available: true, sellable: false, price: null,
        note: "Available. .io costs more than the standard address." },
    ],
    // free and sellable, at a price this card does not charge
    "pricey": [
      { name: "pricey.com", tld: "com", available: true, sellable: true, price: 45, note: null },
    ],
  };
  await p.route("**/functions/v1/domain-check", async (r) => {
    const q = String(JSON.parse(r.request().postData() || "{}").name || "").toLowerCase().trim();
    const results = FIXTURE[q];
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(results
        ? { ok: true, query: q, results }
        : { ok: false, reason: "Type a name to check.", results: [] }),
    });
  });

  const box = '.buy[data-offer="runway"] .dom';
  check("the domain and hosting card carries an address box",
    await p.$(box + " .dom__in") !== null);
  check("and only that card does",
    await p.$$eval(".dom", (es) => es.length) === 1);

  const search = async (q) => {
    await p.fill(box + " .dom__in", "");
    await p.fill(box + " .dom__in", q);
    await p.click(box + " .dom__go");
    await p.waitForTimeout(350);
    return p.$eval('.buy[data-offer="runway"]', (e) => ({
      say: e.querySelector(".dom__say").textContent.trim(),
      rows: [...e.querySelectorAll(".dom__one")].map((b) => ({
        name: b.querySelector("b").textContent,
        line: b.querySelector("i").textContent,
        price: b.querySelector(".dom__price")?.textContent || "",
        picked: b.getAttribute("aria-pressed") === "true",
        dead: b.disabled,
      })),
      href: e.querySelector(".buy__go").getAttribute("href"),
      label: e.querySelector(".buy__go").textContent.trim(),
    }));
  };

  const free = await search("openname");
  check("a free name comes back with its price beside it",
    free.rows[0].name === "openname.com" && free.rows[0].price === "$33/yr", JSON.stringify(free.rows[0]));
  check("the taken ending is struck out, disabled, and carries no price",
    free.rows.some((r) => r.name === "openname.org" && r.dead && r.price === ""),
    JSON.stringify(free.rows));
  check("the one they can act on is already picked",
    free.rows[0].picked && free.rows.filter((r) => r.picked).length === 1,
    JSON.stringify(free.rows.map((r) => [r.name, r.picked])));
  check("THE BUTTON CARRIES THE NAME INTO CHECKOUT",
    free.href === "pay.html?offer=domain-hosting-start&for=openname.com", free.href);
  check("and says which address it is buying",
    free.label === "Get openname.com", free.label);
  /* A search result is a fact about one moment, not a reservation. */
  check("and says out loud that checking does not hold the name",
    await p.$eval(box + " .dom__hold", (e) => !e.hidden && /does not hold it/i.test(e.textContent)));

  await p.click(box + ' .dom__one:has-text("openname.net")');
  await p.waitForTimeout(150);
  const swapped = await p.$eval('.buy[data-offer="runway"] .buy__go', (e) => e.getAttribute("href"));
  check("picking a different ending moves the checkout with it",
    swapped === "pay.html?offer=domain-hosting-start&for=openname.net", swapped);

  /* THE ONE THAT COSTS MONEY IF IT IS WRONG. */
  const taken = await search("takenname");
  check("A TAKEN NAME IS NEVER A BUTTON",
    taken.rows.every((r) => r.dead && r.price === "" && !r.picked), JSON.stringify(taken.rows));
  check("and the holding note goes with it",
    await p.$eval(box + " .dom__hold", (e) => e.hidden));
  check("and the checkout falls back to the plain one, with no name on it",
    taken.href === "pay.html?offer=domain-hosting-start", taken.href);
  check("and the page says so plainly", /taken/i.test(taken.say), taken.say);

  const quiet = await search("quietname");
  check("AN UNANSWERED LOOKUP IS NEVER READ AS AVAILABLE",
    /couldn.t check/i.test(quiet.rows[0].line) && quiet.rows[0].price === "" && !quiet.rows[0].picked,
    JSON.stringify(quiet.rows[0]));
  check("and it never reaches a card form",
    quiet.href === "pay.html?offer=domain-hosting-start", quiet.href);

  const other = await search("somename.io");
  check("an ending we do not sell in a tap shows no price",
    other.rows[0].price === "" && /costs more/i.test(other.rows[0].line),
    JSON.stringify(other.rows[0]));
  check("it goes to the questions, carrying the name",
    /^onboard\.html\?offer=runway&mode=m&domain=somename\.io$/.test(other.href), other.href);

  /* THE LEDGER AND THE DATABASE HAVE TO AGREE BEFORE A BUTTON APPEARS. */
  const drift = await search("pricey");
  check("A REGISTRY PRICE THAT IS NOT THIS CARD'S PRICE IS NOT A ONE-TAP SALE",
    drift.rows[0].price === "" && /onboard\.html/.test(drift.href),
    JSON.stringify(drift.rows[0]) + " " + drift.href);

  /* Editing the box invalidates the answer under it: a button reading
     "Get openname.com" over a field that says something else is a lie
     with a price attached. */
  await search("openname");
  await p.fill(box + " .dom__in", "somethingelse");
  await p.waitForTimeout(150);
  const stale = await p.$eval('.buy[data-offer="runway"]', (e) => ({
    rows: e.querySelectorAll(".dom__one").length,
    href: e.querySelector(".buy__go").getAttribute("href"),
    label: e.querySelector(".buy__go").textContent.trim(),
  }));
  check("typing again clears the answer and the button with it",
    stale.rows === 0 && stale.href === "pay.html?offer=domain-hosting-start" &&
    stale.label === "Get the address", JSON.stringify(stale));

  /* NOT SEARCHING STILL BUYS. */
  await p.fill(box + " .dom__in", "");
  await p.click('.buy[data-offer="runway"] .modes button[data-mode="year"]');
  await p.waitForTimeout(250);
  check("the box survives the billing toggle",
    await p.$(box + " .dom__in") !== null);
  const yrFree = await search("openname");
  check("and the yearly card buys the yearly offering with the same name",
    yrFree.href === "pay.html?offer=domain-hosting-year&for=openname.com", yrFree.href);
  await p.fill(box + " .dom__in", "");
  await p.click('.buy[data-offer="runway"] .modes button[data-mode="m"]');
  await p.waitForTimeout(250);
  check("and with nothing typed the button is the plain checkout it always was",
    await p.$eval('.buy[data-offer="runway"] .buy__go', (e) => e.getAttribute("href")) ===
      "pay.html?offer=domain-hosting-start");

  /* ============================================================
     CHAT FIRST, AND ONLY WHEN THE CHAT CAN ANSWER

     The whole point of the gate is that it fails CLOSED. A conversation
     promoted in front of a deployment that cannot answer a question is
     worse than the cards, so every one of these checks is really the
     same check: does this layout appear when it should not.
     ============================================================ */

  /* the run above had every non-local request stubbed to 204, so the
     health call failed — which is the "old deployment" case */
  check("with no brain deployed, the cards are still the page",
    await p.$eval("#offerBuy", (e) => !e.hidden));
  check("...and the conversation is not shown at all",
    await p.$eval("#talk", (e) => e.hidden));

  /* now the same page against a deployment that says it can answer */
  const health = (body) => async (r) => {
    if (JSON.parse(r.request().postData() || "{}").action !== "health") {
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  };

  /* deskchat.js asks the DATABASE whether the site channel is switched on
     before it draws anything — the off switch is real, not cosmetic — so
     that row has to exist for the widget to mount at all. */
  await p.route("**/rest/v1/inbox_channels**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: '[{"enabled":true}]' }));

  await p.route("**/functions/v1/inbox", health({
    ok: true, brain: true, ai: true, documents: 13, answers: true,
  }));
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/sites.html`, { waitUntil: "networkidle", timeout: 25000 });
  await p.waitForTimeout(1600);

  check("a deployment that CAN answer puts the conversation first",
    await p.$eval("#talk", (e) => !e.hidden));
  check("and the cards step behind it",
    await p.$eval("#offerBuy", (e) => e.hidden));
  check("the conversation is mounted inline, not in the corner",
    await p.evaluate(() => {
      const d = document.querySelector(".dsk");
      if (!d) return false;
      return d.classList.contains("dsk--inline") &&
             !!d.closest("[data-desk-inline]") &&
             getComputedStyle(d).position === "static";
    }));
  check("an inline conversation has no way to dismiss it",
    await p.evaluate(() => !document.querySelector(".dsk--inline .dsk__x")
                       && !document.querySelector(".dsk-launch")));

  const chips = await p.$$eval(".talk__chip", (es) => es.map((e) => e.textContent.trim()));
  check("it opens with the questions people actually arrive with",
    chips.length === 4 && chips.every((c) => /\?$/.test(c)), JSON.stringify(chips));
  check("and none of them is a product menu",
    !chips.some((c) => /anti-social|who did the shoot|write a song/i.test(c)),
    JSON.stringify(chips));

  /* THE CHIPS ARE THE CONVERSATION, NOT A HINT.

     "Most people don't want to chat" is the brief. If the rail empties
     after one tap, everybody who will not type is sent straight to the
     keyboard — which is the exact person this page was built for. */
  await p.click('.talk__chip:has-text("How much for a website?")');
  await p.waitForTimeout(400);
  const after = await p.$$eval(".talk__chip", (es) => es.map((e) => e.textContent.trim()));
  check("the rail refills after a tap instead of emptying",
    after.length >= 4, JSON.stringify(after));
  check("and it refills with the SECOND question, not the first again",
    !after.includes("How much for a website?"), JSON.stringify(after));
  check("the tap went up as the visitor's own message",
    await p.$$eval(".dsk__m--me", (es) => es.some((e) => /how much for a website/i.test(e.textContent))));

  check("one chip opens the prices instead of asking a question",
    after.includes("Show me the prices"), JSON.stringify(after));
  await p.click('.talk__chip:has-text("Show me the prices")');
  await p.waitForTimeout(300);
  check("...and it actually opens them",
    await p.$eval("#offerBuy", (e) => !e.hidden));
  await p.click("#talkBrowse");
  await p.waitForTimeout(250);

  /* THE WAY OUT FOR SOMEBODY WHO WOULD RATHER READ. */
  check("the cards are one tap away, not gone",
    await p.$eval("#talkBrowse", (e) => /look through all four/i.test(e.textContent)));
  await p.click("#talkBrowse");
  await p.waitForTimeout(250);
  check("and tapping it brings them back",
    await p.$eval("#offerBuy", (e) => !e.hidden));
  check("...with all four still there and still buyable",
    await p.$$eval(".buy .buy__go", (es) => es.length) === 4);
  await p.click("#talkBrowse");
  await p.waitForTimeout(200);
  check("and it closes again",
    await p.$eval("#offerBuy", (e) => e.hidden));

  /* EVERY CONDITION, NOT JUST THE ROUTE EXISTING. */
  for (const [name, body] of [
    ["no model key", { ok: true, brain: true, ai: false, documents: 13, answers: false }],
    ["no knowledge", { ok: true, brain: true, ai: true, documents: 0, answers: false }],
    ["an old deployment", { error: "unknown action" }],
  ]) {
    await p.route("**/functions/v1/inbox", health(body));
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await p.goto(`http://127.0.0.1:${PORT}/sites.html`, { waitUntil: "networkidle", timeout: 25000 });
    await p.waitForTimeout(1400);
    check(`${name}: the cards stay the page`,
      await p.$eval("#offerBuy", (e) => !e.hidden) && await p.$eval("#talk", (e) => e.hidden));
  }

  /* back to the stubbed-out world for whatever runs after this */
  await p.route("**/functions/v1/inbox", (r) => r.fulfill({ status: 204, body: "" }));
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/sites.html`, { waitUntil: "networkidle", timeout: 25000 });
  await p.waitForTimeout(1400);

  /* THE CLIENT EXAMPLES. Kept, and no longer numbered seats. */
  const examples = await p.$$eval(".madefor__one", (es) => es.map((e) => ({
    name: e.querySelector("b")?.textContent || "",
    href: e.getAttribute("href") || "",
  })));
  check("the client examples are still here and still open the real thing",
    examples.length >= 2 && examples.every((x) => /^demo\.html\?s=/.test(x.href)),
    JSON.stringify(examples));
  check("and none of them wears a seat number",
    examples.every((x) => !/^0\d/.test(x.name.trim())), JSON.stringify(examples.map((x) => x.name)));

  // THE DISCLOSURE. It used to be ~6,000px below the button.
  await p.click('.buy[data-offer="anti-social"] .modes button:nth-child(2)');
  await p.waitForTimeout(350);
  const eq = await p.$eval('.buy[data-offer="anti-social"]', (e) => ({
    disclose: e.querySelector(".buy__disclose")?.textContent.trim() || "",
    href: e.querySelector(".buy__go")?.getAttribute("href") || "",
    label: e.querySelector(".buy__go")?.textContent.trim() || "",
  }));
  check("flipping to Equity Uprise shows the disclosure right there",
    /no stock|not.*ownership|ownership/i.test(eq.disclose) && eq.disclose.length > 30, eq.disclose.slice(0, 90));
  check("and links to the full terms", /sites-details\.html#equity/.test(
    await p.$eval('.buy[data-offer="anti-social"] .buy__disclose a', (a) => a.getAttribute("href"))));
  check("equity is an agreement, not a checkout", /onboard\.html/.test(eq.href), eq.href);

  await p.click('.buy[data-offer="anti-social"] .modes button:nth-child(1)');
  await p.waitForTimeout(300);
  check("flipping back restores the price", await p.$eval('.buy[data-offer="anti-social"]',
    (e) => /875/.test(e.querySelector(".buy__price")?.textContent || "")));

  /* THE PRICE IS THE LEDGER'S, OR IT IS NOTHING.
     Anti-Social is approved at $875 and Equity Uprise is derived from it,
     never stored: base = 875 x 0.5, cap = 10 x 12 x 875. An earlier cut of
     these cards carried its own copies of those numbers, which is the one
     thing js/offers.js forbids at the top of the file — so the arithmetic
     is asserted against the rendered figures rather than trusted. */
  await p.click('.buy[data-offer="anti-social"] .modes button[data-mode="equity"]');
  await p.waitForTimeout(280);
  const eqTxt = await p.$eval('.buy[data-offer="anti-social"]', (e) => e.textContent.replace(/\s+/g, " "));
  check("equity shows the DERIVED price, not a stored one", /\$437\.50(?!\d)/.test(eqTxt), eqTxt.slice(0, 120));
  check("the cap is still ten times the twelve-month value", /\$105,000(?!\d)/.test(eqTxt), eqTxt.slice(0, 200));
  await p.click('.buy[data-offer="anti-social"] .modes button[data-mode="m"]');
  await p.waitForTimeout(220);

  /* NOTHING THE LEDGER PRICES MAY BE TYPED INTO THE MARKUP.
     Every figure a visitor reads is painted from data/offers.json, so a
     price sitting in sites.html is a second source of truth waiting to
     drift. The head is checked the other way round: search engines do not
     run our JavaScript, so its numerals are literal — and every one of
     them has to be a figure the page actually renders. */
  /* A price only reachable behind the mode toggle is still a price the
     page renders. Collecting the text in M mode alone reported $437.50 and
     the derived cap as stale head figures, which they are not — so the
     snapshot spans both modes, the way a reader can. */
  const rendered = new Set();
  for (const mode of ["m", "equity", "year"]) {
    await p.$$eval(`.buy .modes button[data-mode="${mode}"]`, (bs) => bs.forEach((b) => b.click()));
    await p.waitForTimeout(240);
    (await p.evaluate(() => document.body.textContent.match(/\$[\d.,]+\d/g) || [])).forEach((n) => rendered.add(n));
  }
  await p.$$eval('.buy .modes button[data-mode="m"]', (bs) => bs.forEach((b) => b.click()));
  await p.waitForTimeout(200);

  const leaked = await p.evaluate(async (renderedList) => {
    const src = await (await fetch("sites.html", { cache: "no-cache" })).text();
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
    const head = src.slice(0, src.indexOf("</head>"));
    const body = src.slice(src.indexOf("</head>"))
      .replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
    return {
      typed: [...ours].filter((n) => body.includes("$" + n.toLocaleString("en-US"))),
      stale: (head.match(/\$[\d.,]+\d/g) || []).filter((n) => !renderedList.includes(n)),
    };
  }, [...rendered]);
  check("no ledger figure is hand-typed into the body", leaked.typed.length === 0,
    leaked.typed.map((n) => "$" + n).join(" "));
  check("every price in the head is one the page renders", leaked.stale.length === 0,
    leaked.stale.join(" "));

  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  check(`the whole page is under three phone screens (${h}px)`, h < 844 * 3.2, `${h}px`);
  check("nothing scrolls sideways", await p.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  check(`no page errors [${width}]`, errs.length === 0, errs.join(" | "));

  // ---- the long version still exists and still renders ----------------
  const errs2 = [];
  p.on("pageerror", (e) => errs2.push(String(e).slice(0, 160)));
  await p.goto(`http://127.0.0.1:${PORT}/sites-details.html`, { waitUntil: "networkidle", timeout: 25000 });
  await p.waitForTimeout(1600);
  const det = await p.evaluate(() => ({
    redraw: !!document.querySelector(".redraw"),
    activate: !!document.querySelector(".activate"),
    licence: !!document.querySelector(".licgrant"),
    disclose: !!document.querySelector(".disclose"),
    seats: document.querySelectorAll(".seat").length,
    // "time-limited share of revenue" is a TERM of the Equity agreement,
    // not a limited-time offer, and it has to stay. Only a countdown is
    // being looked for here.
    // \b0\d\b is the seat label the countdown used ("01", "02"). Written
    // loosely it matched inside the $105,000 cap figure, which is a real
    // number this page has to print.
    countdown: /seats? left|one remains|never again|\b0[1-9]\b/i.test(document.querySelector("main").innerText),
    terms: document.querySelectorAll("#stTerms li").length,
    anchor: !!document.getElementById("equity"),
  }));
  check("the details page still carries every section that was moved",
    det.redraw && det.activate && det.licence && det.disclose, JSON.stringify(det));
  check("the terms still paint", det.terms > 3, JSON.stringify(det));
  check("and the details page no longer counts anything down",
    det.seats === 0 && !det.countdown, JSON.stringify(det));
  check("#equity is a real anchor for the card's link", det.anchor);
  check("no page errors on the details page", errs2.length === 0, errs2.join(" | "));

  await ctx.close();
}

await b.close();
server.close();
console.log(fail ? `\n${fail} FAILED\n` : "\nthe buy page holds\n");
process.exit(fail ? 1 : 0);
