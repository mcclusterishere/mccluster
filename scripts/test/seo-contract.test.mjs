/* THE SEO CONTRACT: the invariants that keep the site findable and true.

     node --test scripts/test/seo-contract.test.mjs

   Every check here guards a mistake this site has actually made: a page in
   the sitemap that told Google not to index it, one person described as
   two graph nodes, a Person and a web page fused into one object, an
   alumniOf for a school he is still attending, structured-data prices that
   disagreed with the page, a full-screen dialog over the résumé, links
   labelled "Newsroom" that went back to the page they were on, and a
   sitemap dated by whoever last ran a script. Dependency-free on purpose,
   so it runs anywhere node does. See docs/SEO-AEO-AUTHORITY-SYSTEM.md. */
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
const graph = JSON.parse(read("data/entity-graph.json"));

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

test("the generated blocks match their sources (entity graph, offers, catalogue, newsroom)", () => {
  for (const tool of ["build-entity-jsonld", "build-offer-jsonld", "build-catalogue", "build-newsroom"]) {
    execFileSync("node", [`tools/seo/${tool}.mjs`, "--check"], { cwd: ROOT, stdio: "pipe" });
  }
});

test("the sitemaps are current, and every mapped page exists, is indexable and canonical to itself", () => {
  /* structure, not dates: deploy-pages.yml re-dates the map from git history */
  execFileSync("node", ["tools/seo/build-sitemaps.mjs", "--check-structure"], { cwd: ROOT, stdio: "pipe" });
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
  let profilePages = 0;
  const canonicalSameAs = new Set(graph.person.sameAs);
  for (const f of publishedHtml()) {
    for (const b of ldBlocks(read(f))) {
      for (const n of nodes(JSON.parse(b))) {
        const t = types(n);
        assert.ok(!(t.includes("Person") && t.includes("ProfilePage")), `${f}: a node cannot be both a Person and a web page`);
        if (t.includes("ProfilePage")) { profilePages++; assert.equal(f, "matthew-mccluster.html", `${f}: only the profile is a ProfilePage`); }
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
          for (const s of n.sameAs || []) assert.ok(canonicalSameAs.has(s), `${f}: sameAs ${s} is not in data/entity-graph.json`);
        }
      }
    }
  }
  assert.equal(profilePages, 1, "exactly one ProfilePage");
});

test("organizations are not conflated with their programs or with personal accounts", () => {
  const corpSameAs = new Set(graph.organizations.find((o) => o["@id"].endsWith("#mccluster-corp")).sameAs);
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
  const scsu = graph.person.affiliation.find((a) => a.name === "Southern Connecticut State University");
  assert.ok(scsu, "the entity graph records the SCSU enrollment");
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
    "docket-516.html", "engineering/index.html", "engineering/ipc-data-center.html", "engineering/mccluster-platform.html", "catalogue.html", "hire.html"];
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
  const ledger = JSON.parse(read("docs/seo/evidence-ledger.json"));
  const html = read("newsroom.html");
  const rendered = [...html.matchAll(/<li id="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(rendered.length > 0, "the newsroom is empty");
  for (const id of rendered) {
    const e = ledger.entries.find((x) => x.story_id === id);
    assert.ok(e, `${id}: rendered but not in the ledger`);
    assert.equal(e.verification_status, "verified", `${id}: rendered without verification`);
    assert.equal(e.publication_status, "publish", `${id}: rendered without being marked for publication`);
    assert.ok(e.evidence_urls.length > 0, `${id}: no evidence`);
    assert.ok(e.publish_date >= String(e.event_date), `${id}: publish date before the event`);
    for (const u of e.evidence_urls.filter((u) => u.startsWith(SITE))) {
      assert.ok(existsSync(join(ROOT, fileFor(u))), `${id}: evidence ${u} is missing`);
    }
  }
  for (const e of ledger.entries) {
    if (e.verification_status !== "verified" || e.publication_status !== "publish") {
      assert.ok(!rendered.includes(e.story_id), `${e.story_id}: unverified or held, but rendered`);
    }
  }
});

test("public document pages show the privacy notice as a banner, and recording still waits for it", () => {
  const live = read("js/live-content.js");
  assert.match(live, /meta\[name="mcc-privacy-notice"\]/);
  assert.match(live, /@media print\{#mccPrivacyNotice\{display:none!important\}\}/, "the banner must never print onto a résumé");
  assert.match(read("js/analytics.js"), /if \(mccPrivacyAcknowledged\(\)\) \{/, "analytics still waits for acknowledgement");
  const must = ["matthew-mccluster.html", "resume-it-support.html", "press.html", "services.html", "newsroom.html",
    "docket-516.html", "engineering/index.html", "engineering/ipc-data-center.html", "engineering/mccluster-platform.html", "hire.html", "catalogue.html"];
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
  const money = recs.find((r) => r.name === "Money or the Power");
  assert.ok(money && money.byArtist && money.byArtist.name === "Old Jay", "Money or the Power is Old Jay's record");
  const cat = JSON.parse(read("data/catalogue.json"));
  for (const t of cat.tracks.filter((t) => t.gated)) {
    assert.ok(!html.includes(t.title), `the gated title "${t.title}" must not be written into the page`);
  }
  for (const r of recs) assert.match(r.isrcCode || "", /^QT6KV\d{7}$/, `${r.name}: ISRC`);
});
