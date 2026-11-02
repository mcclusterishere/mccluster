/* PRIM3 tactics — level renderer (three.js 0.180.0). Draws an authored level (levels/*.mjs SCENE) and
   the board model the page gives it; reports taps as tiles. A renderer only: rules, legality, hints
   and fog of war stay in the canonical resolver. Animations never change the game.

   World mapping: tile (x, y, z) → X = x, Z = y, Y = surface height (metres / TILE_M). One tile = 1
   world unit ≈ 1.6 m. Nothing hidden is ever passed in.

   Two looks, switched in place (owner, 2026-11-02: "both as a toggle"):
     field  — the default: a wet industrial compound at night, PBR materials, sodium lamps, rain,
              moving canal water, bloom; squad cyan, threats red (the owner's reference image).
     studio — the earlier owner direction: every inorganic surface white clay, neutral light, no
              bloom; teams told apart only by their glow (squad red, opposition blue); nature in colour.
   Graphics tiers (high / mid / low) change cost, never the board. */
import * as THREE from 'three';
import { createOperativeKit } from './operatives3d.mjs';

const PBR_ROOT = new URL('../../assets/3d/prim3-tactics/', import.meta.url);
const MODEL_ROOT = new URL('../../assets/3d/prim3-operators/', import.meta.url);
// The White Industrial kit (owner-supplied, 2026-11-02): original procedural GLBs with a catalog of footprints.
const KIT_ROOT = new URL('../../assets/3d/prim3-kit/white-industrial/', import.meta.url);
const TEAMS = {
  day: { PLAYER: 0x14b8c8, THREAT: 0xd81f2a },
  field: { PLAYER: 0x2fe0f0, THREAT: 0xff3b3b },
  studio: { PLAYER: 0xff2a3a, THREAT: 0x3d8bff }
};
const OVER = {
  day: { reach: 0x0fb2c4, path: 0xf29d17, line: 0xe8890a, dest: 0xe8890a },
  field: { reach: 0x22d3e6, path: 0xffb547, line: 0xffb547, dest: 0xffb547 },
  studio: { reach: 0x30373c, path: 0x0e1113, line: 0x0e1113, dest: 0x0e1113 }
};
const NATURE = { leaf: 0x3f5f2c, leaf2: 0x52733a, bark: 0x4a3426 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
function pickTier(renderer, fx) {
  if (fx === 'high' || fx === 'mid' || fx === 'low') return fx;
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(name)) return 'low';
  } catch (e) { /* unknown GPU */ }
  return matchMedia('(pointer: coarse)').matches ? 'mid' : 'high';
}
// box geometry whose UVs repeat every `unit` world units on every face (so textures keep real scale)
function boxUV(w, h, d, unit = 2) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x −x +y −y +z −z
  for (let f = 0; f < 6; f += 1) for (let i = 0; i < 4; i += 1) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / unit, uv.getY(k) * dims[f][1] / unit); }
  return g;
}

export function createLevel3D(host, { level, onTap, onView = null, reducedMotion = false, fx = null, look = 'field', showcase = false }) {
  const { SCENE, W, H, TILE_M, toDisplay } = level;
  const M = (m) => m / TILE_M; // metres → world units
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const tier = pickTier(renderer, fx);
  renderer.setPixelRatio(Math.min(tier === 'high' ? 2 : 1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = tier !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'b3-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);
  const labels = document.createElement('div'); labels.className = 'b3-labels'; host.appendChild(labels);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  const cx = W / 2, cz = H / 2;
  const normLook = (lk) => (lk === 'studio' || lk === 'field' ? lk : 'day');
  let curLook = normLook(look);

  /* ---------- materials: every environment material remembers its field look ---------- */
  const envMats = [];
  const pbrQueue = [];
  function mat(o, { pbr = null, tone = 0xeceeef, keep = false } = {}) {
    const m = new THREE.MeshStandardMaterial(o);
    m.userData.tone = tone; m.userData.keepColor = keep; m.userData.pbr = pbr;
    envMats.push(m); if (pbr) pbrQueue.push(m); return m;
  }
  const surfaceHeight = (x, y, z) => {
    if (!z) return 0;
    const s = SCENE.buildings.find((b) => b.roof && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d)
      || (SCENE.skybridge && x >= SCENE.skybridge.x && x < SCENE.skybridge.x + SCENE.skybridge.w && y >= SCENE.skybridge.y && y < SCENE.skybridge.y + SCENE.skybridge.d ? SCENE.skybridge : null);
    return s ? M(s.h) : 0;
  };

  const M_ASPHALT = mat({ color: 0x5b5f63, roughness: 0.62, metalness: 0.05 }, { pbr: { set: 'asphalt_02', repeat: [W / 3, H / 3] }, tone: 0xe7e8e8 });
  const M_CONC = mat({ color: 0x8b8d8f, roughness: 0.85 }, { pbr: { set: 'concrete_wall_006' }, tone: 0xeeeeec });
  const M_ROOF = mat({ color: 0x77797b, roughness: 0.8 }, { pbr: { set: 'concrete_floor_worn_001' }, tone: 0xf0f0ee });
  const M_CORR = mat({ color: 0x8a8f93, roughness: 0.55, metalness: 0.45 }, { pbr: { set: 'corrugated_iron_02' }, tone: 0xe9e9e7 });
  const M_GRATE = mat({ color: 0x6d6a66, roughness: 0.6, metalness: 0.6 }, { pbr: { set: 'metal_grate_rusty' }, tone: 0xe2e3e3 });
  const M_WOOD = mat({ color: 0x8a6a48, roughness: 0.85 }, { pbr: { set: 'brown_planks_05' }, tone: 0xe6e3de });
  const M_IRON = mat({ color: 0x15181b, roughness: 0.45, metalness: 0.8 }, { tone: 0xd8d9da });
  const M_HAZ = mat({ color: 0xd9a136, roughness: 0.6 }, { tone: 0xd5d6d6 });
  const M_TENT = mat({ color: 0x3e4a33, roughness: 0.95 }, { tone: 0xe4e4e2 });
  const M_DOOR = mat({ color: 0x1b2024, roughness: 0.4, metalness: 0.5 }, { tone: 0xcfd2d4 });
  const M_GLASS = mat({ color: 0x0d151b, roughness: 0.08, metalness: 0.6 }, { tone: 0xd9dcde });
  const M_LIT = mat({ color: 0x2a1a0c, roughness: 0.3, emissive: 0xffb064, emissiveIntensity: 1.8 }, { tone: 0xdfe1e2 });
  const M_LEAF = mat({ color: NATURE.leaf, roughness: 0.85 }, { keep: true });
  const M_LEAF2 = mat({ color: NATURE.leaf2, roughness: 0.85 }, { keep: true });
  const M_BARK = mat({ color: NATURE.bark, roughness: 1 }, { keep: true });
  const containerMats = new Map();
  const containerMat = (color) => { if (!containerMats.has(color)) containerMats.set(color, mat({ color, roughness: 0.5, metalness: 0.5 }, { pbr: { set: 'container_side', tint: color }, tone: 0xe5e6e6 })); return containerMats.get(color); };
  // water: dark, glossy, its own scrolling normal map (procedural; no download)
  const waterNormal = canvasTex(256, 256, (g, w, h) => {
    const r = rng(9); const img = g.createImageData(w, h);
    const f = (x, y) => Math.sin(x * 0.11 + Math.sin(y * 0.05) * 2) + Math.sin(y * 0.13 + Math.cos(x * 0.04) * 3) + (r() - 0.5) * 0.3;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const dx = f(x + 1, y) - f(x - 1, y), dy = f(x, y + 1) - f(x, y - 1), i = (y * w + x) * 4;
      img.data[i] = 128 + dx * 40; img.data[i + 1] = 128 + dy * 40; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  waterNormal.repeat.set(16, 1.2);
  const M_WATER = mat({ color: 0x0b2a30, roughness: 0.06, metalness: 0.35, normalMap: waterNormal, normalScale: new THREE.Vector2(0.6, 0.6) }, { tone: 0xd9dcdd });
  M_WATER.userData.keepNormal = true;

  const add = (geo, m, x, y, z, { cast = true, recv = true, parent = world } = {}) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast && tier !== 'low'; o.receiveShadow = recv; parent.add(o); return o; };
  const world = new THREE.Group(); scene.add(world);

  /* ---------- ground, canal, bridges ---------- */
  const canal = SCENE.canal;
  const margin = 18;
  { // ground north and south of the canal (the canal is a real cut, not a texture)
    const north = canal.y, south = H - (canal.y + canal.d);
    const gN = new THREE.PlaneGeometry(W + margin * 2, north + margin); gN.rotateX(-Math.PI / 2);
    add(gN, M_ASPHALT, cx - 0.5, 0, (north - margin) / 2 - 0.5, { cast: false });
    const gS = new THREE.PlaneGeometry(W + margin * 2, south + margin); gS.rotateX(-Math.PI / 2);
    add(gS, M_ASPHALT, cx - 0.5, 0, canal.y + canal.d + (south + margin) / 2 - 0.5, { cast: false });
    for (const g of [gN, gS]) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (W + margin * 2) / 3, uv.getY(i) * H / 3); }
    // canal walls and water
    const depth = M(2.2), len = W + margin * 2;
    for (const zEdge of [canal.y - 0.5, canal.y + canal.d - 0.5]) add(boxUV(len, depth, 0.25), M_CONC, cx - 0.5, -depth / 2, zEdge, { cast: false });
    const bed = new THREE.PlaneGeometry(len, canal.d); bed.rotateX(-Math.PI / 2);
    const water = add(bed, M_WATER, cx - 0.5, -M(1.2), canal.y + canal.d / 2 - 0.5, { cast: false });
    water.userData.water = true;
    // curb lines along the canal (concrete lips)
    for (const zEdge of [canal.y - 0.62, canal.y + canal.d - 0.38]) add(boxUV(len, M(0.18), 0.25), M_CONC, cx - 0.5, M(0.09), zEdge);
  }
  for (const b of SCENE.bridges) {
    const deckM = b.kind === 'grate' ? M_GRATE : M_CONC;
    add(boxUV(b.w, M(0.35), canal.d + 0.6, 1.5), deckM, b.x + b.w / 2 - 0.5, -M(0.17), canal.y + canal.d / 2 - 0.5);
    for (const sx of [b.x - 0.45, b.x + b.w - 0.55]) { // railings
      add(new THREE.BoxGeometry(0.06, 0.06, canal.d + 0.6), M_IRON, sx, M(1.05), canal.y + canal.d / 2 - 0.5);
      for (let k = 0; k <= canal.d; k += 1) add(new THREE.BoxGeometry(0.05, M(1.05), 0.05), M_IRON, sx, M(0.52), canal.y - 0.5 + k + 0.3);
    }
  }

  /* ---------- painted labels (building codes, MED): plain text, no marks ---------- */
  function textTex(text, { w = 256, h = 128, color = 'rgba(235,235,230,.82)', font = '700 92px system-ui' } = {}) {
    return canvasTex(w, h, (g, cw, ch) => { g.clearRect(0, 0, cw, ch); g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, ch / 2 + 4); });
  }
  const decal = (tex, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.85 }));

  /* ---------- buildings: walls, windows, doors, parapets, roof slabs ---------- */
  const roofs = []; // pickable roof slabs: { mesh, z: 1 }
  const winR = rng(17);
  for (const b of SCENE.buildings) {
    const hh = M(b.h), wallM = b.wall === 'corrugated' ? M_CORR : M_CONC;
    const bx = b.x + b.w / 2 - 0.5, bz = b.y + b.d / 2 - 0.5;
    add(boxUV(b.w, hh, b.d, 2.2), wallM, bx, hh / 2, bz);
    // a darker base course
    add(boxUV(b.w + 0.06, M(0.7), b.d + 0.06, 1.5), M_CONC, bx, M(0.35), bz, { cast: false });
    // roof slab + parapet
    const slab = add(boxUV(b.w, 0.08, b.d, 2), M_ROOF, bx, hh + 0.04, bz, { cast: false }); slab.userData.roofZ = b.roof ? 1 : null; if (b.roof) roofs.push(slab);
    const pH = M(0.7);
    for (const [px, pz, pw, pd] of [[bx, b.y - 0.5, b.w, 0.12], [bx, b.y + b.d - 0.5, b.w, 0.12], [b.x - 0.5, bz, 0.12, b.d], [b.x + b.w - 0.5, bz, 0.12, b.d]]) add(boxUV(pw, pH, pd, 1.5), M_CONC, px, hh + pH / 2, pz);
    // windows on the long facades: rows per storey, some lit
    const storeys = Math.max(1, Math.floor(b.h / 3.2));
    for (const [face, nx, nz, len] of [['S', 0, 1, b.w], ['N', 0, -1, b.w], ['E', 1, 0, b.d], ['W', -1, 0, b.d]]) {
      for (let s = 0; s < storeys; s += 1) for (let i = 1; i < len - 1; i += 3) {
        if (winR() < 0.25) continue;
        const lit = winR() < 0.38;
        const y = M(1.9 + s * 3.2);
        const along = (face === 'S' || face === 'N') ? b.x - 0.5 + i + 0.5 : b.y - 0.5 + i + 0.5;
        const w = add(new THREE.PlaneGeometry(1.1, M(1.2)), lit ? M_LIT : M_GLASS,
          face === 'E' ? b.x + b.w - 0.5 + 0.02 : face === 'W' ? b.x - 0.5 - 0.02 : along, y,
          face === 'S' ? b.y + b.d - 0.5 + 0.02 : face === 'N' ? b.y - 0.5 - 0.02 : along, { cast: false });
        w.rotation.y = Math.atan2(nx, nz);
      }
    }
    // building code painted on the yard-facing wall
    const lab = decal(textTex(b.label), M(4.5), M(2.25)); lab.position.set(bx, hh * 0.72, b.y + b.d - 0.5 + 0.03); world.add(lab);
    if (b.door) { // a lit service door
      const dz = b.door.side === 'S' ? b.y + b.d - 0.5 + 0.03 : bz, dxp = b.door.side === 'E' ? b.x + b.w - 0.5 + 0.03 : b.door.at;
      const d = add(new THREE.PlaneGeometry(1.4, M(2.4)), M_DOOR, b.door.side === 'S' ? b.door.at : dxp, M(1.2), b.door.side === 'S' ? dz : b.door.at, { cast: false });
      d.rotation.y = b.door.side === 'E' ? Math.PI / 2 : 0;
    }
  }
  if (SCENE.skybridge) {
    const s = SCENE.skybridge, hh = M(s.h);
    const deck = add(boxUV(s.w, 0.12, s.d, 1.5), M_GRATE, s.x + s.w / 2 - 0.5, hh - 0.06, s.y + s.d / 2 - 0.5); deck.userData.roofZ = 1; roofs.push(deck);
    for (const sz of [s.y - 0.45, s.y + s.d - 0.55]) add(new THREE.BoxGeometry(s.w, 0.05, 0.05), M_IRON, s.x + s.w / 2 - 0.5, hh + M(1.05), sz);
    for (const px of [s.x + 2, s.x + s.w - 3]) add(new THREE.BoxGeometry(0.35, hh, 0.35), M_CONC, px, hh / 2, s.y + s.d);
    add(new THREE.BoxGeometry(s.w, 0.35, 0.2), M_IRON, s.x + s.w / 2 - 0.5, hh - 0.3, s.y + s.d - 0.5);
  }
  for (const st of SCENE.stairs) { // a steel flight from the foot tile up to the roof landing
    const a = st.from, b = st.to, h1 = surfaceHeight(b.x, b.y, 1);
    const steps = 12, dx = (b.x - a.x), dz = (b.y - a.y);
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 0.5) / steps;
      add(new THREE.BoxGeometry(0.9, 0.06, 0.9), M_GRATE, a.x + dx * t, h1 * t, a.y + dz * t);
    }
    const p0 = new THREE.Vector3(a.x, 0, a.y), p1 = new THREE.Vector3(b.x, h1, b.y), mid = p0.clone().lerp(p1, 0.5), len = p0.distanceTo(p1);
    for (const off of [-0.48, 0.48]) {
      const rail = add(new THREE.BoxGeometry(0.05, 0.05, len), M_IRON, mid.x, mid.y + M(1.0), mid.z);
      rail.lookAt(p1.x, p1.y + M(1.0), p1.z); rail.position.x += Math.abs(dz) > Math.abs(dx) ? off : 0; rail.position.z += Math.abs(dx) >= Math.abs(dz) ? off : 0;
    }
  }

  /* ---------- props: containers, barriers, crates, tent, fence and gate, relay, extraction ---------- */
  const proc = { container: new THREE.Group(), barrier: new THREE.Group(), crate: new THREE.Group(), hvac: new THREE.Group(), tree: new THREE.Group() };
  for (const g of Object.values(proc)) world.add(g);
  for (const c of SCENE.containers) {
    const hh = M(c.h), m = containerMat(c.color);
    add(boxUV(c.w - 0.05, hh, c.d - 0.05, 2.4), m, c.x + c.w / 2 - 0.5, hh / 2, c.y + c.d / 2 - 0.5, { parent: proc.container });
    for (const e of [-1, 1]) { // corner posts
      const long = c.w >= c.d;
      add(new THREE.BoxGeometry(long ? 0.08 : c.w, hh, long ? c.d : 0.08), M_IRON, c.x + c.w / 2 - 0.5 + (long ? e * (c.w / 2 - 0.05) : 0), hh / 2, c.y + c.d / 2 - 0.5 + (long ? 0 : e * (c.d / 2 - 0.05)), { cast: false, parent: proc.container });
    }
  }
  const jersey = (() => { const s = new THREE.Shape(); s.moveTo(-0.24, 0); s.lineTo(0.24, 0); s.lineTo(0.1, M(0.4)); s.lineTo(0.08, M(1.1)); s.lineTo(-0.08, M(1.1)); s.lineTo(-0.1, M(0.4)); s.closePath(); return s; })();
  for (const b of SCENE.barricades) {
    const long = b.w >= b.d, n = long ? b.w : b.d;
    for (let i = 0; i < n; i += 1) {
      const geo = new THREE.ExtrudeGeometry(jersey, { depth: 0.96, bevelEnabled: false }); geo.translate(0, 0, -0.48);
      const o = add(geo, M_CONC, b.x + (long ? i : 0), 0, b.y + (long ? 0 : i), { parent: proc.barrier }); o.rotation.y = long ? Math.PI / 2 : 0;
      add(new THREE.BoxGeometry(long ? 0.94 : 0.18, 0.06, long ? 0.18 : 0.94), M_HAZ, o.position.x, M(0.85), o.position.z, { cast: false, parent: proc.barrier });
    }
  }
  const cr = rng(31);
  for (const c of SCENE.crates) for (let y = c.y; y < c.y + c.d; y += 1) for (let x = c.x; x < c.x + c.w; x += 1) {
    const s1 = 0.86, s2 = 0.6;
    add(boxUV(s1, M(1.0), s1, 1), M_WOOD, x, M(0.5), y, { parent: proc.crate }).rotation.y = (cr() - 0.5) * 0.3;
    add(boxUV(s2, M(0.8), s2, 1), M_WOOD, x + (cr() - 0.5) * 0.15, M(1.0) + M(0.4), y + (cr() - 0.5) * 0.15, { parent: proc.crate }).rotation.y = (cr() - 0.5) * 0.8;
  }
  if (SCENE.tent) { // a field tent: a ridged canvas prism with a painted MED panel
    const t = SCENE.tent, hh = M(t.h);
    const shape = new THREE.Shape(); shape.moveTo(-t.d / 2, 0); shape.lineTo(t.d / 2, 0); shape.lineTo(t.d / 2 - 0.2, hh * 0.55); shape.lineTo(0, hh); shape.lineTo(-t.d / 2 + 0.2, hh * 0.55); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t.w, bevelEnabled: false }); geo.translate(0, 0, -t.w / 2); geo.rotateY(Math.PI / 2);
    add(geo, M_TENT, t.x + t.w / 2 - 0.5, 0, t.y + t.d / 2 - 0.5);
    const lab = decal(textTex('MED'), M(2.2), M(1.1)); lab.position.set(t.x + t.w / 2 - 0.5, hh * 0.38, t.y + t.d - 0.5 + 0.03); world.add(lab);
  }
  const chain = canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(190,195,200,1)'; g.lineWidth = 2.2; for (let i = -64; i < 128; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } });
  const M_CHAIN = mat({ color: 0x9aa0a4, map: chain, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }, { tone: 0xcfd1d3 });
  M_CHAIN.userData.keepMap = true;
  const gateGroup = new THREE.Group(); world.add(gateGroup);
  if (SCENE.fence) {
    const f = SCENE.fence, hh = M(f.h);
    for (let x = f.x0; x <= f.x1; x += 1) {
      const isGate = f.gate.includes(x);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, hh), isGate ? M_GRATE : M_CHAIN);
      panel.position.set(x, hh / 2, f.y); panel.castShadow = false; panel.receiveShadow = true;
      (isGate ? gateGroup : world).add(panel);
      chain.repeat.set(1, hh);
      add(new THREE.CylinderGeometry(0.04, 0.04, hh, 6), M_IRON, x - 0.5, hh / 2, f.y);
    }
    add(new THREE.BoxGeometry(f.x1 - f.x0 + 1, 0.05, 0.05), M_IRON, (f.x0 + f.x1) / 2, hh, f.y);
  }
  const relayGroup = new THREE.Group(); world.add(relayGroup);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false, wireframe: false }));
  if (SCENE.relay) {
    const r = SCENE.relay;
    const cab = new THREE.Mesh(boxUV(0.7, M(1.5), 0.6, 1), M_IRON); cab.position.set(r.x, M(0.75), r.y); cab.castShadow = true; relayGroup.add(cab);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ color: 0x0f3a40, toneMapped: false })); panel.position.set(r.x, M(1.0), r.y + 0.31); relayGroup.add(panel);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, M(2.4)), M_IRON); mast.position.set(r.x + 0.2, M(1.5) + M(1.2), r.y - 0.15); relayGroup.add(mast);
    beacon.position.set(r.x, M(1.5) + 1.0, r.y); relayGroup.add(beacon);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.86, 4), new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = Math.PI / 4; pad.position.set(r.x, 0.03, r.y); relayGroup.add(pad); pad.userData.overlay = true;
  }
  const relayLight = new THREE.PointLight(0xffb547, 6, M(9), 2); if (SCENE.relay) relayLight.position.set(SCENE.relay.x, M(1.5) + 0.8, SCENE.relay.y); world.add(relayLight);
  if (SCENE.extraction) { // the extraction pad: a painted hazard ring
    const e = SCENE.extraction;
    const ring = new THREE.Mesh(new THREE.RingGeometry(e.r + 0.2, e.r + 0.5, 64), new THREE.MeshBasicMaterial({ color: 0xffd23a, toneMapped: false, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(e.x, 0.02, e.y); world.add(ring);
    const lab = decal(textTex('EXTRACT', { w: 512, font: '800 84px system-ui', color: 'rgba(255,210,58,.85)' }), M(5), M(1.25)); lab.rotation.x = -Math.PI / 2; lab.position.set(e.x, 0.03, e.y); world.add(lab);
  }
  for (const r of SCENE.rooftop || []) { // AC units and vents
    const hh = M(r.h), base = surfaceHeight(r.x, r.y, 1);
    add(boxUV(r.w - 0.1, hh, r.d - 0.1, 1), M_CORR, r.x + r.w / 2 - 0.5, base + hh / 2, r.y + r.d / 2 - 0.5, { parent: proc.hvac });
    add(new THREE.CylinderGeometry(Math.min(r.w, r.d) * 0.3, Math.min(r.w, r.d) * 0.3, 0.06, 20), M_IRON, r.x + r.w / 2 - 0.5, base + hh + 0.03, r.y + r.d / 2 - 0.5, { parent: proc.hvac });
  }
  function blob(radius, seed) {
    const geo = new THREE.SphereGeometry(radius, 16, 12), pos = geo.attributes.position, v = new THREE.Vector3(), r = rng(seed), k = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < pos.count; i += 1) { v.fromBufferAttribute(pos, i); v.multiplyScalar(1 + 0.16 * Math.sin(v.x * 9 + k[0]) * Math.sin(v.y * 8 + k[1]) + 0.1 * Math.sin(v.z * 13 + k[2])); pos.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals(); return geo;
  }
  for (const t of SCENE.trees || []) {
    add(new THREE.CylinderGeometry(0.08, 0.13, M(3), 8), M_BARK, t.x, M(1.5), t.y, { parent: proc.tree });
    const r = rng(t.x * 31 + t.y);
    for (let i = 0; i < 5; i += 1) add(blob(0.7 + r() * 0.5, i + t.x), i % 2 ? M_LEAF : M_LEAF2, t.x + (r() - 0.5) * 1.2, M(3.2) + r() * 1.2, t.y + (r() - 0.5) * 1.2, { parent: proc.tree });
  }
  // the city beyond the fence line: dark blocks with scattered lit windows (depth, never on the board)
  { const r = rng(77);
    for (let i = 0; i < 26; i += 1) {
      const side = i % 4, w = 6 + r() * 10, d = 6 + r() * 10, h = M(10 + r() * 26);
      const x = side === 0 ? -margin + 4 + r() * (W + margin * 2 - 8) : side === 1 ? W + margin - 6 : side === 2 ? -margin + 4 + r() * (W + margin * 2 - 8) : -margin + 2;
      const z = side === 0 ? -margin + 3 : side === 2 ? H + margin - 6 : -margin + r() * (H + margin * 2);
      add(boxUV(w, h, d, 3), i % 3 ? M_CONC : M_CORR, x, h / 2, z, { cast: false });
    } }

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0x8fa6c4, 0x1a1c1f, 0.5); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xbfd2ff, 1.1);
  moon.position.set(cx - 30, 50, cz - 25); moon.target.position.set(cx, 0, cz);
  moon.castShadow = tier !== 'low'; moon.shadow.mapSize.set(tier === 'high' ? 4096 : 2048, tier === 'high' ? 4096 : 2048);
  Object.assign(moon.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 140 });
  moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.03; scene.add(moon, moon.target);
  const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,220,150,.6)'); gr.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const lampLights = [], lampSprites = [];
  for (const l of SCENE.lamps || []) {
    add(new THREE.CylinderGeometry(0.05, 0.08, M(5.5), 8), M_IRON, l.x, M(2.75), l.y);
    add(new THREE.BoxGeometry(0.7, 0.05, 0.05), M_IRON, l.x + 0.3, M(5.5), l.y);
    const head = add(new THREE.BoxGeometry(0.4, 0.12, 0.22), M_LIT, l.x + 0.6, M(5.45), l.y, { cast: false });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb36a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
    sp.scale.set(2.2, 2.2, 1); sp.position.copy(head.position); scene.add(sp); lampSprites.push(sp);
    const pl = new THREE.PointLight(0xffa458, 22, M(16), 1.6); pl.position.set(l.x + 0.6, M(5.2), l.y); scene.add(pl); lampLights.push(pl);
  }

  /* ---------- rain (field look only) ---------- */
  const RAIN = tier === 'low' ? 0 : tier === 'mid' ? 1400 : 3000;
  const rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(RAIN * 6), rainSeed = rng(5);
  for (let i = 0; i < RAIN; i += 1) { const x = rainSeed() * 70 - 3, y = rainSeed() * 30, z = rainSeed() * 70 - 3; rainPos.set([x, y, z, x - 0.04, y - 0.5, z + 0.02], i * 6); }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x9fb6c8, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.frustumCulled = false; scene.add(rain);

  /* ---------- overlays (instanced: a 64×64 board never builds thousands of meshes) ---------- */
  const tileGeo = new THREE.PlaneGeometry(0.92, 0.92); tileGeo.rotateX(-Math.PI / 2);
  const ovMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
  // reachable tiles read like the reference: a thin lit outline and a faint fill, so the ground shows through
  const tileTex = canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(3, 3, 58, 58); g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 2.5; g.strokeRect(3, 3, 58, 58); }, false);
  const reachMat = ovMat(0x22d3e6, 0.85); reachMat.map = tileTex;
  const reachMesh = new THREE.InstancedMesh(tileGeo, reachMat, W * H * 2); reachMesh.count = 0; reachMesh.renderOrder = 2; reachMesh.frustumCulled = false; scene.add(reachMesh);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.001, 0.96));
  const reachEdge = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2), ovMat(0x22d3e6, 0.05), W * H * 2); reachEdge.count = 0; reachEdge.renderOrder = 1; reachEdge.frustumCulled = false; scene.add(reachEdge);
  const pathMesh = new THREE.InstancedMesh(tileGeo, ovMat(0xffb547, 0.32), 256); pathMesh.count = 0; pathMesh.renderOrder = 3; pathMesh.frustumCulled = false; scene.add(pathMesh);
  const hintMesh = new THREE.InstancedMesh(tileGeo, ovMat(0xffffff, 0.35), 256); hintMesh.count = 0; hintMesh.renderOrder = 3; hintMesh.frustumCulled = false; scene.add(hintMesh);
  const destFrame = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffb547, toneMapped: false })); destFrame.visible = false; scene.add(destFrame);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffb547, dashSize: 0.35, gapSize: 0.22, toneMapped: false, linewidth: 2 })); pathLine.visible = false; pathLine.renderOrder = 4; scene.add(pathLine);
  const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), ovMat(0xff3b3b, 0.95)); targetRing.visible = false; scene.add(targetRing);
  const mm = new THREE.Matrix4();
  function fillTiles(mesh, tiles, lift = 0.035) {
    let n = 0;
    for (const t of tiles || []) { if (n >= mesh.instanceMatrix.count) break; mm.makeTranslation(t.x, surfaceHeight(t.x, t.y, t.z || 0) + lift, t.y); mesh.setMatrixAt(n++, mm); }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------- the plotting grid: every tile edge on the ground and on each walkable roof ---------- */
  const gridGroup = new THREE.Group(); scene.add(gridGroup);
  const gridMat = new THREE.LineBasicMaterial({ color: 0x5fe6f2, transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false });
  const gridMajor = new THREE.LineBasicMaterial({ color: 0x9ff3fb, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
  { const minor = [], major = [], put = (arr, ...v) => arr.push(...v);
    const isMajorX = (x) => (x - level.FRAME.x0) % 8 === 0, isMajorY = (y) => (level.FRAME.y0 - y + 1) % 8 === 0;
    const cut = (x, y) => y >= canal.y && y < canal.y + canal.d && !SCENE.bridges.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d);
    for (let x = 0; x <= W; x += 1) for (let y = 0; y < H; y += 1) { if (cut(x, y) && cut(x - 1, y)) continue; put(isMajorX(x) ? major : minor, x - 0.5, 0.03, y - 0.5, x - 0.5, 0.03, y + 0.5); }
    for (let y = 0; y <= H; y += 1) for (let x = 0; x < W; x += 1) { if (cut(x, y) && cut(x, y - 1)) continue; put(isMajorY(y) ? major : minor, x - 0.5, 0.03, y - 0.5, x + 0.5, 0.03, y - 0.5); }
    const roofsDef = [...SCENE.buildings.filter((b) => b.roof), ...(SCENE.skybridge ? [SCENE.skybridge] : [])];
    for (const r of roofsDef) { const hh = M(r.h) + 0.1;
      for (let x = r.x; x <= r.x + r.w; x += 1) put(minor, x - 0.5, hh, r.y - 0.5, x - 0.5, hh, r.y + r.d - 0.5);
      for (let y = r.y; y <= r.y + r.d; y += 1) put(minor, r.x - 0.5, hh, y - 0.5, r.x + r.w - 0.5, hh, y - 0.5); }
    const seg = (arr, m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const l = new THREE.LineSegments(g, m); l.renderOrder = 1; l.frustumCulled = false; gridGroup.add(l); };
    seg(minor, gridMat); seg(major, gridMajor); }

  /* ---------- fog of war: a per-tile shade over the ground, fed by the page from the engine's sight ---------- */
  const fogData = new Uint8Array(W * H * 4).fill(255);
  const fogTex = new THREE.DataTexture(fogData, W, H, THREE.RGBAFormat); fogTex.magFilter = THREE.LinearFilter; fogTex.minFilter = THREE.LinearFilter; fogTex.needsUpdate = true;
  const fogMat = new THREE.MeshBasicMaterial({ color: 0x0b1218, alphaMap: fogTex, transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false });
  const fogPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), fogMat);
  fogPlane.position.set(cx - 0.5, 0.06, cz - 0.5); fogPlane.renderOrder = 2; fogPlane.visible = false; scene.add(fogPlane);
  let fogOn = false;

  /* ---------- operatives ---------- */
  const haloTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const kit = createOperativeKit(THREE, { team: TEAMS[curLook], haloTex, reducedMotion });
  const BODY_SCALE = 0.55; // the mannequins are built in metres ×1.18; one tile is 1.6 m
  const glbs = {};
  const unitsGroup = new THREE.Group(); scene.add(unitsGroup);
  const actors = new Map();
  function makeActor(u) {
    const role = u.faction === 'PLAYER' ? u.role : 'H';
    const outer = new THREE.Group(); outer.userData.unitId = u.id;
    let rig = null;
    if (glbs[role]) {
      const m = glbs[role].scene.clone(true); m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      const s = M(1.82) / Math.max(0.001, size.y); m.scale.setScalar(s); m.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s, -(box.min.z + size.z / 2) * s);
      outer.add(m);
      const halo = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshBasicMaterial({ map: haloTex, color: TEAMS[curLook][u.faction] || TEAMS[curLook].THREAT, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.015; outer.add(halo);
      rig = { halo, accent: null, glb: true };
    } else {
      const made = kit.operative(u); made.g.scale.multiplyScalar(BODY_SCALE); made.rig.halo.scale.setScalar(1 / BODY_SCALE * 0.9);
      outer.add(made.g); rig = made.rig;
    }
    return { g: outer, rig, unit: u, walk: null, walkAmt: 0, phase: 0, crouch: 0, crouchGoal: 0, face: 0, faceGoal: 0, restFace: 0, aim: 0, recoil: 0, flinch: 0, dying: null, seed: Math.random() * 6 };
  }
  function recolorTeams() {
    for (const a of actors.values()) {
      const c = TEAMS[curLook][a.unit.faction] || TEAMS[curLook].THREAT;
      if (a.rig && a.rig.accent) { a.rig.accent.color.set(c); a.rig.accent.emissive.set(c); }
      if (a.rig && a.rig.halo) a.rig.halo.material.color.set(c);
    }
  }

  /* ---------- the two looks ---------- */
  let composer = null, bloomPass = null, hdrTex = null, studioEnv = null, fieldEnv = null;
  function applyLook(lk) {
    curLook = normLook(lk);
    const day = curLook === 'day';
    const studio = curLook === 'studio';
    for (const m of envMats) {
      if (m.userData.keepColor) continue;
      if (!m.userData.orig) m.userData.orig = { color: m.color.getHex(), map: m.map, emissive: m.emissive.getHex(), emissiveIntensity: m.emissiveIntensity, metalness: m.metalness, roughness: m.roughness, normalMap: m.normalMap };
      const o = m.userData.orig;
      if (studio) {
        m.color.set(m.userData.tone); if (!m.userData.keepMap) m.map = null; m.emissive.set(0x000000); m.emissiveIntensity = 0;
        m.metalness = 0; m.roughness = Math.max(0.6, o.roughness); if (m.userData.keepNormal) m.normalMap = null;
      } else {
        m.color.set(o.color); m.map = o.map; m.emissive.set(o.emissive); m.emissiveIntensity = o.emissiveIntensity;
        m.metalness = o.metalness; m.roughness = o.roughness; m.normalMap = o.normalMap;
      }
      m.needsUpdate = true;
    }
    scene.background = studio ? new THREE.Color(0xe9ebec) : day ? new THREE.Color(0xbcd3e2) : (hdrTex || new THREE.Color(0x0b1016));
    if (!studio && !day && hdrTex) { scene.backgroundBlurriness = 0.4; scene.backgroundIntensity = 0.25; }
    scene.fog = studio ? new THREE.Fog(0xe9ebec, 90, 200) : day ? new THREE.Fog(0xcadbe6, 80, 210) : new THREE.FogExp2(0x121b24, 0.0055);
    scene.environment = studio || day ? studioEnv : fieldEnv;
    scene.environmentIntensity = studio ? 0.25 : day ? 0.55 : 0.45;
    renderer.toneMappingExposure = studio ? 0.95 : day ? 1.0 : 1.2;
    hemi.color.set(studio || day ? 0xffffff : 0x8fa6c4); hemi.groundColor.set(studio ? 0xb9bec2 : day ? 0x8e9284 : 0x1a1c1f); hemi.intensity = studio ? 0.85 : day ? 1.05 : (fieldEnv ? 0.75 : 1.15);
    moon.color.set(studio ? 0xfffaf2 : day ? 0xfff1dc : 0xbfd2ff); moon.intensity = studio ? 2.0 : day ? 2.7 : 1.7;
    if (!studio) M_WATER.color.set(day ? 0x1f8a90 : M_WATER.userData.orig ? M_WATER.userData.orig.color : 0x0b2a30);
    if (!studio) { const asph = day ? 0xd9dad5 : 0x9a9fa3; if (M_ASPHALT.map) M_ASPHALT.color.set(asph); M_ASPHALT.roughness = day ? 0.85 : 0.42; }
    for (const l of lampLights) l.visible = !studio && !day; for (const s of lampSprites) s.visible = !studio && !day;
    relayLight.visible = !studio && !day; rain.visible = !studio && !day && !reducedMotion;
    for (const m of [M_LIT]) m.emissiveIntensity = studio ? 0 : day ? 0.25 : (m.userData.orig ? m.userData.orig.emissiveIntensity : 1.8);
    fogMat.color.set(studio ? 0x8c9399 : day ? 0x31414c : 0x05080b); fogMat.opacity = studio ? 0.45 : day ? 0.5 : 0.66;
    scene.userData.fogNear = scene.fog && scene.fog.isFog ? scene.fog.near : 0; scene.userData.fogFar = scene.fog && scene.fog.isFog ? scene.fog.far : 0;
    gridMat.color.set(studio ? 0x2a3136 : day ? 0x1fb6c6 : 0x5fe6f2); gridMat.opacity = studio ? 0.28 : day ? 0.5 : 0.42; gridMajor.color.set(studio ? 0x0e1113 : day ? 0x0b8fa0 : 0x9ff3fb); gridMajor.opacity = studio ? 0.5 : day ? 0.8 : 0.7;
    if (bloomPass) bloomPass.enabled = !studio && !day;
    if (day) for (const m of [M_CONC, M_CORR, M_ROOF, M_GRATE]) m.color.set(m === M_ROOF ? 0xf3f3ef : 0xeeeeea); // white industrial by day
    const ov = OVER[curLook];
    reachMesh.material.color.set(ov.reach); reachEdge.material.color.set(ov.reach); pathMesh.material.color.set(ov.path);
    pathLine.material.color.set(ov.line); destFrame.material.color.set(ov.dest);
    targetRing.material.color.set(TEAMS[curLook].THREAT);
    beacon.material.color.set(studio ? 0x0e1113 : 0xffb547);
    recolorTeams(); needs = true;
  }

  /* ---------- deferred loading: PBR, HDR, post, models ---------- */
  let destroyed = false;
  async function loadPBR() {
    const tl = new THREE.TextureLoader(), cache = {};
    const tex = (name, srgb) => { const t = tl.load(new URL('pbr/' + name + '.jpg', PBR_ROOT).href, () => { needs = true; }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const setOf = (set) => cache[set] || (cache[set] = { map: tex(set + '_diff', true), normalMap: tex(set + '_nor_gl', false), roughnessMap: tex(set + '_rough', false) });
    const probe = await fetch(new URL('pbr/asphalt_02_diff.jpg', PBR_ROOT), { method: 'HEAD' }).catch(() => null);
    if (!probe || !probe.ok || destroyed) return;
    for (const m of pbrQueue) {
      const spec = m.userData.pbr, base = setOf(spec.set);
      for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = base[k].clone(); if (spec.repeat) t.repeat.set(spec.repeat[0], spec.repeat[1]); m[k] = t; }
      if (spec.tint) m.color.set(spec.tint); else m.color.set(0xffffff);
      m.userData.orig = null; // re-capture the field look with the photographed maps
    }
    // the yard reads wet: glossier than the scan, so the lamps and the sky shine in it
    applyLook(curLook);
  }
  async function loadEnv() {
    try {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      if (destroyed) return;
      const pm = new THREE.PMREMGenerator(renderer);
      studioEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      {
        const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
        const hdr = await new HDRLoader().loadAsync(new URL('hdri/courtyard_night_1k.hdr', PBR_ROOT).href);
        if (destroyed) return;
        hdr.mapping = THREE.EquirectangularReflectionMapping; hdrTex = hdr;
        fieldEnv = pm.fromEquirectangular(hdr).texture;
      }
      pm.dispose(); applyLook(curLook);
    } catch (e) { /* lights alone still light both looks */ }
  }
  async function loadFx() {
    if (tier === 'low') return;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { SMAAPass }, { OutputPass }, gtao] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/SMAAPass.js'),
        import('three/addons/postprocessing/OutputPass.js'), tier === 'high' ? import('three/addons/postprocessing/GTAOPass.js') : Promise.resolve(null)
      ]);
      if (destroyed) return;
      const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
      const c = new EffectComposer(renderer); c.setPixelRatio(renderer.getPixelRatio()); c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (gtao) { const ao = new gtao.GTAOPass(scene, camera, w, h); ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1.1 }); ao.blendIntensity = 0.85; c.addPass(ao); }
      bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.65, 0.55, 0.78); bloomPass.enabled = curLook === 'field'; c.addPass(bloomPass);
      c.addPass(new OutputPass());
      c.addPass(new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio()));
      composer = c; needs = true;
    } catch (e) { composer = null; }
  }
  async function loadModels() {
    try {
      const res = await fetch(new URL('manifest.json', MODEL_ROOT)); if (!res.ok) return;
      const man = await res.json(); const list = Object.entries(man.models || {}); if (!list.length) return;
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      for (const [role, file] of list) { try { glbs[role] = await loader.loadAsync(new URL(file, MODEL_ROOT).href); } catch (e) { /* stand-in stays */ } }
      if (destroyed) return;
      for (const [id, a] of actors) { unitsGroup.remove(a.g); actors.delete(id); }
      if (model) update(model);
    } catch (e) { /* stand-ins */ }
  }

  /* ---------- the White Industrial kit: authored models replace the stand-ins they match ----------
     Each instance is fitted to the footprint and height of the object it stands for, so the rules
     (blockers, cover, heights) stay exactly what the level declares; the kit only changes the look. */
  async function loadKit() {
    try {
      const res = await fetch(new URL('catalog.json', KIT_ROOT)); if (!res.ok) return;
      const cat = await res.json(); if (destroyed) return;
      const byId = Object.fromEntries((cat.assets || []).map((a) => [a.id, a]));
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader(), cache = {};
      const model = async (id) => cache[id] || (cache[id] = loader.loadAsync(new URL(byId[id].model, KIT_ROOT).href).then((g) => g.scene));
      const kitGroup = new THREE.Group(); world.add(kitGroup);
      // place(id, centre x/z, width (x), depth (z), height (world units), base y, yaw)
      const UNIFORM = new Set(['tree-8', 'rock-cluster', 'pipe-stack-6']);
      async function place(id, x, z, w, d, h, y = 0, yaw = 0) {
        if (!byId[id]) return;
        const src = await model(id), a = byId[id], o = src.clone(true);
        const fw = a.footprint?.width || a.width, fd = a.footprint?.depth || a.depth;
        const swap = Math.abs(yaw % Math.PI) > 0.1;
        if (UNIFORM.has(id)) o.scale.setScalar(h / a.height); // organic shapes keep their proportions
        else o.scale.set((swap ? d : w) / fw, h / a.height, (swap ? w : d) / fd);
        o.rotation.y = yaw; o.position.set(x, y, z);
        o.traverse((m) => { if (m.isMesh) { m.castShadow = tier !== 'low'; m.receiveShadow = true; } });
        kitGroup.add(o);
      }
      const jobs = [];
      for (const c of SCENE.containers) { const long = c.w >= c.d; jobs.push(place('container-12', c.x + c.w / 2 - 0.5, c.y + c.d / 2 - 0.5, long ? c.w - 0.05 : c.d - 0.05, long ? c.d - 0.05 : c.w - 0.05, M(c.h), 0, long ? 0 : Math.PI / 2)); }
      for (const b of SCENE.barricades) { const long = b.w >= b.d; jobs.push(place('low-barrier-4', b.x + b.w / 2 - 0.5, b.y + b.d / 2 - 0.5, (long ? b.w : b.d) - 0.04, 0.6, M(1.1), 0, long ? 0 : Math.PI / 2)); }
      for (const c of SCENE.crates) for (let y = c.y; y < c.y + c.d; y += 1) for (let x = c.x; x < c.x + c.w; x += 1) jobs.push(place('crate-2', x, y, 0.92, 0.92, M(1.8)));
      for (const r of SCENE.rooftop || []) jobs.push(place('hvac-3', r.x + r.w / 2 - 0.5, r.y + r.d / 2 - 0.5, r.w - 0.1, r.d - 0.1, M(r.h), surfaceHeight(r.x, r.y, 1)));
      for (const t of SCENE.trees || []) jobs.push(place('tree-8', t.x, t.y, 2.6, 2.6, M(6.5)));
      if (SCENE.relay) jobs.push(place('relay-terminal', SCENE.relay.x, SCENE.relay.y, 0.9, 0.9, M(2.2)));
      // dressing beyond the playable edge only (never on a tile the rules use)
      for (const [id, x, z, w, d, h, yaw] of [['pipe-stack-6', -4, 18, 2, 4, 1.1, 0], ['rock-cluster', 67, 38, 3, 2, 1.1, 0.4], ['rock-cluster', -5, 52, 2.6, 1.7, 0.9, 1.2], ['pipe-stack-6', 68, 12, 2, 4, 1.1, Math.PI / 2], ['tree-8', -6, 30, 2.8, 2.8, 4.2, 0], ['tree-8', 70, 56, 3, 3, 4.6, 0]]) jobs.push(place(id, x, z, w, d, h, 0, yaw));
      await Promise.all(jobs);
      if (destroyed) return;
      for (const g of [proc.container, proc.barrier, proc.crate, proc.hvac, proc.tree]) g.visible = false;
      for (const m of relayGroup.children) if (m !== beacon && !(m.userData && m.userData.overlay)) m.visible = false;
      needs = true;
    } catch (e) { /* the procedural stand-ins stay */ }
  }

  /* ---------- labels ---------- */
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
      let lx = l.x, ly = l.y, lh = (l.h || 0) + surfaceHeight(l.x, l.y, l.z || 0);
      if (l.unit) { const a = actors.get(l.unit); if (a) { lx = a.g.position.x; ly = a.g.position.z; lh = (l.h || 0) + a.g.position.y; } }
      const p = project(lx, ly, lh); if (p.behind) continue;
      html += `<span class="b3-label b3-label--${l.kind}" style="transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)">${l.text}</span>`;
    }
    labels.innerHTML = html + edgeRulers();
  }
  const rayR = new THREE.Raycaster(), ndcR = new THREE.Vector2(), hitR = new THREE.Vector3(), plane0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(px, py, r) { ndcR.set(px / r.width * 2 - 1, -(py / r.height) * 2 + 1); rayR.setFromCamera(ndcR, camera); return rayR.ray.intersectPlane(plane0, hitR) ? hitR.clone() : null; }
  function edgeRulers() {
    if (!rulersOn || showcase) return '';
    const r = renderer.domElement.getBoundingClientRect(); if (r.width < 10) return '';
    let out = '';
    const along = (p0, p1, pick, label, place) => { // walk a screen edge, chip each grid line it crosses
      const a = groundAt(p0[0], p0[1], r), b = groundAt(p1[0], p1[1], r); if (!a || !b) return;
      const va = pick(a), vb = pick(b), lo = Math.ceil(Math.min(va, vb)), hi = Math.floor(Math.max(va, vb));
      const step = Math.max(1, Math.ceil((hi - lo) / 7 / 5) * 5);
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const t = (v - va) / ((vb - va) || 1e-6); const q = a.clone().lerp(b, t); const s2 = project(q.x, q.z, 0); out += place(s2, label(v)); }
    };
    // bottom edge: X values; left edge: Y values (engine x = X + x0, y = y0 − Y)
    along([12, r.height - 30], [r.width - 12, r.height - 30], (q) => q.x + 0 - level.FRAME.x0, (v) => 'X ' + v,
      (s2, t) => s2.x > 60 && s2.x < r.width - 60 ? `<span class="b3-ruler b3-ruler--x" style="transform:translate(${s2.x.toFixed(1)}px,${(r.height - 30).toFixed(1)}px)">${t}</span>` : '');
    along([14, 70], [14, r.height - 70], (q) => level.FRAME.y0 - q.z, (v) => 'Y ' + v,
      (s2, t) => s2.y > 60 && s2.y < r.height - 70 ? `<span class="b3-ruler b3-ruler--y" style="transform:translate(10px,${s2.y.toFixed(1)}px)">${t}</span>` : '');
    return out;
  }

  /* ---------- camera ---------- */
  const HOME = { dist: 44, pitch: 0.86 };
  const view = { dist: HOME.dist, minDist: 9, maxDist: 118, target: new THREE.Vector3(cx, 0, cz), goal: new THREE.Vector3(cx, 0, cz), pitch: HOME.pitch, yaw: 0, yawGoal: 0, distGoal: HOME.dist };
  let shotCam = null;
  const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3();
  function placeCamera() {
    const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); if (composer) composer.setSize(w, h); }
    camera.aspect = w / h; camera.fov = h > w * 1.05 ? 46 : 34; camera.updateProjectionMatrix();
    // zooming out tilts toward a top-down tactical map, so the whole compound fits on a phone
    const zt = Math.min(1, Math.max(0, (view.dist - 44) / (112 - 44))), pitch = view.pitch + (1.3 - view.pitch) * zt * zt * (3 - 2 * zt);
    const hd = Math.cos(pitch) * view.dist;
    camPos.set(view.target.x + Math.sin(view.yaw) * hd, view.target.y + Math.sin(pitch) * view.dist, view.target.z + Math.cos(view.yaw) * hd);
    if (scene.fog && scene.fog.isFog) { scene.fog.near = Math.max(scene.userData.fogNear || 80, view.dist * 0.8 + 40); scene.fog.far = Math.max(scene.userData.fogFar || 200, view.dist * 1.4 + 150); }
    else if (scene.fog && scene.fog.isFogExp2) scene.fog.density = 0.0055 * 44 / Math.max(44, view.dist);
    lookAt.copy(view.target);
    if (shotCam) { const k = shotCam.k * shotCam.k * (3 - 2 * shotCam.k); camPos.lerp(shotCam.from, k); lookAt.lerp(shotCam.look, k); }
    camera.position.copy(camPos); camera.lookAt(lookAt);
  }
  const clampGoal = () => { view.goal.x = Math.min(W + 2, Math.max(-3, view.goal.x)); view.goal.z = Math.min(H + 2, Math.max(-3, view.goal.z)); };
  function focusTile(x, y, z = 0, dist = null) { view.goal.set(x, surfaceHeight(x, y, z) * 0.5, y + 1.5); clampGoal(); if (dist) view.distGoal = dist; needs = true; }

  /* ---------- frame loop ---------- */
  let model = null, needs = true, t0 = performance.now(), active = true, busy = false, raf = 0;
  let rulersOn = true;
  const flashes = []; const fxGroup = new THREE.Group(); scene.add(fxGroup);
  let fireQueue = [], fireAnim = null;
  const lerpAngle = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };
  if (showcase) { view.dist = view.distGoal = 46; view.pitch = 0.62; }
  function frame(now) {
    if (!active) { t0 = now; raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.25, (now - t0) / 1000); t0 = now;
    let moving = false;
    if (showcase && !reducedMotion) { view.yaw = view.yawGoal = 0.4 + Math.sin(now / 1000 * 0.05) * 0.8; moving = true; }
    if (view.target.distanceToSquared(view.goal) > 1e-5) { view.target.lerp(view.goal, reducedMotion ? 1 : 1 - Math.exp(-dt * 6)); moving = true; }
    if (Math.abs(view.dist - view.distGoal) > 1e-3) { view.dist += (view.distGoal - view.dist) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 6)); moving = true; }
    if (Math.abs(view.yaw - view.yawGoal) > 1e-4) { view.yaw = reducedMotion ? view.yawGoal : view.yaw + (view.yawGoal - view.yaw) * (1 - Math.exp(-dt * 7)); moving = true; }
    for (const [id, a] of actors) {
      if (a.walk) {
        const wk = a.walk; wk.t += dt * 3.2;
        const seg = Math.min(wk.pts.length - 2, Math.floor(wk.t)), p0 = wk.pts[seg], p1 = wk.pts[seg + 1], k = Math.min(1, wk.t - seg);
        a.g.position.set(p0.x + (p1.x - p0.x) * k, p0.h + (p1.h - p0.h) * k + 0.02, p0.y + (p1.y - p0.y) * k);
        if (p1.x !== p0.x || p1.y !== p0.y) a.faceGoal = Math.atan2(p1.x - p0.x, p1.y - p0.y);
        a.phase += dt * 10; a.walkAmt = Math.min(1, a.walkAmt + dt * 6);
        if (wk.t >= wk.pts.length - 1) { const e = wk.pts[wk.pts.length - 1]; a.g.position.set(e.x, e.h + 0.02, e.y); a.walk = null; a.faceGoal = a.restFace; const d = wk.done; if (d) d(); }
        moving = true;
      } else if (a.walkAmt > 0) { a.walkAmt = Math.max(0, a.walkAmt - dt * 5); moving = true; }
      if (!a.walk) a.crouch += (a.crouchGoal - a.crouch) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 6));
      a.face = reducedMotion && !a.walk ? a.faceGoal : lerpAngle(a.face, a.faceGoal, 1 - Math.exp(-dt * 9));
      a.g.rotation.y = a.face;
      a.recoil = Math.max(0, a.recoil - dt * 6); a.flinch = Math.max(0, a.flinch - dt * 3);
      if (a.dying) { a.dying.t += dt; const k = Math.min(1, a.dying.t / 0.7); a.g.rotation.x = -k * Math.PI / 2 * 0.92; if (a.dying.t > 1.6 && a.dying.remove) { unitsGroup.remove(a.g); actors.delete(id); } moving = true; }
      if (a.rig && !a.rig.glb) kit.pose(a, now / 1000);
    }
    if (fireAnim || fireQueue.length) { stepFire(dt); moving = true; }
    for (let i = flashes.length - 1; i >= 0; i -= 1) { const f = flashes[i]; f.life -= dt; f.obj.visible = f.life > 0; if (f.update) f.update(f, dt); if (f.life <= 0) { fxGroup.remove(f.obj); flashes.splice(i, 1); } }
    if (!reducedMotion) {
      waterNormal.offset.x += dt * 0.02; waterNormal.offset.y += dt * 0.006;
      beacon.rotation.y += dt * 1.2; if (SCENE.relay) beacon.position.y = M(1.5) + 1.0 + Math.sin(now / 600) * 0.08;
      if (rain.visible) { rain.position.y -= dt * 22; if (rain.position.y < -14) rain.position.y += 14; rain.position.x = view.target.x - cx; rain.position.z = view.target.z - cz; }
      needs = true;
    }
    if (needs || moving || flashes.length) {
      placeCamera();
      if (composer) composer.render(); else renderer.render(scene, camera);
      placeLabels(); needs = false;
      if (onView) onView();
    }
    busy = moving || !!fireAnim || fireQueue.length > 0 || flashes.length > 0;
    if (!destroyed) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => { needs = true; }); ro.observe(host);
  applyLook(curLook);
  loadPBR(); loadEnv(); loadFx(); loadModels(); loadKit();

  /* ---------- shots: a queue, so overwatch volleys and threat turns play in order ---------- */
  function tracer(from, to, color) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
    fxGroup.add(line); flashes.push({ obj: line, life: 0.14, update: (f) => { line.material.opacity = Math.max(0, f.life / 0.14); } });
  }
  function burst(at, color, size, life) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sp.position.copy(at); sp.scale.setScalar(size); fxGroup.add(sp);
    const l = new THREE.PointLight(color, 10, 4, 2); l.position.copy(at); fxGroup.add(l);
    flashes.push({ obj: sp, life, update: (f) => { sp.material.opacity = Math.max(0, f.life / life); } });
    flashes.push({ obj: l, life: life * 0.8, update: (f) => { l.intensity = Math.max(0, 10 * f.life / life); } });
  }
  const wp = new THREE.Vector3();
  function startNextShot() {
    const s = fireQueue.shift(); if (!s) return;
    const a = actors.get(s.attackerId), b = actors.get(s.targetId);
    if (!a || !b || reducedMotion) { if (b && s.result.killed) b.dying = { t: 0, remove: !s.result.downedOnly }; if (s.done) queueMicrotask(s.done); return; }
    const from = a.g.position.clone(), to = b.g.position.clone();
    const face = Math.atan2(to.x - from.x, to.z - from.z);
    const aimAt = new THREE.Vector3(to.x, to.y + M(1.3) - b.crouch * 0.3, to.z);
    const side = new THREE.Vector3(Math.cos(face), 0, -Math.sin(face));
    const shots = [0.5, 0.62, 0.74].map((at, i) => ({ at, done: false, to: s.result.hit ? aimAt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, 0)) : aimAt.clone().addScaledVector(side, (i % 2 ? 1 : -1) * (0.5 + Math.random() * 0.3)).add(new THREE.Vector3(0, 0.2, 0)) }));
    if (s.cinematic) { const back = new THREE.Vector3(Math.sin(face), 0, Math.cos(face)); shotCam = { from: from.clone().addScaledVector(back, -3.2).addScaledVector(side, -1.0).add(new THREE.Vector3(0, M(2.6), 0)), look: from.clone().lerp(aimAt, 0.65).add(new THREE.Vector3(0, 0.2, 0)), k: 0 }; }
    fireAnim = { ...s, from, face, shots, t: 0, len: s.cinematic ? 1.8 : 1.1 };
  }
  function stepFire(dt) {
    if (!fireAnim) { startNextShot(); if (!fireAnim) return; }
    const F = fireAnim; F.t += dt;
    const a = actors.get(F.attackerId), b = actors.get(F.targetId);
    if (a) { a.faceGoal = F.face; a.aim = Math.min(1, a.aim + dt * 5); }
    if (shotCam) shotCam.k = Math.min(1, F.t < F.len - 0.4 ? shotCam.k + dt * 3 : Math.max(0, shotCam.k - dt * 3.2));
    for (const s of F.shots) if (!s.done && F.t >= s.at) {
      s.done = true;
      if (a && a.rig && a.rig.muzzle) { a.rig.muzzle.getWorldPosition(wp); a.recoil = 1; } else wp.set(F.from.x, F.from.y + M(1.4), F.from.z);
      burst(wp.clone(), 0xffc070, 0.6, 0.08); tracer(wp.clone(), s.to, 0xffe2a8);
      if (F.result.hit) { if (b) b.flinch = 1; burst(s.to.clone(), 0xffd08a, 0.3, 0.12); } else burst(s.to.clone(), 0xffa060, 0.2, 0.1);
    }
    if (F.result.killed && b && !b.dying && F.t > F.shots[2].at + 0.1) b.dying = { t: 0, remove: !F.result.downedOnly };
    if (F.t >= F.len) { if (a) { a.aim = 0; a.faceGoal = a.restFace; } shotCam = null; fireAnim = null; needs = true; if (F.done) F.done(); }
  }

  /* ---------- update from the page's board model ---------- */
  function faceFor(u, m) {
    let best = null, bd = Infinity;
    for (const o of m.units) if (!o.dead && o.faction !== u.faction) { const d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y); if (d < bd) { bd = d; best = o; } }
    return best ? Math.atan2(best.x - u.x, best.y - u.y) : (u.faction === 'PLAYER' ? Math.PI : 0);
  }
  let gateKey = null;
  function update(m) {
    model = m;
    if (m.gateOpen !== gateKey) { gateKey = m.gateOpen; gateGroup.visible = !m.gateOpen; }
    const seen = new Set();
    for (const u of m.units) {
      if (u.dead) continue;
      seen.add(u.id);
      let a = actors.get(u.id);
      if (!a) { a = makeActor(u); a.face = faceFor(u, m); a.g.position.set(u.x, surfaceHeight(u.x, u.y, u.z) + 0.02, u.y); actors.set(u.id, a); unitsGroup.add(a.g); }
      const end = a.walk ? a.walk.pts[a.walk.pts.length - 1] : { x: Math.round(a.g.position.x), y: Math.round(a.g.position.z), z: a.unit.z };
      if (end.x !== u.x || end.y !== u.y || (end.z ?? a.unit.z) !== u.z) {
        const path = m.moves && m.moves[u.id];
        if (path && path.length && !reducedMotion) {
          const pts = [{ x: a.g.position.x, y: a.g.position.z, z: a.unit.z, h: a.g.position.y - 0.02 }];
          for (const p of path) { const z = p.z ?? u.z; if (p.x === Math.round(pts[0].x) && p.y === Math.round(pts[0].y) && z === pts[0].z) continue; pts.push({ x: p.x, y: p.y, z, h: surfaceHeight(p.x, p.y, z) }); }
          const last = pts[pts.length - 1]; if (last.x !== u.x || last.y !== u.y) pts.push({ x: u.x, y: u.y, z: u.z, h: surfaceHeight(u.x, u.y, u.z) });
          a.walk = { pts, t: 0 };
        } else { a.walk = null; a.g.position.set(u.x, surfaceHeight(u.x, u.y, u.z) + 0.02, u.y); }
      }
      a.unit = u;
      a.crouchGoal = u.downed ? 1 : (m.coverAt && m.coverAt(u) ? (m.coverAt(u) === 'LOW' ? 1 : 0.25) : 0);
      if (u.downed && !a.dying) a.dying = { t: 0, remove: false };
      if (!u.downed && a.dying && !a.dying.remove) { a.dying = null; a.g.rotation.x = 0; }
      a.restFace = faceFor(u, m);
      if (!a.walk && !(fireAnim && fireAnim.attackerId === u.id)) a.faceGoal = a.restFace;
    }
    for (const [id, a] of actors) if (!seen.has(id) && !a.dying && !(fireAnim && fireAnim.targetId === id) && !fireQueue.some((s) => s.targetId === id)) { unitsGroup.remove(a.g); actors.delete(id); }
    fillTiles(reachMesh, m.reach); fillTiles(reachEdge, m.reach, 0.025); fillTiles(pathMesh, m.path, 0.04); fillTiles(hintMesh, m.hint ? [m.hint] : [], 0.045);
    destFrame.visible = !!m.dest; if (m.dest) destFrame.position.set(m.dest.x, surfaceHeight(m.dest.x, m.dest.y, m.dest.z || 0) + 0.06, m.dest.y);
    targetRing.visible = !!m.target; if (m.target) { const t = m.units.find((u) => u.id === m.target); if (t) targetRing.position.set(t.x, surfaceHeight(t.x, t.y, t.z) + 0.05, t.y); else targetRing.visible = false; }
    if (m.pathLine && m.pathLine.length > 1) {
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(m.pathLine.map((p) => new THREE.Vector3(p.x, surfaceHeight(p.x, p.y, p.z || 0) + 0.09, p.y)));
      pathLine.computeLineDistances(); pathLine.visible = true;
    } else pathLine.visible = false;
    const sel = m.units.find((u) => u.id === m.selected && !u.dead);
    for (const [id, a] of actors) { if (!a.rig || !a.rig.halo) continue; const on = !!sel && id === sel.id;
      a.rig.halo.material.opacity = on ? 1 : 0.5; if (a.rig.accent) a.rig.accent.emissiveIntensity = on ? 3.2 : 1.2; }
    labelSpecs = (m.labels || []).map((l) => (l.kind === 'ally' || l.kind === 'hostile') && l.id ? { ...l, unit: l.id } : l);
    needs = true;
  }

  /* ---------- input: tap → tile (roofs first); drag → pan; pinch/wheel → zoom ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function tileAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    placeCamera(); ray.setFromCamera(ndc, camera);
    const bodies = ray.intersectObjects(unitsGroup.children, true);
    if (bodies.length) { let o = bodies[0].object; while (o && !o.userData.unitId) o = o.parent; const a = o && actors.get(o.userData.unitId); if (a) return { x: a.unit.x, y: a.unit.y, z: a.unit.z, unitId: a.unit.id }; }
    const rh = ray.intersectObjects(roofs, false);
    if (rh.length) { const p = rh[0].point; const x = Math.round(p.x), y = Math.round(p.z); if (surfaceHeight(x, y, 1) > 0) return { x, y, z: 1 }; }
    if (!ray.ray.intersectPlane(ground, hit)) return null;
    const x = Math.round(hit.x), y = Math.round(hit.z);
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y, z: 0 } : null;
  }
  const pointers = new Map(); let pinch = null, pan = null, moved = false;
  const el = renderer.domElement;
  if (!showcase) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.distGoal }; pan = null; }
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
          const k = view.dist / 520, cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
          view.goal.set(pan.tx - dx * k * cyw - dy * k * 1.3 * syw, view.goal.y, pan.tz + dx * k * syw - dy * k * 1.3 * cyw); clampGoal();
          view.target.copy(view.goal); needs = true;
        }
      }
    });
    const end = (e) => {
      const wasTap = pointers.size === 1 && !moved;
      pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) pan = null;
      if (wasTap && e.type === 'pointerup' && !fireAnim && !fireQueue.length) { const t = tileAt(e.clientX, e.clientY); if (t) onTap(t); }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); setDist(view.distGoal * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
  }
  function setDist(d) { view.distGoal = Math.min(view.maxDist, Math.max(view.minDist, d)); needs = true; }

  return {
    update, tier,
    get look() { return curLook; },
    setLook(lk) { applyLook(lk); },
    setGrid(on) { gridGroup.visible = !!on; rulersOn = !!on; needs = true; },
    get gridOn() { return gridGroup.visible; },
    setActive(on) { active = !!on; needs = true; },
    zoom(step) { setDist(view.distGoal * (step > 0 ? 0.8 : 1.25)); },
    zoomLevel() { return view.dist; },
    canZoom() { return { in: view.distGoal > view.minDist + 0.01, out: view.distGoal < view.maxDist - 0.01 }; },
    rotate(step) { view.yawGoal += (step > 0 ? 1 : -1) * Math.PI / 2; needs = true; busy = true; },
    resetView() { view.distGoal = HOME.dist; view.yawGoal = 0; needs = true; },
    overview() { view.goal.set(cx - 0.5, 0, cz - 0.5); view.distGoal = view.maxDist - 4; needs = true; },
    // fog of war from the page: alpha per tile, 0 = seen now, 1 = never seen (engine y rows)
    setFog(cells) { fogOn = !!cells; fogPlane.visible = fogOn; if (cells) { for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) fogData[((H - 1 - y) * W + x) * 4 + 1] = Math.round(255 * cells[y * W + x]); fogTex.needsUpdate = true; } needs = true; },
    focus(x, y, z = 0, dist = 24) { focusTile(x, y, z, dist); },
    // play shots the engine already resolved, in order; done() when this one has played
    fire(attackerId, targetId, result, done, { cinematic = true } = {}) { fireQueue.push({ attackerId, targetId, result: result || {}, done, cinematic }); needs = true; },
    // walk a unit along a path the engine already resolved; done() at the end
    walk(id, path, done) { const a = actors.get(id); if (!a || reducedMotion || !path || !path.length) { if (done) queueMicrotask(done); return; }
      const pts = [{ x: a.g.position.x, y: a.g.position.z, z: a.unit.z, h: a.g.position.y - 0.02 }, ...path.map((p) => ({ x: p.x, y: p.y, z: p.z || 0, h: surfaceHeight(p.x, p.y, p.z || 0) }))];
      a.walk = { pts, t: 0, done }; },
    isAnimating() { return busy || !!fireAnim || fireQueue.length > 0 || [...actors.values()].some((a) => a.walk || (a.dying && a.dying.remove)); },
    unitPosition(id) { const a = actors.get(id); return a ? { x: a.g.position.x, y: a.g.position.z, h: a.g.position.y } : null; },
    screenOf(x, y, h = 0, z = 0) { placeCamera(); const p = project(x, y, h + surfaceHeight(x, y, z)); const r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    tileAt,
    surfaceHeight,
    destroy() { destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); if (composer) composer.dispose(); renderer.dispose(); host.innerHTML = ''; }
  };
}
