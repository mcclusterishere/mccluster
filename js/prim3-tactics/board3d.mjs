/* PRIM3 tactical board — 3D view (three.js 0.180.0, the version the repo's 3D pages already load).

   A renderer only: it draws the board model the page gives it and reports which tile was tapped.
   Rules, legality, hints and fog of war stay in tactical-resolver.mjs / tactical-hints.mjs.
   World mapping is the engine's grid: tile (x, y) sits at world X = x, Z = y (engine +y = south,
   toward the camera), Y is up. One tile = 1 world unit. Nothing hidden is ever passed in. */
import * as THREE from 'three';

const C = {
  tile: 0x4a5056, tileAlt: 0x434950, grout: 0x10161a, grid: 0x5fd7e6,
  brick: 0x6b3b2c, brickTop: 0x3c2a24, concrete: 0x7c7f80, planter: 0x5e6366, leaf: 0x3e5a2c,
  cyan: 0x36d6e7, amber: 0xffb547, hostile: 0xff5d6a, skin: 0x8a6448, suit: 0x2c333b, relay: 0x3a3f44
};
const ROLE = { E: 0x7fe3ee, R: 0xb9e98a, T: 0xffcf7a };

export function createBoard3D(host, { width, height, onTap, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.domElement.className = 'b3-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);
  const labels = document.createElement('div'); labels.className = 'b3-labels'; host.appendChild(labels);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1015);
  scene.fog = new THREE.Fog(0x0b1015, 22, 42);
  const cx = (width - 1) / 2, cz = (height - 1) / 2;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const view = { dist: 19.5, minDist: 8, maxDist: 26, target: new THREE.Vector3(cx, 0, cz + 0.9), pitch: 1.14 };

  // light: warm low sun + cool sky fill, soft shadows
  scene.add(new THREE.HemisphereLight(0xb8d8e6, 0x3a2a1e, 1.25));
  const sun = new THREE.DirectionalLight(0xffd2a0, 2.2);
  sun.position.set(cx - 7, 11, cz - 6); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0008; scene.add(sun, sun.target);
  const lamp = new THREE.PointLight(0xffa860, 6, 7, 1.6); lamp.position.set(cx - 2.5, 2.2, -1.4); scene.add(lamp);

  // ground: wet stone tiles with grout, a margin of plaza and a back wall
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(width + 8, height + 8), new THREE.MeshStandardMaterial({ color: 0x1a1f22, roughness: 0.55, metalness: 0.15 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(cx, -0.02, cz); plaza.receiveShadow = true; scene.add(plaza);
  const tileGeo = new THREE.BoxGeometry(0.96, 0.06, 0.96);
  const tileMats = [new THREE.MeshStandardMaterial({ color: C.tile, roughness: 0.42, metalness: 0.2 }), new THREE.MeshStandardMaterial({ color: C.tileAlt, roughness: 0.5, metalness: 0.18 })];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const t = new THREE.Mesh(tileGeo, tileMats[(x + y) % 2]); t.position.set(x, 0, y); t.receiveShadow = true; scene.add(t);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(width + 4, 4.2, 0.6), new THREE.MeshStandardMaterial({ color: C.brick, roughness: 0.85 }));
  back.position.set(cx, 2.1, -1.6); back.receiveShadow = true; scene.add(back);
  // grid lines (readable square grid over the scene)
  const gp = [];
  for (let x = 0; x <= width; x += 1) gp.push(x - 0.5, 0.04, -0.5, x - 0.5, 0.04, height - 0.5);
  for (let y = 0; y <= height; y += 1) gp.push(-0.5, 0.04, y - 0.5, width - 0.5, 0.04, y - 0.5);
  const gridGeo = new THREE.BufferGeometry(); gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.16 })));

  // per-tile overlays (reach / path / dest / hint / runs), shown or hidden by update()
  const overlayGeo = new THREE.PlaneGeometry(0.92, 0.92); overlayGeo.rotateX(-Math.PI / 2);
  const mats = {
    reach: new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.22, depthWrite: false }),
    path: new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.28, depthWrite: false }),
    runx: new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.4, depthWrite: false }),
    runy: new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.4, depthWrite: false })
  };
  const overlays = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const m = new THREE.Mesh(overlayGeo, mats.reach); m.position.set(x, 0.045, y); m.visible = false; m.renderOrder = 2; scene.add(m); overlays.push(m);
  }
  const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.02, 0.9));
  const destFrame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: C.amber })); destFrame.visible = false; scene.add(destFrame);
  const hintFrame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: C.amber })); hintFrame.visible = false; scene.add(hintFrame);
  const ringGeo = new THREE.TorusGeometry(0.36, 0.035, 8, 40); ringGeo.rotateX(Math.PI / 2);
  const selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C.cyan })); selRing.visible = false; scene.add(selRing);
  const originRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C.cyan })); originRing.visible = false; scene.add(originRing);
  const targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C.amber })); targetRing.visible = false; scene.add(targetRing);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.amber })); pathLine.visible = false; scene.add(pathLine);

  // static props, built once from the first model (walls, cover, objective)
  const props = new THREE.Group(); scene.add(props);
  const unitsGroup = new THREE.Group(); scene.add(unitsGroup);
  const unitMeshes = new Map();
  const relayGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 1.4 }));
  let propsKey = '';

  function buildProps(m) {
    props.clear();
    for (const b of m.blockers) { // walls: brick pillars with a cap
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.5, 0.98), new THREE.MeshStandardMaterial({ color: C.brick, roughness: 0.9 }));
      wall.position.set(b.x, 0.75, b.y); wall.castShadow = wall.receiveShadow = true; props.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 1.02), new THREE.MeshStandardMaterial({ color: C.brickTop, roughness: 0.6 }));
      cap.position.set(b.x, 1.54, b.y); cap.castShadow = true; props.add(cap);
    }
    for (const c of m.cover) { // cover: a slab on each protected side; high = taller
      const h = c.type === 'HIGH' ? 1.05 : 0.5;
      for (const s of c.sides) {
        const along = s === 'N' || s === 'S';
        const g = new THREE.BoxGeometry(along ? 0.92 : 0.2, h, along ? 0.2 : 0.92);
        const slab = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: c.type === 'HIGH' ? C.concrete : C.planter, roughness: 0.8 }));
        const off = 0.38; slab.position.set(c.x + (s === 'E' ? off : s === 'W' ? -off : 0), h / 2 + 0.03, c.y + (s === 'S' ? off : s === 'N' ? -off : 0));
        slab.castShadow = slab.receiveShadow = true; props.add(slab);
        if (c.type === 'LOW') { // planter greenery on low cover
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: C.leaf, roughness: 1 }));
          leaf.position.set(slab.position.x, h + 0.08, slab.position.z); leaf.scale.set(along ? 2.4 : 0.9, 0.7, along ? 0.9 : 2.4); leaf.castShadow = true; props.add(leaf);
        }
      }
    }
    for (const t of m.objectiveTiles) { // relay: a cabinet with an antenna and a glowing marker
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.5), new THREE.MeshStandardMaterial({ color: C.relay, roughness: 0.4, metalness: 0.6 }));
      cab.position.set(t.x, 0.4, t.y); cab.castShadow = true; props.add(cab);
      const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshBasicMaterial({ color: C.amber })); vent.position.set(t.x, 0.42, t.y + 0.252); props.add(vent);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7), new THREE.MeshStandardMaterial({ color: 0x222222 })); ant.position.set(t.x + 0.15, 1.1, t.y - 0.1); props.add(ant);
      relayGem.position.set(t.x, 1.25, t.y); props.add(relayGem);
      const glow = new THREE.PointLight(C.amber, 3, 2.6, 2); glow.position.set(t.x, 1.1, t.y); props.add(glow);
    }
  }

  function figure(u) { // a stylized operative: legs, torso, role-coloured band, head, kit
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: C.suit, roughness: 0.7 });
    const band = new THREE.MeshStandardMaterial({ color: u.faction === 'PLAYER' ? (ROLE[u.role] || C.cyan) : C.hostile, emissive: u.faction === 'PLAYER' ? (ROLE[u.role] || C.cyan) : C.hostile, emissiveIntensity: 0.8 });
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.42, 10), suit); legs.position.y = 0.24;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 4, 12), suit); torso.position.y = 0.66;
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.1, 12), band); vest.position.y = 0.62;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.6 })); head.position.y = 1.0;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.1), suit); pack.position.set(0, 0.7, -0.17);
    for (const p of [legs, torso, vest, head, pack]) { p.castShadow = true; g.add(p); }
    g.scale.setScalar(1.35);
    g.userData.unitId = u.id;
    return g;
  }

  // ---------- labels (DOM, projected each frame: crisp text, never inside the WebGL canvas) ----------
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
      const p = project(l.x, l.y, l.h || 0);
      if (p.behind) continue;
      html += `<span class="b3-label b3-label--${l.kind}" style="transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)">${l.text}</span>`;
    }
    labels.innerHTML = html;
  }

  // ---------- camera ----------
  function placeCamera() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const portrait = h > w * 1.05;
    camera.fov = portrait ? 44 : 32;
    camera.updateProjectionMatrix();
    camera.position.set(view.target.x, view.target.y + Math.sin(view.pitch) * view.dist, view.target.z + Math.cos(view.pitch) * view.dist);
    camera.lookAt(view.target);
  }

  let model = null, needs = true, t0 = performance.now();
  function frame(now) {
    const dt = (now - t0) / 1000; t0 = now;
    if (!reducedMotion && model) {
      relayGem.rotation.y += dt * 1.2; relayGem.position.y = 1.25 + Math.sin(now / 600) * 0.05;
      selRing.scale.setScalar(1 + Math.sin(now / 320) * 0.06);
      needs = true;
    }
    if (needs) { placeCamera(); renderer.render(scene, camera); placeLabels(); needs = false; }
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => { needs = true; }); ro.observe(host);

  // ---------- update from the page's board model ----------
  function update(m) {
    model = m;
    const key = JSON.stringify([m.blockers, m.cover, m.objectiveTiles]);
    if (key !== propsKey) { buildProps(m); propsKey = key; }
    // units
    const seen = new Set();
    for (const u of m.units) {
      if (u.dead) continue;
      seen.add(u.id);
      let g = unitMeshes.get(u.id);
      if (!g) { g = figure(u); unitMeshes.set(u.id, g); unitsGroup.add(g); }
      g.position.set(u.x, 0.03, u.y);
      g.rotation.y = u.faction === 'PLAYER' ? Math.PI * 0.85 : -Math.PI * 0.15;
    }
    for (const [id, g] of unitMeshes) if (!seen.has(id)) { unitsGroup.remove(g); unitMeshes.delete(id); }
    // overlays
    for (const o of overlays) o.visible = false;
    const at = (x, y) => overlays[y * width + x];
    for (const t of m.reach || []) { const o = at(t.x, t.y); o.material = mats.reach; o.visible = true; }
    for (const t of m.path || []) { const o = at(t.x, t.y); o.material = mats.path; o.visible = true; }
    for (const t of m.runs || []) { const o = at(t.x, t.y); o.material = t.axis === 'x' ? mats.runx : mats.runy; o.visible = true; }
    destFrame.visible = !!m.dest; if (m.dest) destFrame.position.set(m.dest.x, 0.06, m.dest.y);
    hintFrame.visible = !!m.hint; if (m.hint) hintFrame.position.set(m.hint.x, 0.07, m.hint.y);
    const sel = m.units.find((u) => u.id === m.selected);
    selRing.visible = !!sel; if (sel) selRing.position.set(sel.x, 0.06, sel.y);
    originRing.visible = !!m.origin; if (m.origin) originRing.position.set(m.origin.x, 0.07, m.origin.y);
    targetRing.visible = !!m.target; if (m.target) targetRing.position.set(m.target.x, 0.07, m.target.y);
    if (m.pathLine && m.pathLine.length > 1) {
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(m.pathLine.map((p) => new THREE.Vector3(p.x, 0.09, p.y)));
      pathLine.visible = true;
    } else pathLine.visible = false;
    labelSpecs = m.labels || [];
    needs = true;
  }

  // ---------- input: tap → tile; drag → pan; pinch/wheel → zoom ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function tileAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // a tap on an operative selects its tile, even when the body hides the floor
    const bodies = ray.intersectObjects(unitsGroup.children, true);
    if (bodies.length) { let o = bodies[0].object; while (o && !o.userData.unitId) o = o.parent; if (o) { const p = o.position; return { x: Math.round(p.x), y: Math.round(p.z) }; } }
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
    else pan = { x: e.clientX, y: e.clientY, tx: view.target.x, tz: view.target.z };
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) { const [a, b] = [...pointers.values()]; setDist(pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))); moved = true; return; }
    if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) {
        moved = true;
        const k = view.dist / 600;
        view.target.x = Math.min(width, Math.max(-1, pan.tx - dx * k));
        view.target.z = Math.min(height + 1, Math.max(-1, pan.tz - dy * k * 1.3));
        needs = true;
      }
    }
  });
  const end = (e) => {
    const wasTap = pointers.size === 1 && !moved;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) pan = null;
    if (wasTap && e.type === 'pointerup') { const t = tileAt(e.clientX, e.clientY); if (t) onTap(t.x, t.y); }
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); setDist(view.dist * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
  function setDist(d) { view.dist = Math.min(view.maxDist, Math.max(view.minDist, d)); needs = true; }

  return {
    update,
    zoom(step) { setDist(view.dist * (step > 0 ? 0.82 : 1.22)); },
    zoomLevel() { return view.dist; },
    canZoom() { return { in: view.dist > view.minDist + 0.01, out: view.dist < view.maxDist - 0.01 }; },
    resetView() { view.dist = 19.5; view.target.set(cx, 0, cz + 0.9); needs = true; },
    // test/accessibility hook: where a tile's centre is on screen right now (client coordinates)
    screenOf(x, y, h = 0) { placeCamera(); const p = project(x, y, h); const r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    tileAt,
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); host.innerHTML = ''; }
  };
}
