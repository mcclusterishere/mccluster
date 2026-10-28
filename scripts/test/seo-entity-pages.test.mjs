/* WHAT A CRAWLER IS TOLD ABOUT EACH OWNED PAGE.

   data/seo/domain-architecture.json -> url_ownership says whose each URL is;
   data/seo/sitemap-pages.json is the map we hand search engines. A page we
   own and let be indexed belongs in that map, or it is discoverable by crawl
   only. The entity nodes that live on a page (PRIM3 on prim3.html, Whip
   Equipped LLC on whip.html) are the ones data/seo/entity-graph.json
   defines, so the two never drift: PRIM3 is McCluster Corp's learning
   project; Whip Equipped LLC is Matthew McCluster's separate company, never
   part of McCluster Corp. Operator desks and frame shells are noindex, each
   page has one <h1>, and no canonical is relative.
   Authority: docs/control-plane/DOMAINS-AND-ENTITIES.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));
const SITE = "https://matthew.mccluster.org";
const PERSON = "https://matthew.mccluster.org/#matthew-mccluster";
const ORG = "https://matthew.mccluster.org/#mccluster-corp";
const NOINDEX = /<meta name="robots" content="[^"]*noindex/i;
const fileFor = (path) => (path.endsWith("/") ? `${path}index.html` : path).slice(1);
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

/* Owned paths that are not one page in this repository, each with its reason. */
const NOT_A_PAGE_HERE = {
  "/walls/": "a folder: each indexable wall is listed on its own (tools/build-sitemap.mjs refuses a forgotten one)",
  "/closet/": "a folder: its indexable pages are listed on their own",
  "/site0/": "promoted from _unfinished/site0-game at deploy by tools/publish-site0.sh; not in the tree the sitemap builder checks"
};
/* Owned paths the owner keeps in private development, unpublished (owner, 2026-10-28: hitman-facility.html moves to _unfinished/):
   not indexable pages, so they must stay out of the sitemap whether or not the file is still in the tree. */
const UNPUBLISHED = "in_private_development_unpublished";
/* A per-record page addressed by query (?handle=): the bare URL is not a page to rank, and a static canonical would fold every record into it. */
const QUERY_TEMPLATES = new Set(["/music-creator.html"]);

test("every indexable owned page is in the sitemap", () => {
  const own = json("data/seo/domain-architecture.json").url_ownership;
  const listed = new Set(json("data/seo/sitemap-pages.json").pages.map((p) => p.url.slice(SITE.length)));
  const missing = [];
  for (const [group, paths] of Object.entries(own)) {
    if (!Array.isArray(paths)) continue;
    if (group === UNPUBLISHED) {
      for (const path of paths) assert.ok(!listed.has(path), `${path} is in private development, unpublished: it is not in the sitemap`);
      continue;
    }
    for (const path of paths) {
      if (!/(\.html|\/)$/.test(path)) continue; // a data file, not a page
      if (Object.prototype.hasOwnProperty.call(NOT_A_PAGE_HERE, path) || QUERY_TEMPLATES.has(path)) continue;
      const file = fileFor(path);
      assert.ok(existsSync(join(ROOT, file)), `${path} (${group}) names a page that does not exist`);
      if (NOINDEX.test(read(file))) continue;
      if (!listed.has(path)) missing.push(`${path} (${group})`);
    }
  }
  assert.deepEqual(missing, [], "indexable owned pages missing from data/seo/sitemap-pages.json");
  assert.ok(Array.isArray(own[UNPUBLISHED]) && own[UNPUBLISHED].includes("/hitman-facility.html"), "hitman-facility.html is recorded as in private development, unpublished");
  for (const path of Object.keys(NOT_A_PAGE_HERE)) assert.ok(!existsSync(join(ROOT, fileFor(path))), `${path} is a page now: list it or drop the exception`);
});

test("Whip Equipped's apps are owned as Matthew's separate company, not McCluster Corp's", () => {
  const own = json("data/seo/domain-architecture.json").url_ownership;
  for (const p of ["/whip.html", "/whip/", "/whip/driver/", "/whip/rentals/", "/whip/rider/"]) {
    assert.ok(own.separate_company_hosted_on_personal.includes(p), p);
    assert.ok(!own.company_hosted_on_personal_for_compatibility.includes(p), p);
  }
  assert.ok(own.company_hosted_on_personal_for_compatibility.includes("/site0/"), "PRIM3 Site 0 is the company's");
});

test("prim3.html carries the PRIM3 Project node, parented by the Organization", () => {
  const graph = json("data/seo/entity-graph.json");
  const node = ld(read("prim3.html")).find((n) => n["@id"] === graph.projects.prim3["@id"]);
  assert.ok(node, "the PRIM3 Project node is on its page");
  const { "@context": ctx, ...rest } = node;
  assert.equal(ctx, "https://schema.org");
  assert.deepEqual(rest, graph.projects.prim3, "the page says what entity-graph.json says");
  assert.equal(node["@type"], "Project");
  assert.equal(node.parentOrganization["@id"], ORG);
});

test("whip.html carries the Whip Equipped Organization node: founder Matthew, no parent organization", () => {
  const graph = json("data/seo/entity-graph.json");
  const want = graph.organizations.whip_equipped;
  assert.equal(want["@id"], "https://matthew.mccluster.org/whip.html#whip-equipped");
  const node = ld(read("whip.html")).find((n) => n["@id"] === want["@id"]);
  assert.ok(node, "the Whip Equipped Organization node is on its page");
  const { "@context": ctx, ...rest } = node;
  assert.equal(ctx, "https://schema.org");
  assert.deepEqual(rest, want, "the page says what entity-graph.json says");
  assert.equal(node["@type"], "Organization");
  assert.equal(node.founder["@id"], PERSON);
  assert.ok(!("parentOrganization" in node), "Whip Equipped LLC is not part of McCluster Corp");
  assert.ok(!JSON.stringify(ld(read("whip.html"))).includes(ORG), "no McCluster Corp node on Whip's page");
});

test("operator desks and frame shells are noindex", () => {
  for (const f of ["music-admin.html", "embed.html", "guest-globe.html", "action-globe.html"]) {
    assert.match(read(f), NOINDEX, f);
  }
});

test("one <h1> on each page whose headings this pass settled", () => {
  for (const f of ["album.html", "prim3.html", "prim3-range.html", "action/index.html", "mnet.html"]) {
    const html = read(f).replace(/<script[\s\S]*?<\/script>/g, "");
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, f);
  }
});

test("listed pages carry a description and an absolute self canonical; no canonical anywhere is relative", () => {
  for (const { url } of json("data/seo/sitemap-pages.json").pages) {
    const path = url.slice(SITE.length);
    const html = read(fileFor(path));
    assert.match(html, /<meta name="description" content="[^"]{20,}"/, `${path}: description`);
    const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(canon, [url], `${path}: canonical`);
  }
  for (const f of readdirSync(ROOT).filter((n) => n.endsWith(".html"))) {
    for (const [, href] of read(f).matchAll(/<link rel="canonical" href="([^"]+)"/g)) {
      assert.match(href, /^https:\/\//, `${f}: canonical ${href} is relative`);
    }
  }
});
