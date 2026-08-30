/* ============================================================
   UPRISE LANDMARKS — the real buildings, drawn as comics.

   Two places on the Heal the 3 planet are not invented: Bridgeport
   City Hall at 45 Lyon Terrace, and the Connecticut Legislative
   Office Building in Hartford. Both are modelled here from the
   reference photographs in assets/landmarks/, measured off the
   street elevations and the aerials — column count, bay rhythm,
   storey heights, roof form and plan shape are read from the
   pictures, not guessed.

   They are then DRAWN, not rendered: MeshToonMaterial with a
   three-band gradient map on NearestFilter, flat shading, flat
   pastel fills, and a silhouette built to survive a thick black
   OutlineEffect pass. Accuracy lives in the proportion and the
   silhouette; the surface is ink and flat colour.

   Nothing here touches a scene, a renderer or a camera. Each
   builder returns a Group standing on y = 0 with +Z as its front,
   already scaled to world units, carrying userData.footprint (the
   radius the engine should use for the check-in ring).

       import { build, SLUGS } from "./uprise-landmarks.js";
       const g = build("bridgeport-city-hall", THREE);

   Buildings with no reference photographs are deliberately absent.
   Inventing a landmark is worse than not shipping one.
   ============================================================ */

import * as THREE_DEFAULT from "../vendor/three.module.min.js";

export const SLUGS = ["bridgeport-city-hall", "ct-legislative-office-building", "georgia-state-capitol", "docket-516"];

/* ------------------------------------------------------------------
   CEL SHADING KIT
   A 3x1 RGBA ramp sampled with NearestFilter is the whole trick: any
   filtering other than NEAREST interpolates the bands back into a
   gradient and the drawing turns into a render. Weighted bright so
   most of every surface is one flat tone with a single shadow step.
   ------------------------------------------------------------------ */
const KITS = new WeakMap();

function kit(THREE) {
  let k = KITS.get(THREE);
  if (k) return k;
  const data = new Uint8Array([
    0x40, 0x40, 0x40, 255,
    0xa0, 0xa0, 0xa0, 255,
    0xff, 0xff, 0xff, 255
  ]);
  const ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.magFilter = THREE.NearestFilter;
  ramp.minFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  k = { ramp, mats: new Map() };
  KITS.set(THREE, k);
  return k;
}

/* one material per colour, shared across every mesh that uses it —
   fewer programs, fewer state changes, and the outline pass caches
   its companion material per source material. */
function cel(THREE, hex, opts = {}) {
  const k = kit(THREE);
  const key = hex + "|" + (opts.side || 0) + "|" + (opts.opacity == null ? 1 : opts.opacity)
    + "|" + (opts.ink == null ? "d" : opts.ink);
  let m = k.mats.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({
    color: hex,
    gradientMap: k.ramp,
    side: opts.side || THREE.FrontSide,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity == null ? 1 : opts.opacity
  });
  /* Material.setValues silently drops flatShading, so it has to be
     assigned after construction or the whole look is lost. */
  m.flatShading = true;
  /* the ink weight travels with the material, so the buildings look
     the same whatever the host scene sets as its OutlineEffect
     default. Thickness is clip-space, so it holds up at any distance. */
  m.userData.outlineParameters = {
    thickness: opts.ink == null ? 0.008 : opts.ink,
    color: [0, 0, 0],
    alpha: 1,
    visible: true,
    keepAlive: true
  };
  k.mats.set(key, m);
  return m;
}

/* ------------------------------------------------------------------
   SMALL GEOMETRY HELPERS
   ------------------------------------------------------------------ */

function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }

/* a box placed by centre */
function box(THREE, w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return shadowed(m);
}

/* an InstancedMesh from [x,y,z,rx,ry,rz,sx,sy,sz] rows */
function inst(THREE, geo, mat, rows) {
  const im = new THREE.InstancedMesh(geo, mat, rows.length);
  const o = new THREE.Object3D();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    o.position.set(r[0], r[1], r[2]);
    o.rotation.set(r[3] || 0, r[4] || 0, r[5] || 0);
    o.scale.set(r[6] == null ? 1 : r[6], r[7] == null ? 1 : r[7], r[8] == null ? 1 : r[8]);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  }
  im.instanceMatrix.needsUpdate = true;
  return shadowed(im);
}

/* A wall with REAL openings. The holes are cut in the shape before
   extrusion, so the jambs and reveals are geometry: light falls into
   them and the outline pass inks them. Painted-on rectangles were
   the single worst tell of the placeholder pass. */
function wall(THREE, w, h, t, holes, mat) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  for (const [cx, y0, hw, hh] of holes) {
    const p = new THREE.Path();
    p.moveTo(cx - hw / 2, y0);
    p.lineTo(cx - hw / 2, y0 + hh);
    p.lineTo(cx + hw / 2, y0 + hh);
    p.lineTo(cx + hw / 2, y0);
    p.closePath();
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -t);          /* outer face lands on z = 0 */
  return shadowed(new THREE.Mesh(g, mat));
}

/* hipped roof: ridge running along X, eaves at y=0, ridge at y=h */
function hipRoof(THREE, w, d, h, ridgeFrac, mat) {
  const rx = (w / 2) * (ridgeFrac == null ? 0.55 : ridgeFrac);
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,   /* 0..3 eaves */
    -rx, h, 0, rx, h, 0                               /* 4,5 ridge   */
  ];
  const f = [
    3, 2, 5, 3, 5, 4,      /* front slope (+z) */
    1, 0, 4, 1, 4, 5,      /* back slope  (-z) */
    0, 3, 4,               /* left hip */
    2, 1, 5                /* right hip */
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(f);
  g.computeVertexNormals();
  return shadowed(new THREE.Mesh(g, mat));
}

/* ------------------------------------------------------------------
   A 5x7 INKED CAPITAL ALPHABET
   Used for the two inscriptions that are actually carved on these
   buildings: CITY HALL in Bridgeport's frieze and LEGISLATIVE OFFICE
   BUILDING around the Hartford drum. Merged into a single geometry
   per inscription so it is one draw call, while the outline pass
   still inks each letter separately (the hull expands per island).
   ------------------------------------------------------------------ */
const FONT = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01110",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "11111 00100 00100 00100 00100 00100 11111",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10001 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10001 10101 11011 10001",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  " ": "00000 00000 00000 00000 00000 00000 00000"
};

/* letter cells as [dx, dy] unit squares, origin at the letter's
   bottom-left, y up */
function glyph(ch) {
  const rows = (FONT[ch] || FONT[" "]).split(" ");
  const out = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 5; c++)
      if (rows[r][c] === "1") out.push([c, 6 - r]);
  return out;
}

/* Straight inscription in the XY plane, letters facing +Z.
   Returns a merged BufferGeometry (or null for an empty string). */
function inscription(THREE, text, px, depth) {
  const cell = px;                 /* size of one font pixel */
  const adv = 6 * cell;            /* 5 wide + 1 space */
  const parts = [];
  const total = text.length * adv - cell;
  let x0 = -total / 2;
  for (const ch of text.toUpperCase()) {
    for (const [dx, dy] of glyph(ch)) {
      const g = new THREE.BoxGeometry(cell * 1.06, cell * 1.06, depth);
      g.translate(x0 + (dx + 0.5) * cell, (dy + 0.5) * cell, depth / 2);
      parts.push(g);
    }
    x0 += adv;
  }
  return parts.length ? mergeGeoms(THREE, parts) : null;
}

/* Inscription bent around a cylinder of radius r, centred on angle
   a0 (measured from +Z), letters standing on the outside facing out. */
function arcInscription(THREE, text, r, px, depth, a0) {
  const cell = px;
  const adv = 6 * cell;
  const total = text.length * adv - cell;
  const parts = [];
  const m = new THREE.Matrix4();
  let s = -total / 2;
  for (const ch of text.toUpperCase()) {
    for (const [dx, dy] of glyph(ch)) {
      const along = s + (dx + 0.5) * cell;
      const a = a0 + along / r;   /* +X is screen-right from the front */
      const g = new THREE.BoxGeometry(cell * 1.08, cell * 1.08, depth);
      g.translate(0, (dy + 0.5) * cell, r + depth / 2);
      m.makeRotationY(a);
      g.applyMatrix4(m);
      parts.push(g);
    }
    s += adv;
  }
  return parts.length ? mergeGeoms(THREE, parts) : null;
}

/* minimal non-indexed merge — avoids pulling in BufferGeometryUtils */
function mergeGeoms(THREE, geos) {
  let n = 0;
  const flat = geos.map(g => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

/* ------------------------------------------------------------------
   SHARED PROPS
   The reference art sells its buildings with stuck-on hand-drawn
   clutter — AC boxes, vents, dishes, cables. Same idea here, in the
   places the photographs actually show them (rooftop plant, lamps,
   flagpole, bollards).
   ------------------------------------------------------------------ */

function acUnit(THREE, pal, w = 1.6, h = 1.0, d = 1.2) {
  const g = new THREE.Group();
  g.add(box(THREE, w, h, d, pal.prop, 0, h / 2, 0));
  g.add(box(THREE, w * 0.62, 0.14, d * 0.62, pal.propDark, 0, h + 0.07, 0));
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.26, w * 0.26, 0.12, 10), pal.propDark);
  fan.position.set(0, h + 0.16, 0);
  g.add(shadowed(fan));
  return g;
}

function dish(THREE, pal, r = 1.0) {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.1, 6), pal.propDark);
  mast.position.y = 0.55; g.add(shadowed(mast));
  const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.72, 0.26, 12), pal.prop);
  d.position.set(0, 1.3, 0); d.rotation.set(Math.PI * 0.32, 0, 0); g.add(shadowed(d));
  return g;
}

function vent(THREE, pal, r = 0.42, h = 1.1) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), pal.prop);
  c.position.y = h / 2; g.add(shadowed(c));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.1, 0.24, 8), pal.propDark);
  cap.position.y = h + 0.1; g.add(shadowed(cap));
  return g;
}

function lampPost(THREE, pal, h = 4.2) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, h, 7), pal.propDark);
  p.position.y = h / 2; g.add(shadowed(p));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.26, 0.72, 6), pal.lampGlass);
  head.position.y = h + 0.3; g.add(shadowed(head));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.34, 6), pal.propDark);
  cap.position.y = h + 0.82; g.add(shadowed(cap));
  return g;
}

/* ==================================================================
   1. BRIDGEPORT CITY HALL — 45 Lyon Terrace
   ==================================================================
   Read off the photographs:

   street-02 / street-01 (front three-quarter)
     - three storeys over a low rusticated basement, no more
     - the entablature runs STRAIGHT across the centre: there is no
       pediment. What crowns it is a heavy modillion cornice topped
       by a continuous row of upright terracotta antefixes — that
       sawtooth line along the sky is the building's signature and
       the placeholder had nothing like it
     - the centre pavilion is a shallow projection whose cornice sits
       about a metre and a half above the wings', with CITY HALL
       carved into its frieze
     - the portico is FOUR free-standing Ionic columns between two
       square antae: five bays, and the middle bay is the tall
       diamond-lattice stair window over the entrance. Counted on the
       aerial (aerial-01, where the shafts and the five dark voids
       are unambiguous) and confirmed against the street shots
     - the columns are a giant order: they stand on the terrace and
       run the full height of all three storeys to the entablature
     - the wings are a tight rhythm of tall windows with narrow
       piers, and each ends in a blank corner pier

   aerial-01 / aerial-03 (massing)
     - a long front range with a deep central rear wing behind the
       portico, and shorter rear returns at each end
     - low hipped roofs in dark slate, a flagpole over the centre
   ================================================================== */

const BCH = {
  W: 92,            /* front range width  */
  D: 20,            /* front range depth  */
  PAV_W: 20,        /* centre pavilion    */
  PAV_OUT: 1.9,     /* how far it projects*/
  BAY: 4.0,         /* window bay pitch   */
  Y_GRADE: 0,
  Y_BASE: 1.9,      /* top of the rusticated basement */
  Y_S2: 6.7,        /* first floor -> second */
  Y_S3: 12.3,
  Y_TOP: 15.9,      /* top of the third storey wall */
  Y_ENT: 18.5,      /* top of the wing entablature   */
  PAV_LIFT: 1.5     /* centre entablature rises this much */
};

function bridgeportCityHall(THREE) {
  const P = {
    stone: cel(THREE, 0xd9d1c1),
    stoneLit: cel(THREE, 0xeae4d6),
    stoneDim: cel(THREE, 0xb4ab99),
    base: cel(THREE, 0xa9a091),
    roof: cel(THREE, 0x6c667a),
    roofDim: cel(THREE, 0x59546a),
    glass: cel(THREE, 0x4a555e, { ink: 0.004 }),
    dark: cel(THREE, 0x33383e),
    door: cel(THREE, 0x8c5a46),
    prop: cel(THREE, 0xc9c3b6),
    propDark: cel(THREE, 0x5a5f66),
    lampGlass: cel(THREE, 0xf0e2b4),
    flag: cel(THREE, 0xe5383b),
    hedge: cel(THREE, 0x7f9c6c)
  };
  const g = new THREE.Group();
  const B = BCH;
  const zF = B.D / 2;                       /* front wall plane */
  const wingW = (B.W - B.PAV_W) / 2;        /* 36 each side     */

  /* ---- window schedule -------------------------------------------------
     Three rows. Ground windows square-ish, the piano nobile tall, the
     third storey short and tucked under the cornice — exactly the
     proportion in bch-front. */
  const ROWS = [
    { y: B.Y_BASE + 0.9, h: 3.2, w: 2.5 },   /* ground  */
    { y: B.Y_S2 + 0.7, h: 4.3, w: 2.5 },   /* second: the tall one */
    { y: B.Y_S3 + 0.6, h: 2.4, w: 2.5 }    /* third   */
  ];

  /* bay centres for one wing. Nine bays at 3.7 leaves a blank corner
     pier at the outer end, which is what the east elevation shows. */
  const wingBays = [];
  for (let i = 0; i < 9; i++) wingBays.push((i - 4) * 3.7);

  const holesFor = (bays) => {
    const h = [];
    for (const x of bays) for (const r of ROWS) h.push([x, r.y, r.w, r.h]);
    return h;
  };

  /* every opening also gets a dark pane set back inside its reveal, so
     the windows read as the flat dark rectangles the reference art
     uses while still being genuinely recessed */
  const panes = [];
  const pane = (hs, px, pz, ry, back) => {
    for (const [hx, hy, hw, hh] of hs) {
      const s = Math.sin(ry), c = Math.cos(ry);
      panes.push([px + hx * c, hy + hh / 2, pz - hx * s, 0, ry, 0, hw - 0.12, hh - 0.12, back]);
    }
  };

  /* ---- the two front wings -------------------------------------------- */
  for (const sgn of [-1, 1]) {
    const cx = sgn * (B.PAV_W / 2 + wingW / 2);
    const hs = holesFor(wingBays);
    const w = wall(THREE, wingW, B.Y_TOP, 1.5, hs, P.stone);
    w.position.set(cx, 0, zF);
    g.add(w);
    pane(hs, cx, zF - 0.85, 0, 0.5);

    /* end wall of the wing */
    const ehs = holesFor([-B.D / 2 + 4.0, -B.D / 2 + 8.0, B.D / 2 - 8.0, B.D / 2 - 4.0]);
    const ew = wall(THREE, B.D, B.Y_TOP, 1.5, ehs, P.stone);
    ew.position.set(sgn * B.W / 2, 0, 0);
    ew.rotation.y = sgn * Math.PI / 2;
    g.add(ew);
    for (const [hx, hy, hw, hh] of ehs)
      panes.push([sgn * (B.W / 2 - 0.85), hy + hh / 2, sgn * -hx, 0, sgn * Math.PI / 2,
        0, hw - 0.12, hh - 0.12, 0.5]);
  }

  /* the block behind the facades */
  g.add(box(THREE, B.W - 4.4, B.Y_TOP, B.D - 4.4, P.stoneDim, 0, B.Y_TOP / 2, 0));

  /* rusticated basement — a slightly proud plinth the whole way round */
  g.add(box(THREE, B.W + 1.0, B.Y_BASE, B.D + 1.0, P.base, 0, B.Y_BASE / 2, 0));

  /* ---- the centre pavilion -------------------------------------------- */
  const pz = zF + B.PAV_OUT;
  const yEntP = B.Y_ENT + B.PAV_LIFT;

  /* the pavilion's side returns, read as piers */
  for (const sgn of [-1, 1]) {
    g.add(box(THREE, 1.6, B.Y_TOP + B.PAV_LIFT, B.PAV_OUT + 0.4, P.stone,
      sgn * (B.PAV_W / 2 - 0.8), (B.Y_TOP + B.PAV_LIFT) / 2, zF + B.PAV_OUT / 2));
  }

  /* recessed back wall of the loggia: four side bays of ordinary
     windows, and the great lattice opening on the centre line */
  const loggiaHoles = [];
  for (const x of [-8, -4, 4, 8]) for (const r of ROWS) loggiaHoles.push([x, r.y, r.w, r.h]);
  loggiaHoles.push([0, 3.6, 3.4, 10.8]);         /* stair window */
  loggiaHoles.push([0, 0.4, 2.8, 3.0]);          /* entrance     */
  const back = wall(THREE, B.PAV_W - 1.6, B.Y_TOP + B.PAV_LIFT, 1.2, loggiaHoles, P.stoneDim);
  back.position.set(0, 0, zF + 0.35);
  g.add(back);
  for (const [hx, hy, hw, hh] of loggiaHoles)
    if (hw < 3) panes.push([hx, hy + hh / 2, zF - 0.35, 0, 0, 0, hw - 0.12, hh - 0.12, 0.5]);

  /* the lattice itself — a real grille, inked as a diamond mesh */
  {
    const bars = [];
    for (let i = 0; i <= 6; i++) bars.push([(i - 3) * 0.52, 3.6 + 5.4, 0, 0, 0, 0, 0.14, 10.6, 0.16]);
    for (let j = 0; j <= 13; j++) bars.push([0, 3.6 + j * 0.8, 0, 0, 0, 0, 3.3, 0.14, 0.16]);
    const grille = inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.stoneDim, bars);
    grille.position.set(0, 0, zF + 0.05);
    g.add(grille);
    const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 10.8), P.dark);
    backGlass.position.set(0, 3.6 + 5.4, zF - 0.5);
    g.add(shadowed(backGlass));
  }

  /* the door */
  g.add(box(THREE, 2.6, 2.9, 0.3, P.door, 0, 1.75, zF + 0.25));

  /* ---- the portico order ------------------------------------------------
     Four Ionic shafts at x = +/-2 and +/-6 with antae at +/-9.2, giving
     five bays with the stair window on the centre line. Sixteen radial
     segments read as flutes once flat-shaded. */
  const COL_Y0 = B.Y_BASE + 0.3;
  const COL_H = yEntP - 1.35 - COL_Y0;
  const colXs = [-6, -2, 2, 6];
  const colZ = pz - 0.55;
  {
    const shaft = new THREE.CylinderGeometry(0.86, 0.96, COL_H, 16, 1, true);
    g.add(inst(THREE, shaft, P.stoneLit, colXs.map(x => [x, COL_Y0 + COL_H / 2, colZ])));

    /* base and the Ionic capital: an echinus block with two volute rolls */
    const bs = new THREE.CylinderGeometry(1.12, 1.24, 0.55, 16);
    g.add(inst(THREE, bs, P.stoneLit, colXs.map(x => [x, COL_Y0 + 0.28, colZ])));
    const abacus = new THREE.BoxGeometry(2.3, 0.42, 2.3);
    g.add(inst(THREE, abacus, P.stoneLit, colXs.map(x => [x, COL_Y0 + COL_H + 0.55, colZ])));
    const roll = new THREE.CylinderGeometry(0.58, 0.58, 2.5, 10);
    g.add(inst(THREE, roll, P.stoneLit,
      colXs.map(x => [x, COL_Y0 + COL_H + 0.05, colZ, 0, 0, Math.PI / 2])));

    /* the two antae closing the colonnade */
    for (const sgn of [-1, 1]) {
      g.add(box(THREE, 1.7, COL_H + 0.9, 1.7, P.stoneLit, sgn * 9.15, COL_Y0 + (COL_H + 0.9) / 2, colZ));
    }
    /* the portico floor / top step */
    g.add(box(THREE, B.PAV_W + 1.2, 0.4, B.PAV_OUT + 2.4, P.stoneLit, 0, B.Y_BASE + 0.1, zF + 0.9));
  }

  /* ---- entablature + cornice + antefixes -------------------------------
     Architrave, frieze, then a corona carried on close-spaced
     modillions, then the antefix cresting. This whole assembly is the
     thing that makes the building read at a glance. */
  const runs = [];   /* [cx, cz, len, axis] round the front range */
  runs.push([0, zF, B.W, "x"]);
  runs.push([0, -B.D / 2, B.W, "x"]);
  runs.push([-B.W / 2, 0, B.D, "z"]);
  runs.push([B.W / 2, 0, B.D, "z"]);

  const entab = (y, cx, cz, len, axis, mat) => {
    const sx = axis === "x" ? len : 1.5;
    const sz = axis === "x" ? 1.5 : len;
    g.add(box(THREE, sx, 0.55, sz, mat, cx, y + 0.27, cz));                       /* architrave */
    g.add(box(THREE, axis === "x" ? len - 0.3 : 1.2, 1.15, axis === "x" ? 1.2 : len - 0.3,
      P.stoneDim, cx, y + 1.12, cz));                                             /* frieze     */
    g.add(box(THREE, axis === "x" ? len + 0.9 : 3.3, 0.95, axis === "x" ? 3.3 : len + 0.9,
      mat, cx, y + 2.17, cz));                                                    /* corona     */
  };

  for (const [cx, cz, len, axis] of runs) entab(B.Y_TOP, cx, cz, len, axis, P.stoneLit);

  /* modillions under the corona */
  {
    const rows = [];
    const step = 1.25;
    for (const [cx, cz, len, axis] of runs) {
      const n = Math.floor(len / step);
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * step;
        if (axis === "x") {
          if (Math.abs(cx + t) < B.PAV_W / 2 && cz > 0) continue;   /* pavilion has its own */
          rows.push([cx + t, B.Y_TOP + 1.66, cz + (cz > 0 ? 1.35 : -1.35)]);
        } else {
          rows.push([cx + (cx > 0 ? 1.35 : -1.35), B.Y_TOP + 1.66, cz + t]);
        }
      }
    }
    g.add(inst(THREE, new THREE.BoxGeometry(0.44, 0.5, 1.0), P.stoneLit, rows));
  }

  /* antefix cresting — the sawtooth on the sky */
  const antefixRows = [];
  const pushAntefixes = (cx, cz, len, axis, y, skipPav) => {
    const step = 1.25;
    const n = Math.floor(len / step);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * step;
      if (axis === "x") {
        if (skipPav && Math.abs(cx + t) < B.PAV_W / 2 + 0.6) continue;
        antefixRows.push([cx + t, y, cz + (cz > 0 ? 1.5 : -1.5), 0, 0, 0]);
      } else {
        antefixRows.push([cx + (cx > 0 ? 1.5 : -1.5), y, cz + t, 0, Math.PI / 2, 0]);
      }
    }
  };
  for (const [cx, cz, len, axis] of runs) pushAntefixes(cx, cz, len, axis, B.Y_ENT + 0.3, cz > 0);

  /* ---- the pavilion's own entablature, lifted, with CITY HALL --------- */
  {
    const y = B.Y_TOP + B.PAV_LIFT;
    g.add(box(THREE, B.PAV_W + 1.2, 0.6, B.PAV_OUT + 2.0, P.stoneLit, 0, y + 0.3, zF + 0.7));
    g.add(box(THREE, B.PAV_W + 0.8, 1.35, B.PAV_OUT + 1.7, P.stoneDim, 0, y + 1.28, zF + 0.6));
    g.add(box(THREE, B.PAV_W + 2.0, 0.9, B.PAV_OUT + 2.6, P.stoneLit, 0, y + 2.38, zF + 0.8));
    const txt = inscription(THREE, "CITY HALL", 0.155, 0.09);
    if (txt) {
      const t = shadowed(new THREE.Mesh(txt, P.dark));
      t.position.set(0, y + 0.76, zF + B.PAV_OUT + 0.9);
      g.add(t);
    }
    pushAntefixes(0, zF + 0.8, B.PAV_W + 2.0, "x", y + 2.94, false);
  }

  g.add(inst(THREE, new THREE.ConeGeometry(0.3, 0.62, 3), P.stoneLit, antefixRows));

  /* ---- rear wings ------------------------------------------------------
     aerial-03 shows a deep block behind the portico and shorter
     returns at each end. */
  const rearD = 30, rearW = 24;
  g.add(box(THREE, rearW, B.Y_TOP, rearD, P.stone, 0, B.Y_TOP / 2, -B.D / 2 - rearD / 2 + 1));
  {
    const holes = [];
    for (let i = 0; i < 6; i++) for (const r of ROWS) holes.push([(i - 2.5) * 4.4, r.y, 2.0, r.h]);
    const zc = -B.D / 2 - rearD / 2 + 1;
    for (const sgn of [-1, 1]) {
      const rw = wall(THREE, rearD - 2, B.Y_TOP, 1.2, holes, P.stone);
      rw.position.set(sgn * rearW / 2, 0, zc);
      rw.rotation.y = sgn * Math.PI / 2;
      g.add(rw);
      for (const [hx, hy, hw, hh] of holes)
        panes.push([sgn * (rearW / 2 - 0.7), hy + hh / 2, zc - sgn * hx, 0, sgn * Math.PI / 2,
          0, hw - 0.12, hh - 0.12, 0.5]);
    }
  }
  for (const sgn of [-1, 1]) {
    g.add(box(THREE, 17, B.Y_TOP, 20, P.stone, sgn * (B.W / 2 - 8.5), B.Y_TOP / 2, -B.D / 2 - 9));
  }

  /* ---- roofs ------------------------------------------------------------
     Low hips: from the pavement you should see barely a sliver of
     slate above the cornice, which is exactly what the street shots
     show. The first pass had them steep enough to read as a chalet. */
  {
    const zRear = -B.D / 2 - rearD / 2 + 1;
    g.add(box(THREE, B.W - 1.4, 0.6, B.D - 1.4, P.roofDim, 0, B.Y_ENT - 0.6, 0));
    g.add(box(THREE, rearW - 1.4, 0.6, rearD + 6, P.roofDim, 0, B.Y_ENT - 0.6, zRear + 2));
    for (const sgn of [-1, 1])
      g.add(box(THREE, 16, 0.6, 24, P.roofDim, sgn * (B.W / 2 - 8.5), B.Y_ENT - 0.6, -B.D / 2 - 7));
    const r1 = hipRoof(THREE, B.W - 1.4, B.D - 1.4, 1.7, 0.9, P.roof);
    r1.position.set(0, B.Y_ENT - 0.4, 0); g.add(r1);
    const r2 = hipRoof(THREE, rearW - 1.4, rearD - 1.4, 2.0, 0.55, P.roofDim);
    r2.position.set(0, B.Y_ENT - 0.4, -B.D / 2 - rearD / 2 + 1); g.add(r2);
    for (const sgn of [-1, 1]) {
      const r3 = hipRoof(THREE, 16, 19, 1.2, 0.5, P.roofDim);
      r3.position.set(sgn * (B.W / 2 - 8.5), B.Y_ENT - 0.4, -B.D / 2 - 9); g.add(r3);
    }
  }

  /* ---- terrace, steps, props ------------------------------------------- */
  g.add(box(THREE, B.W + 12, 0.75, 11, P.stoneDim, 0, 0.375, zF + 6.0));
  for (let i = 0; i < 5; i++)
    g.add(box(THREE, 26 - i * 0.8, 0.34, 1.1, P.stoneLit, 0, 0.17 + i * 0.34, zF + 4.2 + i * 1.1));

  /* rooftop plant, the flagpole from the aerial, and lamps at the door */
  {
    const a1 = acUnit(THREE, P, 2.2, 1.2, 1.6); a1.position.set(-26, B.Y_ENT + 0.4, -4); g.add(a1);
    const a2 = acUnit(THREE, P, 1.8, 1.0, 1.4); a2.position.set(24, B.Y_ENT + 0.4, -6); g.add(a2);
    const d1 = dish(THREE, P, 1.1); d1.position.set(30, B.Y_ENT + 0.4, -12); g.add(d1);
    for (const x of [-14, -8, 10, 18]) {
      const v = vent(THREE, P, 0.38, 1.0); v.position.set(x, B.Y_ENT + 0.4, -22); g.add(v);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 12, 7), P.stoneLit);
    mast.position.set(0, B.Y_ENT + 6.6, -14); g.add(shadowed(mast));
    const flag = box(THREE, 3.4, 2.1, 0.12, P.flag, 1.8, B.Y_ENT + 11.2, -14); g.add(flag);

    for (const x of [-5.2, 5.2]) {
      const l = lampPost(THREE, P, 3.0); l.position.set(x, B.Y_BASE + 0.3, zF + 3.4); g.add(l);
    }
    for (const x of [-30, -16, 16, 30]) {
      const l = lampPost(THREE, P, 4.4); l.position.set(x, 0.75, zF + 8.4); g.add(l);
    }

    /* downpipes and a notice board — the stuck-on clutter that makes a
       drawn building look inhabited rather than modelled */
    const pipes = [];
    for (const x of [-B.W / 2 + 1.4, -B.PAV_W / 2 - 1.2, B.PAV_W / 2 + 1.2, B.W / 2 - 1.4])
      pipes.push([x, B.Y_TOP / 2 + 0.6, zF + 0.35, 0, 0, 0, 1, B.Y_TOP - 1.2, 1]);
    g.add(inst(THREE, new THREE.CylinderGeometry(0.22, 0.22, 1, 6), P.propDark, pipes));
    g.add(box(THREE, 2.6, 1.8, 0.28, P.prop, -12, 2.6, zF + 0.4));
    g.add(box(THREE, 2.2, 1.4, 0.12, P.dark, -12, 2.6, zF + 0.56));

    /* a clipped hedge along the terrace edge */
    const hedge = [];
    for (let i = 0; i < 8; i++) hedge.push([-49 + i * 4.4, 1.05, zF + 10.4]);
    for (let i = 0; i < 8; i++) hedge.push([ 18 + i * 4.4, 1.05, zF + 10.4]);
    g.add(inst(THREE, new THREE.BoxGeometry(4.0, 1.2, 1.4), P.hedge, hedge));
  }

  /* string courses: a water table over the basement and a sill band
     under the tall second-storey windows, both of which the street
     photographs show running the whole way round */
  {
    const rows = [];
    for (const y of [B.Y_BASE, B.Y_S2, B.Y_S3]) {
      rows.push([0, y, zF + 0.16, 0, 0, 0, B.W, 0.4, 0.5]);
      rows.push([-B.W / 2 - 0.16, y, 0, 0, Math.PI / 2, 0, B.D, 0.4, 0.5]);
      rows.push([B.W / 2 + 0.16, y, 0, 0, Math.PI / 2, 0, B.D, 0.4, 0.5]);
    }
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.stoneLit, rows));
  }

  /* the recessed dark panes, in one instanced pass */
  g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.glass, panes));


  /* stand it on the ground, front to +Z, and shrink to world units */
  const outer = new THREE.Group();
  const S = 0.24;
  g.scale.setScalar(S);
  g.position.y = 0;
  outer.add(g);
  outer.userData.footprint = Math.hypot(B.W / 2 + 4, B.D / 2 + 32) * S;
  outer.userData.height = (B.Y_ENT + 12) * S;
  outer.userData.slug = "bridgeport-city-hall";
  outer.name = "bridgeport-city-hall";
  return outer;
}

/* ==================================================================
   2. CONNECTICUT LEGISLATIVE OFFICE BUILDING — Hartford, 1988
   ==================================================================
   Read off the photographs (note the asset filenames are shuffled:
   atrium-01.jpg is the aerial, aerial.jpg and exterior-front.jpg are
   the rotunda interiors, exterior-side.jpg is the entrance, and
   atrium-02.jpg is the long side elevation):

   the aerial
     - the plan is emphatically NOT a rectangle. It is a wide kite:
       a point at the north where the entrance sits, two long splayed
       flanks, and a broad tail. Traced off the copper roof band
     - a continuous oxidised-copper mansard band rings the whole roof
     - a circular glazed cone sits just inside the north point, plus
       two rectangular glazed roof lights further back, plus rooftop
       mechanical boxes

   exterior-side.jpg (the entrance)
     - a curved granite drum steps out of the facade: a colonnade of
       fat round piers around the doors, then a frieze band carved
       LEGISLATIVE OFFICE BUILDING, then a band of dark curved ribbon
       windows, then a deep smooth drum parapet
     - the glass pyramid rises directly behind and above it, red-brown
       mullions on dark glazing
     - the wall is banded: pale pink-grey granite in courses with
       darker salmon string courses, punched windows with red-brown
       surrounds

   atrium-02.jpg (the flank)
     - ground ribbon glazing, three punched storeys above it, then the
       green copper roof band

   aerial.jpg / exterior-front.jpg (the rotunda)
     - a circular five-level well: two levels of heavy pink granite
       piers, three of white columns with balcony rails, the glazed
       cone over the top, a radial marble compass in the floor.
       Built as real geometry, kept in userData.rotunda, so the
       walk-in moment can open it later.
   ================================================================== */

/* Plan traced off the aerial's copper band (grid units x 8 m, centred
   on the roof's centroid), then swung so the entrance apex faces +Z
   and wound counter-clockwise in XZ so (dz, -dx) is the outward
   normal of every edge. */
function lobPlan(THREE) {
  const raw = [
    [-11.2, -43.7],   /* the north point, where the entrance is */
    [43.2, 17.5],     /* east  */
    [4.8, 52.7],      /* south */
    [-36.8, -26.5]    /* west  */
  ];
  const a = Math.atan2(raw[0][0], raw[0][1]);      /* angle off +Z */
  const c = Math.cos(a), s = Math.sin(a);
  let pts = raw.map(([x, z]) => new THREE.Vector2(x * c - z * s, x * s + z * c));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  if (area < 0) pts = [pts[0], ...pts.slice(1).reverse()];   /* keep the apex first */
  return pts;
}

/* a THREE.Shape in the shape-plane that maps to the XZ plan after
   rotateX(-PI/2): shape (x, -z) -> world (x, depth, z) */
function planShape(THREE, pts, k) {
  return new THREE.Shape(pts.map(p => new THREE.Vector2(p.x * k, -p.y * k)));
}
function planPrism(THREE, pts, k, h) {
  const g = new THREE.ExtrudeGeometry(planShape(THREE, pts, k),
    { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function ctLegislativeOfficeBuilding(THREE) {
  const P = {
    granite: cel(THREE, 0xd8bcb0),      /* pale pink granite   */
    graniteLit: cel(THREE, 0xe6d1c6),
    salmon: cel(THREE, 0xbe8375),       /* the darker banding  */
    salmonDeep: cel(THREE, 0xa66d61),
    copper: cel(THREE, 0x7fae98),       /* oxidised, pastel    */
    copperDim: cel(THREE, 0x699a84),
    glass: cel(THREE, 0x4d6472),
    glassLit: cel(THREE, 0x66808e),
    mullion: cel(THREE, 0xa4604f),
    cream: cel(THREE, 0xefe7d8),
    dark: cel(THREE, 0x3c4148),
    prop: cel(THREE, 0xc8c2b8),
    propDark: cel(THREE, 0x5a5f66),
    lampGlass: cel(THREE, 0xf0e2b4),
    floorA: cel(THREE, 0xe9e2d4),
    floorB: cel(THREE, 0x8d5f56),
    leaf: cel(THREE, 0x7fa86a),
    trunk: cel(THREE, 0x8a7059)
  };
  const g = new THREE.Group();
  const plan = lobPlan(THREE);

  /* storey schedule off atrium-02 */
  const Y_PLINTH = 1.3;
  const LEVELS = [
    { y0: 1.3, y1: 5.6, kind: "ribbon" },
    { y0: 5.6, y1: 9.9, kind: "punched" },
    { y0: 9.9, y1: 14.2, kind: "punched" },
    { y0: 14.2, y1: 18.5, kind: "punched" }
  ];
  const Y_EAVE = 19.6;      /* top of the granite fascia   */
  const Y_ROOF = 22.7;      /* top of the copper mansard   */
  const T = 1.4;            /* wall thickness              */

  /* ---- the walls, one panel per plan edge, with real openings ---------- */
  const bandRows = [], mullRows = [], frameRows = [], paneRows = [], copperRows = [];
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i], b = plan[(i + 1) % plan.length];
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);           /* rotation about Y     */
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    /* outward normal (plan wound clockwise in XZ as built) */
    const nx = dz / len, nz = -dx / len;

    const holes = [];
    const inner = len - 7.0;                  /* leave the corner piers */
    for (const L of LEVELS) {
      if (L.kind === "ribbon") {
        const pitch = 5.2, n = Math.floor(inner / pitch);
        for (let k = 0; k < n; k++)
          holes.push([(k - (n - 1) / 2) * pitch, L.y0 + 1.5, 3.6, 1.9]);
      } else {
        const pitch = 4.4, n = Math.floor(inner / pitch);
        for (let k = 0; k < n; k++)
          holes.push([(k - (n - 1) / 2) * pitch, L.y0 + 0.7, 1.5, 3.0]);
      }
    }
    const w = wall(THREE, len, Y_EAVE, T, holes, P.granite);
    w.position.set(mx, 0, mz);
    w.rotation.y = ang + Math.PI / 2;   /* local +Z lands on (nx, nz) */
    g.add(w);

    /* every opening gets a red-brown frame set into the reveal with a
       flat dark pane behind it. On this building the window surrounds
       are a colour, not a shadow — they are half of what you remember
       about the facade. */
    const ry = ang + Math.PI / 2, sa = Math.sin(ry), ca = Math.cos(ry);
    for (const [hx, hy, hw, hh] of holes) {
      const px = mx + hx * ca, pz2 = mz - hx * sa;
      frameRows.push([px - nx * 0.34, hy + hh / 2, pz2 - nz * 0.34, 0, ry, 0, hw, hh, 0.34]);
      paneRows.push([px - nx * 0.62, hy + hh / 2, pz2 - nz * 0.62, 0, ry, 0,
        hw - 0.5, hh - 0.5, 0.3]);
    }

    /* the salmon string courses — banded granite is the building's
       whole surface identity, so it is geometry, not a texture */
    for (const y of [1.3, 5.2, 5.6, 9.5, 9.9, 13.8, 14.2, 18.1, 18.5, 19.2])
      bandRows.push([mx + nx * 0.22, y, mz + nz * 0.22, 0, ang + Math.PI / 2, 0, len - 0.4, 0.46, 0.5]);

    /* mullion bars standing in the ribbon glazing, so the base storey
       does not read as one long slot */
    const mCount = Math.max(4, Math.round(len / 5.2));
    for (let k = 0; k < mCount; k++) {
      const t = (k - (mCount - 1) / 2) * 5.2;
      mullRows.push([
        mx + nx * 0.2 + Math.sin(ang) * t, 3.75, mz + nz * 0.2 + Math.cos(ang) * t,
        0, ang + Math.PI / 2, 0, 0.34, 2.4, 0.5
      ]);
    }

    /* copper mansard: a deep sloped band leaning inwards over each
       edge, the way the aerial shows it ringing the whole roof */
    const rise = Y_ROOF - Y_EAVE, run = 3.4;
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(len + 1.4, Math.hypot(rise, run)), P.copper);
    slope.position.set(
      mx + nx * (0.4 - run / 2), (Y_EAVE + Y_ROOF) / 2, mz + nz * (0.4 - run / 2)
    );
    slope.rotation.y = ang + Math.PI / 2;
    slope.rotateX(-Math.atan2(run, rise));
    g.add(shadowed(slope));
    /* the copper gutter lip along the eave */
    copperRows.push([mx + nx * 0.5, Y_EAVE + 0.35, mz + nz * 0.5, 0, ang + Math.PI / 2, 0,
      len + 1.0, 0.7, 1.1]);

    /* corner piers, which also mitre the joints between panels. The
       apex is left clear because the entrance drum stands there. */
    if (i !== 0) g.add(box(THREE, 3.6, Y_EAVE, 3.6, P.graniteLit, a.x, Y_EAVE / 2, a.y));
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  g.add(inst(THREE, unit, P.salmon, bandRows));
  g.add(inst(THREE, unit, P.mullion, mullRows));
  g.add(inst(THREE, unit, P.mullion, frameRows));
  g.add(inst(THREE, unit, P.glass, paneRows));
  g.add(inst(THREE, unit, P.copperDim, copperRows));

  /* ---- the mass inside the walls, the plinth, and the flat roof -------- */
  {
    const core = shadowed(new THREE.Mesh(planPrism(THREE, plan, 0.965, Y_EAVE), P.granite));
    g.add(core);

    const roofGeo = new THREE.ShapeGeometry(planShape(THREE, plan, 0.93));
    roofGeo.rotateX(-Math.PI / 2);
    const roof = shadowed(new THREE.Mesh(roofGeo, P.dark));
    roof.position.y = Y_ROOF;
    g.add(roof);

    g.add(shadowed(new THREE.Mesh(planPrism(THREE, plan, 1.05, Y_PLINTH), P.salmonDeep)));
  }

  /* ---- the entrance drum ------------------------------------------------
     Sits on the north apex, which lobPlan has swung round to +Z. */
  const apex = plan[0];
  const drumR = 11.5;
  const drum = new THREE.Group();
  drum.position.set(apex.x * 0.86, 0, apex.y * 0.86);
  g.add(drum);
  {
    /* the fat piers of the entrance colonnade — seven across the face */
    const piers = [];
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.30;              /* centred on +Z, the front */
      piers.push([Math.sin(a) * (drumR - 1.1), 3.1, Math.cos(a) * (drumR - 1.1)]);
    }
    drum.add(inst(THREE, new THREE.CylinderGeometry(1.25, 1.4, 5.6, 12), P.graniteLit, piers));

    /* recessed glazed entrance wall behind them */
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR - 3.0, drumR - 3.0, 5.6, 24, 1, true, -Math.PI * 0.38, Math.PI * 0.76),
      P.glass);
    back.position.y = 3.1;
    drum.add(shadowed(back));
    drum.add(box(THREE, 4.4, 4.4, 0.4, P.mullion, 0, 2.3, drumR - 3.1));
    drum.add(box(THREE, 3.2, 3.6, 0.3, P.dark, 0, 2.0, drumR - 2.95));

    /* the frieze band, and the carving that names the building */
    const frieze = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR + 0.35, drumR + 0.35, 2.6, 28, 1, true), P.granite);
    frieze.position.y = 7.2;
    drum.add(shadowed(frieze));
    const letters = arcInscription(THREE, "LEGISLATIVE OFFICE BUILDING",
      drumR + 0.45, 0.155, 0.12, 0);
    if (letters) {
      const lm = shadowed(new THREE.Mesh(letters, P.salmonDeep));
      lm.position.y = 6.55;
      drum.add(lm);
    }

    /* curved ribbon windows above the frieze */
    const rib = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR - 0.1, drumR - 0.1, 3.0, 28, 1, true), P.glass);
    rib.position.y = 10.2;
    drum.add(shadowed(rib));
    const rmull = [];
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2;
      rmull.push([Math.sin(a) * drumR, 10.2, Math.cos(a) * drumR, 0, a, 0, 0.34, 3.0, 0.34]);
    }
    drum.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.mullion, rmull));

    /* the deep smooth parapet that caps the drum */
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR + 1.5, drumR + 1.5, 3.4, 28, 1, true), P.granite);
    cap.position.y = 13.3;
    drum.add(shadowed(cap));
    const capBands = [];
    for (const y of [11.9, 13.1, 14.3, 14.95]) capBands.push([0, y, 0, 0, 0, 0, 1, 1, 1]);
    const bandGeo = new THREE.CylinderGeometry(drumR + 1.68, drumR + 1.68, 0.36, 28, 1, true);
    drum.add(inst(THREE, bandGeo, P.salmon, capBands));
    const lid = new THREE.Mesh(new THREE.CircleGeometry(drumR + 1.5, 28), P.dark);
    lid.rotation.x = -Math.PI / 2; lid.position.y = 15.0;
    drum.add(shadowed(lid));

    /* steps, handrails and bollards, straight out of the photograph */
    for (let i = 0; i < 4; i++)
      drum.add(box(THREE, 16 - i * 0.6, 0.34, 1.2, P.graniteLit, 0, 0.17 + i * 0.34, drumR + 1.4 + i * 1.2));
    for (const sgn of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7.0, 6), P.propDark);
      rail.position.set(sgn * 5.4, 1.6, drumR + 4.0);
      rail.rotation.x = Math.PI / 2 - 0.16;
      drum.add(shadowed(rail));
    }
    const boll = [];
    for (let i = 0; i < 10; i++) boll.push([-8.5 + i * 1.9, 0.55, drumR + 7.6]);
    drum.add(inst(THREE, new THREE.CylinderGeometry(0.24, 0.28, 1.1, 8), P.propDark, boll));
  }

  /* ---- the glass pyramid over the rotunda -------------------------------
     Twelve-sided, dark glazing on red-brown ribs, springing off the
     roof just inside the apex — exactly where the aerial puts it. */
  const rotC = new THREE.Vector3(apex.x * 0.78, 0, apex.y * 0.78);
  {
    const R = 12.6, H = 10.0, y0 = 16.4;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(R, H, 12, 1, true), P.glass);
    cone.position.set(rotC.x, y0 + H / 2, rotC.z);
    g.add(shadowed(cone));

    const drumBase = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.4, 2.6, 12), P.granite);
    drumBase.position.set(rotC.x, y0 - 1.2, rotC.z);
    g.add(shadowed(drumBase));

    /* hip ribs, each laid along its own slope line */
    const slantLen = Math.hypot(R, H);
    const tilt = Math.atan2(R, H);
    const ribMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), P.mullion, 12);
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.5) / 12 * Math.PI * 2;
      const m4 = new THREE.Matrix4()
        .makeTranslation(rotC.x + Math.sin(a) * R / 2, y0 + H / 2, rotC.z + Math.cos(a) * R / 2)
        .multiply(new THREE.Matrix4().makeRotationY(a))
        .multiply(new THREE.Matrix4().makeRotationX(-tilt))
        .multiply(new THREE.Matrix4().makeScale(0.36, slantLen, 0.36));
      ribMesh.setMatrixAt(i, m4);
    }
    ribMesh.instanceMatrix.needsUpdate = true;
    g.add(shadowed(ribMesh));

    /* two horizontal rings and the little apex finial */
    for (const f of [0.33, 0.66]) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(R * (1 - f) + 0.12, R * (1 - f) + 0.12, 0.3, 12, 1, true), P.mullion);
      ring.position.set(rotC.x, y0 + H * f, rotC.z);
      g.add(shadowed(ring));
    }
    const fin = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.0, 8), P.copperDim);
    fin.position.set(rotC.x, y0 + H + 0.4, rotC.z);
    g.add(shadowed(fin));
  }

  /* ---- the rotunda, as real geometry ------------------------------------
     Not a solid block: a five-level circular well with the granite
     order below and the white order above, so the interior can simply
     be revealed rather than rebuilt. */
  const rotunda = new THREE.Group();
  rotunda.position.copy(rotC);   /* directly under the glass cone */
  {
    const R = 8.6;                 /* the well fits inside the cone above it */
    /* patterned floor */
    const f1 = new THREE.Mesh(new THREE.CircleGeometry(R, 24), P.floorA);
    f1.rotation.x = -Math.PI / 2; f1.position.y = 0.06; rotunda.add(shadowed(f1));
    const f2 = new THREE.Mesh(new THREE.RingGeometry(R * 0.45, R * 0.55, 24), P.floorB);
    f2.rotation.x = -Math.PI / 2; f2.position.y = 0.09; rotunda.add(shadowed(f2));
    const f3 = new THREE.Mesh(new THREE.CircleGeometry(R * 0.2, 20), P.floorB);
    f3.rotation.x = -Math.PI / 2; f3.position.y = 0.09; rotunda.add(shadowed(f3));

    /* two granite levels of heavy square piers */
    const pierRows = [];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      pierRows.push([Math.sin(a) * R, 4.4, Math.cos(a) * R, 0, a, 0, 2.0, 8.8, 1.7]);
    }
    rotunda.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.salmon, pierRows));

    /* three levels of white columns with balcony rails */
    const colRows = [], railRows = [];
    const levels = [9.0, 12.6, 16.2];
    for (const y of levels) {
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        colRows.push([Math.sin(a) * R, y + 1.7, Math.cos(a) * R, 0, a, 0, 1, 1, 1]);
      }
      railRows.push([0, y + 0.55, 0, 0, 0, 0, 1, 1, 1]);
      railRows.push([0, y + 0.05, 0, 0, 0, 0, 1, 1, 1]);
    }
    rotunda.add(inst(THREE, new THREE.CylinderGeometry(0.55, 0.6, 3.4, 10), P.cream, colRows));
    rotunda.add(inst(THREE,
      new THREE.CylinderGeometry(R + 0.45, R + 0.45, 0.3, 20, 1, true), P.dark, railRows));
    for (const y of levels) {
      const soffit = new THREE.Mesh(new THREE.RingGeometry(R - 0.8, R + 1.5, 20), P.cream);
      soffit.rotation.x = Math.PI / 2;
      soffit.position.y = y - 0.1;
      rotunda.add(shadowed(soffit));
    }
    /* the enclosing drum wall of the well, seen from the inside */
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 1.9, R + 1.9, 19.6, 20, 1, true),
      cel(THREE, 0xefe7d8, { side: THREE.BackSide }));
    shell.position.y = 9.8;
    rotunda.add(shadowed(shell));
  }
  g.add(rotunda);

  /* ---- rooftop: the two glazed roof lights and the mechanical plant ---- */
  {
    /* placed by walking back from the apex along the plan's spine, so
       they land on the roof rather than beside it */
    const spine = new THREE.Vector2(-apex.x, -apex.y).normalize();
    const side = new THREE.Vector2(-spine.y, spine.x);
    for (const [along, off, w, d] of [[30, -8, 16, 12], [46, 9, 13, 11]]) {
      const gl = new THREE.Group();
      gl.position.set(apex.x * 0.66 + spine.x * along + side.x * off, Y_ROOF,
        apex.y * 0.66 + spine.y * along + side.y * off);
      gl.add(box(THREE, w, 0.6, d, P.mullion, 0, 0.3, 0));
      const r = hipRoof(THREE, w - 0.6, d - 0.6, 2.4, 0.55, P.glass);
      r.position.y = 0.6; gl.add(r);
      const bars = [];
      for (let i = 1; i < 5; i++)
        bars.push([(i / 5 - 0.5) * (w - 0.6), 1.6, 0, 0, 0, 0, 0.22, 1.8, d - 0.6]);
      gl.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.mullion, bars));
      g.add(gl);
    }
    const onRoof = (along, off) => new THREE.Vector3(
      apex.x * 0.66 + spine.x * along + side.x * off, Y_ROOF,
      apex.y * 0.66 + spine.y * along + side.y * off);
    for (const sgn of [-1, 1]) {
      const dm = new THREE.Group();
      dm.position.copy(onRoof(2, sgn * 21));
      dm.rotation.y = Math.atan2(-apex.x, -apex.y);
      dm.add(box(THREE, 11, 0.7, 8, P.mullion, 0, 0.35, 0));
      const rf = hipRoof(THREE, 10.4, 7.4, 4.2, 0.2, P.glass);
      rf.position.y = 0.7; dm.add(rf);
      const bars = [];
      for (let i = 0; i < 3; i++)
        bars.push([(i - 1) * 2.6, 2.4, 0, 0, 0, 0, 0.28, 3.2, 7.4]);
      dm.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.mullion, bars));
      g.add(dm);
    }
    const a1 = acUnit(THREE, P, 3.0, 1.6, 2.2); a1.position.copy(onRoof(22, 20)); g.add(a1);
    const a2 = acUnit(THREE, P, 2.4, 1.3, 1.8); a2.position.copy(onRoof(34, -22)); g.add(a2);
    const dsh = dish(THREE, P, 1.3); dsh.position.copy(onRoof(58, 4)); g.add(dsh);
    for (const [al, of_] of [[52, -14], [62, 10], [44, 24]]) {
      const v = vent(THREE, P, 0.45, 1.3); v.position.copy(onRoof(al, of_)); g.add(v);
    }
  }

  /* ---- the raised end pavilions ----------------------------------------
     The long flank photograph shows the building stepping up at its
     broad corners into a taller block with a copper hipped roof and a
     carved fan in the gable. Without them the mass is just a slab. */
  {
    const cen = new THREE.Vector2(0, 0);
    for (const q of plan) cen.add(q);
    cen.divideScalar(plan.length);
    for (const vi of [1, 2]) {
      const v = plan[vi];
      const inward = new THREE.Vector2(cen.x - v.x, cen.y - v.y).normalize();
      const pav = new THREE.Group();
      /* Sit the pavilion INSIDE its own corner by a fixed inset. The
         old lerp toward the centroid put one of them off the
         footprint entirely, leaving a roof floating in the sky. */
      pav.position.set(v.x + inward.x * 16, 0, v.y + inward.y * 16);
      pav.rotation.y = Math.atan2(inward.x, inward.y);
      pav.add(box(THREE, 26, 3.4, 22, P.granite, 0, Y_EAVE + 0.6, 0));
      for (const y of [Y_EAVE - 0.3, Y_EAVE + 0.8, Y_EAVE + 1.9])
        pav.add(box(THREE, 26.4, 0.42, 22.4, P.salmon, 0, y, 0));
      const cap = hipRoof(THREE, 27, 23, 3.0, 0.4, P.copper);
      cap.position.y = Y_EAVE + 2.3;  /* copper hip, as on the flank */
      pav.add(cap);
      /* the carved fan lunette in the gable face */
      const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(2.9, 2.9, 0.4, 14, 1, false, 0, Math.PI), P.graniteLit);
      fan.rotation.set(Math.PI / 2, 0, Math.PI);
      fan.position.set(0, Y_EAVE + 0.9, 11.2);
      pav.add(shadowed(fan));
      const spokes = [];
      for (let i = 0; i < 7; i++)
        spokes.push([0, Y_EAVE + 0.9, 11.4, 0, 0, (i / 6 - 0.5) * Math.PI * 0.84, 0.22, 5.4, 0.16]);
      pav.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.salmon, spokes));
      g.add(pav);
    }
  }

  /* ---- ground: terrace, planters, the pair of trees at the door -------- */
  {
    g.add(shadowed(new THREE.Mesh(planPrism(THREE, plan, 1.28, 0.5), P.graniteLit)));

    const treeAt = (x, z) => {
      const tr = new THREE.Group();
      tr.position.set(x, 0.5, z);
      tr.add(box(THREE, 3.6, 1.4, 3.6, P.salmonDeep, 0, 0.7, 0));
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 3.2, 6), P.trunk);
      trunk.position.y = 3.0; tr.add(shadowed(trunk));
      const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), P.leaf);
      c1.position.y = 5.6; tr.add(shadowed(c1));
      const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), P.leaf);
      c2.position.set(1.4, 4.8, 0.6); tr.add(shadowed(c2));
      return tr;
    };
    const ax = apex.x / Math.hypot(apex.x, apex.y), az = apex.y / Math.hypot(apex.x, apex.y);
    for (const sgn of [-1, 1]) {
      g.add(treeAt(apex.x * 0.86 + sgn * 17 * az + ax * 12, apex.y * 0.86 - sgn * 17 * ax + az * 12));
    }
    for (const sgn of [-1, 1]) {
      const l = lampPost(THREE, P, 4.6);
      l.position.set(apex.x * 0.86 + sgn * 26 * az + ax * 20, 0.5, apex.y * 0.86 - sgn * 26 * ax + az * 20);
      g.add(l);
    }
  }

  const outer = new THREE.Group();
  const S = 0.22;
  g.scale.setScalar(S);
  outer.add(g);
  outer.userData.footprint = 56 * S;
  outer.userData.height = (Y_ROOF + 12) * S;
  outer.userData.rotunda = rotunda;
  outer.userData.slug = "ct-legislative-office-building";
  outer.name = "ct-legislative-office-building";
  return outer;
}

/* ==================================================================
   3. GEORGIA STATE CAPITOL — Atlanta, 1889
   ==================================================================
   Read off the photographs in assets/landmarks/georgia-state-capitol/:

   aerial-front.jpg (the money shot, west front)
     - a projecting central portico crowned by a triangular pediment,
       carried on a giant order of columns standing on a podium at the
       head of a broad grand staircase. Six columns across the face
     - symmetric wings either side, three storeys: a tall rusticated
       ground storey of round-arched openings, a piano-nobile of tall
       windows, and a shorter attic storey, under a deep cornice
     - THE signature: the gilded gold dome. It rises on a square attic,
       then a colonnaded round drum ringed with white columns and a
       balustrade, then the bright gold ribbed dome, a small gold
       colonnaded lantern, and a statue (Miss Freedom) on the very top
     - pale grey limestone walls, gold dome, grey lower roofs

   aerial-side.jpg / aerial-rear.jpg (flanks and back)
     - the same three-storey banded elevation runs all the way round;
       the block is a long rectangle with a low grey hipped roof and a
       balustraded parapet, the dome dead centre over the crossing
     - slightly projecting end pavilions close each end of the long
       facades

   topdown-map.jpg
     - a long rectangular footprint with the dome at the centroid and
       the pedimented portico projecting from the centre of the front
   ================================================================== */

/* A colonnade: shafts, bases, bell capitals and abaci as four
   instanced passes, so a ring of twenty columns is four draw calls.
   rows2d is a list of [x, z] centres; columns stand from y0, height h. */
function colonnade(THREE, g, rows2d, y0, h, r, shaftMat, capMat) {
  const shaft = new THREE.CylinderGeometry(r * 0.9, r, h, 14, 1, true);
  g.add(inst(THREE, shaft, shaftMat, rows2d.map(([x, z]) => [x, y0 + h / 2, z])));
  const base = new THREE.CylinderGeometry(r * 1.22, r * 1.42, 0.9, 14);
  g.add(inst(THREE, base, capMat, rows2d.map(([x, z]) => [x, y0 + 0.45, z])));
  /* Corinthian bell, flared out under the abacus */
  const bell = new THREE.CylinderGeometry(r * 1.45, r * 0.92, 1.15, 14);
  g.add(inst(THREE, bell, capMat, rows2d.map(([x, z]) => [x, y0 + h + 0.55, z])));
  const abacus = new THREE.BoxGeometry(r * 2.9, 0.42, r * 2.9);
  g.add(inst(THREE, abacus, capMat, rows2d.map(([x, z]) => [x, y0 + h + 1.28, z])));
}

/* triangular pediment: a filled triangle in XY extruded back along -Z,
   front face landing on z = 0 */
function pediment(THREE, w, h, depth, mat) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -depth);
  return shadowed(new THREE.Mesh(geo, mat));
}

function georgiaStateCapitol(THREE) {
  const P = {
    stone: cel(THREE, 0xd6d5cc),        /* pale grey limestone */
    stoneLit: cel(THREE, 0xe9e8dd),
    stoneDim: cel(THREE, 0xb7b6a9),
    base: cel(THREE, 0xc6c5ba),         /* rusticated ground storey */
    baseDim: cel(THREE, 0xa9a89c),
    cornice: cel(THREE, 0xecebe0),
    gold: cel(THREE, 0xe6b02f),         /* the gilded dome */
    goldLit: cel(THREE, 0xf6cf5e),
    goldDim: cel(THREE, 0xc78f1f),
    roof: cel(THREE, 0x9a9a94),         /* grey lower roof */
    roofDim: cel(THREE, 0x7f7f79),
    column: cel(THREE, 0xe7e3d4),       /* white/cream order */
    glass: cel(THREE, 0x44515a, { ink: 0.004 }),
    dark: cel(THREE, 0x33383e),
    door: cel(THREE, 0x6a5236),
    prop: cel(THREE, 0xc8c2b8),
    propDark: cel(THREE, 0x5a5f66),
    leaf: cel(THREE, 0x7fa86a),
    trunk: cel(THREE, 0x8a7059)
  };
  const g = new THREE.Group();

  /* ---- dimensions ------------------------------------------------------ */
  const W = 92, D = 46;             /* main block, long axis on X   */
  const zF = D / 2;                 /* front wall plane (+Z front)  */
  const Y_PLINTH = 2.6;             /* top of the ground plinth     */
  const Y_G = 12.0;                 /* top of rusticated ground     */
  const Y_2 = 21.5;                 /* top of the piano nobile      */
  const Y_TOP = 28.5;               /* top of the third storey wall */
  const Y_COR = 31.0;               /* top of the main cornice      */
  const PORT_W = 30;                /* central portico width        */
  const PORT_OUT = 6.5;             /* how far it projects in +Z    */

  /* ---- window schedule ------------------------------------------------- */
  const ROWS = [
    { y: 4.0, h: 6.4, w: 3.2 },     /* ground: tall, round-arched read */
    { y: 13.2, h: 6.8, w: 3.0 },    /* piano nobile: the tall ones     */
    { y: 23.0, h: 4.2, w: 3.0 }     /* attic: shorter                  */
  ];
  const panes = [];
  const pushPanes = (hs, px, pz, ry, nx, nz) => {
    const sa = Math.sin(ry), ca = Math.cos(ry);
    for (const [hx, hy, hw, hh] of hs) {
      const x = px + hx * ca, z = pz - hx * sa;
      panes.push([x - nx * 0.55, hy + hh / 2, z - nz * 0.55, 0, ry, 0, hw - 0.5, hh - 0.5, 0.4]);
    }
  };

  /* wing bay centres on the front: 5 bays per wing, portico in the middle */
  const wingBays = [-10.4, -5.2, 0, 5.2, 10.4];
  const holesFront = [];
  for (const sgn of [-1, 1]) {
    const cx = sgn * (PORT_W / 2 + 15);   /* wing centre */
    for (const b of wingBays) for (const r of ROWS)
      holesFront.push([cx + b, r.y, r.w, r.h]);
  }
  /* the three centre bays sit behind the portico: a doorway and two windows */
  const centreHoles = [
    [0, 3.0, 4.4, 8.0],             /* the great doorway */
    [-8.5, 4.0, 3.0, 6.4], [8.5, 4.0, 3.0, 6.4],
    [-8.5, 13.2, 2.8, 6.8], [0, 13.2, 3.2, 7.4], [8.5, 13.2, 2.8, 6.8],
    [-8.5, 23.0, 2.8, 4.2], [0, 23.0, 2.8, 4.2], [8.5, 23.0, 2.8, 4.2]
  ];

  /* ---- the four main walls, real openings ------------------------------ */
  {
    const fh = holesFront.concat(centreHoles);
    const fw = wall(THREE, W, Y_TOP, 1.6, fh, P.stone);
    fw.position.set(0, 0, zF); g.add(fw);
    pushPanes(fh, 0, zF - 0.8, 0, 0, 1);

    const bh = [];
    for (const sgn of [-1, 1]) {
      const cx = sgn * (PORT_W / 2 + 15);
      for (const b of wingBays) for (const r of ROWS) bh.push([cx + b, r.y, r.w, r.h]);
    }
    for (const b of [-8.5, 0, 8.5]) for (const r of ROWS) bh.push([b, r.y, r.w, r.h]);
    const bw = wall(THREE, W, Y_TOP, 1.6, bh, P.stone);
    bw.position.set(0, 0, -zF); bw.rotation.y = Math.PI; g.add(bw);
    pushPanes(bh, 0, -zF + 0.8, Math.PI, 0, -1);

    /* side walls (short ends, +/-X): 6 bays */
    const sideBays = [];
    for (let i = 0; i < 6; i++) sideBays.push((i - 2.5) * 6.4);
    const sh = [];
    for (const b of sideBays) for (const r of ROWS) sh.push([b, r.y, r.w * 0.9, r.h]);
    for (const sgn of [-1, 1]) {
      const sw = wall(THREE, D, Y_TOP, 1.6, sh, P.stone);
      sw.position.set(sgn * W / 2, 0, 0);
      sw.rotation.y = sgn * Math.PI / 2; g.add(sw);
      pushPanes(sh, sgn * (W / 2 - 0.8), 0, sgn * Math.PI / 2, sgn, 0);
    }
  }

  /* the mass behind the facades, the plinth, the rusticated ground band */
  g.add(box(THREE, W - 3.2, Y_TOP, D - 3.2, P.stoneDim, 0, Y_TOP / 2, 0));
  g.add(box(THREE, W + 1.4, Y_PLINTH, D + 1.4, P.base, 0, Y_PLINTH / 2, 0));
  /* rusticated ground storey reads as a slightly proud, banded band */
  g.add(box(THREE, W + 0.5, Y_G - Y_PLINTH, D + 0.5, P.base, 0, (Y_G + Y_PLINTH) / 2, 0));
  {
    const grooves = [];
    for (let y = Y_PLINTH + 1.6; y < Y_G; y += 1.6) {
      grooves.push([0, y, zF + 0.3, 0, 0, 0, W + 0.6, 0.12, 0.2]);
      grooves.push([0, y, -zF - 0.3, 0, 0, 0, W + 0.6, 0.12, 0.2]);
      grooves.push([W / 2 + 0.3, y, 0, 0, Math.PI / 2, 0, D + 0.6, 0.12, 0.2]);
      grooves.push([-W / 2 - 0.3, y, 0, 0, Math.PI / 2, 0, D + 0.6, 0.12, 0.2]);
    }
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.baseDim, grooves));
  }

  /* string courses and pilasters between the upper windows -------------- */
  {
    const bands = [];
    for (const y of [Y_G, Y_2, Y_TOP]) {
      bands.push([0, y, zF + 0.2, 0, 0, 0, W + 0.4, 0.5, 0.6]);
      bands.push([0, y, -zF - 0.2, 0, 0, 0, W + 0.4, 0.5, 0.6]);
      bands.push([W / 2 + 0.2, y, 0, 0, Math.PI / 2, 0, D + 0.4, 0.5, 0.6]);
      bands.push([-W / 2 - 0.2, y, 0, 0, Math.PI / 2, 0, D + 0.4, 0.5, 0.6]);
    }
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.stoneLit, bands));

    /* pilaster strips between the piano-nobile windows on the wings */
    const pil = [];
    for (const sgn of [-1, 1]) {
      const cx = sgn * (PORT_W / 2 + 15);
      for (const b of [-13, -7.8, -2.6, 2.6, 7.8, 13])
        pil.push([cx + b, (Y_G + Y_TOP) / 2, zF + 0.15, 0, 0, 0, 0.9, Y_TOP - Y_G, 0.5]);
    }
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.stoneLit, pil));
  }

  /* ---- the deep main cornice + roof balustrade ------------------------- */
  {
    g.add(box(THREE, W + 2.4, 1.0, D + 2.4, P.cornice, 0, Y_TOP + 0.5, 0));
    g.add(box(THREE, W + 3.2, 1.4, D + 3.2, P.cornice, 0, Y_TOP + 1.5, 0));
    /* balustrade: a rail on close balusters round the parapet */
    const rail = [];
    rail.push([0, Y_COR + 0.9, zF + 1.4, 0, 0, 0, W + 3.0, 0.4, 0.7]);
    rail.push([0, Y_COR + 0.9, -zF - 1.4, 0, 0, 0, W + 3.0, 0.4, 0.7]);
    rail.push([W / 2 + 1.4, Y_COR + 0.9, 0, 0, Math.PI / 2, 0, D + 3.0, 0.4, 0.7]);
    rail.push([-W / 2 - 1.4, Y_COR + 0.9, 0, 0, Math.PI / 2, 0, D + 3.0, 0.4, 0.7]);
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.cornice, rail));
    const bal = [];
    const front = W + 3.0, side = D + 3.0;
    const nf = Math.floor(front / 1.7), ns = Math.floor(side / 1.7);
    for (let i = 0; i < nf; i++) {
      const x = (i - (nf - 1) / 2) * 1.7;
      bal.push([x, Y_COR + 0.4, zF + 1.4]); bal.push([x, Y_COR + 0.4, -zF - 1.4]);
    }
    for (let i = 0; i < ns; i++) {
      const z = (i - (ns - 1) / 2) * 1.7;
      bal.push([W / 2 + 1.4, Y_COR + 0.4, z]); bal.push([-W / 2 - 1.4, Y_COR + 0.4, z]);
    }
    g.add(inst(THREE, new THREE.CylinderGeometry(0.24, 0.3, 1.0, 6), P.cornice, bal));
  }

  /* the low grey hipped roof, just showing above the balustrade */
  {
    g.add(box(THREE, W - 1.0, 0.6, D - 1.0, P.roofDim, 0, Y_COR + 0.3, 0));
    const r = hipRoof(THREE, W - 2.0, D - 2.0, 2.2, 0.85, P.roof);
    r.position.set(0, Y_COR + 0.5, 0); g.add(r);
  }

  /* ---- the central portico -------------------------------------------- */
  const portZ = zF + PORT_OUT;
  {
    /* podium under the columns, at the head of the stair */
    g.add(box(THREE, PORT_W + 4, Y_G, PORT_OUT + 3.0, P.base, 0, Y_G / 2, zF + PORT_OUT / 2 - 0.4));

    /* six giant Corinthian columns */
    const colXs = [-13, -7.8, -2.6, 2.6, 7.8, 13];
    const cz = portZ - 0.4;
    colonnade(THREE, g, colXs.map(x => [x, cz]), Y_G, Y_TOP - Y_G, 1.5, P.column, P.column);
    /* two antae engaged into the wall behind the ends of the colonnade */
    for (const sgn of [-1, 1])
      g.add(box(THREE, 2.2, Y_TOP - Y_G + 1.4, 2.2, P.stoneLit,
        sgn * (PORT_W / 2 - 0.4), (Y_G + Y_TOP) / 2 + 0.2, zF + 1.2));

    /* portico entablature spanning columns to wall */
    g.add(box(THREE, PORT_W + 2.0, 1.0, PORT_OUT + 1.0, P.cornice, 0, Y_TOP + 0.5, zF + PORT_OUT / 2));
    g.add(box(THREE, PORT_W + 3.0, 1.3, PORT_OUT + 1.4, P.cornice, 0, Y_TOP + 1.5, zF + PORT_OUT / 2));

    /* the pediment */
    const ped = pediment(THREE, PORT_W + 3.0, 6.4, PORT_OUT + 1.4, P.stoneLit);
    ped.position.set(0, Y_TOP + 2.2, portZ + 0.5);
    g.add(ped);
    /* tympanum recess (a shallow dark relief panel) */
    g.add(box(THREE, PORT_W - 5, 3.2, 0.3, P.stoneDim, 0, Y_TOP + 3.6, portZ + 0.55));

    /* the grand staircase down the front */
    const steps = [];
    const nStep = 20;
    for (let i = 0; i < nStep; i++) {
      const y = Y_G - (i + 1) * (Y_G / nStep);
      const z = portZ + 1.0 + i * 0.9;
      steps.push([0, y + 0.22, z, 0, 0, 0, PORT_W + 6 - i * 0.1, 0.44, 1.0]);
    }
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.stoneLit, steps));
  }

  /* ---- THE DOME ASSEMBLY ---------------------------------------------- */
  const domeCx = 0, domeCz = 0;
  {
    /* square attic base over the crossing */
    g.add(box(THREE, 27, 6.5, 27, P.stone, domeCx, Y_COR + 3.2, domeCz));
    g.add(box(THREE, 28, 1.0, 28, P.cornice, domeCx, Y_COR + 6.7, domeCz));

    /* the colonnaded round drum */
    const drumY0 = Y_COR + 7.2;    /* ~38.2 */
    const drumR = 11.2, drumH = 12;
    const drumCore = new THREE.Mesh(
      new THREE.CylinderGeometry(drumR - 1.6, drumR - 1.6, drumH, 24), P.stone);
    drumCore.position.set(domeCx, drumY0 + drumH / 2, domeCz);
    g.add(shadowed(drumCore));
    /* peristyle: 20 white columns ringing the drum */
    const drumCols = [];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      drumCols.push([domeCx + Math.sin(a) * drumR, domeCz + Math.cos(a) * drumR]);
    }
    colonnade(THREE, g, drumCols, drumY0, drumH, 0.72, P.column, P.column);
    /* drum base balustrade ring + top entablature ring */
    const ring = (y, r, h, mat) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true), mat);
      m.position.set(domeCx, y, domeCz); g.add(shadowed(m));
    };
    ring(drumY0 - 0.2, drumR + 0.9, 1.4, P.cornice);
    const drumTopY = drumY0 + drumH + 1.6;
    ring(drumTopY, drumR + 0.9, 2.0, P.cornice);           /* entablature */
    ring(drumTopY + 1.6, drumR - 1.0, 1.6, P.stone);        /* short upper drum */

    /* the gilded gold dome */
    const domeBaseY = drumTopY + 2.4;   /* ~54 */
    const domeR = 10.4;
    const DOME_YS = 1.18;               /* stretch for the ogee rise */
    const domeTopY = domeBaseY + domeR * 0.52 * DOME_YS;
    /* the smooth gilded dome (the whole read). Georgia's dome is a
       near-smooth gold shell at this scale, so it is one clean surface
       rather than a spoked cage — straight ribs cannot hug the curve. */
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(domeR, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), P.gold);
    dome.scale.set(1, DOME_YS, 1);
    dome.position.set(domeCx, domeBaseY, domeCz);
    g.add(shadowed(dome));
    /* faint horizontal seams read as gilding courses, not spokes */
    for (const f of [0.34, 0.62]) {
      const rr = domeR * Math.cos(Math.PI * 0.52 * f) * 0.99;
      ring(domeBaseY + domeR * Math.sin(Math.PI * 0.52 * f) * DOME_YS, rr, 0.22, P.goldDim);
    }
    /* gold ring at the base of the dome */
    ring(domeBaseY + 0.2, domeR + 0.2, 1.0, P.goldLit);

    /* the lantern / cupola: a little gold colonnade + capping dome */
    const lanY0 = domeTopY + 0.2;   /* on top of the dome */
    const lanR = 3.0;
    const lanBase = new THREE.Mesh(new THREE.CylinderGeometry(lanR + 0.6, lanR + 0.8, 1.4, 12), P.goldLit);
    lanBase.position.set(domeCx, lanY0 + 0.7, domeCz); g.add(shadowed(lanBase));
    const lanCore = new THREE.Mesh(new THREE.CylinderGeometry(lanR - 0.9, lanR - 0.9, 4.2, 12), P.gold);
    lanCore.position.set(domeCx, lanY0 + 1.4 + 2.1, domeCz); g.add(shadowed(lanCore));
    const lanCols = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      lanCols.push([domeCx + Math.sin(a) * lanR, domeCz + Math.cos(a) * lanR]);
    }
    colonnade(THREE, g, lanCols, lanY0 + 1.4, 4.2, 0.34, P.goldLit, P.goldLit);
    const lanY1 = lanY0 + 1.4 + 4.2 + 1.0;
    const lanEnt = new THREE.Mesh(new THREE.CylinderGeometry(lanR + 0.8, lanR + 0.8, 1.0, 12), P.goldLit);
    lanEnt.position.set(domeCx, lanY1 - 0.5, domeCz); g.add(shadowed(lanEnt));
    const lanDome = new THREE.Mesh(
      new THREE.SphereGeometry(lanR + 0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), P.gold);
    lanDome.position.set(domeCx, lanY1, domeCz); g.add(shadowed(lanDome));

    /* Miss Freedom on the very top: a small stylised figure with a torch */
    const statueY = lanY1 + (lanR + 0.2) * 0.5 + 0.2;
    const st = new THREE.Group();
    st.position.set(domeCx, statueY, domeCz);
    st.add(box(THREE, 1.4, 0.8, 1.4, P.goldLit, 0, 0.4, 0));                    /* pedestal */
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 2.6, 8), P.gold);
    body.position.y = 0.8 + 1.3; st.add(shadowed(body));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), P.goldLit);
    head.position.y = 0.8 + 2.8; st.add(shadowed(head));
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.8, 6), P.gold);
    arm.position.set(0.2, 0.8 + 2.4, 0); arm.rotation.z = -0.7; st.add(shadowed(arm));
    const torch = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.7, 8), P.goldLit);
    torch.position.set(0.95, 0.8 + 3.4, 0); st.add(shadowed(torch));
    g.add(st);
  }

  /* ---- ground: terrace, a pair of trees flanking the stair ------------ */
  {
    g.add(box(THREE, W + 18, 0.7, D + 22, P.stoneDim, 0, 0.35, 0));
    const treeAt = (x, z) => {
      const tr = new THREE.Group(); tr.position.set(x, 0.7, z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 3.4, 6), P.trunk);
      trunk.position.y = 1.7; tr.add(shadowed(trunk));
      const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 0), P.leaf);
      c1.position.y = 4.4; tr.add(shadowed(c1));
      const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 0), P.leaf);
      c2.position.set(1.6, 3.6, 0.8); tr.add(shadowed(c2));
      return tr;
    };
    for (const sgn of [-1, 1]) g.add(treeAt(sgn * (PORT_W / 2 + 10), zF + PORT_OUT + 14));
  }

  const outer = new THREE.Group();
  const S = 0.2;
  g.scale.setScalar(S);
  outer.add(g);
  outer.userData.footprint = Math.hypot(W / 2 + 9, D / 2 + 11) * S;
  outer.userData.height = 76 * S;
  outer.userData.slug = "georgia-state-capitol";
  outer.name = "georgia-state-capitol";
  return outer;
}

/* ==================================================================
   4. SHILOH BAPTIST CHURCH — 477 Broad Street, Bridgeport CT
   ==================================================================
   The finale, and the heart of the whole game. It is the owner's
   family church, and the meaning lives in the RELATIONSHIP between
   two things standing side by side — so the church is built HERE and
   the railroad, the stone embankment and the Docket 516 monopoles are
   built in the DISTRICT (js/uprise-district.js), across the street
   where they actually stand.

   SURVEYED OFF the owner's own Street View walk of the property
   (scratchpad/shiloh-vid/) plus assets/landmarks/shiloh-docket-516/.
   The walk settles what the stills left ambiguous:

   IT IS A CORNER LOT, at BROAD STREET x RAILROAD AVENUE, signalised.
     - The FRONT GABLE, the recessed porch and the STEEPLE face BROAD
       STREET. That is the end of the building.
     - The LONG FLANK runs back along RAILROAD AVENUE. The ridge is
       PERPENDICULAR to Broad Street, not parallel to it.
     - The PARKING LOT lies between that flank and Railroad Avenue,
       and it is painted as a BASKETBALL COURT: a blue key with orange
       trim and a light-blue arc, and a real backboard and hoop on a
       pole at the church end.
     - The big WHITE CROSS is laid on the roof slope that faces the
       court and Railroad Avenue; SOLAR PANELS cover the other slope.
     - The Railroad Avenue wall is largely BLANK: a roll-up service
       door, a bank of electrical meters, one small window, a banner.
       It is a working church wall, not a row of sanctuary windows.
     - A black iron picket fence wraps BOTH frontages, with a gate.
     - The blue peaked marquee sign stands at the Broad Street kerb.

   ELEVATION (from the Broad Street frame, November 2020):
     one storey, wood frame, a stronger blue gable field over pale
     ice-blue walls, white trim, a louvered vent in the gable, a
     RECESSED porch on four square white posts, concrete steps with
     black pipe handrails, a white knee wall, "477" up the trim, a
     slender white steeple with a small cross, and a brick chimney.

   Do not grandify it. Its smallness against the monopoles is the
   whole argument, and the argument is the reason the level exists.
   ================================================================== */

function shilohDocket516(THREE) {
  const P = {
    gable: cel(THREE, 0x5f9fd0),        /* the stronger blue gable field */
    wall: cel(THREE, 0xc6dbec),         /* pale ice-blue clapboard */
    wallLit: cel(THREE, 0xdceaf5),
    white: cel(THREE, 0xf4f2ea),
    whiteDim: cel(THREE, 0xdcd9cf),
    roof: cel(THREE, 0x4a4f55),
    solar: cel(THREE, 0x2b3a4a),
    glass: cel(THREE, 0x36434d, { ink: 0.004 }),
    door: cel(THREE, 0x5d5346),
    iron: cel(THREE, 0x24272b),
    brick: cel(THREE, 0x8d5f4c),
    signBlue: cel(THREE, 0x1f3f8f),
    signFace: cel(THREE, 0xeceee9),
    asphalt: cel(THREE, 0x6f6c68),
    courtBlue: cel(THREE, 0x4f8fc4),    /* the painted key */
    courtSky: cel(THREE, 0x8fc4e2),
    courtOrange: cel(THREE, 0xd98f45),
    courtLine: cel(THREE, 0xeeeae0),
    backboard: cel(THREE, 0xf2f1ec),
    rim: cel(THREE, 0xd4622e),
    meter: cel(THREE, 0xb9b5ac),
    grass: cel(THREE, 0x7ea866),
    conifer: cel(THREE, 0x3f6b47)
  };
  const g = new THREE.Group();

  /* Feet. The group is scaled to world units at the end, so every
     number below can be read straight off the photographs.
     +Z is BROAD STREET (the gable end).  +X is RAILROAD AVENUE. */
  const BAR_W = 34;      /* across, gable to gable (X) */
  const BAR_D = 78;      /* back from Broad Street (Z) */
  const WALL = 12;
  const RIDGE = 21;
  const zF = BAR_D / 2;                       /* the Broad Street face */
  const xR = BAR_W / 2;                       /* the Railroad Ave flank */
  const slope = Math.atan2(RIDGE - WALL, BAR_W / 2);
  const slabLen = Math.hypot(BAR_W / 2, RIDGE - WALL) + 1.2;

  /* ---- the long bar, ridge running BACK from Broad Street ------------ */
  {
    g.add(box(THREE, BAR_W, WALL, BAR_D, P.wall, 0, WALL / 2, 0));

    /* the two roof slopes now face the two streets' flanks */
    for (const sgn of [1, -1]) {
      const slab = box(THREE, slabLen, 0.5, BAR_D + 1.6, P.roof,
        sgn * (BAR_W / 4), (WALL + RIDGE) / 2 + 0.2, 0);
      slab.rotation.z = -sgn * slope;
      g.add(slab);
    }
    /* the rear gable (the Broad Street gable is built below) */
    const back = pediment(THREE, BAR_W, RIDGE - WALL, 0.5, P.wall);
    back.position.set(0, WALL, -zF + 0.5);
    back.rotation.y = Math.PI;
    g.add(back);

    /* THE WHITE CROSS, on the slope that faces the court and Railroad
       Avenue. Local X runs up the slope, local Z along the ridge. */
    const cross = new THREE.Group();
    cross.position.set(BAR_W / 4, (WALL + RIDGE) / 2 + 0.65, -4);
    cross.rotation.z = -slope;
    cross.add(box(THREE, 3.4, 0.22, 19.0, P.white, 0, 0, 0));
    cross.add(box(THREE, 3.4, 0.22, 3.4, P.white, 0, 0, 0));
    cross.add(box(THREE, 12.0, 0.22, 3.4, P.white, 0, 0, 3.6));
    g.add(cross);

    /* solar array on the far slope, as flown */
    const cells = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 10; c++)
        cells.push([-3.4 + r * 2.6, 0, -22 + c * 4.6, 0, 0, 0, 2.3, 0.16, 4.1]);
    const panel = inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.solar, cells);
    panel.position.set(-BAR_W / 4, (WALL + RIDGE) / 2 + 0.6, 4);
    panel.rotation.z = slope;
    g.add(panel);

    /* THE RAILROAD AVENUE WALL — blank, working, and correct: a
       roll-up service door, meters, one small window, a banner. */
    const holes = [[16, 4.6, 3.0, 2.6]];
    const face = wall(THREE, BAR_D, WALL, 0.5, holes, P.wallLit);
    face.position.set(xR, 0, 0);
    face.rotation.y = Math.PI / 2;
    g.add(face);
    g.add(box(THREE, 0.25, 2.6, 3.0, P.glass, xR - 0.3, 5.9, -16));
    /* the roll-up door, framed and slightly proud */
    g.add(box(THREE, 0.5, 9.4, 15.0, P.white, xR + 0.2, 4.9, 8));
    g.add(box(THREE, 0.3, 8.4, 14.0, P.wallLit, xR + 0.45, 4.7, 8));
    /* the meter bank */
    const met = [];
    for (let i = 0; i < 5; i++) met.push([xR + 0.35, 4.4, -6 + i * 2.0, 0, 0, 0, 0.35, 2.4, 1.5]);
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.meter, met));
    /* the banner hanging off the wall */
    g.add(box(THREE, 0.2, 7.0, 2.6, P.courtSky, xR + 0.4, 7.5, 1.5));
    /* downspout at the corner */
    g.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, WALL, 6), P.white))
      .translateX(0));
    g.children[g.children.length - 1].position.set(xR + 0.4, WALL / 2, zF - 1.5);

    /* the brick chimney off the far slope */
    g.add(box(THREE, 3.0, 12.0, 3.0, P.brick, -6, RIDGE - 3.0, -18));
    g.add(box(THREE, 3.8, 0.8, 3.8, P.brick, -6, RIDGE + 3.4, -18));
  }

  /* ---- the BROAD STREET gable: the front of the church ---------------- */
  const PORCH = 5.0;
  {
    /* the gable field, its white rake, the louvered vent */
    const tri = pediment(THREE, BAR_W, RIDGE - WALL, 0.6, P.gable);
    tri.position.set(0, WALL, zF + 0.5);
    g.add(tri);
    for (const sgn of [-1, 1]) {
      const rake = box(THREE, slabLen, 0.7, 0.8, P.white,
        sgn * (BAR_W / 4), (WALL + RIDGE) / 2 + 0.55, zF + 0.9);
      rake.rotation.z = -sgn * slope;
      g.add(rake);
    }
    g.add(box(THREE, BAR_W + 1.4, 0.9, 1.0, P.white, 0, WALL + 0.2, zF + 0.8));
    g.add(box(THREE, 2.2, 2.6, 0.4, P.white, 0, WALL + 3.4, zF + 0.9));
    g.add(box(THREE, 1.6, 2.0, 0.2, P.glass, 0, WALL + 3.4, zF + 1.05));

    /* the RECESSED porch: the wall stops back, four square posts stand
       at the face, and the roof carries over them */
    /* the roof carries over the porch as a THIN slab; a full-height
       box here buried the whole blue gable field behind it */
    g.add(box(THREE, BAR_W + 1.2, 0.5, PORCH + 1.4, P.roof, 0, WALL + 0.3, zF - PORCH / 2 + 0.7));
    const posts = [];
    for (const dx of [-11.0, -3.7, 3.7, 11.0]) posts.push([dx, WALL / 2 - 1.2, zF - 0.9]);
    g.add(inst(THREE, new THREE.BoxGeometry(1.0, WALL - 2.4, 1.0), P.white, posts));
    g.add(box(THREE, BAR_W - 1.0, 1.0, 1.2, P.white, 0, WALL - 1.3, zF - 0.9));
    /* the porch deck, knee wall and steps down to the yard */
    g.add(box(THREE, BAR_W - 1.0, 2.4, PORCH, P.whiteDim, 0, 1.2, zF - PORCH / 2));
    g.add(box(THREE, BAR_W + 1.0, 2.6, 1.0, P.white, 0, 1.3, zF + 1.2));
    for (let i = 0; i < 4; i++)
      g.add(box(THREE, 8.0, 0.55, 1.3, P.whiteDim, 9.0, 2.1 - i * 0.55, zF + 1.9 + i * 1.3));
    for (const dx of [5.2, 12.8]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 8.0, 6), P.iron);
      r.position.set(dx, 3.4, zF + 4.2); r.rotation.x = Math.PI / 2 - 0.30;
      g.add(shadowed(r));
      g.add(inst(THREE, new THREE.CylinderGeometry(0.14, 0.14, 3.4, 6), P.iron,
        [[dx, 1.7, zF + 2.2], [dx, 1.2, zF + 6.4]]));
    }
    /* the dark double door, and "477" up the trim beside it */
    g.add(box(THREE, 5.2, 8.4, 0.4, P.door, -1.5, 6.6, zF - PORCH));
    const num = inscription(THREE, "477", 0.62, 0.12);
    if (num) {
      const t = shadowed(new THREE.Mesh(num, P.white));
      t.rotation.z = Math.PI / 2;
      t.position.set(2.2, 7.4, zF - PORCH + 0.3);
      g.add(t);
    }
    g.add(inst(THREE, new THREE.BoxGeometry(0.14, 3.0, 0.14), P.iron,
      Array.from({ length: 11 }, (_, i) => [-11.2 + i * 1.5, 4.0, zF - 1.4])));
    g.add(box(THREE, 16.0, 0.2, 0.2, P.iron, -3.6, 5.5, zF - 1.4));
  }

  /* ---- the steeple, off the ridge just behind the Broad St gable ------ */
  {
    const sz = zF - 9.0, shaftH = 8.0, spireH = 16.0, tw = 3.4;
    g.add(box(THREE, tw + 1.0, 1.0, tw + 1.0, P.white, 0, RIDGE - 0.3, sz));
    g.add(box(THREE, tw, shaftH, tw, P.white, 0, RIDGE + shaftH / 2, sz));
    g.add(box(THREE, tw + 1.2, 0.8, tw + 1.2, P.white, 0, RIDGE + shaftH + 0.4, sz));
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.22, tw * 0.62, spireH, 8), P.white);
    spire.position.set(0, RIDGE + shaftH + 0.8 + spireH / 2, sz);
    g.add(shadowed(spire));
    const cy = RIDGE + shaftH + 0.8 + spireH;
    g.add(box(THREE, 0.22, 3.0, 0.22, P.white, 0, cy + 1.5, sz));
    g.add(box(THREE, 1.6, 0.22, 0.22, P.white, 0, cy + 2.1, sz));
  }

  /* ==================================================================
     THE PARKING LOT AND THE BASKETBALL COURT
     Between the church's flank and Railroad Avenue. Painted blue key
     with orange trim and a light-blue arc, and a real backboard and
     hoop on a pole at the church end. This is where the neighbourhood
     actually is; it is not decoration.
     ================================================================== */
  const LOT_X = xR + 46;                       /* the Railroad Ave kerb */
  {
    g.add(box(THREE, LOT_X - xR, 0.3, BAR_D + 22, P.asphalt,
      (xR + LOT_X) / 2, 0.15, -4));

    /* two painted half-courts, laid end to end along the flank */
    for (const cz of [-26, 16]) {
      const cx = xR + 22;
      /* the light-blue apron, then the blue key, then the orange trim */
      g.add(box(THREE, 34, 0.1, 30, P.courtSky, cx, 0.33, cz));
      g.add(box(THREE, 20, 0.1, 15, P.courtBlue, cx - 5, 0.36, cz));
      g.add(box(THREE, 20, 0.1, 1.0, P.courtOrange, cx - 5, 0.38, cz - 7.5));
      g.add(box(THREE, 20, 0.1, 1.0, P.courtOrange, cx - 5, 0.38, cz + 7.5));
      g.add(box(THREE, 1.0, 0.1, 15, P.courtOrange, cx - 15, 0.38, cz));
      /* the free-throw circle and the baseline */
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.22, 5, 20), P.courtLine);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx + 5, 0.4, cz);
      g.add(shadowed(ring));
      g.add(box(THREE, 0.6, 0.1, 30, P.courtLine, cx - 16.5, 0.4, cz));
    }

    /* the backboard and hoop on its pole, at the church end */
    const bx = xR + 7, bz = -26;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 13.5, 7), P.iron);
    pole.position.set(bx, 6.75, bz);
    g.add(shadowed(pole));
    g.add(box(THREE, 1.4, 0.34, 0.34, P.iron, bx + 0.9, 13.0, bz));
    g.add(box(THREE, 0.3, 3.6, 6.0, P.backboard, bx + 1.9, 12.0, bz));
    g.add(box(THREE, 0.22, 1.5, 2.4, P.rim, bx + 2.1, 11.4, bz));
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.1, 5, 12), P.rim);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(bx + 2.9, 10.6, bz);
    g.add(shadowed(hoop));
  }

  /* ---- the yard on the Broad Street side ------------------------------ */
  const FC = zF + 22;                          /* the Broad Street kerb */
  {
    g.add(box(THREE, BAR_W + 4, 0.3, FC - zF - 1, P.grass, -2, 0.16, (zF + FC) / 2));
    const con = new THREE.Mesh(new THREE.ConeGeometry(2.4, 8.0, 7), P.conifer);
    con.position.set(-14.0, 4.2, zF + 8.0);
    g.add(shadowed(con));
  }

  /* ---- the black iron fence, WRAPPING THE CORNER ---------------------- */
  {
    const mk = (pts) => {
      const pick = [];
      for (const [x, z] of pts) pick.push([x, 3.0, z]);
      g.add(inst(THREE, new THREE.BoxGeometry(0.11, 6.0, 0.11), P.iron, pick));
      g.add(inst(THREE, new THREE.ConeGeometry(0.1, 0.34, 4), P.iron,
        pick.map((p) => [p[0], 6.17, p[2]])));
    };
    /* along Broad Street */
    const a = [];
    for (let x = -BAR_W / 2 - 8; x <= LOT_X; x += 0.62) a.push([x, FC]);
    mk(a);
    for (const y of [1.2, 5.4]) g.add(box(THREE, LOT_X + BAR_W / 2 + 8, 0.16, 0.16, P.iron,
      (LOT_X - BAR_W / 2 - 8) / 2, y, FC));
    /* along Railroad Avenue, with a gate opening for the drive */
    const b = [];
    for (let z = FC; z >= -BAR_D / 2 - 14; z -= 0.62) {
      if (z < -6 && z > -20) continue;          /* the drive */
      b.push([LOT_X, z]);
    }
    mk(b);
    for (const [z0, z1] of [[-6, FC], [-BAR_D / 2 - 14, -20]])
      for (const y of [1.2, 5.4])
        g.add(box(THREE, 0.16, 0.16, z1 - z0, P.iron, LOT_X, y, (z0 + z1) / 2));
  }

  /* ---- the blue peaked marquee sign at the Broad Street kerb ---------- */
  {
    const mx = 11, mz = FC - 3.0;
    g.add(box(THREE, 7.4, 3.4, 1.6, P.signBlue, mx, 1.7, mz));
    g.add(box(THREE, 8.2, 5.4, 1.8, P.signBlue, mx, 6.1, mz));
    const top = pediment(THREE, 8.2, 1.7, 1.8, P.signBlue);
    top.position.set(mx, 8.8, mz + 0.9);
    g.add(top);
    g.add(box(THREE, 7.0, 1.7, 0.3, P.signFace, mx, 7.7, mz + 1.0));
    g.add(box(THREE, 6.2, 2.9, 0.3, P.signFace, mx, 5.4, mz + 1.0));
    const nm = inscription(THREE, "SHILOH", 0.22, 0.1);
    if (nm) {
      const t = shadowed(new THREE.Mesh(nm, P.signBlue));
      t.position.set(mx, 7.9, mz + 1.15);
      g.add(t);
    }
    const bp = inscription(THREE, "BAPTIST CHURCH", 0.115, 0.08);
    if (bp) {
      const t = shadowed(new THREE.Mesh(bp, P.signBlue));
      t.position.set(mx, 7.1, mz + 1.15);
      g.add(t);
    }
    for (const [txt, y] of [["WORSHIP SUN 10 AM", 6.0], ["BIBLE STUDY DAILY", 4.9]]) {
      const l = inscription(THREE, txt, 0.105, 0.07);
      if (!l) continue;
      const t = shadowed(new THREE.Mesh(l, P.iron));
      t.position.set(mx, y, mz + 1.15);
      g.add(t);
    }
  }

  const outer = new THREE.Group();
  const S = 0.09;                    /* feet -> world units */
  g.scale.setScalar(S);
  outer.add(g);
  outer.userData.footprint = 56 * S;
  outer.userData.height = (RIDGE + 8 + 16 + 3) * S;
  outer.userData.slug = "docket-516";
  outer.userData.frontBearing = 340;  /* +Z faces Broad St, NNW */
  outer.name = "docket-516";
  return outer;
}

/* ------------------------------------------------------------------
   INTERIOR INK
   A silhouette outline alone is a massing study. The reference draws
   INSIDE the shape: coursing, a string course at every floor, panel
   joints, a plinth line, a fascia under the eaves, downpipes read as
   lines. Without them a wall is a blank plane and the back of a
   building is three blank boxes.

   Rather than hand-drawing that on four buildings, this walks the
   finished group and rules the lines onto every large box mass it
   finds — front, back and both flanks, which is the point: the rear
   elevations get exactly the same treatment as the front. The bands
   stand a hair proud of the wall so the OutlineEffect pass inks each
   one as a drawn line rather than tinting the wall.

   Everything is measured in WORLD units and divided back through the
   group's own scale, so the same line weight lands on a building
   modelled at 0.09 and one modelled at 0.24.
   ------------------------------------------------------------------ */
function inkMasses(THREE, root, opt = {}) {
  const ink = cel(THREE, opt.color ?? 0x4a453d);
  const dark = cel(THREE, opt.glass ?? 0x2e3338);
  const U = new THREE.BoxGeometry(1, 1, 1);
  const jobs = [];

  /* Every builder models in its own units and shrinks the whole thing
     to world scale at the end, so the only honest measure of "how big
     is this wall really" is its scale in the finished group. */
  root.updateMatrixWorld(true);
  const sv = new THREE.Vector3(), pv = new THREE.Vector3(), qv = new THREE.Quaternion();

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.noInk) return;
    const g = o.geometry;
    if (!g || g.type !== "BoxGeometry") return;
    if (!g.boundingBox) g.computeBoundingBox();
    o.matrixWorld.decompose(pv, qv, sv);
    const s = Math.abs(sv.x) || 1;
    const bb = g.boundingBox;
    const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
    if (h * s < (opt.minH ?? 1.5)) return;
    if (Math.max(w, d) * s < (opt.minW ?? 1.8)) return;
    if (Math.min(w, d) * s < (opt.minT ?? 0.3)) return;
    const c = o.material && o.material.color;
    if (c && c.r * 0.3 + c.g * 0.6 + c.b * 0.1 < 0.3) return;   /* already dark */
    jobs.push([o, bb, w, h, d, s]);
  });

  for (const [o, bb, w, h, d, s] of jobs) {
    const step = (opt.step ?? 1.35) / s;      /* one course per storey  */
    const t = (opt.weight ?? 0.05) / s;       /* the line weight        */
    const bay = (opt.bay ?? 2.4) / s;         /* window bay pitch       */
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const rows = [];
    const band = (y, k) => {
      rows.push([cx, y, cz + d / 2 + t / 2, 0, 0, 0, w * 0.995, t * k, t]);
      rows.push([cx, y, cz - d / 2 - t / 2, 0, 0, 0, w * 0.995, t * k, t]);
      rows.push([cx + w / 2 + t / 2, y, cz, 0, 0, 0, t, t * k, d * 0.995]);
      rows.push([cx - w / 2 - t / 2, y, cz, 0, 0, 0, t, t * k, d * 0.995]);
    };
    /* coursing, with every third line pulled out as a string course */
    const n = Math.max(2, Math.round(h / step));
    for (let i = 1; i < n; i++) band(bb.min.y + (h * i) / n, i % 3 === 0 ? 2.2 : 1);
    /* the plinth line and the fascia under the eaves */
    band(bb.min.y + Math.min(h * 0.09, step * 0.5), 3.0);
    band(bb.max.y - Math.min(h * 0.06, step * 0.35), 3.4);
    /* WINDOW REVEALS. A blank box is what makes a rear elevation read
       as unfinished, so every face of every mass gets a bay rhythm:
       a dark recess, a head and jamb line, a mullion and a sill. */
    const holes = [];
    const faces = [
      { span: w, out: d / 2, ax: 1 },
      { span: w, out: -d / 2, ax: 1 },
      { span: d, out: w / 2, ax: 0 },
      { span: d, out: -w / 2, ax: 0 }
    ];
    for (const f of faces) {
      const sgn = Math.sign(f.out) || 1;
      const bays = Math.max(1, Math.round(f.span / bay));
      if (bays < 2 || n < 2) continue;
      const pitch = f.span / bays;
      const ow = Math.min(pitch * 0.44, bay * 0.5);
      const oh = Math.min((h / n) * 0.5, ow * 1.8);
      const put = (a, y, sx, sy, depth, arr, off) => {
        const p = f.ax
          ? [cx + a, y, cz + f.out + sgn * off, 0, 0, 0, sx, sy, depth]
          : [cx + f.out + sgn * off, y, cz + a, 0, 0, 0, depth, sy, sx];
        arr.push(p);
      };
      for (let fl = 0; fl < n; fl++) {
        const y = bb.min.y + (h * (fl + 0.55)) / n;
        for (let i = 0; i < bays; i++) {
          const a = -f.span / 2 + pitch * (i + 0.5);
          /* the recess is inked by the outline pass, so it draws its
             own jamb and head — only the sill and mullion are added */
          put(a, y, ow, oh, t * 1.6, holes, -t * 0.6);
          put(a, y - oh / 2 - t, ow + t * 4, t * 1.5, t * 1.6, rows, t * 0.7);
          put(a, y, t * 1.1, oh * 0.98, t, rows, t * 0.4);
        }
      }
    }
    /* a downpipe at each corner, drawn as a heavier vertical */
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      rows.push([cx + sx * (w / 2 - t * 2.5), cy, cz + sz * (d / 2 + t * 1.2),
        0, 0, 0, t * 2.6, h * 0.98, t * 2.6]);
    o.add(inst(THREE, U, ink, rows));
    if (holes.length) o.add(inst(THREE, U, dark, holes));
  }
  return root;
}

/* ------------------------------------------------------------------
   ROOF PLANT
   In the reference there is no such thing as an empty roof: there is
   always a condenser, a vent stack, a dish, a bulkhead over the
   stair. This finds every flat deck in a finished building that has
   nothing above it, and stands plant on it. Pitched roofs are custom
   geometry and are never touched, so no slate ever gets an air
   conditioner bolted to it.
   ------------------------------------------------------------------ */
function roofPlant(THREE, root, opt = {}) {
  root.updateMatrixWorld(true);
  const all = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    if (!g.boundingBox) g.computeBoundingBox();
    all.push({ o, bb: g.boundingBox.clone().applyMatrix4(o.matrixWorld) });
  });

  const sv = new THREE.Vector3(), pv = new THREE.Vector3(), qv = new THREE.Quaternion();
  const decks = [];
  for (const b of all) {
    if (b.o.isInstancedMesh || b.o.geometry.type !== "BoxGeometry") continue;
    const w = b.bb.max.x - b.bb.min.x, h = b.bb.max.y - b.bb.min.y, d = b.bb.max.z - b.bb.min.z;
    if (h > 0.75 || w < 1.7 || d < 1.7 || b.bb.max.y < 0.9) continue;
    let clear = true;
    for (const c of all) {
      if (c === b || c.bb.min.y < b.bb.max.y + 0.04) continue;
      if (c.bb.max.x < b.bb.min.x + 0.25 || c.bb.min.x > b.bb.max.x - 0.25) continue;
      if (c.bb.max.z < b.bb.min.z + 0.25 || c.bb.min.z > b.bb.max.z - 0.25) continue;
      clear = false; break;
    }
    if (clear) decks.push(b);
  }
  if (!decks.length) return root;

  const galv = cel(THREE, 0xb0b4b6), ink = cel(THREE, 0x33373b), pale = cel(THREE, 0xd8d3c6);
  const U = new THREE.BoxGeometry(1, 1, 1);
  const CY = new THREE.CylinderGeometry(1, 1, 1, 8);
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (const b of decks) {
    b.o.matrixWorld.decompose(pv, qv, sv);
    const s = Math.abs(sv.x) || 1;
    const g = b.o.geometry.boundingBox;
    const top = g.max.y;
    const w = g.max.x - g.min.x, d = g.max.z - g.min.z;
    const cx = (g.min.x + g.max.x) / 2, cz = (g.min.z + g.max.z) / 2;
    const K = 1 / s;                       /* world units -> deck units */
    const body = [], caps = [], skins = [];
    const spot = () => [cx + (rnd() - 0.5) * (w - 1.4 * K), cz + (rnd() - 0.5) * (d - 1.4 * K)];

    const n = Math.max(2, Math.min(7, Math.round((w * d * s * s) / 6)));
    for (let i = 0; i < n; i++) {
      const [x, z] = spot();
      const ry = rnd() * Math.PI;
      body.push([x, top + 0.19 * K, z, 0, ry, 0, 0.62 * K, 0.38 * K, 0.5 * K]);
      caps.push([x, top + 0.4 * K, z, 0, ry, 0, 0.46 * K, 0.05 * K, 0.36 * K]);
      caps.push([x, top + 0.44 * K, z, 0, ry, 0, 0.2 * K, 0.05 * K, 0.2 * K]);
      for (let k = 0; k < 3; k++)
        caps.push([x + Math.sin(ry) * 0.26 * K, top + (0.08 + k * 0.09) * K, z + Math.cos(ry) * 0.26 * K,
          0, ry, 0, 0.56 * K, 0.02 * K, 0.02 * K]);
    }
    for (let i = 0; i < 3; i++) {
      const [x, z] = spot();
      skins.push([x, top + 0.17 * K, z, 0, 0, 0, 0.1 * K, 0.34 * K, 0.1 * K]);
      caps.push([x, top + 0.37 * K, z, 0, 0, 0, 0.18 * K, 0.07 * K, 0.18 * K]);
    }
    /* the stair bulkhead, and a dish on a mast */
    const [bx, bz] = spot();
    body.push([bx, top + 0.42 * K, bz, 0, rnd() * 3, 0, 1.15 * K, 0.85 * K, 0.9 * K]);
    caps.push([bx, top + 0.87 * K, bz, 0, 0, 0, 1.25 * K, 0.06 * K, 1.0 * K]);
    const [dx2, dz2] = spot();
    skins.push([dx2, top + 0.3 * K, dz2, 0, 0, 0, 0.07 * K, 0.6 * K, 0.07 * K]);
    caps.push([dx2, top + 0.66 * K, dz2, Math.PI * 0.34, rnd() * 3, 0, 0.62 * K, 0.09 * K, 0.62 * K]);

    if (body.length) b.o.add(inst(THREE, U, galv, body));
    if (caps.length) b.o.add(inst(THREE, U, ink, caps));
    if (skins.length) b.o.add(inst(THREE, CY, ink, skins));
  }
  return root;
}

/* ------------------------------------------------------------------ */

const BUILDERS = {
  "bridgeport-city-hall": bridgeportCityHall,
  "ct-legislative-office-building": ctLegislativeOfficeBuilding,
  "georgia-state-capitol": georgiaStateCapitol,
  "docket-516": shilohDocket516
};

/** Build one landmark. Returns a THREE.Group standing on y = 0, front
 *  facing +Z, scaled to world units, with userData.footprint set.
 *  Unknown slugs return null on purpose: a landmark with no reference
 *  photographs must not be invented. */
export function build(slug, THREE = THREE_DEFAULT) {
  const fn = BUILDERS[slug];
  if (!fn) return null;
  return roofPlant(THREE, inkMasses(THREE, fn(THREE)));
}

/** The drawing kit, shared with the district builder so the streets
 *  around a landmark are inked with exactly the same materials and
 *  helpers as the landmark itself. One palette, one ramp, one look. */
export const H = {
  cel, box, inst, wall, hipRoof, pediment, colonnade,
  inscription, arcInscription, mergeGeoms,
  lampPost, acUnit, dish, vent, shadowed, planShape, planPrism
};

/** Triangles in a built group — for budget checks. */
export function triangles(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += per * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
}
