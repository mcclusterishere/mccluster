/* PRIM3 city levels — three.js (0.180) view of a city grid built by city-grid.mjs. A renderer only:
   it draws the tiles, roofs, links and squad start the level data says and reports taps as tiles.
   One tile = 1 world unit (TILE_M metres), heights are metres / TILE_M, as level3d.mjs maps them.
   Every tile kind is one InstancedMesh, so the whole block is a handful of draw calls on a phone. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// the field look's tokens (prim3-transit.html): squad cyan, amber marks, night ground
export const LOOK = {
  bg: 0x080b0e, squad: 0x2fe0f0, amber: 0xffb547, threat: 0xff3b3b,
  ground: 0x1b232a, road: 0x11161b, walk: 0x2b353d, park: 0x1d3524, water: 0x0a2833, pier: 0x47392b
};
// roof layers: distinct, never purple (house rule)
const LAYER = [0x9aa7b0, 0x2fe0f0, 0xffb547, 0x7be38a, 0xff7a59, 0xe6edf1, 0x3d8bff, 0xc9a26b];
const SOURCE = { height: 0x2fe0f0, levels: 0xffb547, default: 0x6b7780, part: 0x7be38a };
const KIND_COLOR = { '.': LOOK.ground, r: LOOK.road, w: LOOK.walk, p: LOOK.park, '~': LOOK.water, P: LOOK.pier };

export function createCityView(host, level, { onPick = () => {}, reducedMotion = false } = {}) {
  const { W, H, TILE_M, grids, engineConfig } = level;
  const M = (m) => m / TILE_M;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !coarse, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(coarse ? 1.5 : 2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'cg-canvas';
  renderer.domElement.setAttribute('aria-label', 'City grid 3D view: drag to orbit, pinch to zoom, tap a tile to inspect it');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.bg);
  scene.fog = new THREE.Fog(LOOK.bg, Math.max(W, H) * 1.2, Math.max(W, H) * 3.2);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 8; controls.maxDistance = Math.max(W, H) * 2.4;
  controls.target.set(W / 2, 0, H / 2);
  // frame the whole block from the south-east, high enough that the towers do not wall it off
  const aspect0 = (host.clientWidth || 1) / (host.clientHeight || 1), reach = Math.max(W, H) * (aspect0 < 1 ? 1.5 : 1.05);
  camera.position.set(W / 2 + reach * 0.42, reach * 0.95, H / 2 + reach * 0.78);

  scene.add(new THREE.HemisphereLight(0xbfd6e6, 0x0b0f12, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1); sun.position.set(-0.6, 1, 0.35); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x2fe0f0, 0.35); rim.position.set(0.7, 0.4, -0.8); scene.add(rim);

  const kindAt = (x, y) => level.SCENE.kindRows[y][x];
  const dummy = new THREE.Object3D(), col = new THREE.Color();

  // ground: one instanced tile per non-building tile (inset so the grid reads without line geometry)
  const groundTiles = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (kindAt(x, y) !== '#') groundTiles.push([x, y]);
  const tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
  const ground = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }), groundTiles.length);
  groundTiles.forEach(([x, y], i) => {
    const k = kindAt(x, y);
    dummy.position.set(x + 0.5, k === '~' ? -0.04 : 0, y + 0.5); dummy.updateMatrix(); ground.setMatrixAt(i, dummy.matrix);
    ground.setColorAt(i, col.setHex(KIND_COLOR[k] ?? LOOK.ground));
  });
  ground.userData.tiles = groundTiles; scene.add(ground);
  const base = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050709 }));
  base.position.set(W / 2, -0.06, H / 2); scene.add(base);

  // buildings: a box per building tile, as tall as its roof
  const bTiles = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (kindAt(x, y) === '#') bTiles.push([x, y]);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const bMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, flatShading: true });
  const blocks = new THREE.InstancedMesh(boxGeo, bMat, bTiles.length);
  bTiles.forEach(([x, y], i) => {
    const h = Math.max(0.2, M(grids.height[y * W + x]));
    dummy.position.set(x + 0.5, 0, y + 0.5); dummy.scale.set(1, h, 1); dummy.updateMatrix(); blocks.setMatrixAt(i, dummy.matrix);
  });
  dummy.scale.set(1, 1, 1);
  blocks.userData.tiles = bTiles; scene.add(blocks);

  function colour(mode) {
    const maxH = level.stats.tallest.h || 1;
    bTiles.forEach(([x, y], i) => {
      const k = y * W + x, b = level.SCENE.buildings[grids.owner[k]];
      if (mode === 'height') col.setHex(0x26323a).lerp(new THREE.Color(LOOK.squad), Math.sqrt(grids.height[k] / maxH));
      else if (mode === 'source') col.setHex(SOURCE[b?.heightSource] ?? SOURCE.default);
      else col.setHex(LAYER[(grids.patchZ[grids.patchOf[k]] - 1) % LAYER.length]);
      blocks.setColorAt(i, col);
    });
    blocks.instanceColor.needsUpdate = true;
  }
  colour('layers');

  // tactical grid lines every tile (faint) and every 8 tiles (stronger), at street level
  const lines = (step, opacity) => {
    const pts = [];
    for (let x = 0; x <= W; x += step) pts.push(x, 0.02, 0, x, 0.02, H);
    for (let y = 0; y <= H; y += step) pts.push(0, 0.02, y, W, 0.02, y);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: LOOK.squad, transparent: true, opacity, depthWrite: false }));
  };
  const grid = new THREE.Group(); grid.add(lines(1, 0.07), lines(8, 0.22)); scene.add(grid);

  // links: amber ladders street → roof and roof → roof
  const lp = [];
  const hAt = (c) => (c.z === 0 ? 0.03 : M(grids.height[c.y * W + c.x]));
  for (const l of engineConfig.links) lp.push(l.from.x + 0.5, hAt(l.from), l.from.y + 0.5, l.to.x + 0.5, hAt(l.to) + 0.02, l.to.y + 0.5);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: LOOK.amber })); scene.add(links);

  // squad start: 1.75 m operatives (scale.mjs), squad cyan
  const unitGeo = new THREE.CylinderGeometry(M(0.3), M(0.3), M(1.75), 12).translate(0, M(1.75) / 2, 0);
  for (const u of engineConfig.units) {
    const m = new THREE.Mesh(unitGeo, new THREE.MeshStandardMaterial({ color: LOOK.squad, emissive: LOOK.squad, emissiveIntensity: 0.6 }));
    m.position.set(u.x + 0.5, 0, u.y + 0.5); scene.add(m);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: LOOK.squad }));
    ring.position.set(u.x + 0.5, 0.03, u.y + 0.5); scene.add(ring);
  }

  // selection marker
  const sel = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1, 1.04).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: LOOK.amber, wireframe: true }));
  sel.visible = false; scene.add(sel);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([blocks, ground], false)[0];
    if (!hit) return;
    const [x, y] = hit.object.userData.tiles[hit.instanceId];
    select(x, y);
  });
  function select(x, y) {
    const k = y * W + x, h = grids.height[k];
    sel.visible = true; sel.position.set(x + 0.5, 0, y + 0.5); sel.scale.set(1, Math.max(0.05, M(h)) + 0.02, 1);
    const b = grids.owner[k] >= 0 ? level.SCENE.buildings[grids.owner[k]] : null;
    onPick({ x, y, kind: kindAt(x, y), height: h, building: b, roofZ: grids.patchOf[k] >= 0 ? grids.patchZ[grids.patchOf[k]] : null });
    dirty = true;
  }

  let dirty = true, frames = 0, last = performance.now(), ft = [];
  controls.addEventListener('change', () => { dirty = true; });
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
  }
  new ResizeObserver(resize).observe(host); resize();
  function loop(now) {
    requestAnimationFrame(loop);
    const changed = controls.update();
    if (!dirty && !changed) return;
    dirty = false; renderer.render(scene, camera); frames += 1;
    ft.push(now - last); if (ft.length > 120) ft.shift(); last = now;
  }
  requestAnimationFrame(loop);

  return {
    setMode: (m) => { colour(m); dirty = true; },
    setGrid: (on) => { grid.visible = on; dirty = true; },
    setLinks: (on) => { links.visible = on; dirty = true; },
    select,
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, frames, instances: { ground: groundTiles.length, blocks: bTiles.length } }),
    renderer, camera, controls, requestRender: () => { dirty = true; }
  };
}
