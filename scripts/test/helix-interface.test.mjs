import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  albumProfile, strandPoint, rungPositions, classifyGesture, visualPeaks, lyricText, catalogueOffset
} from "../../_unfinished/helix/math.mjs";
const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

test("opposing strands retain true DNA double-helix geometry", () => {
  const profile = albumProfile(8);
  assert.ok(profile.turns >= 1);
  for (const u of [0, 0.1, 0.42, 0.75, 1]) {
    const a = strandPoint(u, 0, profile), b = strandPoint(u, 1, profile);
    assert.ok(Math.abs(a.x + b.x) < 1e-8);
    assert.ok(Math.abs(a.z + b.z) < 1e-8);
    assert.equal(a.y, b.y);
    assert.ok(Math.abs(Math.hypot(a.x, a.z) - profile.radius) < 1e-8);
  }
});
test("every published track corresponds to exactly one ordered crossbar", () => {
  for (const n of [1, 3, 6, 10, 24]) {
    const rungs = rungPositions(n);
    assert.equal(rungs.length, n);
    assert.deepEqual(rungs.map(r => r.index), Array.from({length:n},(_,i)=>i));
    assert.ok(rungs.every((r,i)=>i === 0 || r.y > rungs[i-1].y));
  }
});
test("gesture classification is stable with small finger movements", () => {
  assert.equal(classifyGesture(10,10),"tap");
  assert.equal(classifyGesture(50,10),"horizontal");
  assert.equal(classifyGesture(-3,-50),"vertical");
  assert.equal(classifyGesture(55,51),"horizontal");
});
test("visual peaks are deterministic, bounded and not measured audio", () => {
  const a=visualPeaks("album/song",32);
  assert.deepEqual(a,visualPeaks("album/song",32));
  assert.notDeepEqual(a,visualPeaks("album/other",32));
  assert.equal(a.length,32);
  assert.ok(a.every(v=>v>=0 && v<=1));
  assert.equal(catalogueOffset(0,1,5),-1);
});
test("lyrics show real untimed published text without fabricated timings", () => {
  const lyric=JSON.parse(read("data/lyrics/who-did-the-shoot.json"));
  assert.match(lyricText(lyric),/Who did the shoot/i);
  assert.equal(lyricText({plain:"the real lyric"}),"the real lyric");
  assert.equal(lyricText({}),"");
});
test("developer-local lab uses canonical gated music engine and bundled Three.js", () => {
  const page=read("_unfinished/helix/index.html");
  const main=read("_unfinished/helix/main.mjs");
  const scene=read("_unfinished/helix/scene.mjs");
  assert.match(page, /<base href="\.\.\/\.\.\/"/);
  assert.match(page, /src="_unfinished\/helix\/main\.mjs"/);
  assert.match(page, /src="js\/music-engine\.js/);
  for (const sideEffect of ["analytics.js", "listen-ledger.js", "gated-audio.js", "mcc-auth.js"]) {
    assert.equal(page.includes('src="js/' + sideEffect), false, "lab must not call live auth/analytics or spend gated plays");
  }
  assert.match(scene, /\.\.\/\.\.\/vendor\/three\.module\.min\.js/);
  assert.match(main, /transport\.play\(album\(\)\.slug, track\(\)\.title\)/);
  assert.match(main, /transport\.access/);
  assert.match(main, /if \(track\(\)\?\.gated\)/);
  assert.doesNotMatch(main, /new Audio\(/);
});
test("no publicly browsable Helix artifact and deploy fails closed", () => {
  const publicPaths=["helix.html","css/helix.css","js/helix/main.mjs","js/helix/math.mjs","js/helix/scene.mjs"];
  for (const path of publicPaths) assert.equal(existsSync(new URL(path,root)),false,"Public path exposed: "+path);
  assert.doesNotMatch(read("listen.html"),/helix(?:-launch|\.html)/);
  const deploy=read(".github/workflows/deploy-pages.yml");
  assert.match(deploy,/rm -rf docs packages apps scripts supabase \.github tests node_modules redirects tools _unfinished workers/);
  assert.match(deploy,/Helix preview must never be shipped/);
});

test("brain 30%, unobstructed strand 30%, translucent canonical player 40%", () => {
  const page = read("_unfinished/helix/index.html");
  const css = read("_unfinished/helix/helix.css");
  const main = read("_unfinished/helix/main.mjs");
  for (const id of [
    "helixBrain", "helixBpm", "helixKey", "helixSignature", "helixSpineWindow",
    "helixPlayer", "helixSeek", "helixPlay", "helixLyrics", "helixDetails"
  ]) {
    if (id === "helixSpineWindow") {
      assert.match(page, /class="helix-spine-window"/);
    } else assert.ok(page.includes('id="' + id + '"'), "Missing interface element " + id);
  }
  assert.match(css, /\.helix-brain\s*\{[^}]*height: 30%/s);
  assert.match(css, /\.helix-spine-window\s*\{[^}]*top: 30%; height: 30%/s);
  assert.match(css, /\.helix-player\s*\{[^}]*top: 60%; bottom: 0/s);
  assert.match(css, /\.helix-player\s*\{[^}]*backdrop-filter: blur/s);
  assert.match(css, /#helixCanvas\s*\{[^}]*inset: 0/s);
  assert.doesNotMatch(page, /<audio\b/i, "Helix must not add a second audio element");
  assert.match(main, /transport\.play\(album\(\)\.slug, track\(\)\.title\)/);
});

test("3D labels attach to actual rungs and the brain display refuses unverified science", () => {
  const scene = read("_unfinished/helix/scene.mjs");
  const main = read("_unfinished/helix/main.mjs");
  const page = read("_unfinished/helix/index.html");
  assert.match(scene, /function rungLettering\(title, theta\)/);
  assert.match(scene, /label\.rotation\.y = -theta/);
  assert.match(scene, /strand\.add\(label\)/);
  assert.match(scene, /function sonicBrain\(\)/);
  assert.match(scene, /this\.camera\.add\(this\.brain\)/);
  assert.match(main, /analysis\?\.provenance === "measured"/);
  assert.match(main, /analysis\?\.provenance === "verified"/);
  assert.match(main, /Audio analysis pending/);
  assert.match(main, /!validDuration \|\| !!track\(\)\?\.gated/);
  assert.match(page, /NOT an EEG reading/);
  assert.doesNotMatch(main, /new Audio\(/);
});

test("real music library provides unique album slugs and songs", () => {
  const data=JSON.parse(read("data/albums.json"));
  const names=data.albums.map(a=>a.slug);
  assert.equal(new Set(names).size,names.length);
  assert.ok(data.albums.some(a=>a.tracks?.length>0));
});
