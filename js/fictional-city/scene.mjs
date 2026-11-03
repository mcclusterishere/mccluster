/* Fictional City — an original, metre-based exploration scene on the house's Three 0.180 stack.
   This module owns only its canvas, rendering, local movement and proximity. The host owns
   identity, authored lore/dialogue, fictional purchases, account saves and portal navigation. */
import * as THREE from 'three';
import { createGeometryKit } from './geometry.mjs';
import { createSpatialWorld, interiorWorld, isWalkable, moveWithCollisions, findWalkingPath } from './spatial.mjs';

const FLOOR_Y = 0.16;
const WALK_SPEED = 6.8;
const COLORS = { water: '#488e91', quay: '#d9c3a0', brick: '#b9866b', road: '#565d60', stone: '#e8d8b9', trim: '#f6ead3', window: '#405960', iron: '#374a4c', roof: '#a9664c', foliage: '#68876b' };
const DEFAULT_HQ = { footprintMeters: [21.9456, 21.9456], roofHeightMeters: 24.6888, floorHeightMeters: 4.1148, occupiedFloors: 6, entry: [0, 74], portalId: 'equity-uprise-hq' };
const editable = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog[open]');
const angleTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function createCityScene({ canvas, manifest, onInteract = () => {}, onPrompt = () => {}, onMove = () => {}, onReady = () => {}, onError = () => {} }) {
  if (!canvas || !manifest) throw new TypeError('City scene needs its host canvas and district manifest.');
  const source = manifest.district || manifest;
  const shops = manifest.businesses || source.businesses || [];
  const garage = manifest.garage || source.garage || null;
  const buildings = garage && !shops.some(b => b.id === garage.id) ? [...shops, garage] : [...shops];
  const byId = new Map(buildings.map(b => [b.id, b]));
  const garageId = garage?.id || buildings.find(b => /garage|whip-equipped/.test(b.id))?.id;
  const hq = { ...DEFAULT_HQ, ...(source.island?.hq || manifest.island?.hq || {}) };
  const spatial = createSpatialWorld(buildings, hq);
  const kit = createGeometryKit();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) { kit.dispose(); onError(error); throw error; }
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e0e9e7');
  scene.fog = new THREE.Fog('#e0e9e7', 115, 255);
  const camera = new THREE.OrthographicCamera(-24, 24, 24, -24, 0.1, 400);
  const hemi = new THREE.HemisphereLight('#fff6de', '#697d78', 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe6bc', 1.6); sun.position.set(-55, 85, 20); scene.add(sun);
  const worldGroup = new THREE.Group(), interiorGroup = new THREE.Group(), actorsGroup = new THREE.Group();
  scene.add(worldGroup, interiorGroup, actorsGroup); interiorGroup.visible = false;
  const pickables = [], worldTargets = [], interiorTargets = [];
  let interiorSpatial = null, currentInterior = null;
  const B = kit.batch(worldGroup);

  function box(color, x, y, z, w, h, d, rotation, target) { B.add('box', color, x, y, z, w, h, d, rotation, target); }
  function tree(x, z, variant = 0) {
    B.add('cylinder', '#856348', x, 1.6, z, .45, 3, .45);
    B.add('sphere', variant % 2 ? '#82976a' : COLORS.foliage, x, 4.0, z, 4.1, 4.3, 3.7);
    B.add('sphere', '#78966e', x + .8, 3.7, z - .4, 2.8, 3.2, 2.8);
    B.add('cylinder', '#dbccae', x, .3, z, 2.2, .5, 2.2);
    B.add('cylinder', '#70674c', x, .56, z, 1.9, .05, 1.9);
  }
  function lamp(x, z) {
    B.add('cylinder', COLORS.iron, x, 2.7, z, .16, 5.3, .16);
    B.add('cylinder', COLORS.iron, x, .25, z, .45, .4, .45);
    B.add('cone', COLORS.iron, x, 5.3, z, 1.2, .4, 1.2);
    B.add('sphere', '#ffe7ad', x, 5.05, z, .55, .38, .55, null, null, { basic: true });
  }
  function van(batch, x, z, color = '#6b816f', scale = 1, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const part = (shape, col, dx, y, dz, w, h, d, rot = null) => batch.add(shape, col,
      x + (dx * c + dz * s) * scale, y * scale + FLOOR_Y, z + (dz * c - dx * s) * scale,
      w * scale, h * scale, d * scale, [rot?.[0] || 0, yaw + (rot?.[1] || 0), rot?.[2] || 0]);
    part('box', color, 0, 1.0, 0, 5.1, 1.7, 2.3);
    part('box', color, -.25, 1.9, 0, 4.6, .55, 2.25);
    part('box', '#425a5f', 1.7, 1.85, 0, .07, .7, 1.85, [0, 0, -.16]);
    part('box', '#48636b', -.1, 1.73, -1.17, 2.8, .65, .025);
    part('box', '#48636b', -.1, 1.73, 1.17, 2.8, .65, .025);
    part('box', '#ded4b7', 2.6, .48, 0, .18, .23, 2.35);
    part('box', '#fbeac5', 2.61, 1.1, -.75, .04, .3, .45);
    part('box', '#fbeac5', 2.61, 1.1, .75, .04, .3, .45);
    for (const dx of [-1.65, 1.55]) for (const dz of [-1.1, 1.1]) {
      part('cylinder', '#303838', dx, .46, dz, 1, .3, 1, [Math.PI / 2, 0, 0]);
      part('cylinder', '#babbb0', dx, .46, dz * 1.14, .45, .035, .45, [Math.PI / 2, 0, 0]);
    }
  }

  // A connected main district, small island and bridge. Harbour edges are physical walk boundaries.
  box(COLORS.water, 0, -.8, 50, 400, 1, 340);
  box(COLORS.quay, 0, -.32, -6.5, 144, .8, 103);
  box('#a7997d', 0, -.45, 88, 40, 1.1, 40);
  box(COLORS.stone, 0, .03, 88, 39.8, .22, 39.8);
  box('#9b8170', 0, -.05, 56.5, 10, .4, 27);
  for (let z = 45; z <= 69; z += 1.1) box('#bdac8d', 0, .18, z, 9.7, .08, .13);
  for (const x of [-4.8, 4.8]) {
    box(COLORS.iron, x, 1.18, 57.5, .12, .15, 25);
    for (let z = 45; z < 70; z += 4) box(COLORS.iron, x, .65, z, .15, 1.3, .15);
  }
  for (let x = -68; x <= 68; x += 8) for (const z of [46, 108]) if (Math.abs(x) > 7 || z === 108) {
    if (z === 108 && Math.abs(x) > 19) continue;
    B.add('cylinder', '#dad0b6', x, .4, z - .8, .6, .85, .6);
  }
  for (let i = 0; i < 28; i++) {
    const x = ((i * 31) % 190) - 95, z = 51 + ((i * 19) % 85);
    if (Math.abs(x) < 24 && z < 110) continue;
    box('#75aaa8', x, -.265, z, 2 + i % 4, .025, .12);
  }
  box(COLORS.road, 0, .105, -1, 144, .06, 18);
  for (const z of [-12, 10]) box(COLORS.brick, 0, .15, z, 144, .15, 4);
  box(COLORS.brick, 0, .15, 38.6, 144, .15, 12.8);
  box(COLORS.brick, 0, .15, -41, 144, .15, 7);
  for (const x of [-64, -32, 0, 32, 64]) box('#ccaa88', x, .155, -3, 5.5, .17, 100);
  // Brick joints use one shared instanced draw, rather than hundreds of separate meshes.
  for (const z of [-13, -11, 9, 11, 35, 38, 41, 44]) {
    box('#a57863', 0, .237, z, 144, .012, .04);
    for (let x = -70; x <= 70; x += 2.4) box('#a57863', x + (z % 2 ? .6 : 0), .238, z + .5, .035, .013, 1);
  }
  for (let x = -68; x <= 68; x += 8) box('#ece1bf', x, .15, -1, 3.5, .025, .18);
  for (const x of [-32, 0, 32]) for (let z = -8; z <= 6; z += 2.2) box('#e5dcc4', x, .16, z, 3.8, .025, 1.05);
  for (const z of [-10.1, 8.1]) box('#eee0bb', 0, .22, z, 144, .25, .28);
  for (const x of [-65, -32, 32, 65]) { tree(x, -10.2, x); tree(x, 11, x + 1); }
  for (const x of [-58, -26, 6, 38, 67]) { lamp(x, -10.4); lamp(x, 8.8); }
  for (const x of [-57, -26, 26, 57]) {
    box('#7b6a55', x, .85, 39.5, 3.2, .18, .65);
    box('#7b6a55', x, 1.35, 39.85, 3.2, .65, .12);
    for (const dx of [-1.2, 1.2]) box(COLORS.iron, x + dx, .45, 39.5, .1, .85, .6);
    tree(x + 6, 40, x);
  }

  const buildingTargets = new Map();
  function storefront(b, index) {
    const isTea = b.id === 'tea' || b.id === 'gauranfucking-tea';
    const [x, z] = b.position, [w, d, rawH] = b.size, height = rawH || 7;
    const front = b.entrance[1] > z ? 1 : -1;
    const fz = z + front * (d / 2 + .03), yaw = front === 1 ? 0 : Math.PI;
    const target = { kind: 'building', id: b.id };
    B.setTarget(target);
    buildingTargets.set(b.id, target);
    worldTargets.push({ target, x: b.entrance[0], z: b.entrance[1], radius: 3.3, label: `Enter ${b.name}` });
    const color = b.color || ['#d3b48c', '#b87f73', '#c4b6a0', '#57656a'][index % 4];
    box(color, x, height / 2 + FLOOR_Y, z, w, height, d, null, target);
    box('#b9aa90', x, .48, z, w + .25, .6, d + .25);
    box(COLORS.trim, x, height + .12, z, w + .6, .25, d + .6);
    const isGarage = b.id === garageId;
    const windows = isGarage ? 3 : 2;
    for (let n = 0; n < windows; n++) {
      const wx = isGarage ? x + (n - 1) * 8.6 : x + (n ? 1 : -1) * w * .29;
      const ww = isGarage ? 7 : w * .32;
      box(COLORS.trim, wx, 2.1, fz + front * .045, ww + .35, 3.6, .18);
      box(isGarage ? '#354247' : COLORS.window, wx, 2.1, fz + front * .15, ww, 3.25, .12, null, target);
      if (isGarage) for (let y = .6; y <= 3.6; y += .55) box('#536368', wx, y, fz + front * .23, ww - .1, .055, .06);
      else {
        box('#a2b8b0', wx, 2.85, fz + front * .23, ww - .25, .09, .05);
        box(COLORS.trim, wx, 2.1, fz + front * .23, .1, 3.25, .06);
        box('#ddc49b', wx, .7, fz + front * .35, ww + .3, .2, .6);
      }
    }
    if (!isGarage) {
      box(COLORS.trim, x, 1.95, fz + front * .1, 2.5, 3.8, .22);
      box('#31464a', x, 1.9, fz + front * .23, 2.15, 3.5, .1, null, target);
      box('#dfc59a', x + .65, 1.75, fz + front * .32, .07, .45, .05);
    }
    // Ordinary shop lettering, not an invented logo or redrawn owner mark.
    const sign = kit.sign(worldGroup, b.name, b.tagline || '', { x, y: Math.min(height - .8, 5.35), z: fz + front * .4, width: w - 1.1, height: 2.05, yaw, background: '#2b3d40', accent: '#efd3a2' });
    sign.userData.target = target; pickables.push(sign);
    const awning = b.id === 'hordash' ? '#94708a' : isTea ? '#6e8b70' : b.id === 'mike-hawk' ? '#a96455' : color;
    if (!isGarage) {
      box(awning, x, 3.82, fz + front * 1.05, w - .7, .18, 2.2, [-front * .10, 0, 0]);
      box(awning, x, 3.55, fz + front * 2.1, w - .7, .43, .1);
    }
    if (isTea) {
      B.add('roof', '#9b6451', x, height + .2, z, w + 1, 2.4, d + 1);
      B.add('cylinder', '#f3e3be', x - 6, height + 3.3, z, 3.2, 2.6, 3.2);
      B.add('cylinder', '#695846', x - 6, height + 4.63, z, 2.7, .07, 2.7);
      B.add('torus', '#f3e3be', x - 4.3, height + 3.4, z, 2, 2, .7);
    } else if (b.id === 'mike-hawk') {
      B.add('roof', '#d5c6a4', x, height + .2, z, w + .8, 2.6, d + .8);
      for (const dx of [-w * .43, w * .43]) B.add('cylinder', COLORS.trim, x + dx, 2, fz + front * 1.4, .65, 4, .65);
      box('#536d75', x + w * .43, height + 3, z + front * 1, .09, 4, .09);
      box('#b87768', x + w * .43 + 1.1, height + 3.9, z + front * 1, 2.2, 1.1, .05);
    } else if (b.id === 'real-camera-men') {
      box('#283a3f', x, height + 1.25, z, 4.2, 2.2, 2.2);
      B.add('cylinder', '#455a5f', x, height + 1.25, z + front * 1.45, 2.3, 1.5, 2.3, [Math.PI / 2, 0, 0]);
      B.add('cylinder', '#8caeb0', x, height + 1.25, z + front * 2.23, 1.5, .08, 1.5, [Math.PI / 2, 0, 0]);
    } else if (b.id === 'pressure-tv') {
      B.add('cylinder', '#5a6767', x - 6, height + 3.3, z, .16, 6.5, .16);
      for (let y = height + 2; y < height + 6; y += 1.5) box('#5a6767', x - 6, y, z, 3, .08, .08);
      box('#cf9e75', x + 3, height + 1.6, z, 5, 2.8, 2);
      box('#7aa3a1', x + 3, height + 1.6, z + front * 1.02, 4.2, 2, .08);
    } else if (b.id === 'robbery-1s') {
      box('#d5b586', x - 2, height + .65, z, 6, 1.1, 2.5);
      box('#e6d8b7', x + .7, height + 1.6, z, 2.4, 1.3, 2.45);
      box('#303c40', x - 2, height + .15, z, 6.5, .3, 2.7);
    } else if (b.id === 'hitman-gear') {
      for (const dx of [-5, 5]) B.add('roof', '#777962', x + dx, height + .25, z, 9, 1.8, d);
    } else if (b.id === 'baddies-on-wheels') {
      B.add('torus', '#49585a', x, height + 2, z, 4, 4, 1.5);
      for (const dx of [-5.5, 5.5]) {
        B.add('cylinder', '#3a4141', x + dx, .65, fz + front * 2.7, 1.1, .35, 1.1, [Math.PI / 2, 0, 0]);
        box('#c29179', x + dx, 1.4, fz + front * 2.7, .65, .6, 1.5);
      }
    } else if (isGarage) {
      for (let i = 0; i < 4; i++) B.add('torus', '#35413f', x - w / 2 - 1.5, .4 + i * .45, z + d / 2 - 1, 1.5, 1.5, 1.3, [Math.PI / 2, 0, 0]);
      van(B, x - 24, z + 2, '#6c8571', 1.1, .16);
      box('#b27a4d', x + w / 2 + 2, 1.2, z + 3, 1.7, 2.3, 1.4);
    }
    B.setTarget(null);
  }
  buildings.forEach(storefront);
  van(B, 57, -4, '#c4b6a2', .95);
  van(B, -49, 4, '#a5715f', .85, Math.PI);

  // Canonical-dimension exterior only: six occupied storeys and the open roof at +81 ft.
  // World placement rotates the normal F1 entrance toward the bridge; this adds no rooms/floors.
  const [hqW, hqD] = hq.footprintMeters, roofH = hq.roofHeightMeters;
  const hqTarget = { kind: 'portal', id: hq.portalId };
  B.setTarget(hqTarget);
  box('#b9c7c3', 0, roofH / 2 + FLOOR_Y, 88, hqW, roofH, hqD, null, hqTarget);
  for (let floor = 0; floor < hq.occupiedFloors; floor++) {
    const y = floor * hq.floorHeightMeters + hq.floorHeightMeters / 2 + FLOOR_Y;
    for (const sign of [-1, 1]) {
      box('#617f83', 0, y, 88 + sign * (hqD / 2 + .012), hqW - .3, hq.floorHeightMeters - .42, .04);
      box('#718f91', sign * (hqW / 2 + .012), y, 88, .04, hq.floorHeightMeters - .42, hqD - .3);
    }
    box('#d9ded0', 0, floor * hq.floorHeightMeters + FLOOR_Y + .05, 88, hqW + .18, .22, hqD + .18);
  }
  box('#ece8d6', 0, roofH + FLOOR_Y - .09, 88, hqW, .18, hqD);
  B.setTarget(null);
  box('#dac9a8', 0, .15, 73, 7, .1, 10);
  const hqSign = kit.sign(worldGroup, 'Equity Uprise HQ', 'ISLAND ENTRANCE', { x: 0, y: 2.1, z: 73.5, width: 9, height: 1.65, yaw: Math.PI });
  hqSign.userData.target = hqTarget; pickables.push(hqSign);
  worldTargets.push({ target: hqTarget, x: hq.entry[0], z: hq.entry[1], radius: 3.6, label: 'Visit Equity Uprise HQ' });
  for (const x of [-15.5, 15.5]) { tree(x, 73, x); lamp(x, 99); }
  // Public wayfinding is plain text; no substitute brand mark is fabricated.
  kit.sign(worldGroup, 'THE COMMERCIAL DISTRICT', 'SHOP FRONTS · ROAD STORIES · HARBOUR WALK', { x: -39, y: 4.8, z: 43.5, width: 23, height: 2.7, yaw: Math.PI });
  const staticMeshes = B.finish();
  for (const m of staticMeshes) if (m.userData.instanceTargets.some(Boolean)) pickables.push(m);
  const occluders = buildings.map(b => ({ id: b.id, minX: b.position[0] - b.size[0] / 2, maxX: b.position[0] + b.size[0] / 2, minZ: b.position[1] - b.size[1] / 2, maxZ: b.position[1] + b.size[1] / 2, height: b.size[2], fade: 1 }));
  occluders.push({ id: hq.portalId, minX: -hqW / 2, maxX: hqW / 2, minZ: 88 - hqD / 2, maxZ: 88 + hqD / 2, height: roofH, fade: 1 });
  const occluderById = new Map(occluders.map(o => [o.id, o]));

  // All 27 staff identities have distinct data-driven models. Staff assigned indoors are drawn there.
  const rawNpcs = [...(manifest.npcs || source.npcs || [])];
  const crewSource = manifest.garageCrew || source.garageCrew || [];
  for (const person of crewSource) if (typeof person === 'object' && !rawNpcs.some(n => n.id === person.id)) rawNpcs.push({ ...person, businessId: person.businessId || garageId, placement: person.placement || 'interior' });
  const skinPalette = ['#976d50', '#c99d79', '#78543e', '#b78361', '#d0af91'];
  const clothPalette = ['#4f7c78', '#bc7964', '#879166', '#697d91', '#b29a69', '#8d7181'];
  const actors = rawNpcs.map((n, i) => {
    const business = byId.get(n.businessId), entry = business?.entrance || [0, 0];
    const route = Array.isArray(n.route) && n.route.length ? n.route.map(p => ({ x: p[0], z: p[1] })) : [{ x: entry[0] + (i % 2 ? 2 : -2), z: entry[1] }];
    if (!isWalkable(route[0].x, route[0].z, spatial, .3)) route[0] = { x: entry[0] + (i % 2 ? 2 : -2), z: entry[1] };
    const target = { kind: 'npc', id: n.id };
    return { data: n, id: n.id, target, prompt: { target, label: `Talk to ${n.name}`, x: 0, z: 0 }, x: route[0].x, z: route[0].z, yaw: i % 2 ? -.4 : .4, phase: i * 1.7, moving: false, visible: true,
      route, routeIndex: route.length > 1 ? 1 : 0, index: i, width: .92 + (i % 4) * .05, height: .95 + (i % 5) * .025,
      appearance: { shirt: clothPalette[i % clothPalette.length], skin: skinPalette[i % skinPalette.length], hair: ['#322f2b', '#544039', '#292d2b'][i % 3], ...(n.appearance || {}) } };
  });
  const npcById = new Map(actors.map(a => [a.id, a]));
  const player = { x: 0, z: 2.5, interior: null, yaw: Math.PI, phase: 0, width: 1, height: 1, moving: false, visible: true, id: '__player', index: actors.length, appearance: { shirt: '#668f9e', skin: '#a88767', hair: '#36484b' } };
  const allActors = [...actors, player], dynamicBins = new Map();
  function actorPart(a, shape, color, x, y, z, sx, sy, sz, joint = null, angle = 0) {
    // Per-instance colour keeps every person's authored palette without a draw per shirt/skin tone.
    if (!dynamicBins.has(shape)) dynamicBins.set(shape, { geometry: kit.geometries[shape], material: kit.material('#ffffff'), parts: [] });
    dynamicBins.get(shape).parts.push({ actor: a, color, x, y, z, sx, sy, sz, joint, angle });
  }
  for (const a of allActors) {
    const ap = a.appearance, i = a.index;
    actorPart(a, 'box', ap.shirt, 0, 1.16, 0, .54, .65, .32);
    actorPart(a, 'box', '#445355', 0, .82, 0, .47, .23, .3);
    actorPart(a, 'sphere', ap.skin, 0, 1.67, .015, .43, .49, .42);
    actorPart(a, 'cylinder', ap.skin, 0, 1.43, 0, .14, .17, .14);
    actorPart(a, 'sphere', ap.hair, 0, 1.82, -.025, .45, .27 + (i % 3) * .035, .43);
    if (i % 4 === 0) actorPart(a, 'box', ap.hair, 0, 1.76, -.15, .38, .3, .12);
    if (i % 5 === 0 || a === player) {
      actorPart(a, 'cylinder', ap.shirt, 0, 1.87, .01, .47, .13, .47);
      actorPart(a, 'box', ap.shirt, 0, 1.84, .23, .33, .035, .23);
    }
    for (const side of [-1, 1]) {
      actorPart(a, 'box', '#38484b', side * .14, .45, 0, .19, .65, .23, side === 1 ? 'legR' : 'legL');
      actorPart(a, 'box', i % 3 ? '#e2d8c3' : '#46524f', side * .14, .12, .08, .22, .17, .36, side === 1 ? 'footR' : 'footL');
      actorPart(a, 'box', ap.shirt, side * .36, 1.17, 0, .18, .38, .22, side === 1 ? 'armR' : 'armL');
      actorPart(a, 'box', ap.skin, side * .36, .88, .015, .13, .31, .14, side === 1 ? 'handR' : 'handL');
    }
    if (i % 3 === 1) actorPart(a, 'box', '#d6bb82', -.1, 1.3, .173, .1, .06, .018);
    if (i % 4 === 2) actorPart(a, 'box', '#344546', 0, 1.7, .205, .35, .065, .035);
  }
  const dynamicMeshes = [];
  for (const bin of dynamicBins.values()) {
    const mesh = new THREE.InstancedMesh(bin.geometry, bin.material, bin.parts.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    for (let i = 0; i < bin.parts.length; i++) mesh.setColorAt(i, new THREE.Color(bin.parts[i].color));
    mesh.instanceColor.needsUpdate = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 220);
    mesh.userData.instanceTargets = bin.parts.map(p => p.actor.target || null);
    actorsGroup.add(mesh); bin.mesh = mesh; dynamicMeshes.push(mesh); pickables.push(mesh);
  }
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#f9d795', transparent: true, opacity: .9, depthWrite: false });
  const ringGeometry = new THREE.RingGeometry(.64, .82, 32);
  const playerRing = new THREE.Mesh(ringGeometry, ringMaterial); playerRing.rotation.x = -Math.PI / 2; scene.add(playerRing);
  const destinationRing = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: '#fff1c9', transparent: true, opacity: .7, depthWrite: false }));
  destinationRing.rotation.x = -Math.PI / 2; destinationRing.visible = false; scene.add(destinationRing);
  const contactMaterial = new THREE.MeshBasicMaterial({ color: '#203b3d', transparent: true, opacity: .22, depthWrite: false });
  const contact = new THREE.Mesh(kit.geometries.circle, contactMaterial); contact.rotation.x = -Math.PI / 2; contact.scale.set(1.35, .85, 1); scene.add(contact);

  function buildInterior(b) {
    kit.clearGroup(interiorGroup); interiorTargets.length = 0;
    const isGarage = b.id === garageId;
    interiorSpatial = interiorWorld(isGarage);
    const w = interiorSpatial.width, d = interiorSpatial.depth, ib = kit.batch(interiorGroup);
    const add = (...args) => ib.add(...args);
    add('box', isGarage ? '#aaa89b' : '#d9c3a1', 0, .05, 0, w, .2, d);
    add('box', b.color || '#c0ad90', 0, 2, -d / 2, w, 4, .25);
    add('box', '#d5c6aa', -w / 2, 1.35, 0, .25, 2.7, d);
    add('box', '#d5c6aa', w / 2, 1.35, 0, .25, 2.7, d);
    // The front and roof are cut away so the room remains readable on a phone.
    add('box', '#aa8d6b', 0, .25, d / 2, w, .45, .25);
    for (let x = -w / 2 + 1; x < w / 2; x += 1.5) add('box', '#bda987', x, .16, 0, .035, .015, d);
    if (isGarage) {
      van(ib, -6.5, -2.8, '#6f8972', 1.0);
      add('box', '#5a7373', 6.2, 1, -4.1, 6.4, 1.9, 1.4);
      add('box', '#d7b582', 6.2, 2, -4.1, 6.7, .16, 1.65);
      for (let i = 0; i < 6; i++) add('box', i % 2 ? '#856959' : '#5d7e82', 3.7 + i, 2.35, -4.2, .3, .55, .4);
      for (const x of [-10, 10]) for (let i = 0; i < 4; i++) add('torus', '#374342', x, .45 + i * .45, -4.6, 1.35, 1.35, 1.1, [Math.PI / 2, 0, 0]);
      for (const x of [-8.5, -4.5]) add('box', '#ca9b5c', x, .2, -2.8, .13, .04, 6);
      if ((manifest.portals || source.portals || []).some(p => p.id === 'transportation-globe')) {
        const target = { kind: 'portal', id: 'transportation-globe' };
        // A physical kiosk for the existing globe destination, not another globe engine.
        add('cylinder', '#3f6265', 5.8, .65, 3.4, 1.4, 1.25, 1.4, null, target);
        add('sphere', '#78a9a7', 5.8, 2.0, 3.4, 1.9, 1.9, 1.9, null, target);
        add('torus', '#ead0a0', 5.8, 2.0, 3.4, 2.05, 2.05, .32, [Math.PI / 2, 0, 0], target);
        add('torus', '#ead0a0', 5.8, 2.0, 3.4, 2.05, 2.05, .32, [0, Math.PI / 2, .25], target);
        const globeSign = kit.sign(interiorGroup, 'TRANSPORTATION GLOBE', '', { x: 5.8, y: 3.35, z: 3.4, width: 4.5, height: .65 });
        globeSign.userData.target = target;
        interiorTargets.push({ target, x: 5.8, z: 3.4, radius: 2.6, label: 'Open the transportation globe' });
      }
    } else {
      add('box', '#96795e', 0, .8, -2.35, 9.2, 1.5, 1.3);
      add('box', '#ede1c6', 0, 1.59, -2.35, 9.5, .16, 1.5);
      add('box', '#335253', 0, .9, -1.68, 8.6, .75, .045);
      add('box', '#344d52', 2.8, 1.9, -2.35, .75, .5, .18, [-.2, 0, 0]);
      for (const x of [-6.8, 6.8]) {
        add('box', '#8c7961', Math.sign(x) * (w / 2 - .3), 1.4, -1.1, .18, 2.7, 5.1);
        for (const y of [.55, 1.35, 2.15]) {
          add('box', '#e3cfaa', x, y, -1.1, 1.65, .1, 5.2);
          for (let j = 0; j < 4; j++) add(/tea/.test(b.id) ? 'cylinder' : 'box', ['#caa16f', '#63817b', '#ab7562', '#829289'][j], x, y + .28, -2.8 + j * 1.1, .7, .45, .65);
        }
      }
    }
    const title = kit.sign(interiorGroup, b.name, isGarage ? 'THE SHOP · THE ROAD · THE STORIES' : 'COME IN. ASK A QUESTION. STAY A MINUTE.', { x: 0, y: 3.02, z: -d / 2 + .16, width: isGarage ? 15 : 12, height: 1.15 });
    title.userData.target = { kind: 'counter', id: b.id };
    kit.sign(interiorGroup, 'BACK TO THE STREET', '', { x: 0, y: .28, z: d / 2 - .75, width: 4.5, height: .7 });
    const roomMeshes = ib.finish();
    // Interior picking is range-checked just like the outside, with a dedicated counter/exit target.
    interiorTargets.push({ target: { kind: 'counter', id: b.id }, x: isGarage ? 6 : 0, z: isGarage ? -2.2 : -.6, radius: 3.1, label: isGarage ? 'Open the garage counter' : `Browse ${b.name}` });
    interiorTargets.push({ target: { kind: 'exit', id: b.id }, x: 0, z: d / 2 - .65, radius: 2.2, label: 'Return to the street' });
    interiorGroup.userData.pickables = [...interiorGroup.children.filter(o => o.userData.target), ...roomMeshes];
  }

  let paused = false, disposed = false, failed = false, raf = 0, lastTime = 0, firstFrame = true;
  let currentPrompt = null, lastPromptKey = '', path = [], pathIndex = 0, approachTarget = null;
  let cameraYaw = .68, desiredYaw = .68, zoom = 1, desiredZoom = 1, drag = null;
  const cameraFocus = new THREE.Vector3(player.x, .4, player.z), cameraGoal = new THREE.Vector3();
  const externalInput = { x: 0, z: 0 }, keys = new Set(), movedPoint = { x: 0, z: 0 };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y), hit = new THREE.Vector3();
  const actorMatrix = new THREE.Matrix4(), localMatrix = new THREE.Matrix4(), composed = new THREE.Matrix4();
  const p3 = new THREE.Vector3(), sc3 = new THREE.Vector3(), q3 = new THREE.Quaternion(), localQ = new THREE.Quaternion(), rotation = new THREE.Euler();
  const reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let fps = 0, frameCount = 0, fpsTime = 0, elapsed = 0, lastMovedAt = -1, lastSavedX = NaN, lastSavedZ = NaN;
  let visibleNpcs = 0, currentWidth = 0, currentHeight = 0;

  function activeWorld() { return currentInterior ? interiorSpatial : spatial; }
  function getPlayer() { return { x: player.x, z: player.z, interior: currentInterior }; }
  function clearInput() { keys.clear(); externalInput.x = externalInput.z = 0; path.length = 0; pathIndex = 0; approachTarget = null; destinationRing.visible = false; }
  function changed(force = false) {
    if (force || (elapsed - lastMovedAt > .18 && (Math.abs(lastSavedX - player.x) > .08 || Math.abs(lastSavedZ - player.z) > .08 || Number.isNaN(lastSavedX)))) {
      lastMovedAt = elapsed; lastSavedX = player.x; lastSavedZ = player.z; onMove(getPlayer());
    }
  }
  function prompt(value) {
    const k = value ? `${value.target.kind}:${value.target.id}` : '';
    currentPrompt = value;
    if (k !== lastPromptKey) { lastPromptKey = k; onPrompt(value ? { label: value.label, target: value.target } : null); }
  }
  function npcIsInside(a) { return a.data.placement === 'interior' || a.data.businessId === garageId; }
  const staffedInteriors = new Set(actors.filter(npcIsInside).map(a => a.data.businessId));
  const fallbackAttendants = new Map();
  for (const a of actors) if (!staffedInteriors.has(a.data.businessId) && !fallbackAttendants.has(a.data.businessId)) fallbackAttendants.set(a.data.businessId, a.id);
  const interiorCounts = new Map();
  for (const a of actors) if (npcIsInside(a)) interiorCounts.set(a.data.businessId, (interiorCounts.get(a.data.businessId) || 0) + 1);
  function currentNpc(a) { return currentInterior ? a.data.businessId === currentInterior && (npcIsInside(a) || fallbackAttendants.get(currentInterior) === a.id) : !npcIsInside(a); }

  function updateActors(dt) {
    visibleNpcs = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]; a.visible = currentNpc(a); a.moving = false;
      if (!a.visible) continue; visibleNpcs++;
      if (currentInterior) {
        const atGarage = currentInterior === garageId;
        let n = 0; for (let j = 0; j < i; j++) if (actors[j].data.businessId === currentInterior && currentNpc(actors[j])) n++;
        a.drawX = atGarage ? [-1.8, 3.6, 7.8][n % 3] : (n - ((interiorCounts.get(currentInterior) || 1) - 1) / 2) * 3.5;
        a.drawZ = atGarage ? [-2.4, .4, 1.5][n % 3] : -3.85;
        a.drawYaw = atGarage ? [.1, -.5, -.8][n % 3] : 0;
      } else {
        if (!paused && a.data.placement === 'patrol' && a.route.length > 1) {
          const dest = a.route[a.routeIndex], dx = dest.x - a.x, dz = dest.z - a.z, distance = Math.hypot(dx, dz);
          if (distance < .25) a.routeIndex = (a.routeIndex + 1) % a.route.length;
          else {
            const step = Math.min(distance, .72 * dt);
            moveWithCollisions(a, dx / distance * step, dz / distance * step, spatial, movedPoint, .3);
            const moved = Math.hypot(movedPoint.x - a.x, movedPoint.z - a.z);
            a.x = movedPoint.x; a.z = movedPoint.z; a.moving = moved > .001;
            if (a.moving) { a.yaw = angleTo(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * 7)); a.phase += moved * 5.4; }
            else a.routeIndex = (a.routeIndex + 1) % a.route.length;
          }
        }
        a.drawX = a.x; a.drawZ = a.z; a.drawYaw = a.yaw;
      }
    }
    player.drawX = player.x; player.drawZ = player.z; player.drawYaw = player.yaw;
    for (const bin of dynamicBins.values()) {
      let anyVisible = false;
      for (let i = 0; i < bin.parts.length; i++) {
        const part = bin.parts[i], a = part.actor;
        if (a.visible) anyVisible = true;
        p3.set(a.drawX || 0, FLOOR_Y, a.drawZ || 0); rotation.set(0, a.drawYaw || 0, 0); q3.setFromEuler(rotation);
        sc3.set(a.visible ? a.width : 0, a.visible ? a.height : 0, a.visible ? a.width : 0); actorMatrix.compose(p3, q3, sc3);
        let swing = 0, offsetZ = 0;
        if (a.moving && part.joint) {
          const direction = /R$/.test(part.joint) ? 1 : -1;
          swing = Math.sin(a.phase) * direction * .43;
          if (/^(arm|hand)/.test(part.joint)) swing *= -.7;
          if (/^foot/.test(part.joint)) { offsetZ = swing * .55; swing *= .4; }
          if (/^hand/.test(part.joint)) offsetZ = swing * .3;
        }
        p3.set(part.x, part.y, part.z + offsetZ); rotation.set(swing, part.angle, 0); localQ.setFromEuler(rotation);
        sc3.set(part.sx, part.sy, part.sz); localMatrix.compose(p3, localQ, sc3); composed.multiplyMatrices(actorMatrix, localMatrix); bin.mesh.setMatrixAt(i, composed);
      }
      bin.mesh.visible = anyVisible; bin.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function choosePrompt() {
    if (paused) { prompt(null); return; }
    let best = null, bestScore = Infinity;
    const targets = currentInterior ? interiorTargets : worldTargets;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i], distance = Math.hypot(t.x - player.x, t.z - player.z);
      if (distance <= t.radius && distance < bestScore) { best = t; bestScore = distance; }
    }
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]; if (!a.visible) continue;
      const distance = Math.hypot(a.drawX - player.x, a.drawZ - player.z);
      if (distance < (currentInterior ? 4.4 : 3.2) && distance - .55 < bestScore) {
        a.prompt.x = a.drawX; a.prompt.z = a.drawZ; best = a.prompt; bestScore = distance - .55;
      }
    }
    prompt(best);
  }

  function targetPosition(target) {
    if (target.kind === 'npc') {
      const a = npcById.get(target.id); return a?.visible ? { x: a.drawX, z: a.drawZ } : null;
    }
    return (currentInterior ? interiorTargets : worldTargets).find(t => t.target.kind === target.kind && t.target.id === target.id) || null;
  }
  function interact(target) {
    if (!target || paused) return false;
    const p = targetPosition(target); if (!p || Math.hypot(p.x - player.x, p.z - player.z) > (currentInterior ? 4.8 : 3.8)) return false;
    clearInput(); onInteract(target); return true;
  }
  function interactNearest() { choosePrompt(); return currentPrompt ? interact(currentPrompt.target) : false; }
  function walkTo(point, target = null) {
    if (paused) return;
    path = findWalkingPath(player, point, activeWorld()); pathIndex = 0; approachTarget = target;
    if (path.length) {
      const end = path[path.length - 1]; destinationRing.position.set(end.x, FLOOR_Y + .04, end.z); destinationRing.visible = true;
    } else destinationRing.visible = false;
  }

  function enterBuilding(id) {
    const b = byId.get(id); if (!b) return false;
    clearInput(); currentInterior = id; player.interior = id;
    buildInterior(b); worldGroup.visible = false; interiorGroup.visible = true;
    player.x = 0; player.z = interiorSpatial.depth / 2 - 2.2; player.yaw = Math.PI;
    cameraFocus.set(player.x, .4, player.z); desiredYaw = .68; zoom = desiredZoom = 1;
    prompt(null); updateActors(0); changed(true); return true;
  }
  function exitBuilding() {
    const b = byId.get(currentInterior); if (!b) return false;
    clearInput(); currentInterior = null; player.interior = null;
    worldGroup.visible = true; interiorGroup.visible = false;
    const toward = b.entrance[1] > b.position[1] ? 1 : -1;
    player.x = b.entrance[0]; player.z = b.entrance[1] + toward * .8; player.yaw = toward > 0 ? 0 : Math.PI;
    cameraFocus.set(player.x, .4, player.z); prompt(null); updateActors(0); changed(true); return true;
  }
  function teleport(position = {}) {
    clearInput();
    if (position.interior && byId.has(position.interior)) enterBuilding(position.interior);
    else {
      currentInterior = null; player.interior = null; worldGroup.visible = true; interiorGroup.visible = false;
      player.x = 0; player.z = 2.5;
    }
    if (isWalkable(position.x, position.z, activeWorld())) { player.x = position.x; player.z = position.z; }
    cameraFocus.set(player.x, .4, player.z); prompt(null); updateActors(0); changed(true); return getPlayer();
  }

  function updateMovement(dt) {
    player.moving = false; if (paused) return;
    let ix = externalInput.x + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let iz = externalInput.z + (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    let dx = 0, dz = 0;
    const strength = Math.hypot(ix, iz);
    if (strength > .01) {
      path.length = 0; approachTarget = null; destinationRing.visible = false;
      ix /= Math.max(1, strength); iz /= Math.max(1, strength);
      // D-pad and keys are screen-relative, so Up always walks away from the camera.
      const c = Math.cos(cameraYaw), s = Math.sin(cameraYaw);
      dx = (ix * c + iz * s) * WALK_SPEED * dt; dz = (-ix * s + iz * c) * WALK_SPEED * dt;
    } else if (pathIndex < path.length) {
      const next = path[pathIndex], vx = next.x - player.x, vz = next.z - player.z, distance = Math.hypot(vx, vz);
      if (distance < .16) pathIndex++;
      else { const step = Math.min(distance, WALK_SPEED * dt); dx = vx / distance * step; dz = vz / distance * step; }
    }
    if (dx || dz) {
      moveWithCollisions(player, dx, dz, activeWorld(), movedPoint);
      const distance = Math.hypot(movedPoint.x - player.x, movedPoint.z - player.z);
      player.x = movedPoint.x; player.z = movedPoint.z;
      if (distance > .001) { player.yaw = angleTo(player.yaw, Math.atan2(dx, dz), Math.min(1, dt * 14)); player.phase += distance * 5.6; player.moving = true; }
    }
    if (approachTarget) {
      const p = targetPosition(approachTarget);
      if (p && Math.hypot(p.x - player.x, p.z - player.z) < (currentInterior ? 4.2 : 2.6)) { const target = approachTarget; interact(target); }
    }
    if (pathIndex >= path.length) { destinationRing.visible = false; path.length = 0; pathIndex = 0; approachTarget = null; }
    changed();
  }

  function resize() {
    if (disposed) return;
    const w = Math.max(1, canvas.clientWidth || canvas.width), h = Math.max(1, canvas.clientHeight || canvas.height);
    currentWidth = w; currentHeight = h; renderer.setSize(w, h, false);
    const span = currentInterior ? 10.7 : 16;
    camera.left = -span * w / h; camera.right = span * w / h; camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  let previousInterior = null, islandView = false;
  function resetView() {
    const island = !currentInterior && player.z >= 68;
    desiredYaw = island ? Math.PI + .35 : .68;
    desiredZoom = island ? .7 : 1;
  }
  function updateCamera(dt) {
    if (previousInterior !== currentInterior) { previousInterior = currentInterior; resize(); }
    const island = !currentInterior && player.z >= 68;
    if (island !== islandView) { islandView = island; resetView(); }
    cameraGoal.set(player.x, currentInterior ? .8 : island ? 4 : .4, player.z + (island ? 5 : 0));
    cameraFocus.lerp(cameraGoal, reducedMotion ? 1 : Math.min(1, dt * 9));
    cameraYaw = angleTo(cameraYaw, desiredYaw, reducedMotion ? 1 : Math.min(1, dt * 10));
    zoom += (desiredZoom - zoom) * (reducedMotion ? 1 : Math.min(1, dt * 10));
    camera.position.set(cameraFocus.x + Math.sin(cameraYaw) * 39, cameraFocus.y + 31, cameraFocus.z + Math.cos(cameraYaw) * 39);
    camera.lookAt(cameraFocus); camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }

  function updateOcclusion(dt) {
    if (currentInterior) return;
    const dx = camera.position.x - player.x, dz = camera.position.z - player.z;
    for (let i = 0; i < occluders.length; i++) {
      const b = occluders[i]; let near = 0, far = 1, intersects = true;
      if (Math.abs(dx) < 1e-7) intersects = player.x >= b.minX && player.x <= b.maxX;
      else { const a = (b.minX - player.x) / dx, c = (b.maxX - player.x) / dx; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); }
      if (Math.abs(dz) < 1e-7) intersects = intersects && player.z >= b.minZ && player.z <= b.maxZ;
      else { const a = (b.minZ - player.z) / dz, c = (b.maxZ - player.z) / dz; near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c)); }
      const occluded = intersects && near < far && near > 0 && 1.3 + (camera.position.y - 1.3) * near < b.height + .4;
      const goal = occluded ? .12 : 1;
      b.fade += (goal - b.fade) * (reducedMotion ? 1 : Math.min(1, dt * 12));
      if (Math.abs(goal - b.fade) < .003) b.fade = goal;
    }
    for (let m = 0; m < staticMeshes.length; m++) {
      const mesh = staticMeshes[m], values = mesh.userData.fade; if (!values) continue;
      let dirty = false;
      for (let i = 0; i < values.length; i++) {
        const target = mesh.userData.instanceTargets[i]; const alpha = target ? occluderById.get(target.id)?.fade ?? 1 : 1;
        if (Math.abs(values[i] - alpha) > .002) { values[i] = alpha; dirty = true; }
      }
      if (dirty) mesh.geometry.attributes.cityFade.needsUpdate = true;
    }
    for (let i = 0; i < pickables.length; i++) {
      const mesh = pickables[i], target = mesh.userData.target;
      if (!target || !mesh.userData.ownedTexture) continue;
      const alpha = occluderById.get(target.id)?.fade ?? 1;
      mesh.material.transparent = alpha < .999; mesh.material.opacity = alpha; mesh.material.depthWrite = alpha >= .999;
    }
  }

  const keydown = (e) => {
    if (paused || editable(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) { keys.add(e.code); e.preventDefault(); }
    else if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); interactNearest(); }
  };
  const keyup = e => keys.delete(e.code);
  const blur = () => clearInput();
  const activePointers = new Set();
  const pointerDown = e => {
    if (paused || (e.button != null && e.button !== 0)) return;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1) { drag = null; return; }
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, moved: false };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const pointerMove = e => {
    if (!drag || drag.id !== e.pointerId || paused) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 8) drag.moved = true;
    if (drag.moved) desiredYaw -= (e.clientX - drag.x) * .006;
    drag.x = e.clientX;
  };
  const pointerUp = e => {
    activePointers.delete(e.pointerId);
    if (!drag || drag.id !== e.pointerId) return;
    const tap = !drag.moved && e.type === 'pointerup'; drag = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!tap || paused) return;
    const rect = canvas.getBoundingClientRect();
    ndc.set((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const candidates = currentInterior ? [...dynamicMeshes, ...(interiorGroup.userData.pickables || [])] : pickables;
    const hits = ray.intersectObjects(candidates, false);
    for (const item of hits) {
      const target = item.object.userData.target || item.object.userData.instanceTargets?.[item.instanceId];
      if (!target) continue;
      const pos = targetPosition(target); if (!pos) continue;
      if (!interact(target)) walkTo(pos, target); return;
    }
    if (ray.ray.intersectPlane(ground, hit)) walkTo({ x: hit.x, z: hit.z });
  };
  const wheel = e => { e.preventDefault(); desiredZoom = Math.max(.7, Math.min(2, desiredZoom * (e.deltaY > 0 ? .9 : 1.1))); };
  const contextLost = e => { e.preventDefault(); failed = true; clearInput(); onError(new Error('The 3D graphics context was lost. Reload the city to reconnect.')); };
  const listeners = [
    [globalThis, 'keydown', keydown], [globalThis, 'keyup', keyup], [globalThis, 'blur', blur],
    [canvas, 'pointerdown', pointerDown], [canvas, 'pointermove', pointerMove], [canvas, 'pointerup', pointerUp],
    [canvas, 'pointercancel', pointerUp], [canvas, 'wheel', wheel, { passive: false }], [canvas, 'webglcontextlost', contextLost]
  ];
  for (const [target, event, handler, options] of listeners) target.addEventListener(event, handler, options);
  const oldTouchAction = canvas.style.touchAction; canvas.style.touchAction = 'pinch-zoom';

  function getStats() {
    return { engine: 'Three.js 0.180.0', drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      npcCount: actors.length, visibleNpcs, buildings: buildings.length, interior: currentInterior,
      fps: Math.round(fps * 10) / 10, dpr, viewport: [currentWidth, currentHeight],
      staticBatches: staticMeshes.length, animatedBatches: dynamicMeshes.length,
      staticInstances: staticMeshes.reduce((n, m) => n + m.count, 0), status: failed ? 'graphics-lost' : disposed ? 'disposed' : 'running' };
  }

  function frame(now) {
    if (disposed || failed) return;
    raf = requestAnimationFrame(frame);
    const frameSeconds = lastTime ? (now - lastTime) / 1000 : 1 / 60;
    const dt = Math.min(.05, frameSeconds); lastTime = now; elapsed += dt;
    try {
      updateMovement(dt); updateActors(dt); updateCamera(dt); updateOcclusion(dt);
      playerRing.position.set(player.x, .267, player.z); contact.position.set(player.x, .261, player.z);
      choosePrompt(); renderer.render(scene, camera);
      frameCount++; fpsTime += frameSeconds; if (fpsTime >= 1) { fps = frameCount / fpsTime; frameCount = 0; fpsTime = 0; }
      if (firstFrame) { firstFrame = false; onReady(getStats()); }
    } catch (error) { failed = true; clearInput(); onError(error); }
  }
  updateActors(0); updateCamera(1); raf = requestAnimationFrame(frame);
  return {
    setInput(input = {}) { if (paused || disposed) return; externalInput.x = Number.isFinite(input.x) ? Math.max(-1, Math.min(1, input.x)) : 0; externalInput.z = Number.isFinite(input.z) ? Math.max(-1, Math.min(1, input.z)) : 0; },
    interactNearest, enterBuilding, exitBuilding, teleport, getPlayer, getStats,
    zoomBy(factor) { if (Number.isFinite(factor) && factor > 0) desiredZoom = Math.max(.7, Math.min(2, desiredZoom * factor)); },
    resetView,
    setPaused(value) { paused = !!value; if (paused) { clearInput(); prompt(null); } },
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); clearInput(); ro.disconnect();
      for (const [target, event, handler, options] of listeners) target.removeEventListener(event, handler, options);
      canvas.style.touchAction = oldTouchAction;
      kit.clearGroup(worldGroup); kit.clearGroup(interiorGroup); kit.clearGroup(actorsGroup);
      ringGeometry.dispose(); ringMaterial.dispose(); destinationRing.material.dispose(); contactMaterial.dispose(); kit.dispose(); renderer.dispose();
      onPrompt(null);
    }
  };
}
