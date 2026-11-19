/* The earthquake marks' pure rules (js/environment-quake-marks.js, event timeline slice S5, 2026-11-19): a glyph sized by
   magnitude, the World's own quake pictogram as its trace, a short place from the USGS place line, a label layout that never
   overlaps, never leaves the frame's safe area and always shows the selection, a 44 px tap target, and the horizon. Run in a vm
   realm with a bare window: no Cesium, no canvas. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const source = read('js/environment-quake-marks.js');
const window = {};
vm.runInNewContext(source, { window });
const M = window.MCC_ENVIRONMENT_QUAKE_MARKS;
const P = M.pure;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('glyph size grows with magnitude: 14 px floor, 5.5 px per unit, even sizes, 44 px from M8', () => {
  assert.equal(P.glyphPx(null), 14, 'no magnitude: the smallest glyph');
  assert.equal(P.glyphPx(NaN), 14);
  assert.equal(P.glyphPx(1.2), 14);
  assert.equal(P.glyphPx(4), 22);
  assert.equal(P.glyphPx(5), 28);
  assert.equal(P.glyphPx(6), 34);
  assert.equal(P.glyphPx(7), 38);
  assert.equal(P.glyphPx(8), 44);
  assert.equal(P.glyphPx(9.1), 44, 'capped');
  for (let m = 0; m <= 9.5; m += 0.1) { const px = P.glyphPx(m); assert.equal(px % 2, 0, `even at M${m.toFixed(1)}`); assert.ok(px >= 14 && px <= 44); }
  for (let m = 2.5; m < 9; m += 0.5) assert.ok(P.glyphPx(m + 0.5) >= P.glyphPx(m), 'never smaller for a larger quake');
  assert.ok(P.imagePx(28) > 28, 'the image leaves room for the glow and the selection ring');
});

test('the glyph\'s trace is the World\'s own quake pictogram (the line icon of the quake posts), an icon and never a mark', () => {
  const mnet = read('js/mnet.js');
  const icon = /quake:\s*'<svg viewBox="0 0 24 24"><path d="([^"]+)"\/><\/svg>'/.exec(mnet);
  assert.ok(icon, 'the post pictogram is where the record says it is');
  /* M3 12h3l2-5 3 10 3-8 2 5 2-2h3: absolute points of the path */
  const tokens = icon[1].match(/[MhlHL]|-?\d+(?:\.\d+)?/g);
  const pts = [];
  let x = 0, y = 0, cmd = null;
  for (let i = 0; i < tokens.length;) {
    if (/[A-Za-z]/.test(tokens[i])) { cmd = tokens[i]; i += 1; continue; }
    if (cmd === 'M' || cmd === 'L') { x = Number(tokens[i]); y = Number(tokens[i + 1]); i += 2; }
    else if (cmd === 'l') { x += Number(tokens[i]); y += Number(tokens[i + 1]); i += 2; }
    else if (cmd === 'h') { x += Number(tokens[i]); i += 1; }
    else if (cmd === 'H') { x = Number(tokens[i]); i += 1; }
    pts.push([x, y]);
  }
  assert.deepEqual(plain(P.TRACE), pts);
  assert.doesNotMatch(source, /Equity Uprise|Human Uprise|E\s*=\s*UP|logo/i, 'no brand name or logo in the marks');
});

test('a short place from the USGS place line, cut to 26 characters', () => {
  assert.equal(P.shortPlace('20 km NW of Anamizu, Japan'), 'Anamizu, Japan');
  assert.equal(P.shortPlace('189 km ENE of Nagqu, China'), 'Nagqu, China');
  assert.equal(P.shortPlace('Fiji region'), 'Fiji region');
  assert.equal(P.shortPlace('  south of   the Fiji Islands '), 'the Fiji Islands');
  assert.equal(P.shortPlace('Fixture event, Andreanof Islands, Alaska'), 'Fixture event, Andreanof…');
  assert.equal(P.shortPlace('Fixture event, Andreanof Islands, Alaska').length, 25);
  assert.equal(P.shortPlace(null), ''); assert.equal(P.shortPlace(''), '');
  assert.equal(P.magText(6.34), 'M6.3'); assert.equal(P.magText(7), 'M7.0'); assert.equal(P.magText(null), null);
  assert.ok(P.labelPriority(7.1) > P.labelPriority(6.3)); assert.equal(P.labelPriority(null), -1);
});

test('how many labels a frame carries, and where they may sit', () => {
  assert.equal(P.maxLabels(390, 580), 4);
  assert.equal(P.maxLabels(1280, 800), 14, 'capped at 14');
  assert.equal(P.maxLabels(200, 200), 3, 'at least 3');
  const phone = P.safeArea(390, 360), desk = P.safeArea(1280, 800);
  /* the World page, measured at 390 x 844 and 1280 x 800: its header lies over the frame's top 56 px on a phone, 75 px wider */
  assert.ok(phone.top >= 60 && desk.top >= 80, 'clear of the page header lying over the top of the frame');
  assert.ok(phone.bottom >= 70 && desk.bottom >= 90, 'clear of the legend and the credits at the foot (and the app bar, wider)');
  /* and the corners: the headline at the top left, the music and full-screen buttons at the top right, the app bar wider */
  const corners = plain(P.keepOut(390, 360));
  assert.equal(corners.length, 2);
  assert.ok(corners[0].x === 0 && corners[0].y === 0 && corners[0].h >= 95, 'the headline corner');
  assert.ok(corners[1].x + corners[1].w === 390 && corners[1].y === 0 && corners[1].h >= 155, 'the buttons corner');
  const wide = plain(P.keepOut(723, 800));
  assert.equal(wide.length, 3);
  assert.ok(wide[2].x + wide[2].w === 723 && wide[2].y + wide[2].h === 800, 'the app bar corner');
});

test('labels never sit in a kept-out corner; a quake under one is labelled on its free side or not at all', () => {
  const safe = P.safeArea(390, 360), keepOut = P.keepOut(390, 360);
  /* a quake just under the buttons corner: its right side would run under the buttons, its left side is free */
  const placed = plain(P.layoutLabels([box('a', 300, 150, 7000)], { width: 390, height: 360, max: 3, safe, keepOut, obstacles: [] }));
  assert.equal(placed.length, 1);
  const inCorner = (r) => keepOut.some((k) => r.x < k.x + k.w && k.x < r.x + r.w && r.y < k.y + k.h && k.y < r.y + r.h);
  assert.equal(inCorner(placed[0].rect), false, JSON.stringify(placed[0]));
  assert.notEqual(placed[0].side, 'right');
  /* a quake deep in the headline corner: no label */
  assert.deepEqual(plain(P.layoutLabels([box('b', 40, 40, 7000)], { width: 390, height: 360, max: 3, safe, keepOut, obstacles: [] })), []);
});

const box = (id, x, y, priority, extra) => Object.assign({ id, x, y, r: 12, w: 80, h: 34, priority }, extra || {});
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
test('labels: by magnitude, right of the glyph, else left, above or below, never overlapping, never outside the safe area, at most max', () => {
  const safe = { top: 60, right: 8, bottom: 96, left: 8 };
  const cands = [box('a', 100, 200, 7100), box('b', 110, 210, 6300), box('c', 300, 200, 5000), box('d', 370, 300, 6000), box('e', 200, 30, 6900), box('f', 200, 560, 6800), box('g', 60, 400, 4500)];
  const placed = plain(P.layoutLabels(cands, { width: 390, height: 600, max: 4, safe, obstacles: cands.map((c) => ({ id: c.id, x: c.x, y: c.y, r: c.r, priority: c.priority })) }));
  assert.ok(placed.length <= 4, 'at most max');
  assert.equal(placed[0].id, 'a', 'the largest first');
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) assert.equal(overlap(placed[i].rect, placed[j].rect), false, `${placed[i].id} and ${placed[j].id} do not overlap`);
  for (const p of placed) assert.ok(p.rect.x >= 8 && p.rect.y >= 60 && p.rect.x + p.rect.w <= 382 && p.rect.y + p.rect.h <= 504, `${p.id} inside the safe area`);
  assert.ok(!placed.some((p) => p.id === 'e'), 'a label under the page header is not drawn');
  assert.ok(!placed.some((p) => p.id === 'f'), 'nor one over the legend');
  const d = placed.find((p) => p.id === 'd');
  assert.ok(d && d.side === 'left', 'near the right edge a label goes on the left of its glyph');
  const hits = (c, r) => { const nx = Math.min(r.x + r.w, Math.max(r.x, c.x)), ny = Math.min(r.y + r.h, Math.max(r.y, c.y)); return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r; };
  for (const p of placed) {
    const own = cands.find((c) => c.id === p.id);
    for (const g of cands) if (g.id !== p.id && g.priority >= own.priority) assert.equal(hits(g, p.rect), false, `${p.id}'s label never covers ${g.id}, a quake as large or larger`);
  }
  const b = placed.find((p) => p.id === 'b');
  assert.ok(!b || b.side === 'above' || b.side === 'below', 'a smaller neighbour finds room above or below, or yields');
  const a = placed.find((p) => p.id === 'a');
  assert.ok(a && a.side === 'right', 'the largest quake\'s label may lie over a smaller neighbour\'s glyph');
});

test('labels: the selection is always labelled, placed first, nudged inside the frame, and the others avoid it', () => {
  const safe = { top: 60, right: 8, bottom: 96, left: 8 };
  const cands = [box('big', 120, 200, 7100), box('sel', 130, 205, 4600, { forced: true }), box('edge', 385, 40, 3000, { forced: false })];
  const placed = plain(P.layoutLabels(cands, { width: 390, height: 600, max: 1, safe, obstacles: [] }));
  assert.equal(placed[0].id, 'sel', 'the selection first, whatever its magnitude');
  assert.ok(!placed.some((p) => p.id === 'big'), 'max 1: the selection took the slot, and the larger label yields to it');
  /* a selection at the very top corner (under the page header): still labelled, inside the safe area */
  const corner = plain(P.layoutLabels([box('sel', 380, 20, 1, { forced: true })], { width: 390, height: 600, max: 4, safe, obstacles: [] }));
  assert.equal(corner.length, 1);
  assert.ok(corner[0].rect.y >= 60 && corner[0].rect.x >= 8 && corner[0].rect.x + corner[0].rect.w <= 382, JSON.stringify(corner[0].rect));
});

test('labels never cover the glyph of a quake as large or larger', () => {
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const obstacles = [{ id: 'a', x: 100, y: 100, r: 14, priority: 7000 }, { id: 'other', x: 150, y: 100, r: 14, priority: 7100 }];
  const placed = plain(P.layoutLabels([box('a', 100, 100, 7000)], { width: 400, height: 400, max: 4, safe, obstacles }));
  assert.equal(placed.length, 1);
  assert.equal(placed[0].side, 'left', 'the right side would cover the larger neighbour\'s glyph');
  const smaller = plain(P.layoutLabels([box('a', 100, 100, 7000)], { width: 400, height: 400, max: 4, safe, obstacles: [obstacles[0], { ...obstacles[1], priority: 4000 }] }));
  assert.equal(smaller[0].side, 'right', 'a smaller neighbour\'s glyph does not push the label away');
});

test('the tap target: the nearest visible glyph within 22 px (a 44 px target), larger magnitude on a tie', () => {
  assert.equal(P.HIT_RADIUS_PX, 22);
  const pts = [{ id: 'a', x: 100, y: 100, visible: true, mag: 5 }, { id: 'b', x: 130, y: 100, visible: true, mag: 6 }, { id: 'hidden', x: 101, y: 100, visible: false, mag: 7 }];
  assert.equal(P.nearestWithin(pts, 104, 100, 22), 'a');
  assert.equal(P.nearestWithin(pts, 121, 100, 22), 'b');
  assert.equal(P.nearestWithin(pts, 115, 100, 22), 'b', 'equidistant: the larger quake');
  assert.equal(P.nearestWithin(pts, 100, 123, 22), null, '23 px away: nothing');
  assert.equal(P.nearestWithin(pts, 100, 121.9, 22), 'a', 'just inside 22 px');
  assert.equal(P.nearestWithin([{ id: 'x', x: NaN, y: 1, visible: true }], 0, 0, 22), null);
});

test('the horizon and the limb: a point behind the Earth is hidden; one seen edge-on is not lettered', () => {
  const R = 6371000;
  const at = (lonDeg, latDeg, h = 2000) => { const lo = lonDeg * Math.PI / 180, la = latDeg * Math.PI / 180, r = R + h; return { x: r * Math.cos(la) * Math.cos(lo), y: r * Math.cos(la) * Math.sin(lo), z: r * Math.sin(la) }; };
  const camera = { x: R + 8300000, y: 0, z: 0 };
  assert.equal(P.horizonVisible(at(0, 0), camera), true, 'facing the camera');
  assert.equal(P.horizonVisible(at(180, 0), camera), false, 'the far side');
  assert.equal(P.horizonVisible(at(80, 0), camera), false, 'beyond the horizon at 8,300 km (about 74 degrees)');
  assert.ok(P.facing(at(0, 0), camera) > 0.99);
  assert.ok(P.facing(at(70, 0), camera) < P.LIMB_COS, 'near the limb: visible but not lettered');
  assert.ok(P.facing(at(40, 0), camera) > P.LIMB_COS);
});

test('the marks draw nothing per frame and keep nothing in storage', () => {
  assert.doesNotMatch(source, /CallbackProperty/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(/);
  assert.match(source, /disableDepthTestDistance: Number\.POSITIVE_INFINITY/, 'no glyph or label is cut by the globe\'s limb');
  assert.match(source, /if \(dirty \|\| viewKey\(\) !== lastView\) layout\(\);/, 'the per-frame pass only runs when the view changed');
});
