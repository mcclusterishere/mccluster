/* ONE PLATFORM, TENANT PROPERTIES, SEPARATE ENTITIES (record v2).

   https://mccluster.org/ is McCluster Corp's platform, set in one place
   (data/seo/domain-architecture.json -> platform.origin); https://matthew.mccluster.org/
   is Matthew McCluster's personal profile, a tenant of the platform. Hosting is not
   identity. These checks keep the two entities from collapsing and the law from
   running ahead of what has shipped: the record's platform and tenant blocks, every
   published page in exactly one set, each page's metadata as the live stage's switch
   says (P0: as today), today's @id set unchanged, the graph and its hierarchy (Whip
   Equipped is Matthew's separate company; PRIM3 is the company's learning product),
   the generated company pages, and the agent-facing law in every adapter.
   Authority: data/seo/domain-architecture.json, docs/control-plane/DOMAINS-AND-ENTITIES.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));
const arch = json("data/seo/domain-architecture.json");
const graph = json("data/seo/entity-graph.json");
const PERSON = "https://matthew.mccluster.org/#matthew-mccluster";
const ORG = "https://matthew.mccluster.org/#mccluster-corp";
const WHIP = "https://matthew.mccluster.org/whip.html#whip-equipped";
const HEADING_15 = "One platform, tenant properties, separate entities. Never collapse them.";
const SETS = ["platform", "profile", "profile_only"];

/* The published tree is what deploy-pages.yml leaves after its one "rm -rf" strip line
   (scripts/test/publish-strip-parity.test.mjs holds that line to the export allowlist). */
const strip = (() => {
  const joined = read(".github/workflows/deploy-pages.yml").replace(/\\\n\s*/g, " ");
  const lines = joined.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("rm -rf ") && !l.includes("$"));
  assert.equal(lines.length, 1, "deploy-pages.yml strips with one rm -rf line");
  return new Set(lines[0].slice("rm -rf ".length).split(/\s+/).filter(Boolean));
})();
function publishedHtml(dir = "") {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.name.startsWith(".") || e.name === "node_modules" || strip.has(rel)) continue;
    if (e.isDirectory()) out.push(...publishedHtml(rel));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out.sort();
}
const urlPath = (file) => "/" + file.replace(/(^|\/)index\.html$/, "$1");
function nodes(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => nodes(x, out));
  else if (v && typeof v === "object") { out.push(v); Object.values(v).forEach((x) => nodes(x, out)); }
  return out;
}
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const meta = (html, re) => (html.match(re) || [])[1];
const PAGES = publishedHtml();

/* Today's @ids on every published page (2026-11-23, base d33b189d). A page that changes host changes its URL,
   canonical and WebSite, never an @id, so this set stays byte-identical through every stage. A new entity on a
   page is a deliberate change: add its @id here in the same commit. */
const ID_PREFIX = "https://matthew.mccluster.org/";
const ID_FIXTURE = [
  "#album", "#equity-uprise", "#matthew-mccluster", "#mccluster-corp", "#southern-connecticut-state-university",
  "#website", "#whip-equipped", "card.html", "catalogue.html", "catalogue.html#album-cia-mind-control",
  "catalogue.html#album-equity-uprise", "catalogue.html#album-heal-the-3", "catalogue.html#album-prim3",
  "catalogue.html#album-vaunt-ep", "catalogue.html#album-whip-equipped", "catalogue.html#anti-social-engineering",
  "catalogue.html#antisocial", "catalogue.html#app-attacks", "catalogue.html#artist-equity-uprise",
  "catalogue.html#data-breach", "catalogue.html#dealer-plates", "catalogue.html#dealer-plates-b",
  "catalogue.html#deep-end", "catalogue.html#dive-in", "catalogue.html#environmental-injustice",
  "catalogue.html#environmental-injustice-brave", "catalogue.html#evil-twin-middle-man",
  "catalogue.html#ghost-in-the-wires", "catalogue.html#got-wifi", "catalogue.html#heal-the-3rd-world",
  "catalogue.html#here", "catalogue.html#high-alert", "catalogue.html#iot", "catalogue.html#lightroom",
  "catalogue.html#money-or-the-power", "catalogue.html#osint", "catalogue.html#per-diem",
  "catalogue.html#please-set-me-free", "catalogue.html#raid-hot-site", "catalogue.html#red-blue-purple-white-team",
  "catalogue.html#runway-walk", "catalogue.html#upset", "catalogue.html#vaunt", "catalogue.html#who-did-the-shoot",
  "catalogue.html#write-a-song", "docket-516.html#explainer", "engineering/", "engineering/#breadcrumb",
  "engineering/data-center-networking.html#profile-page",
  "engineering/field-technology-telematics.html#profile-page", "engineering/ipc-infrastructure.html",
  "engineering/it-support-systems.html#profile-page", "engineering/mccluster-platform.html",
  "engineering/mccluster-platform.html#mccluster-platform", "engineering/recruiter-role-map.html",
  "heal-the-3rd-world.html#heal-the-3rd-world", "hire.html", "hire.html#anti-social", "hire.html#runway",
  "hire.html#who-did-the-shoot", "hire.html#write-a-song", "matthew-mccluster.html#profile-page",
  "matthew-mccluster.html#sjw", "mccluster-corp.html#page", "mnet.html#uprise-action-network", "newsroom.html",
  "newsroom.html#bridgeport-human-rights-day-2025", "newsroom.html#cga-matthew-2025",
  "newsroom.html#dna-policy-memo-2024", "newsroom.html#docket-516r-closed-2026",
  "newsroom.html#equity-uprise-bridgeport-event-2025", "newsroom.html#georgia-proclamation-2025",
  "policy-memo-dna.html", "policy.html", "policy.html#docket-516", "policy.html#school-meals",
  "portfolio.html#asked", "portfolio.html#panel", "press.html", "prim3-artist.html#page",
  "prim3-artist.html#prim3-artist", "prim3.html#prim3", "resume-digital-inclusion.html", "resume-it-support.html",
  "services.html", "walls/brunch-and-beats.html#bnb-01", "walls/brunch-and-beats.html#bnb-02",
  "walls/brunch-and-beats.html#bnb-03", "walls/brunch-and-beats.html#bnb-04", "walls/brunch-and-beats.html#bnb-05",
  "walls/brunch-and-beats.html#bnb-06", "walls/brunch-and-beats.html#bnb-07", "walls/brunch-and-beats.html#client",
  "walls/brunch-and-beats.html#event", "walls/brunch-and-beats.html#gallery",
  "walls/candler-crossing.html#candler-01", "walls/candler-crossing.html#candler-02",
  "walls/candler-crossing.html#client", "walls/candler-crossing.html#event", "walls/candler-crossing.html#gallery",
  "walls/cover-art.html#event", "walls/cover-art.html#gallery", "walls/cover-art.html#heal-the-3",
  "walls/cover-art.html#here-cover", "walls/dressed-for-success.html#client",
  "walls/dressed-for-success.html#dfs-01", "walls/dressed-for-success.html#dfs-02",
  "walls/dressed-for-success.html#dfs-03", "walls/dressed-for-success.html#dfs-04",
  "walls/dressed-for-success.html#dfs-05", "walls/dressed-for-success.html#event",
  "walls/dressed-for-success.html#gallery", "walls/eu-rally.html#client", "walls/eu-rally.html#event",
  "walls/eu-rally.html#gallery", "walls/eu-rally.html#rally-01", "walls/eu-rally.html#rally-02",
  "walls/eu-rally.html#rally-03", "walls/eu-rally.html#rally-04", "walls/eu-rally.html#rally-05",
  "walls/vaunt-runway.html#client", "walls/vaunt-runway.html#event", "walls/vaunt-runway.html#gallery",
  "whip.html#whip-equipped"
].map((s) => ID_PREFIX + s);

test("the record names one platform, its tenant, its doors and two entities, and keeps the stable @ids", () => {
  assert.equal(arch.schema_version, "mccluster-domain-architecture/v2");
  const p = arch.platform, m = arch.tenants.matthew;
  assert.equal(p.origin, "https://mccluster.org", "the one setting");
  assert.equal(p.operator, ORG, "McCluster Corp operates the platform");
  assert.equal(p.website_id, "https://mccluster.org/#website");
  assert.equal(p.site_name, "McCluster Corp");
  assert.equal(p.next.origin, "https://equityuprise.com", "the platform's planned address (stage F)");
  assert.equal(m.host, "matthew.mccluster.org");
  assert.equal(m.entity, PERSON, "the tenant is Matthew McCluster's");
  assert.equal(m.website_id, "https://matthew.mccluster.org/#website");
  assert.equal(m.site_name, "Matthew McCluster");
  assert.notEqual(p.operator, m.entity, "hosting is not identity: two entities");
  assert.deepEqual(Object.keys(arch.tenants), ["matthew"], "one tenant until the record says otherwise");
  for (const [host, d] of Object.entries(arch.doors)) {
    assert.ok(d.to === "platform" || d.to === "tenants.matthew", `${host}: a door leads to the platform or a tenant`);
    assert.ok(d.served_by === "worker:mccluster" || d.served_by === "cloudflare-zone-redirect-rule", `${host}: no second Worker`);
  }
  assert.equal(arch.doors["humanuprise.com"].to, "platform", "owner default, 2026-11-23: humanuprise.com sends people to the platform once routed");
  assert.equal(arch.doors["www.mccluster.org"].to, "platform");
  assert.equal(arch.doors["here.mccluster.org"].to, "tenants.matthew");
  /* the v1 names stay aliases of the v2 blocks until every reader moves (P4) */
  assert.equal(arch.properties.company.origin, p.origin);
  assert.equal(arch.properties.company.entity, p.operator);
  assert.equal(arch.properties.personal.origin, `https://${m.host}`);
  assert.equal(arch.properties.personal.entity, m.entity);
  assert.equal(arch.properties.human_uprise.entity, ORG, "the legacy-named door is McCluster Corp's, never a third entity");
  assert.equal(graph.person["@id"], PERSON);
  assert.equal(graph.organization["@id"], ORG, "the Organization @id must not move: every page joins on it");
  assert.equal(graph.person.url, "https://matthew.mccluster.org/matthew-mccluster.html");
  assert.equal(graph.organization.url, "https://mccluster.org/", "the Organization's url is the platform");
  assert.equal(arch.entities.mccluster_corp.url, graph.organization.url);
  assert.equal(arch.entities.matthew_mccluster.url, graph.person.url);
  for (const decision of Object.keys(arch.owner_decisions).filter((k) => !k.startsWith("_"))) {
    assert.equal(arch.owner_decisions[decision].status, "default, the owner's to change", decision);
  }
});

test("the law never claims a stage that has not shipped", () => {
  const order = arch.edge.stages.map((s) => s.stage);
  const now = arch.edge.now.stage;
  assert.ok(order.includes(now), `edge.now names a stage of edge.stages: ${now}`);
  assert.ok(arch.stage_now.startsWith(`${now} `), "stage_now and edge.now agree");
  for (const s of arch.edge.stages) {
    const shipped = order.indexOf(s.stage) <= order.indexOf(now) && s.stage !== "F";
    if (!shipped) assert.equal(s.state, "planned", `${s.stage} is planned until it ships`);
  }
  /* every place the law states the live stage ("Stage now: P0", "(stage P0)", "stage P0:", "stage P0 of the
     one-platform plan") says the record's; stage F is always named as later, never as now */
  const claim = /(?:Stage now: |\(stage |\bstage )(P\d)(?=[):,]|\s+of\s+the\s+one-platform)/g;
  const lawFiles = ["AGENTS.md", "CLAUDE.md", "CODEX.md", "GEMINI.md", ".cursorrules", ".cursor/rules/mccluster.mdc",
    ".github/copilot-instructions.md", ".github/instructions/mccluster.instructions.md", "docs/control-plane/DOMAINS-AND-ENTITIES.md",
    "docs/control-plane/CANONICAL-ARCHITECTURE.md"];
  const notes = ["docs/control-plane/CLOUDFLARE-PAGES-DIRECT-UPLOAD.md", "docs/control-plane/SHARED-NAVIGATION.md", "docs/music/MUSIC-WORLD-CONTINUITY.md"];
  for (const f of [...lawFiles, ...notes]) {
    const stated = [...read(f).matchAll(claim)].map((m) => m[1]);
    if (lawFiles.includes(f)) assert.ok(stated.length > 0, `${f} states the stage`);
    for (const s of stated) assert.equal(s, now, `${f} says the stage now is ${s}; the record says ${now}`);
  }
  const canon = json("docs/control-plane/canonical-architecture.json");
  assert.ok(canon.public_properties.stage.startsWith(`${now} `), "the machine contract states the same stage");
  /* P0 changes some answers once deployed, and the law says which instead of denying it: no law file, note, record
     or contract says nothing is served differently, and each place that states the stage points at the record's list */
  for (const f of [...lawFiles, ...notes, "data/seo/domain-architecture.json", "docs/control-plane/canonical-architecture.json"]) {
    assert.doesNotMatch(read(f), /nothing is served differently/i, `${f}: P0's own changes are listed (edge.now.p0_changes), never denied`);
  }
  for (const f of ["AGENTS.md", "CLAUDE.md", "CODEX.md", "GEMINI.md", ".github/copilot-instructions.md", "docs/control-plane/DOMAINS-AND-ENTITIES.md",
    "docs/control-plane/CANONICAL-ARCHITECTURE.md"]) {
    assert.match(read(f), /edge\.now\.p0_changes/, `${f}: points at the record's list of what P0 itself changes`);
  }
  assert.match(canon.public_properties.stage, /edge\.now\.p0_changes/, "and so does the machine contract");
});

test("the record lists what P0 itself changes once deployed, and each entry is what the code does", async () => {
  const imp = (f) => import(pathToFileURL(join(ROOT, f)).href);
  const changes = arch.edge.now.p0_changes;
  assert.ok(Array.isArray(changes), "edge.now.p0_changes is a list");
  const keys = changes.map((c) => c.key);
  assert.deepEqual(keys, ["pass_through_redirects", "returns_follow_request", "dead_here_returns", "music_direct_cors", "carry_page", "profile_host_unrouted"]);
  for (const c of changes) {
    assert.ok(typeof c.what === "string" && c.what.length > 60, `${c.key}: says what changes`);
    const first = c.where.split(/[ ,;(]/)[0];
    assert.ok(existsSync(join(ROOT, first)), `${c.key}: names where (${first})`);
  }
  const { SITE } = await imp("workers/mccluster/src/platform/hosts.generated.js");
  assert.equal(SITE.stage, arch.edge.now.stage);
  const P = SITE.platform.origin, M = SITE.profile.origin;
  /* the pass-through: GitHub's slash redirect is handed back on the requesting host, any other redirect refused */
  const host = await imp("workers/mccluster/src/world-host.js");
  assert.match(read("workers/mccluster/src/world-host.js"), /redirect: 'manual'/, "never follows an upstream redirect");
  assert.equal(host.relocate(`${M}/js/halo/`, `${M}/js/halo`, `${P}/js/halo`), `${P}/js/halo/`);
  assert.equal(host.relocate("https://elsewhere.example/x", `${M}/js/halo`, `${P}/js/halo`), null);
  /* returns follow the request, and fall back to Matthew's host at P0 */
  const sh = await imp("supabase/functions/_shared/site-hosts.ts");
  assert.equal(sh.returnOrigin(P), P);
  assert.equal(sh.returnOrigin(M), M);
  assert.equal(sh.returnOrigin("https://elsewhere.example"), M);
  assert.match(read("supabase/functions/shake-order/index.ts"), /const SITE = SITE_URL \?\? returnOrigin\(origin\);/, "an operator's SITE_URL still wins");
  /* the dead Here address is named by no return */
  for (const fn of ["backend-sub", "pay-now", "connect-onboard"]) {
    assert.ok(!read(`supabase/functions/${fn}/index.ts`).includes("mcclusterishere.github.io/Here"), `${fn} names no dead address`);
  }
  /* the direct-sale CORS admits the platform: listed because the code does it */
  const md = await imp("supabase/functions/_shared/music-direct.ts");
  assert.equal(md.ALLOWED_ORIGINS.includes(P), keys.includes("music_direct_cors"), "the record lists the direct-sale CORS widening exactly when the code makes it");
  assert.equal(md.corsHeaders(P)["Access-Control-Allow-Origin"], P);
  assert.equal(md.corsHeaders("https://elsewhere.example")["Access-Control-Allow-Origin"], M);
  /* the carry page exists and is inert; Matthew's host is not routed */
  assert.ok(existsSync(join(ROOT, "carry.html")));
  assert.equal(SITE.switches.carry, false);
  assert.equal(SITE.switches.profile_host_routed, false);
});

test("the law's sentence about today says what the P0 router answers on the platform", async () => {
  assert.equal(arch.edge.now.stage, "P0", "this reads the P0 sentence; the stage after it rewrites both");
  const { SITE } = await import(pathToFileURL(join(ROOT, "workers/mccluster/src/platform/hosts.generated.js")).href);
  const { routeFor } = await import(pathToFileURL(join(ROOT, "workers/mccluster/src/platform/router.js")).href);
  const found = read("AGENTS.md").match(/Today the platform serves [^]*?Matthew's host serves every page\./);
  assert.ok(found, "AGENTS.md hard rule 15 says what the platform serves today");
  const sentence = found[0];
  const P = SITE.platform.origin, M = SITE.profile.origin;
  const at = (path) => routeFor(SITE, new URL(P + path));
  const claims = [
    ["the Equity Uprise World at its root", "/", (r) => r.kind === "world"],
    ["the World's rooms", "/account.html", (r) => r.kind === "pass"],
    ["the World's rooms", "/action-network-hire.html", (r) => r.kind === "pass"],
    ["the static files they load", "/js/tabbar.js", (r) => r.kind === "pass"],
    ["the static files they load", "/sw.js", (r) => r.kind === "pass"],
    ["the company page `/company`", "/company", (r) => r.kind === "own"],
    ["the company's news `/news/`", "/news/", (r) => r.kind === "own"],
    ["`robots.txt`, `sitemap.xml` and `llms.txt`", "/robots.txt", (r) => r.kind === "own"],
    ["`robots.txt`, `sitemap.xml` and `llms.txt`", "/sitemap.xml", (r) => r.kind === "own"],
    ["`robots.txt`, `sitemap.xml` and `llms.txt`", "/llms.txt", (r) => r.kind === "own"],
    ["`/index.html` and `/mnet.html` on it answer 301 to its root", "/index.html", (r) => r.kind === "moved" && r.location === `${P}/`],
    ["`/index.html` and `/mnet.html` on it answer 301 to its root", "/mnet.html", (r) => r.kind === "moved" && r.location === `${P}/`],
    ["every other path on it answers 301 to the same path on Matthew's host", "/listen.html?from=law", (r) => r.kind === "moved" && r.location === `${M}/listen.html?from=law`],
    ["every other path on it answers 301 to the same path on Matthew's host", "/whip.html", (r) => r.kind === "moved" && r.location === `${M}/whip.html`]
  ];
  for (const [words, path, agrees] of claims) {
    assert.ok(sentence.includes(words), `AGENTS.md hard rule 15 says: ${words}`);
    assert.ok(agrees(at(path)), `and the P0 router agrees for ${path}: ${JSON.stringify(at(path))}`);
  }
});

test("every alias_of names a block of its own file as a path the generator writes, never as a host name", () => {
  /* a.b.c and a["host.name"]: the form tools/build-site-hosts.mjs writes in its messages (doors["humanuprise.com"]) */
  function resolve(root, ref) {
    let rest = String(ref), at = root;
    while (rest) {
      const m = rest.match(/^(?:\.?([A-Za-z_]\w*)|\["([^"]+)"\])/);
      if (!m) return undefined;
      const key = m[1] || m[2];
      if (!at || typeof at !== "object" || !Object.prototype.hasOwnProperty.call(at, key)) return undefined;
      at = at[key];
      rest = rest.slice(m[0].length);
    }
    return at;
  }
  const HOSTISH = /[a-z0-9-]+\.(?:org|com|net|io|dev|app)\b/i;
  const canon = json("docs/control-plane/canonical-architecture.json");
  let seen = 0;
  for (const [file, doc, scope] of [["data/seo/domain-architecture.json", arch, arch], ["docs/control-plane/canonical-architecture.json", canon, canon.public_properties]]) {
    for (const n of nodes(doc)) {
      if (typeof n.alias_of !== "string") continue;
      seen += 1;
      assert.doesNotMatch(n.alias_of.replace(/\["[^"]*"\]/g, ""), HOSTISH, `${file}: alias_of "${n.alias_of}" reads as a host name (hard rule 9)`);
      const target = resolve(scope, n.alias_of);
      assert.ok(target && typeof target === "object", `${file}: alias_of "${n.alias_of}" names a block of the file`);
    }
  }
  assert.equal(seen, 5, "the five aliases the record and the contract carry");
  assert.equal(arch.properties.human_uprise.alias_of, 'doors["humanuprise.com"]');
  assert.equal(resolve(arch, arch.properties.human_uprise.alias_of).to, "platform", "the door it aliases");
});

test("every published page is in exactly one set", () => {
  const own = arch.url_ownership;
  const paths = PAGES.map(urlPath);
  assert.ok(paths.length > 150, `the published tree has its pages (${paths.length})`);
  const where = new Map();
  for (const set of SETS) {
    assert.deepEqual(own[set], [...own[set]].sort(), `${set} is sorted`);
    for (const p of own[set]) {
      assert.ok(!where.has(p), `${p} is in ${where.get(p)} and ${set}`);
      where.set(p, set);
    }
  }
  const none = paths.filter((p) => !where.has(p));
  assert.deepEqual(none, [], "published pages in no set: add each to url_ownership.platform, profile or profile_only");
  const promoted = new Set(own.promoted_at_deploy.map((d) => d.path));
  const stray = [...where.keys()].filter((p) => !paths.includes(p));
  assert.deepEqual(stray, [], "url_ownership names pages that are not published");
  for (const d of own.promoted_at_deploy) {
    assert.ok(SETS.includes(d.set), `${d.path}: a set`);
    assert.ok(!where.has(d.path) && !existsSync(join(ROOT, d.path.slice(1))), `${d.path} is promoted at deploy, not in this tree`);
  }
  assert.ok(promoted.has("/site0/"));
  for (const p of ["/", "/matthew-mccluster.html", "/resume-it-support.html", "/engineering/"]) assert.equal(where.get(p), "profile", p);
  for (const p of ["/whip.html", "/whip/", "/we-manufacture.html"]) assert.equal(where.get(p), "profile_only", `${p}: Whip Equipped lives only on Matthew's host`);
  for (const p of ["/mnet.html", "/listen.html", "/album.html", "/account.html", "/mccluster-corp.html", "/prim3.html"]) assert.equal(where.get(p), "platform", p);
});

/* What each page must say about where it lives, by the live stage's metadata switch:
   today (P0, P1) every canonical, og:url and WebSite names Matthew's host as it does now;
   by_set (from P2) each set's pages name their own host, site name and WebSite. */
function expectedMeta(set, metadata) {
  const tenant = { host: arch.tenants.matthew.host, siteName: arch.tenants.matthew.site_name, website: arch.tenants.matthew.website_id };
  if (metadata === "today") return tenant;
  if (metadata === "by_set") {
    if (set !== "platform") return tenant;
    return { host: new URL(arch.platform.origin).host, siteName: arch.platform.site_name, website: arch.platform.website_id };
  }
  throw new Error(`unknown metadata switch ${metadata}`);
}

test("each page's canonical, share card and WebSite follow the live stage's metadata switch", () => {
  const switches = Object.fromEntries(arch.edge.stages.filter((s) => s.switches).map((s) => [s.stage, s.switches.metadata]));
  assert.deepEqual(switches, { P0: "today", P1: "today", P2: "by_set", P3: "by_set", P4: "by_set" }, "metadata moves in P2 and never back");
  assert.deepEqual(expectedMeta("platform", "by_set"), { host: "mccluster.org", siteName: "McCluster Corp", website: "https://mccluster.org/#website" });
  assert.deepEqual(expectedMeta("profile", "by_set"), expectedMeta("profile", "today"));
  const metadata = switches[arch.edge.now.stage];
  const where = new Map(SETS.flatMap((set) => arch.url_ownership[set].map((p) => [p, set])));
  const wrong = [];
  for (const f of PAGES) {
    const set = where.get(urlPath(f));
    const want = expectedMeta(set, metadata);
    const html = read(f);
    for (const href of [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1])) {
      if (new URL(href).host !== want.host) wrong.push(`${f}: canonical ${href}`);
    }
    const ogUrl = meta(html, /<meta property="og:url" content="([^"]+)"/);
    if (ogUrl && new URL(ogUrl).host !== want.host) wrong.push(`${f}: og:url ${ogUrl}`);
    const site = meta(html, /<meta property="og:site_name" content="([^"]+)"/);
    if (site && site !== want.siteName) wrong.push(`${f}: og:site_name ${site}`);
    for (const block of ld(html)) for (const n of nodes(block)) {
      const part = n.isPartOf && n.isPartOf["@id"];
      if (part && part.endsWith("#website") && part !== want.website) wrong.push(`${f}: isPartOf ${part}`);
    }
  }
  assert.deepEqual(wrong, [], `stage ${arch.edge.now.stage} (metadata ${metadata}): pages that name the wrong host`);
  /* the platform's own root already speaks as the platform: the World's head on mccluster.org */
  const router = read("workers/mccluster/src/company-site/router.js");
  const companyOrigin = read("workers/mccluster/src/company-site/pages.generated.js").match(/export const COMPANY_ORIGIN = "([^"]+)"/)[1];
  assert.equal(companyOrigin, arch.platform.origin);
  assert.match(router, /export const WORLD_HEAD = \{\s*origin: COMPANY_ORIGIN,\s*siteName: 'McCluster Corp',/);
  assert.match(router, /isPartOf: \{ '@id': `\$\{COMPANY_ORIGIN\}\/#website` \}/);
  assert.equal(`${companyOrigin}/#website`, arch.platform.website_id);
});

test("today's @id set is unchanged: hosting moves URLs, never identifiers", () => {
  assert.equal(new Set(ID_FIXTURE).size, ID_FIXTURE.length, "the fixture has no duplicates");
  const ids = new Set();
  for (const f of PAGES) for (const block of ld(read(f))) for (const n of nodes(block)) if (typeof n["@id"] === "string") ids.add(n["@id"]);
  const added = [...ids].filter((i) => !ID_FIXTURE.includes(i)).sort();
  const gone = ID_FIXTURE.filter((i) => !ids.has(i));
  assert.deepEqual({ added, gone }, { added: [], gone: [] }, "an @id moved, vanished or appeared: @ids never follow a host; a new entity is added to ID_FIXTURE on purpose");
  assert.ok(ID_FIXTURE.includes(PERSON) && ID_FIXTURE.includes(ORG) && ID_FIXTURE.includes(WHIP));
});

test("the ownership hierarchy holds in the graph: Whip is Matthew's, the products are the company's", () => {
  const corpLinks = JSON.stringify([graph.organization.subOrganization, graph.organization.owns]);
  assert.ok(!corpLinks.includes(WHIP), "Whip Equipped LLC is never a McCluster Corp sub-organization or asset");
  assert.ok(graph.person.owns.some((x) => x["@id"] === WHIP), "Matthew owns Whip Equipped");
  assert.equal(graph.organizations.whip_equipped.founder["@id"], PERSON);
  assert.ok(!("parentOrganization" in graph.organizations.whip_equipped));
  assert.equal(graph.projects.equity_uprise.parentOrganization["@id"], ORG);
  assert.equal(graph.projects.prim3.parentOrganization["@id"], ORG);
  assert.equal(graph.software.action_network.publisher["@id"], ORG);
  assert.equal(graph.software.mccluster_platform.publisher["@id"], ORG);
  assert.equal(graph.creative_works.i_am_here.byArtist["@id"], PERSON, "I AM HERE is Matthew's album");
  assert.equal(arch.entities.whip_equipped.owner, "matthew_mccluster");
  for (const k of ["equity_uprise", "uprise_action_network", "prim3", "mccluster_platform"]) assert.equal(arch.entities[k].owner, "mccluster_corp", k);
});

test("no published page defines McCluster Corp at Matthew's address or names his site after the company", () => {
  for (const f of PAGES) {
    for (const block of ld(read(f))) {
      for (const n of nodes(block)) {
        if ((n["@id"] === ORG) || (n["@type"] === "Organization" && n.name === "McCluster Corp")) {
          assert.equal(n["@id"], ORG, `${f}: McCluster Corp must use the stable Organization @id`);
          if (n.url) assert.equal(n.url, "https://mccluster.org/", `${f}: McCluster Corp's url`);
        }
        if (n["@id"] === "https://matthew.mccluster.org/#website") {
          if (n.publisher) assert.equal(n.publisher["@id"], PERSON, `${f}: Matthew's site is published by Matthew`);
          assert.doesNotMatch(JSON.stringify([n.name, n.alternateName]), /McCluster Corp/, `${f}: Matthew's site is not named after the company`);
        }
        if (n["@id"] === ORG) for (const s of n.sameAs || []) assert.doesNotMatch(s, /instagram|tiktok|youtube|linkedin\.com\/in|github\.com/i, `${f}: personal accounts are not the company's`);
        if (n["@id"] === WHIP && n.parentOrganization) assert.notEqual(n.parentOrganization["@id"], ORG, `${f}: Whip is not under McCluster Corp`);
      }
    }
  }
});

test("Matthew's root shares as Matthew McCluster; the album is the door, not the identity", () => {
  const html = read("index.html");
  assert.match(meta(html, /<title>([^<]+)<\/title>/), /^Matthew McCluster/);
  assert.equal(meta(html, /<meta property="og:site_name" content="([^"]+)"/), "Matthew McCluster");
  assert.equal(meta(html, /<meta property="og:title" content="([^"]+)"/), "Matthew McCluster");
  assert.match(meta(html, /<meta property="og:description" content="([^"]+)"/), /Founder of McCluster Corp/);
  assert.match(meta(html, /<meta property="og:description" content="([^"]+)"/), /I AM HERE/, "the album stays the visual entrance");
  assert.equal(meta(html, /<link rel="canonical" href="([^"]+)"/), "https://matthew.mccluster.org/");
  assert.doesNotMatch(meta(html, /<title>([^<]+)<\/title>/), /^I AM HERE/);
  /* the album's own page keeps the album's metadata */
  assert.match(meta(read("album.html"), /<title>([^<]+)<\/title>/), /I AM HERE/);
});

test("McCluster Corp's company pages on the platform are generated, current, and company-first", () => {
  execFileSync("node", ["tools/build-company-site.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  const site = json("data/seo/company-site.json");
  assert.equal(site.origin, arch.platform.origin);
  assert.match(site.meta.title, /^McCluster Corp/);
  assert.doesNotMatch(JSON.stringify(site.meta), /I AM HERE/, "the company preview is not the album");
  assert.ok(site.doors.every((d) => d.entity === null || graph.projects[d.entity] || graph.software[d.entity]), "doors name real graph entities");
  assert.ok(!site.doors.some((d) => /whip/i.test(d.name + d.href)), "Whip Equipped is not a McCluster Corp door");
  assert.match(site.separate_note, /Whip Equipped LLC[\s\S]*separate company/);
  assert.doesNotMatch(JSON.stringify(site), /registered Connecticut public charity|is a registered public charity/i, "no current-charity claim");
  const mod = read("workers/mccluster/src/company-site/pages.generated.js");
  assert.match(mod, /export const COMPANY_ORIGIN = "https:\/\/mccluster\.org"/);
});

test("the agent-facing law says the same thing everywhere", () => {
  const contractFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    "CODEX.md",
    "GEMINI.md",
    ".cursorrules",
    ".cursor/rules/mccluster.mdc",
    ".github/copilot-instructions.md",
    ".github/instructions/mccluster.instructions.md",
  ];
  const contracts = Object.fromEntries(contractFiles.map((file) => [file, read(file)]));
  const claude = contracts["CLAUDE.md"], agents = contracts["AGENTS.md"], canon = json("docs/control-plane/canonical-architecture.json");
  for (const [file, body] of Object.entries(contracts)) {
    assert.match(body, /matthew\.mccluster\.org/, `${file}: must name Matthew's profile`);
    assert.match(body, /mccluster\.org/, `${file}: must name the platform`);
    assert.match(body, /platform/i, `${file}: must name the platform as the platform`);
    assert.doesNotMatch(body, /apex `?mccluster\.org`? (?:is|→|aliases) (?:the )?same property|apex `?mccluster\.org`? aliases it/i, `${file}: must not collapse the properties`);
    assert.doesNotMatch(body, /Two properties, two entities/, `${file}: the old rule 15 heading is gone`);
  }
  assert.doesNotMatch(claude, /apex `mccluster\.org` is the same property/);
  assert.doesNotMatch(agents, /→ same property, not a second site/);
  assert.ok(agents.includes(`15. **${HEADING_15}**`), "AGENTS.md hard rule 15 carries the new heading");
  assert.match(agents, /\*\*Hosting is not identity\.\*\*/);
  assert.match(agents, /`data\/seo\/domain-architecture\.json` → `platform\.origin`/, "the one setting is named in the law");
  assert.match(claude, /Never collapse McCluster Corp and Matthew McCluster/);
  assert.equal(canon.public_properties.platform.host, new URL(arch.platform.origin).host);
  assert.equal(canon.public_properties.platform.served_by, "worker:mccluster", "the platform rides the one Worker; no second Worker");
  assert.equal(canon.public_properties.platform.entity, arch.platform.operator);
  assert.equal(canon.public_properties.tenants.matthew.host, arch.tenants.matthew.host);
  assert.equal(canon.public_properties.tenants.matthew.entity, arch.tenants.matthew.entity);
  assert.equal(canon.public_properties.company.entity, canon.public_properties.platform.entity, "the v1 alias names the same entity");
  assert.equal(canon.planes.public_edge.worker, "mccluster");
  const brands = json("data/brands.json");
  const b = (s) => brands.brands.find((x) => x.slug === s);
  assert.equal(b("prim3").segment, "projects");
  assert.doesNotMatch(JSON.stringify(b("prim3")), /recording alias|pseudonym|records under/i, "PRIM3 is the company's learning product");
  assert.match(b("whip-equipped").summary, /separate company from McCluster Corp/);
  assert.ok(!JSON.stringify(b("mccluster-corp").divisions || []).match(/Whip/), "Whip is not a McCluster Corp division");
  assert.equal(b("equity-uprise").segment, "projects");
  assert.doesNotMatch(JSON.stringify(brands), /registered as a public charity in Connecticut|ran the Docket 516R fight/);
});

/* AGENTS.md is the only file with prose rules. Every vendor adapter is a thin pointer: it names
   all fifteen hard-rule headings, carries the AI-HARNESS gate, sends building work to the local
   contract, and copies none of the Equity Uprise block (no floor file lists, no program status,
   no geometry, no retired branch). The building block itself cites Floor 1 only by the authority
   the hygiene verifier calls canonical. */
test("the adapters are thin pointers at AGENTS.md: every hard-rule heading, no copied building block", () => {
  const agents = read("AGENTS.md");
  const hardRules = agents.split("## Hard rules")[1].split("\n## ")[0];
  const headings = [...hardRules.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(headings.map(([n]) => n), Array.from({ length: 15 }, (_, i) => i + 1), "AGENTS.md carries hard rules 1–15");
  assert.equal(headings[14][1], HEADING_15, "hard rule 15 is the one-platform rule");
  assert.match(agents, /^## AI work: read the harness first$/m, "the AI-HARNESS read gate is law, not a vendor courtesy");
  assert.match(agents, /^## Autonomous operations contract$/m, "the unattended-agent contract applies to every agent");
  assert.match(agents, /docs\/design\/equity-uprise-building\/AGENTS\.md/, "AGENTS.md sends building work to the local contract");
  const verifier = read("docs/design/equity-uprise-building/production/verify_equity_uprise_authority_hygiene.py");
  const canonicalF1 = verifier.match(/canonical_f1=BUILDING\/"([^"]+)"/)[1];
  for (const m of agents.matchAll(/FLOOR-01-[A-Z0-9-]+-360-SPEC\.md/g)) assert.equal(m[0], canonicalF1, "AGENTS.md cites Floor 1 only by its canonical authority");
  for (const stale of ["locked six-floor", "architecture/equity-uprise-core-v2", "only Floor 1 is currently program-reconciled", "FLOOR-01-LOBBY-INTAKE-360-SPEC.md"]) assert.ok(!agents.includes(stale), `AGENTS.md: retired wording "${stale}"`);
  const adapters = ["CLAUDE.md", "CODEX.md", "GEMINI.md", ".cursorrules", ".cursor/rules/mccluster.mdc", ".github/copilot-instructions.md", ".github/instructions/mccluster.instructions.md"];
  for (const f of adapters) {
    const body = read(f);
    assert.match(body, /AGENTS\.md/, `${f}: points at AGENTS.md`);
    assert.match(body, /docs\/control-plane\/AI-HARNESS\.md/, `${f}: carries the AI-HARNESS read gate`);
    assert.match(body, /Hard rules[^\n]*AGENTS\.md/, `${f}: says the hard rules live in AGENTS.md`);
    for (const [n, h] of headings) assert.ok(body.includes(`${n}. ${h}`), `${f}: names hard rule ${n} by number and heading (${h})`);
    assert.match(body, /docs\/design\/equity-uprise-building\/AGENTS\.md/, `${f}: sends Equity Uprise spatial work to the local contract`);
    assert.match(body, /docs\/design\/equity-uprise-building\/REFERENCE-AUTHORITY\.md/, `${f}: and to the reference authority`);
    assert.match(body, /docs\/uprise-world\//, `${f}: points at the Uprise World gate`);
    assert.match(body, /assets\/3d\/prim3-site0\/AGENTS\.md/, `${f}: points at the Site 0 gate`);
    for (const stale of ["FLOOR-0", "locked six-floor", "architecture/equity-uprise-core-v2", "program-reconciled", "X54–62", "Y54–72"]) assert.ok(!body.includes(stale), `${f}: carries no copy of the building block ("${stale}")`);
  }
  assert.match(read("CLAUDE.md"), /`AGENTS\.md` → Hard rules → 14\./, "CLAUDE.md's mobile rule points at hard rule 14");
  assert.match(read(".github/copilot-instructions.md"), /AGENTS\.md` → "Autonomous operations contract"/, "Copilot points at the moved contract");
  const kit = "`CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/mccluster.mdc`, `.github/copilot-instructions.md`, `.github/instructions/mccluster.instructions.md`";
  for (const f of ["AGENTS.md", "docs/control-plane/ECOSYSTEM.md", "docs/control-plane/SATELLITE.md"]) assert.ok(read(f).includes(kit), `${f}: names the same seven-file satellite kit`);
  for (const f of ["docs/control-plane/ECOSYSTEM.md", "docs/control-plane/SATELLITE.md"]) assert.match(read(f), /never copy|never copied/i, `${f}: satellites never copy the building block`);
});
