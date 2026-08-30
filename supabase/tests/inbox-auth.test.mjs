// The back-office routes send messages AS THE OWNER and spend money doing it
// on X. "Is this the owner" therefore has to be answered by a verified token,
// not by the caller saying so. These tests drive the real handler with a
// stubbed fetch and database, and assert that it refuses.
import { strict as assert } from "node:assert";

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log("  ok  ", name); pass++; }
  catch (e) { console.log("  FAIL", name, "\n       ", e.message); fail++; }
};

// --- stand up the module with a fake Deno + fake network ------------------
const calls = [];
let authUserResponse = { ok: false, body: {} };
let memberRows = [];        // what org_members returns for this caller
let orgRows = [];           // what orgs returns when looked up by slug

globalThis.Deno = {
  env: { get: (k) => ({
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "SERVICE",
    SUPABASE_ANON_KEY: "ANON",
    META_APP_SECRET: "",             // no secret -> every signed hook is refused
    META_VERIFY_TOKEN: "verify-me",
  }[k]) },
  serve: (h) => { globalThis.__handler = h; },
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, method: init.method ?? "GET", body: init.body });
  if (url.includes("/auth/v1/user")) {
    return new Response(JSON.stringify(authUserResponse.body), { status: authUserResponse.ok ? 200 : 401 });
  }
  if (url.includes("/rest/v1/org_members")) {
    return new Response(JSON.stringify(memberRows), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/rest/v1/orgs")) {
    return new Response(JSON.stringify(orgRows), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/rest/v1/")) {
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 200 });
};

await import("../functions/inbox/index.ts");
const handler = globalThis.__handler;
assert.ok(handler, "the function registered a handler");

const post = (body, headers = {}) =>
  handler(new Request("https://x/inbox", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));

// Every action that acts as the owner, spends money, or exposes what the
// bot knows and remembers about people. Adding a route to the back office
// without adding it here is how a hole gets opened quietly, so the list is
// spelled out rather than derived.
for (const action of [
  "channels", "set_channel", "followers", "outbound", "send",
  "kb_put", "kb_list", "kb_drop", "kb_try", "ai_spend", "memory", "shared_put",
  "tools", "set_tool", "set_server", "refresh_tools", "approvals", "decide",
  "experiments", "set_experiment",
]) {
  await t(`${action} refuses a caller with no token`, async () => {
    const r = await post({ action });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /staff only/);
  });
}

const ACME  = { id: "aaaaaaaa-0000-0000-0000-000000000001", slug: "acme",   name: "Acme",   enabled: true };
const SHILOH= { id: "bbbbbbbb-0000-0000-0000-000000000002", slug: "shiloh", name: "Shiloh", enabled: true };
const owner = (org) => [{ role: "owner", orgs: org }];
const staff = (org) => [{ role: "staff", orgs: org }];
const signedIn = (id, rows) => { authUserResponse = { ok: true, body: { id } }; memberRows = rows; };

await t("the service-role key is not a person and is refused", async () => {
  signedIn("u1", owner(ACME));
  const r = await post({ action: "channels" }, { authorization: "Bearer SERVICE" });
  assert.equal(r.status, 403);
});

await t("a valid token belonging to nobody's org is refused", async () => {
  signedIn("u2", []);                               // belongs to no org
  const r = await post({ action: "channels" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 403);
});

await t("a member of one org is let through without naming it", async () => {
  signedIn("u1", owner(ACME));
  const r = await post({ action: "channels" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok("channels" in j);
  assert.equal(j.org.slug, "acme");
});

await t("a member of two orgs must say which, rather than be guessed at", async () => {
  // guessing is how somebody sends a message from the wrong company
  signedIn("u1", [...owner(ACME), ...staff(SHILOH)]);
  const r = await post({ action: "channels" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.match(j.error, /which org/);
  assert.deepEqual(j.orgs.map((o) => o.slug), ["acme", "shiloh"]);
});

await t("naming an org you do not belong to is refused", async () => {
  signedIn("u1", owner(ACME));
  const r = await post({ action: "channels", org: "shiloh" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 403);
});

await t("naming one you do belong to works", async () => {
  signedIn("u1", [...owner(ACME), ...staff(SHILOH)]);
  const r = await post({ action: "channels", org: "shiloh" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).org.slug, "shiloh");
});

await t("a disabled org is not an org you can act for", async () => {
  signedIn("u1", [{ role: "owner", orgs: { ...ACME, enabled: false } }]);
  const r = await post({ action: "channels" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 403);
});

await t("staff may read; only an owner may spend, send or authorise", async () => {
  signedIn("u3", staff(ACME));
  for (const action of ["set_channel", "send", "followers", "kb_put", "kb_drop", "shared_put", "poll",
                        "set_server", "set_tool", "set_experiment"]) {
    const r = await post({ action, channel: "site", title: "x", body: "y", key: "k", value: "v",
                           target_id: "1", text: "hi", id: "00000000-0000-0000-0000-000000000000" },
                         { authorization: "Bearer real-jwt" });
    assert.equal(r.status, 403, action);
    assert.match((await r.json()).error, /owner/, action);
  }
  // ...and the reading routes still work for them
  for (const action of ["channels", "kb_list", "outbound", "tools", "approvals", "experiments"]) {
    const r = await post({ action }, { authorization: "Bearer real-jwt" });
    assert.equal(r.status, 200, action);
  }
});

await t("a token is never accepted in a channel update, under any name", async () => {
  signedIn("u1", owner(ACME));
  for (const field of ["token", "access_token", "secret", "password", "api_key"]) {
    const r = await post({ action: "set_channel", channel: "site", [field]: "sk-live-whatever" },
                         { authorization: "Bearer real-jwt" });
    assert.equal(r.status, 400, field);
    assert.match((await r.json()).error, /Vault|function secret/, field);
  }
});

await t("nor in an MCP server, which reaches somebody's building", async () => {
  signedIn("u1", owner(ACME));
  for (const field of ["token", "secret", "password", "api_key"]) {
    const r = await post({ action: "set_server", name: "b", url: "https://x/mcp", [field]: "sk-live" },
                         { authorization: "Bearer real-jwt" });
    assert.equal(r.status, 400, field);
  }
});

await t("a tool may not be armed into a class that can change things", async () => {
  // the schema refuses auto on anything but read; this refuses the pair
  // before it gets there, and disarms rather than erroring
  signedIn("u1", owner(ACME));
  const r = await post({ action: "set_tool", id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                         risk: "act", auto: true }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 200);
  const sent = calls.filter((c) => c.url.includes("mcp_tools") && c.method === "PATCH").pop();
  assert.ok(sent, "it patched something");
  assert.equal(JSON.parse(sent.body).auto, false);
});

await t("an experiment with one arm, or a dead arm, is refused", async () => {
  signedIn("u1", owner(ACME));
  const one = await post({ action: "set_experiment", key: "k", dimension: "voice",
                           arms: [{ name: "only", weight: 100 }] }, { authorization: "Bearer real-jwt" });
  assert.equal(one.status, 400);
  assert.match((await one.json()).error, /two arms/);

  // an arm that never runs is the shape of every experiment that ever
  // "proved" something
  const dead = await post({ action: "set_experiment", key: "k", dimension: "voice",
                            arms: [{ name: "a", weight: 100 }, { name: "b", weight: 0 }] },
                          { authorization: "Bearer real-jwt" });
  assert.equal(dead.status, 400);
  assert.match((await dead.json()).error, /never runs is not a control/);
});

await t("an unknown risk class is refused rather than stored", async () => {
  signedIn("u1", owner(ACME));
  const r = await post({ action: "set_tool", id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", risk: "whatever" },
                       { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 400);
});

await t("the knowledge base is not readable by a stranger", async () => {
  authUserResponse = { ok: false, body: {} };
  memberRows = [];
  for (const action of ["kb_list", "kb_try", "memory", "ai_spend"]) {
    const r = await post({ action, q: "prices", contact_id: "00000000-0000-0000-0000-000000000000" });
    assert.equal(r.status, 403, `${action} leaked`);
  }
});

await t("the knowledge base is not writable by a stranger", async () => {
  authUserResponse = { ok: false, body: {} };
  memberRows = [];
  const r = await post({ action: "kb_put", title: "Fake policy", body: "Everything is free." });
  assert.equal(r.status, 403);
});

await t("a bad contact id is refused before it reaches the database", async () => {
  signedIn("u1", owner(ACME));
  const r = await post({ action: "memory", contact_id: "1; drop table x" }, { authorization: "Bearer real-jwt" });
  assert.equal(r.status, 400);
});

await t("an unsigned Meta webhook is dropped, not ingested", async () => {
  const r = await handler(new Request("https://x/inbox", {
    method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
    body: JSON.stringify({ object: "instagram", entry: [] }),
  }));
  assert.equal(r.status, 401);
});

await t("the verify handshake needs the right token", async () => {
  const bad = await handler(new Request("https://x/inbox?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"));
  assert.equal(bad.status, 403);
  const good = await handler(new Request("https://x/inbox?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123"));
  assert.equal(good.status, 200);
  assert.equal(await good.text(), "123");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
