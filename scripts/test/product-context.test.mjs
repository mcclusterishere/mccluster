import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("McCluster Corp product context is wired into the public authority graph", () => {
  const context = JSON.parse(read("data/product-context.json"));
  const entity = JSON.parse(read("data/seo/entity-graph.json"));
  const sitemap = JSON.parse(read("data/seo/sitemap-pages.json"));
  const corp = read("mccluster-corp.html");
  const home = read("index.html");
  const profile = read("matthew-mccluster.html");
  const llms = read("llms.txt");
  const url = "https://matthew.mccluster.org/mccluster-corp.html";
  const orgId = "https://matthew.mccluster.org/#mccluster-corp";

  assert.equal(context.schema_version, "mccluster-product-context/v1");
  assert.equal(context.organization["@id"], orgId);
  assert.equal(context.organization.url, url);
  assert.equal(entity.organization["@id"], orgId);
  assert.equal(entity.organization.url, url);
  assert.ok(sitemap.pages.some((p) => p.url === url), "company hub must be indexable");
  assert.ok(corp.includes(`<link rel="canonical" href="${url}">`));
  assert.ok(corp.includes("data/product-context.json"));
  for (const label of ["McCluster Platform", "Equity Uprise", "Uprise Action Network", "PRIM3"]) assert.ok(corp.includes(label), label + " must be explained");
  assert.ok(home.includes(`"url": "${url}"`), "home Organization must point at company hub");
  assert.ok(profile.includes(`"url": "${url}"`), "profile Organization must point at company hub");
  assert.ok(llms.includes("mccluster-corp.html"));
  assert.ok(context.principles.some((p) => p.includes("compatibility detail")), "legacy implementation naming must remain a compatibility detail");
});

test("product context keeps the action and company boundaries explicit", () => {
  const all = JSON.stringify(JSON.parse(read("data/product-context.json")));
  assert.ok(all.includes("completed, verifiable action"));
  assert.ok(all.includes("Whip Equipped LLC is a separate company"));
  assert.ok(all.includes("Payments are a platform capability"));
  assert.ok(all.includes("Control is the operator plane"));
});
