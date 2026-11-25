/* THE LAPTOP MANIFEST TEMPLATE, held to its contract.

   core/node-manifests/owner-windows-gpu.json is what core/windows/mccluster-node.ps1 -Install
   writes (pruned per model tier, plus the browser entry when -Browser installed it) to a Windows
   GPU node's capabilities.json. These checks keep it claimable on both nodes and private:

   (a) it validates through the protocol (core/src/compute/protocol.mjs) with exactly five
       entries: the four ai.chat entries the doctor's tiers choose from, qwen3-vl.8b.local (the
       resident vision model, owner decision 2026-11-17), qwen3.8b.local (the OVH twin, on
       demand), qwen3.14b.local (a discrete card with 12 GiB or more only) and qwen3-vl.4b.local
       (little free memory), and, last, browser.act/chromium.local (slice N2: the node's own
       browser, advertised only once the owner ran -Browser);
   (b) every ai.chat entry carries byte-for-byte the OVH node's input and output schema, so one
       binding and one task are claimable on either node (the design: same implementation id,
       features merged with gpu:true and model_tier); the two vision entries also advertise
       features.vision:true so an image turn is routed to them and never to a text model;
   (c) every ai.chat executor and health URL is a loopback service on 127.0.0.1:4790 and readiness
       is per implementation (/ready?implementation=<id>), never /health; the browser executor is
       a second loopback service on 127.0.0.1:4791 with /execute and /ready;
   (d) min_vram_bytes is 0 on an APU (the registry's UMA carve-out is not the memory inference
       uses), max_leases is 1, the labels say owned gpu-laptop, and nothing is ai.text.draft;
   (e) the raw text carries no user path, UNC host, e-mail or non-loopback IPv4 address;
   (f) node scripts/control-plane-drift-contract-check.mjs, which reads the template too,
       exits 0 on this tree and reports the five implementations.

   Dependency-free; runs on every PR through mcp-continuity-ci.yml (node --test scripts/test/*.test.mjs). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE = "core/node-manifests/owner-windows-gpu.json";
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const { validateCapabilityManifest } = await import(pathToFileURL(join(ROOT, "core/src/compute/protocol.mjs")).href);

/* a Windows user-profile path (raw or JSON-escaped), a UNC host (two backslashes at a path start,
   so a JSON-escaped PNP id like PCI\\VEN_ is not one), an e-mail address, or an IPv4 address other
   than loopback (the executors must be 127.0.0.1, which the hostname check below demands) */
const PRIVATE_STRINGS = /[A-Za-z]:\\{1,2}Users\\{1,2}|(?<![\\\w])\\\\[A-Za-z0-9]|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/;

const raw = read(TEMPLATE);
const manifest = JSON.parse(raw);
const ovh = JSON.parse(read("core/node-manifests/ovh-primary.json"));
const ovhChat = ovh.capabilities.find((e) => e.capability === "ai.chat" && e.implementation === "qwen3.8b.local");
const entry = (implementation) => manifest.capabilities.find((e) => e.capability === "ai.chat" && e.implementation === implementation);
const chatEntries = () => manifest.capabilities.filter((e) => e.capability === "ai.chat");
const browserEntries = () => manifest.capabilities.filter((e) => e.capability === "browser.act");
const VISION = ["qwen3-vl.8b.local", "qwen3-vl.4b.local"];
const TEXT_ONLY = ["qwen3.8b.local", "qwen3.14b.local"];
const BROWSER_ACTIONS = ["open", "read", "find", "click", "type", "select", "scroll", "wait", "screenshot", "back", "done"];

test("the template validates through the protocol with the four laptop ai.chat entries and the browser entry", () => {
  assert.ok(Array.isArray(manifest.capabilities), "capabilities[] must be an array");
  const normalized = validateCapabilityManifest(manifest.capabilities);
  assert.equal(normalized.length, 5);
  assert.deepEqual(
    normalized.map((e) => `${e.capability}/${e.implementation}`).sort(),
    ["ai.chat/qwen3-vl.4b.local", "ai.chat/qwen3-vl.8b.local", "ai.chat/qwen3.14b.local", "ai.chat/qwen3.8b.local", "browser.act/chromium.local"],
  );
  assert.equal(manifest.capabilities[0].implementation, "qwen3-vl.8b.local", "the resident vision model is the first entry (measurement ties go to it)");
  assert.equal(manifest.capabilities[4].capability, "browser.act", "the browser entry is last: -Install prunes it unless -Browser installed the executor");
  for (const item of normalized) {
    assert.equal(item.hosting, "self-hosted");
    assert.equal(item.billing, "compute");
    assert.equal(item.max_concurrency, 1);
    assert.equal(item.min_vram_bytes, 0);
  }
  for (const item of normalized.filter((e) => e.capability === "ai.chat")) assert.equal(item.backend, "ollama");
  assert.equal(entry("qwen3-vl.8b.local").model, "qwen3-vl:8b");
  assert.equal(entry("qwen3.8b.local").model, "qwen3:8b");
  assert.equal(entry("qwen3.14b.local").model, "qwen3:14b");
  assert.equal(entry("qwen3-vl.4b.local").model, "qwen3-vl:4b");
  assert.equal(entry("qwen3.8b.local").version, ovhChat.version, "the shared implementation keeps the OVH entry's version");
  for (const implementation of ["qwen3-vl.8b.local", "qwen3.14b.local", "qwen3-vl.4b.local"]) assert.equal(entry(implementation).version, "1");
  /* the implementation ids satisfy the adapter's MCCLUSTER_OLLAMA_IMPLEMENTATIONS grammar and the protocol's */
  for (const item of chatEntries()) {
    assert.match(item.implementation, /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/);
    assert.match(item.model, /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+)?$/);
  }
});

test("every ai.chat entry's schemas equal the OVH node's byte for byte", () => {
  assert.ok(ovhChat, "ovh-primary.json must still carry ai.chat/qwen3.8b.local");
  assert.equal(chatEntries().length, 4);
  for (const item of chatEntries()) {
    assert.deepEqual(item.input_schema, ovhChat.input_schema, `${item.implementation} input_schema`);
    assert.deepEqual(item.output_schema, ovhChat.output_schema, `${item.implementation} output_schema`);
    assert.equal(JSON.stringify(item.input_schema), JSON.stringify(ovhChat.input_schema), `${item.implementation}: same key order too`);
    assert.equal(JSON.stringify(item.output_schema), JSON.stringify(ovhChat.output_schema));
  }
});

test("features merge the OVH set with gpu:true and a model tier, so requirements {gpu:true} can pin GPU work", () => {
  for (const [implementation, tier] of [["qwen3-vl.8b.local", "8b"], ["qwen3.8b.local", "8b"], ["qwen3.14b.local", "14b"], ["qwen3-vl.4b.local", "4b"]]) {
    const features = entry(implementation).features;
    for (const [key, value] of Object.entries(ovhChat.features)) assert.equal(features[key], value, `${implementation} keeps ${key}`);
    assert.equal(features.gpu, true, `${implementation} advertises gpu:true`);
    assert.equal(features.model_tier, tier);
  }
});

test("the two vision entries advertise features.vision:true and the text models do not (an image turn never lands on a text model)", () => {
  for (const implementation of VISION) assert.equal(entry(implementation).features.vision, true, `${implementation} is a vision implementation`);
  for (const implementation of TEXT_ONLY) assert.notEqual(entry(implementation).features.vision, true, `${implementation} must not claim vision`);
  assert.ok(!ovhChat.features.vision, "the OVH text entry claims no vision either (the claim SQL matches requirements.features <@ advertised.features)");
});

test("every ai.chat executor is a loopback service on port 4790 with per-implementation readiness", () => {
  for (const item of chatEntries()) {
    const { executor } = item;
    assert.equal(executor.type, "http");
    for (const field of ["url", "health_url"]) {
      const url = new URL(executor[field]);
      assert.equal(url.hostname, "127.0.0.1", `${item.implementation} ${field} must be loopback`);
      assert.equal(url.port, "4790");
    }
    assert.equal(new URL(executor.url).pathname, "/execute");
    const health = new URL(executor.health_url);
    assert.equal(health.pathname, "/ready", "readiness, not liveness: /health would advertise a model that is not pulled yet");
    assert.equal(health.searchParams.get("implementation"), item.implementation);
    assert.equal(executor.health_method, "GET");
    assert.equal(executor.health_timeout_ms, 3000);
    assert.equal(executor.timeout_ms, 600000);
  }
});

test("the browser entry is browser.act/chromium.local behind the loopback browser executor on 127.0.0.1:4791", () => {
  const browsers = browserEntries();
  assert.equal(browsers.length, 1, "exactly one browser.act entry");
  const item = browsers[0];
  assert.equal(item.implementation, "chromium.local");
  assert.equal(item.backend, "playwright");
  assert.equal(item.model, null, "a browser has no model");
  assert.equal(item.version, "1");
  assert.deepEqual(item.features, { browser: true, headed: false, screenshot: true, self_hosted: true });
  assert.equal(item.max_concurrency, 1, "one Chromium, one task at a time (the executor answers 429 BROWSER_BUSY otherwise)");
  assert.equal(item.min_vram_bytes, 0);
  const { executor } = item;
  assert.equal(executor.type, "http");
  for (const field of ["url", "health_url"]) {
    const url = new URL(executor[field]);
    assert.equal(url.hostname, "127.0.0.1", `${field} must be loopback`);
    assert.equal(url.port, "4791", `${field} is the browser executor, not the Ollama adapter`);
  }
  assert.equal(new URL(executor.url).pathname, "/execute");
  assert.equal(new URL(executor.health_url).pathname, "/ready", "readiness launches the persistent context once; /health would advertise a browser that cannot launch");
  assert.equal(new URL(executor.health_url).search, "");
  assert.equal(executor.health_method, "GET");
  assert.equal(executor.health_timeout_ms, 3000);
  assert.equal(executor.timeout_ms, 180000, "a browser task is bounded well under the Ollama entries' 600 s");
  /* the task input the Core's browser_act tool sends, as the design states it */
  const input = item.input_schema;
  assert.equal(input.type, "object");
  assert.deepEqual(input.required, ["actions"]);
  assert.equal(input.properties.actions.type, "array");
  assert.equal(input.properties.actions.minItems, 1);
  assert.equal(input.properties.actions.maxItems, 25);
  assert.deepEqual(input.properties.actions.items.properties.type.enum, BROWSER_ACTIONS);
  assert.deepEqual(input.properties.max_steps, { type: "integer", minimum: 1, maximum: 25 });
  assert.deepEqual(input.properties.max_ms, { type: "integer", minimum: 5000, maximum: 600000 });
  assert.deepEqual(input.properties.screenshot_on_done, { type: "boolean" });
  const output = item.output_schema;
  assert.equal(output.type, "object");
  for (const key of ["ok", "implementation", "steps", "page", "screenshot", "refused", "usage"]) assert.ok(output.properties[key], `output_schema names ${key}`);
  assert.equal(output.properties.ok.type, "boolean");
  assert.equal(output.properties.steps.type, "array");
  assert.equal(output.properties.steps.maxItems, 25);
});

test("one lease, owned gpu-laptop labels, no VRAM threshold, no ai.text.draft", () => {
  assert.equal(manifest.max_leases, 1, "a second lease would only queue in the adapter while the OVH node could run it");
  assert.deepEqual(manifest.labels, { site: "owner-windows-gpu", trust: "owned", role: "gpu-laptop" });
  for (const item of manifest.capabilities) {
    assert.equal(item.min_vram_bytes, 0, `${item.implementation}: an APU's UMA carve-out would fail a positive threshold closed`);
    assert.notEqual(item.capability, "ai.text.draft");
  }
  assert.ok(!raw.includes("ai.text.draft"));
});

test("the raw text carries no user path, UNC host, e-mail or non-loopback address", () => {
  assert.equal(PRIVATE_STRINGS.exec(raw), null, "private string in the template");
  /* the regex itself catches what it should and lets loopback through; the e-mail and the
     addresses are assembled here so that this tree carries no literal address itself */
  const email = ["owner", "example.com"].join("@");
  const privateAddress = [10, 0, 0, 12].join(".");
  const homeAddress = [192, 168, 1, 2].join(".");
  for (const bad of ["C:\\Users\\someone\\x", "\"C:\\\\Users\\\\someone\"", "\\\\laptop\\share", "cd \\\\laptop\\share", email, privateAddress, homeAddress]) {
    assert.ok(PRIVATE_STRINGS.test(bad), `regex must catch ${bad}`);
  }
  for (const fine of ["http://127.0.0.1:4790/execute", "http://127.0.0.1:4791/ready", "\"PNPDeviceID\":\"PCI\\\\VEN_1002&DEV_15BF\"", "'^HKEY_LOCAL_MACHINE\\\\SYSTEM'", "32.0.13031.3015"]) {
    assert.equal(PRIVATE_STRINGS.test(fine), false, `regex must let ${fine} through`);
  }
});

test("the control-plane drift contract check, which reads the template too, passes on this tree and reports five implementations", () => {
  const out = execFileSync(process.execPath, ["scripts/control-plane-drift-contract-check.mjs"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const report = JSON.parse(out.slice(out.indexOf("{")));
  assert.equal(report.ok, true);
  const implementations = report.node_manifests?.["owner-windows-gpu"]?.implementations || [];
  assert.equal(implementations.length, 5, "the check reports the laptop template");
  assert.ok(implementations.includes("browser.act/chromium.local"));
  assert.equal(implementations.filter((id) => id.startsWith("ai.chat/")).length, 4);
});
