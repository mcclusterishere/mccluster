/* THE BACK OFFICE, DRIVEN.
 *
 * scripts/smoke.mjs proves a stranger sees the door. This proves the room
 * behind it works — which is the half with four hundred lines in it.
 *
 * Every outside call is stubbed at the NETWORK layer rather than by
 * patching the page, so what runs is the real fetch, the real JSON
 * handling and the real rendering. The stub bodies below are the shapes
 * the edge function actually returns; when one of them drifts, this is
 * where it shows.
 *
 *     node scripts/inbox-desk-smoke.mjs
 *
 * Serves the repo itself, so nothing needs to be running first. Set
 * PW_MODULE and PW_CHROME the way scripts/smoke.mjs takes them when
 * playwright is not resolvable from here.
 */
import { createRequire } from "module";
import http from "http";
import { readFile } from "fs/promises";
import { extname, join, normalize } from "path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || "playwright");

const PORT = 8932;
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/])+/, "");
  try {
    const body = await readFile(join(ROOT, p === "/" ? "index.html" : p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));


// a JWT that is only shaped like one: exp far out, sub set. backend.js reads
// the payload for uid() and exp, and never verifies — the server does that.
const payload = Buffer.from(JSON.stringify({
  sub: "11111111-1111-1111-1111-111111111111", email: "staff@example.org",
  exp: Math.floor(Date.now() / 1000) + 86400,
})).toString("base64url");
const JWT = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;

const ORG = { id: "cccccccc-0000-0000-0000-000000000003", slug: "mccluster", name: "McCluster", role: "owner" };

const FN = {
  channels: { org: ORG, channels: [
    { key: "site", label: "The website", enabled: true, can_reply_comments: false, can_send_dm: true,
      dm_window_hours: null, note: "Needs nobody's permission.", credential: null, token_present: false },
    { key: "telegram", label: "Telegram", enabled: false, can_reply_comments: true, can_send_dm: true,
      dm_window_hours: null, note: "Works this afternoon.",
      credential: { token_env: "TELEGRAM_TOKEN", last_error: null }, token_present: true },
    { key: "instagram", label: "Instagram", enabled: false, can_reply_comments: true, can_send_dm: true,
      dm_window_hours: 24, note: "Needs app review.",
      credential: { token_env: "META_PAGE_TOKEN", last_error: "OAuthException: token expired" }, token_present: false },
    { key: "bluesky", label: "Bluesky", enabled: false, can_reply_comments: false, can_send_dm: true,
      dm_window_hours: null, note: "Nothing pushes.",
      credential: { token_env: "BSKY_APP_PASSWORD", last_error: null }, token_present: false },
  ] },
  kb_list: { documents: [
    { id: "d1", kind: "page", title: "McCluster Sites", url: "https://example.org/sites/",
      chunks: 4, embedded: 4, updated_at: new Date(Date.now() - 7200e3).toISOString() },
    { id: "d2", kind: "page", title: "I AM HERE", url: null,
      chunks: 3, embedded: 0, updated_at: new Date(Date.now() - 86400e3).toISOString() },
  ] },
  kb_try: { hits: [
    { title: "McCluster Sites — Pricing", url: null, score: 0.032, fts_rank: 1, vec_rank: 1,
      body: "A five page site is 2,500 dollars. Anything bigger is quoted." },
    { title: "I AM HERE", url: null, score: 0.016, fts_rank: null, vec_rank: 2, body: "Out now everywhere." },
  ] },
  ai_spend: {
    day: { cost_micros: 1_640_000, calls: 38, failures: 1 },
    budget_micros: 2_000_000, spent_micros: 1_640_000,
    recent: [
      { purpose: "answer", model: "claude-opus-5", cost_micros: 41200, latency_ms: 2300, ok: true, at: new Date().toISOString() },
      { purpose: "extract", model: "claude-haiku-4-5", cost_micros: 900, latency_ms: 600, ok: true, at: new Date().toISOString() },
      { purpose: "embed", model: "voyage-4", cost_micros: 12, latency_ms: 180, ok: false, error: "voyage 429: rate limited", at: new Date().toISOString() },
    ],
  },
  tools: {
    servers: [
      { id: "sv1", name: "the church building", url: "https://shiloh.invalid/mcp", enabled: true,
        auth_kind: "bearer", token_env: "SHILOH_MCP", secret_id: null, token_present: true,
        tools_refreshed_at: new Date(Date.now() - 120e3).toISOString(), last_error: null },
      { id: "sv2", name: "the booking system", url: "https://book.invalid/mcp", enabled: false,
        auth_kind: "bearer", token_env: "BOOK_MCP", secret_id: null, token_present: false,
        tools_refreshed_at: null, last_error: "connect ECONNREFUSED" },
    ],
    tools: [
      { id: "t1", server_id: "sv1", name: "sanctuary_temp", description: "What it is reading now.",
        enabled: true, risk: "read", auto: true, rejected: null },
      { id: "t2", server_id: "sv1", name: "set_thermostat", description: "Change a setpoint.",
        enabled: true, risk: "write", auto: false, rejected: null },
      { id: "t3", server_id: "sv1", name: "unlock_door", description: "Opens a door.",
        enabled: false, risk: "act", auto: false, rejected: null },
      { id: "t4", server_id: "sv1", name: "broken_header", enabled: false, risk: "act", auto: false,
        rejected: 'x-mcp-header "not a token" is not a valid header token' },
    ],
  },
  approvals: { approvals: [
    { id: "ap1", tool: "unlock_door", reason: "somebody is locked out of the west door",
      arguments: { door: "west" }, created_at: new Date(Date.now() - 60e3).toISOString(),
      expires_at: new Date(Date.now() + 3000e3).toISOString() },
  ] },
  outbound: { outbound: [
    { channel: "instagram", state: "refused", costs_money: false, body: "Thanks for the follow!",
      refusal: "the 24h window on instagram closed 6h ago.", created_at: new Date().toISOString() },
    { channel: "site", state: "sent", costs_money: false, body: "A five page site is 2,500 dollars.",
      created_at: new Date().toISOString() },
    { channel: "x", state: "queued", costs_money: true, body: "thank you for following",
      created_at: new Date().toISOString() },
  ] },
};

const CONVS = [
  { id: "c1", channel: "site", kind: "dm", claimed_by: null, subject_ref: null,
    last_at: new Date(Date.now() - 300e3).toISOString(), started_at: new Date(Date.now() - 900e3).toISOString(),
    inbox_contacts: { display_name: "Visitor 4f2a", handle: null, external_id: "v-4f2a" } },
  { id: "c2", channel: "instagram", kind: "comment", claimed_by: "11111111-1111-1111-1111-111111111111",
    subject_ref: "post_88", last_at: new Date(Date.now() - 4000e3).toISOString(),
    started_at: new Date(Date.now() - 5000e3).toISOString(),
    inbox_contacts: { display_name: "someone", handle: "someone", external_id: "9988" } },
];
const MSGS = [
  { direction: "in", body: "how much for a website?", at: new Date(Date.now() - 600e3).toISOString(),
    state: "delivered", error: null, meta: null, external_id: "m1" },
  { direction: "out", body: "A five page site is 2,500 dollars — anything bigger we quote.",
    at: new Date(Date.now() - 590e3).toISOString(), state: "sent", error: null,
    meta: { source: "ai", call: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, external_id: null },
  { direction: "in", body: "and how long?", at: new Date(Date.now() - 300e3).toISOString(),
    state: "delivered", error: null, meta: null, external_id: "m2" },
];

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
let fail = 0;
const check = (name, ok, extra) => { console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || !extra ? "" : "\n        " + extra)); if (!ok) fail++; };

for (const width of [390, 1280]) {
  console.log(`\n[viewport ${width}px]`);
  const ctx = await b.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  // Resource errors are not page errors. Sealing the page makes backend.js's
  // own imprint pull 503, which is the seal working, not the page breaking —
  // scripts/smoke.mjs listens on pageerror alone for exactly this reason.

  await p.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${PORT}`)) return r.continue();
    if (u.includes("/functions/v1/inbox")) {
      const body = JSON.parse(r.request().postData() || "{}");
      const out = FN[body.action] ?? { ok: true };
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
    }
    // the desk narrows its own reads to the org it is looking at
    if (u.includes("/rest/v1/inbox_conversations") && !u.includes(`org_id=eq.${ORG.id}`) && !u.includes("id=eq.")) {
      return r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"unscoped read"}' });
    }
    if (u.includes("/rest/v1/inbox_conversations?id=eq.")) {
      const id = decodeURIComponent(u.split("id=eq.")[1].split("&")[0]);
      return r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(CONVS.filter((c) => c.id === id)) });
    }
    if (u.includes("/rest/v1/inbox_conversations")) {
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONVS) });
    }
    if (u.includes("/rest/v1/inbox_messages")) {
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MSGS) });
    }
    return r.fulfill({ status: 503, body: "sealed" });
  });

  await p.addInitScript((jwt) => {
    localStorage.setItem("mccdb_session", JSON.stringify({ access_token: jwt, refresh_token: "r" }));
  }, JWT);

  await p.goto(`http://127.0.0.1:${PORT}/inbox.html`, { waitUntil: "networkidle", timeout: 20000 });
  await p.waitForTimeout(900);

  check("signed in, the rooms appear instead of the door", await p.evaluate(() =>
    !!document.querySelector(".rooms") && !document.querySelector(".gate")));
  check("one org means no picker to get in the way", await p.evaluate(() =>
    document.querySelectorAll("[data-org]").length === 0));

  check("threads: both conversations are listed", await p.evaluate(() =>
    document.querySelectorAll("[data-open]").length === 2));
  check("threads: a claimed thread says so", await p.evaluate(() =>
    /yours/.test(document.body.textContent)));

  await p.click("[data-open='c1']");
  await p.waitForTimeout(400);
  check("a thread opens and shows both sides", await p.evaluate(() =>
    document.querySelectorAll(".msg.in").length === 2 && document.querySelectorAll(".msg.out").length === 1));
  check("an answer written by the model says so", await p.evaluate(() =>
    /answered by the model/.test(document.body.textContent)));
  check("and can be marked wrong, on the call rather than the thread", await p.evaluate(() =>
    document.querySelectorAll("[data-ev]").length === 2 &&
    document.querySelector("[data-ev='-1']").getAttribute("data-call") === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
  await p.click("[data-ev='-1']");
  await p.waitForTimeout(300);
  check("marking it wrong is confirmed, not silent", await p.evaluate(() =>
    /Noted/.test(document.body.textContent)));
  await p.click("[data-back]");
  await p.waitForTimeout(300);

  for (const room of ["channels", "tools", "knowledge", "spend", "queue"]) {
    await p.click(`[data-room='${room}']`);
    await p.waitForTimeout(500);
    check(`${room}: draws`, await p.evaluate(() => document.querySelectorAll(".card, .empty").length > 0));
  }

  await p.click("[data-room='channels']"); await p.waitForTimeout(400);
  check("channels: a missing token is visible, not silent", await p.evaluate(() =>
    /META_PAGE_TOKEN missing/.test(document.body.textContent)));
  check("channels: a dead credential shows its error", await p.evaluate(() =>
    /token expired/.test(document.body.textContent)));
  check("channels: bluesky offers the poll, because nothing pushes", await p.evaluate(() =>
    !!document.getElementById("pollBsky")));

  await p.click("[data-room='tools']"); await p.waitForTimeout(600);
  check("tools: what is waiting on a person is at the top", await p.evaluate(() =>
    /Waiting on you/.test(document.body.textContent) &&
    /locked out of the west door/.test(document.body.textContent)));
  check("tools: an approval can be answered either way", await p.evaluate(() =>
    document.querySelectorAll("[data-decide]").length === 2));
  check("tools: the risk word is on every tool, in plain English", await p.evaluate(() =>
    /reads only/.test(document.body.textContent) &&
    /changes something/.test(document.body.textContent) &&
    /changes the world/.test(document.body.textContent)));
  check("tools: only a read tool offers the unattended switch", await p.evaluate(() => {
    // the database refuses the pair anyway; offering a switch that cannot
    // be flipped is worse than not offering it
    const auto = [...document.querySelectorAll("[data-field='auto']")];
    return auto.length === 1 && auto[0].getAttribute("data-tool") === "t1";
  }));
  check("tools: an unusable tool says what is wrong with it", await p.evaluate(() =>
    /unusable/.test(document.body.textContent) && /not a valid header token/.test(document.body.textContent)));
  check("tools: a machine with no credential says so", await p.evaluate(() =>
    /credential missing/.test(document.body.textContent) &&
    /ECONNREFUSED/.test(document.body.textContent)));

  await p.click("[data-room='spend']"); await p.waitForTimeout(400);
  check("spend: says the router is degraded past three quarters", await p.evaluate(() =>
    /three quarters/.test(document.body.textContent)));
  check("spend: money reads as money", await p.evaluate(() =>
    /\$1\.64/.test(document.body.textContent)));

  await p.click("[data-room='queue']"); await p.waitForTimeout(400);
  check("queue: a refusal is shown with its reason, not hidden", await p.evaluate(() =>
    /window on instagram closed/.test(document.body.textContent)));
  check("queue: a send that costs money is flagged", await p.evaluate(() =>
    /costs money/.test(document.body.textContent)));

  await p.click("[data-room='knowledge']"); await p.waitForTimeout(400);
  check("knowledge: unembedded chunks are called out", await p.evaluate(() =>
    /3 unembedded/.test(document.body.textContent)));
  await p.fill("#tryQ", "how much for a website");
  await p.click("#tryGo");
  await p.waitForTimeout(500);
  check("knowledge: the search shows keyword and meaning ranks apart", await p.evaluate(() =>
    /keyword #1/.test(document.body.textContent) && /meaning #2/.test(document.body.textContent) &&
    /no keyword match/.test(document.body.textContent)));

  // ---- somebody who works for two customers ------------------------
  // The function refuses to guess which org they meant and answers 403
  // with the list. That refusal IS the picker's data.
  await p.evaluate(() => { window.__two = true; });
  await p.route("**/functions/v1/inbox", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    if (!body.org) {
      return r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({
        error: "name which org this is for",
        orgs: [{ id: "org-a", slug: "acme", name: "Acme", role: "owner" },
               { id: "org-b", slug: "shiloh", name: "Shiloh", role: "staff" }],
      }) });
    }
    const out = FN[body.action] ?? { ok: true };
    return r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ...out, org: { id: body.org === "acme" ? "org-a" : "org-b",
                                            slug: body.org, name: body.org, role: "owner" } }) });
  });
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  check("two orgs get a picker rather than a guess", await p.evaluate(() =>
    document.querySelectorAll("[data-org]").length === 2));
  check("and the first is opened, not an error page", await p.evaluate(() =>
    !!document.querySelector(".rooms") && !document.querySelector(".gate")));
  await p.click("[data-org='shiloh']");
  await p.waitForTimeout(600);
  check("switching org switches the desk", await p.evaluate(() =>
    document.querySelector("[data-org='shiloh']").classList.contains("on")));

  check(`no page errors [${width}]`, errs.length === 0, errs.join(" | "));
  check(`no horizontal overflow [${width}]`, await p.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await ctx.close();
}
await b.close();
server.close();
console.log(fail ? `\n${fail} FAILED\n` : "\nall inbox desk checks passed\n");
process.exit(fail ? 1 : 0);
