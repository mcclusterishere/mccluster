/* PRIM3 tactical board — 3D view, v2 (three.js 0.180.0, the version the repo's 3D pages already load).

   A renderer only: it draws the board model the page gives it and reports which tile was tapped.
   Rules, legality, hints and fog of war stay in tactical-resolver.mjs / tactical-hints.mjs. An
   animation never changes the game: the page has already resolved the move or shot through the
   engine before it asks for the walk or the shot to be played.

   World mapping is the engine's grid: tile (x, y) sits at world X = x, Z = y (engine +y = south,
   toward the camera), Y is up. One tile = 1 world unit. Nothing hidden is ever passed in.

   Presentation tiers (opts.fx, or chosen from the GPU):
     high — image-based light, ground-truth ambient occlusion, bloom, SMAA
     mid  — image-based light, bloom, SMAA (phones)
     low  — the forward render alone (software GL, or when the addons cannot load)
   Every tier draws the same tiles, units and overlays; only the look changes.

   Operatives are procedural, articulated mannequins in the Prim3 canon wear (see operative()). When
   an authored GLB is listed in assets/3d/prim3-operators/manifest.json it replaces the stand-in for
   that role (E, R, T, or H for a known hostile). */
import * as THREE from 'three';

const C = {
  grout: 0x0d1215, grid: 0x5fd7e6, brick: 0x6e3d2d, concrete: 0x83868a, planter: 0x4f5458, leaf: 0x37522a,
  cyan: 0x36d6e7, amber: 0xffb547, hostile: 0xff4d5c, relay: 0x30353a
};
const ROLE = { E: 0x7fe3ee, R: 0xb9e98a, T: 0xffcf7a };
// Owner, 2026-11-02: a black, white and grey game. The only colour on the board is each team's glow
// (an accent on their kit, like the red tabs on T's loadout, and a halo when selected), plus nature.
const TEAM = { PLAYER: 0xff2a3a, THREAT: 0x3d8bff };
const G = { reach: 0x30373c, path: 0x0e1113, runx: 0x16191c, runy: 0x6a7277, origin: 0x0e1113, target: 0x4c5459, line: 0x0e1113 };
const NATURE = { leaf: 0x4b6a31, leaf2: 0x5a7a3a, bark: 0x5a4030, grass: 0x5f7f3b };
const MODEL_ROOT = new URL('../../assets/3d/prim3-operators/', import.meta.url);
// Photo-scanned PBR materials and a real night-courtyard HDR (Poly Haven, CC0; see assets/3d/prim3-tactics/CREDITS.md).
// Loaded after first paint; until they arrive (or if they cannot), the procedural textures stand in.
const PBR_ROOT = new URL('../../assets/3d/prim3-tactics/', import.meta.url);

/* ---------- procedural textures (no image downloads) ---------- */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function stoneTex(seed, base) {
  const r = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i += 1) { const v = 30 + r() * 70; g.fillStyle = `rgba(${v},${v + 4},${v + 8},${0.05 + r() * 0.08})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
    g.strokeStyle = 'rgba(10,14,16,.22)'; g.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 5; k += 1) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 6; g.strokeRect(0, 0, w, h); // grout
  });
}
function wetRough(seed) { // roughness: puddled patches read as wet, glossy stone
  const r = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(170,170,170)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i += 1) { const gr = g.createRadialGradient(r() * w, r() * h, 2, r() * w, r() * h, 30 + r() * 60); gr.addColorStop(0, 'rgba(25,25,25,.9)'); gr.addColorStop(1, 'rgba(25,25,25,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  }, false);
}
function brickTex(windows) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2a1a14'; g.fillRect(0, 0, w, h);
    const r = rng(7), bw = 32, bh = 14;
    for (let y = 0; y < h; y += bh) for (let x = -(y / bh % 2) * bw / 2; x < w; x += bw) {
      const v = 0.75 + r() * 0.35; g.fillStyle = `rgb(${Math.round(112 * v)},${Math.round(60 * v)},${Math.round(44 * v)})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
    if (windows) for (let row = 0; row < 3; row += 1) for (let col = 0; col < 4; col += 1) {
      const x = 40 + col * 120, y = 60 + row * 150; g.fillStyle = '#121a20'; g.fillRect(x - 6, y - 6, 72, 102); g.fillStyle = '#0b1116'; g.fillRect(x, y, 60, 90);
    }
  });
}
function skyTex() {
  return canvasTex(8, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#060b12'); gr.addColorStop(0.55, '#14202c'); gr.addColorStop(0.8, '#3a3436'); gr.addColorStop(1, '#5b3f2e');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
function glowTex() {
  return canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,220,150,.6)'); gr.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
}

function pickTier(renderer, fx) {
  if (fx === 'high' || fx === 'mid' || fx === 'low') return fx;
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(name)) return 'low';
  } catch (e) { /* unknown GPU: fall through */ }
  return matchMedia('(pointer: coarse)').matches ? 'mid' : 'high';
}

export function createBoard3D(host, { width, height, onTap, onView = null, reducedMotion = false, fx = null, showcase = false }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const tier = pickTier(renderer, fx);
  renderer.setPixelRatio(Math.min(tier === 'high' ? 2 : 1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.className = 'b3-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);
  const labels = document.createElement('div'); labels.className = 'b3-labels'; host.appendChild(labels);

  const scene = new THREE.Scene();
  scene.background = skyTex();
  scene.fog = new THREE.Fog(0x161c22, 20, 44);
  const cx = (width - 1) / 2, cz = (height - 1) / 2;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const HOME = { dist: 20.5, x: cx, z: cz + 1.2 };
  const view = { dist: HOME.dist, minDist: 8, maxDist: 26, target: new THREE.Vector3(HOME.x, 0, HOME.z), goal: new THREE.Vector3(HOME.x, 0, HOME.z), pitch: 0.98, yaw: 0, yawGoal: 0 };

  /* ---------- light: dusk. Warm low sun, cool sky, cool rim, sodium lamps ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bec2, tier === 'low' ? 0.95 : 0.7));
  const sun = new THREE.DirectionalLight(0xfffaf2, 1.9);
  sun.position.set(cx - 8, 9, cz - 7); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true; sun.shadow.mapSize.set(tier === 'low' ? 1024 : 2048, tier === 'low' ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 45 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xf2f6ff, 0.6); rim.position.set(cx + 9, 6, cz + 10); scene.add(rim);

  /* ---------- ground: wet flagstone tiles, plaza margin, readable grid ---------- */
  const rough = wetRough(3);
  const plazaTex = stoneTex(11, '#2b3135'); plazaTex.repeat.set(width + 14, height + 14);
  const plazaRough = rough.clone(); plazaRough.repeat.set((width + 14) / 4, (height + 14) / 4);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(width + 14, height + 14), new THREE.MeshStandardMaterial({ map: plazaTex, roughnessMap: plazaRough, roughness: 1, metalness: 0.05, color: 0x9aa0a4 }));
  plaza.material.userData.pbr = { set: 'cobblestone_square', repeat: [(width + 14) / 2, (height + 14) / 2] };
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(cx, -0.02, cz + 2); plaza.receiveShadow = true; scene.add(plaza);
  const tileGeo = new THREE.BoxGeometry(0.97, 0.06, 0.97);
  const tileMats = [stoneTex(21, '#4b5257'), stoneTex(22, '#444b51'), stoneTex(23, '#4f555a')].map((t) => new THREE.MeshStandardMaterial({ map: t, roughnessMap: rough, roughness: 1, metalness: 0.08 }));
  for (const [i, m] of tileMats.entries()) m.userData.tone = [0xe4e5e5, 0xdfe0e0, 0xe7e7e6][i];
  plaza.material.userData.tone = 0xf6f6f4;
  for (const [i, m] of tileMats.entries()) m.userData.pbr = { set: 'concrete_pavement', repeat: [0.5, 0.5], offset: [i * 0.5, i * 0.25], tint: [0xffffff, 0xe9e9e9, 0xf4f1ec][i] };
  const tiles = new THREE.InstancedMesh(tileGeo, tileMats[0], width * height);
  const tiles2 = new THREE.InstancedMesh(tileGeo, tileMats[1], width * height);
  { const mm = new THREE.Matrix4(); let a = 0, b = 0; const r = rng(5);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { mm.makeTranslation(x, (r() - 0.5) * 0.006, y); if ((x * 7 + y * 3) % 3 === 0) tiles2.setMatrixAt(b++, mm); else tiles.setMatrixAt(a++, mm); }
    tiles.count = a; tiles2.count = b; }
  tiles.receiveShadow = tiles2.receiveShadow = true; scene.add(tiles, tiles2);
  const gp = [];
  for (let x = 0; x <= width; x += 1) gp.push(x - 0.5, 0.035, -0.5, x - 0.5, 0.035, height - 0.5);
  for (let y = 0; y <= height; y += 1) gp.push(-0.5, 0.035, y - 0.5, width - 0.5, 0.035, y - 0.5);
  const gridGeo = new THREE.BufferGeometry(); gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x5c6469, transparent: true, opacity: 0.6 })));
  // board edge: a thin lit trim so the play area reads against the plaza
  const trim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width + 0.04, 0.02, height + 0.04)), new THREE.LineBasicMaterial({ color: 0x1b2024, transparent: true, opacity: 0.7 }));
  trim.position.set(cx, 0.04, cz); scene.add(trim);

  /* ---------- the courtyard around the board (set dressing only: never on a tile) ---------- */
  const glow = glowTex();
  const haloTex = canvasTex(64, 64, (g2) => { const gr = g2.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64); });
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const pbrTargets = [];
  const concrete = (color, rx, ry) => { const m = std({ color, roughness: 0.85 }); m.userData.pbr = { set: 'concrete_wall_006', repeat: [rx, ry], tint: color }; pbrTargets.push(m); return m; };
  const add = (geo, mat, x, y, z, { cast = true, recv = true, parent = scene } = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = recv; parent.add(m); return m; };
  const lamps = [];
  function lampPost(x, z) {
    const iron = std({ color: 0x15191c, roughness: 0.5, metalness: 0.7 });
    add(new THREE.CylinderGeometry(0.05, 0.08, 3.2, 10), iron, x, 1.6, z);
    add(new THREE.BoxGeometry(0.5, 0.05, 0.05), iron, x + 0.22, 3.15, z);
    const head = add(new THREE.CylinderGeometry(0.16, 0.22, 0.2, 12), std({ color: 0x1a1d20, emissive: 0xffb064, emissiveIntensity: 2.2 }), x + 0.45, 3.05, z, { cast: false });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb36a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    sp.scale.set(1.6, 1.6, 1); sp.position.copy(head.position); scene.add(sp);
    const l = new THREE.PointLight(0xffa860, 9, 9, 1.7); l.position.set(x + 0.45, 2.85, z); scene.add(l); lamps.push(l);
  }
  function blob(radius, seed) { // a lumpy, smooth-shaded foliage clump
    const geo = new THREE.SphereGeometry(radius, 20, 14), pos = geo.attributes.position, v = new THREE.Vector3(), r = rng(seed);
    const k = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < pos.count; i += 1) { v.fromBufferAttribute(pos, i); const n = 1 + 0.16 * Math.sin(v.x * 9 + k[0]) * Math.sin(v.y * 8 + k[1]) + 0.1 * Math.sin(v.z * 13 + k[2]); v.multiplyScalar(n); pos.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals(); return geo;
  }
  function tree(x, z, s = 1) {
    const bark = std({ color: NATURE.bark, roughness: 1 }), leaf = std({ color: NATURE.leaf, roughness: 0.85 }); bark.userData.keepColor = leaf.userData.keepColor = true;
    add(new THREE.BoxGeometry(1.1 * s, 0.45, 1.1 * s), concrete(0x9d9a94, 1, 0.4), x, 0.22, z);
    add(new THREE.CylinderGeometry(0.07 * s, 0.11 * s, 1.9 * s, 8), bark, x, 0.45 + 0.95 * s, z);
    const r = rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < 6; i += 1) { const b = add(blob((0.45 + r() * 0.35) * s, i * 7 + 3), leaf, x + (r() - 0.5) * 0.9 * s, (1.9 + r() * 0.9) * s, z + (r() - 0.5) * 0.9 * s); b.rotation.set(r() * 3, r() * 3, 0); }
  }
  function bench(x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
    const wood = std({ color: 0x4a3324, roughness: 0.8 }), iron = std({ color: 0x15191c, roughness: 0.5, metalness: 0.7 });
    add(new THREE.BoxGeometry(1.4, 0.06, 0.42), wood, 0, 0.42, 0, { parent: g });
    add(new THREE.BoxGeometry(1.4, 0.32, 0.05), wood, 0, 0.66, -0.2, { parent: g });
    for (const sx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.05, 0.42, 0.4), iron, sx, 0.21, 0, { parent: g });
  }
  function crate(x, z, s, rot) { const m = add(new THREE.BoxGeometry(s, s * 0.8, s), std({ color: 0x3b3a30, roughness: 0.85 }), x, s * 0.4, z); m.rotation.y = rot; return m; }
  function puddle(x, z, sx, sz) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), std({ color: 0x0c1014, roughness: 0.04, metalness: 0.6, transparent: true, opacity: 0.85 }));
    m.rotation.x = -Math.PI / 2; m.scale.set(sx, sz, 1); m.position.set(x, 0.001, z); m.receiveShadow = true; scene.add(m);
  }
  { // north: brick block with lit windows, a cornice, a doorway, steps up to it and a railing
    const facadeMat = std({ map: brickTex(false), roughness: 0.85 }); facadeMat.map.repeat.set(2, 1);
    facadeMat.userData.pbr = { set: 'red_brick_03', repeat: [(width + 10) / 2.2, 7 / 2.2] }; pbrTargets.push(facadeMat);
    add(new THREE.BoxGeometry(width + 10, 7, 1), facadeMat, cx, 3.5, -3.4);
    // windows: dark glass panes in concrete surrounds; a few lit from inside
    const paneDark = std({ color: 0x0b1116, roughness: 0.06, metalness: 0.4 });
    const paneLit = std({ color: 0x2a1a0c, roughness: 0.2, emissive: 0xffb36b, emissiveIntensity: 1.6 });
    const sill = std({ color: 0x6d6c69, roughness: 0.8 }); sill.userData.pbr = { set: 'concrete_wall_006', repeat: [0.5, 0.5] }; pbrTargets.push(sill);
    const lit = new Set(['0,1', '2,0', '3,2', '1,2', '5,0', '6,1']);
    for (let rp = 0; rp < 2; rp += 1) for (let col = 0; col < 4; col += 1) for (let row = 0; row < 3; row += 1) {
      const x = cx - (width + 10) / 2 + rp * (width + 10) / 2 + (70 + col * 120) / 512 * (width + 10) / 2;
      const y = 7 - (105 + row * 150) / 512 * 7;
      add(new THREE.BoxGeometry(1.42, 1.48, 0.12), sill, x, y, -2.92, { cast: false });
      add(new THREE.BoxGeometry(1.2, 1.26, 0.06), lit.has((rp * 4 + col) + ',' + row) ? paneLit : paneDark, x, y, -2.84, { cast: false });
      add(new THREE.BoxGeometry(1.5, 0.08, 0.3), sill, x, y - 0.78, -2.8);
    }
    add(new THREE.BoxGeometry(width + 10.4, 0.3, 1.3), concrete(0x8a857f, 10, 0.3), cx, 7.1, -3.3);
    add(new THREE.BoxGeometry(1.6, 2.4, 0.2), std({ color: 0x0e1418, roughness: 0.3, metalness: 0.4 }), cx, 2.0, -2.86);
    add(new THREE.BoxGeometry(2.4, 0.08, 1.0), std({ color: 0x2c3237, roughness: 0.6, metalness: 0.5 }), cx, 3.3, -2.5);
    for (let s = 0; s < 3; s += 1) add(new THREE.BoxGeometry(width + 3, 0.18, 0.55), concrete(0xb8b4ae, 6, 0.2), cx, 0.09 + s * 0.18, -1.0 - s * 0.55);
    const rail = std({ color: 0x15191c, roughness: 0.4, metalness: 0.8 });
    for (let i = 0; i <= 6; i += 1) add(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), rail, -1 + i * (width + 1) / 6, 0.99, -2.15, { recv: false });
    add(new THREE.BoxGeometry(width + 1.1, 0.05, 0.05), rail, cx, 1.44, -2.15);
  }
  { // west: concrete and glass; east: low wall with a planter run
    const glass = std({ color: 0x0f1a22, roughness: 0.08, metalness: 0.9, emissive: 0x0a2230, emissiveIntensity: 0.6 });
    add(new THREE.BoxGeometry(1, 5, height + 4), concrete(0xa9a6a0, 5, 2), -3.4, 2.5, cz);
    for (let i = 0; i < 4; i += 1) add(new THREE.BoxGeometry(0.06, 2.6, 2.1), glass, -2.88, 2.0, -0.6 + i * 2.7, { cast: false });
    add(new THREE.BoxGeometry(0.5, 0.9, height + 4), concrete(0xa9a6a0, 6, 0.5), width + 1.9, 0.45, cz);
    add(new THREE.BoxGeometry(0.4, 0.08, height + 4), (() => { const m = std({ color: NATURE.grass, roughness: 0.95 }); m.userData.keepColor = true; return m; })(), width + 1.9, 0.94, cz);
  }
  tree(-1.9, -1.2, 1.05); tree(width + 0.8, -1.3, 0.95); tree(width + 1.1, height + 0.6, 1.1);
  lampPost(-1.5, height * 0.45); lampPost(width + 0.7, height * 0.3);
  bench(-1.7, height * 0.72, Math.PI / 2); bench(width + 0.85, height * 0.62, -Math.PI / 2);
  crate(width + 0.9, height * 0.05, 0.6, 0.3); crate(width + 0.95, height * 0.05 + 0.7, 0.45, -0.2); crate(-1.6, height + 0.4, 0.55, 0.6);
  puddle(-1.2, height * 0.2, 1.4, 0.8); puddle(width + 0.6, height * 0.85, 1.1, 1.6); puddle(cx + 1, height + 1.2, 2.2, 0.9);

  /* ---------- art direction (owner, 2026-11-02): the world is white, the people are black ----------
     Every surface of the environment is a white "clay" material: real geometry, normal and roughness
     detail, soft shadows and ambient occlusion, no colour. Only the operatives (black), the game's own
     overlays (cyan / amber / red) and the relay beacon carry colour. */
  const WHITE = true;
  function whiteout(root) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
      const m = o.material; if (m.userData.keepColor || m.userData.white) return;
      m.userData.white = true;
      m.map = null; m.emissiveMap = null; m.emissive.set(0x000000); m.emissiveIntensity = 0;
      m.color.set(m.userData.tone || 0xe9e9e7); m.metalness = 0; m.roughness = Math.max(0.55, m.roughness);
      m.transparent = false; m.opacity = 1; m.needsUpdate = true;
    });
  }
  if (WHITE) {
    scene.background = new THREE.Color(0xeceeef);
    scene.fog = new THREE.Fog(0xeceeef, 42, 95);
    renderer.toneMappingExposure = 0.92;
    for (const l of lamps) { l.visible = false; }
    whiteout(scene); // the courtyard built so far; the operatives are added later and stay black
    scene.traverse((o) => { if (o.isSprite) o.visible = false; });
  }

  /* ---------- per-tile overlays (reach / path / dest / hint / runs), shown or hidden by update() ---------- */
  const overlayGeo = new THREE.PlaneGeometry(0.9, 0.9); overlayGeo.rotateX(-Math.PI / 2);
  const ovMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
  const mats = { reach: ovMat(G.reach, 0.2), path: ovMat(G.path, 0.32), runx: ovMat(G.runx, 0.45), runy: ovMat(G.runy, 0.45) };
  const overlays = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const m = new THREE.Mesh(overlayGeo, mats.reach); m.position.set(x, 0.04, y); m.visible = false; m.renderOrder = 2; scene.add(m); overlays.push(m);
  }
  const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.02, 0.9));
  const lineMat = (color) => new THREE.LineBasicMaterial({ color, toneMapped: false });
  const destFrame = new THREE.LineSegments(frameGeo, lineMat(G.line)); destFrame.visible = false; scene.add(destFrame);
  const hintFrame = new THREE.LineSegments(frameGeo, lineMat(G.line)); hintFrame.visible = false; scene.add(hintFrame);
  const ringGeo = new THREE.TorusGeometry(0.38, 0.03, 8, 48); ringGeo.rotateX(Math.PI / 2);
  const ringMat = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const selRing = new THREE.Mesh(ringGeo, ringMat(TEAM.PLAYER)); selRing.visible = false; scene.add(selRing);
  const originRing = new THREE.Mesh(ringGeo, ringMat(G.origin)); originRing.visible = false; scene.add(originRing);
  const targetRing = new THREE.Mesh(ringGeo, ringMat(G.target)); targetRing.visible = false; scene.add(targetRing);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(G.line)); pathLine.visible = false; scene.add(pathLine);
  const destGhost = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 32), new THREE.MeshBasicMaterial({ color: G.path, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })); destGhost.visible = false; scene.add(destGhost);

  /* ---------- board props from the model: walls, cover, the relay ---------- */
  const props = new THREE.Group(); scene.add(props);
  const unitsGroup = new THREE.Group(); scene.add(unitsGroup);
  const relayGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.15, metalness: 0.6 }));
  relayGem.material.userData.keepColor = true;
  let propsKey = '';
  const brickMat = std({ map: brickTex(false), roughness: 0.9 }); brickMat.userData.pbr = { set: 'red_brick_03', repeat: [0.45, 0.8] };
  const capMat = std({ color: 0x3c2f2a, roughness: 0.6 });
  const concMat = std({ color: C.concrete, roughness: 0.85 }); concMat.userData.pbr = { set: 'concrete_wall_006', repeat: [1, 1] };
  const hazard = std({ color: 0xd9a136, roughness: 0.6 });
  const planterMat = std({ color: C.planter, roughness: 0.85 });
  const shrubMat = std({ color: NATURE.leaf2, roughness: 0.85 }); shrubMat.userData.keepColor = true;
  const soilGrass = std({ color: NATURE.grass, roughness: 0.95 }); soilGrass.userData.keepColor = true;
  pbrTargets.push(plaza.material, ...tileMats, brickMat, concMat, capMat, planterMat);
  capMat.userData.pbr = { set: 'concrete_wall_006', repeat: [1, 1] }; planterMat.userData.pbr = { set: 'concrete_wall_006', repeat: [0.8, 0.5] };

  function buildProps(m) {
    props.clear();
    for (const b of m.blockers) { // walls: brick pillars with a stone cap and a scuffed base
      add(new THREE.BoxGeometry(0.98, 1.7, 0.98), brickMat, b.x, 0.85, b.y, { parent: props });
      add(new THREE.BoxGeometry(1.04, 0.1, 1.04), capMat, b.x, 1.75, b.y, { parent: props });
      add(new THREE.BoxGeometry(1.02, 0.14, 1.02), concMat, b.x, 0.07, b.y, { parent: props });
    }
    for (const c of m.cover) {
      for (const s of c.sides) {
        const along = s === 'N' || s === 'S';
        const off = 0.38, px = c.x + (s === 'E' ? off : s === 'W' ? -off : 0), pz = c.y + (s === 'S' ? off : s === 'N' ? -off : 0);
        const g = new THREE.Group(); g.position.set(px, 0.03, pz); g.rotation.y = along ? 0 : Math.PI / 2; props.add(g);
        if (c.type === 'HIGH') { // a jersey barrier with a hazard band and a stacked crate
          const shape = new THREE.Shape(); shape.moveTo(-0.16, 0); shape.lineTo(0.16, 0); shape.lineTo(0.07, 0.3); shape.lineTo(0.06, 1.0); shape.lineTo(-0.06, 1.0); shape.lineTo(-0.07, 0.3); shape.closePath();
          const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.92, bevelEnabled: false }); geo.translate(0, 0, -0.46); geo.rotateY(Math.PI / 2);
          add(geo, concMat, 0, 0, 0, { parent: g });
          add(new THREE.BoxGeometry(0.93, 0.08, 0.13), hazard, 0, 0.82, 0, { parent: g, cast: false });
        } else { // a planter box with shrubs
          add(new THREE.BoxGeometry(0.92, 0.48, 0.24), planterMat, 0, 0.24, 0, { parent: g });
          add(new THREE.BoxGeometry(0.86, 0.02, 0.19), soilGrass, 0, 0.49, 0, { parent: g, cast: false });
          for (let i = -1; i <= 1; i += 1) { const sh = add(blob(0.17, i + 11), shrubMat, i * 0.28, 0.56, 0, { parent: g }); sh.scale.set(1.2, 0.8, 0.8); sh.rotation.y = i; }
        }
      }
    }
    for (const t of m.objectiveTiles) { // relay: a cabinet with an antenna mast, a lit panel and a beacon
      const metal = std({ color: C.relay, roughness: 0.35, metalness: 0.7 });
      add(new THREE.BoxGeometry(0.52, 0.85, 0.46), metal, t.x, 0.46, t.y, { parent: props });
      add(new THREE.PlaneGeometry(0.3, 0.36), new THREE.MeshBasicMaterial({ color: 0x0b0c0d, toneMapped: false }), t.x, 0.5, t.y + 0.235, { parent: props, cast: false });
      add(new THREE.CylinderGeometry(0.018, 0.018, 1.0), std({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.4 }), t.x + 0.17, 1.38, t.y - 0.12, { parent: props });
      relayGem.position.set(t.x, 1.35, t.y); props.add(relayGem);
      const l = new THREE.PointLight(C.amber, 5, 3.4, 2); l.position.set(t.x, 1.2, t.y); props.add(l);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: C.amber, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
      sp.scale.set(1.2, 1.2, 1); sp.position.set(t.x, 1.35, t.y); props.add(sp);
    }
    if (WHITE) { whiteout(props); props.traverse((o) => { if (o.isSprite) o.visible = false; if (o.isPointLight) o.intensity = 1.5; }); }
  }

  /* ---------- operatives: articulated procedural stand-ins, per phenotype ---------- */
  const glbs = {}; // role → loaded gltf scene (only when the manifest lists one)
  function limb(len, r0, r1, mat) { // a capsule-ish segment hanging down from its pivot
    const piv = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry((r0 + r1) / 2, len - (r0 + r1), 4, 10), mat);
    m.position.y = -len / 2; m.castShadow = true; piv.add(m);
    const end = new THREE.Group(); end.position.y = -len; piv.add(end);
    piv.userData.end = end; return piv;
  }
  // Field operators as the owner's loadout photographs show them (Prim3 phenotypes/operators/LOADOUTS.md):
  // faceless black mannequins, everything they wear and carry in black. The figure faces +Z, so its
  // own right side is −X.
  //   E · FO-E-AE  protective carrier, knee pads, over-ear headset, body camera (its right chest),
  //                belt pouches, right-hip holster, entry tool at the right thigh, compact carbine slung left
  //   R · FO-R-SO  light chest rig, binoculars in a sternum pouch, recorder (its right chest), one-ear
  //                headset, belt radio, right-hip holster, scoped rifle slung left
  //   T · FO-T-STD short sleeves, zip soft vest, centre-chest recorder, radio on the left strap, deck
  //                sling over the right shoulder, open cyberdeck held at the waist, belt pouches, sidearm
  //   H · SOI-01   short sleeves, thin vest, body camera, holstered sidearm, cyberdeck; no helmet
  // No marks are drawn (the canon omits a mark rather than approximating it). Long guns hang on the
  // sling at rest and come to the hands only to shoot.
  function operative(u) {
    const ally = u.faction === 'PLAYER', role = ally ? u.role : 'H';
    const body = std({ color: 0x0a0a0b, roughness: 0.32, metalness: 0.08 });   // mannequin
    const cloth = std({ color: 0x111214, roughness: 0.93 });                    // field fabric
    const gear = std({ color: 0x18191b, roughness: 0.78 });                     // nylon webbing, pouches
    const hard = std({ color: 0x0d0e10, roughness: 0.42, metalness: 0.35 });    // weapons, devices
    const boot = std({ color: 0x080808, roughness: 0.55 });
    const g = new THREE.Group(); g.userData.unitId = u.id;
    const rig = { role };
    const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips); rig.hips = hips;
    add(new THREE.BoxGeometry(0.31, 0.16, 0.2), cloth, 0, 0, 0, { parent: hips });
    add(new THREE.BoxGeometry(0.33, 0.045, 0.215), gear, 0, 0.065, 0, { parent: hips });                 // belt
    add(new THREE.BoxGeometry(0.05, 0.035, 0.02), hard, 0, 0.065, 0.11, { parent: hips });                // buckle
    const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine); rig.spine = spine;
    const chest = new THREE.Group(); spine.add(chest); rig.chest = chest;
    const torso = add(new THREE.CapsuleGeometry(0.16, 0.27, 4, 14), cloth, 0, 0.25, 0, { parent: chest }); torso.scale.set(1.12, 1, 0.76);
    add(new THREE.CylinderGeometry(0.068, 0.08, 0.075, 14), cloth, 0, 0.47, 0, { parent: chest });       // collar / quarter-zip
    const neck = new THREE.Group(); neck.position.y = 0.5; chest.add(neck); rig.neck = neck;
    add(new THREE.CylinderGeometry(0.043, 0.05, 0.08, 12), body, 0, 0.02, 0, { parent: neck });
    const head = add(new THREE.SphereGeometry(0.1, 24, 18), body, 0, 0.145, 0.01, { parent: neck }); head.scale.set(0.9, 1.26, 1.0);
    const camLight = (x, y, z, parent) => add(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3344, toneMapped: false }), x, y, z, { parent, cast: false });
    const recorder = (x, y, z) => { add(new THREE.BoxGeometry(0.05, 0.065, 0.028), hard, x, y, z, { parent: chest }); add(new THREE.CircleGeometry(0.013, 14), std({ color: 0x050505, roughness: 0.05, metalness: 0.6 }), x, y + 0.008, z + 0.015, { parent: chest, cast: false }); };
    // torso equipment
    if (role === 'E') { // protective carrier: front and back plates, side cummerbund, shoulder straps
      add(new THREE.BoxGeometry(0.36, 0.3, 0.07), gear, 0, 0.25, 0.115, { parent: chest });
      add(new THREE.BoxGeometry(0.35, 0.3, 0.06), gear, 0, 0.25, -0.115, { parent: chest });
      for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.04, 0.16, 0.24), gear, sx * 0.18, 0.2, 0, { parent: chest }); add(new THREE.BoxGeometry(0.07, 0.02, 0.27), gear, sx * 0.1, 0.415, 0, { parent: chest }); }
      add(new THREE.BoxGeometry(0.12, 0.05, 0.005), cloth, 0.05, 0.33, 0.152, { parent: chest, cast: false });      // blank ID panel
      recorder(-0.1, 0.36, 0.16); camLight(-0.085, 0.34, 0.176, chest);
    } else if (role === 'R') { // light chest rig: thin straps, binocular pouch at the sternum, recorder high on its right chest
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.36, 0.012), gear, sx * 0.09, 0.3, 0.125, { parent: chest }).rotation.z = sx * 0.12;
      add(new THREE.BoxGeometry(0.17, 0.11, 0.07), gear, 0, 0.17, 0.14, { parent: chest });
      for (const sx of [-1, 1]) { const b = add(new THREE.CylinderGeometry(0.026, 0.026, 0.08, 14), hard, sx * 0.035, 0.24, 0.15, { parent: chest }); void b; }
      add(new THREE.BoxGeometry(0.1, 0.035, 0.005), cloth, 0, 0.34, 0.125, { parent: chest, cast: false });
      recorder(-0.11, 0.37, 0.135);
    } else if (role === 'T') { // zip soft vest, centre recorder, radio on the left strap, deck sling over the right shoulder
      const vest = add(new THREE.CapsuleGeometry(0.168, 0.22, 4, 14), gear, 0, 0.25, 0, { parent: chest }); vest.scale.set(1.14, 1, 0.82);
      add(new THREE.BoxGeometry(0.008, 0.3, 0.005), hard, 0, 0.25, 0.14, { parent: chest, cast: false });           // zip
      recorder(0, 0.37, 0.14);
      add(new THREE.BoxGeometry(0.04, 0.09, 0.025), hard, 0.1, 0.33, 0.135, { parent: chest });                    // radio, its left
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5), hard, 0.11, 0.4, 0.135, { parent: chest });
      const sling = add(new THREE.BoxGeometry(0.045, 0.62, 0.012), gear, -0.02, 0.22, 0.145, { parent: chest, cast: false }); sling.rotation.z = -0.62;
      // the open field cyberdeck, held at the waist on its sling
      const deck = new THREE.Group(); deck.position.set(0.02, -0.06, 0.27); deck.rotation.x = -0.12; chest.add(deck); rig.deck = deck;
      add(new THREE.BoxGeometry(0.26, 0.022, 0.18), hard, 0, 0, 0, { parent: deck });
      const lid = new THREE.Group(); lid.position.set(0, 0.011, -0.088); lid.rotation.x = -1.85; deck.add(lid);
      add(new THREE.BoxGeometry(0.26, 0.016, 0.18), hard, 0, 0, 0.09, { parent: lid });
      add(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: 0xd9dee1, toneMapped: false }), 0, -0.009, 0.09, { parent: lid, cast: false }).rotation.x = Math.PI / 2;
    } else { // SOI-01 officer: thin vest, body camera
      const vest = add(new THREE.CapsuleGeometry(0.167, 0.2, 4, 14), gear, 0, 0.27, 0, { parent: chest }); vest.scale.set(1.14, 1, 0.8);
      recorder(-0.08, 0.36, 0.14); camLight(-0.065, 0.34, 0.156, chest);
    }
    // head equipment
    if (role === 'E') { // over-ear headset with a boom
      const band = add(new THREE.TorusGeometry(0.105, 0.012, 6, 20, Math.PI), hard, 0, 0.15, 0, { parent: neck }); band.rotation.y = Math.PI / 2;
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), hard, sx * 0.1, 0.13, 0, { parent: neck }).rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.1, 0.008, 0.008), hard, -0.07, 0.08, 0.07, { parent: neck }).rotation.y = 0.7;
    } else if (role === 'R') { // low-profile single-ear headset
      const band = add(new THREE.TorusGeometry(0.1, 0.006, 6, 20, Math.PI), hard, 0, 0.16, 0, { parent: neck }); band.rotation.y = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.032, 0.032, 0.025, 12), hard, 0.095, 0.13, 0, { parent: neck }).rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.11, 0.006, 0.006), hard, 0.06, 0.08, 0.07, { parent: neck }).rotation.y = -0.7;
    } else if (role === 'T') { // earpiece
      add(new THREE.SphereGeometry(0.018, 10, 8), hard, 0.093, 0.13, 0.01, { parent: neck });
    }
    // arms: long sleeves for E and R; short sleeves (black mannequin forearms) for T and officers
    const shortSleeve = role === 'T' || role === 'H';
    const armL = limb(0.3, 0.055, 0.047, cloth), armR = limb(0.3, 0.055, 0.047, cloth);
    armL.position.set(0.205, 0.42, 0); armR.position.set(-0.205, 0.42, 0); chest.add(armL, armR);
    if (shortSleeve) for (const a of [armL, armR]) { const lower = a.children[0]; lower.scale.y = 0.55; lower.position.y = -0.09; add(new THREE.CapsuleGeometry(0.04, 0.12, 4, 10), body, 0, -0.22, 0, { parent: a }); }
    const foreL = limb(0.28, 0.043, 0.036, shortSleeve ? body : cloth), foreR = limb(0.28, 0.043, 0.036, shortSleeve ? body : cloth);
    armL.userData.end.add(foreL); armR.userData.end.add(foreR);
    for (const f of [foreL, foreR]) { const h = add(new THREE.SphereGeometry(0.043, 12, 10), gear, 0, -0.3, 0.005, { parent: f }); h.scale.set(0.8, 1.25, 1); } // gloves
    Object.assign(rig, { armL, armR, foreL, foreR });
    // belt kit: right-hip holster and sidearm; pouches by role
    add(new THREE.BoxGeometry(0.05, 0.15, 0.09), gear, -0.19, -0.05, 0.02, { parent: hips });
    add(new THREE.BoxGeometry(0.028, 0.05, 0.07), hard, -0.19, 0.05, 0.03, { parent: hips });
    const pouch = (x, w = 0.07, h = 0.08) => add(new THREE.BoxGeometry(w, h, 0.045), gear, x, 0.0, 0.115, { parent: hips });
    if (role === 'E') { pouch(-0.07); pouch(0.07); add(new THREE.BoxGeometry(0.035, 0.1, 0.03), hard, 0.15, 0.03, 0.06, { parent: hips }); }
    if (role === 'R') { add(new THREE.BoxGeometry(0.04, 0.09, 0.03), hard, -0.13, 0.02, 0.1, { parent: hips }); pouch(0.08, 0.06, 0.07); }
    if (role === 'T') { pouch(-0.06, 0.06, 0.08); pouch(0.02, 0.05, 0.07); pouch(0.13, 0.08, 0.11); }
    // legs: trousers, boots; knee pads and the entry tool on E
    const legL = limb(0.42, 0.072, 0.062, cloth), legR = limb(0.42, 0.072, 0.062, cloth);
    legL.position.set(0.095, -0.04, 0); legR.position.set(-0.095, -0.04, 0); hips.add(legL, legR);
    const shinL = limb(0.42, 0.058, 0.05, cloth), shinR = limb(0.42, 0.058, 0.05, cloth);
    legL.userData.end.add(shinL); legR.userData.end.add(shinR);
    for (const sh of [shinL, shinR]) {
      add(new THREE.BoxGeometry(0.105, 0.1, 0.13), boot, 0, -0.42, 0.025, { parent: sh });
      add(new THREE.BoxGeometry(0.11, 0.03, 0.2), boot, 0, -0.465, 0.04, { parent: sh });
      if (role === 'E') add(new THREE.BoxGeometry(0.1, 0.11, 0.035), gear, 0, -0.02, 0.065, { parent: sh });
    }
    if (role === 'E') { const tool = add(new THREE.BoxGeometry(0.025, 0.3, 0.04), hard, -0.2, -0.22, 0.02, { parent: hips }); tool.rotation.z = 0.05; }
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.09, 0.07), gear, sx * 0.08, -0.15, 0.06, { parent: hips }); // cargo pockets
    Object.assign(rig, { legL, legR, shinL, shinR });
    // weapons. held = the gun in the hands when shooting; slung = the same gun on the body at rest
    const longGun = (scale, scoped) => {
      const w = new THREE.Group(); const L = 0.62 * scale;
      add(new THREE.BoxGeometry(0.05, 0.08, L * 0.5), hard, 0, 0, 0, { parent: w });
      add(new THREE.CylinderGeometry(0.014, 0.014, L * 0.55, 8), hard, 0, 0.012, L * 0.5, { parent: w }).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.04, 0.1, 0.04), hard, 0, -0.07, 0.04, { parent: w });
      add(new THREE.BoxGeometry(0.045, 0.08, 0.18), hard, 0, -0.01, -L * 0.36, { parent: w });
      if (scoped) add(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10), hard, 0, 0.07, 0.03, { parent: w }).rotation.x = Math.PI / 2;
      else add(new THREE.BoxGeometry(0.03, 0.035, 0.05), hard, 0, 0.055, 0.04, { parent: w });     // red-dot housing
      const mz = new THREE.Group(); mz.position.set(0, 0.012, L * 0.78); w.add(mz); w.userData.muzzle = mz; return w;
    };
    const pistol = () => { const w = new THREE.Group(); add(new THREE.BoxGeometry(0.032, 0.045, 0.16), hard, 0, 0.02, 0.03, { parent: w }); add(new THREE.BoxGeometry(0.03, 0.085, 0.04), hard, 0, -0.035, -0.03, { parent: w }); const mz = new THREE.Group(); mz.position.set(0, 0.02, 0.12); w.add(mz); w.userData.muzzle = mz; return w; };
    let held, slung = null;
    if (role === 'E' || role === 'R') {
      held = longGun(role === 'R' ? 1.45 : 1.0, role === 'R');
      slung = longGun(role === 'R' ? 1.45 : 1.0, role === 'R');
      slung.position.set(0.23, 0.05, 0.02); slung.rotation.set(Math.PI / 2 + 0.12, 0, 0.08); chest.add(slung);   // muzzle down, its left side
      const strap = add(new THREE.BoxGeometry(0.035, 0.6, 0.01), gear, 0.04, 0.24, 0.13, { parent: chest, cast: false }); strap.rotation.z = 0.6;
      held.position.set(-0.05, 0.22, 0.26);
    } else { held = pistol(); held.position.set(-0.12, 0.16, 0.34); }
    chest.add(held); held.visible = false;
    Object.assign(rig, { gun: held, slung, muzzle: held.userData.muzzle, heldBase: held.position.clone() });
    // team identity: small glowing accents on the kit (like the red tabs on T's loadout) and a soft
    // ground glow; both brighten when the unit is selected
    const teamColor = TEAM[u.faction] || TEAM.THREAT;
    const accent = new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 1.2, roughness: 0.4 });
    accent.userData.keepColor = true;
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.012, 0.05, 0.05), accent, sx * 0.19, 0.17, 0.05, { parent: chest, cast: false });   // side tabs
    add(new THREE.BoxGeometry(0.04, 0.012, 0.012), accent, 0.12, 0.43, 0.02, { parent: chest, cast: false });                                 // shoulder
    for (const sh of [shinL, shinR]) add(new THREE.BoxGeometry(0.03, 0.03, 0.012), accent, 0, -0.39, -0.045, { parent: sh, cast: false });  // boot heels
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshBasicMaterial({ map: haloTex, color: teamColor, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.015; halo.renderOrder = 3; g.add(halo);
    Object.assign(rig, { accent, halo });
    g.scale.setScalar(1.18);
    return { g, rig };
  }
  function glbOperative(u) { // an authored model, when present for this role
    const src = glbs[u.faction === 'PLAYER' ? u.role : 'H']; if (!src) return null;
    const g = new THREE.Group(); g.userData.unitId = u.id;
    const m = src.scene.clone(true); m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // generated models arrive at their own scale: stand them at the stand-in's height, feet at the origin
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), s = 2.15 / Math.max(0.001, size.y);
    m.scale.setScalar(s); m.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s, -(box.min.z + size.z / 2) * s);
    g.add(m); return { g, rig: null, mixer: null };
  }

  function pose(a, t) { // drive the rig from walk / crouch / breath / recoil / flinch / death
    const r = a.rig; if (!r) return;
    const w = a.walkAmt, ph = a.phase, cr = a.crouch;
    const sw = Math.sin(ph) * 0.7 * w;
    r.legL.rotation.x = -sw - cr * 1.15; r.legR.rotation.x = sw - cr * 1.15;
    r.shinL.rotation.x = Math.max(0, Math.sin(ph)) * 1.0 * w + cr * 2.0;
    r.shinR.rotation.x = Math.max(0, -Math.sin(ph)) * 1.0 * w + cr * 2.0;
    r.hips.position.y = 0.92 - cr * 0.4 + Math.abs(Math.cos(ph)) * 0.03 * w;
    const breathe = reducedMotion ? 0 : Math.sin(t * 1.7 + a.seed) * 0.012;
    r.spine.rotation.x = cr * 0.42 + w * 0.1 - a.flinch * 0.5 + breathe;
    r.chest.rotation.y = -0.25 * (1 - w * 0.5) + Math.sin(ph) * 0.08 * w;
    r.neck.rotation.y = 0.22 * (1 - w * 0.5); r.neck.rotation.x = -cr * 0.3;
    // arms: relaxed at the sides (as on the mannequins) and swinging when walking; raised to shoot
    const aim = a.aim, rest = 1 - aim, swing = Math.sin(ph) * 0.45 * w * rest;
    const holdDeck = r.role === 'T' && aim < 0.5;
    r.armR.rotation.set(0.02 - swing + aim * (r.role === 'T' || r.role === 'H' ? -1.45 : -1.15), 0, -0.1 * rest - 0.12 * aim);
    r.foreR.rotation.set(-0.12 * rest + aim * (r.role === 'T' || r.role === 'H' ? -0.1 : -0.85), 0, 0);
    r.armL.rotation.set(holdDeck ? -0.35 : 0.02 + swing + aim * -1.35, 0, holdDeck ? 0.05 : 0.1 * rest + 0.35 * aim);
    r.foreL.rotation.set(holdDeck ? -1.15 : -0.12 * rest - aim * 0.9, 0, 0);
    r.gun.visible = aim > 0.3; if (r.slung) r.slung.visible = !r.gun.visible;
    if (r.deck) r.deck.visible = !(r.role === 'T' && aim > 0.3);
    r.gun.rotation.x = -a.recoil * 0.25; r.gun.position.z = r.heldBase.z - a.recoil * 0.05;
  }

  /* ---------- labels (DOM, projected each frame: crisp text, never inside the WebGL canvas) ---------- */
  const tmp = new THREE.Vector3();
  function project(x, y, h = 0) {
    tmp.set(x, h, y).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: (tmp.x + 1) / 2 * r.width, y: (1 - tmp.y) / 2 * r.height, behind: tmp.z > 1 };
  }
  let labelSpecs = [];
  function placeLabels() {
    let html = '';
    for (const l of labelSpecs) {
      let lx = l.x, ly = l.y;
      if (l.unit) { const a = actors.get(l.unit); if (a) { lx = a.g.position.x; ly = a.g.position.z; } }
      const p = project(lx, ly, l.h || 0);
      if (p.behind) continue;
      html += `<span class="b3-label b3-label--${l.kind}" style="transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)">${l.text}</span>`;
    }
    labels.innerHTML = html;
  }

  /* ---------- camera: eased target / yaw, a shot camera for fire ---------- */
  let shotCam = null; // { from, look, k } while a shot plays
  const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3();
  function placeCamera() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); if (composer) composer.setSize(w, h); }
    camera.aspect = w / h;
    camera.fov = h > w * 1.05 ? 44 : 32;
    camera.updateProjectionMatrix();
    const hd = Math.cos(view.pitch) * view.dist;
    camPos.set(view.target.x + Math.sin(view.yaw) * hd, view.target.y + Math.sin(view.pitch) * view.dist, view.target.z + Math.cos(view.yaw) * hd);
    lookAt.copy(view.target);
    if (shotCam) { const k = shotCam.k * shotCam.k * (3 - 2 * shotCam.k); camPos.lerp(shotCam.from, k); lookAt.lerp(shotCam.look, k); }
    camera.position.copy(camPos); camera.lookAt(lookAt);
  }

  /* ---------- post-processing, loaded after first paint so the board never waits on it ---------- */
  let composer = null;
  async function loadFx() {
    if (tier === 'low') return;
    try {
      const [{ RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { SMAAPass }, { OutputPass }, gtao] = await Promise.all([
        import('three/addons/environments/RoomEnvironment.js'), import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/SMAAPass.js'), import('three/addons/postprocessing/OutputPass.js'),
        tier === 'high' ? import('three/addons/postprocessing/GTAOPass.js') : Promise.resolve(null)
      ]);
      if (destroyed) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      if (!hdrLoaded) { scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32; } pmrem.dispose();
      const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
      const c = new EffectComposer(renderer); c.setPixelRatio(renderer.getPixelRatio()); c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (gtao) { const ao = new gtao.GTAOPass(scene, camera, w, h); ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1, scale: 1.2 }); ao.blendIntensity = 0.9; c.addPass(ao); }
      if (!WHITE) c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.82)); // bloom would haze a white world
      c.addPass(new OutputPass());
      c.addPass(new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()));
      composer = c; needs = true;
    } catch (e) { composer = null; } // addons unreachable: the forward render stays, same board
  }
  let hdrLoaded = false;
  async function loadPBR() {
    const tl = new THREE.TextureLoader(), cache = {};
    const tex = (name, srgb) => { const t = tl.load(new URL('pbr/' + name + '.jpg', PBR_ROOT).href); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const setOf = (set) => cache[set] || (cache[set] = { map: tex(set + '_diff', true), normalMap: tex(set + '_nor_gl', false), roughnessMap: tex(set + '_rough', false) });
    const probe = await fetch(new URL('pbr/concrete_pavement_diff.jpg', PBR_ROOT), { method: 'HEAD' }).catch(() => null);
    if (!probe || !probe.ok || destroyed) return;
    for (const m of pbrTargets) {
      const spec = m.userData.pbr; if (!spec) continue;
      const base = setOf(spec.set);
      for (const k of (WHITE ? ['normalMap', 'roughnessMap'] : ['map', 'normalMap', 'roughnessMap'])) {
        const t = base[k].clone(); t.repeat.set(spec.repeat[0], spec.repeat[1]); if (spec.offset) t.offset.set(spec.offset[0], spec.offset[1]); t.needsUpdate = true; m[k] = t;
      }
      m.color.set(WHITE ? (m.userData.tone || 0xf1f1ef) : (spec.tint || 0xffffff)); if (WHITE) m.map = null; m.roughness = 1; m.metalness = 0; m.normalScale.set(1, 1); m.needsUpdate = true;
    }
    needs = true;
    if (WHITE) {
      try {
        const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
        if (destroyed) return;
        const pm = new THREE.PMREMGenerator(renderer);
        scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.22; pm.dispose();
        hdrLoaded = true; needs = true;
      } catch (e) { /* hemisphere + sun still light the white world */ }
      return;
    }
    try { // the courtyard's real night light: image-based lighting and reflections
      const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
      const hdr = await new HDRLoader().loadAsync(new URL('hdri/courtyard_night_1k.hdr', PBR_ROOT).href);
      if (destroyed) return;
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(hdr).texture; scene.environmentIntensity = 0.55; pm.dispose();
      scene.background = hdr; scene.backgroundBlurriness = 0.35; scene.backgroundIntensity = 0.45;
      hdrLoaded = true; needs = true;
    } catch (e) { /* keep the procedural sky */ }
  }
  async function loadModels() { // authored GLBs replace stand-ins only when the manifest lists them
    try {
      const res = await fetch(new URL('manifest.json', MODEL_ROOT)); if (!res.ok) return;
      const man = await res.json(); const list = Object.entries(man.models || {}); if (!list.length) return;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      for (const [role, file] of list) { try { glbs[role] = await loader.loadAsync(new URL(file, MODEL_ROOT).href); } catch (e) { /* keep the stand-in */ } }
      for (const [id, a] of actors) { unitsGroup.remove(a.g); actors.delete(id); }
      if (model) update(model);
    } catch (e) { /* no manifest: stand-ins */ }
  }

  /* ---------- actors and animation ---------- */
  const actors = new Map(); // id → { g, rig, unit, walk, walkAmt, phase, crouch, crouchGoal, face, faceGoal, aim, recoil, flinch, dying, seed }
  const fxGroup = new THREE.Group(); scene.add(fxGroup);
  let fireAnim = null;
  const lerpAngle = (a, b, k) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };
  function coverAt(m, x, y) { return m.cover.find((c) => c.x === x && c.y === y); }
  function faceFor(u, m) { // face the nearest opposing unit the page knows about, else up-board
    let best = null, bd = Infinity;
    for (const o of m.units) if (!o.dead && o.faction !== u.faction) { const d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y); if (d < bd) { bd = d; best = o; } }
    return best ? Math.atan2(best.x - u.x, best.y - u.y) : (u.faction === 'PLAYER' ? Math.PI : 0);
  }

  let diveAnim = null;
  if (showcase) { view.dist = 16; view.pitch = 0.5; view.target.set(cx, 0.4, cz); view.goal.copy(view.target); }
  let model = null, needs = true, t0 = performance.now(), destroyed = false;
  const flashes = [];
  let active = true;
  function frame(now) {
    if (!active) { t0 = now; raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.25, (now - t0) / 1000); t0 = now; // capped so a stalled tab does not jump, loose enough that slow GPUs still finish on time
    const t = now / 1000;
    let moving = false;
    // showcase (the main menu's backdrop): a slow, low cinematic orbit; a dive when the player deploys
    if (showcase) {
      if (!reducedMotion) { view.yaw = view.yawGoal = 0.35 + Math.sin(now / 1000 * 0.07) * 0.9; }
      if (diveAnim) { diveAnim.t += dt; const k = Math.min(1, diveAnim.t / 0.9), e = k * k * (3 - 2 * k);
        view.dist = 16 - e * 8; view.pitch = 0.5 + e * 0.5; if (k >= 1) { const d = diveAnim.done; diveAnim = null; if (d) d(); } }
      moving = true;
    }
    // camera easing
    if (view.target.distanceToSquared(view.goal) > 1e-5) { view.target.lerp(view.goal, reducedMotion ? 1 : 1 - Math.exp(-dt * 6)); moving = true; }
    if (Math.abs(view.yaw - view.yawGoal) > 1e-4) { view.yaw = reducedMotion ? view.yawGoal : view.yaw + (view.yawGoal - view.yaw) * (1 - Math.exp(-dt * 7)); moving = true; }
    // actors
    for (const [id, a] of actors) {
      if (a.walk) {
        const wk = a.walk; wk.t += dt * 2.8;
        const seg = Math.min(wk.pts.length - 2, Math.floor(wk.t));
        const p0 = wk.pts[seg], p1 = wk.pts[seg + 1], k = Math.min(1, wk.t - seg);
        a.g.position.set(p0.x + (p1.x - p0.x) * k, 0.03, p0.y + (p1.y - p0.y) * k);
        if (p1.x !== p0.x || p1.y !== p0.y) a.faceGoal = Math.atan2(p1.x - p0.x, p1.y - p0.y);
        a.phase += dt * 10; a.walkAmt = Math.min(1, a.walkAmt + dt * 6);
        if (wk.t >= wk.pts.length - 1) { const e = wk.pts[wk.pts.length - 1]; a.g.position.set(e.x, 0.03, e.y); a.walk = null; a.faceGoal = a.restFace; }
        moving = true;
      } else if (a.walkAmt > 0) { a.walkAmt = Math.max(0, a.walkAmt - dt * 5); moving = true; }
      if (!a.walk) a.crouch += (a.crouchGoal - a.crouch) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 6));
      a.face = reducedMotion && !a.walk ? a.faceGoal : lerpAngle(a.face, a.faceGoal, 1 - Math.exp(-dt * 9));
      a.g.rotation.y = a.face;
      a.recoil = Math.max(0, a.recoil - dt * 6); a.flinch = Math.max(0, a.flinch - dt * 3);
      if (a.dying) { a.dying.t += dt; const k = Math.min(1, a.dying.t / 0.7); a.g.rotation.x = -k * Math.PI / 2 * 0.95; a.g.position.y = 0.03 + Math.sin(k * Math.PI) * 0.1 - k * 0.05; if (a.dying.t > 1.6) { unitsGroup.remove(a.g); actors.delete(id); } moving = true; }
      pose(a, t);
    }
    if (fireAnim) { stepFire(dt); moving = true; }
    for (let i = flashes.length - 1; i >= 0; i -= 1) { const f = flashes[i]; f.life -= dt; f.obj.visible = f.life > 0; if (f.update) f.update(f, dt); if (f.life <= 0) { fxGroup.remove(f.obj); flashes.splice(i, 1); } }
    if (!reducedMotion && model) {
      relayGem.rotation.y += dt * 1.2; relayGem.position.y = 1.35 + Math.sin(now / 600) * 0.05;
      selRing.scale.setScalar(1 + Math.sin(now / 320) * 0.06);
      needs = true;
    }
    if (needs || moving || flashes.length) {
      placeCamera();
      if (composer) composer.render(); else renderer.render(scene, camera);
      placeLabels(); needs = false;
      if (onView && (moving || camMoved())) onView();
    }
    busy = moving || !!fireAnim || flashes.length > 0;
    if (!destroyed) raf = requestAnimationFrame(frame);
  }
  let lastCam = '';
  function camMoved() { const k = camera.position.toArray().map((v) => v.toFixed(3)).join(','); const ch = k !== lastCam; lastCam = k; return ch; }
  let busy = false;
  let raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => { needs = true; }); ro.observe(host);
  loadFx(); loadModels(); loadPBR();

  /* ---------- fire: turn, shoulder, three-round burst, tracer, impact; then hand back ---------- */
  function tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
    fxGroup.add(line); flashes.push({ obj: line, life: 0.12, update: (f) => { line.material.opacity = Math.max(0, f.life / 0.12); } });
  }
  function burst(at, color, size, life) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sp.position.copy(at); sp.scale.setScalar(size); fxGroup.add(sp);
    const l = new THREE.PointLight(color, 8, 3, 2); l.position.copy(at); fxGroup.add(l);
    flashes.push({ obj: sp, life, update: (f) => { sp.material.opacity = Math.max(0, f.life / life); } });
    flashes.push({ obj: l, life: life * 0.8, update: (f) => { l.intensity = Math.max(0, 8 * f.life / life); } });
  }
  function sparks(at, n) {
    for (let i = 0; i < n; i += 1) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sp.scale.setScalar(0.12); sp.position.copy(at); fxGroup.add(sp);
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
      flashes.push({ obj: sp, life: 0.45, update: (f, dt) => { v.y -= 9 * dt; sp.position.addScaledVector(v, dt); sp.material.opacity = Math.max(0, f.life / 0.45); } });
    }
  }
  const wp = new THREE.Vector3();
  function stepFire(dt) {
    const F = fireAnim; F.t += dt;
    const a = actors.get(F.attacker), b = actors.get(F.target);
    if (a) { a.faceGoal = F.face; a.aim = Math.min(1, a.aim + dt * 4); }
    if (shotCam) shotCam.k = Math.min(1, F.t < F.len - 0.4 ? shotCam.k + dt * 3 : Math.max(0, shotCam.k - dt * 3.2));
    for (const s of F.shots) if (!s.done && F.t >= s.at) {
      s.done = true;
      if (a && a.rig) { a.rig.muzzle.getWorldPosition(wp); a.recoil = 1; } else wp.set(F.from.x, 1.0, F.from.z);
      burst(wp.clone(), 0xffc070, 0.55, 0.08);
      tracer(wp.clone(), s.to, 0xffe2a8);
      if (F.hit) { if (b) b.flinch = 1; sparks(s.to, 5); } else burst(s.to, 0xffa060, 0.25, 0.1);
    }
    if (F.killed && b && !b.dying && F.t > F.shots[F.shots.length - 1].at + 0.1) b.dying = { t: 0 };
    if (F.t >= F.len) {
      if (a) { a.aim = 0; a.faceGoal = a.restFace; }
      shotCam = null; fireAnim = null; needs = true;
      const done = F.done; if (done) done();
    }
  }

  /* ---------- update from the page's board model ---------- */
  function update(m) {
    model = m;
    const key = JSON.stringify([m.blockers, m.cover, m.objectiveTiles]);
    if (key !== propsKey) { buildProps(m); propsKey = key; }
    const seen = new Set();
    for (const u of m.units) {
      if (u.dead) continue;
      seen.add(u.id);
      let a = actors.get(u.id);
      if (!a) {
        const made = glbOperative(u) || operative(u);
        a = { ...made, unit: u, walk: null, walkAmt: 0, phase: 0, crouch: 0, crouchGoal: 0, face: faceFor(u, m), faceGoal: 0, restFace: 0, aim: 0, recoil: 0, flinch: 0, dying: null, seed: Math.random() * 6 };
        a.g.position.set(u.x, 0.03, u.y); actors.set(u.id, a); unitsGroup.add(a.g);
      }
      const px = Math.round(a.walk ? a.walk.pts[a.walk.pts.length - 1].x : a.g.position.x), py = Math.round(a.walk ? a.walk.pts[a.walk.pts.length - 1].y : a.g.position.z);
      if (px !== u.x || py !== u.y) { // the engine moved this unit: walk its path (or snap)
        const path = m.moves && m.moves[u.id];
        if (path && path.length && !reducedMotion) {
          const pts = [{ x: a.g.position.x, y: a.g.position.z }, ...path.filter((p, i) => i > 0 || p.x !== px || p.y !== py)];
          if (pts[pts.length - 1].x !== u.x || pts[pts.length - 1].y !== u.y) pts.push({ x: u.x, y: u.y });
          a.walk = { pts, t: 0 };
        } else { a.walk = null; a.g.position.set(u.x, 0.03, u.y); }
      }
      a.unit = u;
      const cv = coverAt(m, u.x, u.y);
      a.crouchGoal = cv ? (cv.type === 'LOW' ? 1 : 0.25) : 0;
      a.restFace = faceFor(u, m);
      if (!a.walk && !(fireAnim && fireAnim.attacker === u.id)) a.faceGoal = a.restFace;
    }
    for (const [id, a] of actors) if (!seen.has(id) && !a.dying && !(fireAnim && fireAnim.target === id)) { unitsGroup.remove(a.g); actors.delete(id); }
    // overlays
    for (const o of overlays) o.visible = false;
    const at = (x, y) => overlays[y * width + x];
    for (const t of m.reach || []) { const o = at(t.x, t.y); o.material = mats.reach; o.visible = true; }
    for (const t of m.path || []) { const o = at(t.x, t.y); o.material = mats.path; o.visible = true; }
    for (const t of m.runs || []) { const o = at(t.x, t.y); o.material = t.axis === 'x' ? mats.runx : mats.runy; o.visible = true; }
    destFrame.visible = destGhost.visible = !!m.dest; if (m.dest) { destFrame.position.set(m.dest.x, 0.06, m.dest.y); destGhost.position.set(m.dest.x, 0.05, m.dest.y); }
    hintFrame.visible = !!m.hint; if (m.hint) hintFrame.position.set(m.hint.x, 0.07, m.hint.y);
    const sel = m.units.find((u) => u.id === m.selected && !u.dead);
    selRing.visible = false; // selection is the team glow brightening, not a ring
    for (const [id, a] of actors) { if (!a.rig || !a.rig.halo) continue; const on = !!sel && id === sel.id;
      a.rig.halo.material.opacity = on ? 1 : 0.5; a.rig.halo.scale.setScalar(on ? 1.35 : 1); a.rig.accent.emissiveIntensity = on ? 3.2 : 1.2; }
    if (sel && sel.id !== lastSel) { focus(sel.x, sel.y); }
    lastSel = sel ? sel.id : null;
    originRing.visible = !!m.origin; if (m.origin) originRing.position.set(m.origin.x, 0.07, m.origin.y);
    targetRing.visible = !!m.target; if (m.target) targetRing.position.set(m.target.x, 0.07, m.target.y);
    if (m.pathLine && m.pathLine.length > 1) {
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(m.pathLine.map((p) => new THREE.Vector3(p.x, 0.09, p.y)));
      pathLine.visible = true;
    } else pathLine.visible = false;
    // unit labels follow the animated body
    labelSpecs = (m.labels || []).map((l) => (l.kind === 'ally' || l.kind === 'hostile') ? { ...l, unit: (m.units.find((u) => !u.dead && u.x === l.x && u.y === l.y) || {}).id } : l);
    needs = true;
  }
  let lastSel = null;
  function focus(x, y) { // ease the camera toward a unit, but keep the board in frame
    view.goal.set(Math.min(width - 1.5, Math.max(0.5, (x + HOME.x) / 2)), 0, Math.min(height + 0.5, Math.max(0.5, (y + HOME.z) / 2)));
  }

  /* ---------- input: tap → tile; drag → pan; pinch/wheel → zoom ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function tileAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    placeCamera(); ray.setFromCamera(ndc, camera);
    // a tap on an operative selects its tile, even when the body hides the floor
    const bodies = ray.intersectObjects(unitsGroup.children, true);
    if (bodies.length) { let o = bodies[0].object; while (o && !o.userData.unitId) o = o.parent; const a = o && actors.get(o.userData.unitId); if (a) return { x: a.unit.x, y: a.unit.y }; }
    if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
    const x = Math.round(hit.x), y = Math.round(hit.z);
    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  }
  const pointers = new Map(); let pinch = null, pan = null, moved = false;
  const el = renderer.domElement;
  if (!showcase) el.style.touchAction = 'none';
  if (!showcase) el.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; pan = null; }
    else pan = { x: e.clientX, y: e.clientY, tx: view.goal.x, tz: view.goal.z };
  });
  if (!showcase) el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()]; setDist(pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))); moved = true; return; }
    if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) {
        moved = true;
        const k = view.dist / 600, cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
        // screen right = (cos yaw, 0, -sin yaw); screen up (into the board) = (-sin yaw, 0, -cos yaw)
        const nx = pan.tx - dx * k * cy - dy * k * 1.3 * sy, nz = pan.tz + dx * k * sy - dy * k * 1.3 * cy;
        view.goal.set(Math.min(width, Math.max(-1, nx)), 0, Math.min(height + 1, Math.max(-1, nz)));
        view.target.copy(view.goal); needs = true;
      }
    }
  });
  const end = (e) => {
    const wasTap = pointers.size === 1 && !moved;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) pan = null;
    if (wasTap && e.type === 'pointerup' && !fireAnim) { const t = tileAt(e.clientX, e.clientY); if (t) onTap(t.x, t.y); }
  };
  if (!showcase) { el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); }
  if (!showcase) el.addEventListener('wheel', (e) => { e.preventDefault(); setDist(view.dist * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
  function setDist(d) { view.dist = Math.min(view.maxDist, Math.max(view.minDist, d)); needs = true; }

  return {
    update,
    tier,
    setActive(on) { active = !!on; needs = true; }, // paused while the main menu is open
    zoom(step) { setDist(view.dist * (step > 0 ? 0.82 : 1.22)); },
    zoomLevel() { return view.dist; },
    canZoom() { return { in: view.dist > view.minDist + 0.01, out: view.dist < view.maxDist - 0.01 }; },
    // rotate the camera a quarter turn around the board (the grid and its labels stay the engine's)
    rotate(step) { view.yawGoal += (step > 0 ? 1 : -1) * Math.PI / 2; needs = true; busy = true; },
    resetView() { view.dist = HOME.dist; view.goal.set(HOME.x, 0, HOME.z); view.target.copy(view.goal); view.yaw = view.yawGoal = 0; needs = true; },
    // play a shot the engine already resolved; the board state does not wait on it
    fire(attackerId, targetId, result, done) {
      const a = actors.get(attackerId), b = actors.get(targetId);
      if (!a || !b || reducedMotion) { if (b && result && result.killed) { unitsGroup.remove(b.g); actors.delete(targetId); } if (done) queueMicrotask(done); return; }
      const from = a.g.position.clone(), to = b.g.position.clone();
      const face = Math.atan2(to.x - from.x, to.z - from.z);
      const aimAt = new THREE.Vector3(to.x, 0.95 - b.crouch * 0.35, to.z);
      const side = new THREE.Vector3(Math.cos(face), 0, -Math.sin(face));
      const shots = [0.55, 0.68, 0.81].map((at, i) => ({ at, done: false, to: result && result.hit ? aimAt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, 0)) : aimAt.clone().addScaledVector(side, (i % 2 ? 1 : -1) * (0.45 + Math.random() * 0.3)).add(new THREE.Vector3(0, 0.15, 0)).addScaledVector(new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize(), 0.8) }));
      // over-the-shoulder camera: behind and right of the shooter, looking at the target
      const back = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
      shotCam = { from: from.clone().addScaledVector(back, -2.2).addScaledVector(side, -0.75).add(new THREE.Vector3(0, 1.9, 0)), look: from.clone().lerp(aimAt, 0.65).add(new THREE.Vector3(0, 0.3, 0)), k: 0 };
      fireAnim = { attacker: attackerId, target: targetId, from, face, shots, hit: !!(result && result.hit), killed: !!(result && result.killed), t: 0, len: 1.9, done };
    },
    // showcase only: the camera dives into the board, then calls done
    dive(done) { if (reducedMotion || !showcase) { if (done) queueMicrotask(done); return; } diveAnim = { t: 0, done }; },
    get diving() { return !!diveAnim; },
    isAnimating() { return busy || !!fireAnim || [...actors.values()].some((a) => a.walk || a.dying); },
    unitPosition(id) { const a = actors.get(id); return a ? { x: a.g.position.x, y: a.g.position.z } : null; },
    // test/accessibility hook: where a tile's centre is on screen right now (client coordinates)
    screenOf(x, y, h = 0) { placeCamera(); const p = project(x, y, h); const r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    tileAt,
    destroy() { destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); if (composer) composer.dispose(); renderer.dispose(); host.innerHTML = ''; }
  };
}
