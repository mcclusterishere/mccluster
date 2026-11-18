/* THE WORLD'S FIRST VISIT: THE PRIVACY NOTICE IS A BANNER, NOT A WALL.

   Owner, 2026-11-17 (docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, "Owner decisions (2026-11-17, answered in
   session)"): "the full-screen 'Privacy before entry' wall on the World becomes the existing banner mode
   (<meta name="mcc-privacy-notice" content="banner">), so the globe and the missions show at once. Analytics stay off until
   the visitor agrees, as before."

   This holds the decision without a browser, on the World as each of its doors serves it: mnet.html on Matthew's property,
   and the same document passed through Worker mccluster on https://mccluster.org/ (the World's door today) and
   https://humanuprise.com/ (inert until routed), each with its host's own head (workers/mccluster/src/world-host.js).
   The notice block of js/live-content.js runs in a small document stand-in that sees exactly the head a browser has parsed
   when that script runs, so a meta placed after the script would not count. The browser proof, at 390, 820 and 1280 with
   the globe and the mission posts, is scripts/e2e/world-first-visit.e2e.mjs.

   The World is the house itself, not a document page, so its bar counts only once it is answered (review LDR-F1/F2,
   2026-11-18): <meta name="mcc-privacy-notice-seen" content="answered"> beside the banner meta. A document page's bar counts
   as soon as it is shown; the World's records nothing until "I agree & continue", "Not now" or Escape, so a visitor who
   leaves without answering meets the notice again on the next page, as privacy.html#entry-notice says ("Leaving without
   answering is not an answer, so the next page asks again"). While a modal dialog is open (a shared ?mission= link opens
   one at once) the waiting bar is the last thing inside it, the one place a modal dialog leaves answerable.

   A tripwire too: js/live-content.js must keep honouring the banner meta. An open change that turns every page into the
   wall (PR #760, "Agree & continue or Go back") would put the wall back on the World; this suite fails until that change and
   this decision are reconciled. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { companySiteResponse } from "../../workers/mccluster/src/company-site/router.js";
import { humanUpriseResponse } from "../../workers/mccluster/src/human-uprise/router.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const WORLD = read("mnet.html");
const LIVE = read("js/live-content.js");
const NOTICE = LIVE.slice(0, LIVE.indexOf("/* ============================================================\n   LIVE CONTENT"));
const VERSION = /var VERSION = "([^"]+)"/.exec(LIVE)[1];
const META = '<meta name="mcc-privacy-notice" content="banner">';
const SEEN_META = '<meta name="mcc-privacy-notice-seen" content="answered">';
const SCRIPT = /<script src="[^"]*js\/live-content\.js[^"]*"><\/script>/;

/* The World as each door serves it: the upstream fetch answers with this checkout's mnet.html. */
async function served(responder, url) {
  const fetchImpl = async (req) => {
    assert.match(new URL(req.url).pathname, /^\/mnet\.html$/, "the root is the World passed through");
    return new Response(WORLD, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const res = await responder(new Request(url), {}, fetchImpl);
  assert.equal(res.status, 200, url);
  return res.text();
}

/* What a browser has parsed when js/live-content.js runs: the document up to that script tag. */
function parsedBeforeScript(html) {
  const at = html.search(SCRIPT);
  assert.ok(at > 0, "the page loads js/live-content.js");
  assert.ok(at < html.indexOf("</head>"), "in its head, so the notice decides before the body paints");
  return html.slice(0, at);
}

/* A visit to `url`, with `html` as the document: the notice block of js/live-content.js against a stand-in document that
   answers the two meta queries from what has been parsed, stores in memory (`jar`, shared between visits when given, as one
   browser keeps its storage and its cookies), and never reloads unless told to. Modal dialogs come and go through a
   MutationObserver stand-in, the way showModal() and close() set and clear the open attribute. */
function newJar() {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  return { localStorage: store(), sessionStorage: store(), cookie: "" };
}
function firstVisit(url, html, jar = newJar()) {
  const u = new URL(url);
  const head = parsedBeforeScript(html);
  const metaOf = (name) => [...head.matchAll(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"\\s*>`, "g"))].map((m) => m[1]);
  const metas = metaOf("mcc-privacy-notice"), seenMetas = metaOf("mcc-privacy-notice-seen");
  const nodes = new Map();
  let reloads = 0;
  const element = (tag, id = "") => {
    const node = {
      tagName: tag.toUpperCase(), id, attrs: {}, listeners: {}, innerHTML: "", textContent: "", removed: false, hidden: false, disabled: false, parentNode: null,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      click() { for (const f of this.listeners.click || []) f({ type: "click" }); }, focus() {},
      key(key) { let prevented = false; for (const f of this.listeners.keydown || []) f({ type: "keydown", key, preventDefault() { prevented = true; } }); return prevented; },
      remove() { this.removed = true; this.parentNode = null; for (const [k, v] of nodes) if (v === this || v.owner === this) nodes.delete(k); }
    };
    return node;
  };
  const docEl = element("html");
  const body = element("body");
  const append = (parent) => (n) => {
    n.parentNode = parent;
    if (n.id) nodes.set(n.id, n);
    for (const m of String(n.innerHTML || "").matchAll(/id="([^"]+)"/g)) if (!nodes.has(m[1])) nodes.set(m[1], Object.assign(element("button", m[1]), { owner: n }));
    return n;
  };
  body.appendChild = append(body);
  const dialogs = [];
  const document = {
    readyState: "complete", documentElement: docEl,
    head: { appendChild: (n) => n }, body,
    createElement: (tag) => element(tag), getElementById: (id) => nodes.get(id) || null,
    querySelector: (sel) => {
      const value = sel === 'meta[name="mcc-privacy-notice"]' ? metas[0] : sel === 'meta[name="mcc-privacy-notice-seen"]' ? seenMetas[0] : undefined;
      return value === undefined ? null : { getAttribute: (k) => (k === "content" ? value : null) };
    },
    querySelectorAll: (sel) => (sel === "dialog[open]" ? dialogs.filter((dlg) => dlg.open) : []),
    addEventListener() {}
  };
  Object.defineProperty(document, "cookie", { get: () => jar.cookie, set: (v) => { jar.cookie += (jar.cookie ? "; " : "") + String(v).split(";")[0]; } });
  const observers = [];
  class MutationObserver {
    constructor(fn) { this.fn = fn; this.on = false; observers.push(this); }
    observe(target, options) { this.on = true; this.options = options; }
    disconnect() { this.on = false; }
  }
  const window = { localStorage: jar.localStorage, sessionStorage: jar.sessionStorage, addEventListener() {}, MutationObserver };
  window.top = window;
  const location = { pathname: u.pathname, hostname: u.hostname, hash: u.hash, href: u.href, reload() { reloads++; } };
  vm.runInNewContext(NOTICE, {
    window, document, location, atob, JSON, Date, Promise, String, Number, Object, isNaN, Error, Array,
    fetch: () => Promise.resolve({ ok: true }), setTimeout: () => 0, clearTimeout() {}
  });
  /* showModal() and close(): the open attribute changes, and every observer watching it hears */
  const toggle = (dlg, open) => {
    dlg.open = open;
    for (const o of observers) if (o.on && o.options && (o.options.attributeFilter || []).includes("open")) o.fn([{ type: "attributes", attributeName: "open", target: dlg }]);
  };
  return {
    metas, seenMetas, window, jar, observers, docEl, get reloads() { return reloads; },
    wall: () => docEl.getAttribute("data-privacy-gate") !== null || nodes.has("mccPrivacyGate"),
    banner: () => nodes.has("mccPrivacyNotice") && !nodes.get("mccPrivacyNotice").removed,
    bar: () => nodes.get("mccPrivacyNotice") || null,
    body,
    text: () => String((nodes.get("mccPrivacyNotice") || {}).innerHTML || ""),
    click: (id) => nodes.get(id).click(),
    key: (id, key) => nodes.get(id).key(key),
    dialog(id) {
      const dlg = Object.assign(element("dialog", id), { open: false, isConnected: true, matches: (sel) => sel === ":modal" && dlg.open });
      dlg.appendChild = append(dlg);
      dialogs.push(dlg);
      return { node: dlg, showModal: () => toggle(dlg, true), close: () => toggle(dlg, false) };
    }
  };
}
/* what a visit left recorded: nothing at all, or "seen", or "agreed" */
const recorded = (visit) => ({
  seen: visit.jar.localStorage.getItem("mcc_privacy_seen"), seenSession: visit.jar.sessionStorage.getItem("mcc_privacy_seen"),
  ack: visit.jar.localStorage.getItem("mcc_privacy_ack"), cookie: visit.jar.cookie
});

const DOORS = [
  ["https://matthew.mccluster.org/mnet.html", async () => WORLD],
  ["https://matthew.mccluster.org/mnet.html?mission=0e1f0000-0000-4000-8000-000000000001", async () => WORLD],
  ["https://mccluster.org/", () => served(companySiteResponse, "https://mccluster.org/")],
  ["https://humanuprise.com/", () => served(humanUpriseResponse, "https://humanuprise.com/")]
];

test("the World's head carries the banner meta and the answered meta once each, before js/live-content.js reads them", () => {
  const head = WORLD.slice(0, WORLD.indexOf("</head>"));
  for (const [meta, what] of [[META, "the banner"], [SEEN_META, "a bar that counts only once answered"]]) {
    assert.equal(head.split(meta).length - 1, 1, `mnet.html opts the World into ${what} exactly once`);
    assert.equal(WORLD.split(meta).length - 1, 1, "and nowhere else in the page");
    assert.ok(parsedBeforeScript(WORLD).includes(meta), "the meta comes before the script that reads it");
  }
});

test("js/live-content.js still honours the banner meta, and analytics still wait for agreement", () => {
  assert.match(LIVE, /d\.querySelector\('meta\[name="mcc-privacy-notice"\]'\)/, "the notice reads the meta");
  assert.match(LIVE, /getAttribute\("content"\) === "banner"\) banner\(\);\s*else wall\(\);/, "banner for a page that asks for it, the wall otherwise");
  assert.match(LIVE, /function banner\(\) \{/);
  assert.match(LIVE, /d\.querySelector\('meta\[name="mcc-privacy-notice-seen"\]'\)/, "the bar reads whether it counts on sight or on an answer");
  assert.match(LIVE, /if \(!onAnswer\) writeSeen\(\);/, "only a document page's bar counts as soon as it is shown");
  const analytics = read("js/analytics.js");
  assert.match(analytics, /if \(mccPrivacyAcknowledged\(\) && !mccControlPreview\(\)\) \{/, "nothing is recorded, no id is set and no service worker registers before agreement");
  assert.match(analytics, /\} else \{[\s\S]*window\.MCC_TRACK = function \(\) \{ return false; \};\s*\}\s*$/, "without agreement every track call is a no-op");
  assert.doesNotMatch(analytics, /MCC_PRIVACY\.seen\(\)|mcc_privacy_seen/, "seeing the banner never counts as agreeing");
});

test("the bar never covers the shared bottom bar, and inside a modal dialog it is part of the sheet", () => {
  /* review LDR-F4: at 390 and 820 the notice covered every tab of the World's bar. Wherever js/tabbar.js has drawn the bar
     (body.has-appbar) the notice sits just above it, at every width; the browser proof measures it at 390, 820 and 1280. */
  const banner = LIVE.slice(LIVE.indexOf("  function banner() {"), LIVE.indexOf("\n  }\n", LIVE.indexOf("  function banner() {")));
  assert.match(banner, /'body\.has-appbar #mccPrivacyNotice\{bottom:calc\(var\(--appbar-h,4\.6rem\) \+ env\(safe-area-inset-bottom,0px\) \+ \.9rem\)\}'/);
  assert.match(banner, /'dialog\[open\]>#mccPrivacyNotice\{position:sticky;left:auto;right:auto;bottom:0;margin:8px;max-width:none\}'/);
  assert.doesNotMatch(banner, /max-width:\s*\d+px\)/, "min-width queries only");
  assert.match(read("js/tabbar.js"), /document\.body\.classList\.add\("has-appbar"\);/, "the bar's own script marks the body");
  assert.match(WORLD, /<script src="js\/tabbar\.js[^"]*"><\/script>/, "the World draws the bar");
  /* lifted above the bottom bar, the notice covers more of the World's feed, so while it waits the feed ends that much
     later and its last post still scrolls clear of it (the browser proof scrolls the last mission post clear at each width) */
  assert.match(read("css/mnet.css"), /html\[data-privacy-notice="waiting"\] \.mn__world-feed::after \{ content: ""; display: block; height: var\(--mcc-privacy-notice-h, 0px\); \}/);
  const waiting = firstVisit("https://mccluster.org/", WORLD);
  assert.equal(waiting.docEl.getAttribute("data-privacy-notice"), "waiting", "the World's waiting bar says so on <html>");
  waiting.click("mccPrivacyNoticeLater");
  assert.equal(waiting.docEl.getAttribute("data-privacy-notice"), null, "and lets go once it is answered");
  const press = firstVisit("https://matthew.mccluster.org/press.html", read("press.html"));
  assert.equal(press.docEl.getAttribute("data-privacy-notice"), null, "a document page's bar asks the page for nothing");
});

for (const [url, html] of DOORS) {
  test(`a first visit to ${url} meets the banner and the World, never the wall, and records nothing before an answer`, async () => {
    const page = await html();
    const visit = firstVisit(url, page);
    assert.deepEqual(visit.metas, ["banner"], "this door's head asks for the banner before the script runs");
    assert.deepEqual(visit.seenMetas, ["answered"], "and for a bar that counts only once it is answered");
    assert.equal(visit.wall(), false, "no full-screen wall, and nothing hides the page");
    assert.equal(visit.banner(), true, "the notice is a bar along the bottom");
    assert.match(visit.text(), /analytics stay off until you agree/);
    assert.match(visit.text(), /id="mccPrivacyNoticeAgree">I agree &amp; continue<\/button>/);
    assert.match(visit.text(), /<a href="\/privacy\.html">Privacy Policy<\/a>/);
    assert.match(visit.text(), /id="mccPrivacyNoticeLater">Not now<\/button>/);
    assert.equal(visit.window.MCC_PRIVACY.accepted(), false, "shown is not agreed: analytics stay off");
    assert.equal(visit.window.MCC_PRIVACY.seen(), false, "shown is not an answer: the World is not a document page");
    assert.deepEqual(recorded(visit), { seen: null, seenSession: null, ack: null, cookie: "" }, "nothing is stored before an answer, not even that it was seen");
  });
}

test("leaving the World without answering is not an answer: the next page asks again", () => {
  /* review LDR-F1/F2: the World's bar used to write "seen" as it mounted, so a visitor who left from it (a shared mission
     link's bounce) was never shown the notice again, on any page, for this version */
  const jar = newJar();
  const world = firstVisit("https://matthew.mccluster.org/mnet.html?mission=0e1f0000-0000-4000-8000-000000000001", WORLD, jar);
  assert.equal(world.banner(), true);
  const home = firstVisit("https://matthew.mccluster.org/", read("index.html"), jar);
  assert.equal(home.wall(), true, "the house's front page still asks, with its wall");
  const again = firstVisit("https://matthew.mccluster.org/mnet.html?view=feed", WORLD, jar);
  assert.equal(again.banner(), true, "and the World shows its bar again");
  assert.deepEqual(recorded(again), { seen: null, seenSession: null, ack: null, cookie: "" });
});

test("on the World, I agree records the agreement in place (no reload); Not now and Escape record only that it was seen, and either answer is kept", () => {
  const agreed = firstVisit("https://mccluster.org/", WORLD);
  agreed.click("mccPrivacyNoticeAgree");
  assert.equal(agreed.banner(), false, "the bar goes");
  assert.equal(agreed.reloads, 0, "the World is not reloaded under the visitor; analytics begin with the next page view");
  assert.equal(agreed.window.MCC_PRIVACY.accepted(), true);
  assert.equal(JSON.parse(agreed.window.localStorage.getItem("mcc_privacy_ack")).version, VERSION);

  for (const answer of [(v) => v.click("mccPrivacyNoticeLater"), (v) => v.key("mccPrivacyNotice", "Escape")]) {
    const jar = newJar();
    const later = firstVisit("https://mccluster.org/", WORLD, jar);
    answer(later);
    assert.equal(later.banner(), false);
    assert.equal(later.wall(), false);
    assert.equal(later.window.MCC_PRIVACY.accepted(), false, "Not now never counts as agreement");
    assert.equal(later.window.MCC_PRIVACY.seen(), true, "an answer is kept for this version");
    assert.equal(JSON.parse(later.jar.localStorage.getItem("mcc_privacy_seen")).version, VERSION);
    assert.equal(later.jar.localStorage.getItem("mcc_privacy_ack"), null);
    assert.ok(later.observers.every((o) => !o.on), "nothing keeps watching once the bar is answered");
    for (const [f, url] of [["index.html", "https://matthew.mccluster.org/"], ["mnet.html", "https://mccluster.org/mnet.html?view=feed"]]) {
      const next = firstVisit(url, read(f), jar);
      assert.equal(next.wall() || next.banner(), false, `${f}: an answer is not asked again`);
    }
  }
});

test("a modal dialog (a shared mission) takes the waiting bar inside it, the one place it can be answered, and gives it back", () => {
  const visit = firstVisit("https://matthew.mccluster.org/mnet.html?mission=0e1f0000-0000-4000-8000-000000000001", WORLD);
  const bar = visit.bar();
  assert.equal(bar.parentNode, visit.body, "the bar starts along the bottom of the page");
  assert.equal(visit.observers.length, 1, "the World's bar watches for modal dialogs");
  const mission = visit.dialog("mnMissionDialog"), person = visit.dialog("mnPersonDialog");
  mission.showModal();
  assert.equal(bar.parentNode, mission.node, "a modal dialog makes the page inert: the bar is the last thing inside it");
  person.showModal();
  assert.equal(bar.parentNode, person.node, "the topmost modal dialog holds it");
  person.close();
  assert.equal(bar.parentNode, mission.node, "and back down the stack");
  assert.equal(visit.key("mccPrivacyNotice", "Escape"), true, "Escape inside the dialog answers the bar and leaves the dialog open");
  assert.equal(visit.banner(), false);
  assert.equal(visit.window.MCC_PRIVACY.seen(), true);
  mission.close();
  assert.equal(bar.parentNode, null, "an answered bar does not come back when the dialog closes");

  const left = firstVisit("https://matthew.mccluster.org/mnet.html?mission=0e1f0000-0000-4000-8000-000000000001", WORLD);
  const dlg = left.dialog("mnMissionDialog");
  dlg.showModal();
  dlg.close();
  assert.equal(left.bar().parentNode, left.body, "a dialog that closes gives the bar back to the page");
  assert.equal(left.window.MCC_PRIVACY.seen(), false, "and still nothing is recorded without an answer");
});

test("a document page's bar still counts as soon as it is shown, and never moves into a dialog", () => {
  const press = firstVisit("https://matthew.mccluster.org/press.html", read("press.html"));
  assert.deepEqual(press.metas, ["banner"]);
  assert.deepEqual(press.seenMetas, [], "a document page does not wait for an answer");
  assert.equal(press.banner(), true);
  assert.equal(press.window.MCC_PRIVACY.seen(), true, "privacy.html#entry-notice: on a document page, once its bar has been shown");
  assert.equal(JSON.parse(press.jar.localStorage.getItem("mcc_privacy_seen")).version, VERSION);
  assert.equal(press.observers.length, 0, "nothing watches for dialogs on a document page");
  const lens = press.dialog("lens");
  lens.showModal();
  assert.equal(press.bar().parentNode, press.body);
});

test("the other house pages keep the wall: the decision is the World's alone", () => {
  for (const [f, url] of [["account.html", "https://matthew.mccluster.org/account.html"], ["index.html", "https://matthew.mccluster.org/"]]) {
    const visit = firstVisit(url, read(f));
    assert.deepEqual(visit.metas, [], `${f} does not opt into the banner`);
    assert.equal(visit.wall(), true, `${f}: a first visit still meets the wall`);
  }
});
