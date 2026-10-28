/* THE MOBILE RULE, made enforceable: AGENTS.md → Hard rules → 14.

     node --test scripts/test/mobile-rule.test.mjs

   Runs on every PR through mcp-continuity-ci.yml (node --test
   scripts/test/*.test.mjs). Four checks, each a mistake this site has
   already shipped:

   (a) no published page blocks pinch zoom: maximum-scale=1 or
       user-scalable=no in the viewport meta fails WCAG 1.4.4 (32 pages
       carried it);
   (b) no stylesheet or inline <style> takes a phone layout back with a
       max-width media query: breakpoints only ever ADD, so min-width;
   (c) no grid-template-columns/rows track is a bare 1fr: that is
       minmax(auto, 1fr), whose auto floor lets one unbreakable child push
       the track past its container and the page sideways; minmax(0, 1fr);
   (d) the wall generator (tools/build-walls.mjs) cannot bake the zoom
       block back into walls/*.html (its output is also held to the
       committed pages by --check in seo-contract.test.mjs).

   (b) and (c) carry allowlists seeded from the tree the day this test
   landed. THE ALLOWLISTS MAY ONLY SHRINK. A file may never gain a query
   or a bare track, no file may be added, and when a file is converted
   its number is lowered or its line removed (the failure says which).
   A separate PR converts them. A listed file that leaves the published
   set (moved under _unfinished/, deleted) simply stops counting.

   Published is every tracked *.html outside _unfinished/, node_modules/,
   redirects/ and demos/, plus every css/**\/*.css. Dependency-free. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0").filter((f) => f && existsSync(join(ROOT, f)));
const UNPUBLISHED = /^(_unfinished|node_modules|redirects|demos)\//;
const PAGES = tracked.filter((f) => f.endsWith(".html") && !UNPUBLISHED.test(f));
const SHEETS = tracked.filter((f) => /^css\/.*\.css$/.test(f));

/* every <meta name="viewport"> tag, whatever the attribute order */
const VIEWPORT_META = /<meta\s[^>]*name=["']viewport["'][^>]*>/gi;
/* maximum-scale=1 (and 1.0), not 10 or 1.5; user-scalable=no */
const ZOOM_BLOCK = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0+)?(?![\d.])/i;
const CANON = "width=device-width, initial-scale=1, viewport-fit=cover";

const styleBlocks = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
const source = (f) => (f.endsWith(".css") ? read(f) : styleBlocks(read(f)));

const maxWidthQueries = (css) => (css.match(/@media[^{]*max-width/g) || []).length;
/* a grid-template(-columns|-rows) declaration whose value has a 1fr that is
   not inside minmax(...). Scoped to the declaration (unlike the whole-file
   regex in action-network.test.mjs) so prose and other properties do not
   count, and so repeat(auto-fill, 1fr) is caught as the bare track it is. */
const GRID_DECL = /grid-template(?:-columns|-rows)?\s*:\s*([^;}]*)/g;
const BARE_FR = /(?<!minmax\([^)]*)\b1fr\b/;
const bareTracks = (css) => [...css.matchAll(GRID_DECL)].filter((m) => BARE_FR.test(m[1])).length;

/* ---- the allowlists: seeded 2026-10-27, and they may only shrink ---- */
/* @media (…max-width…) queries per file: 110 in 43 files */
const MAX_WIDTH_ALLOWED = {
  "catalogue.html": 1,
  "css/control-room-v2.css": 9,
  "css/control-room.css": 3,
  "css/control-system.css": 1,
  "css/deskchat.css": 1,
  "css/equity-uprise-app.css": 1,
  "css/equity-uprise-institutional.css": 2,
  "css/lockroom.css": 1,
  "css/music-creator.css": 1,
  "css/music-director-base.css": 1,
  "css/music-director.css": 1,
  "css/music-engine.css": 1,
  "css/music-lounge.css": 2,
  "css/music-luxury.css": 2,
  "css/music-private-listening.css": 2,
  "css/prim3-course.css": 4,
  "css/prim3-range.css": 2,
  "css/prim3-tracking.css": 2,
  "css/prim3.css": 2,
  "css/professional.css": 1,
  "css/style.css": 38,
  "demo.html": 1,
  "desk.html": 1,
  "docs/design/native-identity-comparison.html": 1,
  "docs/design/redesign-before-after.html": 2,
  "equity-uprise.html": 1,
  "gallery.html": 4,
  "inbox.html": 1,
  "license.html": 1,
  "management.html": 1,
  "mccluster-creator-studio.html": 1,
  "mccluster-platform.html": 2,
  "portfolio/onyx-elite.html": 1,
  "prayer-closet.html": 1,
  "production.html": 1,
  "research.html": 1,
  "sites-details.html": 2,
  "sites.html": 2,
  "whip/index.html": 2,
  "workers/mccluster/src/seek-first/console.html": 1,
  "world-news.html": 2,
};
/* grid-template declarations with a bare 1fr per file: 279 in 59 files */
const BARE_FR_ALLOWED = {
  "account.html": 2,
  "admin.html": 1,
  "analytics.html": 1,
  "card.html": 2,
  "crm.html": 1,
  "css/control-analytics-deck.css": 4,
  "css/control-analytics.css": 3,
  "css/control-forensics.css": 1,
  "css/control-room-v2.css": 6,
  "css/control-room.css": 4,
  "css/equity-uprise-app.css": 1,
  "css/equity-uprise-institutional.css": 21,
  "css/hitman-facility.css": 1,
  "css/mnet-audio.css": 1,
  "css/mnet.css": 3,
  "css/music-creator.css": 5,
  "css/music-director-base.css": 4,
  "css/music-director.css": 4,
  "css/music-luxury.css": 2,
  "css/music-private-listening.css": 2,
  "css/music-system-v2.css": 7,
  "css/offers.css": 8,
  "css/prim3-course.css": 5,
  "css/prim3-range.css": 4,
  "css/prim3-tracking.css": 2,
  "css/prim3.css": 19,
  "css/resume-print.css": 1,
  "css/style.css": 61,
  "css/whip-manufacturer.css": 5,
  "css/whip.css": 4,
  "css/world-travel.css": 1,
  "desk.html": 3,
  "docs/design/native-identity-comparison.html": 3,
  "gallery.html": 11,
  "help.html": 1,
  "inbox.html": 2,
  "lanes.html": 3,
  "license.html": 2,
  "management.html": 3,
  "mccluster-creator-studio.html": 2,
  "mccluster-platform.html": 5,
  "oauth/consent/index.html": 1,
  "portfolio/onyx-elite.html": 5,
  "prayer-closet.html": 4,
  "production.html": 4,
  "shots.html": 2,
  "sites-details.html": 5,
  "sites.html": 5,
  "vault.html": 2,
  "walls/brunch-and-beats.html": 1,
  "walls/candler-crossing.html": 1,
  "walls/cover-art.html": 1,
  "walls/dressed-for-success.html": 1,
  "walls/eu-rally.html": 1,
  "walls/vaunt-runway.html": 1,
  "we-manufacture.html": 1,
  "whip/index.html": 15,
};

/* count every scanned file against its allowance: more is a regression,
   fewer means the allowance must come down (the ratchet), zero and unlisted
   is the goal */
function ratchet(what, allowed, count) {
  const problems = [];
  for (const f of [...SHEETS, ...PAGES]) {
    const n = count(source(f));
    const cap = allowed[f] ?? 0;
    if (n > cap) problems.push(`${f}: ${n} ${what}, allowed ${cap}${cap ? "" : " (not on the allowlist, which may only shrink)"}`);
    else if (n < cap) problems.push(`${f}: now ${n} ${what}, allowed ${cap}: lower or remove its allowlist line, it may only shrink`);
  }
  return problems;
}

test("the scan covers the site", () => {
  assert.ok(PAGES.length >= 100, `published pages found: ${PAGES.length}`);
  assert.ok(SHEETS.length >= 50, `stylesheets found: ${SHEETS.length}`);
  assert.ok(PAGES.includes("index.html") && PAGES.includes("mnet.html") && PAGES.some((f) => f.startsWith("walls/")));
  assert.ok(!PAGES.some((f) => UNPUBLISHED.test(f)));
});

test("(a) no published page blocks pinch zoom (WCAG 1.4.4)", () => {
  const bad = [];
  for (const f of PAGES) {
    for (const [tag] of read(f).matchAll(VIEWPORT_META)) if (ZOOM_BLOCK.test(tag)) bad.push(`${f}: ${tag}`);
  }
  assert.deepEqual(bad, [], `drop maximum-scale/user-scalable; the viewport is "${CANON}"`);
});

test("(b) breakpoints only add: no max-width media query beyond the shrinking allowlist", () => {
  assert.deepEqual(ratchet("max-width queries", MAX_WIDTH_ALLOWED, maxWidthQueries), []);
});

test("(c) grid tracks are minmax(0, 1fr), never a bare 1fr, beyond the shrinking allowlist", () => {
  assert.deepEqual(ratchet("bare 1fr grid declarations", BARE_FR_ALLOWED, bareTracks), []);
});

test("(d) the wall generator cannot bake the zoom block back in", () => {
  const src = read("tools/build-walls.mjs");
  const metas = [...src.matchAll(VIEWPORT_META)].map((m) => m[0]);
  assert.equal(metas.length, 2, "one viewport meta in the wall template, one in the walls.html stub");
  for (const tag of metas) {
    assert.doesNotMatch(tag, ZOOM_BLOCK, tag);
    assert.ok(tag.includes(CANON), `${tag} is not the canonical viewport`);
  }
  assert.doesNotMatch(src, /maximum-scale|user-scalable/i, "the flag is gone from the generator source");
});
