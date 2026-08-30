/* A DELIBERATELY STRICT MCP SERVER, protocol 2026-07-28.
 *
 * Testing a client against a lenient server proves nothing: every bug
 * this file exists to catch is a bug a forgiving server would forgive.
 * So this one enforces the letter of the transport spec and refuses
 * anything that does not match:
 *
 *   - MCP-Protocol-Version required, and must equal the _meta field
 *   - Mcp-Method required, and must equal the body's method
 *   - Mcp-Name required for tools/call, resources/read, prompts/get,
 *     and must equal params.name / params.uri AFTER base64 decoding
 *   - Mcp-Param-* validated against the body the same way
 *   - GET and DELETE answered 405; Mcp-Session-Id ignored, never echoed
 *   - an unknown method is 404 with -32601
 *
 * Every refusal is -32020 HeaderMismatch with 400, per the spec.
 *
 * Exported rather than run: supabase/tests/mcp.test.mjs starts it.
 */
import http from "http";

const VERSION = "2026-07-28";

const TOOLS = [
  { name: "sanctuary_temp", title: "Sanctuary temperature",
    description: "What the sanctuary is reading right now.",
    inputSchema: { type: "object", properties: {}, required: [] } },

  { name: "set_thermostat", title: "Set a thermostat",
    description: "Change a setpoint.",
    inputSchema: { type: "object", properties: {
      zone: { type: "string", description: "which zone", "x-mcp-header": "Zone" },
      setpoint: { type: "integer", description: "degrees F" },
    }, required: ["zone", "setpoint"] } },

  { name: "unlock_door", title: "Unlock a door", description: "Opens a door.",
    inputSchema: { type: "object", properties: {
      door: { type: "string", "x-mcp-header": "Door" },
    }, required: ["door"] } },

  // deliberately malformed: a conforming client must EXCLUDE this one and
  // must not let it take the others down
  { name: "broken_header", description: "annotation on an array item",
    inputSchema: { type: "object", properties: {
      rooms: { type: "array", items: { type: "string", "x-mcp-header": "Room" } },
    } } },
  { name: "broken_token", description: "not a header token",
    inputSchema: { type: "object", properties: {
      q: { type: "string", "x-mcp-header": "not a token" },
    } } },
  { name: "broken_type", description: "a number may not be mirrored",
    inputSchema: { type: "object", properties: {
      n: { type: "number", "x-mcp-header": "N" },
    } } },
];

const decode = (v) => {
  const m = /^=\?base64\?([\s\S]*)\?=$/.exec(v ?? "");
  return m ? Buffer.from(m[1], "base64").toString("utf8") : v;
};

const err = (res, status, id, code, message) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }));
};

export function startMcpServer({ port = 8933, streamFor = new Set(["sanctuary_temp"]) } = {}) {
  const seen = [];                      // every request, for the tests to inspect

  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {        // no GET stream, no DELETE session
      res.writeHead(405); res.end("method not allowed"); return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw); } catch { return err(res, 400, null, -32700, "parse error"); }
      const id = body?.id ?? null;
      const h = req.headers;
      seen.push({ headers: { ...h }, body });

      // --- the header contract, enforced exactly -----------------------
      if (!h["mcp-protocol-version"]) return err(res, 400, id, -32020, "MCP-Protocol-Version is required");
      if (h["mcp-protocol-version"] !== VERSION) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id, error: {
          code: -32020, message: "unsupported protocol version", data: { supported: [VERSION] } } }));
      }
      const metaVersion = body?.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
      if (metaVersion !== h["mcp-protocol-version"]) {
        return err(res, 400, id, -32020, "Header mismatch: MCP-Protocol-Version does not match _meta");
      }
      if (!h["mcp-method"]) return err(res, 400, id, -32020, "Mcp-Method is required");
      if (h["mcp-method"] !== body?.method) {
        return err(res, 400, id, -32020, `Header mismatch: Mcp-Method '${h["mcp-method"]}' != '${body?.method}'`);
      }
      if (!h["accept"] || !/application\/json/.test(h.accept) || !/text\/event-stream/.test(h.accept)) {
        return err(res, 400, id, -32020, "Accept must list application/json and text/event-stream");
      }

      const named = ["tools/call", "resources/read", "prompts/get"].includes(body.method);
      if (named) {
        const want = body?.params?.name ?? body?.params?.uri;
        if (!h["mcp-name"]) return err(res, 400, id, -32020, "Mcp-Name is required");
        if (decode(h["mcp-name"]) !== want) {
          return err(res, 400, id, -32020, `Header mismatch: Mcp-Name '${decode(h["mcp-name"])}' != '${want}'`);
        }
      } else if (h["mcp-name"]) {
        return err(res, 400, id, -32020, "Mcp-Name sent on a method that has no name");
      }

      // --- Mcp-Param-* both ways: present when it should be, absent when not
      if (body.method === "tools/call") {
        const tool = TOOLS.find((t) => t.name === body.params.name);
        if (!tool) return err(res, 404, id, -32602, `no such tool: ${body.params.name}`);
        const args = body.params.arguments ?? {};
        const wanted = {};
        for (const [k, p] of Object.entries(tool.inputSchema?.properties ?? {})) {
          if (typeof p["x-mcp-header"] === "string" && args[k] !== undefined && args[k] !== null) {
            wanted[`mcp-param-${p["x-mcp-header"].toLowerCase()}`] = String(args[k]);
          }
        }
        for (const [k, v] of Object.entries(wanted)) {
          if (h[k] === undefined) return err(res, 400, id, -32020, `Header mismatch: ${k} is missing`);
          if (decode(h[k]) !== v) return err(res, 400, id, -32020, `Header mismatch: ${k} is '${decode(h[k])}', body says '${v}'`);
        }
        for (const k of Object.keys(h)) {
          if (k.startsWith("mcp-param-") && wanted[k] === undefined) {
            return err(res, 400, id, -32020, `Header mismatch: ${k} sent but not in the body`);
          }
        }
      }

      // --- answer -------------------------------------------------------
      if (body.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }));
      }

      if (body.method === "tools/call") {
        const name = body.params.name;
        const args = body.params.arguments ?? {};
        const payload = name === "sanctuary_temp"
          ? { content: [{ type: "text", text: "58F, and the boiler has been off since 04:10." }] }
          : name === "set_thermostat"
            ? { content: [{ type: "text", text: `${args.zone} set to ${args.setpoint}F.` }] }
            : name === "unlock_door"
              ? { content: [{ type: "text", text: `${args.door} unlocked.` }] }
              : { content: [{ type: "text", text: "that failed" }], isError: true };

        // Half the tools answer as a stream, because the client has to
        // read BOTH shapes and take the last frame rather than the first.
        if (streamFor.has(name)) {
          res.writeHead(200, { "content-type": "text/event-stream", "x-accel-buffering": "no" });
          res.write(":\r\n");                                   // keep-alive comment
          res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress",
            params: { progress: 1, total: 2 } })}\n\n`);
          res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress",
            params: { progress: 2, total: 2 } })}\n\n`);
          res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result: payload })}\n\n`);
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id, result: payload }));
      }

      return err(res, 404, id, -32601, `method not found: ${body.method}`);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, seen, port, TOOLS }));
  });
}
