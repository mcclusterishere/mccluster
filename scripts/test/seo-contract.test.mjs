/* THE SEO CONTRACT: the invariants that keep the site findable and true.

     node --test scripts/test/seo-contract.test.mjs

   Every check here guards a mistake this site has actually made: a page in
   the sitemap that told Google not to index it, one person described as
   two graph nodes, a Person and a web page fused into one object, an
   alumniOf for a school he is still attending, structured-data prices that
   disagreed with the page, a full-screen dialog over the résumé, links
   labelled "Newsroom" that went back to the page they were on, and a
   sitemap dated by whoever last ran a script. Dependency-free on purpose,
   so it runs anywhere node does. scripts/test/seo-authority.test.mjs holds
   the companion checks (entity graph shape, generators, recruiter lanes);
   this file holds the cross-site invariants. See
   docs/SEO-AEO-AUTHORITY-SYSTEM.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = "https://matthew.mccluster.org";
const PERSON = `${SITE}/#matthew-mccluster`;
const PROFILE = `${SITE}/matthew-mccluster.html`;
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const graph = JSON.parse(read("data/seo/entity-graph.json"));
const PROFILE_PAGE = `${PROFILE}#profile-page`;

/* the published tree: what deploy-pages.yml leaves after stripping internals */
const STRIPPED = new Set(["docs", "packages", "apps", "scripts", "supabase", ".github", "tests", "node_modules", "redirects", "tools", "_unfinished", "workers", ".git"]);
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

function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}
function nodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => nodes(v, out));
  else if (value && typeof value === "object") { out.push(value); Object.values(value).forEach((v) => nodes(v, out)); }
  return out;
}
const types = (n) => [].concat(n["@type"] || []);

function sitemapUrls() {
  return [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
function fileFor(url) {
  let p = url.slice(SITE.length + 1);
  if (p === "" || p.endsWith("/")) p += "index.html";
  return p;
}
const meta = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const ENGINEERING = ["engineering/index.html", "engineering/it-support-systems.html", "engineering/data-center-networking.html",
  "engineering/mccluster-platform.html", "engineering/field-technology-telematics.html", "engineering/ipc-infrastructure.html",
  "engineering/recruiter-role-map.html"];

test("the music catalogue markup matches its data, and llms.txt says only what is true", () => {
  /* profile, hire, newsroom and sitemap generators are checked by seo-authority.test.mjs */
  execFileSync("node", ["tools/build-catalogue.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  execFileSync("python3", ["tools/verify-llms.py"], { cwd: ROOT, stdio: "pipe" });
});

test("the sitemaps are current, and every mapped page exists, is indexable and canonical to itself", () => {
  /* tools/build-sitemap.mjs --check (pages, images, video; not dates, which
     deploy-pages.yml writes from git history) runs in seo-authority.test.mjs */
  const urls = sitemapUrls();
  assert.ok(urls.length >= 30, "the map lost pages");
  assert.equal(new Set(urls).size, urls.length, "a URL is listed twice");
  for (const u of urls) {
    assert.ok(u.startsWith(SITE + "/"), `${u}: not on the canonical host`);
    const f = fileFor(u);
    assert.ok(existsSync(join(ROOT, f)), `${u}: no file ${f}`);
    const html = read(f);
    assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/i, `${f} is in the sitemap but says noindex`);
    const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(canon, [u], `${f}: canonical must be exactly ${u}`);
  }
  assert.match(read("sitemap.xml"), /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.doesNotMatch(read("sitemap.xml"), /<priority>|<changefreq>/, "Google ignores both; do not maintain them");
});

test("every mapped page has a unique title, a description, and social metadata that agrees with its canonical", () => {
  const titles = new Map();
  for (const u of sitemapUrls()) {
    const f = fileFor(u), html = read(f);
    const title = meta(html, /<title>([^<]+)<\/title>/);
    assert.ok(title && title.trim().length > 10, `${f}: missing or empty <title>`);
    assert.ok(!titles.has(title), `${f}: same <title> as ${titles.get(title)}`);
    titles.set(title, f);
    const desc = meta(html, /<meta name="description" content="([^"]*)"/);
    assert.ok(desc && desc.length >= 50, `${f}: missing or thin meta description`);
    const ogUrl = meta(html, /<meta property="og:url" content="([^"]+)"/);
    if (ogUrl) assert.equal(ogUrl, u, `${f}: og:url disagrees with the canonical`);
  }
});

test("every JSON-LD block on the published site parses", () => {
  for (const f of publishedHtml()) {
    for (const b of ldBlocks(read(f))) {
      assert.doesNotThrow(() => JSON.parse(b), `${f}: JSON-LD does not parse`);
    }
  }
});

test("one person, one node: the Person is defined on the profile and referenced everywhere else", () => {
  let canonicalProfiles = 0;
  const canonicalSameAs = new Set(graph.person.sameAs);
  for (const f of publishedHtml()) {
    for (const b of ldBlocks(read(f))) {
      for (const n of nodes(JSON.parse(b))) {
        const t = types(n);
        assert.ok(!(t.includes("Person") && t.includes("ProfilePage")), `${f}: a node cannot be both a Person and a web page`);
        if (t.includes("ProfilePage")) {
          /* the recruiter lane pages are profile views too; all of them must be about the one Person,
             and only the profile page may claim the canonical profile @id */
          assert.equal((n.mainEntity || {})["@id"], PERSON, `${f}: a ProfilePage about somebody other than the canonical Person`);
          if (n["@id"] === PROFILE_PAGE) { canonicalProfiles++; assert.equal(f, "matthew-mccluster.html", `${f}: claims the canonical profile @id`); }
        }
        if (t.includes("Person") && n.name === "Matthew McCluster") {
          assert.equal(n["@id"], PERSON, `${f}: a Matthew McCluster node without the canonical @id`);
        }
        if (n["@id"] !== PERSON) continue;
        if (n.url) assert.equal(n.url, PROFILE, `${f}: the Person's url must be the profile page`);
        assert.ok(!("founder" in n), `${f}: founder is an Organization property, not a Person one`);
        if (f !== "matthew-mccluster.html") {
          for (const k of ["jobTitle", "knowsAbout", "alumniOf", "hasCredential", "hasOccupation", "award"]) {
            assert.ok(!(k in n), `${f}: restates the Person's ${k}; reference the @id instead`);
          }
          for (const s of n.sameAs || []) assert.ok(canonicalSameAs.has(s), `${f}: sameAs ${s} is not in data/seo/entity-graph.json`);
        }
      }
    }
  }
  assert.equal(canonicalProfiles, 1, "exactly one canonical ProfilePage");
});

test("organizations are not conflated with their programs or with personal accounts", () => {
  const corpSameAs = new Set(graph.organization.sameAs);
  for (const f of publishedHtml()) {
    for (const b of ldBlocks(read(f))) {
      for (const n of nodes(JSON.parse(b))) {
        if (n["@id"] !== `${SITE}/#mccluster-corp`) continue;
        assert.notEqual(n.alternateName, "Equity Uprise", `${f}: Equity Uprise is a program of McCluster Corp, not its other name`);
        for (const s of n.sameAs || []) assert.ok(corpSameAs.has(s), `${f}: ${s} is not a McCluster Corp profile`);
      }
    }
  }
});

test("education is stated as it is: a current student is not an alumnus", () => {
  for (const f of publishedHtml()) {
    for (const b of ldBlocks(read(f))) {
      for (const n of nodes(JSON.parse(b))) {
        for (const a of [].concat(n.alumniOf || [])) {
          assert.doesNotMatch(JSON.stringify(a), /Southern Connecticut/i, `${f}: SCSU is a current enrollment (affiliation), not alumniOf`);
        }
      }
    }
  }
  assert.equal(graph.education.scsu.name, "Southern Connecticut State University");
  assert.ok(graph.person.affiliation.some((a) => a["@id"] === graph.education.scsu["@id"]), "the entity graph records the SCSU enrollment as an affiliation");
  assert.ok(![].concat(graph.person.alumniOf || []).some((a) => /Southern Connecticut/.test(JSON.stringify(a))), "SCSU is not alumniOf");
  for (const f of ["matthew-mccluster.html", "resume-it-support.html", "engineering/index.html"]) {
    assert.match(read(f), /Southern Connecticut State University/, `${f}: education section missing`);
  }
});

test("the profile's visible identity links and its sameAs list agree", () => {
  const html = read("matthew-mccluster.html");
  const find = html.slice(html.indexOf('<div class="find">'), html.indexOf("</div>", html.indexOf('<div class="find">')));
  const links = [...find.matchAll(/href="([^"]+)"[^>]*rel="me/g)].map((m) => m[1]);
  assert.deepEqual(new Set(links), new Set(graph.person.sameAs), "rendered rel=me links and sameAs must match");
});

test("links on the authority pages go somewhere real, and nothing labelled elsewhere points at itself", () => {
  const pages = ["matthew-mccluster.html", "resume-it-support.html", "press.html", "services.html", "newsroom.html",
    "docket-516.html", "catalogue.html", "hire.html", ...ENGINEERING];
  for (const f of pages) {
    const html = read(f);
    const base = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
    for (const m of html.matchAll(/<a\s[^>]*href="([^"#?]*)(?:[?#][^"]*)?"[^>]*>([\s\S]*?)<\/a>/g)) {
      let href = m[1];
      if (!href || /^(mailto:|tel:|https?:|javascript:|data:)/.test(href)) {
        if (href.startsWith(SITE)) href = href.slice(SITE.length); else continue;
      }
      if (href.includes("' +") || href.includes("${")) continue;           // inside a script template
      let target = href.startsWith("/") ? href.slice(1) : base + href;
      while (target.includes("../")) target = target.replace(/[^/]*\/\.\.\//, "");
      if (target === "" || target.endsWith("/")) target += "index.html";
      assert.ok(existsSync(join(ROOT, target)), `${f}: link to ${m[1]} has no file`);
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (target === f && /newsroom|faq|résumé|street credit/i.test(text)) {
        assert.fail(`${f}: "${text}" links back to the page it is on`);
      }
    }
  }
});

test("the newsroom publishes only verified, evidenced entries and never backdates", () => {
  const ledger = JSON.parse(read("data/seo/evidence-ledger.json"));
  const html = read("newsroom.html");
  const feed = read("feed.xml");
  const rendered = [...html.matchAll(/<li id="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(rendered.length > 0, "the newsroom is empty");
  for (const id of rendered) {
    const e = ledger.items.find((x) => x.id === id);
    assert.ok(e, `${id}: rendered but not in the ledger`);
    assert.equal(e.verification_status, "verified", `${id}: rendered without verification`);
    assert.equal(e.publish, true, `${id}: rendered without being marked for publication`);
    assert.ok(e.evidence.length > 0, `${id}: no evidence`);
    assert.ok(e.published >= String(e.date), `${id}: published before the thing happened`);
    for (const ev of e.evidence.filter((ev) => ev.path)) {
      assert.ok(existsSync(join(ROOT, ev.path.endsWith("/") ? ev.path + "index.html" : ev.path)), `${id}: evidence ${ev.path} is missing`);
    }
    /* the feed and the markup carry the publication date, never the event date passed off as news */
    assert.match(feed, new RegExp(`newsroom\\.html#${id}"/>\\s*<published>${e.published}T`), `${id}: feed must be dated by publication`);
  }
  for (const e of ledger.items) {
    if (e.verification_status !== "verified" || e.publish !== true) {
      assert.ok(!rendered.includes(e.id), `${e.id}: unverified or held, but rendered`);
    }
  }
  /* the internal review notes never ship */
  assert.ok(!existsSync(join(ROOT, "data/seo/evidence-review.json")), "review notes belong under docs/, which is not deployed");
  assert.doesNotMatch(JSON.stringify(ledger), /owner_action|Kevin/, "internal notes in the public ledger");
});

test("public document pages show the privacy notice as a banner, and recording still waits for it", () => {
  const live = read("js/live-content.js");
  assert.match(live, /meta\[name="mcc-privacy-notice"\]/);
  assert.match(live, /@media print\{#mccPrivacyNotice\{display:none!important\}\}/, "the banner must never print onto a résumé");
  assert.match(read("js/analytics.js"), /if \(mccPrivacyAcknowledged\(\)\) \{/, "analytics still waits for acknowledgement");
  const must = ["matthew-mccluster.html", "resume-it-support.html", "press.html", "services.html", "newsroom.html",
    "docket-516.html", "hire.html", "catalogue.html", ...ENGINEERING];
  for (const f of must) {
    const html = read(f);
    const m = html.indexOf('<meta name="mcc-privacy-notice" content="banner">');
    const s = html.search(/<script src="[^"]*js\/live-content\.js/);
    assert.ok(m > 0 && s > m, `${f}: the banner meta must come before live-content.js`);
    assert.doesNotMatch(html, /user-scalable=no/, `${f}: blocks pinch zoom`);
  }
});

test("robots.txt lets crawlers reach every mapped page and names both sitemaps", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^Sitemap: https:\/\/matthew\.mccluster\.org\/sitemap\.xml$/m);
  assert.match(robots, /^Sitemap: https:\/\/matthew\.mccluster\.org\/sitemap-video\.xml$/m);
  const disallowed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]);
  for (const u of sitemapUrls()) {
    const path = "/" + u.slice(SITE.length + 1);
    assert.ok(!disallowed.some((d) => path === d || (d.endsWith("/") && path.startsWith(d))), `${u} is mapped but disallowed`);
  }
});

test("structured data on the booking page only prices what the ledger approved", () => {
  const html = read("hire.html");
  const ld = JSON.parse(ldBlocks(html)[0]);
  const prices = nodes(ld).filter((n) => types(n).includes("Offer")).map((n) => n.price ?? (n.priceSpecification || {}).price ?? (n.priceSpecification || {}).minPrice).filter((x) => x != null);
  assert.ok(prices.length >= 5);
  assert.ok(!prices.includes(2800), "the retired $2,800 Limited Offer is back in the markup");
  assert.ok(!nodes(ld).some((n) => "alumniOf" in n), "the booking page must not restate education");
});

test("the music graph credits only what the site states, and never prints a gated title", () => {
  const html = read("catalogue.html");
  const ld = JSON.parse(ldBlocks(html)[0]);
  const recs = nodes(ld).filter((n) => types(n).includes("MusicRecording") && n["@id"]);
  assert.ok(recs.length >= 10);
  /* Docket 516R is billed to Equity Uprise, the program's own music act
     (owner, 2026-10-03); the performers on each record are contributors */
  const act = nodes(ld).find((n) => n["@id"] === "https://matthew.mccluster.org/catalogue.html#artist-equity-uprise");
  assert.ok(act && types(act).includes("MusicGroup") && act.name === "Equity Uprise", "the Equity Uprise act is its own MusicGroup");
  const album = nodes(ld).find((n) => n["@id"] === "https://matthew.mccluster.org/catalogue.html#album-equity-uprise");
  assert.equal(album.name, "Docket 516R");
  assert.equal(album.byArtist["@id"], act["@id"]);
  const names = (r) => [].concat(r.contributor || []).map((c) => c.name || c["@id"]);
  const money = recs.find((r) => r.name === "Money or the Power");
  assert.equal(money.byArtist["@id"], act["@id"]);
  assert.deepEqual(names(money), ["Ocho", "https://matthew.mccluster.org/#matthew-mccluster", "Old Jay"]);
  assert.equal(money.producer.name, "PAX");
  const free = recs.find((r) => r.name === "Please Set Me Free");
  assert.deepEqual(names(free), ["Los Fidel"]);
  assert.equal(free.producer["@id"], "https://matthew.mccluster.org/#matthew-mccluster", "the beat is his: a producer credit, not an artist credit");
  const env = recs.find((r) => r.name === "Environmental Injustice");
  assert.deepEqual(names(env), ["https://matthew.mccluster.org/#matthew-mccluster", "Angel Kastro", "Ocho"]);
  assert.doesNotMatch(html + read("data/albums.json") + read("docket-516.html") + read("data/lyrics/environmental-injustice.json") + read("data/lyrics/environmental-injustice-brave.json"), /Evangelist Angel|Angel Castro|Old Jay ft\. Ocho|prod\. Pax\b/, "superseded credits are gone");
  const cat = JSON.parse(read("data/catalogue.json"));
  for (const t of cat.tracks.filter((t) => t.gated)) {
    assert.ok(!html.includes(t.title), `the gated title "${t.title}" must not be written into the page`);
  }
  for (const r of recs) assert.match(r.isrcCode || "", /^QT6KV\d{7}$/, `${r.name}: ISRC`);
});
