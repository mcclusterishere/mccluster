/* THE RETIRED TAGLINE STAYS OFF EVERY PUBLIC SURFACE.

   Owner, 2026-11-17 (docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, "Owner decisions (2026-11-17, answered in
   session)"): the tagline "is removed from the World's sign-in panel and the /company footer, and from anywhere else it is
   public". No replacement was supplied, so none is written: the sentence around it stays as it was.

   Public means what a visitor can be served:
   - the tree GitHub Pages publishes from this repository: every tracked file except what the "Strip the internals" step of
     .github/workflows/deploy-pages.yml deletes, read from that step's own rm lines (as scripts/test/publish-strip-parity.test.mjs
     reads them). docs/ is out by the same rule that keeps it off the site: dated records keep the words they were written with;
   - what Worker mccluster serves on mccluster.org: its source (workers/mccluster/src), and the /company pages generated from
     data/seo/company-site.json by tools/build-company-site.mjs, read as a visitor gets them.
   The World's sign-in panel (mnet.html, #mnSignedOut) is being redesigned separately under the same decision, and the
   redesign removes the line. Until it lands, that one element is left out of the scan exactly as it stood on 2026-11-18 and
   no longer: its sha256 is pinned below, so any change to the panel (the redesign landing, or a line added to the old panel)
   ends the exception and the panel is read like the rest of the page (review LDR-F5, 2026-11-18: the exception had no end,
   and a new line carrying the tagline inside the panel passed).

   Dependency-free; the root suite runs it (node --test scripts/test/*.test.mjs). */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
/* any case, any spacing or punctuation between the four words, a non-breaking space written either way */
const words = (s) => String(s).replace(/&nbsp;|&#160;|&#xa0;| /gi, " ");
const RETIRED = /get\W*your\W*hu\W*up/i;

/* the arguments of the one `rm <flag> …` line in the deploy's strip step */
const workflow = read(".github/workflows/deploy-pages.yml").replace(/\\\n\s*/g, " ");
function rmArguments(flag) {
  const lines = workflow.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`rm ${flag} `));
  assert.equal(lines.length, 1, `deploy-pages.yml strips with exactly one "rm ${flag}" line`);
  return lines[0].slice(`rm ${flag} `.length).split(/\s+/).filter(Boolean);
}
const strippedDirs = rmArguments("-rf");
const strippedFiles = new Set(rmArguments("-f"));
const TEXT = /\.(?:html?|m?js|cjs|css|json|txt|xml|svg|md|webmanifest)$/i;
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0").filter((f) => f && existsSync(join(ROOT, f)));
const published = tracked.filter((f) => TEXT.test(f) && !strippedFiles.has(f) && !strippedDirs.some((d) => f === d || f.startsWith(d + "/")));
const workerSource = tracked.filter((f) => TEXT.test(f) && f.startsWith("workers/mccluster/src/"));

/* one element of a page, found by its id and closed by its own tag, nested ones of the same tag counted: [start, end) */
function elementSpan(html, id) {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf("<", at);
  const tag = /^<([a-z][a-z0-9-]*)/i.exec(html.slice(start))[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return [start, re.lastIndex];
  }
  throw new Error(`#${id} never closes in the page`);
}
const elementOf = (html, id) => { const span = elementSpan(html, id); return span ? html.slice(span[0], span[1]) : null; };
function withoutElement(html, id) {
  const span = elementSpan(html, id);
  return span ? html.slice(0, span[0]) + html.slice(span[1]) : html;
}
/* the sign-in panel exactly as it stood on 2026-11-18 (line endings aside): the only thing this guard leaves out */
const SIGN_IN_PANEL_2026_11_18 = "4189a8939dc2e89ccc4abf2413a8a5324e18760f3b14817e469de3db4fb34c50";
const sha256 = (text) => createHash("sha256").update(String(text).replace(/\r\n/g, "\n")).digest("hex");
const panelExcused = (html) => { const panel = elementOf(html, "mnSignedOut"); return !!panel && sha256(panel) === SIGN_IN_PANEL_2026_11_18; };
const worldText = (html) => (panelExcused(html) ? withoutElement(html, "mnSignedOut") : html);
const publicText = (f) => (f === "mnet.html" ? worldText(read(f)) : read(f));

test("the scan covers the public tree and the Worker, and not the records", () => {
  assert.ok(published.length > 500, `the published tree has its pages, scripts and data (${published.length} text files)`);
  for (const f of ["mnet.html", "action/index.html", "heal-the-3rd-world.html", "mccluster-corp.html", "js/member-desk.js", "data/seo/company-site.json"]) {
    assert.ok(published.includes(f), `${f} is published`);
  }
  assert.ok(workerSource.includes("workers/mccluster/src/company-site/pages.generated.js"), "the generated /company pages are read");
  assert.ok(!published.some((f) => f.startsWith("docs/")), "docs/ is stripped from the site and keeps its dated records");
  /* the one element left to the sign-in redesign is cut out by its own tag, and nothing after it */
  const world = read("mnet.html"), cut = withoutElement(world, "mnSignedOut");
  assert.ok(cut.length < world.length && !cut.includes('id="mnSignedOut"'), "the sign-in panel is the only part left out");
  assert.ok(cut.includes('id="mnFeedScope"') && cut.includes('id="mnMissionDialog"') && /<\/html>\s*$/.test(cut), "the rest of the World is read");
});

test("the sign-in panel is left out only as it stood on 2026-11-18: a line added to it, or the redesign, is read", () => {
  const world = read("mnet.html");
  const panel = elementOf(world, "mnSignedOut");
  assert.ok(panel, "the World has its sign-in panel");
  /* the review's probe (LDR-F5): one more line inside the panel, which used to pass */
  const open = world.indexOf(">", world.indexOf('id="mnSignedOut"')) + 1;
  const probed = world.slice(0, open) + '\n      <p class="mn__hint">Get Your Hu Up! (review probe)</p>' + world.slice(open);
  assert.equal(panelExcused(probed), false, "a changed panel is no longer the one excused");
  assert.match(words(worldText(probed)), RETIRED, "so the guard reads it, and the probe is caught");
  /* the redesign landing: a panel without the line is read with the rest of the page, and passes */
  const redesigned = world.slice(0, open) + '\n      <p class="mn__hint">(the redesigned panel)</p>' + world.slice(open).replace(/<p class="mn__lede">Get Your Hu Up!<\/p>/, "");
  assert.equal(worldText(redesigned), redesigned, "a redesigned panel is read with the rest of the page");
  assert.doesNotMatch(words(worldText(redesigned)), RETIRED);
  if (panelExcused(world)) {
    /* still the old panel: exactly one line in it is excused, the one the redesign removes */
    assert.equal(words(panel).split(/get\W*your\W*hu\W*up/i).length - 1, 1, "the old panel says it once");
    assert.match(panel, /<p class="mn__lede">Get Your Hu Up!<\/p>/);
  } else {
    assert.equal(worldText(world), world, "the panel changed since 2026-11-18, so it is read like the rest of the page");
  }
});

test("no published page, script, stylesheet or data file carries the retired tagline", () => {
  const found = published.filter((f) => RETIRED.test(words(publicText(f))));
  assert.deepEqual(found, [], `the retired tagline is still public in: ${found.join(", ")}`);
});

test("the Worker serves it nowhere, and the generated /company pages say it on no line", async () => {
  const found = workerSource.filter((f) => RETIRED.test(words(read(f))));
  assert.deepEqual(found, [], `the Worker still carries it in: ${found.join(", ")}`);
  const { PAGES } = await import(pathToFileURL(join(ROOT, "workers/mccluster/src/company-site/pages.generated.js")).href);
  const company = PAGES["/company"];
  assert.ok(company && /<footer>/.test(company.body), "the /company page and its footer are generated");
  for (const [path, page] of Object.entries(PAGES)) assert.doesNotMatch(words(page.body), RETIRED, `${path} as a visitor gets it`);
  const footer = company.body.slice(company.body.indexOf("<footer>"), company.body.indexOf("</footer>"));
  assert.match(footer, /<p>© \d{4} McCluster Corp\.<\/p>/, "the footer keeps its links and its year line");
  assert.doesNotMatch(footer, /<p><b>[^<]*<\/b><\/p>/, "and no empty or stand-in tagline line takes its place");
  const site = JSON.parse(read("data/seo/company-site.json"));
  assert.doesNotMatch(JSON.stringify(site), RETIRED, "data/seo/company-site.json, the source of those pages");
});

test("the sentences around it still read: nothing invented in its place", () => {
  assert.match(read("action/index.html"), /<p class="an-lede an-lede--sm">One account, every campaign\.<\/p>/);
  assert.match(read("heal-the-3rd-world.html"), /<p class="gw-lede">One account, every campaign\.<\/p>/);
  assert.match(read("mccluster-corp.html"), /<p class="rec__lede">Founded by <a href="matthew-mccluster\.html">Matthew McCluster<\/a> in 2025\.<\/p>/);
  const desk = read("js/member-desk.js");
  assert.match(desk, /<header class="hu-desk__head"><div><h2 id="huDeskTitle">Your desk<\/h2><\/div>/, "the desk opens on its own title");
  assert.doesNotMatch(desk + read("css/member-desk.css"), /hu-desk__k\b/, "the eyebrow's class and rule are gone with it");
  for (const f of ["action/index.html", "heal-the-3rd-world.html", "mccluster-corp.html"]) assert.doesNotMatch(read(f), /<b>\s*<\/b>/, `${f}: no empty emphasis left behind`);
});
