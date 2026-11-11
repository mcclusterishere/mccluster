/* TWO PROPERTIES, TWO ENTITIES.

   https://mccluster.org/ is McCluster Corp's house; https://matthew.mccluster.org/
   is Matthew McCluster's. These checks keep the two from collapsing back into
   one: the graph, the root metadata of each property, the ownership hierarchy
   (Whip Equipped is Matthew's separate company; PRIM3 is the company's
   learning product), and the generated company property itself.
   Authority: data/seo/domain-architecture.json, docs/control-plane/DOMAINS-AND-ENTITIES.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));
const arch = json("data/seo/domain-architecture.json");
const graph = json("data/seo/entity-graph.json");
const PERSON = "https://matthew.mccluster.org/#matthew-mccluster";
const ORG = "https://matthew.mccluster.org/#mccluster-corp";
const WHIP = "https://matthew.mccluster.org/whip.html#whip-equipped";

const STRIPPED = new Set(["docs", "packages", "apps", "scripts", "supabase", ".github", "tests", "node_modules", "redirects", "tools", "_unfinished", "workers", ".git", "core", "PRIM3"]);
function publishedHtml(dir = "") {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (!dir && STRIPPED.has(e.name)) continue;
    if (e.isDirectory()) { if (!e.name.startsWith(".")) out.push(...publishedHtml(rel)); }
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}
function nodes(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => nodes(x, out));
  else if (v && typeof v === "object") { out.push(v); Object.values(v).forEach((x) => nodes(x, out)); }
  return out;
}
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const meta = (html, re) => (html.match(re) || [])[1];

test("the authority names two properties, two entities, and keeps the stable @ids", () => {
  assert.equal(arch.properties.company.origin, "https://mccluster.org");
  assert.equal(arch.properties.personal.origin, "https://matthew.mccluster.org");
  assert.equal(arch.properties.company.entity, ORG);
  assert.equal(arch.properties.personal.entity, PERSON);
  assert.equal(graph.person["@id"], PERSON);
  assert.equal(graph.organization["@id"], ORG, "the Organization @id must not move: every page joins on it");
  assert.equal(graph.person.url, "https://matthew.mccluster.org/matthew-mccluster.html");
  assert.equal(graph.organization.url, "https://mccluster.org/", "the Organization's url is the company property");
  assert.equal(arch.entities.mccluster_corp.url, graph.organization.url);
  assert.equal(arch.entities.matthew_mccluster.url, graph.person.url);
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
  for (const f of publishedHtml()) {
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

test("McCluster Corp's property is generated, current, and company-first", () => {
  execFileSync("node", ["tools/build-company-site.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  const site = json("data/seo/company-site.json");
  assert.equal(site.origin, arch.properties.company.origin);
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
    assert.match(body, /matthew\.mccluster\.org/, `${file}: must name Matthew's property`);
    assert.match(body, /mccluster\.org/, `${file}: must name McCluster Corp's property`);
    assert.doesNotMatch(body, /apex `?mccluster\.org`? (?:is|→|aliases) (?:the )?same property|apex `?mccluster\.org`? aliases it/i, `${file}: must not collapse the properties`);
  }
  assert.doesNotMatch(claude, /apex `mccluster\.org` is the same property/);
  assert.doesNotMatch(agents, /→ same property, not a second site/);
  assert.match(agents, /Two properties, two entities\. Never collapse them\./);
  assert.match(claude, /Never collapse McCluster Corp and Matthew McCluster/);
  assert.equal(canon.public_properties.company.host, "mccluster.org");
  assert.equal(canon.public_properties.company.served_by, "worker:mccluster", "the company host rides the one Worker; no second Worker");
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
