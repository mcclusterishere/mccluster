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

/* A first visit to `url`, with `html` as the document: the notice block of js/live-content.js against a stand-in document
   that answers the meta query from what has been parsed, stores in memory, and never reloads unless told to. */
function firstVisit(url, html) {
  const u = new URL(url);
  const head = parsedBeforeScript(html);
  const metas = [...head.matchAll(/<meta\s+name="mcc-privacy-notice"\s+content="([^"]*)"\s*>/g)].map((m) => m[1]);
  const nodes = new Map();
  let reloads = 0;
  const element = (tag, id = "") => {
    const node = {
      tagName: tag.toUpperCase(), id, attrs: {}, listeners: {}, innerHTML: "", textContent: "", removed: false, hidden: false, disabled: false,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      click() { for (const f of this.listeners.click || []) f({ type: "click" }); }, focus() {},
      remove() { this.removed = true; for (const [k, v] of nodes) if (v === this || v.owner === this) nodes.delete(k); }
    };
    return node;
  };
  const docEl = element("html");
  const append = (n) => {
    if (n.id) nodes.set(n.id, n);
    for (const m of String(n.innerHTML || "").matchAll(/id="([^"]+)"/g)) nodes.set(m[1], Object.assign(element("button", m[1]), { owner: n }));
    return n;
  };
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  let cookie = "";
  const document = {
    readyState: "complete", documentElement: docEl,
    head: { appendChild: (n) => n }, body: { appendChild: append },
    createElement: (tag) => element(tag), getElementById: (id) => nodes.get(id) || null,
    querySelector: (sel) => (sel === 'meta[name="mcc-privacy-notice"]' && metas.length
      ? { getAttribute: (k) => (k === "content" ? metas[0] : k === "name" ? "mcc-privacy-notice" : null) } : null),
    addEventListener() {}
  };
  Object.defineProperty(document, "cookie", { get: () => cookie, set: (v) => { cookie += (cookie ? "; " : "") + String(v).split(";")[0]; } });
  const window = { localStorage: store(), sessionStorage: store(), addEventListener() {} };
  window.top = window;
  const location = { pathname: u.pathname, hostname: u.hostname, hash: u.hash, href: u.href, reload() { reloads++; } };
  vm.runInNewContext(NOTICE, {
    window, document, location, atob, JSON, Date, Promise, String, Number, Object, isNaN, Error,
    fetch: () => Promise.resolve({ ok: true }), setTimeout: () => 0, clearTimeout() {}
  });
  return {
    metas, window, get reloads() { return reloads; },
    wall: () => docEl.getAttribute("data-privacy-gate") !== null || nodes.has("mccPrivacyGate"),
    banner: () => nodes.has("mccPrivacyNotice") && !nodes.get("mccPrivacyNotice").removed,
    text: () => String((nodes.get("mccPrivacyNotice") || {}).innerHTML || ""),
    click: (id) => nodes.get(id).click()
  };
}

const DOORS = [
  ["https://matthew.mccluster.org/mnet.html", async () => WORLD],
  ["https://matthew.mccluster.org/mnet.html?mission=0e1f0000-0000-4000-8000-000000000001", async () => WORLD],
  ["https://mccluster.org/", () => served(companySiteResponse, "https://mccluster.org/")],
  ["https://humanuprise.com/", () => served(humanUpriseResponse, "https://humanuprise.com/")]
];

test("the World's head carries the banner meta once, before js/live-content.js reads it", () => {
  const head = WORLD.slice(0, WORLD.indexOf("</head>"));
  assert.equal(head.split(META).length - 1, 1, "mnet.html opts the World into the banner exactly once");
  assert.equal(WORLD.split(META).length - 1, 1, "and nowhere else in the page");
  assert.ok(parsedBeforeScript(WORLD).includes(META), "the meta comes before the script that reads it");
});

test("js/live-content.js still honours the banner meta, and analytics still wait for agreement", () => {
  assert.match(LIVE, /d\.querySelector\('meta\[name="mcc-privacy-notice"\]'\)/, "the notice reads the meta");
  assert.match(LIVE, /getAttribute\("content"\) === "banner"\) banner\(\);\s*else wall\(\);/, "banner for a page that asks for it, the wall otherwise");
  assert.match(LIVE, /function banner\(\) \{/);
  const analytics = read("js/analytics.js");
  assert.match(analytics, /if \(mccPrivacyAcknowledged\(\) && !mccControlPreview\(\)\) \{/, "nothing is recorded, no id is set and no service worker registers before agreement");
  assert.match(analytics, /\} else \{[\s\S]*window\.MCC_TRACK = function \(\) \{ return false; \};\s*\}\s*$/, "without agreement every track call is a no-op");
  assert.doesNotMatch(analytics, /MCC_PRIVACY\.seen\(\)|mcc_privacy_seen/, "seeing the banner never counts as agreeing");
});

for (const [url, html] of DOORS) {
  test(`a first visit to ${url} meets the banner and the World, never the wall`, async () => {
    const page = await html();
    const visit = firstVisit(url, page);
    assert.deepEqual(visit.metas, ["banner"], "this door's head asks for the banner before the script runs");
    assert.equal(visit.wall(), false, "no full-screen wall, and nothing hides the page");
    assert.equal(visit.banner(), true, "the notice is a bar along the bottom");
    assert.match(visit.text(), /analytics stay off until you agree/);
    assert.match(visit.text(), /id="mccPrivacyNoticeAgree">I agree &amp; continue<\/button>/);
    assert.match(visit.text(), /<a href="\/privacy\.html">Privacy Policy<\/a>/);
    assert.match(visit.text(), /id="mccPrivacyNoticeLater">Not now<\/button>/);
    assert.equal(visit.window.MCC_PRIVACY.accepted(), false, "shown is not agreed: analytics stay off");
    assert.equal(visit.window.MCC_PRIVACY.seen(), true, "shown once for this version, as the notice promises");
    assert.equal(JSON.parse(visit.window.localStorage.getItem("mcc_privacy_seen")).version, VERSION);
    assert.equal(visit.window.localStorage.getItem("mcc_privacy_ack"), null);
  });
}

test("on the World, I agree records the agreement in place (no reload); Not now records only that it was seen", () => {
  const agreed = firstVisit("https://mccluster.org/", WORLD);
  agreed.click("mccPrivacyNoticeAgree");
  assert.equal(agreed.banner(), false, "the bar goes");
  assert.equal(agreed.reloads, 0, "the World is not reloaded under the visitor; analytics begin with the next page view");
  assert.equal(agreed.window.MCC_PRIVACY.accepted(), true);
  assert.equal(JSON.parse(agreed.window.localStorage.getItem("mcc_privacy_ack")).version, VERSION);

  const later = firstVisit("https://mccluster.org/", WORLD);
  later.click("mccPrivacyNoticeLater");
  assert.equal(later.banner(), false);
  assert.equal(later.wall(), false);
  assert.equal(later.window.MCC_PRIVACY.accepted(), false, "Not now never counts as agreement");
  assert.equal(later.window.localStorage.getItem("mcc_privacy_ack"), null);
});

test("the other house pages keep the wall: the decision is the World's alone", () => {
  for (const [f, url] of [["account.html", "https://matthew.mccluster.org/account.html"], ["index.html", "https://matthew.mccluster.org/"]]) {
    const visit = firstVisit(url, read(f));
    assert.deepEqual(visit.metas, [], `${f} does not opt into the banner`);
    assert.equal(visit.wall(), true, `${f}: a first visit still meets the wall`);
  }
});
