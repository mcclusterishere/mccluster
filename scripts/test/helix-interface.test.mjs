import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  albumProfile, strandPoint, rungPositions, classifyGesture,
  visualPeaks, lyricText, catalogueOffset
} from "../../js/helix/math.mjs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("DNA backbones are opposite, smooth and spaced across a true helical path", () => {
  const profile = albumProfile(8);
  assert.ok(profile.turns >= 1);
  for (const t of [0, 0.1, 0.42, 0.75, 1]) {
    const a = strandPoint(t, 0, profile);
    const b = strandPoint(t, 1, profile);
    assert.ok(Math.abs(a.x + b.x) < 1e-8);
    assert.ok(Math.abs(a.z + b.z) < 1e-8);
    assert.equal(a.y, b.y);
    assert.ok(Math.abs(Math.hypot(a.x, a.z) - profile.radius) < 1e-8);
  }
});

test("every published track corresponds to exactly one rung", () => {
  for (const count of [1, 3, 6, 10, 24]) {
    const rungs = rungPositions(count);
    assert.equal(rungs.length, count);
    assert.deepEqual(rungs.map(r => r.index), Array.from({length:count},(_,i)=>i));
    assert.ok(rungs.every((r, i) => i === 0 || r.y > rungs[i - 1].y));
  }
});

test("mobile gesture classification prioritizes direction and ignores micro-motions", () => {
  assert.equal(classifyGesture(10, 10), "tap");
  assert.equal(classifyGesture(50, 10), "horizontal");
  assert.equal(classifyGesture(-3, -50), "vertical");
  assert.equal(classifyGesture(55, 51), "horizontal");
});

test("procedural identity peaks are deterministic, normalized and not misrepresented as recorded peaks", () => {
  const a = visualPeaks("album/song", 32);
  assert.deepEqual(a, visualPeaks("album/song", 32));
  assert.notDeepEqual(a, visualPeaks("album/different", 32));
  assert.equal(a.length, 32);
  assert.ok(a.every(v => v >= 0 && v <= 1));
  assert.equal(catalogueOffset(0, 1, 5), -1);
});

test("lyrics respect the actual plain-text record, not invented timestamps", () => {
  const existing = JSON.parse(read("data/lyrics/who-did-the-shoot.json"));
  assert.match(lyricText(existing), /Who did the shoot/i);
  assert.equal(lyricText({plain:"actual line"}), "actual line");
  assert.equal(lyricText({}), "");
});

test("Helix is a standalone route using existing playback permissions and local Three.js", () => {
  const page = read("helix.html");
  const main = read("js/helix/main.mjs");
  const scene = read("js/helix/scene.mjs");
  const listen = read("listen.html");
  assert.match(page, /js\/helix\/main\.mjs\?v=__STAMP__/);
  assert.match(listen, /href="helix\.html"/);
  assert.match(scene, /\.\.\/\.\.\/vendor\/three\.module\.min\.js/);
  assert.match(main, /transport\.play\(album\(\)\.slug, track\(\)\.title\)/);
  assert.match(main, /transport\.access/);
  assert.match(main, /if \(track\(\)\?\.gated\)/);
  assert.doesNotMatch(main, /new Audio\(/);
});

test("live album metadata has unique slugs and source-backed tracks", () => {
  const data = JSON.parse(read("data/albums.json"));
  assert.ok(data.albums.length > 0);
  const slugs = data.albums.map(a => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(data.albums.some(a => a.tracks?.length));
});
