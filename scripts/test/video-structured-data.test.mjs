/* Which VideoObjects ship, and the evidence behind each uploadDate (#48).

   scripts/test/seo-contract.test.mjs refuses any VideoObject whose
   uploadDate is not a real DateTime with a timezone. This file holds the
   line on evidence: a VideoObject ships only when a primary deployment or
   publication record establishes the moment the video first became public.
   A commit time is when the file was committed, not proof of when the
   public could see it, so it is never used as the clock time.

   What the record shows (docs/SEO-AEO-AUTHORITY-SYSTEM.md):
   - assets/video/hero.mp4: first committed in
     mcclusterishere/street-credit-bureau f5263b5 at 2026-07-05T15:17:30Z and
     carried as the calendar date 2026-07-05 into Here's JSON-LD on July 15.
     No retained deployment run covers July 5 (that repo's first retained
     deploy-pages run is 2026-07-14) and gh-pages was later force-rewritten,
     so the first-publication second is unproven. Withheld.
   - assets/video/ulf-school-meals-policy.mp4: reached this property in
     mcclusterishere/here 9f5ac14 at 2026-08-08T03:54:50Z, remuxed from an
     existing file of a 2025 presentation, so an earlier publication
     elsewhere is possible. Withheld.
   Either comes back only with a primary record of first public
   availability. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

function nodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => nodes(v, out));
  else if (value && typeof value === "object") { out.push(value); Object.values(value).forEach((v) => nodes(v, out)); }
  return out;
}
const videos = (file) => [...read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((m) => nodes(JSON.parse(m[1])))
  .filter((n) => [].concat(n["@type"]).includes("VideoObject"));

test("videos without a primary first-publication record carry no VideoObject", () => {
  assert.ok(!videos("index.html").some((v) => String(v.contentUrl).includes("assets/video/hero.mp4")), "studio film: commit time is not a publication record");
  assert.ok(!videos("policy.html").some((v) => String(v.contentUrl).includes("ulf-school-meals-policy")), "school-meals deck: earlier publication elsewhere is possible");
});

test("the authority record keeps the evidence-backed calendar date and names what is missing", () => {
  const doc = read("docs/SEO-AEO-AUTHORITY-SYSTEM.md");
  assert.match(doc, /f5263b5[\s\S]*2026-07-05/, "the studio film's first commit and calendar date are recorded");
  assert.match(doc, /no retained deployment run/i, "the missing proof of the publication second is stated");
});
