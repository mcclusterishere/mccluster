/* Which VideoObjects ship, and the evidence behind each uploadDate (#48).

   scripts/test/seo-contract.test.mjs already refuses any VideoObject whose
   uploadDate is not a full DateTime with a timezone. This file pins the
   evidence: a VideoObject ships only when its first publication is known
   from a primary record, never from a guessed time.

   - assets/video/hero.mp4 (the I AM HERE studio film, Matthew's own work):
     first published by mcclusterishere/street-credit-bureau commit f5263b5
     at 2026-07-05T15:17:30Z, pushed to main, which that repo's
     deploy-pages.yml mirrored to gh-pages on push.
   - assets/video/ulf-school-meals-policy.mp4: first published on this
     property by mcclusterishere/here commit 9f5ac14 at 2026-08-08T03:54:50Z,
     but that commit remuxed an existing file of a 2025 cohort presentation,
     so an earlier publication elsewhere is possible. It stays without a
     VideoObject until its first publication anywhere is confirmed. */
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

test("the studio film ships with the moment it was first published", () => {
  const film = videos("index.html").find((v) => v.contentUrl === "https://matthew.mccluster.org/assets/video/hero.mp4");
  assert.ok(film, "index.html describes the studio film");
  assert.equal(film.uploadDate, "2026-07-05T15:17:30Z", "street-credit-bureau f5263b5, deployed on push");
});

test("the school-meals deck carries no VideoObject until its first publication anywhere is confirmed", () => {
  assert.ok(!videos("policy.html").some((v) => String(v.contentUrl).includes("ulf-school-meals-policy")));
});
