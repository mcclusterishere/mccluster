// MCP — calling a customer's own machine.
//
// Protocol 2026-07-28, Streamable HTTP. What changed from every tutorial
// written before it, and what this file therefore does NOT do:
//
//   no initialize handshake   the transport is stateless. A tools/call
//                             is a single POST with no preamble.
//   no Mcp-Session-Id         gone. Do not mint one, do not echo one.
//   no GET stream             gone. A server that only speaks this
//                             revision answers GET with 405.
//   no Last-Event-ID          streams are not resumable.
//
// What it does instead: mirrors the routing fields into headers, so the
// customer's own load balancer can route and rate-limit on them without
// opening the body — and the server rejects any request where the header
// and the body disagree, which is the point.
//
// The pure half is at the top and imports nothing. That is where the
// bugs would be: header encoding, schema walking, SSE framing. Every one
// of them is testable without a server.

export const MCP_VERSION = "2026-07-28";
const CLIENT_INFO = { name: "mccluster-inbox", version: "1.0.0" };

// ============================================================
// HEADER VALUES
//
// HTTP field values are visible ASCII, space and tab. Anything else —
// a non-ASCII character, a newline, leading whitespace — travels in a
// base64 sentinel, and the SERVER compares the decoded value against the
// body. So this encoding is not cosmetic: getting it wrong is a 400.
// ============================================================

const SAFE_ASCII = /^[\x21-\x7E]([\x20-\x7E\t]*[\x21-\x7E])?$/;
const SENTINEL = /^=\?base64\?[\s\S]*\?=$/;

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The value of an Mcp-Name or Mcp-Param-* header.
 *
 *  A plain-ASCII value that happens to LOOK like the sentinel is encoded
 *  too — otherwise a value of literally "=?base64?x?=" would be decoded
 *  by the server into something the body does not contain, and the call
 *  would be rejected for a mismatch that is not one. */
export function encodeHeaderValue(v: string | number | boolean): string {
  let s: string;
  if (typeof v === "boolean") s = v ? "true" : "false";
  else if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("only integers may be mirrored into a header");
    s = String(v);
  } else s = v;

  if (s.length && SAFE_ASCII.test(s) && !SENTINEL.test(s)) return s;
  return `=?base64?${b64(s)}?=`;
}

// ============================================================
// x-mcp-header
//
// A server may ask for specific tool parameters to be copied into
// headers. Supporting it is not optional for a client, and the
// constraints are strict enough that a malformed annotation makes the
// whole tool unusable — which the spec says to handle by EXCLUDING that
// tool, not by failing the list. One bad definition must not take the
// other thirty-nine down with it.
// ============================================================

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;   // RFC 9110 field-name token

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[];
                "x-mcp-header"?: unknown; [k: string]: unknown };

/** Collect every annotated property, by the exact path the spec allows:
 *  a chain of `properties` keys and nothing else. Not through `items`,
 *  not through oneOf/anyOf/allOf/not, not through if/then/else, not
 *  through $ref — an annotation anywhere else invalidates the tool. */
function walkAnnotations(
  schema: Schema | undefined,
  path: string[] = [],
  out: { path: string[]; header: string; type: string }[] = [],
  bad: string[] = [],
  reachable = true,
): { found: typeof out; bad: string[] } {
  if (!schema || typeof schema !== "object") return { found: out, bad };

  const ann = schema["x-mcp-header"];
  if (ann !== undefined) {
    if (!reachable) bad.push(`x-mcp-header at ${path.join(".") || "(root)"} is not statically reachable`);
    else if (typeof ann !== "string" || !ann) bad.push(`x-mcp-header at ${path.join(".")} is empty or not a string`);
    else if (!TOKEN.test(ann)) bad.push(`x-mcp-header "${ann}" is not a valid header token`);
    else if (!["string", "integer", "boolean"].includes(String(schema.type)))
      bad.push(`x-mcp-header "${ann}" is on a ${schema.type ?? "typeless"} property; only string, integer and boolean may be mirrored`);
    else out.push({ path, header: ann, type: String(schema.type) });
  }

  // Only `properties` continues a reachable chain. Everything else is
  // walked purely to find annotations hiding where they are not allowed.
  for (const [k, v] of Object.entries(schema.properties ?? {})) {
    walkAnnotations(v as Schema, [...path, k], out, bad, reachable);
  }
  for (const key of ["items", "oneOf", "anyOf", "allOf", "not", "if", "then", "else"]) {
    const v = (schema as Record<string, unknown>)[key];
    for (const sub of Array.isArray(v) ? v : v ? [v] : []) {
      walkAnnotations(sub as Schema, [...path, key], out, bad, false);
    }
  }
  return { found: out, bad };
}

export type ToolDef = { name: string; title?: string; description?: string; inputSchema?: Schema };

/** Split a server's tool list into what may be used and what may not.
 *
 *  A rejected tool is REPORTED rather than dropped: "why can't it see
 *  the tool" is a question somebody will ask, and "there is a typo in
 *  your x-mcp-header" is a much better answer than silence. */
export function screenTools(tools: ToolDef[]): {
  usable: ToolDef[];
  rejected: { name: string; why: string }[];
} {
  const usable: ToolDef[] = [];
  const rejected: { name: string; why: string }[] = [];
  const seen = new Set<string>();

  for (const t of tools ?? []) {
    if (!t?.name || typeof t.name !== "string") {
      rejected.push({ name: String(t?.name ?? "(unnamed)"), why: "a tool with no name" });
      continue;
    }
    const { found, bad } = walkAnnotations(t.inputSchema, [], [], []);
    const lower = new Set<string>();
    for (const f of found) {
      const k = f.header.toLowerCase();
      if (lower.has(k)) bad.push(`x-mcp-header "${f.header}" is used twice`);
      lower.add(k);
    }
    if (bad.length) { rejected.push({ name: t.name, why: bad.join("; ") }); continue; }
    if (seen.has(t.name)) { rejected.push({ name: t.name, why: "the server listed this name twice" }); continue; }
    seen.add(t.name);
    usable.push(t);
  }
  return { usable, rejected };
}

/** The Mcp-Param-* headers a call to this tool must carry.
 *
 *  Omitted where the argument is absent or null — the server is required
 *  to not expect the header then, and sending one anyway is a mismatch. */
export function paramHeaders(schema: Schema | undefined, args: Record<string, unknown>): Record<string, string> {
  const { found } = walkAnnotations(schema, [], [], []);
  const out: Record<string, string> = {};
  for (const f of found) {
    let v: unknown = args;
    for (const step of f.path) {
      if (v == null || typeof v !== "object") { v = undefined; break; }
      v = (v as Record<string, unknown>)[step];
    }
    if (v === undefined || v === null) continue;
    out[`Mcp-Param-${f.header}`] = encodeHeaderValue(v as string | number | boolean);
  }
  return out;
}

// ============================================================
// THE REQUEST
// ============================================================

export type Rpc = { method: string; params?: Record<string, unknown>; id?: number };

/** Build one JSON-RPC POST, headers and body together.
 *
 *  They are built together on purpose. The server compares them and
 *  rejects any disagreement with -32020, so the only safe way to produce
 *  them is from one source at one moment. */
export function buildRequest(rpc: Rpc, extraParamHeaders: Record<string, string> = {}): {
  headers: Record<string, string>;
  body: string;
} {
  const params: Record<string, unknown> = {
    ...(rpc.params ?? {}),
    _meta: {
      "io.modelcontextprotocol/protocolVersion": MCP_VERSION,
      "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
      "io.modelcontextprotocol/clientCapabilities": {},
      ...((rpc.params?._meta as Record<string, unknown>) ?? {}),
    },
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    // both, and in this order: the server chooses which to answer with
    "accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_VERSION,
    "Mcp-Method": rpc.method,
    ...extraParamHeaders,
  };

  // Mcp-Name mirrors params.name or params.uri, for the three methods
  // that have one. It is required for those and forbidden for the rest.
  const name = params.name ?? params.uri;
  if (["tools/call", "resources/read", "prompts/get"].includes(rpc.method)) {
    if (typeof name !== "string" || !name) throw new Error(`${rpc.method} needs a name`);
    headers["Mcp-Name"] = encodeHeaderValue(name);
  }

  return {
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? 1, method: rpc.method, params }),
  };
}

// ============================================================
// THE RESPONSE
// ============================================================

export type RpcResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: number; message: string };

/** Read the JSON-RPC response out of either shape the server may answer
 *  with. An SSE stream carries progress notifications first and the
 *  response last, so the LAST data frame that has an id is the answer —
 *  taking the first would return a progress update as a result. */
export function readResponse(contentType: string, text: string): RpcResult {
  let msg: Record<string, unknown> | null = null;

  if (/text\/event-stream/i.test(contentType)) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;      // ":" alone is a keep-alive
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j && (j.result !== undefined || j.error !== undefined)) msg = j;
      } catch { /* a frame we cannot read is not the answer */ }
    }
  } else {
    try { msg = JSON.parse(text); } catch { /* fall through */ }
  }

  if (!msg) return { ok: false, code: -32700, message: "the server sent nothing we could read" };
  if (msg.error) {
    const e = msg.error as { code?: number; message?: string };
    return { ok: false, code: Number(e?.code ?? -32603), message: String(e?.message ?? "error") };
  }
  return { ok: true, result: (msg.result ?? {}) as Record<string, unknown> };
}

/** What a tools/call result actually says, flattened to text.
 *
 *  isError on the RESULT is not a protocol error: it means the tool ran
 *  and reported a failure, which is a thing the model needs to read and
 *  act on rather than a thing to throw. */
export function readToolResult(result: Record<string, unknown>): { text: string; isError: boolean } {
  const content = Array.isArray(result.content) ? result.content : [];
  const parts: string[] = [];
  for (const c of content) {
    const b = c as { type?: string; text?: string };
    if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b?.type) parts.push(`[${b.type}]`);
  }
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  return { text: parts.join("\n").slice(0, 8000), isError: result.isError === true };
}

/** Is this 400 a modern server telling us something, or a legacy server
 *  that wants an initialize handshake?
 *
 *  The spec is explicit that these look alike and must be told apart by
 *  the body: a recognised modern JSON-RPC error means retry or correct,
 *  never fall back. Falling back on an UnsupportedProtocolVersion would
 *  downgrade a perfectly modern server for no reason. */
export function isModernError(text: string): boolean {
  try {
    const j = JSON.parse(text);
    return j?.jsonrpc === "2.0" && typeof j?.error?.code === "number";
  } catch {
    return false;
  }
}

// ============================================================
// THE CALL
// ============================================================

export type Db = (path: string, init?: RequestInit) => Promise<any>;

export type Server = {
  id: string;
  org_id: string;
  name: string;
  url: string;
  auth_kind: "none" | "bearer" | "header";
  auth_header: string | null;
  token_env: string | null;
  secret_id: string | null;
  protocol_version: string;
  tools_ttl_s: number;
  tools_refreshed_at: string | null;
};

/** Resolve the server's credential the same way a channel's is resolved:
 *  an env var for the house, a Vault secret for everybody else, and the
 *  row never holds the token itself. */
async function credentialFor(db: Db, s: Server): Promise<string | null> {
  if (s.auth_kind === "none") return null;
  if (s.token_env) return Deno.env.get(s.token_env) ?? null;
  if (s.secret_id) {
    const got = await db("rpc/vault_secret", {
      method: "POST", body: JSON.stringify({ p_id: s.secret_id }),
    }).catch(() => null);
    return typeof got === "string" ? got : (got?.secret ?? null);
  }
  return null;
}

/** One JSON-RPC round trip to one server.
 *
 *  Timed out on purpose and short. This reaches a machine in somebody's
 *  building over somebody's internet connection, and an edge function
 *  that hangs on it takes the whole reply down with it — a thermostat
 *  that will not answer must become "I could not reach it", quickly. */
export async function rpc(db: Db, s: Server, call: Rpc, opts: {
  timeoutMs?: number;
  paramHeaders?: Record<string, string>;
} = {}): Promise<RpcResult> {
  const built = buildRequest(call, opts.paramHeaders ?? {});
  const token = await credentialFor(db, s);
  const headers: Record<string, string> = { ...built.headers };
  if (token && s.auth_kind === "bearer") headers["authorization"] = `Bearer ${token}`;
  if (token && s.auth_kind === "header" && s.auth_header) headers[s.auth_header] = token;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(s.url, { method: "POST", headers, body: built.body, signal: ctl.signal });
    const text = await res.text();
    const ct = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      // A modern server uses 400 for its own errors too, so the body is
      // what tells them apart — see isModernError. We do not fall back to
      // the legacy initialize handshake here at all: this client speaks
      // one revision, and saying so plainly beats half-speaking two.
      if (isModernError(text)) return readResponse(ct, text);
      return { ok: false, code: res.status, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return readResponse(ct, text);
  } catch (e) {
    const msg = (e as Error)?.name === "AbortError"
      ? "the server did not answer in time"
      : String((e as Error)?.message ?? e).slice(0, 200);
    return { ok: false, code: -32001, message: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask a server what it can do, and remember the answer.
 *
 *  Cached against the server's own ttl, because a tool list is asked for
 *  on every message that might need one and a building's machine should
 *  not be woken up for it every time. Refresh is forced from the desk. */
export async function refreshTools(db: Db, s: Server): Promise<{ found: number; usable: number; rejected: number; error?: string }> {
  const r = await rpc(db, s, { method: "tools/list" });
  if (!r.ok) {
    await db(`mcp_servers?id=eq.${s.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_error: `${r.code}: ${r.message}`.slice(0, 400), last_error_at: new Date().toISOString() }),
    }).catch(() => {});
    return { found: 0, usable: 0, rejected: 0, error: r.message };
  }

  const tools = (r.result.tools ?? []) as ToolDef[];
  const { usable, rejected } = screenTools(tools);
  const now = new Date().toISOString();

  // Upserted, never wiped and rewritten: `enabled`, `risk` and `auto` are
  // decisions a person made about this tool, and a refresh must not undo
  // them. A tool that vanished from the server keeps its row — with its
  // approval intact — so that if it comes back it is not silently on.
  const rows = [
    ...usable.map((t) => ({
      server_id: s.id, org_id: s.org_id, name: t.name,
      title: t.title ?? null, description: t.description ?? null,
      input_schema: t.inputSchema ?? {}, rejected: null, refreshed_at: now,
    })),
    ...rejected.map((t) => ({
      server_id: s.id, org_id: s.org_id, name: t.name,
      rejected: t.why.slice(0, 400), refreshed_at: now,
    })),
  ];
  if (rows.length) {
    await db("mcp_tools", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    }).catch(() => {});
  }

  await db(`mcp_servers?id=eq.${s.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ tools_refreshed_at: now, last_ok_at: now, last_error: null }),
  }).catch(() => {});

  return { found: tools.length, usable: usable.length, rejected: rejected.length };
}

export type LiveTool = {
  id: string; server_id: string; name: string; title: string | null;
  description: string | null; input_schema: Schema; risk: "read" | "write" | "act"; auto: boolean;
};

/** Every tool this org has switched on, refreshing any server whose
 *  cached list has gone stale. */
export async function toolsFor(db: Db, orgId: string): Promise<{ tools: LiveTool[]; servers: Map<string, Server> }> {
  const servers = (await db(`mcp_servers?org_id=eq.${orgId}&enabled=is.true&select=*`).catch(() => [])) as Server[];
  const byId = new Map(servers.map((s) => [s.id, s]));

  for (const s of servers) {
    const age = s.tools_refreshed_at ? (Date.now() - new Date(s.tools_refreshed_at).getTime()) / 1000 : Infinity;
    if (age > (s.tools_ttl_s || 300)) await refreshTools(db, s).catch(() => {});
  }

  const tools = (await db(
    `mcp_tools?org_id=eq.${orgId}&enabled=is.true&rejected=is.null&select=id,server_id,name,title,description,input_schema,risk,auto`,
  ).catch(() => [])) as LiveTool[];

  return { tools: tools.filter((t) => byId.has(t.server_id)), servers: byId };
}

export type Invocation = {
  orgId: string;
  tool: LiveTool;
  server: Server;
  args: Record<string, unknown>;
  convId?: string | null;
  aiCallId?: string | null;
  authority: "auto" | "staff" | "approved";
  approvedBy?: string | null;
};

/** Run one tool and write down that it happened.
 *
 *  The row is written whether it worked or not, and it names the
 *  authority — auto, a person at the desk, or an approval somebody
 *  granted. "Why is the heating on" has to be answerable by a row, not
 *  by reading a transcript and inferring. */
export async function invoke(db: Db, inv: Invocation): Promise<{ ok: boolean; text: string }> {
  const t0 = Date.now();
  const headers = paramHeaders(inv.tool.input_schema, inv.args);
  const r = await rpc(db, inv.server, {
    method: "tools/call",
    params: { name: inv.tool.name, arguments: inv.args },
  }, { paramHeaders: headers });

  let ok = r.ok;
  let text: string;
  let result: unknown = null;

  if (!r.ok) {
    text = `${inv.tool.name} could not run: ${r.message}`;
  } else {
    const flat = readToolResult(r.result);
    result = r.result;
    // isError on the result is the tool reporting a failure, which the
    // model needs to read — not a transport problem to throw away
    ok = !flat.isError;
    text = flat.text || (ok ? "(no output)" : "the tool reported a failure with no message");
  }

  await db("mcp_calls", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      org_id: inv.orgId, server_id: inv.server.id, tool: inv.tool.name,
      arguments: inv.args, conv_id: inv.convId ?? null, ai_call_id: inv.aiCallId ?? null,
      authority: inv.authority, approved_by: inv.approvedBy ?? null,
      ok, result: result ?? null, error: ok ? null : text.slice(0, 500),
      latency_ms: Date.now() - t0,
    }),
  }).catch(() => {});

  return { ok, text };
}

/** Ask a person. Returns the approval row so the desk can show it.
 *
 *  Nothing is called here. This is the whole of what the model may do
 *  about a tool it is not allowed to run: describe what it wants and
 *  wait, or not wait, and say so. */
export async function requestApproval(db: Db, opts: {
  orgId: string; serverId: string; convId?: string | null;
  tool: string; args: Record<string, unknown>; reason: string;
}): Promise<{ id: string } | null> {
  const [row] = await db("mcp_approvals", {
    method: "POST",
    body: JSON.stringify({
      org_id: opts.orgId, server_id: opts.serverId, conv_id: opts.convId ?? null,
      tool: opts.tool, arguments: opts.args, reason: opts.reason.slice(0, 500),
    }),
  }).catch(() => [null]);
  return row ? { id: row.id } : null;
}
