/* The MCP client, against a server that refuses to be forgiving.
 *
 *     node --experimental-strip-types supabase/tests/mcp.test.mjs
 *
 * supabase/tests/mcp-server.mjs enforces the 2026-07-28 transport to the
 * letter — every header required, every header compared against the body,
 * base64 sentinels decoded before comparing. A client that passes here is
 * a client a real server will accept; one tested against a lenient stub
 * would only prove it agrees with itself.
 */
import {
  MCP_VERSION, buildRequest, encodeHeaderValue, paramHeaders, readResponse,
  readToolResult, screenTools, isModernError, rpc, refreshTools, toolsFor, invoke,
} from "../functions/inbox/mcp.ts";
import { startMcpServer } from "./mcp-server.mjs";
import assert from "node:assert/strict";

globalThis.Deno = { env: { get: (k) => ({ MCP_TEST_TOKEN: "s3cret" }[k]) } };

let passed = 0, failed = 0;
const ok = async (label, fn) => {
  try { await fn(); console.log("  ok    " + label); passed++; }
  catch (e) { console.error("  FAIL  " + label + "\n        " + e.message); failed++; }
};

console.log("\n-- header values --");

await ok("plain ASCII travels as itself", () => {
  assert.equal(encodeHeaderValue("us-west1"), "us-west1");
  assert.equal(encodeHeaderValue(42), "42");
  assert.equal(encodeHeaderValue(true), "true");
  assert.equal(encodeHeaderValue(false), "false");
});

await ok("anything a header cannot carry is base64 in a sentinel", () => {
  assert.equal(encodeHeaderValue("Hello, 世界"), "=?base64?SGVsbG8sIOS4lueVjA==?=");
  assert.equal(encodeHeaderValue(" padded "), "=?base64?IHBhZGRlZCA=?=");
  assert.equal(encodeHeaderValue("line1\nline2"), "=?base64?bGluZTEKbGluZTI=?=");
});

await ok("a value that merely LOOKS like a sentinel is encoded too", () => {
  // otherwise the server decodes it into something the body does not
  // contain, and rejects a mismatch that was never one
  assert.equal(encodeHeaderValue("=?base64?literal?="), "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=");
});

await ok("a non-integer number is refused rather than rounded", () => {
  assert.throws(() => encodeHeaderValue(1.5), /integer/);
});

console.log("\n-- screening a server's tool list --");

await ok("a malformed annotation excludes ONE tool, not the list", () => {
  const { usable, rejected } = screenTools([
    { name: "good", inputSchema: { type: "object", properties: { a: { type: "string", "x-mcp-header": "A" } } } },
    { name: "in_an_array", inputSchema: { type: "object", properties: {
      xs: { type: "array", items: { type: "string", "x-mcp-header": "X" } } } } },
    { name: "bad_token", inputSchema: { type: "object", properties: { q: { type: "string", "x-mcp-header": "not a token" } } } },
    { name: "a_number", inputSchema: { type: "object", properties: { n: { type: "number", "x-mcp-header": "N" } } } },
    { name: "empty_name", inputSchema: { type: "object", properties: { q: { type: "string", "x-mcp-header": "" } } } },
    { name: "twice", inputSchema: { type: "object", properties: {
      a: { type: "string", "x-mcp-header": "Dup" }, b: { type: "string", "x-mcp-header": "dup" } } } },
  ]);
  assert.deepEqual(usable.map((t) => t.name), ["good"]);
  assert.deepEqual(rejected.map((t) => t.name).sort(),
    ["a_number", "bad_token", "empty_name", "in_an_array", "twice"]);
});

await ok("a rejection says why, because somebody will ask", () => {
  const { rejected } = screenTools([
    { name: "x", inputSchema: { type: "object", properties: { q: { type: "string", "x-mcp-header": "no spaces here" } } } },
  ]);
  assert.match(rejected[0].why, /header token/);
});

await ok("nested properties are fine; a chain through oneOf is not", () => {
  const nested = screenTools([{ name: "n", inputSchema: { type: "object", properties: {
    outer: { type: "object", properties: { inner: { type: "string", "x-mcp-header": "Inner" } } } } } }]);
  assert.equal(nested.usable.length, 1);
  const composed = screenTools([{ name: "c", inputSchema: { type: "object", properties: {
    v: { oneOf: [{ type: "string", "x-mcp-header": "V" }] } } } }]);
  assert.equal(composed.usable.length, 0);
});

await ok("a tool the server listed twice is not silently the second one", () => {
  const { usable, rejected } = screenTools([{ name: "a" }, { name: "a" }]);
  assert.equal(usable.length, 1);
  assert.equal(rejected.length, 1);
});

console.log("\n-- building a request --");

await ok("every required header is present and mirrors the body", () => {
  const { headers, body } = buildRequest({ method: "tools/call", params: { name: "get_weather", arguments: {} } });
  const b = JSON.parse(body);
  assert.equal(headers["MCP-Protocol-Version"], MCP_VERSION);
  assert.equal(headers["Mcp-Method"], "tools/call");
  assert.equal(headers["Mcp-Name"], "get_weather");
  assert.equal(b.params._meta["io.modelcontextprotocol/protocolVersion"], MCP_VERSION);
  assert.match(headers.accept, /application\/json/);
  assert.match(headers.accept, /text\/event-stream/);
});

await ok("no session id is minted, and no GET stream is implied", () => {
  const { headers } = buildRequest({ method: "tools/list" });
  // 2026-07-28 removed both. Sending one marks us as an older client.
  assert.equal(headers["Mcp-Session-Id"], undefined);
  assert.equal(headers["Last-Event-ID"], undefined);
  assert.equal(headers["Mcp-Name"], undefined);   // tools/list has no name
});

await ok("a method that needs a name and has none is refused here", () => {
  assert.throws(() => buildRequest({ method: "tools/call", params: { arguments: {} } }), /needs a name/);
});

await ok("annotated parameters become headers; absent ones do not", () => {
  const schema = { type: "object", properties: {
    zone: { type: "string", "x-mcp-header": "Zone" },
    building: { type: "string", "x-mcp-header": "Building" },
    setpoint: { type: "integer" },
  } };
  assert.deepEqual(paramHeaders(schema, { zone: "sanctuary", setpoint: 68 }), { "Mcp-Param-Zone": "sanctuary" });
  assert.deepEqual(paramHeaders(schema, { zone: "sanctuary", building: null }), { "Mcp-Param-Zone": "sanctuary" });
  assert.deepEqual(paramHeaders(schema, {}), {});
});

console.log("\n-- reading a response --");

await ok("a plain JSON answer is read", () => {
  const r = readResponse("application/json", JSON.stringify({ jsonrpc: "2.0", id: 1, result: { a: 1 } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { a: 1 });
});

await ok("a stream's LAST frame is the answer, not its first", () => {
  // taking the first would hand back a progress notification as a result
  const sse = [
    ":",
    `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}`,
    "",
    `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { done: true } })}`,
    "",
  ].join("\n");
  const r = readResponse("text/event-stream", sse);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { done: true });
});

await ok("an error is an error, with its code", () => {
  const r = readResponse("application/json", JSON.stringify({ jsonrpc: "2.0", id: 1,
    error: { code: -32020, message: "Header mismatch" } }));
  assert.equal(r.ok, false);
  assert.equal(r.code, -32020);
});

await ok("a tool reporting failure is not a transport failure", () => {
  const flat = readToolResult({ content: [{ type: "text", text: "the boiler is locked out" }], isError: true });
  assert.equal(flat.isError, true);
  assert.equal(flat.text, "the boiler is locked out");
});

await ok("a modern error body is told apart from a legacy 400", () => {
  assert.equal(isModernError(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32020, message: "x" } })), true);
  assert.equal(isModernError("Bad Request"), false);
  assert.equal(isModernError(""), false);
});

console.log("\n-- against a server that checks everything --");

const { server, seen, port } = await startMcpServer({ port: 8933 });
const SERVER = {
  id: "s1", org_id: "o1", name: "the building",
  url: `http://127.0.0.1:${port}/mcp`,
  auth_kind: "bearer", auth_header: null, token_env: "MCP_TEST_TOKEN", secret_id: null,
  protocol_version: MCP_VERSION, tools_ttl_s: 300, tools_refreshed_at: null,
};
const noDb = async () => [];

await ok("tools/list is accepted, headers and all", async () => {
  const r = await rpc(noDb, SERVER, { method: "tools/list" });
  assert.equal(r.ok, true, r.ok ? "" : r.message);
  assert.equal(r.result.tools.length, 6);
});

await ok("the credential is sent, and comes from the env, not the row", async () => {
  const last = seen[seen.length - 1];
  assert.equal(last.headers.authorization, "Bearer s3cret");
});

await ok("a call with a mirrored parameter is accepted", async () => {
  const tool = { input_schema: { type: "object", properties: {
    zone: { type: "string", "x-mcp-header": "Zone" }, setpoint: { type: "integer" } } } };
  const r = await rpc(noDb, SERVER,
    { method: "tools/call", params: { name: "set_thermostat", arguments: { zone: "sanctuary", setpoint: 68 } } },
    { paramHeaders: paramHeaders(tool.input_schema, { zone: "sanctuary", setpoint: 68 }) });
  assert.equal(r.ok, true, r.ok ? "" : r.message);
  assert.equal(readToolResult(r.result).text, "sanctuary set to 68F.");
});

await ok("a non-ASCII parameter survives the round trip", async () => {
  const schema = { type: "object", properties: { zone: { type: "string", "x-mcp-header": "Zone" },
                                                 setpoint: { type: "integer" } } };
  const args = { zone: "salle 世界", setpoint: 70 };
  const r = await rpc(noDb, SERVER, { method: "tools/call", params: { name: "set_thermostat", arguments: args } },
    { paramHeaders: paramHeaders(schema, args) });
  assert.equal(r.ok, true, r.ok ? "" : r.message);
  const sent = seen[seen.length - 1].headers["mcp-param-zone"];
  assert.match(sent, /^=\?base64\?/);
});

await ok("a streamed answer is read as well as a plain one", async () => {
  const r = await rpc(noDb, SERVER, { method: "tools/call", params: { name: "sanctuary_temp", arguments: {} } });
  assert.equal(r.ok, true, r.ok ? "" : r.message);
  assert.match(readToolResult(r.result).text, /58F/);
});

await ok("the server's own refusals come back as errors, not as crashes", async () => {
  const r = await rpc(noDb, SERVER, { method: "nonsense/method" });
  assert.equal(r.ok, false);
  assert.equal(r.code, -32601);
});

await ok("a header that disagrees with the body is caught by the SERVER", async () => {
  // proving the server is strict, so the passes above mean something
  const res = await fetch(SERVER.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
               "MCP-Protocol-Version": MCP_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "wrong_name" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "sanctuary_temp", arguments: {},
                _meta: { "io.modelcontextprotocol/protocolVersion": MCP_VERSION } } }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32020);
});

await ok("a missing Mcp-Param header is caught by the server too", async () => {
  const res = await fetch(SERVER.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
               "MCP-Protocol-Version": MCP_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "set_thermostat" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call",
      params: { name: "set_thermostat", arguments: { zone: "sanctuary", setpoint: 68 },
                _meta: { "io.modelcontextprotocol/protocolVersion": MCP_VERSION } } }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /mcp-param-zone is missing/i);
});

await ok("a GET is 405 — there is no stream endpoint any more", async () => {
  const res = await fetch(SERVER.url);
  assert.equal(res.status, 405);
});

await ok("a server that cannot be reached becomes a message, not a hang", async () => {
  const dead = { ...SERVER, url: "http://127.0.0.1:9/mcp" };
  const r = await rpc(noDb, dead, { method: "tools/list" }, { timeoutMs: 1500 });
  assert.equal(r.ok, false);
  assert.ok(r.message.length > 0);
});

console.log("\n-- caching the tool list --");

const rows = { mcp_tools: [], mcp_servers: [] };
const fakeDb = async (path, init) => {
  if (path === "mcp_tools" && init?.method === "POST") { rows.mcp_tools.push(...JSON.parse(init.body)); return null; }
  if (path.startsWith("mcp_servers?") && init?.method === "PATCH") { rows.mcp_servers.push(JSON.parse(init.body)); return null; }
  return [];
};

await ok("a refresh stores the usable tools and the rejected ones alike", async () => {
  const r = await refreshTools(fakeDb, SERVER);
  assert.equal(r.found, 6);
  assert.equal(r.usable, 3);
  assert.equal(r.rejected, 3);
  const stored = rows.mcp_tools;
  assert.deepEqual(stored.filter((t) => !t.rejected).map((t) => t.name).sort(),
    ["sanctuary_temp", "set_thermostat", "unlock_door"]);
  // kept WITH the reason rather than dropped
  assert.ok(stored.filter((t) => t.rejected).every((t) => t.rejected.length > 0));
});

await ok("a refresh never sets enabled, risk or auto", async () => {
  // those are decisions a person made; a refresh that reset them would
  // quietly re-arm a door every five minutes
  for (const t of rows.mcp_tools) {
    assert.equal("enabled" in t, false, t.name);
    assert.equal("risk" in t, false, t.name);
    assert.equal("auto" in t, false, t.name);
  }
});

server.close();
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
