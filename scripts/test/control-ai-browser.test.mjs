/* Ask McCluster: image attach, the owner-only browser switch, screenshots, the action log and the
   node badge (device-node slice N2, docs/control-plane/AGENT-NODE-BROWSER.md).

   The page's own helper block (js/control-room-v2.js, between "AI ATTACHMENTS, VISION AND BROWSER
   TURNS" and "END AI ATTACHMENTS") is executed in a VM with the formatting primitives stubbed, so
   these are the rules the page runs, not a copy of them:

   (a) the image budget: at most 2 images per turn, each downscaled to 1280 px on its longest side and
       accepted only at or under 200,000 decoded bytes (the Core's cap);
   (b) the request shapes: the durable turn carries images and allow_browser only when set and only to a
       Core that declares them, and refuses rather than drops them otherwise; "Ask home AI" takes the
       messages form only when an image is attached and ai.chat declares messages[].images;
   (c) the owner-only switch: the owner role in the house workspace, with a durable turn tool that
       declares allow_browser, nothing else; the server gates independently;
   (d) the renderers: user images, assistant screenshots inside a collapsed block with the action log,
       the node badge, live steps from tool_receipts, the plain-words error copy, the readiness line;
   (e) source and stylesheet assertions: the submit shape, the attach input, min-width-only CSS with
       minmax(0, …) tracks and 16 px controls;
   (f) what the running Core declares, read from the tool list the page already holds (tools/list through
       the owner's bridge): this checkout's Core (core/src/tools/control.mjs, core/capabilities/catalog.json)
       declares images and allow_browser on the durable turn and messages[].images on ai.chat; the Core on
       OVH at build eb942248 declares none of them, and would drop the first two silently and hand an
       image to a text model (deploy-readiness review, 2026-11-18). The controls follow the declaration,
       with one honest line in place of each that is off. A tool list that could not be read is not a Core that
       declares nothing: the controls stay off and the line says the page does not know (review LDR-F3).

   Dependency-free; runs on every PR through mcp-continuity-ci.yml (node --test scripts/test/*.test.mjs).
   The browser proof is scripts/e2e/control-ai-browser.e2e.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url).pathname;
const control = readFileSync(join(ROOT, "js/control-room-v2.js"), "utf8");
const css = readFileSync(join(ROOT, "css/control-room-v2.css"), "utf8");
const START = "  /* AI ATTACHMENTS, VISION AND BROWSER TURNS";
const END = "  /* END AI ATTACHMENTS */";

function helpers() {
  const start = control.indexOf(START), end = control.indexOf(END);
  assert.ok(start >= 0 && end > start, "the helper block exists in js/control-room-v2.js");
  const block = control.slice(start, end);
  const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const c = {
    esc, ago: () => "2m", titleCase: (v) => String(v || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()),
    isHouseWorkspace: (org) => Boolean(org) && org.slug === "mccluster" && org.kind === "studio",
    Math, Number, String, Array, Object, JSON, Date, Boolean, RegExp, parseInt, parseFloat, isFinite,
  };
  vm.createContext(c);
  vm.runInContext(block, c);
  return c;
}
const h = helpers();
/* The tool list as this checkout's Core answers it (the edge passes each tool's inputSchema through untouched) ... */
const catalog = JSON.parse(readFileSync(join(ROOT, "core/capabilities/catalog.json"), "utf8"));
const { CONTROL_TOOLS } = await import(pathToFileURL(join(ROOT, "core/src/tools/control.mjs")).href);
const N2_TOOLS = [
  ...catalog.capabilities.filter((c) => ["ai.chat", "compute.task.get"].includes(c.id)).map((c) => ({ name: c.id, inputSchema: c.inputSchema })),
  ...CONTROL_TOOLS.filter((t) => ["core.resume", "core.ai.turn.submit", "core.ai.turn.get"].includes(t.name)).map(({ name, inputSchema }) => ({ name, inputSchema }))
];
/* ... and as the Core on OVH at build eb942248 answers it (that build's core/src/tools/control.mjs and
   core/capabilities/catalog.json, copied): no images and no allow_browser on the durable turn, and ai.chat's
   messages a bare array. */
const OLD_TOOLS = [
  { name: "ai.chat", inputSchema: { type: "object", properties: { prompt: { type: "string" }, messages: { type: "array" }, temperature: { type: "number" }, num_ctx: { type: "integer" }, json: { type: "boolean" } }, anyOf: [{ required: ["prompt"] }, { required: ["messages"] }] } },
  { name: "compute.task.get", inputSchema: { type: "object", required: ["org_id", "task_id"], properties: { org_id: { type: "string" }, task_id: { type: "string" } } } },
  { name: "core.ai.turn.submit", inputSchema: { type: "object", required: ["org_id", "thread_id", "message_id", "content"], properties: { org_id: { type: "string" }, thread_id: { type: "string" }, message_id: { type: "string" }, content: { type: "string", minLength: 1, maxLength: 12000 }, input_mode: { type: "string", enum: ["text", "voice"] } }, additionalProperties: false } },
  { name: "core.ai.turn.get", inputSchema: { type: "object", required: ["org_id", "turn_id"], properties: { org_id: { type: "string" }, turn_id: { type: "string" } }, additionalProperties: false } }
];
const NONE = { known: true, turnImages: false, turnBrowser: false, chatImages: false };
const UNKNOWN = { known: false, turnImages: false, turnBrowser: false, chatImages: false };
/* values made inside the VM carry that context's prototypes; compare them as plain data */
const plain = (v) => JSON.parse(JSON.stringify(v));
const JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z";

test("(a) the image is scaled to 1280 px on its longest side, proportionally, never upscaled", () => {
  assert.deepEqual(plain(h.aiImageScale(2000, 1200)), { width: 1280, height: 768 });
  assert.deepEqual(plain(h.aiImageScale(1200, 3000)), { width: 512, height: 1280 });
  assert.deepEqual(plain(h.aiImageScale(800, 600)), { width: 800, height: 600 }, "a small image keeps its size");
  assert.deepEqual(plain(h.aiImageScale(1280, 1280)), { width: 1280, height: 1280 });
  assert.deepEqual(plain(h.aiImageScale(5000, 1)), { width: 1280, height: 1 }, "never below one pixel");
  assert.equal(h.AI_IMAGE_MAX_SIDE, 1280);
  assert.equal(h.AI_IMAGE_MAX, 2, "two images per turn (the turn-submit cap)");
  assert.equal(h.AI_IMAGE_MAX_BYTES, 200000, "the Core's per-image cap");
  assert.deepEqual(plain(h.AI_IMAGE_QUALITIES), [0.6, 0.45, 0.3], "the quality ladder");
});

test("(a) the budget: two per turn, counted with what is already attached; the byte cap decides acceptance", () => {
  assert.equal(h.aiImageBudget([], 2).ok, true);
  assert.equal(h.aiImageBudget([], 1).ok, true);
  const third = h.aiImageBudget([{}], 2);
  assert.equal(third.ok, false);
  assert.match(third.reason, /2/);
  assert.equal(h.aiImageBudget([{}, {}], 1).ok, false);
  assert.equal(h.aiImageBudget([], 0).ok, false, "nothing to attach is not a budget pass");
  assert.equal(h.aiImageAccepted(200000), true);
  assert.equal(h.aiImageAccepted(200001), false);
  assert.equal(h.aiBase64Bytes("QUJD"), 3);
  assert.equal(h.aiBase64Bytes("QQ=="), 1);
  assert.equal(h.aiBase64Bytes("QUI="), 2);
  assert.equal(h.aiBase64FromDataUrl("data:image/jpeg;base64,QUJD"), "QUJD");
  assert.equal(h.aiBase64FromDataUrl("QUJD"), "QUJD", "a bare string passes through");
  assert.equal(h.aiBase64Valid(JPEG_B64), true);
  assert.equal(h.aiBase64Valid("data:image/jpeg;base64,QUJD"), false, "a data: prefix is never sent to the Core");
  assert.equal(h.aiBase64Valid("QU JD"), false, "no whitespace");
  assert.equal(h.aiBase64Valid(""), false);
});

test("(b) the durable turn carries images and allow_browser only when set and declared; Ask home AI takes the messages form only with an image ai.chat declares", () => {
  const now = h.aiCoreSupport(N2_TOOLS, true), old = h.aiCoreSupport(OLD_TOOLS, true);
  const base = { org_id: "o1", thread_id: "t1", message_id: "m1", content: "hi", input_mode: "text" };
  for (const support of [now, old]) {
    assert.deepEqual(plain(h.aiTurnSubmission(base, [], false, support)), base, "a plain turn is exactly the fields every Core knows");
  }
  const rich = h.aiTurnSubmission({ ...base, content: "look" }, [{ base64: JPEG_B64 }], true, now);
  assert.deepEqual(plain(rich.images), [JPEG_B64]);
  assert.equal(rich.allow_browser, true);
  /* never dropped in silence: a Core that does not declare a field gets a refusal before anything is sent */
  assert.throws(() => h.aiTurnSubmission({ ...base, content: "look" }, [{ base64: JPEG_B64 }], false, old), /Attach image is off/);
  assert.throws(() => h.aiTurnSubmission(base, [], true, old), /Use the browser is off/);
  assert.throws(() => h.aiTurnSubmission(base, [{ base64: JPEG_B64 }], false), /Attach image is off/, "no word from the Core is no");
  assert.throws(() => h.aiTurnSubmission(base, [{ base64: JPEG_B64 }], false, h.aiCoreSupport(N2_TOOLS, false)), /tool list has not been read, so whether it accepts images is not known/, "an unread tool list is no, said as not known");
  assert.deepEqual(plain(h.aiChatRequest("hello", [])), { prompt: "hello", temperature: 0.2 });
  assert.deepEqual(plain(h.aiChatRequest("hello", [], false)), { prompt: "hello", temperature: 0.2 });
  assert.deepEqual(plain(h.aiChatRequest("what is this", [{ base64: JPEG_B64 }], now.chatImages)), { messages: [{ role: "user", content: "what is this", images: [JPEG_B64] }], temperature: 0.2 });
  assert.throws(() => h.aiChatRequest("what is this", [{ base64: JPEG_B64 }], old.chatImages), /text model/, "an image never goes to an ai.chat that does not declare it");
  /* the page's submit uses the helper with the Core's word, and the attachments are cleared after the submit is built */
  assert.match(control, /callCoreTool\("core\.ai\.turn\.submit", aiTurnSubmission\(\{/);
  assert.match(control, /\}, attachments, allowBrowser, support\)\)\.then\(/);
  assert.match(control, /state\.aiAttachments = \[\];/);
  assert.match(control, /callCoreTool\("ai\.chat", aiChatRequest\(aiText, \[\]\)\)/, "the Command Center keeps the prompt form (it has no attach control)");
});

test("(c) the browser switch shows only for the owner of the house workspace, and only when the durable turn declares allow_browser", () => {
  const now = h.aiCoreSupport(N2_TOOLS, true), old = h.aiCoreSupport(OLD_TOOLS, true);
  const house = { id: "o1", slug: "mccluster", kind: "studio" };
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }, now), true);
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "viewer" }, org: house }, now), false, "a member never sees it");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "admin" }, org: house }, now), false, "an admin label is not ownership");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: { id: "o2", slug: "client", kind: "tenant" } }, now), false, "a client workspace's owner is not the house owner");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: null, org: house }, now), false, "no membership, no switch");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }, old), false, "a Core that does not declare allow_browser, no switch");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }, NONE), false, "a tool list without the flag, no switch");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }, UNKNOWN), false, "no tool list read, no switch");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }), false, "no word from the Core is no");
  assert.equal(h.aiBrowserOwner({ workspace: { role: "owner" }, org: house }), true, "the owner is told why it is off");
  assert.equal(h.aiBrowserOwner({ workspace: { role: "viewer" }, org: house }), false, "a member is told nothing about the owner's browser");
  /* the server gates independently: the page sends the flag, it never asserts the right */
  assert.match(control, /aiBrowserSwitchVisible\(state, support\)/);
  assert.match(control, /role="switch" aria-checked="/);
});

test("(d) the node badge names the node, its hardware mode and the measured rate; nothing without a node", () => {
  const html = h.aiNodeBadgeHtml({ metadata: { node: { route: "fabric", node_id: "node_1", node_name: "laptop-fixture", site: "owner-windows-gpu", hardware_mode: "gpu-verified", generation_tokens_per_second: 21.37, model: "qwen3-vl:8b", implementation: "qwen3-vl.8b.local" } } });
  assert.match(html, /laptop-fixture · gpu-verified · 21\.4 tok\/s/);
  assert.match(html, /class="cr-ai-node"/);
  assert.match(html, /qwen3-vl\.8b\.local/, "the implementation is in the title");
  const measured = h.aiNodeBadgeHtml({ metadata: { node: { node_name: "laptop", hardware_mode: "gpu-present-unverified", measured_generation_tokens_per_second: 18 } } });
  assert.match(measured, /laptop · gpu-present-unverified · 18 tok\/s \(measured\)/);
  const local = h.aiNodeBadgeHtml({ metadata: { node: { route: "local", node_id: null, node_name: "core-local", hardware_mode: null } } });
  assert.match(local, /core-local · local/);
  assert.equal(h.aiNodeBadgeHtml({ metadata: {} }), "");
  assert.equal(h.aiNodeBadgeHtml({}), "");
  assert.match(h.aiNodeBadgeHtml({ metadata: { node: { node_name: "<b>x</b>" } } }), /&lt;b&gt;x&lt;\/b&gt;/, "escaped");
});

test("(d) screenshots and the action log render inside one collapsed block; invalid base64 never reaches an img", () => {
  const log = Array.from({ length: 30 }, (_, i) => ({ at: "2026-11-17T22:00:00Z", task_id: "task-1", index: i, type: i % 2 ? "click" : "open", host: "fixture.test", outcome: i === 29 ? "refused" : "ok", code: i === 29 ? "BROWSER_HOST_NOT_ALLOWED" : null }));
  const message = { metadata: { browser: { enabled: true, tasks: [
    { task_id: "task-1", node_id: "node_1", ok: true, steps: [{ index: 0, type: "open", outcome: "ok" }, { index: 1, type: "read", outcome: "ok" }], page: { url: "https://fixture.test/ok", title: "Fixture" } },
    { task_id: "task-2", node_id: "node_1", ok: false, steps: [{ index: 0, type: "open", outcome: "refused", code: "BROWSER_HOST_NOT_ALLOWED" }, { index: 1, type: "read", outcome: "skipped" }], page: { url: "https://fixture.test/ok", title: "Fixture" } },
  ], screenshots: [
    { task_id: "task-1", step: 1, base64: JPEG_B64, width: 1280, height: 800, bytes: 1234 },
    { task_id: "task-2", step: 0, base64: "data:image/jpeg;base64,QUJD", width: 1280, height: 800, bytes: 3 },
    { task_id: "task-2", step: 0, base64: JPEG_B64, width: 640, height: 400, bytes: 999 },
  ], action_log: log, dropped_screenshots: 1 } } };
  const html = h.aiBrowserHtml(message);
  assert.match(html, /^<details class="cr-ai-browser">/, "collapsed by default: no open attribute");
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /<summary[^>]*>Browser: 4 steps on fixture\.test<\/summary>/);
  assert.equal((html.match(/<img /g) || []).length, 2, "the two valid screenshots render, the data: one is dropped");
  assert.equal((html.match(/src="data:image\/jpeg;base64,/g) || []).length, 2);
  assert.doesNotMatch(html, /base64,data:/);
  assert.match(html, /1280×800 · 1\.2 KB/);
  assert.equal((html.match(/<li/g) || []).length, 30, "every log entry");
  assert.match(html, /<li class="is-bad">[^<]*29[^<]*refused[^<]*BROWSER_HOST_NOT_ALLOWED/);
  assert.match(html, /1 older screenshot dropped/);
  assert.match(html, /task-2[^<]*refused/, "the refused task is named");
  assert.equal(h.aiBrowserHtml({ metadata: {} }), "");
  assert.equal(h.aiBrowserHtml({ metadata: { browser: { enabled: true, tasks: [], screenshots: [], action_log: [] } } }), "", "a browser turn that drove nothing shows nothing");
  const long = h.aiBrowserHtml({ metadata: { browser: { tasks: [{ task_id: "t", steps: [{ index: 0, type: "open", outcome: "ok" }], page: { url: "https://a.example/" } }], action_log: Array.from({ length: 150 }, (_, i) => ({ index: i, type: "scroll", host: "a.example", outcome: "ok" })) } } });
  assert.equal((long.match(/<li/g) || []).length, 100, "the log is capped at 100 lines");
  assert.match(long, /50 more entries/);
});

test("(d) user images, live steps from tool_receipts, and the plain-words error copy", () => {
  const user = h.aiUserImagesHtml({ metadata: { images: [JPEG_B64, "QU JD", JPEG_B64] } });
  assert.equal((user.match(/<img /g) || []).length, 2, "invalid base64 is skipped");
  assert.match(user, /class="cr-ai-message__images"/);
  assert.equal(h.aiUserImagesHtml({ metadata: { images: [] } }), "");
  assert.equal(h.aiUserImagesHtml({}), "");
  const steps = h.aiReceiptStepsHtml({ metadata: { tool_receipts: [
    { tool: "research_web", ok: true },
    { tool: "browser_act", ok: true, task_id: "task-1", node_id: "node_1", steps: [{ index: 0, type: "open", outcome: "ok" }, { index: 1, type: "find", outcome: "ok" }], page: { url: "https://fixture.test/ok", title: "Fixture" }, screenshots: 1 },
    { tool: "browser_act", ok: false, task_id: "task-2", steps: [{ index: 0, type: "open", outcome: "refused", code: "BROWSER_POLICY_EMPTY" }], screenshots: 0 },
  ] } });
  assert.match(steps, /class="cr-ai-steps"/);
  assert.match(steps, /browser_act · task-1 · 2 steps · fixture\.test/);
  assert.match(steps, /0 open ok/);
  assert.match(steps, /task-2 · 1 step[^<]*refused/);
  assert.match(steps, /No allowed sites yet/, "the refusal code is rendered in words");
  assert.equal(h.aiReceiptStepsHtml({ metadata: { tool_receipts: [{ tool: "research_web" }] } }), "");
  assert.equal(h.aiErrorCopy("LOCAL_AI_NO_VISION_NODE"), "No vision node is live");
  assert.equal(h.aiErrorCopy("AI_CHAT_NO_VISION_NODE"), "No vision node is live");
  assert.equal(h.aiErrorCopy("BROWSER_UNAVAILABLE"), "Browser unavailable on the node");
  assert.equal(h.aiErrorCopy("BROWSER_NOT_ALLOWED"), "Browser not allowed for this turn");
  assert.equal(h.aiErrorCopy("BROWSER_POLICY_EMPTY"), "No allowed sites yet");
  assert.equal(h.aiErrorCopy("BROWSER_OWNER_REQUIRED"), "Browser turns are owner-only");
  assert.equal(h.aiErrorCopy("SOMETHING_ELSE"), "something else", "an unknown code is still shown, in words");
  assert.equal(h.aiErrorCopy(""), "");
  const refused = h.aiErrorHtml({ metadata: { error_code: "LOCAL_AI_NO_VISION_NODE", inference: "refused" } });
  assert.match(refused, /class="cr-ai-refused"/);
  assert.match(refused, /No vision node is live/);
  assert.match(refused, /<code>LOCAL_AI_NO_VISION_NODE<\/code>/);
  assert.equal(h.aiErrorHtml({ metadata: { task_status: "done" } }), "");
});

test("(d) the readiness line is honest: unknown until a browser turn ran, then the last turn's node or its refusal", () => {
  const unknown = h.aiBrowserReadiness([]);
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.text, /unknown until the first browser turn/);
  const ready = h.aiBrowserReadiness([
    { role: "assistant", created_at: "2026-11-17T22:00:00Z", metadata: { browser: { tasks: [{ task_id: "t", node_id: "node_1" }] }, node: { node_name: "laptop-fixture" } } },
    { role: "assistant", created_at: "2026-11-17T22:05:00Z", metadata: {} },
  ]);
  assert.equal(ready.state, "ready");
  assert.match(ready.text, /ready on laptop-fixture/);
  const unavailable = h.aiBrowserReadiness([
    { role: "assistant", created_at: "2026-11-17T22:00:00Z", metadata: { browser: { tasks: [{ task_id: "t" }] }, node: { node_name: "laptop-fixture" } } },
    { role: "assistant", created_at: "2026-11-17T22:06:00Z", metadata: { error_code: "BROWSER_UNAVAILABLE", inference: "refused" } },
  ]);
  assert.equal(unavailable.state, "unavailable");
  assert.match(unavailable.text, /Browser unavailable on the node/);
  const empty = h.aiBrowserReadiness([{ role: "assistant", created_at: "2026-11-17T22:06:00Z", metadata: { error_code: "BROWSER_POLICY_EMPTY" } }]);
  assert.equal(empty.state, "unavailable");
  assert.match(empty.text, /No allowed sites yet/);
  assert.equal(h.aiBrowserReadiness([{ role: "user", metadata: { allow_browser: true } }]).state, "unknown", "a user turn alone proves nothing");
});

test("(e) the composer and the stylesheet: attach input, 44 px button, switch, min-width-only CSS, minmax tracks, 16 px controls", () => {
  assert.match(control, /id="crAiAttach" type="file" accept="image\/\*" multiple/);
  assert.match(control, /data-action="ai-attach"/);
  assert.match(control, /data-action="ai-remove-attachment"/);
  assert.match(control, /data-action="ai-browser-toggle"/);
  assert.match(control, /aiAttachments: \[\],\s*aiAllowBrowser: false,/, "the state literal carries the two keys (so an account change resets them)");
  assert.match(control, /function addAiAttachments\(/);
  assert.match(control, /canvas\.toDataURL\("image\/jpeg", AI_IMAGE_QUALITIES\[i\]\)/, "the quality ladder is what the canvas encodes with");
  assert.match(control, /Image is too large after downscaling/);
  const block = css.slice(css.indexOf("/* Ask McCluster: image attach"));
  assert.ok(block.length > 200, "the stylesheet carries the N2 block");
  assert.doesNotMatch(block, /max-width\s*:\s*\d+px\)/, "no max-width media query in the new block");
  assert.doesNotMatch(block, /@media[^{]*max-width/, "breakpoints only add");
  assert.match(block, /@media \(min-width:760px\)/);
  for (const m of block.matchAll(/grid-template-columns:([^;}]*)/g)) assert.doesNotMatch(m[1], /(?<![\w(,.])1fr/, `bare 1fr in ${m[1]}`);
  assert.match(block, /\.cr-ai-thumbs\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(0,96px\)\)/);
  assert.match(block, /\.cr-ai-attach__btn\{[^}]*min-height:44px/);
  assert.match(block, /\.cr-ai-browser summary\{[^}]*min-height:44px/);
  assert.match(block, /\.cr-ai-browser figure img\{[^}]*max-width:100%/);
  assert.equal((css.match(/@media[^{]*max-width/g) || []).length, 8, "the file's max-width allowance (mobile-rule.test.mjs) did not grow");
});

test("(f) the controls follow what the running Core declares, read from the tool list the page already holds", () => {
  assert.deepEqual(plain(h.aiCoreSupport(N2_TOOLS, true)), { known: true, turnImages: true, turnBrowser: true, chatImages: true }, "this checkout's Core declares all three");
  assert.deepEqual(plain(h.aiCoreSupport(OLD_TOOLS, true)), NONE, "the Core at eb942248 declares none of them");
  assert.deepEqual(plain(h.aiCoreSupport([], true)), NONE, "a tool list that was read and lists nothing declares nothing");
  assert.deepEqual(plain(h.aiCoreSupport([null, { name: "core.ai.turn.submit" }, { name: "ai.chat", inputSchema: "object" }, { name: "core.ai.turn.submit", inputSchema: { properties: { images: false, allow_browser: null } } }], true)), NONE, "malformed or refused fields declare nothing");
  /* browser.act is agent-only and never listed over MCP; were it listed, it still would not be the durable turn's word */
  assert.equal(h.aiCoreSupport([...OLD_TOOLS, { name: "browser.act", inputSchema: { type: "object" } }], true).turnBrowser, false);
  /* each field stands on its own */
  const imagesOnly = OLD_TOOLS.map((t) => (t.name !== "core.ai.turn.submit" ? t : { ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, images: { type: "array" } } } }));
  assert.deepEqual(plain(h.aiCoreSupport(imagesOnly, true)), { known: true, turnImages: true, turnBrowser: false, chatImages: false });
  /* one honest line in place of each control that is off, saying why */
  assert.equal(h.AI_CAPABILITY_OFF.images, "Attach image is off: the Core running now does not accept images in a turn.");
  assert.equal(h.AI_CAPABILITY_OFF.browser, "Use the browser is off: the Core running now does not honour browser turns.");
  const old = h.aiCoreSupport(OLD_TOOLS, true);
  const images = h.aiCapabilityLine("images", old), browser = h.aiCapabilityLine("browser", old);
  assert.match(images, /^<p class="cr-ai-capability" data-ai-capability="images" data-ai-capability-basis="declared" title="Its tool list declares no images field[^"]*">Attach image is off: the Core running now does not accept images in a turn\.<\/p>$/);
  assert.match(browser, /^<p class="cr-ai-capability" data-ai-capability="browser" data-ai-capability-basis="declared" title="Its tool list declares no allow_browser field[^"]*">Use the browser is off: the Core running now does not honour browser turns\.<\/p>$/);
});

test("(f) a tool list that could not be read is not a Core that refuses: the controls stay off and the line says it is not known", () => {
  /* review LDR-F3: tools/list answering 503 left the page saying the Core "does not accept images" next to its own banner
     saying the source did not respond. Not read (refused, unreachable, signed out, nothing read yet) is not declared. */
  for (const tools of [N2_TOOLS, OLD_TOOLS, [], null]) {
    for (const listed of [false, undefined, null, "true"]) assert.deepEqual(plain(h.aiCoreSupport(tools, listed)), UNKNOWN, `listed ${String(listed)}: nothing is known, whatever list is in hand`);
  }
  const unknown = h.aiCoreSupport(null, false);
  assert.equal(h.aiCapabilityOff("images", unknown), "Attach image is off: the Core's tool list has not been read, so whether it accepts images is not known.");
  assert.equal(h.aiCapabilityOff("browser", unknown), "Use the browser is off: the Core's tool list has not been read, so whether it honours browser turns is not known.");
  assert.equal(h.aiCapabilityOff("images", undefined), h.AI_CAPABILITY_UNKNOWN.images, "no word at all is not known either");
  const images = h.aiCapabilityLine("images", unknown), browser = h.aiCapabilityLine("browser", unknown);
  assert.match(images, /^<p class="cr-ai-capability" data-ai-capability="images" data-ai-capability-basis="unknown" title="Attach comes back once the Core's tool list is read and declares an images field on core\.ai\.turn\.submit\.">Attach image is off: the Core's tool list has not been read, so whether it accepts images is not known\.<\/p>$/);
  assert.match(browser, /^<p class="cr-ai-capability" data-ai-capability="browser" data-ai-capability-basis="unknown" title="The switch comes back once the Core's tool list is read and declares an allow_browser field on core\.ai\.turn\.submit\.">Use the browser is off: the Core's tool list has not been read, so whether it honours browser turns is not known\.<\/p>$/);
  for (const line of [images, browser]) assert.doesNotMatch(line, /does not accept|does not honour|declares no/, "nothing is said about the Core that the page does not know");
});

test("(g) the composer reads the Core's word before it renders a control or sends a turn", () => {
  const word = control.slice(control.indexOf("function aiCoreWord()"), control.indexOf("function sendAiMessage("));
  assert.match(word, /var listed = state\.sources && state\.sources\.coreTools;/, "the word is the tool list the page read ...");
  assert.match(word, /return aiCoreSupport\(state\.coreTools, Boolean\(listed && listed\.ok\)\);/, "... and whether that read answered");
  const send = control.slice(control.indexOf("function sendAiMessage("), control.indexOf("function note("));
  assert.match(send, /var support = aiCoreWord\(\);/);
  assert.ok(send.indexOf("aiCoreWord()") < send.indexOf("var optimistic"), "a refused turn is never shown as sent");
  assert.match(send, /state\.aiChatError = aiCapabilityOff\("images", support\) \+ " Remove the image to send this turn\.";/, "the refusal says what the page knows");
  assert.match(send, /var allowBrowser = state\.aiAllowBrowser === true && support\.turnBrowser;/, "a switch left on while the Core stopped declaring it sends nothing");
  const render = control.slice(control.indexOf("function renderAi()"), control.indexOf("function publicRecordLink("));
  assert.match(render, /var support = aiCoreWord\(\);/);
  const attach = render.indexOf('data-action="ai-attach"'), guard = render.indexOf("support.turnImages");
  assert.ok(guard >= 0 && guard < attach, "the attach control is drawn only behind the Core's word");
  assert.match(render, /aiCapabilityLine\("images", support\)/);
  assert.match(render, /aiBrowserOwner\(state\)\) browserSwitch = aiCapabilityLine\("browser", support\)/);
  assert.match(css, /\.cr-ai-capability\{[^}]*overflow-wrap:anywhere/, "the line wraps at phone width");
});
