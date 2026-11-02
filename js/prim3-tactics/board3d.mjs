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
const MODEL_ROOT = new URL('../../assets/3d/prim3-operators/', import.meta.url);

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
function windowGlow() { // emissive map: a few lit windows on the facade
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const lit = [[0, 1], [2, 0], [3, 2], [1, 2]];
    for (const [col, row] of lit) { const x = 40 + col * 120, y = 60 + row * 150; const gr = g.createLinearGradient(x, y, x, y + 90); gr.addColorStop(0, '#ffcf8a'); gr.addColorStop(1, '#b86a2a'); g.fillStyle = gr; g.fillRect(x, y, 60, 90); }
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

export function createBoard3D(host, { width, height, onTap, onView = null, reducedMotion = false, fx = null }) {
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
  scene.add(new THREE.HemisphereLight(0x9cc0de, 0x2a1d14, tier === 'low' ? 1.1 : 0.7));
  const sun = new THREE.DirectionalLight(0xffb878, 2.6);
  sun.position.set(cx - 8, 9, cz - 7); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true; sun.shadow.mapSize.set(tier === 'low' ? 1024 : 2048, tier === 'low' ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 45 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x7fb2ff, 0.9); rim.position.set(cx + 9, 6, cz + 10); scene.add(rim);

  /* ---------- ground: wet flagstone tiles, plaza margin, readable grid ---------- */
  const rough = wetRough(3);
  const plazaTex = stoneTex(11, '#2b3135'); plazaTex.repeat.set(width + 14, height + 14);
  const plazaRough = rough.clone(); plazaRough.repeat.set((width + 14) / 4, (height + 14) / 4);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(width + 14, height + 14), new THREE.MeshStandardMaterial({ map: plazaTex, roughnessMap: plazaRough, roughness: 1, metalness: 0.05, color: 0x9aa0a4 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(cx, -0.02, cz + 2); plaza.receiveShadow = true; scene.add(plaza);
  const tileGeo = new THREE.BoxGeometry(0.97, 0.06, 0.97);
  const tileMats = [stoneTex(21, '#4b5257'), stoneTex(22, '#444b51'), stoneTex(23, '#4f555a')].map((t) => new THREE.MeshStandardMaterial({ map: t, roughnessMap: rough, roughness: 1, metalness: 0.08 }));
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
  scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.2 })));
  // board edge: a thin lit trim so the play area reads against the plaza
  const trim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width + 0.04, 0.02, height + 0.04)), new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.55 }));
  trim.position.set(cx, 0.04, cz); scene.add(trim);

  /* ---------- the courtyard around the board (set dressing only: never on a tile) ---------- */
  const glow = glowTex();
  const std = (o) => new THREE.MeshStandardMaterial(o);
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
  function tree(x, z, s = 1) {
    const bark = std({ color: 0x2d2219, roughness: 1 }), leaf = std({ color: C.leaf, roughness: 0.9, flatShading: true });
    add(new THREE.BoxGeometry(1.1 * s, 0.45, 1.1 * s), std({ color: 0x3d4246, roughness: 0.9 }), x, 0.22, z);
    add(new THREE.CylinderGeometry(0.07 * s, 0.11 * s, 1.9 * s, 8), bark, x, 0.45 + 0.95 * s, z);
    const r = rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < 6; i += 1) { const b = add(new THREE.IcosahedronGeometry((0.45 + r() * 0.35) * s, 0), leaf, x + (r() - 0.5) * 0.9 * s, (1.9 + r() * 0.9) * s, z + (r() - 0.5) * 0.9 * s); b.rotation.set(r() * 3, r() * 3, 0); }
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
    const facadeMat = std({ map: brickTex(true), emissiveMap: windowGlow(), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.85 });
    facadeMat.map.repeat.set(2, 1); facadeMat.emissiveMap.repeat.set(2, 1);
    add(new THREE.BoxGeometry(width + 10, 7, 1), facadeMat, cx, 3.5, -3.4);
    add(new THREE.BoxGeometry(width + 10.4, 0.3, 1.3), std({ color: 0x4b4744, roughness: 0.7 }), cx, 7.1, -3.3);
    add(new THREE.BoxGeometry(1.6, 2.4, 0.2), std({ color: 0x0e1418, roughness: 0.3, metalness: 0.4 }), cx, 2.0, -2.86);
    add(new THREE.BoxGeometry(2.4, 0.08, 1.0), std({ color: 0x2c3237, roughness: 0.6, metalness: 0.5 }), cx, 3.3, -2.5);
    for (let s = 0; s < 3; s += 1) add(new THREE.BoxGeometry(width + 3, 0.18, 0.55), std({ color: 0x5a5d60, roughness: 0.8 }), cx, 0.09 + s * 0.18, -1.0 - s * 0.55);
    const rail = std({ color: 0x15191c, roughness: 0.4, metalness: 0.8 });
    for (let i = 0; i <= 6; i += 1) add(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), rail, -1 + i * (width + 1) / 6, 0.99, -2.15, { recv: false });
    add(new THREE.BoxGeometry(width + 1.1, 0.05, 0.05), rail, cx, 1.44, -2.15);
  }
  { // west: concrete and glass; east: low wall with a planter run
    const glass = std({ color: 0x0f1a22, roughness: 0.08, metalness: 0.9, emissive: 0x0a2230, emissiveIntensity: 0.6 });
    add(new THREE.BoxGeometry(1, 5, height + 4), std({ color: 0x5c6064, roughness: 0.9 }), -3.4, 2.5, cz);
    for (let i = 0; i < 4; i += 1) add(new THREE.BoxGeometry(0.06, 2.6, 2.1), glass, -2.88, 2.0, -0.6 + i * 2.7, { cast: false });
    add(new THREE.BoxGeometry(0.5, 0.9, height + 4), std({ color: 0x55595d, roughness: 0.9 }), width + 1.9, 0.45, cz);
    add(new THREE.BoxGeometry(0.4, 0.08, height + 4), std({ color: C.leaf, roughness: 1, flatShading: true }), width + 1.9, 0.94, cz);
  }
  tree(-1.9, -1.2, 1.05); tree(width + 0.8, -1.3, 0.95); tree(width + 1.1, height + 0.6, 1.1);
  lampPost(-1.5, height * 0.45); lampPost(width + 0.7, height * 0.3);
  bench(-1.7, height * 0.72, Math.PI / 2); bench(width + 0.85, height * 0.62, -Math.PI / 2);
  crate(width + 0.9, height * 0.05, 0.6, 0.3); crate(width + 0.95, height * 0.05 + 0.7, 0.45, -0.2); crate(-1.6, height + 0.4, 0.55, 0.6);
  puddle(-1.2, height * 0.2, 1.4, 0.8); puddle(width + 0.6, height * 0.85, 1.1, 1.6); puddle(cx + 1, height + 1.2, 2.2, 0.9);

  /* ---------- per-tile overlays (reach / path / dest / hint / runs), shown or hidden by update() ---------- */
  const overlayGeo = new THREE.PlaneGeometry(0.9, 0.9); overlayGeo.rotateX(-Math.PI / 2);
  const ovMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
  const mats = { reach: ovMat(C.cyan, 0.2), path: ovMat(C.amber, 0.3), runx: ovMat(C.cyan, 0.42), runy: ovMat(C.amber, 0.42) };
  const overlays = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const m = new THREE.Mesh(overlayGeo, mats.reach); m.position.set(x, 0.04, y); m.visible = false; m.renderOrder = 2; scene.add(m); overlays.push(m);
  }
  const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.02, 0.9));
  const lineMat = (color) => new THREE.LineBasicMaterial({ color, toneMapped: false });
  const destFrame = new THREE.LineSegments(frameGeo, lineMat(C.amber)); destFrame.visible = false; scene.add(destFrame);
  const hintFrame = new THREE.LineSegments(frameGeo, lineMat(C.amber)); hintFrame.visible = false; scene.add(hintFrame);
  const ringGeo = new THREE.TorusGeometry(0.38, 0.03, 8, 48); ringGeo.rotateX(Math.PI / 2);
  const ringMat = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const selRing = new THREE.Mesh(ringGeo, ringMat(C.cyan)); selRing.visible = false; scene.add(selRing);
  const originRing = new THREE.Mesh(ringGeo, ringMat(C.cyan)); originRing.visible = false; scene.add(originRing);
  const targetRing = new THREE.Mesh(ringGeo, ringMat(C.amber)); targetRing.visible = false; scene.add(targetRing);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(C.amber)); pathLine.visible = false; scene.add(pathLine);
  const destGhost = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 32), new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })); destGhost.visible = false; scene.add(destGhost);

  /* ---------- board props from the model: walls, cover, the relay ---------- */
  const props = new THREE.Group(); scene.add(props);
  const unitsGroup = new THREE.Group(); scene.add(unitsGroup);
  const relayGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 3, toneMapped: false }));
  let propsKey = '';
  const brickMat = std({ map: brickTex(false), roughness: 0.9 });
  const capMat = std({ color: 0x3c2f2a, roughness: 0.6 });
  const concMat = std({ color: C.concrete, roughness: 0.85 });
  const hazard = std({ color: 0xd9a136, roughness: 0.6 });
  const planterMat = std({ color: C.planter, roughness: 0.85 });
  const shrubMat = std({ color: C.leaf, roughness: 0.95, flatShading: true });

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
          for (let i = -1; i <= 1; i += 1) { const sh = add(new THREE.IcosahedronGeometry(0.17, 0), shrubMat, i * 0.28, 0.56, 0, { parent: g }); sh.scale.set(1.2, 0.8, 0.8); sh.rotation.y = i; }
        }
      }
    }
    for (const t of m.objectiveTiles) { // relay: a cabinet with an antenna mast, a lit panel and a beacon
      const metal = std({ color: C.relay, roughness: 0.35, metalness: 0.7 });
      add(new THREE.BoxGeometry(0.52, 0.85, 0.46), metal, t.x, 0.46, t.y, { parent: props });
      add(new THREE.PlaneGeometry(0.3, 0.36), new THREE.MeshBasicMaterial({ color: C.amber, toneMapped: false }), t.x, 0.5, t.y + 0.235, { parent: props, cast: false });
      add(new THREE.CylinderGeometry(0.018, 0.018, 1.0), std({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.4 }), t.x + 0.17, 1.38, t.y - 0.12, { parent: props });
      relayGem.position.set(t.x, 1.35, t.y); props.add(relayGem);
      const l = new THREE.PointLight(C.amber, 5, 3.4, 2); l.position.set(t.x, 1.2, t.y); props.add(l);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: C.amber, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
      sp.scale.set(1.2, 1.2, 1); sp.position.set(t.x, 1.35, t.y); props.add(sp);
    }
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
  // Canon look (Prim3 phenotypes): faceless matte-black atelier mannequins. The squad wears Wear-01
  // Company Black (the Cohort-02 Trainee default, per CFI-01); known hostiles are Defense / SOI-01
  // security officers: shirt, ultra-thin vest, high-chest body camera, one holstered sidearm and a
  // cyberdeck; no helmet, no long gun (SECURITY-OFFICER-STYLE-SHEET.md). No mark is drawn on any
  // garment: the canon says omit a mark rather than approximate it. The small role-coloured tab on
  // the squad's shoulder is a game readability cue, not an insignia.
  function operative(u) {
    const ally = u.faction === 'PLAYER', role = ally ? u.role : 'H';
    const tint = ally ? (ROLE[u.role] || C.cyan) : C.hostile;
    const body = std({ color: 0x0b0b0c, roughness: 0.3, metalness: 0.1 }); // glossy mannequin
    const cloth = std({ color: 0x131416, roughness: 0.92 });
    const cloth2 = std({ color: 0x18191b, roughness: 0.85 });
    const shoe = std({ color: 0x070707, roughness: 0.3, metalness: 0.1 });
    const steel = std({ color: 0x121416, roughness: 0.45, metalness: 0.6 });
    const band = std({ color: tint, emissive: tint, emissiveIntensity: 1.6, roughness: 0.4 });
    const g = new THREE.Group(); g.userData.unitId = u.id;
    const rig = {};
    const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips); rig.hips = hips;
    add(new THREE.BoxGeometry(0.32, 0.16, 0.2), cloth, 0, 0, 0, { parent: hips });
    add(new THREE.BoxGeometry(0.33, 0.035, 0.21), shoe, 0, 0.06, 0, { parent: hips }); // belt
    const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine); rig.spine = spine;
    const chest = new THREE.Group(); spine.add(chest); rig.chest = chest;
    const torso = add(new THREE.CapsuleGeometry(0.165, 0.27, 4, 14), cloth, 0, 0.25, 0, { parent: chest }); torso.scale.set(1.12, 1, 0.78);
    add(new THREE.CylinderGeometry(0.07, 0.085, 0.06, 12), cloth2, 0, 0.47, 0, { parent: chest }); // collar
    if (!ally) { // SOI-01: ultra-thin vest, body camera with a red record light
      const vest = add(new THREE.CapsuleGeometry(0.17, 0.2, 4, 14), cloth2, 0, 0.27, 0, { parent: chest }); vest.scale.set(1.14, 1, 0.84);
      add(new THREE.BoxGeometry(0.055, 0.08, 0.03), steel, -0.08, 0.36, 0.145, { parent: chest });
      add(new THREE.CircleGeometry(0.014, 12), new THREE.MeshBasicMaterial({ color: 0x1a1d20 }), -0.08, 0.37, 0.161, { parent: chest, cast: false });
      add(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: C.hostile, toneMapped: false }), -0.065, 0.335, 0.16, { parent: chest, cast: false });
      add(new THREE.BoxGeometry(0.05, 0.14, 0.09), steel, 0.19, -0.08, 0.02, { parent: hips }); // holster
    } else {
      add(new THREE.BoxGeometry(0.05, 0.03, 0.12), band, 0.2, 0.43, 0, { parent: chest, cast: false }); // role tab (readability)
    }
    const neck = new THREE.Group(); neck.position.y = 0.5; chest.add(neck); rig.neck = neck;
    add(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), body, 0, 0.02, 0, { parent: neck });
    const head = add(new THREE.SphereGeometry(0.1, 24, 18), body, 0, 0.14, 0.01, { parent: neck }); head.scale.set(0.92, 1.25, 1.02); // faceless
    // arms: squad in long sleeves; officers in short sleeves (mannequin forearms show)
    const armL = limb(0.3, 0.055, 0.048, cloth), armR = limb(0.3, 0.055, 0.048, cloth);
    armL.position.set(-0.21, 0.42, 0); armR.position.set(0.21, 0.42, 0); chest.add(armL, armR);
    const foreMat = ally ? cloth : body;
    const foreL = limb(0.28, 0.045, 0.038, foreMat), foreR = limb(0.28, 0.045, 0.038, foreMat);
    armL.userData.end.add(foreL); armR.userData.end.add(foreR);
    for (const f of [foreL, foreR]) { const h = add(new THREE.SphereGeometry(0.042, 12, 10), body, 0, -0.3, 0.005, { parent: f }); h.scale.set(0.8, 1.2, 1); }
    Object.assign(rig, { armL, armR, foreL, foreR });
    // weapon: squad long gun by role; officers a sidearm drawn from the holster
    const gun = new THREE.Group(); chest.add(gun); rig.gun = gun;
    let glen;
    if (ally) {
      gun.position.set(0.06, 0.2, 0.26);
      glen = role === 'R' ? 0.95 : role === 'E' ? 0.62 : 0.72;
      add(new THREE.BoxGeometry(0.06, 0.09, glen * 0.55), steel, 0, 0, 0.02, { parent: gun });
      add(new THREE.CylinderGeometry(0.018, 0.018, glen * 0.5, 8), steel, 0, 0.015, glen * 0.5, { parent: gun }).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.05, 0.12, 0.05), steel, 0, -0.08, 0.05, { parent: gun });
      add(new THREE.BoxGeometry(0.05, 0.08, 0.2), steel, 0, -0.01, -0.27, { parent: gun });
      if (role === 'R') add(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 10), steel, 0, 0.08, 0.05, { parent: gun }).rotation.x = Math.PI / 2;
    } else {
      gun.position.set(0.14, 0.12, 0.3); glen = 0.26;
      add(new THREE.BoxGeometry(0.035, 0.05, 0.17), steel, 0, 0.02, 0.03, { parent: gun });
      add(new THREE.BoxGeometry(0.03, 0.09, 0.04), steel, 0, -0.04, -0.03, { parent: gun });
    }
    const muzzle = new THREE.Group(); muzzle.position.set(0, 0.015, glen * 0.76); gun.add(muzzle); rig.muzzle = muzzle;
    // a cyberdeck: carried by officers, and by the squad's Technical operator
    if (!ally || role === 'T') {
      const deck = add(new THREE.BoxGeometry(0.2, 0.03, 0.15), steel, 0.02, -0.2, 0.06, { parent: foreL }); deck.rotation.z = Math.PI / 2;
      if (role === 'T') add(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshBasicMaterial({ color: tint, toneMapped: false }), 0.04, -0.2, 0.06, { parent: foreL, cast: false }).rotation.y = Math.PI / 2;
    }
    // legs: trousers and dress shoes
    const legL = limb(0.42, 0.072, 0.062, cloth), legR = limb(0.42, 0.072, 0.062, cloth);
    legL.position.set(-0.095, -0.04, 0); legR.position.set(0.095, -0.04, 0); hips.add(legL, legR);
    const shinL = limb(0.42, 0.058, 0.05, cloth), shinR = limb(0.42, 0.058, 0.05, cloth);
    legL.userData.end.add(shinL); legR.userData.end.add(shinR);
    for (const s of [shinL, shinR]) { const sh = add(new THREE.CapsuleGeometry(0.045, 0.15, 4, 10), shoe, 0, -0.43, 0.04, { parent: s }); sh.rotation.x = Math.PI / 2; }
    Object.assign(rig, { legL, legR, shinL, shinR });
    if (!ally) { // a red ground ring marks a known hostile (game UI)
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.34, 40), new THREE.MeshBasicMaterial({ color: C.hostile, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    }
    g.scale.setScalar(1.18); // heroic scale: readable at phone size, the way tactics games frame their squads
    return { g, rig };
  }
  function glbOperative(u) { // an authored model, when present for this role
    const src = glbs[u.faction === 'PLAYER' ? u.role : 'H']; if (!src) return null;
    const g = new THREE.Group(); g.userData.unitId = u.id;
    const m = src.scene.clone(true); m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
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
    const aim = a.aim; // 0 = low ready, 1 = shouldered
    r.armR.rotation.set(-0.55 - aim * 0.6, 0, -0.15); r.foreR.rotation.set(-1.2 + aim * 0.3, 0, 0);
    r.armL.rotation.set(-1.0 - aim * 0.35, 0, 0.35); r.foreL.rotation.set(-0.9, 0, 0.1);
    r.gun.rotation.x = -0.12 + aim * 0.12 - a.recoil * 0.25; r.gun.position.z = 0.26 + aim * 0.06 - a.recoil * 0.05;
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
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32; pmrem.dispose();
      const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
      const c = new EffectComposer(renderer); c.setPixelRatio(renderer.getPixelRatio()); c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (gtao) { const ao = new gtao.GTAOPass(scene, camera, w, h); ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1, scale: 1.2 }); ao.blendIntensity = 0.9; c.addPass(ao); }
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.82));
      c.addPass(new OutputPass());
      c.addPass(new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()));
      composer = c; needs = true;
    } catch (e) { composer = null; } // addons unreachable: the forward render stays, same board
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

  let model = null, needs = true, t0 = performance.now(), destroyed = false;
  const flashes = [];
  function frame(now) {
    const dt = Math.min(0.25, (now - t0) / 1000); t0 = now; // capped so a stalled tab does not jump, loose enough that slow GPUs still finish on time
    const t = now / 1000;
    let moving = false;
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
  loadFx(); loadModels();

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
    selRing.visible = !!sel; if (sel) selRing.position.set(sel.x, 0.06, sel.y);
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
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; pan = null; }
    else pan = { x: e.clientX, y: e.clientY, tx: view.goal.x, tz: view.goal.z };
  });
  el.addEventListener('pointermove', (e) => {
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
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); setDist(view.dist * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
  function setDist(d) { view.dist = Math.min(view.maxDist, Math.max(view.minDist, d)); needs = true; }

  return {
    update,
    tier,
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
    isAnimating() { return busy || !!fireAnim || [...actors.values()].some((a) => a.walk || a.dying); },
    unitPosition(id) { const a = actors.get(id); return a ? { x: a.g.position.x, y: a.g.position.z } : null; },
    // test/accessibility hook: where a tile's centre is on screen right now (client coordinates)
    screenOf(x, y, h = 0) { placeCamera(); const p = project(x, y, h); const r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    tileAt,
    destroy() { destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); if (composer) composer.dispose(); renderer.dispose(); host.innerHTML = ''; }
  };
}
