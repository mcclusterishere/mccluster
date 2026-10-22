/* HALO VISION — js/halo/vision.js, the admin globe's visual modes.
   Runs the classic script in a vm against a stub Cesium (PostProcessStage, a
   post-process collection with the built-in bloom), a manual animation-frame
   clock and a matchMedia stub, so the crossfades, the lazy stages and the
   teardown are checked without a browser. The shader sources are checked for
   the Cesium post-process contract and for the fake telemetry the source
   shaders drew (clock, REC, temperature digits, frame counter), which must
   stay out. Real GPU compilation is a separate, manual Chromium check. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../../js/halo/vision.js', import.meta.url), 'utf8');
const ANIMATED = new Set(['nvg', 'flir', 'crt', 'snow']);
const STYLE_IDS = ['nvg', 'flir', 'crt', 'anime', 'noir', 'snow'];

function harness({ reduced = false, requestRenderMode = true, canvas = { clientWidth: 1280, clientHeight: 800 }, bloomEnabled = false } = {}) {
  let clock = 1000;
  let nextFrame = 1;
  const frames = new Map();
  const created = [];
  class PostProcessStage {
    constructor(options) {
      this.name = options.name;
      this.fragmentShader = options.fragmentShader;
      this.uniforms = options.uniforms;
      this.enabled = true;
      this.destroyed = false;
      created.push(this);
    }
    destroy() { this.destroyed = true; }
  }
  const bloomUniforms = { glowOnly: false, contrast: 128, brightness: -0.3, delta: 1, sigma: 2, stepSize: 1 };
  const bloom = { enabled: bloomEnabled, uniforms: { ...bloomUniforms } };
  const collection = {
    stages: [],
    bloom,
    add(stage) {
      if (this.stages.some((s) => s.name === stage.name)) throw new Error(`duplicate stage name ${stage.name}`);
      this.stages.push(stage);
      return stage;
    },
    remove(stage) {
      const i = this.stages.indexOf(stage);
      if (i < 0) return false;
      this.stages.splice(i, 1);
      stage.destroy();
      return true;
    },
  };
  let renders = 0;
  const scene = { postProcessStages: collection, requestRenderMode, requestRender() { renders += 1; }, canvas };
  const motion = {
    matches: reduced,
    listeners: new Set(),
    addEventListener(type, fn) { if (type === 'change') this.listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') this.listeners.delete(fn); },
  };
  const ctx = {
    Cesium: { PostProcessStage },
    performance: { now: () => clock },
    requestAnimationFrame(cb) { const id = nextFrame++; frames.set(id, cb); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia(query) {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return motion;
    },
    setTimeout,
    clearTimeout,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'js/halo/vision.js' });
  return {
    HaloVision: ctx.HaloVision,
    viewer: { scene },
    scene,
    collection,
    bloom,
    bloomUniforms,
    created,
    motion,
    renders: () => renders,
    pendingFrames: () => frames.size,
    /* Run animation frames every `step` ms until `ms` have passed. */
    advance(ms, step = 16) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + step);
        const due = [...frames.values()];
        frames.clear();
        for (const cb of due) cb(clock);
      }
    },
  };
}

const stageFor = (h, id) => h.collection.stages.find((s) => s.name.startsWith(`halo_vision_${id}_`));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('STYLES lists the seven modes in order with labels and number keys', () => {
  const { HaloVision } = harness();
  assert.deepEqual(plain(HaloVision.STYLES), [
    { id: 'normal', label: 'Normal', key: '1' },
    { id: 'nvg', label: 'Night vision', key: '2' },
    { id: 'flir', label: 'Thermal', key: '3' },
    { id: 'crt', label: 'CRT', key: '4' },
    { id: 'anime', label: 'Anime', key: '5' },
    { id: 'noir', label: 'Noir', key: '6' },
    { id: 'snow', label: 'Snow', key: '7' },
  ]);
  assert.deepEqual(Object.keys(HaloVision).sort(), ['STYLES', 'mount']);
  assert.ok(Object.isFrozen(HaloVision.STYLES));
});

test('the script is a classic script and exposes the documented controller', () => {
  assert.doesNotMatch(SRC, /^\s*(import|export)\s/m);
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  assert.deepEqual(Object.keys(vision).sort(), ['destroy', 'get', 'set', 'setBloom', 'setSharpen']);
  assert.throws(() => h.HaloVision.mount({}), { name: 'TypeError' });
});

test('mount creates no stage until a style is used', () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  assert.equal(h.created.length, 0);
  assert.equal(h.collection.stages.length, 0);
  assert.equal(vision.get(), 'normal');
  assert.equal(h.pendingFrames(), 0);
  assert.deepEqual(h.bloom.uniforms, h.bloomUniforms, 'bloom untouched');
  assert.equal(vision.set('normal'), true);
  assert.equal(h.created.length, 0, "'normal' needs no stage");
  assert.equal(vision.set('thermal-hd'), false, 'unknown ids are refused');
  assert.equal(h.created.length, 0);
});

test("set('nvg') creates and enables exactly that stage, crossfading to full over 500 ms", () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.set('nvg');
  assert.equal(vision.get(), 'nvg');
  assert.equal(h.created.length, 1);
  const nvg = stageFor(h, 'nvg');
  assert.ok(nvg, 'nvg stage added to the collection');
  assert.equal(nvg.uniforms.intensity, 0);
  assert.equal(nvg.enabled, false, 'invisible until the fade starts');
  assert.ok('time' in nvg.uniforms, 'animated style has a clock');

  h.advance(250, 50);
  assert.ok(nvg.enabled);
  assert.ok(Math.abs(nvg.uniforms.intensity - 0.5) < 0.01, `ease-in-out midpoint, got ${nvg.uniforms.intensity}`);
  h.advance(100, 50);
  assert.ok(nvg.uniforms.intensity > 0.5 && nvg.uniforms.intensity < 1);
  h.advance(200, 50);
  assert.equal(nvg.uniforms.intensity, 1);
  assert.equal(nvg.enabled, true);
  assert.equal(h.collection.stages.length, 1, 'no other stage exists');

  const t0 = nvg.uniforms.time;
  h.advance(100);
  assert.ok(nvg.uniforms.time > t0, 'the clock runs while an animated style is visible');
  assert.ok(h.pendingFrames() > 0);
});

test('switching crossfades out the old style; only the active stage stays enabled', () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.set('nvg');
  h.advance(600);
  vision.set('flir');
  const nvg = stageFor(h, 'nvg');
  const flir = stageFor(h, 'flir');
  h.advance(250, 50);
  assert.ok(nvg.enabled && flir.enabled, 'both visible mid-fade');
  assert.ok(nvg.uniforms.intensity < 1 && flir.uniforms.intensity > 0);
  h.advance(300, 50);
  assert.equal(flir.uniforms.intensity, 1);
  assert.equal(flir.enabled, true);
  assert.equal(nvg.uniforms.intensity, 0);
  assert.equal(nvg.enabled, false);
  assert.equal(h.created.length, 2);
});

test("set('normal') disables every stage and the frame loop stops once still", () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.set('snow');
  h.advance(600);
  vision.set('anime');
  h.advance(600);
  vision.set('normal');
  h.advance(600);
  assert.equal(vision.get(), 'normal');
  for (const s of h.collection.stages) {
    assert.equal(s.enabled, false, `${s.name} disabled`);
    assert.equal(s.uniforms.intensity, 0);
  }
  h.advance(50);
  assert.equal(h.pendingFrames(), 0, 'no frames requested for a still picture');
});

test('a still (non-animated) style stops asking for frames after its fade', () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.set('noir');
  h.advance(600);
  h.advance(50);
  assert.equal(h.pendingFrames(), 0);
  assert.ok(!('time' in stageFor(h, 'noir').uniforms), 'noir has no clock');
});

test('request-render mode gets a render each animation frame; continuous mode is left alone', () => {
  const on = harness({ requestRenderMode: true });
  on.HaloVision.mount(on.viewer).set('crt');
  const before = on.renders();
  on.advance(320, 16);
  assert.ok(on.renders() - before >= 19, `about one render per frame, got ${on.renders() - before}`);

  const off = harness({ requestRenderMode: false });
  off.HaloVision.mount(off.viewer).set('crt');
  off.advance(320, 16);
  assert.equal(off.renders(), 0);
});

test('prefers-reduced-motion switches instantly and holds the animated clock still', () => {
  const h = harness({ reduced: true });
  const vision = h.HaloVision.mount(h.viewer);
  vision.set('crt');
  const crt = stageFor(h, 'crt');
  assert.equal(crt.uniforms.intensity, 1);
  assert.equal(crt.enabled, true);
  assert.equal(h.pendingFrames(), 0, 'no fade and no animation frames');
  vision.set('anime');
  assert.equal(crt.uniforms.intensity, 0);
  assert.equal(crt.enabled, false);
  assert.equal(stageFor(h, 'anime').uniforms.intensity, 1);
  vision.set('normal');
  assert.ok(h.collection.stages.every((s) => !s.enabled));

  vision.set('snow');
  const snow = stageFor(h, 'snow');
  const held = snow.uniforms.time;
  h.advance(500);
  assert.equal(snow.uniforms.time, held, 'clock held');
  // The visitor turns reduced motion off: the clock resumes.
  h.motion.matches = false;
  for (const fn of h.motion.listeners) fn();
  h.advance(200);
  assert.ok(snow.uniforms.time > held);
});

test('sharpen: lazily created 3x3 unsharp mask, toggled, and always after the style', () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.setSharpen(false);
  assert.equal(h.created.length, 0, 'turning it off creates nothing');
  vision.setSharpen(true);
  let sharpen = h.collection.stages.find((s) => s.name.startsWith('halo_vision_sharpen_'));
  assert.ok(sharpen);
  assert.equal(sharpen.enabled, true);
  assert.ok(Math.abs(sharpen.uniforms.amount - 1.08) < 1e-9);
  assert.match(sharpen.fragmentShader, /\/ 9\.0;/, '3x3 box blur');
  vision.setSharpen(false);
  assert.equal(sharpen.enabled, false);
  assert.ok(h.collection.stages.includes(sharpen), 'kept, just disabled');

  vision.setSharpen(true);
  vision.set('noir');
  const last = h.collection.stages.at(-1);
  assert.ok(last.name.startsWith('halo_vision_sharpen_'), 'sharpen runs after the style');
  assert.equal(last.enabled, true);
  assert.equal(sharpen.destroyed, true, 'the earlier sharpen stage was replaced');
  assert.equal(h.collection.stages.filter((s) => s.name.startsWith('halo_vision_sharpen_')).length, 1);
});

test("bloom uses Cesium's built-in stage and is restored on destroy", () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.setBloom(true);
  assert.equal(h.bloom.enabled, true);
  assert.equal(h.bloom.uniforms.glowOnly, false);
  assert.notDeepEqual(h.bloom.uniforms, h.bloomUniforms, 'tuned values applied');
  assert.ok(h.bloom.uniforms.contrast > 0 && h.bloom.uniforms.sigma > 0 && h.bloom.uniforms.stepSize >= 1);
  vision.setBloom(false);
  assert.equal(h.bloom.enabled, false);
  vision.setBloom(true);
  vision.destroy();
  assert.equal(h.bloom.enabled, false);
  assert.deepEqual(h.bloom.uniforms, h.bloomUniforms);

  const host = harness({ bloomEnabled: true });
  const v2 = host.HaloVision.mount(host.viewer);
  v2.setBloom(false);
  assert.equal(host.bloom.enabled, false);
  v2.destroy();
  assert.equal(host.bloom.enabled, true, "the host's own bloom comes back");
});

test('destroy removes every stage it added and stops the loop', () => {
  const h = harness();
  const vision = h.HaloVision.mount(h.viewer);
  vision.set('nvg');
  h.advance(200);
  vision.set('snow');
  vision.setSharpen(true);
  assert.ok(h.collection.stages.length >= 3);
  assert.equal(h.motion.listeners.size, 1);
  vision.destroy();
  assert.equal(h.collection.stages.length, 0);
  assert.ok(h.created.filter((s) => h.collection.stages.includes(s)).length === 0);
  for (const s of h.created) assert.equal(s.destroyed, true, `${s.name} destroyed`);
  assert.equal(h.pendingFrames(), 0);
  assert.equal(h.motion.listeners.size, 0);
  assert.equal(vision.get(), 'normal');
  assert.equal(vision.set('flir'), false);
  vision.setSharpen(true);
  assert.equal(h.collection.stages.length, 0, 'inert after destroy');
  vision.destroy();
});

test('two mounts on one viewer never collide on stage names', () => {
  const h = harness();
  const a = h.HaloVision.mount(h.viewer);
  const b = h.HaloVision.mount(h.viewer);
  a.set('nvg');
  b.set('nvg');
  a.setSharpen(true);
  b.setSharpen(true);
  assert.equal(new Set(h.collection.stages.map((s) => s.name)).size, h.collection.stages.length);
});

function shadersFor(canvas) {
  const h = harness({ reduced: true, canvas });
  const vision = h.HaloVision.mount(h.viewer);
  for (const id of STYLE_IDS) vision.set(id);
  vision.setSharpen(true);
  const out = {};
  for (const id of STYLE_IDS) out[id] = stageFor(h, id);
  out.sharpen = h.collection.stages.find((s) => s.name.startsWith('halo_vision_sharpen_'));
  return out;
}

test('every shader follows the Cesium 1.131 post-process contract', () => {
  for (const [id, stage] of Object.entries(shadersFor({ clientWidth: 1280, clientHeight: 800 }))) {
    const src = stage.fragmentShader;
    assert.match(src, /uniform\s+sampler2D\s+colorTexture\s*;/, `${id}: colorTexture`);
    assert.match(src, /\bin\s+vec2\s+v_textureCoordinates\s*;/, `${id}: v_textureCoordinates`);
    assert.match(src, /\bout_FragColor\s*=/, `${id}: writes out_FragColor`);
    assert.match(src, /void\s+main\s*\(\s*\)/, `${id}: main`);
    assert.doesNotMatch(src, /gl_FragColor|texture2D\s*\(|\bvarying\b/, `${id}: no WebGL1-era names`);
    assert.doesNotMatch(src, /\bint\s*\[\s*\d+\s*\]\s*\(|>>|<</, `${id}: no array constructors or bit shifts (WebGL1-safe)`);
    assert.equal((src.match(/{/g) || []).length, (src.match(/}/g) || []).length, `${id}: balanced braces`);
    for (const name of Object.keys(stage.uniforms)) {
      assert.match(src, new RegExp(`uniform\\s+float\\s+${name}\\s*;`), `${id}: declares uniform ${name}`);
    }
    if (id !== 'sharpen') {
      assert.ok('intensity' in stage.uniforms, `${id}: intensity uniform`);
      assert.equal('time' in stage.uniforms, ANIMATED.has(id), `${id}: time uniform only when animated`);
      assert.equal(/uniform\s+float\s+time\s*;/.test(src), ANIMATED.has(id));
    }
  }
});

test('no shader draws fake telemetry', () => {
  const fake = /timestamp|renderChar|\bdigit\s*\(|\bsegment\s*\(|\bREC\b|recDot|blink|\bframe|tempC|°|scaleBar|temperature|NOFORN|SECRET|CLASSIFIED/i;
  for (const canvas of [{ clientWidth: 1280, clientHeight: 800 }, { clientWidth: 390, clientHeight: 844 }]) {
    for (const [id, stage] of Object.entries(shadersFor(canvas))) {
      assert.doesNotMatch(stage.fragmentShader, fake, `${id} draws no clock, REC, temperature digits or frame counter`);
    }
  }
});

test('kernels are no larger than the originals and smaller on phones', () => {
  const big = shadersFor({ clientWidth: 1280, clientHeight: 800 });
  const phone = shadersFor({ clientWidth: 390, clientHeight: 844 });
  const def = (src, name) => Number((src.match(new RegExp(`#define ${name} (\\d+)`)) || [])[1]);
  assert.equal(def(big.nvg.fragmentShader, 'NVG_R'), 5, 'desktop: the original 11x11 bloom');
  assert.equal(def(big.flir.fragmentShader, 'HEAT_BLUR_R'), 2);
  assert.equal(def(big.flir.fragmentShader, 'HEAT_BLOOM_R'), 4);
  assert.ok(def(phone.nvg.fragmentShader, 'NVG_R') < 5);
  assert.ok(def(phone.flir.fragmentShader, 'HEAT_BLUR_R') < 2);
  assert.ok(def(phone.flir.fragmentShader, 'HEAT_BLOOM_R') < 4);
  for (const stage of [...Object.values(big), ...Object.values(phone)]) {
    for (const m of stage.fragmentShader.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*(-?\d+)\s*;\s*\w+\s*<=?\s*(\d+)/g)) {
      assert.ok(Number(m[2]) - Number(m[1]) <= 10, `literal loop bounds stay small: ${m[0]}`);
    }
  }
});

test('the credit and the honesty note travel with the code', () => {
  assert.match(SRC, /God's Eye View \(MIT, © 2026 Bilawal\s+\*?\s*Sidhu/);
  assert.match(SRC, /Hitman's Halo/);
  assert.match(SRC, /HONESTY/);
  const notice = fs.readFileSync(new URL('../../vendor/LICENSES/gods-eye-view-MIT.txt', import.meta.url), 'utf8');
  assert.match(notice, /^MIT License\n\nCopyright \(c\) 2026 Bilawal Sidhu\n/);
  assert.match(notice, /js\/halo\/vision\.js/);
});
