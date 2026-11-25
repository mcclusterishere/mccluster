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
   The World (mnet.html) is read whole, its sign-in door included. While the door (#mnSignedOut) was being redesigned under
   the same decision, this guard left that one element out, exactly as it stood on 2026-11-18 (its sha256 pinned, review
   LDR-F5). The redesigned door (2026-11-18, docs/design/WORLD-SIGN-IN-DOOR.md) carries no such line, and changing the
   panel ended the exception; its code is gone with it, so the old panel put back byte for byte would be read, and refused,
   like any page.

   Dependency-free; the root suite runs it (node --test scripts/test/*.test.mjs). */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

/* the one rule: does this text carry the tagline? Every published file is read whole; nothing is left out of any page */
const carries = (text) => RETIRED.test(words(text));
const publicText = (f) => read(f);

test("the scan covers the public tree and the Worker, and not the records", () => {
  assert.ok(published.length > 500, `the published tree has its pages, scripts and data (${published.length} text files)`);
  for (const f of ["mnet.html", "action/index.html", "heal-the-3rd-world.html", "mccluster-corp.html", "js/member-desk.js", "data/seo/company-site.json"]) {
    assert.ok(published.includes(f), `${f} is published`);
  }
  assert.ok(workerSource.includes("workers/mccluster/src/company-site/pages.generated.js"), "the generated /company pages are read");
  assert.ok(!published.some((f) => f.startsWith("docs/")), "docs/ is stripped from the site and keeps its dated records");
  /* the World is read whole: the sign-in door, the onboarding pages, the feed and the dialogs, to the last tag */
  const world = publicText("mnet.html");
  assert.equal(world, read("mnet.html"), "nothing of the World is left out of the scan");
  for (const id of ["mnSignedOut", "mnAuthPanel", "mnProfileGate", "mnApp", "mnFeedScope", "mnMissionDialog"]) assert.ok(world.includes(`id="${id}"`), `#${id} is read`);
  assert.match(world, /<\/html>\s*$/, "to the end of the page");
});

test("the tagline fails anywhere on the World: the sign-in door, the pages, the feed, a dialog, the head, an attribute", () => {
  const world = publicText("mnet.html");
  assert.equal(carries(world), false, "the World as it ships says it nowhere");
  /* just inside an element, found by its id */
  const inside = (id) => { const at = world.indexOf(`id="${id}"`); assert.ok(at > 0, `#${id} is on the World`); return world.indexOf(">", at) + 1; };
  const places = {
    "the sign-in door (#mnSignedOut), which the guard once left out": inside("mnSignedOut"),
    "the door's form (#mnAuthPanel)": inside("mnAuthPanel"),
    "the onboarding pages (#mnProfileGate)": inside("mnProfileGate"),
    "the World (#mnApp)": inside("mnApp"),
    "the feed's row (#mnFeedScope)": inside("mnFeedScope"),
    "a mission's dialog (#mnMissionDialog)": inside("mnMissionDialog"),
    "the head": world.indexOf("<title>"),
    "the end of the page": world.lastIndexOf("</body>")
  };
  /* any case, any punctuation or spacing between the four words, a non-breaking space written either way */
  const spellings = ["Get Your Hu Up!", "GET YOUR HU UP", "get your hu-up", "Get&nbsp;Your&nbsp;Hu&nbsp;Up", "Get your Hu&#160;Up."];
  for (const [where, at] of Object.entries(places)) {
    assert.ok(at > 0, `${where} is on the World`);
    for (const said of spellings) assert.equal(carries(world.slice(0, at) + `<p>${said}</p>` + world.slice(at)), true, `"${said}" in ${where} is caught`);
  }
  /* the line the old panel carried, put back where it stood (after the headline): caught, with no panel excused */
  const headline = world.indexOf("</h2>", inside("mnSignedOut")) + "</h2>".length;
  assert.equal(carries(world.slice(0, headline) + '\n        <p class="mn__lede">Get Your Hu Up!</p>' + world.slice(headline)), true, "the old panel's own line, back in the door");
  /* and where no visitor reads it but assistive technology does */
  const named = world.replace('id="mnSignedOut"', 'id="mnSignedOut" title="Get Your Hu Up!"');
  assert.notEqual(named, world);
  assert.equal(carries(named), true, "in an attribute of the door");
});

test("no published page, script, stylesheet or data file carries the retired tagline", () => {
  const found = published.filter((f) => carries(publicText(f)));
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
