/* HALO HUD — js/halo/hud.js and css/halo-hud.css, the admin globe's camera
   readout. The pure math is checked against reference vectors generated
   outside this repo:
     - MGRS: the npm `mgrs` package 2.2.0 (proj4js), forward([lon, lat], 5),
       cross-checked against NGA GEOTRANS (python `mgrs`), which agrees to the
       metre on every point below (it only zero-pads one-digit zones);
     - sun: NREL's Solar Position Algorithm (pvlib 0.16.1 spa_python,
       apparent elevation), including the SPA paper's own published example
       (Reda & Andreas 2004: Golden CO, 2003-10-17 12:30:30 −07:00,
       topocentric zenith 50.11162°, i.e. elevation 39.88838°).
   The HUD itself runs in a vm against a stub viewer, a minimal DOM and a
   manual clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../../js/halo/hud.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../../css/halo-hud.css', import.meta.url), 'utf8');
const D2R = Math.PI / 180;

/* ── a minimal DOM ─────────────────────────────────────────────────────── */
class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.parentNode = null;
    this._text = '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  classes() { return this.className.split(/\s+/).filter(Boolean); }
  find(cls) {
    for (const c of this.children) {
      if (c.classes().includes(cls)) return c;
      const deep = c.find(cls);
      if (deep) return deep;
    }
    return null;
  }
  findAll(cls, out = []) {
    for (const c of this.children) {
      if (c.classes().includes(cls)) out.push(c);
      c.findAll(cls, out);
    }
    return out;
  }
}
function makeDocument() {
  const doc = { createElement: (tag) => new El(tag, doc) };
  return doc;
}

/* ── a manual clock: setTimeout / setInterval / Date ───────────────────── */
function makeClock(startMs) {
  let now = startMs;
  let nextId = 1;
  const timers = new Map();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  return {
    Date: FakeDate,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    pending: () => timers.size,
    now: () => now,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let id = null;
        let t = null;
        for (const [k, v] of timers) if (v.at <= end && (t === null || v.at < t.at)) { id = k; t = v; }
        if (!t) break;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
}

/* ── a stub Cesium viewer ──────────────────────────────────────────────── */
function makeViewer({ hit = { lat: 40.7484, lon: -73.9857 }, height = 1500 } = {}) {
  const changed = new Set();
  const moveEnd = new Set();
  const event = (set) => ({ addEventListener: (fn) => set.add(fn), removeEventListener: (fn) => set.delete(fn) });
  let picks = 0;
  const state = { hit };
  const camera = {
    percentageChanged: 0.5,
    positionCartographic: { latitude: 41.2 * D2R, longitude: -73.5 * D2R, height },
    heading: 0.2,
    pitch: -Math.PI / 4,
    changed: event(changed),
    moveEnd: event(moveEnd),
    getPickRay: (pos) => ({ pos }),
  };
  const scene = {
    canvas: { clientWidth: 390, clientHeight: 844 },
    globe: {
      pick(ray) {
        picks += 1;
        assert.equal(ray.pos.x, 195, 'picked at the canvas centre');
        assert.equal(ray.pos.y, 422);
        return state.hit ? { carto: { latitude: state.hit.lat * D2R, longitude: state.hit.lon * D2R, height: 0 } } : undefined;
      },
    },
  };
  return { viewer: { camera, scene }, camera, changed, moveEnd, state, picks: () => picks };
}

function load(clock) {
  const ctx = {
    Cesium: {
      Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
      Cartographic: { fromCartesian: (c) => c.carto },
    },
    Date: clock ? clock.Date : Date,
    setTimeout: clock ? clock.setTimeout : setTimeout,
    clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    setInterval: clock ? clock.setInterval : setInterval,
    clearInterval: clock ? clock.clearInterval : clearInterval,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'js/halo/hud.js' });
  return ctx.HaloHud;
}

const { math } = load();
const compact = (s) => s.replace(/ /g, '');

/* ── math ──────────────────────────────────────────────────────────────── */

const MGRS_VECTORS = [
  ['New York', 40.7484, -73.9857, '18TWL8562811322'],
  ['London', 51.5007, -0.1246, '30UXC9956709427'],
  ['Sydney', -33.8568, 151.2153, '56HLH3490052288'],
  ['Rio de Janeiro', -22.9519, -43.2105, '23KPQ8347660687'],
  ['Cape Town', -33.9249, 18.4241, '34HBH6188143182'],
  ['Tokyo', 35.6586, 139.7454, '54SUE8643746808'],
  ['Nairobi', -1.2921, 36.8219, '37MBU5763457079'],
  ['Quito', -0.1807, -78.4678, '17MQV8186180007'],
  ['Honolulu', 21.3069, -157.8583, '4QFJ1841756542'],
  ['Singapore', 1.2903, 103.8519, '48NUG7226842645'],
  ['Anchorage', 61.2181, -149.9003, '6VUN4424790536'],
  ['Null Island', 0, 0, '31NAA6602100000'],
  ['Bergen (Norway 32V)', 60.3913, 5.3221, '32VKN9735300648'],
  ['Norway 32V west edge', 61, 3.5, '32VKN0277075278'],
  ['Norway 32V NE corner', 63.9, 11.9, '32VPR4231489106'],
  ['West of the Norway exception', 60.3913, 2.9, '31VDG9448894994'],
  ['North of the Norway exception', 64, 5, '31WEL9781298548'],
  ['Longyearbyen (Svalbard 33X)', 78.2232, 15.6267, '33XWG1427883355'],
  ['Svalbard 31X', 80, 5, '31XEJ3876482252'],
  ['Svalbard 35X', 79, 25, '35XMH5740570703'],
  ['Svalbard 37X', 79, 35, '37XDH1485972892'],
  ['South of Svalbard rules', 71.9, 25, '35WMV3066078928'],
  ['McMurdo (band C)', -77.8463, 166.6682, '58CEU3920158225'],
  ['North Greenland (band X)', 83.6, -30, '26XMT6268184410'],
  ['Exactly 84N', 84, 10, '32XNU1166928195'],
  ['Exactly 80S', -80, 10, '32CNS1938418247'],
  ['Wellington', -41.2865, 174.7762, '60GUV1378127052'],
  ['Ushuaia', -54.8019, -68.303, '19FEV4480527029'],
  ['Reykjavik', 64.1466, -21.9426, '27WVM5413813689'],
  ['Antimeridian Fiji', -17.7134, 178.065, '60KXF1292941202'],
  ['Date line west', 65.5, -179.9, '1WCN6584467270'],
];

test('toMGRS matches the reference implementation worldwide, incl. Norway and Svalbard', () => {
  assert.ok(MGRS_VECTORS.length >= 12);
  for (const [name, lat, lon, want] of MGRS_VECTORS) {
    assert.equal(compact(math.toMGRS(lat, lon)), want, `${name} at 1 m`);
    // 10 m: the same reference with each axis truncated to four digits.
    const head = want.slice(0, -10);
    const e = want.slice(-10, -5);
    const n = want.slice(-5);
    assert.equal(compact(math.toMGRS(lat, lon, 4)), head + e.slice(0, 4) + n.slice(0, 4), `${name} at 10 m`);
  }
  assert.ok(MGRS_VECTORS.some(([, lat]) => lat < 0) && MGRS_VECTORS.some(([, lat]) => lat > 0), 'both hemispheres');
});

test('toMGRS formats with spaces and honours digits', () => {
  assert.equal(math.toMGRS(40.7484, -73.9857), '18T WL 85628 11322');
  assert.equal(math.toMGRS(40.7484, -73.9857, 5), '18T WL 85628 11322');
  assert.equal(math.toMGRS(40.7484, -73.9857, 4), '18T WL 8562 1132');
  assert.equal(math.toMGRS(40.7484, -73.9857, 1), '18T WL 8 1');
  assert.equal(math.toMGRS(40.7484, -73.9857, 0), '18T WL');
  assert.equal(math.toMGRS(-33.8568, 151.2153, 3), '56H LH 349 522');
});

test('toMGRS is null outside 84°N / 80°S (no UPS) and for non-numbers', () => {
  for (const [lat, lon] of [[84.0001, 10], [-80.0001, 10], [90, 0], [-90, 0], [NaN, 0], [0, NaN], [Infinity, 0]]) {
    assert.equal(math.toMGRS(lat, lon), null, `${lat}, ${lon}`);
  }
  assert.notEqual(math.toMGRS(84, 10), null);
  assert.notEqual(math.toMGRS(-80, 10), null);
  assert.equal(math.toMGRS(40.7484, -73.9857 + 360), '18T WL 85628 11322', 'longitude wraps');
});

test('dms formats degrees-minutes-seconds with hemispheres', () => {
  assert.equal(math.dms(40.7484, -73.9857), `40°44'54.2"N 073°59'08.5"W`);
  assert.equal(math.dms(-33.8568, 151.2153), `33°51'24.5"S 151°12'55.1"E`);
  assert.equal(math.dms(0, 0), `00°00'00.0"N 000°00'00.0"E`);
  assert.equal(math.dms(-0.00000001, -0.00000001), `00°00'00.0"N 000°00'00.0"E`, 'a value that rounds to zero has no hemisphere sign');
  assert.equal(math.dms(10.999999, 179.999999), `11°00'00.0"N 180°00'00.0"E`, 'seconds carry into minutes and degrees');
  assert.equal(math.dms(-90, -180), `90°00'00.0"S 180°00'00.0"W`);
  assert.equal(math.dms(1.5, 190), `01°30'00.0"N 170°00'00.0"W`, 'longitude wraps');
  assert.equal(math.dms(91, 0), null);
  assert.equal(math.dms(NaN, 0), null);
});

test('gsd is the altitude × 0.000375 m/px estimate', () => {
  assert.equal(math.gsd(1000), 0.375);
  assert.equal(math.gsd(400000), 150);
  assert.equal(math.gsd(0), 0.01);
  assert.equal(math.gsd(-30), 0.01, 'below the ellipsoid still reads the floor');
  assert.equal(math.gsd(NaN), null);
});

const SUN_VECTORS = [
  ['NREL SPA paper example, Golden CO', '2003-10-17T19:30:30Z', 39.742476, -105.1786, 39.88838],
  ['London, June solstice noon', '2026-06-21T12:00:00Z', 51.5074, -0.1278, 61.9347],
  ['Sydney, March equinox mid-afternoon', '2026-03-20T03:00:00Z', -33.8688, 151.2093, 53.7554],
  ['New York, December solstice late morning', '2026-12-21T16:00:00Z', 40.7128, -74.006, 24.6592],
  ['Nairobi, September equinox morning', '2026-09-23T06:00:00Z', -1.2921, 36.8219, 38.717],
  ['Tokyo, low morning sun', '2026-01-15T22:30:00Z', 35.6762, 139.6503, 6.38],
  ['London, midnight (sun below horizon)', '2026-01-01T00:00:00Z', 51.5074, -0.1278, -61.5014],
  ['Longyearbyen, midnight sun', '2026-06-21T23:00:00Z', 78.2232, 15.6267, 11.7354],
];

test('sunElevation agrees with NREL SPA to well within 0.5°', () => {
  for (const [name, iso, lat, lon, want] of SUN_VECTORS) {
    const got = math.sunElevation(new Date(iso), lat, lon);
    assert.ok(Math.abs(got - want) < 0.5, `${name}: ${got} vs ${want}`);
    assert.ok(Math.abs(got - want) < 0.05, `${name} is in fact within 0.05°: ${got} vs ${want}`);
  }
  assert.equal(math.sunElevation(new Date(NaN), 0, 0), null);
  assert.equal(math.sunElevation(new Date('2026-01-01T00:00:00Z'), NaN, 0), null);
  const ms = Date.parse('2026-06-21T12:00:00Z');
  assert.equal(math.sunElevation(ms, 51.5074, -0.1278), math.sunElevation(new Date(ms), 51.5074, -0.1278), 'accepts epoch ms');
});

/* ── the HUD ───────────────────────────────────────────────────────────── */

function mountHud(opts) {
  const clock = makeClock(Date.parse('2026-10-21T12:34:56Z'));
  const HaloHud = load(clock);
  const stub = makeViewer(opts);
  const doc = makeDocument();
  const host = doc.createElement('div');
  const hud = HaloHud.mount(stub.viewer, host);
  const el = host.children[0];
  const value = (name) => el.find(`halo-hud__item--${name}`).findAll('halo-hud__v').map((v) => v.textContent).join(' ');
  return { HaloHud, clock, stub, host, hud, el, value };
}

test('mount appends a shown two-row readout and listens to the camera', () => {
  const { hud, host, el, stub } = mountHud();
  assert.equal(host.children.length, 1);
  assert.deepEqual(el.classes(), ['halo-hud']);
  assert.equal(el.hidden, false);
  assert.equal(hud.shown(), true);
  assert.deepEqual(Object.keys(hud).sort(), ['destroy', 'readout', 'show', 'shown']);
  assert.equal(el.findAll('halo-hud__row').length, 2);
  for (const node of [el, ...el.findAll('halo-hud__row'), ...el.findAll('halo-hud__item')]) {
    assert.ok(node.classes().every((c) => c.startsWith('halo-hud')), 'class names are prefixed halo-hud');
  }
  assert.equal(stub.camera.percentageChanged, 0.01);
  assert.equal(stub.changed.size, 1);
  assert.throws(() => load().mount(stub.viewer, null), { name: 'TypeError' });
});

test('readout: the point at the canvas centre, every field, painted into the HUD', () => {
  const { hud, value, el } = mountHud();
  const r = hud.readout();
  assert.equal(r.source, 'centre');
  assert.ok(Math.abs(r.lat - 40.7484) < 1e-9 && Math.abs(r.lon - -73.9857) < 1e-9);
  assert.equal(r.mgrs, '18T WL 8562 1132', 'MGRS truncated to 10 m');
  assert.equal(r.mgrs, math.toMGRS(40.7484, -73.9857, 4));
  assert.equal(r.altitudeM, 1500);
  assert.ok(Math.abs(r.headingDeg - 11.459) < 0.01);
  assert.ok(Math.abs(r.pitchDeg - -45) < 1e-9);
  assert.equal(r.gsdM, 0.5625);
  assert.equal(r.utc, '2026-10-21T12:34:56.000Z');
  assert.ok(Math.abs(r.sunElevationDeg - math.sunElevation(new Date(r.utc), r.lat, r.lon)) < 1e-9);
  assert.deepEqual({ ...r.text }, {
    lat: `40°44'54.2"N`,
    lon: `073°59'08.5"W`,
    mgrs: '18T WL 8562 1132',
    date: '2026-10-21',
    time: '12:34:56Z',
    hae: '1500 m',
    hdg: '011°',
    pit: '-45°',
    sun: `${Math.round(r.sunElevationDeg)}°`,
    gsd: '0.56 m/px',
  });
  assert.equal(value('lat'), `40°44'54.2"N`);
  assert.equal(value('mgrs'), '18T WL 8562 1132');
  assert.equal(value('utc'), '2026-10-21 12:34:56Z');
  assert.equal(value('hae'), '1500 m');
  assert.equal(value('gsd'), '0.56 m/px');
  assert.equal(el.find('halo-hud__item--gsd').find('halo-hud__k').textContent, 'GSD est.', 'labelled as an estimate');
  assert.equal(el.find('halo-hud__item--hae').find('halo-hud__k').textContent, 'HAE');
  assert.equal(el.getAttribute('data-source'), 'centre');
  r.text.lat = 'mutated';
  assert.equal(hud.readout().text.lat, `40°44'54.2"N`, 'readout returns a copy');
});

test('readout falls back to the camera position when the centre misses the globe', () => {
  const { hud, el } = mountHud({ hit: null, height: 12500 });
  const r = hud.readout();
  assert.equal(r.source, 'camera');
  assert.ok(Math.abs(r.lat - 41.2) < 1e-9 && Math.abs(r.lon - -73.5) < 1e-9);
  assert.equal(r.text.hae, '12.5 km', 'km above 10 km');
  assert.equal(el.getAttribute('data-source'), 'camera');
});

test('altitude, polar and GSD formats', () => {
  const { hud, stub } = mountHud({ hit: { lat: 86, lon: 10 }, height: 20200000 });
  let r = hud.readout();
  assert.equal(r.mgrs, null);
  assert.equal(r.text.mgrs, 'no MGRS (polar)');
  assert.equal(r.text.hae, '20200 km');
  assert.equal(r.text.gsd, '7.6 km/px');
  stub.camera.positionCartographic.height = 9999.4;
  assert.equal(hud.readout().text.hae, '9999 m', 'metres below 10 km');
  stub.camera.positionCartographic.height = 50000;
  r = hud.readout();
  assert.equal(r.text.gsd, '19 m/px');
  stub.camera.heading = 2 * Math.PI - 0.001;
  assert.equal(hud.readout().text.hdg, '000°');
});

test('camera.changed is throttled to one paint per 200 ms, with a trailing paint', () => {
  const { clock, stub } = mountHud();
  const fire = () => { for (const fn of stub.changed) fn(); };
  assert.equal(stub.picks(), 1, 'painted once on mount');
  clock.advance(10);
  for (let i = 0; i < 10; i++) { fire(); clock.advance(15); }
  assert.equal(stub.picks(), 1, 'no paint inside the 200 ms window');
  clock.advance(60);
  assert.equal(stub.picks(), 2, 'one trailing paint at the end of the window');
  clock.advance(300);
  fire();
  assert.equal(stub.picks(), 3, 'an event after a quiet spell paints at once');
});

test('the clock ticks once a second without re-picking the globe', () => {
  const { clock, stub, value } = mountHud();
  const picks = stub.picks();
  clock.advance(1000);
  assert.equal(value('utc'), '2026-10-21 12:34:57Z');
  clock.advance(2000);
  assert.equal(value('utc'), '2026-10-21 12:34:59Z');
  assert.equal(stub.picks(), picks);
});

test('show(false) stops listening and restores the camera; show(true) resumes', () => {
  const { hud, el, stub, clock, value } = mountHud();
  assert.equal(hud.show(false), false);
  assert.equal(hud.shown(), false);
  assert.equal(el.hidden, true);
  assert.equal(stub.changed.size, 0);
  assert.equal(stub.moveEnd.size, 0);
  assert.equal(stub.camera.percentageChanged, 0.5);
  assert.equal(clock.pending(), 0, 'no timers while hidden');
  const before = value('utc');
  clock.advance(5000);
  assert.equal(value('utc'), before, 'a hidden HUD does not repaint');
  assert.equal(hud.show(true), true);
  assert.equal(el.hidden, false);
  assert.equal(stub.changed.size, 1);
  assert.equal(stub.camera.percentageChanged, 0.01);
  assert.equal(value('utc'), '2026-10-21 12:35:01Z', 'repainted on show');
});

test('destroy removes the HUD, its listeners and timers, and restores the camera', () => {
  const { hud, host, stub, clock } = mountHud();
  hud.destroy();
  assert.equal(host.children.length, 0);
  assert.equal(stub.changed.size, 0);
  assert.equal(stub.moveEnd.size, 0);
  assert.equal(stub.camera.percentageChanged, 0.5);
  assert.equal(clock.pending(), 0);
  assert.equal(hud.readout(), null);
  assert.equal(hud.show(true), false);
  assert.equal(hud.shown(), false);
  hud.destroy();
});

test('nothing is labelled classified or as a sensor reading', () => {
  const { el } = mountHud();
  const words = [el.textContent, el.getAttribute('aria-label')].join(' ');
  assert.doesNotMatch(words, /classified|secret|noforn|sensor|\bREC\b|KH-|orbit|mission id/i);
  const shownStrings = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(shownStrings, /classified|secret|noforn|sensor|Math\.random/i);
});

/* ── CSS: mobile first ─────────────────────────────────────────────────── */

test('halo-hud.css is mobile first and never overflows the phone', () => {
  assert.doesNotMatch(CSS, /@media[^{]*max-width/, 'breakpoints only add');
  assert.match(CSS, /@media \(min-width: 600px\)/);
  assert.doesNotMatch(CSS.replace(/minmax\(0,\s*1fr\)/g, ''), /\b1fr\b/, 'minmax(0, 1fr), never a bare 1fr');
  assert.doesNotMatch(CSS, /(?:^|[;{\s])(?:min-)?width:\s*\d{3,}px/m, 'no fixed width a phone cannot hold');
  assert.match(CSS, /max-width:\s*100%/);
  assert.match(CSS, /pointer-events:\s*none/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CSS, /text-shadow:/);
  assert.match(CSS, /font-variant-numeric:\s*tabular-nums/);
  const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.[a-z][\w-]*/g) || [];
  for (const s of selectors) assert.ok(s.startsWith('.halo-hud'), `${s} is prefixed halo-hud`);
  // The phone hides only what a breakpoint adds back (the MGRS label, the date).
  assert.match(CSS, /\.halo-hud__more \{\n  display: none;/);
  assert.match(CSS, /@media \(min-width: 600px\) \{[\s\S]*\.halo-hud__more \{\n    display: inline;/);
});
