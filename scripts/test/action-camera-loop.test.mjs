import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = p => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const html = read("mnet.html");
const create = read("create.html");
const mnet = read("js/mnet.js");
const poster = read("js/video-poster.js");
/* the shared capture's pure parts, run as the page would load them */
const loadPoster = () => {
  const sandbox = { window: {} }; vm.runInNewContext(poster, sandbox);
  const vp = sandbox.window.MCCVideoPoster;
  return { ...vp, times: (...a) => Array.from(vp.times(...a)) };
};
const action = read("js/action.js");
const gateway = read("js/gateway.js");
const api = read("workers/mccluster/src/platform-api.js");
const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const cameraMigrations = fs.readdirSync(migrationDir).filter(name => name.endsWith("_action_mission_camera_loop_v1.sql"));
assert.ok(cameraMigrations.length >= 1, "camera-loop production migration is present");
cameraMigrations.sort();
const sql = fs.readFileSync(new URL(cameraMigrations.at(-1), migrationDir), "utf8");

test("campaign surfaces hand people straight to concrete missions", () => {
  assert.match(action, /Pick an action\./);
  assert.match(action, /actionable_selected/);
  assert.match(action, /join_action_mission/);
  assert.match(action, /missionHref/);
  assert.match(action, /root\.location\.assign\(missionHref\(SELECTED_ACTION\.mission_id\)\)/);
  assert.match(gateway, /gatewaySignedIn/);
  assert.match(gateway, /Do a mission now/);
  assert.match(gateway, /view=missions&campaign=/);
});

test("mission execution is camera-first and preserves a return route", () => {
  assert.match(html, /id="mnMissionCameraFile"[^>]*accept="image\/\*,video\/\*"[^>]*capture="environment"/);
  assert.match(html, /id="mnMissionCameraGo"/);
  assert.match(html, /What are you about to do\?/);
  assert.match(mnet, /safeMissionReturn/);
  assert.match(mnet, /missions\.returnHref/);
  assert.match(mnet, /location\.assign\(missions\.returnHref\)/);
  assert.match(mnet, /campaign_id=eq\./);
});

test("video uploads get local poster frames and feed video uses them", () => {
  assert.match(mnet, /function makeVideoPoster/);
  assert.match(mnet, /window\.MCCVideoPoster\.capture\(file,opts\)/, "the composer uses the shared capture");
  assert.match(poster, /canvas\.toBlob/);
  assert.match(mnet, /poster_asset_ids/);
  assert.match(mnet, /data-poster-asset/);
  assert.match(mnet, /poster="/);
  assert.match(api, /poster_asset_ids/);
  assert.match(api, /Video posters must be images/);
  assert.match(api, /poster_asset_id/);
});

/* THE BLACK VIDEO (owner, 2026-10-20: "when people upload videos, there's no thumbnail, just a black video") */
test("one shared poster capture, loaded before the pages that use it", () => {
  assert.match(html, /<script src="js\/video-poster\.js\?v=e80cb0a13768"><\/script>\s*<script src="js\/mnet\.js\?v=e80cb0a13768"><\/script>/);
  assert.match(create, /<script src="js\/video-poster\.js\?v=e80cb0a13768"><\/script>\s*<script src="js\/create\.js\?v=e80cb0a13768"><\/script>/);
  /* attached out of sight, muted, inline, loading data; a detached never-played video gives WebKit nothing to draw */
  assert.match(poster, /appendChild\(v\)/);
  assert.match(poster, /v\.muted = true; v\.defaultMuted = true; v\.playsInline = true;/);
  assert.match(poster, /v\.preload = "auto"/);
  assert.match(poster, /\["loadeddata"\]/);
  /* after the seek, wait for a frame that was really put up, or nudge the decoder with a muted play and pause */
  assert.match(poster, /requestVideoFrameCallback/);
  assert.match(poster, /video\.play\(\)/);
  assert.match(poster, /MAX_EDGE = 1080/);
  assert.match(poster, /"image\/jpeg"/);
  assert.doesNotMatch(poster, /—/, "no em dashes");
});

test("the poster is looked for a second in (or a quarter of a short clip), then a quarter, then halfway", () => {
  const vp = loadPoster();
  assert.deepEqual(vp.times(10), [1, 2.5, 5]);
  assert.deepEqual(vp.times(2), [0.5, 1], "a short clip: a quarter in, then halfway");
  assert.deepEqual(vp.times(20, 4, 12), [5, 6, 8], "inside the kept stretch only");
  assert.deepEqual(vp.times(Infinity), [1, 2], "a length not known yet is read as four seconds");
  assert.ok(vp.times(0.04).every((t) => t >= 0), "never before the start");
});

test("a (near) black frame is tried again; a dark scene with light in it is not", () => {
  const vp = loadPoster();
  const frame = (fill, n = 16) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) d.set(fill(i), i * 4); return d; };
  assert.equal(vp.isDark(vp.lightOf(frame(() => [0, 0, 0, 255]))), true, "black");
  assert.equal(vp.isDark(vp.lightOf(frame(() => [200, 200, 200, 0]))), true, "transparent is black");
  assert.equal(vp.isDark(vp.lightOf(frame(() => [6, 6, 8, 255]))), true, "a fade-in");
  assert.equal(vp.isDark(vp.lightOf(frame((i) => i === 3 ? [255, 240, 200, 255] : [4, 4, 4, 255]))), false, "night, with a street light");
  assert.equal(vp.isDark(vp.lightOf(frame(() => [90, 120, 80, 255]))), false, "an ordinary frame");
});

test("the composer takes the picture while the video uploads and shows it, not a black box", () => {
  const up = mnet.slice(mnet.indexOf("function uploadMediaWithPoster"), mnet.indexOf("function uploadMediaFiles"));
  assert.ok(up.indexOf("var shot=makeVideoPoster(file,{onMeta:metaKnown})") < up.indexOf("uploadOneMedia(file,"), "capture starts before the video upload, in parallel");
  assert.match(up, /uploadOneMedia\(file,meta\)/, "the video's finalize carries its size and length");
  assert.match(poster, /opts\.onMeta\(out\.video\)/, "as soon as they are known, not after the picture");
  assert.match(up, /uploadOneMedia\(s\.file,\{width:s\.width,height:s\.height\}\)/, "the poster's finalize carries its size");
  assert.match(mnet, /\["width","height","duration_ms"\]\.forEach/);
  assert.match(mnet, /poster_preview:out\.posterFile\?URL\.createObjectURL\(out\.posterFile\):""/);
  assert.match(mnet, /x\.media_type === "video" && x\.poster_preview \? '<img src="' \+ esc\(x\.poster_preview\) \+ '" alt="Video">' \+ PLAY_MARK/);
  assert.doesNotMatch(mnet, /<video src="' \+ esc\(x\.preview\) \+ '" muted playsinline><\/video>/, "no bare blob video chip");
});

test("the feed paints a first frame, refreshes stale addresses and says when a video cannot play", () => {
  assert.match(mnet, /var frag=node\.dataset\.clip\|\|\(posterUrl\?"":"#t=0\.1"\)/);
  assert.match(mnet, /controls playsinline preload="metadata"/);
  assert.match(mnet, /var MEDIA_URL_MARGIN=5\*60\*1000/);
  assert.match(mnet, /state\.mediaCache\[assetId\]=\{data:x,exp:asked\+life\*1000\}/);
  assert.match(mnet, /This video can.t play on this device\./);
});

test("the author can change the thumbnail of a video they posted", () => {
  assert.match(mnet, /mine && postVideos\(post\)\.length \? '<button class="mn__action mn__action--thumb" type="button" data-action="thumbnail"/);
  assert.match(html, /<dialog class="mn__thread mn__thumb-dialog" id="mnThumbDialog"/);
  assert.match(html, /id="mnThumbRange"/);
  assert.match(html, /id="mnThumbUseFrame" type="button">Use this frame</);
  assert.match(html, /for="mnThumbFile">Upload an image</);
  assert.match(html, /id="mnThumbFile" type="file" accept="image\/\*"/);
  assert.match(mnet, /v\.crossOrigin = "anonymous"/);
  assert.match(mnet, /vp\.readable\(v\)/, "frame picking only where the page may read the pixels");
  assert.match(mnet, /method: "PATCH", body: \{ poster_by_media: map \}/);
  assert.match(mnet, /if \(old\) delete state\.mediaCache\[old\]/);
  assert.match(api, /async function preparePosterSwap/);
  assert.match(api, /status:'attached'/);
  const css = read("css/mnet.css");
  assert.match(css, /\.mn__action--thumb \{ min-width: 44px; min-height: 44px;/);
  assert.match(css, /\.mn__thumb-body \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.mn__thumb-which button \{[^}]*font-size: max\(16px, 0\.88rem\)/);
});

test("mission proof poster is server-validated and verified shares carry proof media", () => {
  assert.match(sql, /poster_asset_id/);
  assert.match(sql, /poster must be your ready image/);
  assert.match(sql, /action_share_assignment_internal/);
  assert.match(sql, /insert into public\.network_posts\(author_m_uid,body,post_type,visibility,media,metadata,source_app_id\)/);
  assert.match(sql, /status='attached'/);
});

test("camera proof defaults to sharing only after verification", () => {
  assert.match(html, /id="mnMissionShare" type="checkbox" checked/);
  assert.match(html, /once it's verified/);
  assert.match(mnet, /set_action_share_intent/);
  assert.match(mnet, /Once verified, this action can appear on the feed with your proof/);
});
