/* Ask McCluster: image attach, the owner-only browser switch, screenshots, the action log and the
   node badge (device-node slice N2, docs/control-plane/AGENT-NODE-BROWSER.md).

   The page's own helper block (js/control-room-v2.js, between "AI ATTACHMENTS, VISION AND BROWSER
   TURNS" and "END AI ATTACHMENTS") is executed in a VM with the formatting primitives stubbed, so
   these are the rules the page runs, not a copy of them:

   (a) the image budget: at most 2 images per turn, each downscaled to 1280 px on its longest side and
       accepted only at or under 200,000 decoded bytes (the Core's cap);
   (b) the request shapes: the durable turn carries images and allow_browser only when set; "Ask home
       AI" takes the messages form only when an image is attached;
   (c) the owner-only switch: the owner role in the house workspace with core.ai.turn.submit listed,
       nothing else; the server gates independently;
   (d) the renderers: user images, assistant screenshots inside a collapsed block with the action log,
       the node badge, live steps from tool_receipts, the plain-words error copy, the readiness line;
   (e) source and stylesheet assertions: the submit shape, the attach input, min-width-only CSS with
       minmax(0, …) tracks and 16 px controls.

   Dependency-free; runs on every PR through mcp-continuity-ci.yml (node --test scripts/test/*.test.mjs).
   The browser proof is scripts/e2e/control-ai-browser.e2e.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

test("(b) the durable turn carries images and allow_browser only when set; Ask home AI takes the messages form only with an image", () => {
  const plainTurn = h.aiTurnSubmission({ org_id: "o1", thread_id: "t1", message_id: "m1", content: "hi", input_mode: "text" }, [], false);
  assert.deepEqual(plain(plainTurn), { org_id: "o1", thread_id: "t1", message_id: "m1", content: "hi", input_mode: "text" }, "an older Core sees exactly the fields it knows");
  const rich = h.aiTurnSubmission({ org_id: "o1", thread_id: "t1", message_id: "m1", content: "look", input_mode: "text" }, [{ base64: JPEG_B64 }], true);
  assert.deepEqual(plain(rich.images), [JPEG_B64]);
  assert.equal(rich.allow_browser, true);
  assert.deepEqual(plain(h.aiChatRequest("hello", [])), { prompt: "hello", temperature: 0.2 });
  assert.deepEqual(plain(h.aiChatRequest("what is this", [{ base64: JPEG_B64 }])), { messages: [{ role: "user", content: "what is this", images: [JPEG_B64] }], temperature: 0.2 });
  /* the page's submit uses the helper and the attachments are cleared after the submit is built */
  assert.match(control, /callCoreTool\("core\.ai\.turn\.submit", aiTurnSubmission\(\{/);
  assert.match(control, /state\.aiAttachments = \[\];/);
  assert.match(control, /callCoreTool\("ai\.chat", aiChatRequest\(aiText, \[\]\)\)/, "the Command Center keeps the prompt form (it has no attach control)");
});

test("(c) the browser switch shows only for the owner of the house workspace with the durable turn tool listed", () => {
  const tools = (name) => ["core.ai.turn.submit", "core.ai.turn.get", "ai.chat"].includes(name);
  const house = { id: "o1", slug: "mccluster", kind: "studio" };
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }, tools), true);
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "viewer" }, org: house }, tools), false, "a member never sees it");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "admin" }, org: house }, tools), false, "an admin label is not ownership");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: { id: "o2", slug: "client", kind: "tenant" } }, tools), false, "a client workspace's owner is not the house owner");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: null, org: house }, tools), false, "no membership, no switch");
  assert.equal(h.aiBrowserSwitchVisible({ workspace: { role: "owner" }, org: house }, () => false), false, "no durable turn tool, no switch");
  /* the server gates independently: the page sends the flag, it never asserts the right */
  assert.match(control, /aiBrowserSwitchVisible\(state, coreToolAvailable\)/);
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
