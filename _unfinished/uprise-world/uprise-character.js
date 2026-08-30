/* ============================================================
   UPRISE CHARACTER — the fellow.

   Matthew, built as geometry. No modelling tool, no downloaded
   mesh: a few hundred lines of profiles and lofts, which costs
   nothing to ship and can be re-tuned in a text editor.

   The art direction is a hand-inked comic drawn in 3D, so the
   character is built for INK and SILHOUETTE first. Every part
   that needs its own black line is its own mesh, because
   OutlineEffect draws an inverted hull per mesh — the beard, the
   nose, the brows and the eyes are separate objects for exactly
   that reason.

   The likeness lives in three things, in this order:
     1. the shoulder-length two-strand twists, built as ONE bold
        inked mass with carved lobes rather than a hundred
        noodles, plus a handful of heavy face-framing twists;
     2. the full beard connected to the moustache;
     3. a lean upright build, deep brown skin in a flat fill.

   Nothing here touches the scene, the renderer or the camera.
   buildFellow returns a group and an update function; the world
   owns everything else.
   ============================================================ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));

/* ---------- head dimensions, in metres ----------
   The ART BIBLE asks for 4.5-5 heads: stylised and rounded, not
   chibi and not anatomical. The first pass came out at 5.3 heads
   with the legs of a runway model, which is why he read as a small
   dark stick at gameplay distance — a realistic figure loses its
   silhouette the moment it gets small, and silhouette is the whole
   game here.

   Rather than re-author every ring, the skull is built at its
   original size and the head GROUP is scaled: HEAD_SCALE is the
   only number that moves, and the hair, the beard and every face
   feature ride along with it because they are all its children.
   The pelvis then drops to shorten the leg chain without changing
   the standing height — long body, short legs, big head, which is
   the reference sheet's proportion exactly. */
const H = 1.85;            /* standing height, crown to sole */
const HX = 0.142, HY = 0.175, HZ = 0.152;   /* head half-extents, before scale */
const HEAD_SCALE = 1.162;
const HEAD_TOP = 1.850;
const HEAD_Y = 1.675;      /* head centre in HEAD-LOCAL authoring space */
const HEAD_AT = HEAD_TOP - HY * HEAD_SCALE;   /* where that centre actually sits */
const CHIN_Y = HEAD_AT - HY * HEAD_SCALE;
const NECK_Y = 1.44;
const SHOULDER_Y = 1.33, SHOULDER_X = 0.192;
const ELBOW_D = 0.300, FOREARM_D = 0.248;
const HIP_Y = 0.735, HIP_X = 0.083;
const THIGH_D = 0.368, SHIN_D = 0.252;

/* ============================================================
   MATERIAL — flat toon, weighted so most of a surface is one
   tone with a single shadow band, exactly as the reference
   frames read. NearestFilter on both filters is the whole
   trick: LinearFilter smears the bands back into a gradient.
   ============================================================ */
const GRADS = new WeakMap();
function gradientMap(THREE) {
  let t = GRADS.get(THREE);
  if (t) return t;
  /* four texels: dark, shadow, lit, lit — so the lit tone owns
     everything above NdotL 0.5 and the shading reads as one
     flat fill plus a band */
  const d = new Uint8Array([
    0x46, 0x46, 0x46, 255,
    0x9e, 0x9e, 0x9e, 255,
    0xff, 0xff, 0xff, 255,
    0xff, 0xff, 0xff, 255
  ]);
  t = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;      /* both, or the bands smear */
  t.generateMipmaps = false;
  t.needsUpdate = true;
  GRADS.set(THREE, t);
  return t;
}

function toon(THREE, color, ink) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(THREE) });
  m.flatShading = true;                    /* AFTER construction — setValues drops it */
  if (ink !== undefined) m.userData.outlineParameters = { thickness: ink };
  return m;
}

/* ============================================================
   GEOMETRY HELPERS
   Everything is a loft: an ordered stack of rings, skinned.
   One primitive, endlessly re-profiled, keeps the whole body
   consistent and keeps the triangle count honest.
   ============================================================ */
function loft(THREE, rings, { capStart = true, capEnd = true } = {}) {
  /* A ring's winding decides which way the surface faces, so a stack
     authored bottom-up would render inside-out and read as a black
     slab. Normalise the direction here instead of remembering it at
     every call site. */
  const meanY = (r) => r.reduce((s, p) => s + p[1], 0) / r.length;
  if (rings.length > 1 && meanY(rings[0]) < meanY(rings[rings.length - 1])) {
    rings = rings.slice().reverse();
    const t = capStart; capStart = capEnd; capEnd = t;
  }
  const n = rings[0].length, R = rings.length;
  const pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  const at = (ri, j) => ri * n + (j % n);
  for (let ri = 0; ri < R - 1; ri++) {
    for (let j = 0; j < n; j++) {
      const a = at(ri, j), b = at(ri, j + 1), c = at(ri + 1, j + 1), d = at(ri + 1, j);
      idx.push(a, d, c, a, c, b);
    }
  }
  const cap = (ri, flip) => {
    const c = [0, 0, 0];
    for (const p of rings[ri]) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= n; c[1] /= n; c[2] /= n;
    const ci = pos.length / 3;
    pos.push(c[0], c[1], c[2]);
    for (let j = 0; j < n; j++) {
      const a = at(ri, j), b = at(ri, j + 1);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(R - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();               /* smooth normals: flatShading is a
                                             shader define, and OutlineEffect
                                             needs unbroken normals to inflate */
  /* rings are authored top-to-bottom; a stack authored the other way
     would face inward, so flip it rather than silently render black */
  return g;
}

/* a ring of n points on an ellipse, optionally squared off */
function ring(y, rx, rz, n, { ox = 0, oz = 0, square = 1, warp = null } = {}) {
  const out = [];
  for (let j = 0; j < n; j++) {
    const t = (j / n) * TAU;
    let c = Math.cos(t), s = Math.sin(t);
    if (square !== 1) {
      const e = 2 / square;
      c = Math.sign(c) * Math.pow(Math.abs(c), e);
      s = Math.sign(s) * Math.pow(Math.abs(s), e);
    }
    let x = ox + s * rx, z = oz + c * rz, yy = y;
    if (warp) { const w = warp(t, x, yy, z); x = w[0]; yy = w[1]; z = w[2]; }
    out.push([x, yy, z]);
  }
  return out;
}

/* a tapered limb segment: a stack of circular rings down -Y */
function limbGeo(THREE, len, r0, r1, { seg = 4, n = 8, bulge = 0.10, bend = 0 } = {}) {
  const rings = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const r = lerp(r0, r1, u) * (1 + bulge * Math.sin(u * Math.PI) * 0.6);
    rings.push(ring(-len * u, r, r, n, { oz: bend * Math.sin(u * Math.PI) }));
  }
  return loft(THREE, rings);
}

/* An indexed, welded icosphere. three's IcosahedronGeometry is
   non-indexed, which would give every triangle its own vertices
   and its own normal — and OutlineEffect inflates along normals,
   so a non-welded mesh comes apart into loose shells at the
   outline pass. Weld it here and keep the normals continuous;
   flatShading on the material still gives the faceted look. */
function icoSphere(THREE, detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ].map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ];
  for (let d = 0; d < detail; d++) {
    const mid = new Map(), next = [];
    const midpoint = (a, b) => {
      const k = a < b ? a + "_" + b : b + "_" + a;
      if (mid.has(k)) return mid.get(k);
      const p = [verts[a][0] + verts[b][0], verts[a][1] + verts[b][1], verts[a][2] + verts[b][2]];
      const l = Math.hypot(p[0], p[1], p[2]);
      verts.push([p[0] / l, p[1] / l, p[2] / l]);
      const i = verts.length - 1; mid.set(k, i); return i;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
  g.setIndex(faces.flat());
  return g;
}

/* Merge indexed geometries into one. Letters are built from
   overlapping bars in a single mesh so OutlineEffect inks the
   whole letterform once instead of drawing every bar's box. */
/* ============================================================
   STATIC SIBLING MERGE

   A finished rig is around forty meshes carrying five to sixteen
   thousand triangles — roughly 127 triangles per draw call on a
   delegate, which is the worst ratio anywhere in this project. Ten
   delegates standing at Hartford were spending four hundred draw
   calls to draw fifty thousand triangles.

   The safe fix is narrow and provable. This rig animates by rotating
   named GROUPS — pelvis, spine, shoulder, elbow, wrist, hip, knee,
   ankle, head, hair. Any two meshes that are SIBLINGS under the same
   parent therefore share one animated transform exactly, for every
   frame, forever. Baking them together cannot desynchronise anything,
   because there is nothing to desynchronise: they were never
   independently transformed.

   So: merge siblings that share a parent AND a material, and nothing
   else. Meshes under different groups stay separate, which is what
   keeps the limbs articulating. Materials are reused by reference
   rather than cloned, so setTint still reaches every merged mesh and
   the Living Sketch stages can still drive material state per part.
   ============================================================ */
function mergeSiblings(THREE, root) {
  let before = 0, after = 0;
  const groups = [];
  root.traverse((o) => { if (o.children && o.children.length > 1) groups.push(o); });

  for (const parent of groups) {
    const kids = parent.children.filter((c) => c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh);
    before += kids.length;
    if (kids.length < 2) { after += kids.length; continue; }

    const byMat = new Map();
    for (const k of kids) {
      const id = k.material.uuid;
      if (!byMat.has(id)) byMat.set(id, []);
      byMat.get(id).push(k);
    }
    for (const list of byMat.values()) {
      if (list.length < 2) { after += 1; continue; }
      const parts = [];
      for (const m of list) {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        parts.push(g);
      }
      /* concatenate position + normal; every part is non-indexed by
         now so this is a straight append with no index bookkeeping */
      let n = 0;
      for (const g of parts) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      let o = 0;
      for (const g of parts) {
        if (!g.attributes.normal) g.computeVertexNormals();
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
        g.dispose();
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      for (const m of list) { parent.remove(m); m.geometry.dispose(); }
      parent.add(mesh);
      after += 1;
    }
  }
  return { before, after };
}

/* ============================================================
   STATIC FLATTEN — for figures that stand rather than walk.

   The sibling merge above cannot reach most of a rig, because nearly
   every mesh is already the only child of its own limb group. A
   background delegate still costs 28 draw calls to draw 5,080
   triangles, and ten of them stand at Hartford.

   For a figure that never walks, articulation is a cost with no
   return: at the distance a delegation is read from, a per-limb idle
   is invisible. So freeze the pose, bake every mesh into the root by
   its full local-to-root matrix, and collapse to ONE MESH PER
   MATERIAL. Idle then rides the whole group instead of the joints —
   a slow breath and a little sway, which is all that reads anyway.

   This is deliberately NOT applied to anyone who animates. The player
   and the four speaking officials keep their joints. Materials are
   still shared by reference, so tinting and Living Sketch material
   state reach a flattened figure exactly as they reach an articulated
   one — a flattened figure keeps one mesh per material, which is
   precisely the granularity a per-part stage needs.
   ============================================================ */
function flattenStatic(THREE, root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const doomed = [];

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const id = o.material.uuid;
    if (!byMat.has(id)) byMat.set(id, { mat: o.material, geos: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    /* local-to-root, so the frozen pose is preserved exactly */
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    byMat.get(id).geos.push(g);
    doomed.push(o);
  });

  const before = doomed.length;
  for (const o of doomed) { if (o.parent) o.parent.remove(o); o.geometry.dispose(); }

  let after = 0;
  for (const { mat, geos } of byMat.values()) {
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let off = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    root.add(new THREE.Mesh(geo, mat));
    after++;
  }
  return { before, after };
}

function mergeGeos(THREE, list) {
  const pos = [], idx = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position, ix = g.index;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/* one bar of a letter: a slab lying in the XY plane, bowed in Z to
   follow the back of the garment it is printed on */
function barGeo(THREE, cx, cy, w, h, rot, depth, bow) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const hw = w / 2, hh = h / 2;
  const pos = [], idx = [];
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  for (let f = 0; f < 2; f++) {
    for (const [ux, uy] of corners) {
      const x = cx + ux * c - uy * sn, y = cy + ux * sn + uy * c;
      pos.push(x, y, (f ? depth : 0) + bow(x));
    }
  }
  idx.push(4, 5, 6, 4, 6, 7, 2, 1, 0, 3, 2, 0);
  for (let i = 0; i < 4; i++) {
    const a = i, b = (i + 1) % 4;
    idx.push(a, b, b + 4, a, b + 4, a + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function triCount(obj) {
  let t = 0;
  obj.traverse((o) => {
    if (!o.geometry) return;
    const g = o.geometry;
    const n = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    t += n * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(t);
}

/* ============================================================
   THE HEAD
   An icosahedron pushed into a skull. Icosahedron, never a
   SphereGeometry: no pole pinch to fight at the crown, which is
   precisely where the part and the hair mass live.
   ============================================================ */
function headSurface(dx, dy, dz) {
  let x = dx * HX, y = dy * HY, z = dz * HZ;
  const front = clamp(dz, 0, 1);
  const ax = Math.abs(dx);
  const sgn = dx < 0 ? -1 : 1;

  /* jaw: narrows below the cheekbones, but stays square enough
     to read as a jawline rather than an egg */
  const ty = clamp((-dy - 0.06) / 0.90, 0, 1);
  const tj = Math.pow(ty, 1.35);
  x *= 1 - 0.34 * tj;
  z *= 1 - (dz < 0 ? 0.24 : 0.06) * Math.pow(ty, 1.7);

  /* brow ridge — heavy, and the single strongest read in profile */
  const brow = gauss(dy - 0.19, 0.15) * Math.pow(front, 1.4) * clamp(1 - ax * 0.70, 0, 1);
  z += 0.014 * brow;

  /* socket under it */
  const sock = gauss(ax - 0.34, 0.17) * gauss(dy - 0.02, 0.10) * Math.pow(front, 2);
  z -= 0.008 * sock;

  /* cheekbone, then the hollow under it */
  const cb = gauss(ax - 0.58, 0.20) * gauss(dy + 0.16, 0.15) * front;
  z += 0.007 * cb; x += 0.006 * cb * sgn;
  const hol = gauss(ax - 0.44, 0.17) * gauss(dy + 0.44, 0.13) * Math.pow(front, 1.2);
  z -= 0.007 * hol;

  /* chin, pushed forward and a touch down */
  const chin = gauss(dy + 0.84, 0.14) * gauss(dx, 0.32) * front;
  z += 0.012 * chin; y -= 0.005 * chin;

  /* forehead falls back above the brow */
  const fh = clamp((dy - 0.30) / 0.60, 0, 1);
  if (dz > 0) z -= 0.016 * fh * fh * front;

  /* temples flattened, occiput full */
  x *= 1 - 0.055 * gauss(dy - 0.24, 0.20) * gauss(ax - 0.85, 0.26);
  if (dz < 0) z -= 0.007 * gauss(dy - 0.02, 0.36) * clamp(-dz, 0, 1);
  return [x, y, z];
}

function headGeo(THREE) {
  const g = icoSphere(THREE, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const q = headSurface(v.x, v.y, v.z);
    p.setXYZ(i, q[0], q[1], q[2]);
  }
  g.computeVertexNormals();
  return g;
}

/* Place a face feature ON the skull rather than at a guessed
   coordinate: azimuth and elevation in, surface point and normal
   out. Guessing put the first pass's eyes outside the temples. */
function facePoint(THREE, a, b) {
  const d = new THREE.Vector3(
    Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)).normalize();
  const p = headSurface(d.x, d.y, d.z);
  const n = new THREE.Vector3(p[0] / (HX * HX), p[1] / (HY * HY), p[2] / (HZ * HZ)).normalize();
  return { p: new THREE.Vector3(p[0], p[1], p[2]), n };
}
const FWD = { z: null };
function faceMesh(THREE, geo, mat, a, b, lift, scale, roll = 0) {
  if (!FWD.z) FWD.z = new THREE.Vector3(0, 0, 1);
  const { p, n } = facePoint(THREE, a, b);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(p).addScaledVector(n, lift);
  m.quaternion.setFromUnitVectors(FWD.z, n);
  m.rotateZ(roll);
  m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}

/* ---------- the eye, as a drawn almond ----------
   A scaled sphere can only ever be an egg, and an egg reads ROUND
   however thin you squash it — the highlight and the outline both
   curve the wrong way. His eyes are narrow and HOODED: a heavy
   upper lid cutting most of the aperture away, so what is left is
   a shallow lens whose top edge is nearly straight and whose outer
   corner drops.

   So the eye is lofted from an authored outline instead: an arc
   above and an arc below meeting at two points, with the upper arc
   flattened and the whole thing sheared down toward the outer
   corner. `hood` flattens the top edge; `drop` tilts the outer
   corner below the inner one.
   ============================================================ */
function lensGeo(THREE, { w, hUp, hDn, depth = 0.006, hood = 0.62, drop = 0.0, n = 18 }) {
  const rim = [];
  for (let i = 0; i < n; i++) {
    const u = (i / n) * TAU;
    const x = Math.cos(u);
    /* |sin| raised to a power gives a pointed corner and a flat
       middle — the difference between a lens and an ellipse */
    const upper = Math.sin(u) > 0;
    const k = Math.pow(Math.abs(Math.sin(u)), upper ? hood : 0.82);
    const y = (upper ? hUp : -hDn) * k + drop * (x + 1) * 0.5;
    rim.push([x * w, y]);
  }
  const pos = [], idx = [];
  for (const [x, y] of rim) pos.push(x, y, 0);
  for (const [x, y] of rim) pos.push(x * 0.72, y * 0.72, -depth);
  const cf = pos.length / 3; pos.push(0, drop * 0.5, depth * 0.55);
  const cb = cf + 1; pos.push(0, drop * 0.5, -depth);
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n;
    idx.push(cf, a, b);                       /* front dome */
    idx.push(cb, n + b, n + a);               /* back */
    idx.push(a, n + a, n + b, a, n + b, b);   /* rim wall */
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- the beard ----------
   A shell lifted off the head over the jaw, chin, moustache and
   sideburns, with the lips cut out of it. Its own mesh so it
   gets its own ink line, which is what makes it read as a
   drawn shape rather than a texture. */
function beardMask(dx, dy, dz) {
  if (dz < -0.58) return 0;
  const ax = Math.abs(dx);
  const front = clamp(dz, 0, 1);
  /* THE CHEEK LINE. This is the number one thing the owner called
     out and the old curve is why: `0.80 * ax^1.5` climbed so fast
     that by the sideburn the beard's top edge was up level with the
     eye socket, and the whole lower face went dark — a mask, not a
     beard. In the reference photographs the line runs from just
     under the mouth corner out and only gently UP, staying below
     the nose base the whole way and reaching the sideburn low, in
     front of the ear. A gentler exponent and a much smaller gain
     put it back where his actually is.

     A slow wobble rides on top: a real beard boundary is soft and
     uneven, and a perfect geometric arc is the other way to make
     this read as a strapped-on prop. */
  const wob = 0.018 * Math.sin(ax * 8.5 + dy * 3.4) + 0.008 * Math.sin(ax * 19.0);
  const top = -0.672 + 0.45 * Math.pow(ax, 1.65) + 0.13 * clamp(-dz, 0, 1) + wob;
  /* a wider feather band, so the cheek edge fades instead of
     stopping dead — a full beard that is not a solid slab */
  let m = smooth(top + 0.15, top - 0.05, dy);
  /* The moustache is its own compact patch under the nose. It used
     to be wide and tall enough to merge with the jaw beard into one
     solid bar across the whole lower face — which is the other half
     of why the beard read as a mask. Narrow, and bare skin now
     shows at the corners of the mouth, the way it does on him. */
  const must = gauss(dx, 0.255) * gauss(dy + 0.495, 0.088) * Math.pow(front, 0.5);
  m = Math.max(m, smooth(0.26, 0.50, must));
  /* lips cut back out of both */
  const mouth = gauss(dx, 0.20) * gauss(dy + 0.665, 0.055) * front;
  m *= 1 - 0.95 * clamp((mouth - 0.30) / 0.70, 0, 1);
  /* thinner as it wraps under the jaw toward the neck */
  m *= smooth(-0.58, -0.28, dz) * 0.5 + 0.5;
  return clamp(m, 0, 1);
}

function beardGeo(THREE) {
  const src = icoSphere(THREE, 4);
  const p = src.attributes.position, ix = src.index;
  const v = new THREE.Vector3();
  const dirs = [];
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); dirs.push(v.clone()); }
  const keep = [];
  for (let i = 0; i < ix.count; i += 3) {
    const a = dirs[ix.getX(i)], b = dirs[ix.getX(i + 1)], c = dirs[ix.getX(i + 2)];
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    const l = Math.hypot(cx, cy, cz);
    /* a higher cut than the old 0.30 drops the feathered fringe from
       the SHELL while the mask still thins the thickness under it —
       the beard ends in a ragged edge instead of a clean rim */
    if (beardMask(cx / l, cy / l, cz / l) > 0.42) keep.push(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
  }
  const pos = [];
  for (const d of dirs) {
    const m = beardMask(d.x, d.y, d.z);
    const base = headSurface(d.x, d.y, d.z);
    const front = clamp(d.z, 0, 1);
    /* thickness: a real mass at the chin, thinning to nearly nothing
       at the cheek. The old numbers gave the cheek a 4mm slab, which
       stood proud of the face and caught its own outline — half of
       why it read heavy. */
    let th = (0.0018 + 0.0090 * Math.pow(m, 1.5)) * (1 - 0.34 * d.x * d.x);
    th += 0.009 * gauss(d.y + 0.86, 0.14) * gauss(d.x, 0.30) * front;   /* chin volume */
    th += 0.0035 * gauss(d.y + 0.62, 0.13) * gauss(Math.abs(d.x) - 0.58, 0.20);  /* jaw corner */
    const n = new THREE.Vector3(base[0] / (HX * HX), base[1] / (HY * HY), base[2] / (HZ * HZ)).normalize();
    pos.push(
      base[0] + n.x * th,
      base[1] + n.y * th - 0.007 * gauss(d.y + 0.90, 0.18) * gauss(d.x, 0.36),
      base[2] + n.z * th
    );
  }
  /* drop the vertices no kept triangle references, or the bounding
     sphere covers the whole skull and culling misbehaves */
  const remap = new Map(), vp = [], vi = [];
  for (const i of keep) {
    if (!remap.has(i)) { remap.set(i, vp.length / 3); vp.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    vi.push(remap.get(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vp, 3));
  g.setIndex(vi);
  g.computeVertexNormals();
  return g;
}

/* ============================================================
   THE HAIR — fifty individual two-strand ropes

   The previous pass built the hair as ONE lofted mass with
   thirteen shallow lobes carved into it and a couple of dozen
   ropes half sunk into its surface. The owner's verdict was that
   it read as a smooth curtain, and he was right: a lobe is a
   dent, and a dent has no silhouette. From the side and from
   behind — the two views this game is actually played from — the
   whole thing was one black bell.

   So the mass is gone. What is left is a thin CAP over the scalp,
   which exists only so no skin shows through, and then fifty
   separate ROPES, each its own tube, each with real gaps around
   it. Because OutlineEffect inflates along vertex normals, and
   the ropes are merged into one geometry as DISJOINT shells, each
   rope comes out of the ink pass with its own black line. That is
   the whole trick, and it is what makes them read as ropes.

   Everything here is authored in standing-world Y (1.85 is the
   crown) because the hair group is offset back by HEAD_Y.
   ============================================================ */
const SHELL = 0.017;                       /* hair thickness over the scalp */
const SRX = HX + SHELL, SRY = HY + SHELL, SRZ = HZ + SHELL;
const RMEAN = 0.166;                       /* mean scalp radius, for arc length */

/* a point on the scalp shell: azimuth (0 = front) and elevation
   above the ear-level equator, in radians */
function scalpPt(th, e) {
  const ce = Math.cos(e), se = Math.sin(e);
  return [Math.sin(th) * SRX * ce, HEAD_Y + SRY * se, Math.cos(th) * SRZ * ce];
}

/* ---------- the cap ----------
   His hairline is HIGH and it recedes at the temples — the
   top-down photograph is unambiguous about that, and the old
   mass, which came down over the brow, lost most of the face to
   it. The cap ends at the hairline in front and a little below
   the ear behind, and a centre part is pinched into the crown. */
function capHem(th) {
  const c = Math.cos(th);
  const f = clamp(c, 0, 1), b = clamp(-c, 0, 1);
  let y = 1.660;                                        /* sides, at the ear */
  y = lerp(y, 1.806, Math.pow(f, 1.30));                /* the forehead hairline */
  y = lerp(y, 1.604, Math.pow(b, 1.40));                /* the nape */
  y -= 0.014 * Math.exp(-Math.pow(Math.sin(th) / 0.30, 2)) * f;   /* a soft peak at centre */
  y += 0.010 * Math.cos(th * 9 + 0.7) * f;              /* the hairline is not a drawn arc */
  y += 0.006 * Math.cos(th * 17 + 2.1);
  return y;
}
function capPoint(th, y) {
  const t = clamp((y - HEAD_Y) / SRY, -1, 1);
  const ce = Math.sqrt(Math.max(0, 1 - t * t));
  /* the centre part, a groove down the sagittal plane of the crown */
  const part = Math.exp(-Math.pow(Math.sin(th) / 0.135, 2)) * smooth(1.66, 1.80, y);
  const k = 1 - 0.105 * part;
  return [Math.sin(th) * SRX * ce * k, Math.cos(th) * SRZ * ce * k];
}
function capGeo(THREE) {
  const N = 44, K = 9;
  const rings = [];
  for (let k = 0; k <= K; k++) {
    const r = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * TAU;
      const y = lerp(1.874, capHem(th), k / K);
      const [x, z] = capPoint(th, y);
      r.push([x, y, z]);
    }
    rings.push(r);
  }
  return loft(THREE, rings, { capStart: true, capEnd: true });
}

/* ---------- one rope ----------
   A twist leaves the scalp, slides down over the skull until it
   passes the widest point, and from there simply hangs. That is
   the actual physics and it is also what the photographs show,
   so the path is written exactly that way: an arc phase and a
   fall phase, joined where the head stops getting wider.

   The two-strand look comes from the profile, not from geometry
   detail: the radius pulses along the rope and the axis
   corkscrews around the centreline, which together give the
   knuckled rhythm a twist has. `hang` is the drop below ear
   level, so the tip lands where it is asked to. */
function ropeGeo(THREE, r) {
  const SEG = 17, RAD = 5;
  const arcA = r.elev * RMEAN;
  const len = arcA + r.hang;
  const eq = scalpPt(r.th, 0);
  const rings = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG, a = u * len;
    const th = r.th + r.drift * u * u;
    let x, y, z;
    if (a < arcA) {
      const p = scalpPt(th, r.elev * (1 - a / arcA));
      x = p[0]; y = p[1]; z = p[2];
    } else {
      const d = a - arcA;
      const p = scalpPt(th, 0);
      /* ease onto the rope's own hanging radius rather than
         stepping onto it, or the joint shows as a kink */
      const w = clamp(d / 0.055, 0, 1);
      const s = (1 + (r.jit - 1) * w) * (1 + r.splay * Math.pow(d / Math.max(len, 1e-3), 1.5));
      x = p[0] * s; z = p[2] * s; y = eq[1] - d;
      z += r.curl * d * d;                 /* a slight inward curl at the tip */
      x += r.curlX * d * d;
    }
    const ph = r.twist + (a / 0.031) * TAU;
    const rr = r.r0 * (1 - 0.20 * Math.pow(u, 2.6)) * (1 + 0.30 * Math.sin(ph));
    const ox = 0.26 * r.r0 * Math.cos(ph), oz = 0.26 * r.r0 * Math.sin(ph);
    rings.push(ring(y, rr, rr * 0.90, RAD, { ox: x + ox, oz: z + oz, square: 1.5 }));
  }
  return loft(THREE, rings);
}

/* deterministic noise: the layout must be identical every load,
   or the character's silhouette changes between sessions */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- the layout ----------
   Bands of roots from the crown down to the hairline, mirrored.
   Length runs SHORT at the front, where a few twists frame the
   face and stop at the cheekbone, and LONGEST at the back, where
   they reach the shoulder — which is where the silhouette
   variety comes from. Every rope gets its own hanging radius, so
   they never close into a cylinder wall. */
function ropeLayout() {
  const rnd = rng(0x5eed17);
  const out = [];
  /* The bands all start BEHIND the ear line (|th| >= 1.15). The
     first attempt let them start at 0.62 and the result was a
     curtain across both cheeks — the face all but gone. What hangs
     in front of the ear is the four deliberate face-framers below,
     and nothing else. */
  const BANDS = [
    /* elev, count/side, th from, th to, hang, r0 */
    { elev: 1.16, n: 3, a: 1.30, b: 2.78, hang: 0.300, r0: 0.0128 },
    { elev: 0.96, n: 5, a: 1.18, b: 2.86, hang: 0.295, r0: 0.0126 },
    { elev: 0.70, n: 6, a: 1.15, b: 2.90, hang: 0.275, r0: 0.0122 },
    { elev: 0.42, n: 6, a: 1.16, b: 2.90, hang: 0.250, r0: 0.0118 },
    { elev: 0.15, n: 4, a: 1.22, b: 2.62, hang: 0.215, r0: 0.0110 }
  ];
  for (const B of BANDS) {
    for (const side of [1, -1]) {
      for (let i = 0; i < B.n; i++) {
        const f = B.n === 1 ? 0.5 : i / (B.n - 1);
        const th = side * (lerp(B.a, B.b, f) + (rnd() - 0.5) * 0.13);
        /* twists over the temple are shorter than the ones at the
           back — that difference IS the silhouette variety */
        const frontness = clamp(1 - (Math.abs(th) - 1.1) / 1.1, 0, 1);
        out.push({
          th, elev: B.elev + (rnd() - 0.5) * 0.14,
          hang: B.hang * lerp(1, 0.72, Math.pow(frontness, 1.3)) * (0.84 + rnd() * 0.32),
          /* Wide spreads on both the thickness and the hanging
             radius. At gameplay distance a rope is three pixels
             across, so ropes of uniform size at a uniform radius
             merge back into one mass however many of them there
             are — it is the VARIATION that keeps gaps open in the
             silhouette once the figure is small. */
          r0: B.r0 * (0.72 + rnd() * 0.68),
          drift: side * (0.08 + rnd() * 0.18),
          splay: 0.02 + rnd() * 0.09,
          jit: 0.90 + rnd() * 0.26,
          curl: -0.15 - rnd() * 0.40,
          curlX: -side * (0.05 + rnd() * 0.35),
          twist: rnd() * TAU
        });
      }
    }
  }
  /* the four that hang in front of the ear and frame the face —
     his signature, and the thing that makes a 3/4 view read as him.
     Short: the front pair stops at the cheekbone, the back pair at
     the jaw, exactly as the photographs do. */
  for (const side of [1, -1]) {
    for (const [th, hang, r0] of [[0.78, 0.080, 0.0104], [1.00, 0.150, 0.0114]]) {
      out.push({
        th: side * th, elev: 0.26 + rnd() * 0.18, hang: hang * (0.9 + rnd() * 0.25),
        r0, drift: side * 0.05, splay: 0.05, jit: 0.98 + rnd() * 0.08,
        curl: -0.25, curlX: -side * 0.15, twist: rnd() * TAU
      });
    }
  }
  return out;
}

/* ============================================================
   BUILD
   ============================================================ */
export function buildFellow(THREE, opts = {}) {
  const tint = Object.assign({
    skin: 0x603722,
    /* Not black. Nothing in the reference frames is black except the
       ink — hair there is a dark cool plum, and a black mass would
       swallow the ink lines BETWEEN the twists, which are the whole
       reason there are fifty of them. */
    hair: 0x2d2831,
    /* The beard was 0x2f2621 — so close to black that against this
       skin it read as a hole in the face rather than hair on it. A
       warm dark brown still sits clearly darker than the skin, still
       survives the ink pass, and stops looking painted on. */
    beard: 0x40312a,
    brow: 0x2a2120,
    hoodie: 0x3f6a9e,      /* washed denim blue, the HM hoodie */
    print: 0xeae2d2,       /* the cream HM monogram and chest badge */
    pants: 0x34363d,       /* matching washed-charcoal joggers */
    cuff: 0x2a2c32,        /* ribbed hem, cuffs and waistband */
    shoes: 0x2c2f38,
    sole: 0xe8e3d6,
    eye: 0xf2ece2,
    iris: 0x1d1310,
    lip: 0x5a2f1e,
    mouth: 0x33190f
  }, opts.tint || {});

  /* ---------- ink weights ----------
     OutlineEffect's thickness is an angular size, so these are a
     constant fraction of the screen whatever the camera does. The
     character carries HEAVIER ink than the world by design: he is
     small in frame and the reference frames draw the character with
     the boldest line on screen. The face details take a lighter
     line or they close up into a black smear at gameplay distance,
     and the hair is lighter still — fifty ropes with a body-weight
     line round each would ink the gaps shut and put the smooth
     curtain straight back.

     The numbers are calibrated, not guessed. OutlineEffect offsets
     by `normalize(pos - pos2) * thickness * pos.w`, and that
     normalize is over FOUR components, so the screen-space offset
     lands near thickness/2 of NDC — half a percent of thickness is
     roughly one pixel on a 640-tall frame. Measuring the reference
     gameplay frames (a figure a fifth of frame height carrying a
     three-pixel line at 1200) puts the body weight at about 0.013.
     The first pass ran at 0.006 and drew a hairline. */
  const inkScale = opts.ink === undefined ? 1 : Math.max(0, opts.ink);
  const ink = (v) => v * inkScale;

  const reduced = opts.reducedMotion !== undefined
    ? !!opts.reducedMotion
    : (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const M = {
    skin: toon(THREE, tint.skin, ink(0.0072)),
    hair: toon(THREE, tint.hair, ink(0.0048)),
    beard: toon(THREE, tint.beard, ink(0.0038)),
    brow: toon(THREE, tint.brow, ink(0.0034)),
    hoodie: toon(THREE, tint.hoodie, ink(0.0092)),
    print: (() => {
      const m = toon(THREE, tint.print, ink(0.0044));
      m.emissive = new THREE.Color(0x6b6659);   /* the monogram never goes to shadow */
      return m;
    })(),
    pants: toon(THREE, tint.pants, ink(0.0092)),
    cuff: toon(THREE, tint.cuff, ink(0.0072)),
    shoes: toon(THREE, tint.shoes, ink(0.0092)),
    sole: toon(THREE, tint.sole, ink(0.0038)),
    eye: toon(THREE, tint.eye, ink(0.0026)),
    iris: toon(THREE, tint.iris, ink(0.0020)),
    lip: toon(THREE, tint.lip, ink(0.0028)),
    mouth: toon(THREE, tint.mouth, ink(0.0030))
  };

  const group = new THREE.Group();
  group.name = "fellow";

  /* ---------- contact shadow ----------
     A flat coloured disc, not a real shadow map. The reference
     frames plant their characters with exactly this. */
  if (opts.contactShadow !== false) {
    /* A flat COLOURED shape, never a radial gradient and never
       black: the art bible is explicit that even the shadows here
       are coloured, and the reference frames plant their characters
       on a flat grey-green patch with a hard edge. Constant alpha
       across the whole disc — the falloff is what makes a contact
       shadow look like a drop shadow out of a photo editor. */
    const sg = new THREE.CircleGeometry(0.27, 16);
    const sm = new THREE.MeshBasicMaterial({
      color: opts.shadowTint === undefined ? 0x5d7462 : opts.shadowTint,
      transparent: true, opacity: 0.30, depthWrite: false
    });
    sm.userData.outlineParameters = { visible: false };
    const sh = new THREE.Mesh(sg, sm);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.012;
    sh.scale.set(1, 1, 1.25);
    sh.renderOrder = -1;
    group.add(sh);
  }

  const body = new THREE.Group(); group.add(body);
  const pelvis = new THREE.Group(); pelvis.position.y = HIP_Y; body.add(pelvis);
  const spine = new THREE.Group(); pelvis.add(spine);

  /* ---------- the hoodie ----------
     His own washed-blue HM hoodie. At the distance this game is
     played, print does not read — so the garment is a flat colour
     block and exactly one bold graphic, the cream HM, on the back
     where the camera actually lives. */
  const Y = (y) => y - HIP_Y;
  /* A hoodie, not a vest: the first pass was a narrow tube 20cm
     deep, which from the side left almost no figure to draw at all.
     The reference characters are boxy — a wide, slightly baggy
     garment is most of what carries their silhouette. */
  const torsoRings = [
    [0.802, 0.172, 0.126, 2.2],
    [0.872, 0.178, 0.130, 2.2],
    [0.960, 0.170, 0.124, 2.2],
    [1.070, 0.170, 0.123, 2.2],
    [1.180, 0.182, 0.129, 2.1],
    [1.275, 0.199, 0.131, 2.0],
    [1.348, 0.194, 0.119, 1.9],
    [1.396, 0.138, 0.096, 1.7],
    [1.424, 0.086, 0.076, 1.5]
  ].map(([y, rx, rz, sq]) => ring(Y(y), rx, rz, 16, { square: sq }));
  const torso = new THREE.Mesh(loft(THREE, torsoRings), M.hoodie);
  spine.add(torso);

  /* ribbed hem — its own mesh so it gets its own line */
  spine.add(new THREE.Mesh(loft(THREE, [
    ring(Y(0.804), 0.170, 0.124, 16, { square: 2.2 }),
    ring(Y(0.762), 0.166, 0.121, 16, { square: 2.2 }),
    ring(Y(0.744), 0.156, 0.114, 16, { square: 2.1 })
  ]), M.cuff));

  /* the hood, bunched behind the neck. Most of it hides under the
     hair, but the wedge that shows past the shoulders is a strong
     silhouette cue from behind. */
  spine.add(new THREE.Mesh(loft(THREE, [
    ring(Y(1.462), 0.100, 0.064, 12, { oz: -0.078, square: 1.8 }),
    ring(Y(1.420), 0.128, 0.082, 12, { oz: -0.066, square: 1.9 }),
    ring(Y(1.345), 0.140, 0.090, 12, { oz: -0.052, square: 2.0 }),
    ring(Y(1.288), 0.120, 0.078, 12, { oz: -0.046, square: 2.0 })
  ]), M.hoodie));

  /* neck — skin, and a separate mesh so the jaw shadow reads. It
     tops out under CHIN_Y: the head grew, so a neck authored for
     the old skull would have poked straight through the jaw. */
  const neck = new THREE.Mesh(
    loft(THREE, [
      ring(Y(1.372), 0.062, 0.058, 10),
      ring(Y(1.416), 0.055, 0.052, 10, { oz: 0.004 }),
      ring(Y(CHIN_Y - 0.002), 0.053, 0.050, 10, { oz: 0.008 })
    ]), M.skin);
  spine.add(neck);

  /* ---------- the HM monogram ----------
     Cream, huge, and simplified to the letterforms alone: the
     bullet and the AMMO lettering in the real print dissolve into
     mud at this scale, so they are deliberately dropped.

     `marks: false` takes the garment print off entirely. The rig is
     reused for the people who live in this world, and the HM
     monogram and the Kingdom Steppa crest are McCluster's — a street
     full of strangers wearing his chest badge reads as a bug and
     quietly makes the protagonist's clothes meaningless. */
  if (opts.marks !== false) {
    /* The monogram is drawn, not typeset. Every stroke gets its own
       weight and its own slight lean: a set of identical parallel
       bars reads as a system font the instant you can see it, and
       the whole art direction here is hand-inked. */
    const bowBack = (x) => -0.134 - 0.30 * x * x;
    const S = 0.150;                       /* cap height */
    const t = S * 0.235;                   /* nominal stroke weight */
    const bars = [];
    const H0 = 0.084, M0 = -0.084, half = S * 0.34;
    /* H — uneven uprights, a crossbar sitting a shade above centre */
    bars.push(barGeo(THREE, H0 - half, 0.002, t * 1.06, S * 1.02, 0.028, 0.011, bowBack));
    bars.push(barGeo(THREE, H0 + half, -0.003, t * 0.90, S * 0.97, -0.020, 0.011, bowBack));
    bars.push(barGeo(THREE, H0, S * 0.055, half * 2.06, t * 0.86, 0.014, 0.011, bowBack));
    /* M — the two legs splay a little, the vee is off-centre */
    bars.push(barGeo(THREE, M0 - half * 1.06, 0.001, t * 1.03, S * 1.01, 0.042, 0.011, bowBack));
    bars.push(barGeo(THREE, M0 + half * 1.08, -0.002, t * 0.94, S * 0.98, -0.034, 0.011, bowBack));
    bars.push(barGeo(THREE, M0 - half * 0.55, S * 0.10, t * 0.98, S * 0.88, 0.53, 0.011, bowBack));
    bars.push(barGeo(THREE, M0 + half * 0.50, S * 0.09, t * 0.84, S * 0.84, -0.47, 0.011, bowBack));
    const hm = new THREE.Mesh(mergeGeos(THREE, bars), M.print);
    hm.position.y = Y(1.150);
    spine.add(hm);
  }

  /* Kingdom Steppa crest, simplified to a badge shape — legible as
     an emblem from the front, never as text. Off with `marks: false`,
     for the same reason the monogram is. */
  if (opts.marks !== false) {
    const bowFront = (x) => 0.126 + 0.28 * x * x;
    /* A shield, not the pencil-shaped tag the first pass drew: a
       square rotated 45 degrees inside a square reads as a crest at
       any size, and reads as a crest and nothing else. */
    const b = [];
    b.push(barGeo(THREE, 0, 0, 0.056, 0.056, 0.04, 0.008, bowFront));
    b.push(barGeo(THREE, 0, 0, 0.034, 0.034, 0.79, 0.010, bowFront));
    const crest = new THREE.Mesh(mergeGeos(THREE, b), M.print);
    crest.position.set(-0.062, Y(1.246), 0);
    spine.add(crest);
  }

  /* ---------- arms ---------- */
  const arms = [];
  for (const side of [1, -1]) {
    const sh = new THREE.Group();
    sh.position.set(side * SHOULDER_X, Y(SHOULDER_Y), 0);
    spine.add(sh);

    /* the shoulder of the hoodie, started inside the torso so it
       reads as cloth rather than an armband floating in space */
    const cap = new THREE.Mesh(
      loft(THREE, [
        ring(0.066, 0.056, 0.054, 10, { ox: -side * 0.034 }),
        ring(0.022, 0.072, 0.068, 10, { ox: -side * 0.014 }),
        ring(-0.050, 0.070, 0.066, 10)
      ]), M.hoodie);
    sh.add(cap);

    const upper = new THREE.Mesh(
      limbGeo(THREE, ELBOW_D, 0.062, 0.052, { seg: 4, n: 10, bulge: 0.08 }), M.hoodie);
    sh.add(upper);

    const el = new THREE.Group(); el.position.y = -ELBOW_D; sh.add(el);
    const fore = new THREE.Mesh(
      limbGeo(THREE, FOREARM_D - 0.030, 0.053, 0.042, { seg: 4, n: 10, bulge: 0.08 }), M.hoodie);
    el.add(fore);
    const scuff = new THREE.Mesh(loft(THREE, [
      ring(-(FOREARM_D - 0.032), 0.045, 0.045, 10),
      ring(-FOREARM_D, 0.041, 0.041, 10)
    ]), M.cuff);
    el.add(scuff);

    const wr = new THREE.Group(); wr.position.y = -FOREARM_D; el.add(wr);
    /* The reference characters have big, simple, clearly drawn
       hands. This one was a mitten with no thumb, which at any
       distance reads as an unfinished stump — the outline pass
       draws exactly one blob. The palm is bigger now and the thumb
       is its OWN mesh, so the ink draws it as a separate shape. */
    const hand = new THREE.Mesh(
      loft(THREE, [
        ring(0, 0.040, 0.030, 8, { square: 2.4 }),
        ring(-0.044, 0.048, 0.034, 8, { square: 2.2 }),
        ring(-0.092, 0.044, 0.031, 8, { square: 2.2 }),
        ring(-0.116, 0.030, 0.022, 8, { square: 2.2 })
      ]), M.skin);
    wr.add(hand);
    const thumb = new THREE.Mesh(
      loft(THREE, [
        ring(-0.016, 0.017, 0.016, 6),
        ring(-0.040, 0.019, 0.018, 6, { ox: -side * 0.020, oz: 0.010 }),
        ring(-0.062, 0.014, 0.014, 6, { ox: -side * 0.032, oz: 0.019 })
      ]), M.skin);
    thumb.position.x = -side * 0.026;
    wr.add(thumb);
    arms.push({ side, sh, el, wr });
  }

  /* ---------- legs ---------- */
  const hips = new THREE.Mesh(
    loft(THREE, [
      ring(Y(0.905), 0.140, 0.092, 12, { square: 2.1 }),
      ring(Y(0.840), 0.147, 0.097, 12, { square: 2.1 }),
      ring(Y(0.775), 0.148, 0.098, 12, { square: 2.0 }),
      ring(Y(0.712), 0.138, 0.092, 12, { square: 1.8 }),
      ring(Y(0.668), 0.121, 0.084, 12, { square: 1.7 })
    ]), M.pants);
  pelvis.add(hips);

  const legs = [];
  for (const side of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(side * HIP_X, 0, 0);
    pelvis.add(hip);

    const thigh = new THREE.Mesh(
      limbGeo(THREE, THIGH_D, 0.094, 0.076, { seg: 4, n: 10, bulge: 0.14 }), M.pants);
    hip.add(thigh);

    const kn = new THREE.Group(); kn.position.y = -THIGH_D; hip.add(kn);
    /* jogger leg: full through the calf, gathered into a rib at
       the ankle — the cuff, not a flare, is the silhouette note */
    const shin = new THREE.Mesh(loft(THREE, [
      ring(0, 0.076, 0.076, 10),
      ring(-0.090, 0.079, 0.079, 10),
      ring(-0.175, 0.068, 0.070, 10),
      ring(-0.228, 0.059, 0.061, 10)
    ]), M.pants);
    kn.add(shin);
    kn.add(new THREE.Mesh(loft(THREE, [
      ring(-0.222, 0.056, 0.058, 10),
      ring(-SHIN_D, 0.049, 0.051, 10)
    ]), M.cuff));

    const an = new THREE.Group(); an.position.y = -SHIN_D; kn.add(an);
    /* Chunky shoe, the reference silhouette's heaviest element —
       and a quarter wider than the first pass, because the bottom
       of the silhouette is carried by the feet and a narrow shoe
       lets the figure taper away into nothing. */
    const shoe = new THREE.Mesh(
      loft(THREE, [
        ring(-0.010, 0.058, 0.060, 10, { square: 2.6, oz: -0.014 }),
        ring(-0.050, 0.072, 0.102, 10, { square: 3.0, oz: 0.024 }),
        ring(-0.092, 0.075, 0.130, 10, { square: 3.4, oz: 0.052 }),
        ring(-0.113, 0.066, 0.125, 10, { square: 3.4, oz: 0.054 })
      ]), M.shoes);
    an.add(shoe);
    const sole = new THREE.Mesh(
      loft(THREE, [
        ring(-0.100, 0.077, 0.133, 10, { square: 3.4, oz: 0.052 }),
        ring(-0.130, 0.070, 0.124, 10, { square: 3.4, oz: 0.052 })
      ]), M.sole);
    an.add(sole);
    legs.push({ side, hip, kn, an });
  }

  /* ---------- head ---------- */
  const neckJoint = new THREE.Group();
  neckJoint.position.y = Y(NECK_Y);
  spine.add(neckJoint);
  const head = new THREE.Group();
  head.position.y = HEAD_AT - NECK_Y;
  head.scale.setScalar(HEAD_SCALE);
  neckJoint.add(head);

  head.add(new THREE.Mesh(headGeo(THREE), M.skin));
  /* The beard is a likeness feature, not a generic one. `beard: false`
     for anyone who is not him. */
  if (opts.beard !== false) head.add(new THREE.Mesh(beardGeo(THREE), M.beard));

  /* nose — broad, rounded tip, the profile's second strongest read */
  const nose = new THREE.Mesh(loft(THREE, [
    ring(0.034, 0.014, 0.007, 7, { oz: HZ * 0.70 }),
    ring(0.008, 0.018, 0.012, 7, { oz: HZ * 0.80 }),
    ring(-0.018, 0.025, 0.017, 7, { oz: HZ * 0.92 }),
    ring(-0.038, 0.034, 0.021, 7, { oz: HZ * 1.00 }),
    ring(-0.052, 0.036, 0.017, 7, { oz: HZ * 0.95 }),
    ring(-0.061, 0.030, 0.010, 7, { oz: HZ * 0.82 })
  ]), M.skin);
  head.add(nose);

  /* lower lip, mostly framed by the moustache above it */
  const lip = new THREE.Mesh(loft(THREE, [
    ring(-0.104, 0.034, 0.007, 8, { oz: HZ * 0.76 }),
    ring(-0.118, 0.037, 0.011, 8, { oz: HZ * 0.79 }),
    ring(-0.132, 0.029, 0.007, 8, { oz: HZ * 0.75 })
  ]), M.lip);
  head.add(lip);

  /* the mouth line. In the reference frames every face carries one
     confident dark stroke for the mouth, and without it the beard
     just closes over the lip and the face has no expression at all.
     Its own thin mesh, so the ink pass draws it as a line. */
  head.add(faceMesh(THREE, lensGeo(THREE, {
    w: 0.0250, hUp: 0.0028, hDn: 0.0024, depth: 0.005, hood: 0.60
  }), M.mouth, 0, -0.612, 0.0135, [1, 1, 1], 0));

  /* ---------- eyes and brows ----------
     Every piece is its own mesh so every piece gets its own ink
     line. The stack, outermost first: a hooded LID in skin that
     overhangs the aperture, the dark IRIS filling most of what is
     left, and two slivers of white at the corners. Round white
     eyeballs with a dot in them were the single loudest wrong note
     in the last pass — at this scale his eye is a dark lens under a
     heavy lid, not a cartoon ball.

     AZ is pulled in from 0.400: the eyes were also set too wide,
     out past the socket and onto the temple. */
  const EYE_AZ = 0.352, EYE_EL = -0.012;
  const eyeWhiteGeo = lensGeo(THREE, { w: 0.0230, hUp: 0.0078, hDn: 0.0076, depth: 0.006, hood: 0.55 });
  const irisGeo = lensGeo(THREE, { w: 0.0186, hUp: 0.0074, hDn: 0.0076, depth: 0.005, hood: 0.74 });
  const lidGeo = lensGeo(THREE, { w: 0.0292, hUp: 0.0150, hDn: 0.0060, depth: 0.007, hood: 0.92 });
  const browGeo = lensGeo(THREE, { w: 0.0320, hUp: 0.0042, hDn: 0.0042, depth: 0.007, hood: 0.72, drop: -0.0030 });
  for (const side of [1, -1]) {
    const AZ = side * EYE_AZ;
    /* the aperture, tilted so the OUTER corner sits lower — the
       downward outer slant is most of why his eyes read as his */
    const roll = -side * 0.115;
    head.add(faceMesh(THREE, eyeWhiteGeo, M.eye, AZ, EYE_EL, 0.0012, [1, 1, 1], roll));
    /* iris nudged toward the nose and sat high in the aperture, so
       the lid crops its top exactly as a real hooded eye does */
    head.add(faceMesh(THREE, irisGeo, M.iris, AZ - side * 0.014, EYE_EL + 0.004, 0.0034, [1, 1, 1], roll));
    /* the hood: skin, overhanging the top third of the eye */
    head.add(faceMesh(THREE, lidGeo, M.skin, AZ, EYE_EL + 0.058, 0.0018, [1, 1, 1], roll));
    /* the brow — thin, short, low and close over the lid, with the
       outer third turning down. Not the heavy floating bar of the
       last pass, which sat a whole forehead too high. */
    head.add(faceMesh(THREE, browGeo, M.brow, side * 0.378, 0.132, 0.0032, [1, 1, 1], -side * 0.13));
  }

  /* ---------- the hair ----------
     The cap first, then the ropes. The ropes are merged into two
     meshes — one short band, one long — rather than fifty, because
     fifty meshes is fifty draw calls and a hundred with the ink
     pass. They still get fifty separate outlines: the merged
     geometry's shells are disjoint, so the inverted hull inflates
     each rope on its own normals. Two bands rather than one only
     so the long twists can lag further behind the short ones when
     he moves. */
  const hair = new THREE.Group();
  hair.position.y = -HEAD_Y;            /* hair is authored in world Y */
  head.add(hair);
  hair.add(new THREE.Mesh(capGeo(THREE), M.hair));

  const swayBands = [];
  if (opts.strands !== 0) {
    const ropes = ropeLayout();
    const bands = [[], []];
    for (const r of ropes) bands[r.hang > 0.245 ? 1 : 0].push(ropeGeo(THREE, r));
    bands.forEach((geos, i) => {
      if (!geos.length) return;
      const g = new THREE.Group();
      g.position.y = HEAD_Y;            /* pivot at the head's centre */
      const m = new THREE.Mesh(mergeGeos(THREE, geos), M.hair);
      m.position.y = -HEAD_Y;
      g.add(m);
      hair.add(g);
      swayBands.push({ g, w: i ? 1 : 0.55 });
    });
  }

  /* ============================================================
     ANIMATION
     A real cycle: legs alternating with a knee that folds on the
     swing, arms counter-swinging, two bobs per stride, the torso
     leaning into travel and the pelvis rolling under it. Without
     these the figure slides; with them it walks.
     ============================================================ */
  const P = {
    idle: { leg: 0.026, knee: 0.10, arm: 0.050, bob: 0.003, lean: 0.008, cad: 0.30, elbow: 0.14, roll: 0.010 },
    walk: { leg: 0.430, knee: 0.86, arm: 0.400, bob: 0.012, lean: 0.048, cad: 0.92, elbow: 0.30, roll: 0.050 },
    run: { leg: 0.560, knee: 1.58, arm: 0.920, bob: 0.048, lean: 0.230, cad: 1.62, elbow: 1.05, roll: 0.080 }
  };
  const LEG_LEN = THIGH_D + SHIN_D + 0.115;
  let cur = Object.assign({}, P.idle);
  let state = "idle", locked = false;
  let phase = 0, t = 0, bobV = 0, prevBob = 0, sway = 0, swayV = 0;

  function setAnimation(s) {
    if (P[s]) { state = s; locked = true; }
    else if (s === "auto") locked = false;
  }

  function update(dt, speed) {
    dt = clamp(dt || 0, 0, 0.1);
    t += dt;
    const sp = Math.abs(speed || 0);
    if (!locked) state = sp < 0.12 ? "idle" : sp < 2.6 ? "walk" : "run";
    const tgt = P[state];
    const k = 1 - Math.exp(-dt * 7);
    for (const key in tgt) cur[key] += (tgt[key] - cur[key]) * k;

    /* cadence rises with speed, but never runs away */
    const drive = state === "idle" ? cur.cad : cur.cad * (0.55 + clamp(sp / 2.2, 0, 1.6));
    phase += dt * drive * TAU;
    if (phase > TAU) phase -= TAU;
    pose(dt);
  }

  /* Writing the pose is separate from advancing the clock, so a
     caller that owns its own stride phase (the world drives the
     cycle off distance travelled, not off time) can set the phase
     and see it on the SAME frame. When these were one function,
     setPhase only took effect a frame late and the feet skated. */
  function pose(dt) {
    const s1 = Math.sin(phase);
    /* Two things happen twice per stride and they pull opposite ways:
       swinging a rigid leg forward lifts its foot, so the hips must
       drop by the same amount or the figure walks on air — and a run
       adds a bounce on top of that, which is its flight phase. */
    const swung = LEG_LEN * (1 - Math.cos(cur.leg)) * 0.80;
    const beat = (1 - Math.cos(phase * 2)) * 0.5;      /* 0 passing, 1 spread */
    /* The drop is geometry — spread legs are shorter than straight
       ones, so the hips MUST come down by the same amount or he
       walks on air. The lift is the run's flight phase, and it is
       the thing that makes a run look like a run rather than a fast
       walk. The old line multiplied both by `beat`, so they
       cancelled and the whole cycle had almost no vertical travel
       at all. They pull on opposite halves of the stride now. */
    const bob = cur.bob * (1 - beat) - swung * beat;
    body.position.y = bob;
    /* Lean INTO travel. The model faces +Z — the nose is built at
       +Z — and a positive rotation about X tips the top toward +Z,
       so the old minus sign had him sprinting leaning backwards. */
    body.rotation.x = cur.lean + (state === "idle" ? Math.sin(t * 0.9) * 0.004 : 0);

    /* pelvis rolls and counter-yaws under the ribcage */
    pelvis.rotation.z = cur.roll * s1;
    pelvis.rotation.y = -cur.roll * 0.9 * s1;
    spine.rotation.y = cur.roll * 1.4 * s1;
    spine.rotation.z = -cur.roll * 0.4 * s1;

    for (const L of legs) {
      const ph = L.side > 0 ? phase : phase + Math.PI;
      const s = Math.sin(ph);
      L.hip.rotation.x = cur.leg * s;
      /* the knee folds through the swing, straightens at contact */
      const fold = clamp(0.5 - 0.5 * Math.cos(ph + 1.15), 0, 1);
      L.kn.rotation.x = -cur.knee * (0.10 + 0.90 * fold * fold);
      L.an.rotation.x = cur.leg * 0.45 * Math.sin(ph + 2.3) + 0.05;
    }
    for (const A of arms) {
      const ph = A.side > 0 ? phase + Math.PI : phase;
      const s = Math.sin(ph);
      A.sh.rotation.x = cur.arm * s;
      A.sh.rotation.z = A.side * 0.105;
      A.el.rotation.x = -cur.elbow * (0.45 + 0.55 * clamp(0.5 - 0.5 * Math.cos(ph + 0.6), 0, 1));
    }

    /* The head steadies against the lean and against the bob, which
       is most of why a walk cycle reads as a person rather than a
       puppet — he looks where he is going, he does not stare at the
       ground because his chest is tipped. */
    neckJoint.rotation.x = -cur.lean * 0.74 - 0.10 * cur.roll * Math.cos(phase * 2);
    neckJoint.rotation.y = -cur.roll * 0.8 * s1;

    if (!reduced && dt > 0 && swayBands.length) {
      /* the hair lags: a spring driven by the bob's velocity and
         by how hard the body is leaning into travel. The long band
         swings nearly twice as far as the short one, which is most
         of what makes a run read as a run from behind. */
      const v = (bob - prevBob) / Math.max(dt, 1e-4);
      prevBob = bob;
      bobV += (v - bobV) * (1 - Math.exp(-dt * 12));
      const target = clamp(-bobV * 0.10 - cur.lean * 0.70, -0.40, 0.40);
      swayV += (target - sway) * dt * 48 - swayV * dt * 8;
      sway += swayV * dt;
      for (const b of swayBands) {
        b.g.rotation.x = sway * b.w + Math.sin(t * 1.6 + b.w * 2.1) * 0.010 * b.w;
        b.g.rotation.z = -spine.rotation.y * 0.35 * b.w;
      }
    }
  }

  function setTint(next = {}) {
    if (next.shirt !== undefined && next.hoodie === undefined) next = Object.assign({}, next, { hoodie: next.shirt });
    for (const key in next) {
      if (!M[key]) continue;
      M[key].color.set(next[key]);
      tint[key] = next[key];
    }
  }

  function dispose() {
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const key in M) M[key].dispose();
  }

  /* pin the cycle to a point in the stride — used by the render
     harness to lay out a contact sheet, and by the world, which
     drives the stride off distance walked so the feet do not skate.
     It re-poses immediately: a phase that only lands next frame is
     a phase the caller cannot actually control. */
  function setPhase(frac) {
    phase = ((frac % 1) + 1) % 1 * TAU;
    pose(0);
  }

  /* Snap the blend weights to a state instead of easing into it —
     the contact sheet needs a fully-committed run pose from one
     call, not the 10% of one a single frame of easing gives. */
  function snapTo(s) {
    if (!P[s]) return;
    state = s; locked = true;
    cur = Object.assign({}, P[s]);
    pose(0);
  }

  update(0, 0);

  /* Opt-in, and default ON: the merge is transform-identical by
     construction, so the only reason to refuse it is a caller that
     wants to reach individual sub-meshes by hand. */
  /* staticPose collapses the whole figure to one mesh per material and
     gives up joint articulation; it is for standing crowds only. The
     pose is frozen at whatever `update` above settled on, so a
     flattened figure stands in the same rest pose an articulated one
     would. */
  let batched;
  if (opts.staticPose) {
    setAnimation("idle");
    update(0, 0);
    batched = flattenStatic(THREE, group);
  } else {
    batched = opts.merge === false ? { before: 0, after: 0 } : mergeSiblings(THREE, group);
  }

  return {
    group,
    batched,
    frozen: !!opts.staticPose,
    update,
    setAnimation,
    snapTo,
    setTint,
    setPhase,
    dispose,
    meta: { triangles: triCount(group), height: H, tint }
  };
}

export default buildFellow;
