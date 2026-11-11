/* js/image-resize.js makes a picture small before it goes up (a face: a 512px square; a post picture: 1600px on its
   long edge; a GIF: untouched). The dimension and type decisions are pure and checked here; the canvas path is
   driven with a fake bitmap and canvas in a vm, so what is drawn, what type is asked for and what is handed back
   can all be seen. The real encoder is checked in a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../js/image-resize.js', import.meta.url), 'utf8');

/* opts.bitmap: {width,height} the fake decoder hands back (or null: the decode fails)
   opts.alpha: the 32 x 32 sample has a see-through pixel
   opts.encode: (type) => Blob|null, what the canvas writes for a type (a canvas that cannot write WebP hands back PNG) */
function load(opts = {}) {
  const drawn = [], asked = [];
  const canvas = () => {
    const c = { width: 0, height: 0 };
    c.getContext = () => ({
      drawImage: (...a) => { drawn.push({ canvas: [c.width, c.height], args: a.slice(1) }); },
      getImageData: () => ({ data: opts.alpha ? [0, 0, 0, 255, 0, 0, 0, 0] : [0, 0, 0, 255, 0, 0, 0, 255] }),
    });
    c.toBlob = (cb, type, q) => { asked.push({ type, q }); cb(opts.encode ? opts.encode(type) : new Blob(['x'.repeat(10)], { type })); };
    return c;
  };
  const ctx = {
    setTimeout, Promise, File, Blob,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    Image: class { set src(v) { setTimeout(() => this.onerror && this.onerror(), 0); } },
    createImageBitmap: (file, o) => opts.bitmap
      ? Promise.resolve({ width: opts.bitmap.width, height: opts.bitmap.height, close() { this.closed = true; }, o })
      : Promise.reject(new Error('cannot decode')),
    document: { createElement: canvas },
  };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  return { api: ctx.MCCImageResize, drawn, asked };
}
const png = (bytes, name = 'photo.png') => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
/* a vm realm has its own Object.prototype, so what fit() returns is copied before a strict deepEqual */
const box = (api, w, h, o) => ({ ...api.fit(w, h, o) });

test('fit: a post picture keeps its shape, the long edge no longer than 1600, never scaled up', () => {
  const { api } = load();
  assert.deepEqual(box(api, 3000, 2000, api.PICTURE), { sx: 0, sy: 0, sw: 3000, sh: 2000, dw: 1600, dh: 1067, scaled: true });
  assert.deepEqual(box(api, 2000, 3000, api.PICTURE), { sx: 0, sy: 0, sw: 2000, sh: 3000, dw: 1067, dh: 1600, scaled: true });
  assert.deepEqual(box(api, 800, 600, api.PICTURE), { sx: 0, sy: 0, sw: 800, sh: 600, dw: 800, dh: 600, scaled: false });
  assert.equal(api.fit(1, 1, api.PICTURE).dw, 1);
  assert.equal(api.fit(0, 0, api.PICTURE).dh, 1, 'a degenerate size is never a zero-sized canvas');
});

test('fit: a face is the largest centred square, no bigger than 512 a side', () => {
  const { api } = load();
  assert.deepEqual(box(api, 3000, 2000, api.AVATAR), { sx: 500, sy: 0, sw: 2000, sh: 2000, dw: 512, dh: 512, scaled: true });
  assert.deepEqual(box(api, 2000, 3001, api.AVATAR), { sx: 0, sy: 500, sw: 2000, sh: 2000, dw: 512, dh: 512, scaled: true });
  assert.deepEqual(box(api, 300, 400, api.AVATAR), { sx: 0, sy: 50, sw: 300, sh: 300, dw: 300, dh: 300, scaled: false });
  assert.deepEqual(box(api, 512, 512, api.AVATAR), { sx: 0, sy: 0, sw: 512, sh: 512, dw: 512, dh: 512, scaled: false });
});

test('nextType: WebP where the browser writes it; otherwise JPEG, or PNG for a see-through picture', () => {
  const { api } = load();
  assert.equal(api.nextType('image/webp', false), null);
  assert.equal(api.nextType('image/webp', true), null);
  assert.equal(api.nextType('image/png', false), 'image/jpeg', 'a PNG back for a WebP ask means no WebP here');
  assert.equal(api.nextType('image/png', true), null, 'the PNG that came back keeps the transparency');
  assert.equal(api.nextType('image/jpeg', true), 'image/png');
});

test('outputName: the original name with the extension of what is sent', () => {
  const { api } = load();
  assert.equal(api.outputName('photo.PNG', 'image/webp'), 'photo.webp');
  assert.equal(api.outputName('a.b.c.png', 'image/jpeg'), 'a.b.c.jpg');
  assert.equal(api.outputName('', 'image/png'), 'picture.png');
  assert.equal(api.outputName(undefined, 'image/webp'), 'picture.webp');
});

test('a 3000 x 3000 PNG face is drawn as a 512 x 512 square and leaves as WebP', async () => {
  const { api, drawn, asked } = load({ bitmap: { width: 3000, height: 3000 } });
  const out = await api.resize(png(5000, 'face.png'), { ...api.AVATAR, maxBytes: 1024 * 1024 });
  assert.equal(out.changed, true);
  assert.equal(out.file.type, 'image/webp');
  assert.equal(out.file.name, 'face.webp');
  assert.deepEqual([out.width, out.height], [512, 512]);
  const main = drawn.find((d) => d.canvas[0] === 512);
  assert.deepEqual(main.args, [0, 0, 3000, 3000, 0, 0, 512, 512]);
  assert.deepEqual(asked.map((a) => a.type), ['image/webp']);
  assert.equal(asked[0].q, api.QUALITY);
});

test('a 3000 x 2000 post picture is drawn at 1600 x 1067', async () => {
  const { api, drawn } = load({ bitmap: { width: 3000, height: 2000 } });
  const out = await api.resize(png(5000), api.PICTURE);
  assert.deepEqual([out.width, out.height], [1600, 1067]);
  assert.deepEqual(drawn.find((d) => d.canvas[0] === 1600).args, [0, 0, 3000, 2000, 0, 0, 1600, 1067]);
});

test('a GIF, a video and a sound file go as they are: nothing is decoded', async () => {
  const { api, drawn } = load({ bitmap: { width: 3000, height: 3000 } });
  for (const f of [new File(['g'], 'a.gif', { type: 'image/gif' }), new File(['v'], 'a.mp4', { type: 'video/mp4' }), new File(['s'], 'a.mp3', { type: 'audio/mpeg' })]) {
    const out = await api.resize(f, api.AVATAR);
    assert.equal(out.file, f);
    assert.equal(out.changed, false);
  }
  assert.equal(drawn.length, 0);
});

test('where WebP cannot be written: JPEG for an opaque picture, the PNG that came back for a see-through one', async () => {
  const encode = (type) => new Blob(['p'], { type: type === 'image/webp' ? 'image/png' : type });
  const opaque = load({ bitmap: { width: 2000, height: 2000 }, encode });
  const a = await opaque.api.resize(png(5000), opaque.api.AVATAR);
  assert.equal(a.file.type, 'image/jpeg');
  assert.equal(a.file.name, 'photo.jpg');
  assert.deepEqual(opaque.asked.map((x) => x.type), ['image/webp', 'image/jpeg']);
  const clear = load({ bitmap: { width: 2000, height: 2000 }, encode, alpha: true });
  const b = await clear.api.resize(png(5000), clear.api.AVATAR);
  assert.equal(b.file.type, 'image/png');
  assert.deepEqual(clear.asked.map((x) => x.type), ['image/webp'], 'the PNG in hand is kept; nothing is asked for again');
});

test('a picture that comes out no smaller and needed no scaling goes as it was', async () => {
  const { api } = load({ bitmap: { width: 300, height: 300 }, encode: (type) => new Blob(['x'.repeat(40)], { type }) });
  const f = png(20);
  const out = await api.resize(f, api.AVATAR);
  assert.equal(out.file, f);
  assert.equal(out.changed, false);
  assert.deepEqual([out.width, out.height], [300, 300]);
});

test('a picture the browser cannot decode goes as it was', async () => {
  const { api } = load({ bitmap: null });
  const f = png(20);
  const out = await api.resize(f, api.PICTURE);
  assert.equal(out.file, f);
  assert.equal(out.changed, false);
});

test('over maxBytes after the resize is refused, never sent', async () => {
  const { api } = load({ bitmap: { width: 3000, height: 3000 }, encode: (type) => new Blob(['x'.repeat(2048)], { type }) });
  await assert.rejects(api.resize(png(5000), { ...api.AVATAR, maxBytes: 1024 }), /could not be made small enough/);
  const untouched = load({ bitmap: null });
  await assert.rejects(untouched.api.resize(png(5000), { ...untouched.api.AVATAR, maxBytes: 1024 }), /small enough/, 'an undecodable picture over the cap is refused too');
});
