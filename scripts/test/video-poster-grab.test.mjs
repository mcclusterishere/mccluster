/* "Use this frame" takes the frame the slider chose (js/video-poster.js grab): a seek still on its way when the person
   taps is waited for, so the picture is never the frame before it. Driven with a fake video and canvas in a vm. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../js/video-poster.js', import.meta.url), 'utf8');

function load() {
  const drawn = [];
  const canvas = () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage: (v) => drawn.push({ at: v.currentTime, seeking: v.seeking }), getImageData: () => ({ data: [0, 0, 0, 255] }) }),
    toBlob: (cb) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })),
  });
  const ctx = { setTimeout, clearTimeout, Promise, File, Blob, document: { createElement: canvas } };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  return { api: ctx.MCCVideoPoster, drawn };
}
function video(state) {
  const on = {};
  return Object.assign({
    videoWidth: 640, videoHeight: 360, frames: [],
    addEventListener: (n, fn) => { (on[n] ||= []).push(fn); },
    removeEventListener: (n, fn) => { on[n] = (on[n] || []).filter((f) => f !== fn); },
    fire: (n) => (on[n] || []).slice().forEach((f) => f()),
    requestVideoFrameCallback(cb) { this.frames.push(cb); },
  }, state);
}

test('a seek on its way is waited for: the frame drawn is the one the slider chose', async () => {
  const { api, drawn } = load();
  const v = video({ seeking: true, currentTime: 1 });
  const shot = api.grab(v, { name: 'thumbnail' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(drawn.length, 0, 'nothing is drawn while the seek is on its way');
  v.currentTime = 7.5; v.seeking = false; v.fire('seeked');
  v.frames.forEach((cb) => cb());
  const out = await shot;
  assert.equal(drawn.length, 1);
  assert.deepEqual(drawn[0], { at: 7.5, seeking: false });
  assert.equal(out.at, 7.5);
  assert.ok(out.file, 'a picture comes back');
});

test('a video that is not seeking is drawn at once', async () => {
  const { api, drawn } = load();
  const out = await api.grab(video({ seeking: false, currentTime: 3 }), { name: 'thumbnail' });
  assert.equal(drawn.length, 1);
  assert.equal(out.at, 3);
});
