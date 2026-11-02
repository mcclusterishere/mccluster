/* PRIM3 tactics — 3D main menu scene (three.js 0.180.0).

   Soft, glossy "toy" models rebuilt in code, after the style of reference packs the owner supplied
   on 2026-11-02 (a fighter jet, a battle tank, an excavator, a VR operator, a room-scale VR frame; then a
   quadcopter, a helicopter and trucks).
   The reference files are not copied, loaded or shipped. Everything here is primitives, so no
   third-party file is redistributed and nothing has to be downloaded.

   A recon drone and a utility helicopter (after the second reference pack) fly around the scene.
   Each menu choice has a toy on the pedestal:
     continue → jet
     new      → tank
     training → VR operator
     graphics → excavator
   The room-scale frame turns around the focused toy. show(key) swaps the toy with a pop; play(key)
   runs that toy's launch animation, then calls done. The scene only decorates the menu: every
   choice is a real button in the page, and the menu still works with no WebGL at all. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const toy = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.22, ...o });
const P = {
  green: 0x2f9e78, green2: 0x47b58d, green3: 0x1f7a5c, mint: 0xcff2e2, white: 0xf3f5f4, grey: 0xb9c2c6,
  black: 0x15181b, yellow: 0xf2c55c, yellow2: 0xe0ac3c, skin: 0xf0c4a0, purple: 0x8b45f5, violet: 0xb06bff,
  shirt: 0x7d8dff, pink: 0xe86bff, cyan: 0x5ff2d6
};

function rbox(w, h, d, r, mat) { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), mat); m.castShadow = true; return m; }
function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; }
function at(o, x, y, z) { o.position.set(x, y, z); return o; }

/* ---------- the toys ---------- */
function buildJet() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const green = toy(P.green), light = toy(P.green2), white = toy(P.white), grey = toy(P.grey, { metalness: 0.3 });
  const fus = mesh(new THREE.CapsuleGeometry(0.34, 2.0, 8, 24), green); fus.rotation.z = Math.PI / 2; body.add(fus);
  const nose = at(mesh(new THREE.ConeGeometry(0.33, 0.8, 24), white), 1.55, 0, 0); nose.rotation.z = -Math.PI / 2; body.add(nose);
  const canopy = at(mesh(new THREE.SphereGeometry(0.3, 24, 16), toy(P.black, { roughness: 0.05, clearcoatRoughness: 0.02 })), 0.75, 0.25, 0); canopy.scale.set(1.5, 0.8, 0.8); body.add(canopy);
  const wingShape = new THREE.Shape(); wingShape.moveTo(0.5, 0); wingShape.lineTo(-0.7, 1.45); wingShape.lineTo(-1.05, 1.45); wingShape.lineTo(-0.75, 0); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3 });
  for (const s of [1, -1]) {
    const w = mesh(wingGeo, light); w.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2; w.position.set(0, -0.05, s * 0.04 * -1); body.add(w);
    const tail = mesh(new THREE.ExtrudeGeometry((() => { const t = new THREE.Shape(); t.moveTo(0, 0); t.lineTo(-0.45, 0.55); t.lineTo(-0.62, 0.55); t.lineTo(-0.5, 0); t.closePath(); return t; })(), { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }), light);
    tail.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2; tail.position.set(-0.85, 0.02, 0); body.add(tail);
  }
  const fin = mesh(new THREE.ExtrudeGeometry((() => { const t = new THREE.Shape(); t.moveTo(0, 0); t.lineTo(-0.5, 0.7); t.lineTo(-0.72, 0.7); t.lineTo(-0.6, 0); t.closePath(); return t; })(), { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }), green);
  fin.position.set(-0.75, 0.2, -0.035); body.add(fin);
  for (const s of [1, -1]) { const pod = at(mesh(new THREE.CapsuleGeometry(0.09, 0.5, 6, 12), white), 0.05, -0.12, s * 0.75); pod.rotation.z = Math.PI / 2; body.add(pod); }
  const nozzle = at(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 24), grey), -1.4, 0, 0); nozzle.rotation.z = Math.PI / 2; body.add(nozzle);
  const flame = at(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 20), new THREE.MeshBasicMaterial({ color: 0x9ff5ff, transparent: true, opacity: 0.8, toneMapped: false })), -1.85, 0, 0); flame.rotation.z = Math.PI / 2; body.add(flame);
  body.rotation.y = -0.5; body.scale.setScalar(0.85);
  return { g, tick(t, s) { body.position.y = 1.15 + Math.sin(t * 1.8) * 0.12; body.rotation.x = Math.sin(t * 1.2) * 0.12; flame.scale.set(1, 0.8 + Math.sin(t * 40) * 0.15 + s.boost * 2, 1); flame.position.x = -1.85 - s.boost * 0.7;
    if (s.launch > 0) { const k = s.launch; body.position.x = k * k * 9; body.position.y += k * k * 4; body.rotation.z = k * 0.6; } else { body.position.x = 0; body.rotation.z = Math.sin(t * 0.9) * 0.08 + 0.15; } } };
}

function buildTank() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const green = toy(P.green), light = toy(P.green2), dark = toy(P.green3), mint = toy(P.mint);
  body.add(at(rbox(2.3, 0.5, 1.35, 0.18, green), 0, 0.62, 0));
  body.add(at(rbox(1.8, 0.28, 1.05, 0.12, light), -0.05, 0.92, 0));
  const wheels = [];
  for (const s of [1, -1]) {
    body.add(at(rbox(2.6, 0.62, 0.42, 0.3, dark), 0, 0.36, s * 0.78));
    for (let i = 0; i < 3; i += 1) { const w = at(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 28), mint), -0.72 + i * 0.72, 0.36, s * 1.0); w.rotation.x = Math.PI / 2; body.add(w); wheels.push(w);
      const hub = at(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 16), light), -0.72 + i * 0.72, 0.36, s * 1.01); hub.rotation.x = Math.PI / 2; body.add(hub); }
    for (let i = 0; i < 14; i += 1) body.add(at(rbox(0.1, 0.07, 0.44, 0.03, dark), -1.25 + i * 0.19, 0.04, s * 0.78));
  }
  const turret = new THREE.Group(); turret.position.set(-0.1, 1.06, 0); body.add(turret);
  const dome = mesh(new THREE.SphereGeometry(0.62, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), green); dome.scale.set(1.1, 0.75, 0.95); turret.add(dome);
  turret.add(at(mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 24), light), -0.1, 0.5, 0));
  const barrel = new THREE.Group(); barrel.position.set(0.55, 0.22, 0); turret.add(barrel);
  const tube = at(mesh(new THREE.CylinderGeometry(0.075, 0.085, 1.5, 20), light), 0.75, 0, 0); tube.rotation.z = Math.PI / 2; barrel.add(tube);
  const tip = at(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 20), dark), 1.5, 0, 0); tip.rotation.z = Math.PI / 2; barrel.add(tip);
  const flash = at(new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0, toneMapped: false })), 1.75, 0, 0); barrel.add(flash);
  const puffs = [0, 1, 2].map(() => { const p = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), toy(P.white, { transparent: true, opacity: 0 })); barrel.add(p); return p; });
  body.rotation.y = -0.55; body.scale.setScalar(0.8);
  return { g, tick(t, s) {
    turret.rotation.y = Math.sin(t * 0.7) * 0.5; barrel.rotation.z = 0.08 + Math.sin(t * 0.5) * 0.05;
    for (const w of wheels) w.rotation.y = t * 1.5;
    body.position.y = Math.abs(Math.sin(t * 3)) * 0.02;
    const f = s.launch > 0 ? Math.max(0, 1 - Math.abs(s.launch - 0.25) * 6) : 0;
    flash.material.opacity = f; flash.scale.setScalar(0.6 + f);
    barrel.position.x = 0.55 - f * 0.18;
    puffs.forEach((p, i) => { const k = Math.max(0, s.launch - 0.25 - i * 0.05); p.position.set(1.8 + k * 3, k * 0.8, (i - 1) * k * 0.8); p.scale.setScalar(0.5 + k * 3); p.material.opacity = k > 0 ? Math.max(0, 0.9 - k * 1.3) : 0; });
    if (s.launch > 0.45) { body.position.x = -(s.launch - 0.45) * 1.2; } else body.position.x = 0;
  } };
}

function buildExcavator() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const y = toy(P.yellow), y2 = toy(P.yellow2), k = toy(0x2a2d31, { clearcoat: 0.4 }), glass = toy(0x26313a, { roughness: 0.05 });
  for (const s of [1, -1]) {
    body.add(at(rbox(2.0, 0.42, 0.42, 0.2, k), 0, 0.22, s * 0.62));
    for (let i = 0; i < 4; i += 1) { const r = at(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.44, 16), toy(0x4a4e53)), -0.66 + i * 0.44, 0.2, s * 0.62); r.rotation.x = Math.PI / 2; body.add(r); }
  }
  body.add(at(rbox(1.2, 0.18, 1.0, 0.06, k), 0, 0.5, 0));
  const deck = new THREE.Group(); deck.position.y = 0.58; body.add(deck);
  deck.add(at(rbox(1.7, 0.45, 1.2, 0.12, y), -0.15, 0.25, 0));
  const cab = at(rbox(0.7, 0.75, 0.62, 0.1, y), 0.28, 0.82, 0.25); deck.add(cab);
  deck.add(at(rbox(0.72, 0.5, 0.5, 0.08, glass), 0.32, 0.88, 0.27));
  deck.add(at(rbox(0.7, 0.5, 0.95, 0.12, y2), -0.65, 0.68, -0.08));
  deck.add(at(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 10), k), -0.85, 1.05, -0.3));
  const boom = new THREE.Group(); boom.position.set(0.45, 0.55, -0.2); deck.add(boom);
  const boomArm = at(rbox(1.6, 0.22, 0.2, 0.08, y), 0.7, 0, 0); boom.add(boomArm);
  const stick = new THREE.Group(); stick.position.set(1.45, 0, 0); boom.add(stick);
  stick.add(at(rbox(0.22, 1.1, 0.18, 0.07, y), 0, -0.5, 0));
  const bucket = new THREE.Group(); bucket.position.set(0, -1.05, 0); stick.add(bucket);
  const bShape = new THREE.Shape(); bShape.moveTo(0, 0); bShape.quadraticCurveTo(0.45, -0.05, 0.42, -0.42); bShape.lineTo(0.05, -0.3); bShape.closePath();
  const bk = mesh(new THREE.ExtrudeGeometry(bShape, { depth: 0.4, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }), y2); bk.position.z = -0.2; bucket.add(bk);
  const dirt = at(mesh(new THREE.DodecahedronGeometry(0.16, 0), toy(0x8a6b4a, { clearcoat: 0 })), 0.22, -0.12, 0); dirt.visible = false; bucket.add(dirt);
  body.rotation.y = -0.7; body.scale.setScalar(0.82); body.position.x = -0.3;
  return { g, tick(t, s) { // dig cycle: lower, curl, lift, swing, dump
    const sp = s.launch > 0 ? 3 : 1, c = (t * 0.45 * sp) % 1;
    const lower = Math.sin(Math.min(1, c / 0.35) * Math.PI / 2), lift = c > 0.45 ? Math.min(1, (c - 0.45) / 0.2) : 0;
    boom.rotation.z = 0.55 - lower * 0.75 + lift * 0.7;
    stick.rotation.z = -0.2 - lower * 0.5 + (c > 0.35 ? Math.min(1, (c - 0.35) / 0.15) * 0.6 : 0);
    const dump = c > 0.75 ? Math.min(1, (c - 0.75) / 0.12) : 0;
    bucket.rotation.z = -0.3 + (c > 0.35 && c < 0.75 ? 1.2 : 0) - dump * 0.6;
    deck.rotation.y = c > 0.6 ? Math.sin(Math.min(1, (c - 0.6) / 0.3) * Math.PI) * 0.9 : 0;
    dirt.visible = c > 0.4 && c < 0.85;
  } };
}

function buildOperator() { // a VR operator at a floating console: generic person, no likeness, no mark
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const shirt = toy(P.shirt, { clearcoat: 0.3, roughness: 0.6 }), skin = toy(P.skin, { clearcoat: 0.3, roughness: 0.5 }), hair = toy(P.black, { roughness: 0.6 });
  const headset = toy(P.purple, { roughness: 0.2 }), visor = toy(0xd9a3ff, { roughness: 0.05, emissive: 0x6b2bd1, emissiveIntensity: 0.4 }), panel = toy(P.violet, { roughness: 0.25, emissive: 0x4b14a8, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const torso = at(mesh(new THREE.CapsuleGeometry(0.42, 0.45, 8, 24), shirt), 0, 0.75, 0); torso.scale.set(1.15, 1, 0.75); body.add(torso);
  body.add(at(mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 16), skin), 0, 1.35, 0));
  const head = new THREE.Group(); head.position.set(0, 1.68, 0); body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.33, 32, 24), skin));
  const cap = mesh(new THREE.SphereGeometry(0.35, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), hair); cap.position.y = 0.03; cap.rotation.x = -0.25; head.add(cap);
  for (let i = 0; i < 6; i += 1) { const tuft = at(mesh(new THREE.ConeGeometry(0.08, 0.22, 8), hair), Math.cos(i) * 0.2, 0.3, Math.sin(i * 1.7) * 0.15 - 0.05); tuft.rotation.set(Math.sin(i) * 0.6, 0, Math.cos(i * 2) * 0.6); head.add(tuft); }
  head.add(at(rbox(0.56, 0.24, 0.3, 0.1, headset), 0, 0.02, 0.2));
  head.add(at(rbox(0.46, 0.14, 0.04, 0.05, visor), 0, 0.02, 0.36));
  const strap = mesh(new THREE.TorusGeometry(0.34, 0.035, 10, 32), headset); strap.rotation.x = Math.PI / 2; strap.position.y = 0.02; head.add(strap);
  head.add(at(mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 20, Math.PI), skin), 0, -0.12, 0.3)); // a small smile
  const arm = new THREE.Group(); arm.position.set(0.45, 1.12, 0.05); body.add(arm);
  const upper = at(mesh(new THREE.CapsuleGeometry(0.1, 0.35, 6, 12), shirt), 0, -0.2, 0); arm.add(upper);
  const fore = new THREE.Group(); fore.position.y = -0.42; arm.add(fore);
  fore.add(at(mesh(new THREE.CapsuleGeometry(0.075, 0.35, 6, 12), skin), 0, -0.2, 0));
  fore.add(at(mesh(new THREE.SphereGeometry(0.1, 14, 10), skin), 0, -0.45, 0));
  const panels = new THREE.Group(); panels.position.set(0, 1.2, 0.2); body.add(panels);
  const ps = [];
  for (let i = 0; i < 3; i += 1) {
    const p = new THREE.Group(); const a = (i - 1) * 0.75;
    p.position.set(Math.sin(a) * 1.0, (i === 1 ? 0.15 : -0.15), Math.cos(a) * 0.9); p.rotation.y = a;
    p.add(rbox(i === 1 ? 0.95 : 0.6, i === 1 ? 0.6 : 0.42, 0.04, 0.04, panel));
    for (let r = 0; r < 3; r += 1) p.add(at(rbox(0.3 + (r % 2) * 0.18, 0.05, 0.02, 0.02, toy(P.cyan, { emissive: P.cyan, emissiveIntensity: 0.6 })), -0.08, 0.12 - r * 0.12, 0.035));
    panels.add(p); ps.push(p);
  }
  const ring = at(mesh(new THREE.TorusGeometry(0.95, 0.03, 8, 60, Math.PI * 1.2), panel), 0, 0.05, 0); ring.rotation.set(Math.PI / 2, 0, Math.PI * 0.4); body.add(ring);
  body.rotation.y = -0.4; body.scale.setScalar(0.78);
  return { g, tick(t, s) {
    head.rotation.y = Math.sin(t * 0.6) * 0.25; head.rotation.x = Math.sin(t * 0.9) * 0.05;
    arm.rotation.x = -1.0 + Math.sin(t * 2.2) * 0.15; arm.rotation.z = 0.35; fore.rotation.x = -0.6 + Math.max(0, Math.sin(t * 2.2)) * 0.4;
    ps.forEach((p, i) => { p.position.y = (i === 1 ? 0.15 : -0.15) + Math.sin(t * 1.4 + i) * 0.05; });
    ring.rotation.z = Math.PI * 0.4 + t * 0.4;
    panels.scale.setScalar(1 + s.launch * 1.6); panels.position.z = 0.2 + s.launch * 2.5;
  } };
}

function buildFrame() { // room-scale VR frame: glossy edges with bright joints, turning around the focused toy
  const g = new THREE.Group();
  const edge = toy(P.pink, { emissive: 0x7d1aa8, emissiveIntensity: 0.35 }), joint = toy(P.cyan, { emissive: P.cyan, emissiveIntensity: 0.5 });
  const s = 1.75, h = 1.35, v = [];
  for (const x of [-s, s]) for (const y of [0, h * 2]) for (const z of [-s, s]) v.push(new THREE.Vector3(x, y, z));
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [a, b] of edges) {
    const A = v[a], B = v[b], len = A.distanceTo(B);
    const c = mesh(new THREE.CapsuleGeometry(0.035, len, 4, 8), edge); c.position.copy(A).lerp(B, 0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.add(c);
  }
  for (const p of v) g.add(at(mesh(new THREE.SphereGeometry(0.075, 16, 12), joint), p.x, p.y, p.z));
  return g;
}


function buildDrone() { // quadcopter: hovers and banks around the frame
  const g = new THREE.Group();
  const green = toy(P.green), light = toy(P.green2), k = toy(P.black, { roughness: 0.3 }), w = toy(P.white);
  g.add(at(rbox(0.7, 0.22, 0.42, 0.1, green), 0, 0, 0));
  g.add(at(rbox(0.42, 0.12, 0.3, 0.06, light), 0, 0.15, 0));
  g.add(at(mesh(new THREE.SphereGeometry(0.07, 14, 10), w), 0.36, -0.04, 0));
  const props = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const armM = at(rbox(0.95, 0.07, 0.1, 0.035, green), x * 0.33, 0, z * 0.33); armM.rotation.y = Math.atan2(-z, x); g.add(armM);
    g.add(at(mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.16, 18), k), x * 0.62, 0.04, z * 0.62));
    g.add(at(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 18), light), x * 0.62, -0.06, z * 0.62));
    const pr = new THREE.Group(); pr.position.set(x * 0.62, 0.14, z * 0.62); g.add(pr); props.push(pr);
    for (const a of [0, Math.PI]) { const b = at(rbox(0.42, 0.02, 0.07, 0.01, k), Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2); b.rotation.y = a; pr.add(b); }
  }
  g.scale.setScalar(0.62);
  return { g, tick(t) { for (const p of props) p.rotation.y = t * 38;
    const a = t * 0.45; g.position.set(Math.cos(a) * 2.4, 2.9 + Math.sin(t * 1.6) * 0.15, Math.sin(a) * 2.4);
    g.rotation.set(Math.sin(t * 1.3) * 0.08, -a, 0.18); } };
}

function buildHeli() { // utility helicopter: a long loop behind the pedestal
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const y = toy(P.yellow), k = toy(0x22262a, { roughness: 0.35 }), glass = toy(0xa9c3cf, { roughness: 0.05, transparent: true, opacity: 0.75 });
  const cab = mesh(new THREE.SphereGeometry(0.55, 32, 20), y); cab.scale.set(1.35, 0.85, 0.85); body.add(cab);
  const win = at(mesh(new THREE.SphereGeometry(0.5, 28, 16, -0.9, 1.8, 0.4, 1.5), glass), 0.12, 0.04, 0); win.scale.set(1.35, 0.85, 0.87); win.rotation.y = Math.PI / 2; body.add(win);
  const boom = at(mesh(new THREE.CylinderGeometry(0.07, 0.17, 1.5, 16), y), -1.25, 0.12, 0); boom.rotation.z = Math.PI / 2 + 0.08; body.add(boom);
  body.add(at(rbox(0.12, 0.42, 0.06, 0.03, k), -1.98, 0.3, 0));
  const tailRotor = new THREE.Group(); tailRotor.position.set(-1.98, 0.3, 0.07); body.add(tailRotor);
  for (const a of [0, Math.PI / 2]) { const b = rbox(0.04, 0.42, 0.02, 0.01, toy(P.grey)); b.rotation.z = a; tailRotor.add(b); }
  for (const z of [0.32, -0.32]) { const sk = at(rbox(1.3, 0.05, 0.05, 0.02, k), 0.05, -0.62, z); body.add(sk); for (const x of [-0.3, 0.35]) body.add(at(rbox(0.04, 0.2, 0.04, 0.01, k), x, -0.52, z)); }
  body.add(at(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 12), k), 0, 0.55, 0));
  const rotor = new THREE.Group(); rotor.position.y = 0.66; body.add(rotor);
  for (const a of [0, Math.PI]) { const b = at(rbox(1.5, 0.03, 0.12, 0.02, toy(P.grey)), Math.cos(a) * 0.75, 0, 0); b.rotation.y = a; rotor.add(b); }
  g.scale.setScalar(0.55);
  return { g, tick(t) { rotor.rotation.y = t * 30; tailRotor.rotation.z = t * 40;
    const a = t * 0.22 + 2; g.position.set(Math.cos(a) * 5.5 - 1, 4.2 + Math.sin(t * 0.8) * 0.3, Math.sin(a) * 3 - 3.5);
    g.rotation.set(0, -a + Math.PI, 0); body.rotation.z = -0.12; body.rotation.x = 0.1; } };
}

const BUILD = { continue: buildJet, new: buildTank, training: buildOperator, graphics: buildExcavator };

export function createMenu3D(host, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'm3-canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.75; pm.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 7, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 }); key.shadow.radius = 6; scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fe9ff, 1.4); rim.position.set(-5, 3, -4); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  // pedestal: a soft rounded disc with a lit rim; a shadow catcher on top
  const ped = new THREE.Group(); scene.add(ped);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.25, 0.32, 64), toy(0x1d2730, { clearcoat: 0.6, roughness: 0.5 })); disc.position.y = -0.17; disc.receiveShadow = true; ped.add(disc);
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.035, 10, 96), new THREE.MeshBasicMaterial({ color: P.cyan, toneMapped: false })); rimRing.rotation.x = Math.PI / 2; ped.add(rimRing);
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(2.05, 64), new THREE.ShadowMaterial({ opacity: 0.35 })); catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.002; catcher.receiveShadow = true; ped.add(catcher);
  const frame = buildFrame(); frame.scale.setScalar(0.92); scene.add(frame);
  const holder = new THREE.Group(); scene.add(holder);
  const ambient = reducedMotion ? [] : [buildDrone(), buildHeli()]; // fly-bys; left out entirely with reduced motion
  for (const a of ambient) scene.add(a.g);

  let current = null, currentKey = null, outgoing = null, swapT = 1, launch = null, t = 0, last = performance.now(), raf = 0, destroyed = false, visible = true;
  const pointer = { x: 0, y: 0 };
  function show(k) {
    if (k === currentKey || !BUILD[k]) return;
    if (current) { outgoing = current; }
    current = BUILD[k](); current.g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    current.state = { launch: 0, boost: 0 }; holder.add(current.g); currentKey = k; swapT = reducedMotion ? 1 : 0;
    if (reducedMotion && outgoing) { holder.remove(outgoing.g); outgoing = null; }
  }
  function play(k, done) {
    show(k);
    if (reducedMotion) { queueMicrotask(done); return; }
    launch = { t: 0, len: 1.0, done };
  }
  const ease = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2); // back-out
  function size() {
    const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const portrait = h > w; camera.fov = portrait ? 40 : 30; camera.updateProjectionMatrix();
  }
  function frameTick(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frameTick);
    if (!visible) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!reducedMotion) t += dt;
    size();
    const px = reducedMotion ? 0 : pointer.x * 0.6, py = reducedMotion ? 0 : pointer.y * 0.3;
    camera.position.set(5.2 + px, 3.6 + py, 7.4); camera.lookAt(0, 1.0, 0);
    frame.rotation.y = reducedMotion ? 0.5 : t * 0.25;
    if (swapT < 1) {
      swapT = Math.min(1, swapT + dt * 2.6);
      if (current) current.g.scale.setScalar(Math.max(0.001, ease(swapT)));
      if (outgoing) { const k = Math.min(1, swapT * 1.8); outgoing.g.scale.setScalar(Math.max(0.001, 1 - k)); outgoing.g.rotation.y = k * 1.4; if (k >= 1) { holder.remove(outgoing.g); outgoing = null; } }
    } else if (current) current.g.scale.setScalar(1);
    if (launch && current) {
      launch.t += dt; const k = Math.min(1, launch.t / launch.len);
      current.state.launch = k; current.state.boost = k;
      if (k >= 1) { const d = launch.done; launch = null; if (d) d(); }
    }
    for (const a of ambient) a.tick(t);
    if (current) current.tick(t, current.state);
    if (outgoing) outgoing.tick(t, outgoing.state);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frameTick);
  const onMove = (e) => { const r = host.getBoundingClientRect(); pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2; pointer.y = ((e.clientY - r.top) / r.height - 0.5) * -2; };
  window.addEventListener('pointermove', onMove);
  return {
    show, play,
    get key() { return currentKey; },
    get launching() { return !!launch; },
    setVisible(v) { visible = v; },
    destroy() { destroyed = true; cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); renderer.dispose(); host.innerHTML = ''; }
  };
}
