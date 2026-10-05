/* VideoObject.uploadDate is a full DateTime with a timezone (issue #48).

   Google reads uploadDate as the DateTime the video was first published and
   recommends a timezone rather than letting Googlebot assume one. A bare
   date ("2026-07-05") is what Search Console flagged. This crawls every
   published HTML page, parses every JSON-LD block, finds every VideoObject
   anywhere in the graph, and refuses an uploadDate that is not
   YYYY-MM-DDThh:mm[:ss[.fff]] followed by Z or ±hh:mm.

   A time is never invented to satisfy this. Each value carries the moment
   of the commit that first published the file, from the repository that
   served it then:
   - assets/video/hero.mp4 → mcclusterishere/street-credit-bureau f5263b5,
     2026-07-05T15:17:30Z, pushed to main, which deploy-pages.yml mirrored
     to gh-pages for GitHub Pages.
   - assets/video/ulf-school-meals-policy.mp4 → mcclusterishere/here 9f5ac14,
     2026-08-08T03:54:50Z, pushed directly to main, mirrored the same way.
   A new video needs its own first-published moment from a primary record.
   If none exists, leave the VideoObject out rather than guess.

   video:publication_date in sitemap-video.xml is optional and is left out
   where the date is unknown; this test does not touch it. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STRIPPED = new Set(["docs", "packages", "apps", "scripts", "supabase", ".github", "tests", "node_modules", "redirects", "tools", "_unfinished", "workers", ".git", "core", "PRIM3"]);
const DATETIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function publishedHtml(dir = "") {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (!dir && STRIPPED.has(entry.name)) continue;
    if (entry.isDirectory()) { if (!entry.name.startsWith(".")) out.push(...publishedHtml(rel)); }
    else if (entry.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

function nodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => nodes(v, out));
  else if (value && typeof value === "object") { out.push(value); Object.values(value).forEach((v) => nodes(v, out)); }
  return out;
}

const isVideo = (n) => n["@type"] === "VideoObject" || (Array.isArray(n["@type"]) && n["@type"].includes("VideoObject"));

function videoObjects() {
  const found = [];
  for (const file of publishedHtml()) {
    const html = readFileSync(join(ROOT, file), "utf8");
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      for (const n of nodes(JSON.parse(m[1]))) if (isVideo(n)) found.push({ file, node: n });
    }
  }
  return found;
}

test("every VideoObject carries uploadDate as a timezone-bearing DateTime", () => {
  const videos = videoObjects();
  assert.ok(videos.length >= 2, "the home film and the policy deck are both described");
  for (const { file, node } of videos) {
    assert.ok(node.uploadDate, `${file}: ${node.name} has no uploadDate`);
    assert.match(String(node.uploadDate), DATETIME_WITH_ZONE, `${file}: ${node.name} uploadDate ${node.uploadDate} is not a full DateTime with Z or an offset`);
    assert.ok(!Number.isNaN(Date.parse(node.uploadDate)), `${file}: ${node.name} uploadDate does not parse`);
  }
});

test("the recorded first-publication moments stay what the evidence says", () => {
  const byUrl = Object.fromEntries(videoObjects().map(({ node }) => [node.contentUrl, node.uploadDate]));
  assert.equal(byUrl["https://matthew.mccluster.org/assets/video/hero.mp4"], "2026-07-05T15:17:30Z");
  assert.equal(byUrl["https://matthew.mccluster.org/assets/video/ulf-school-meals-policy.mp4"], "2026-08-08T03:54:50Z");
});

test("the pattern refuses a bare date and accepts real DateTimes", () => {
  for (const bad of ["2026-07-05", "2026-07-05T15:17:30", "2026-07-05 15:17:30Z", "July 5, 2026"]) assert.doesNotMatch(bad, DATETIME_WITH_ZONE, bad);
  for (const ok of ["2026-07-05T15:17:30Z", "2026-07-05T11:17:30-04:00", "2026-07-05T15:17Z", "2026-07-05T15:17:30.120+00:00"]) assert.match(ok, DATETIME_WITH_ZONE, ok);
});
