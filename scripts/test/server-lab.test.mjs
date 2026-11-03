/* Server Lab page contract: owner gate, publication of the runtime it loads, mobile rules, unbranded hardware,
   and the gate's server answer (js/owner-only.mjs) with a synthetic fetch.
     node --test scripts/test/server-lab.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("equity-uprise-server-lab-3d.html");
const app = read("js/server-lab/app.mjs");
const scene = read("js/server-lab/scene.mjs");
const css = read("css/server-lab.css");
const deploy = read(".github/workflows/deploy-pages.yml");

test("the page is owner-gated: nothing of the lab exists outside the template", () => {
  assert.match(html, /<section class="owner-gate"[^>]*data-owner-gate[^>]*data-owner-template="labTpl"[^>]*data-owner-load="js\/server-lab\/app\.mjs/);
  assert.match(html, /<script type="module" src="js\/owner-only\.mjs/);
  const outside = html.replace(/<template id="labTpl">[\s\S]*?<\/template>/, "").replace(/data-owner-load="[^"]*"/, "");
  assert.doesNotMatch(outside, /slApp|slStage|server-lab\/app|canvas/, "lab markup or scripts leaked outside the gated template");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(existsSync(join(ROOT, "js/owner-only.mjs")));
});

test("owner check is the server's answer: 2xx opens, 401/403/unreachable/signed-out stay closed", async () => {
  globalThis.document = undefined;
  const { checkOwner } = await import(join(ROOT, "js/owner-only.mjs"));
  const store = (token) => ({ getItem: () => (token ? JSON.stringify({ access_token: token }) : null) });
  const seen = [];
  const fetchImpl = (status) => async (url, init) => { seen.push([url, init.headers.authorization]); return { ok: status >= 200 && status < 300, status }; };
  assert.deepEqual(await checkOwner({ fetchImpl: fetchImpl(200), storage: store("t1"), auth: null }), { owner: true, reason: "owner" });
  assert.deepEqual(seen[0], ["https://api.mccluster.org/v1/status", "Bearer t1"]);
  assert.equal((await checkOwner({ fetchImpl: fetchImpl(403), storage: store("t2"), auth: null })).owner, false);
  assert.equal((await checkOwner({ fetchImpl: fetchImpl(401), storage: store("t3"), auth: null })).reason, "not-owner");
  assert.equal((await checkOwner({ fetchImpl: async () => { throw new Error("offline"); }, storage: store("t4"), auth: null })).reason, "unavailable");
  assert.equal((await checkOwner({ fetchImpl: fetchImpl(200), storage: store(null), auth: null })).reason, "signed-out");
});

test("three.js is pinned to 0.180 through the import map", () => {
  assert.match(html, /"three":"https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/":"https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\/"/);
});

test("every runtime file the page loads is published by deploy-pages.yml", () => {
  const loads = [...app.matchAll(/getJson\("([^"]+)"\)/g)].map((m) => m[1]).concat([...app.matchAll(/new URL\("(lab-runtime\/[^"]+)", PREVIEW\)/g)].map((m) => m[1]));
  assert.ok(loads.length >= 8, loads.join(","));
  for (const rel of loads) {
    const name = rel.split("/").pop();
    const dest = rel.includes("/") ? "equity-uprise-preview/" + rel.split("/").slice(0, -1).join("/") + "/" : "equity-uprise-preview/" + name;
    const ok = deploy.split("\n").some((line) => line.includes("cp ") && line.includes(name) && (line.includes(dest) || line.trim().endsWith(dest)));
    assert.ok(ok, "deploy-pages.yml does not publish " + rel);
  }
  // the runtime's own imports are published too
  for (const dep of ["equity-uprise-lab-runtime.mjs", "equity-uprise-electronics-sandbox.mjs", "equity-uprise-guided-scenarios.mjs", "equity-uprise-assessment-runtime.mjs"]) {
    assert.ok(deploy.includes("lab-runtime/" + dep + " equity-uprise-preview/lab-runtime/"), dep);
  }
});

test("mobile first: min-width only, no bare 1fr, 16px controls, 44px targets", () => {
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.doesNotMatch(css.replace(/minmax\([^)]*\)/g, ""), /grid-template-columns:[^;]*\b1fr/);
  assert.match(css, /font-size: max\(16px, 1rem\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(html, /content="width=device-width, initial-scale=1, viewport-fit=cover"/);
});

test("unbranded hardware: no vendor names or marks in the lab's code or data, no purple", () => {
  const brands = /\b(dell|poweredge|proliant|lenovo|supermicro|cisco|juniper|intel|xeon|epyc|broadcom|mellanox|nvidia|samsung|seagate|idrac|xclarity)\b/i;
  for (const src of [app, scene, html, read("docs/design/equity-uprise-building/production/electronics/server-lab-hardware-v1.json")]) assert.doesNotMatch(src, brands);
  assert.doesNotMatch(css + scene, /purple|violet|#(8a2be2|800080|9b59b6|a855f7|7c3aed)/i);
});
