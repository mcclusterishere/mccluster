/* ============================================================
   UPRISE DISTRICTS — the ground each landmark actually stands on.

   A landmark alone is a model on a plinth. What makes it a PLACE is
   the street it fronts, which side of it the street is on, what runs
   along the far kerb, and the name on the sign at the corner. That is
   all surveyed here, off the same overhead maps and street frames in
   assets/landmarks/, and recorded in SURVEY below so the geography
   can be argued with — and corrected — without reading the geometry.

       import { buildSite, SURVEY } from "./uprise-district.js";
       const site = buildSite("docket-516", THREE);

   Each site returns a Group standing on y = 0. The hero building keeps
   its own +Z-is-front convention; the district is laid out around it in
   the same frame. userData.frontBearing on the returned group is the
   TRUE COMPASS BEARING of model +Z, so a reader can put a compass on
   any screenshot: bearing 90 means walking +Z walks you east.

   WHAT IS SURVEYED AND WHAT IS DRESSING
   The hero building, the streets, their names, their widths, which
   side of the building each one lies on, and what sits across them are
   read from the references and are meant to be RIGHT. The individual
   parked cars, trees and lamp posts are dressing at plausible spacing.
   Nothing invents a street name: a street with no name in the sources
   is drawn as pavement and left unlabelled.
   ============================================================ */

import * as THREE_DEFAULT from "../vendor/three.module.min.js";
import { H, build } from "./uprise-landmarks.js";
import { makeKit, fenceRun } from "./uprise-props.js";

const { cel, box, inst, wall, inscription, pediment, shadowed } = H;

/* ------------------------------------------------------------------
   THE SURVEY
   Distances are in FEET in each site's own local frame, with +Z
   pointing the way the hero building's façade points. They are scaled
   to world units at the end by the same factor the hero uses.
   ------------------------------------------------------------------ */
export const SURVEY = {

  /* ---------------------------------------------------------------- */
  "docket-516": {
    name: "Shiloh Baptist Church",
    address: "477 Broad Street, Bridgeport, Connecticut",
    scale: 0.09,
    frontBearing: 340,            /* the facade looks NNW up Broad Street */
    sources: [
      "the owner's own Street View walk of the property (Nov 2020 and Jul 2024 imagery)",
      "assets/landmarks/shiloh-docket-516/aerial-wide-corridor.jpg (Street View from Broad St)",
      "assets/landmarks/shiloh-docket-516/aerial-close.jpg / aerial-corridor.jpg / aerial-rooftop.jpg"
    ],
    findings: [
      "IT IS A CORNER LOT: Broad Street x Railroad Avenue, signalised, with ladder crosswalks and mast-arm signals.",
      "The front gable, the recessed porch and the steeple face BROAD STREET. The long flank runs back along RAILROAD AVENUE, so the ridge is perpendicular to Broad Street.",
      "The parking lot sits between that flank and Railroad Avenue and is painted as a BASKETBALL COURT - blue key, orange trim, light-blue apron - with a real backboard and hoop on a pole at the church end.",
      "The white roof cross is on the slope facing the court and Railroad Avenue; the solar array is on the other slope.",
      "The railroad is NOT in a cut. It runs on an ELEVATED EMBANKMENT behind a rough-cut STONE RETAINING WALL along the far side of Railroad Avenue, with the steel catenary lattice above it. Railroad Avenue passes under the tracks at the far end.",
      "Docket 516 is the Fairfield-to-Congress 115-kV rebuild: the circuits hang today on that railroad catenary, and the application was to move them onto steel monopoles 95 to 145 feet tall - three to four times the height of the steeple.",
      "The Delvis Furniture warehouse, 466 Lafayette Street, runs along Railroad Avenue past the church with a full-length MURAL on its Railroad Avenue wall.",
      "The Bridgeport Harbor Station stack - red and white banded - stands on the skyline beyond the corner."
    ],
    /* Kerb arithmetic. The Broad Street fence is at z = 61ft and the
       Railroad Avenue fence at x = 63ft; sidewalks run 12ft off each,
       so Broad Street's centreline is 96 and Railroad Avenue's is 98. */
    ground: [520, 470, 20],
    streets: [
      { name: "BROAD STREET", side: "front", offset: 96, width: 42,
        length: 420, lanes: 2, parking: true, sidewalkNear: true, sign: true,
        overhead: true },
      { name: "RAILROAD AVENUE", side: "right", offset: 98, width: 38,
        length: 440, lanes: 2, parking: true, sidewalkNear: true, sign: true,
        overhead: true }
    ],
    /* the embankment runs beyond Railroad Avenue, parallel to it */
    embankment: { offset: 148, wallH: 15, deck: 34, along: "z", length: 440 },
    monopoles: { spacing: 150, heights: [145, 118, 145], count: 3 },
    /* the warehouse and its mural, down Railroad Avenue past the lot */
    mural: { name: "DELVIS FURNITURE", w: 120, d: 150, h: 26, x: -95, z: -140 },
    stack: { x: -150, z: -300, h: 260 }
  },

  /* ---------------------------------------------------------------- */
  "bridgeport-city-hall": {
    name: "Bridgeport City Hall",
    address: "45 Lyon Terrace, Bridgeport, Connecticut",
    scale: 0.055,
    frontBearing: 0,              /* +Z is the portico's outlook down Lyon Terrace */
    sources: ["assets/landmarks/bridgeport-city-hall/aerial-01..03.jpg", "street-01..02.jpg"],
    findings: [
      "The pedimented portico faces LYON TERRACE, the short street that loops in front of the building; GOLDEN HILL STREET is the through street beyond it.",
      "A large surface parking lot sits on the building's right flank in the aerials.",
      "The Downtown Cabaret Theatre, 263 Golden Hill Street, faces the building from across the street.",
      "The wings are symmetrical about the portico and the roof is a dark hip with a small cupola over the centre block."
    ],
    streets: [
      { name: "LYON TERRACE", side: "front", offset: 158, width: 40,
        length: 620, lanes: 2, parking: true, sidewalkNear: true, sign: true },
      { name: "GOLDEN HILL STREET", side: "front", offset: 272, width: 52,
        length: 620, lanes: 2, parking: true, sidewalkNear: true, sign: true }
    ],
    ground: [740, 640, 100],
    lot: { offset: 40, x: 300, w: 220, d: 260 },
    across: [{ name: "DOWNTOWN CABARET", w: 130, d: 90, h: 42, x: -120, offset: 320 }]
  },

  /* ---------------------------------------------------------------- */
  "ct-legislative-office-building": {
    name: "Connecticut Legislative Office Building",
    address: "300 Capitol Avenue, Hartford, Connecticut",
    scale: 0.055,
    frontBearing: 180,            /* the front looks SOUTH onto Capitol Avenue */
    sources: ["assets/landmarks/ct-legislative-office-building/aerial.jpg", "exterior-front.jpg", "exterior-side.jpg"],
    findings: [
      "The LOB fronts CAPITOL AVENUE; the State Capitol stands across Capitol Avenue to the north-east and Bushnell Park beyond it.",
      "BROAD STREET runs along the building's west flank.",
      "The concourse to the Capitol crosses under Capitol Avenue, which is why the two read as one campus from the air.",
      "NOTE FOR THE RECORD: data/uprise-world.json names landmark 2 the Connecticut State Capitol at 210 Capitol Avenue, but the reference photographs supplied are the LEGISLATIVE OFFICE BUILDING at 300 Capitol Avenue, and that is what is modelled. The citations were presented at the Capitol complex; the two buildings are one campus, joined underground."
    ],
    streets: [
      /* +Z is south, so +X is west: Broad Street runs down the
         building's WEST flank and is therefore "right". */
      { name: "CAPITOL AVENUE", side: "front", offset: 200, width: 56,
        length: 700, lanes: 4, parking: false, sidewalkNear: true, sign: true },
      { name: "BROAD STREET", side: "right", offset: 260, width: 44,
        length: 620, lanes: 2, parking: true, sidewalkNear: true, sign: true }
    ],
    ground: [760, 660, 60]
  },

  /* ---------------------------------------------------------------- */
  "georgia-state-capitol": {
    name: "Georgia State Capitol",
    address: "206 Washington Street SW, Atlanta, Georgia",
    scale: 0.05,
    frontBearing: 270,            /* the grand portico faces WEST onto Washington St SW */
    sources: ["assets/landmarks/georgia-state-capitol/topdown-map.jpg (north up)", "aerial-front/rear/side/wide.jpg"],
    findings: [
      "North is up on the supplied overhead map, so the four frontages are readable directly.",
      "WASHINGTON STREET SW runs north-south along the WEST side; the grand portico and steps face it. This is the front.",
      "MARTIN LUTHER KING JR DRIVE runs east-west along the NORTH side (SW west of the square, SE east of it).",
      "CAPITOL AVENUE SW / CAPITOL SQUARE SW runs north-south along the EAST side.",
      "MITCHELL STREET SW runs east-west along the SOUTH side.",
      "LIBERTY PLAZA is the oval lawn at the NORTH-EAST corner, across Capitol Square from the grounds — not opposite the portico.",
      "Atlanta City Hall lies to the south-west across Mitchell Street; the Fulton County Courthouse and the Carnes Justice Center to the west beyond Pryor Street SW."
    ],
    streets: [
      /* +Z is west, so +X is north: M L King Jr Drive (the north
         side) is "right" and Mitchell Street SW (the south side) is
         "left". Capitol Avenue SW is the east side, so "back". */
      { name: "WASHINGTON STREET SW", side: "front", offset: 300, width: 52,
        length: 900, lanes: 2, parking: true, sidewalkNear: true, sign: true },
      { name: "M L KING JR DRIVE", side: "right", offset: 330, width: 58,
        length: 820, lanes: 4, parking: false, sidewalkNear: true, sign: true },
      { name: "MITCHELL STREET SW", side: "left", offset: 330, width: 46,
        length: 820, lanes: 2, parking: true, sidewalkNear: true, sign: true },
      { name: "CAPITOL AVENUE SW", side: "back", offset: 300, width: 48,
        length: 900, lanes: 2, parking: true, sidewalkNear: true, sign: true }
    ],
    ground: [980, 980, 0],
    /* the oval lawn at the NORTH-EAST corner: +X north, -Z east */
    plaza: { name: "LIBERTY PLAZA", corner: "north-east", rx: 150, rz: 110, offX: 250, offZ: -400 }
  }
};

/* ------------------------------------------------------------------
   DRAWING KIT FOR THE GROUND
   ------------------------------------------------------------------ */
function pal(THREE) {
  return {
    road: cel(THREE, 0x76736e),
    roadDark: cel(THREE, 0x656259),
    kerb: cel(THREE, 0xa9a49a),
    walk: cel(THREE, 0xbdb7ab),
    walkAlt: cel(THREE, 0xc9c3b5),
    line: cel(THREE, 0xe8e3d4),
    lineGold: cel(THREE, 0xd9b64e),
    grass: cel(THREE, 0x7ea866),
    grassDry: cel(THREE, 0xa8a077),
    dirt: cel(THREE, 0xa89577),
    signGreen: cel(THREE, 0x2f6b45),
    signWhite: cel(THREE, 0xf1efe6),
    pole: cel(THREE, 0x8b8880),
    iron: cel(THREE, 0x24272b),
    steel: cel(THREE, 0x9aa0a6),
    steelDim: cel(THREE, 0x767c83),
    wire: cel(THREE, 0x22242a, { ink: 0.004 }),
    ballast: cel(THREE, 0x6d6862),
    stone: cel(THREE, 0x7b6a5c),        /* the embankment retaining wall */
    stoneLit: cel(THREE, 0x8d7b6a),
    stoneCap: cel(THREE, 0x9d9186),
    signalBox: cel(THREE, 0x3b4038),
    signalRed: cel(THREE, 0xb0402f),
    mural: cel(THREE, 0x8f4a44),
    stackRed: cel(THREE, 0xc0453a),
    tie: cel(THREE, 0x4a4038),
    rail: cel(THREE, 0x585c63),
    concrete: cel(THREE, 0x9d988e),
    brickWall: cel(THREE, 0x8b5f4d),
    glass: cel(THREE, 0x3a4750, { ink: 0.004 }),
    tree: cel(THREE, 0x4f7a45),
    trunk: cel(THREE, 0x6d5340),
    carA: cel(THREE, 0xb0402f),
    carB: cel(THREE, 0x3d5a80),
    carC: cel(THREE, 0xd9d4c6),
    carD: cel(THREE, 0x4a4f55)
  };
}

/* Which way a named side lies in the model frame.

   +Z is the façade direction and its compass bearing is frontBearing,
   so the model's +X axis has bearing frontBearing + 90. Everything
   else follows from that, and `side` is what carries the sign:
   front/back run along X at +/-Z, left/right run along Z at -/+X.
   The first pass ignored the sign entirely, which stacked Mitchell
   Street on top of M L King Jr Drive and Capitol Avenue on top of
   Washington Street. */
function place(side) {
  switch (side) {
    case "back":  return { axis: "x", sign: -1 };
    case "left":  return { axis: "z", sign: -1 };
    case "right": return { axis: "z", sign: +1 };
    default:      return { axis: "x", sign: +1 };   /* front */
  }
}

/* the compass bearing of a side, for the record and for labelling */
export function bearingOf(frontBearing, side) {
  const turn = { front: 0, right: 90, back: 180, left: 270 }[side] ?? 0;
  return (frontBearing + turn + 360) % 360;
}

/* A named street blade on a pole — the thing that actually makes a
   street "named" on screen. Green blade, white block letters, the
   real name, standing at the kerb facing the walker. */
function streetBlade(THREE, P, text, x, z, faceY) {
  const g = new THREE.Group();
  const h = 9.5;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, h, 6), P.pole);
  pole.position.y = h / 2;
  g.add(shadowed(pole));
  const w = Math.max(6, text.length * 0.92);
  g.add(box(THREE, w, 1.9, 0.28, P.signGreen, 0, h - 0.9, 0));
  g.add(box(THREE, w - 0.5, 1.45, 0.1, P.signWhite, 0, h - 0.9, 0.17));
  const letters = inscription(THREE, text, Math.min(0.19, (w - 1.2) / (text.length * 6)), 0.09);
  if (letters) {
    const t = shadowed(new THREE.Mesh(letters, P.signGreen));
    t.position.set(0, h - 0.9, 0.26);
    g.add(t);
  }
  g.position.set(x, 0, z);
  g.rotation.y = faceY;
  return g;
}

/* A roadway: asphalt, kerbs, a dashed centre line, and a sidewalk on
   the near side. `along` is the axis the road runs down. */
function roadway(THREE, P, s, out) {
  const pl = place(s.side);
  const alongX = pl.axis === "x";
  const L = s.length, W = s.width, o = s.offset * pl.sign;
  const g = new THREE.Group();
  const put = (w, h, d, mat, x, y, z) => g.add(box(THREE, w, h, d, mat, x, y, z));
  /* the sidewalk and the parking lane are always on the kerb NEAREST
     the building, whichever side of it this street runs down */
  const near = -pl.sign;

  if (alongX) {
    put(L, 0.4, W, P.road, 0, 0.2, o);
    put(L, 0.7, 1.6, P.kerb, 0, 0.35, o - W / 2 - 0.8);
    put(L, 0.7, 1.6, P.kerb, 0, 0.35, o + W / 2 + 0.8);
    if (s.sidewalkNear) put(L, 0.5, 12, P.walk, 0, 0.25, o + near * (W / 2 + 7.6));
    const dash = [];
    for (let x = -L / 2 + 8; x < L / 2 - 8; x += 26) dash.push([x, 0.42, o, 0, 0, 0, 12, 0.1, 0.8]);
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.line, dash));
    if (s.parking) put(L, 0.1, 0.7, P.line, 0, 0.42, o + near * (W / 2 - 9));
  } else {
    put(W, 0.4, L, P.road, o, 0.2, 0);
    put(1.6, 0.7, L, P.kerb, o - W / 2 - 0.8, 0.35, 0);
    put(1.6, 0.7, L, P.kerb, o + W / 2 + 0.8, 0.35, 0);
    if (s.sidewalkNear) put(12, 0.5, L, P.walk, o + near * (W / 2 + 7.6), 0.25, 0);
    const dash = [];
    for (let z = -L / 2 + 8; z < L / 2 - 8; z += 26) dash.push([o, 0.42, z, 0, 0, 0, 0.8, 0.1, 12]);
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.line, dash));
    if (s.parking) put(o + near * (W / 2 - 9), 0.42, 0.7, P.line, 0, 0, 0);
  }
  out.add(g);
}

/* Street trees, parked cars and the overhead distribution the South
   End actually lives under. Dressing at plausible spacing — nothing
   here claims to be a surveyed object — but drawn as objects, not as
   the featureless slabs the first pass parked at the kerb. */
function carBody(THREE) {
  const parts = [];
  const b = new THREE.BoxGeometry(14.4, 2.5, 5.9); b.translate(0, 1.55, 0); parts.push(b);
  const c = new THREE.BoxGeometry(7.4, 2.2, 5.3); c.translate(-0.5, 3.9, 0); parts.push(c);
  return H.mergeGeoms(THREE, parts);
}
function wheelRows(THREE, rows) {
  const out = [];
  for (const r of rows)
    for (const dx of [-4.6, 4.6])
      for (const dz of [-3.1, 3.1]) {
        const c = Math.cos(r[4] || 0), s2 = Math.sin(r[4] || 0);
        out.push([r[0] + dx * c + dz * s2, 1.05, r[2] - dx * s2 + dz * c,
          Math.PI / 2, 0, r[4] || 0, 1, 1, 1]);
      }
  return out;
}

function streetLife(THREE, P, s, out) {
  const pl = place(s.side);
  const along = pl.axis === "z";
  const L = s.length, W = s.width, o = s.offset * pl.sign, near = -pl.sign;
  const trunks = [], crowns = [], poles = [], arms = [];
  const carMats = [P.carA, P.carB, P.carC, P.carD];
  const rows = [[], [], [], []];

  for (let t = -L / 2 + 30; t < L / 2 - 30; t += 62) {
    const k = o + near * (W / 2 + 7);
    if (along) { trunks.push([k, 5, t]); crowns.push([k, 13, t]); }
    else { trunks.push([t, 5, k]); crowns.push([t, 13, k]); }
  }
  /* Wooden distribution poles with crossarms. The wires strung over
     Broad Street are the loudest thing in the Shiloh reference frame,
     but they do not belong in front of a state capitol — so this is
     opt-in per street, not scenery applied everywhere. */
  const polePts = [];
  for (let t = s.overhead ? -L / 2 + 55 : L; t < L / 2 - 40; t += 118) {
    const k = o + near * (W / 2 + 4);
    polePts.push(along ? [k, 0, t] : [t, 0, k]);
  }
  for (const [px, , pz] of polePts) {
    poles.push([px, 17, pz, 0, 0, 0, 1, 1, 1]);
    for (const ay of [30, 26.5])
      arms.push([px, ay, pz, 0, along ? Math.PI / 2 : 0, 0, 9.5, 0.5, 0.5]);
  }
  if (poles.length) {
    out.add(inst(THREE, new THREE.CylinderGeometry(0.55, 0.8, 34, 7), P.trunk, poles));
    out.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.trunk, arms));
    /* the spans between them, sagging across the street */
    for (let i = 0; i < polePts.length - 1; i++) {
      const a = polePts[i], b = polePts[i + 1];
      for (const [ay, dx] of [[29.6, -3.4], [29.6, 0], [29.6, 3.4], [26.1, -3.4], [26.1, 3.4]]) {
        const p0 = along ? [a[0] + dx, ay, a[2]] : [a[0], ay, a[2] + dx];
        const p1 = along ? [b[0] + dx, ay, b[2]] : [b[0], ay, b[2] + dx];
        wireSpan(THREE, P, out, p0, p1, 2.6, 0.14);
      }
    }
  }

  if (s.parking) {
    let i = 0;
    for (let t = -L / 2 + 40; t < L / 2 - 40; t += 34) {
      if (i % 3 === 0) { i++; continue; }
      const lane = o + near * (W / 2 - 6);
      const row = along ? [lane, 0, t, 0, Math.PI / 2, 0] : [t, 0, lane, 0, 0, 0];
      rows[i % 4].push(row);
      i++;
    }
  }
  out.add(inst(THREE, new THREE.CylinderGeometry(0.55, 0.75, 10, 6), P.trunk, trunks));
  out.add(inst(THREE, new THREE.IcosahedronGeometry(8, 0), P.tree, crowns));
  const body = carBody(THREE), tyre = new THREE.CylinderGeometry(1.05, 1.05, 0.85, 7);
  const all = [];
  rows.forEach((r, i) => {
    if (!r.length) return;
    out.add(inst(THREE, body, carMats[i], r.map((q) => [q[0], 0, q[2], 0, q[4], 0, 1, 1, 1])));
    all.push(...r);
  });
  if (all.length) out.add(inst(THREE, tyre, P.iron, wheelRows(THREE, all)));
}

/* one sagging span, used by the distribution poles and the corridor */
function wireSpan(THREE, P, out, a, b, sag, r) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2];
  for (const [p, q] of [[a, mid], [mid, b]]) {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const len = Math.hypot(dx, dy, dz);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 4), P.wire);
    seg.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, dy, dz).normalize());
    out.add(shadowed(seg));
  }
}

/* ------------------------------------------------------------------
   THE DOCKET 516 CORRIDOR
   The railroad is not in a cut. It rides an ELEVATED EMBANKMENT
   behind a rough-cut stone retaining wall along the far side of
   Railroad Avenue, with the steel catenary lattice standing on top
   carrying the 115-kV circuits — and the monopoles the application
   would have put in their place, at their real 95 to 145 feet.
   ------------------------------------------------------------------ */
function embankment(THREE, P, spec, mono, out) {
  const { offset: o, wallH: WH, deck, length: L } = spec;
  const g = new THREE.Group();

  /* the stone wall, coursed in rough blocks so it inks as masonry
     rather than as a grey slab */
  g.add(box(THREE, 3.0, WH, L, P.stone, 0, WH / 2, 0));
  const blocks = [];
  for (let y = 1.6; y < WH - 1; y += 3.1) {
    for (let z = -L / 2 + 2; z < L / 2 - 2; z += 5.4) {
      const jitter = ((z * 7 + y * 13) % 5) * 0.18;
      blocks.push([1.7, y, z + jitter, 0, 0, 0, 0.5, 2.5, 4.6]);
    }
  }
  g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.stoneLit, blocks));
  g.add(box(THREE, 4.2, 1.4, L, P.stoneCap, 0.2, WH + 0.7, 0));

  /* the ballast deck behind it, and the tracks on top */
  g.add(box(THREE, deck, WH, L, P.ballast, deck / 2 + 1.5, WH / 2, 0));
  const ties = [], rails = [];
  for (let i = 0; i < 3; i++) {
    const x = 9 + i * 11;
    rails.push([x - 2.4, WH + 1.55, 0, 0, 0, 0, 0.3, 0.3, L]);
    rails.push([x + 2.4, WH + 1.55, 0, 0, 0, 0, 0.3, 0.3, L]);
    for (let z = -L / 2; z < L / 2; z += 4.2)
      ties.push([x, WH + 1.3, z, 0, 0, 0, 8.4, 0.35, 0.9]);
  }
  g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.tie, ties));
  g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.rail, rails));

  /* the EXISTING condition: steel catenary lattice on the deck */
  for (let z = -L / 2 + 30; z < L / 2; z += 110) {
    const H1 = 34;
    for (const x of [5, deck - 2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.8, H1, 1.8), P.steelDim);
      leg.position.set(x, WH + H1 / 2, z);
      g.add(shadowed(leg));
    }
    g.add(box(THREE, deck - 5, 2.0, 2.6, P.steelDim, deck / 2 + 1, WH + H1, z));
    const dia = [];
    for (let i = 0; i < 5; i++)
      dia.push([6 + i * ((deck - 8) / 5), WH + 6 + i * 5.4, z, 0, 0, 0.5, 0.9, 11, 0.9]);
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.steelDim, dia));
    const ins = [];
    for (const x of [10, 18, deck - 10]) ins.push([x, WH + H1 - 2.6, z]);
    g.add(inst(THREE, new THREE.CylinderGeometry(0.45, 0.55, 3.4, 6), P.glass, ins));
  }

  /* THE MONOPOLES — the application, at their real height */
  const attach = [];
  for (let i = 0; i < mono.count; i++) {
    const z = (i - (mono.count - 1) / 2) * mono.spacing;
    const h = mono.heights[i % mono.heights.length];
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 4.2, h, 10), P.steel);
    shaft.position.set(deck - 6, WH + h / 2, z);
    g.add(shadowed(shaft));
    const lvl = [];
    for (const ay of [h - 8, h - 26, h - 44]) {
      const y = WH + ay;
      lvl.push([deck - 6, y, z + 7.5, 0, 0, 0, 1.8, 1.6, 15]);
      lvl.push([deck - 6, y, z - 7.5, 0, 0, 0, 1.8, 1.6, 15]);
      for (const dz of [15, -15]) {
        lvl.push([deck - 6, y - 3.0, z + dz, 0, 0, 0, 1.0, 5.0, 1.0]);
        attach.push([deck - 6, y - 6.0, z + dz]);
      }
    }
    g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.steelDim, lvl));
  }
  const per = 6;
  for (let c = 0; c < per; c++)
    for (let t = 0; t < mono.count - 1; t++)
      wireSpan(THREE, P, g, attach[t * per + c], attach[(t + 1) * per + c], 9, 0.22);

  g.position.x = o;
  out.add(g);
}

/* the signalised corner: ladder crosswalks, mast arms, and the small
   regulatory signs that are half of what a real intersection is */
function intersection(THREE, P, cx, cz, out) {
  const g = new THREE.Group();
  const bars = [];
  for (let i = 0; i < 9; i++) {
    bars.push([cx - 30 + i * 4.4, 0.45, cz - 26, 0, 0, 0, 2.2, 0.1, 14]);
    bars.push([cx - 26, 0.45, cz - 30 + i * 4.4, 0, 0, 0, 14, 0.1, 2.2]);
  }
  g.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.line, bars));

  for (const [px, pz, ry] of [[cx - 34, cz - 34, 0], [cx + 26, cz - 34, Math.PI / 2]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 26, 8), P.pole);
    mast.position.set(px, 13, pz);
    g.add(shadowed(mast));
    const arm = box(THREE, 26, 0.6, 0.6, P.pole, 0, 25, 0);
    arm.position.set(px + Math.cos(ry) * 13, 25, pz + Math.sin(ry) * 13);
    arm.rotation.y = ry;
    g.add(arm);
    for (const d of [8, 18]) {
      const head = box(THREE, 1.6, 4.2, 1.4, P.signalBox,
        px + Math.cos(ry) * d, 22.6, pz + Math.sin(ry) * d);
      g.add(head);
      g.add(inst(THREE, new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8), P.signalRed,
        [[px + Math.cos(ry) * d, 23.9, pz + Math.sin(ry) * d + 0.8, Math.PI / 2, 0, 0]]));
    }
    /* ONE WAY and DO NOT ENTER, as posted */
    g.add(box(THREE, 4.2, 1.3, 0.2, P.signWhite, px, 17.5, pz + 0.6));
    g.add(inst(THREE, new THREE.CylinderGeometry(1.4, 1.4, 0.2, 12), P.signalRed,
      [[px, 14.4, pz + 0.6, Math.PI / 2, 0, 0]]));
  }
  out.add(g);
}

/* ------------------------------------------------------------------
   THE CLUTTER
   What separates a street from a diagram of a street is that a real
   one is littered: a hydrant here, a bin, a parking sign, a bench, a
   planter, three cones round a patch in the asphalt, a manhole, a
   crack running out of it. None of it is surveyed and none of it
   needs to be — it is placed off a fixed seed so it is the same
   street every time you walk it, and it is all instanced, so a
   hundred cones cost one draw call.
   ------------------------------------------------------------------ */

function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* Everything that lives along one street: the sidewalk furniture, the
   kerb, and the paint and ironwork in the roadway itself. */
function streetProps(THREE, P, K, s, out) {
  const pl = place(s.side);
  const alongX = pl.axis === "x";
  const L = s.length, W = s.width, o = s.offset * pl.sign, near = -pl.sign;
  const at = (t, k) => (alongX ? [t, k] : [k, t]);
  /* props face the roadway; decals run with it */
  const face = alongX ? (near > 0 ? Math.PI : 0) : (near > 0 ? -Math.PI / 2 : Math.PI / 2);
  const runRy = alongX ? Math.PI / 2 : 0;
  const walk = o + near * (W / 2 + 7.6);       /* sidewalk centreline   */
  const kerb = walk - near * 4.4;              /* its kerb edge         */
  const back = walk + near * 4.6;              /* its building edge     */
  const SW = 0.5, RD = 0.4;
  const put = (n, t, k, y, ry, sc) => {
    const [x, z] = at(t, k);
    K.add(n, x, z, { y, ry: ry == null ? face : ry, s: sc });
  };
  const T0 = -L / 2 + 26, T1 = L / 2 - 26, SPAN = T1 - T0;
  const every = (step, off, fn) => { for (let t = T0 + off; t <= T1; t += step) fn(t); };

  /* --- sidewalk furniture ---------------------------------------- */
  every(148, 18, (t) => put("hydrant", t, kerb + near * 0.8, SW));
  every(96, 52, (t) => put("bin", t, kerb, SW));
  every(64, 30, (t, i) => put("signpost", t, kerb - near * 0.4, SW));
  if (s.parking) every(64, 62, (t) => put("meter", t, kerb, SW));
  every(134, 74, (t) => put("bench", t, walk + near * 1.2, SW));
  every(46, 14, (t) => put(K.chance(0.5) ? "planter" : "boxplanter", t + K.jit(4), back, SW));
  every(210, 96, (t) => put("cabinet", t, back + near * 1.4, SW));
  every(178, 40, (t) => { put("newsbox", t, kerb, SW); put("newsbox", t + 2.4, kerb, SW); });
  every(112, 8, (t) => { for (const d of [-4, 0, 4]) put("bollard", t + d, kerb - near * 0.6, SW); });
  every(240, 130, (t) => put("busshelter", t, walk, SW));
  every(300, 150, (t) => put("mailbox", t, kerb, SW));

  /* cones and a stack of boxes left where the work is */
  for (let i = 0; i < 7; i++) {
    const t = T0 + K.rnd() * SPAN;
    put("cone", t, kerb - near * (1.4 + K.rnd() * 3.4), RD, K.rnd() * 3);
  }
  for (let i = 0; i < 3; i++) {
    const t = T0 + K.rnd() * SPAN;
    put(K.chance(0.5) ? "cardbox" : "crate", t, back + near * K.jit(1.6), SW, K.rnd() * 3);
  }
  every(190, 120, (t) => { put("pallet", t, back, SW, 1); put("cardbox", t + 3, back - near * 1.2, SW, 0.9); });

  /* --- the roadway: paint, iron, and wear ------------------------- */
  every(76, 30, (t) => put("manhole", t + K.jit(6), o + near * (W / 4) * (K.chance(0.5) ? 1 : -1), RD, K.rnd() * 3));
  every(136, 60, (t) => put("patch", t + K.jit(10), o + near * K.jit(W / 3), RD, K.rnd() > 0.5 ? 1 : 0.75));
  every(158, 22, (t) => put("crack", t + K.jit(12), o + near * K.jit(W / 3), RD, 0.8 + K.rnd() * 0.6));
  every(88, 44, (t) => put("drain", t, kerb - near * 1.0, 0, face));

  /* stop bars and lane arrows at each end, the way a junction is painted */
  for (const [t, dir] of [[T0 + 4, 1], [T1 - 4, -1]]) {
    const lane = o + near * (W / 4);
    const [bx, bz] = at(t + dir * 6, lane);
    out.add(box(THREE, alongX ? 1.8 : W / 2 - 1, 0.12, alongX ? W / 2 - 1 : 1.8, P.line, bx, RD + 0.03, bz));
    put(dir > 0 ? "arrow" : "arrowLeft", t + dir * 22, lane, RD, runRy + (dir > 0 ? Math.PI : 0));
  }

  /* the parking lane, ticked off in bays */
  if (s.parking) every(23, 12, (t) => put("baytee", t, o + near * (W / 2 - 9.5), RD, runRy));

  /* kerb paint in stretches, and the kerb itself picked out in ink */
  const paint = [];
  for (let t = T0; t < T1; t += 118) {
    const len = 42;
    const [x, z] = at(t + len / 2, o + near * (W / 2 + 0.9));
    paint.push([x, 0.74, z, 0, 0, 0, alongX ? len : 0.9, 0.1, alongX ? 0.9 : len]);
  }
  if (paint.length) out.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.lineGold, paint));
}

/* Everything that is NOT at the kerb. The reference clutters the
   whole block, not just the road edge: goods pushed up against
   walls, a yard round the back with pallets and a dumpster and a van
   in it, covers and patches out across the paving. A district whose
   props stop at the kerb has a flat empty field behind the hero
   building, which is what the back of every one of these was. */
function blockDress(THREE, P, K, spec, hx, hz) {
  const DIR = { front: [0, 1], back: [0, -1], right: [1, 0], left: [-1, 0] };
  const used = new Set(spec.streets.map((s) => s.side));

  /* PUSHED UP AGAINST THE HERO'S OWN WALLS, all the way round. The
     ring is the building's own rectangle, not a circle on its
     check-in radius — a circle put everything out in the field. */
  const gx = hx + 7, gz = hz + 7;
  const sides = [
    { len: 2 * gx, p: (u) => [-gx + u, gz], n: [0, 1] },
    { len: 2 * gz, p: (u) => [gx, gz - u], n: [1, 0] },
    { len: 2 * gx, p: (u) => [gx - u, -gz], n: [0, -1] },
    { len: 2 * gz, p: (u) => [-gx, -gz + u], n: [-1, 0] }
  ];
  const wallProps = ["crate", "pallet", "cardbox", "bin", "drum", "standpipe",
    "boxplanter", "cone", "litter", "tyres", "gasbottle", null, null];
  for (const sd of sides) {
    const n = Math.max(2, Math.round(sd.len / 21));
    for (let i = 0; i < n; i++) {
      const [px, pz] = sd.p(((i + 0.5) / n) * sd.len);
      const ry = Math.atan2(sd.n[0], sd.n[1]);
      const name = K.pick(wallProps);
      if (name) K.add(name, px + K.jit(3), pz + K.jit(3),
        { y: 0.2, ry: ry + K.jit(0.35), s: 0.85 + K.rnd() * 0.35 });
    }
  }

  /* THE SERVICE YARD, on whichever side has no street on it */
  const free = Object.keys(DIR).filter((k) => !used.has(k));
  const [dx, dz] = DIR[free[0] || "back"];
  const reach = Math.abs(dx) ? hx + 44 : hz + 44;
  const ox = dx * reach, oz = dz * reach;
  const ax = dz, az = -dx;                       /* the yard's long axis */
  const spot = (u, v) => [ox + ax * u + dx * v, oz + az * u + dz * v];
  K.add("dumpster", ...spot(-26, 6), { y: 0.2, ry: Math.atan2(ax, az) });
  K.add("dumpster", ...spot(-16, 6), { y: 0.2, ry: Math.atan2(ax, az) });
  K.add("van", ...spot(22, 2), { y: 0.2, ry: Math.atan2(ax, az) });
  K.add("generator", ...spot(4, 14), { y: 0.2, ry: Math.atan2(dx, dz) });
  K.add("gasbottle", ...spot(-4, 15), { y: 0.2, ry: Math.atan2(dx, dz) });
  K.add("tyres", ...spot(-32, 12), { y: 0.2 });
  for (let i = 0; i < 8; i++)
    K.add(K.chance(0.55) ? "pallet" : "crate", ...spot(K.jit(34), 6 + K.jit(9)),
      { y: 0.2, ry: K.rnd() * 3 });
  for (let i = 0; i < 6; i++)
    K.add("cardbox", ...spot(K.jit(30), 4 + K.jit(7)), { y: 0.2, ry: K.rnd() * 3, s: 0.8 + K.rnd() * 0.5 });
  for (let i = 0; i < 5; i++)
    K.add("cone", ...spot(K.jit(36), K.jit(16)), { y: 0.2, ry: K.rnd() * 3 });
  for (let i = 0; i < 8; i++)
    K.add("litter", ...spot(K.jit(38), K.jit(18)), { y: 0.2, ry: K.rnd() * 3 });
  fenceRun(K, ...spot(-42, 22), ...spot(42, 22));

  /* covers, patches and drains out across the block, not only in the
     roadway — a yard has ironwork in it too */
  const gw = (spec.ground?.[0] ?? 520) / 2, gd = (spec.ground?.[1] ?? 520) / 2;
  const gz0 = spec.ground?.[2] ?? 0;
  for (let i = 0; i < 16; i++) {
    const x = K.jit(gw * 0.82), z = gz0 + K.jit(gd * 0.82);
    if (Math.abs(x) < gx && Math.abs(z) < gz) continue;
    K.add(K.chance(0.6) ? "manhole" : "patch", x, z, { y: 0.2, ry: K.rnd() * 3, s: 0.8 + K.rnd() * 0.5 });
  }
}

/* The footpath drawn as PAVING, not as a ribbon: two near tones laid
   in slabs with a gap between them, so the outline pass draws the
   joints as ink. The reference footpaths are never one flat plane. */
function paving(THREE, P, s, out) {
  if (!s.sidewalkNear) return;
  const pl = place(s.side);
  const alongX = pl.axis === "x";
  const L = s.length, W = s.width, o = s.offset * pl.sign, near = -pl.sign;
  const k = o + near * (W / 2 + 7.6);
  const A = [], B = [];
  const pitch = 6.2, half = 5.6;
  let i = 0;
  for (let t = -L / 2; t < L / 2 - pitch; t += pitch, i++) {
    for (const sd of [-1, 1]) {
      const kk = k + sd * (half / 2 + 0.2);
      const row = alongX
        ? [t + pitch / 2, 0.54, kk, 0, 0, 0, pitch - 0.55, 0.1, half - 0.4]
        : [kk, 0.54, t + pitch / 2, 0, 0, 0, half - 0.4, 0.1, pitch - 0.55];
      ((i + (sd > 0 ? 1 : 0)) % 2 ? A : B).push(row);
    }
  }
  const U = new THREE.BoxGeometry(1, 1, 1);
  if (A.length) out.add(inst(THREE, U, P.walkAlt, A));
  if (B.length) out.add(inst(THREE, U, P.walk, B));
  /* the kerb face picked out, so the kerb reads as a step, not a stripe */
  const kf = o + near * (W / 2 + 0.05);
  out.add(inst(THREE, U, P.roadDark,
    [alongX ? [0, 0.5, kf, 0, 0, 0, L, 0.3, 0.24] : [kf, 0.5, 0, 0, 0, 0, 0.24, 0.3, L]]));
}

/* zebra bars across a road, drawn wide enough to survive distance */
function crosswalk(THREE, P, out, s, t) {
  const pl = place(s.side);
  const alongX = pl.axis === "x";
  const W = s.width, o = s.offset * pl.sign;
  const bars = [];
  for (let i = 0; i < 7; i++) {
    const a = -13.2 + i * 4.4;
    bars.push(alongX
      ? [t + a, 0.46, o, 0, 0, 0, 2.4, 0.12, W + 1.8]
      : [o, 0.46, t + a, 0, 0, 0, W + 1.8, 0.12, 2.4]);
  }
  out.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.line, bars));
}

/* ------------------------------------------------------------------
   DRAWN FACADES
   A context building drawn as a plain box is the thing that reads as
   unfinished from every angle. The reference draws INSIDE the shape:
   a plinth, a string course at every floor, window reveals with a
   mullion and a sill, a shopfront and a door at the pavement, a
   cornice, a parapet, a downpipe, a fire escape, and plant on the
   roof. All of it thin inset geometry, so the outline pass inks it
   as line rather than as texture.
   ------------------------------------------------------------------ */
function drawnBuilding(THREE, P, K, b) {
  const g = new THREE.Group();
  const { w, d, h } = b;
  const body = b.mat || P.brickWall;
  const floors = Math.max(2, Math.round(h / (b.floorH || 13)));
  const fh = h / floors;
  const glass = [], ink = [], trim = [], stone = [];
  const U = new THREE.BoxGeometry(1, 1, 1);
  const push = (a, x, y, z, sx, sy, sz) => a.push([x, y, z, 0, 0, 0, sx, sy, sz]);

  g.add(box(THREE, w, h, d, body, 0, h / 2, 0));

  const faces = [
    { s: [0, 1], span: w, off: d / 2 },
    { s: [0, -1], span: w, off: d / 2 },
    { s: [1, 0], span: d, off: w / 2 },
    { s: [-1, 0], span: d, off: w / 2 }
  ];

  for (const f of faces) {
    const [nx, nz] = f.s;
    const sgn = nx || nz;
    /* place a piece on this face: `a` runs across it, `t` out of it */
    const at = (a, t) => (nx
      ? [nx * (f.off + t), a * -nx]
      : [a * nz, nz * (f.off + t)]);
    const dims = (aw, th) => (nx ? [th, aw] : [aw, th]);

    const bays = Math.max(2, Math.round(f.span / 13));
    const pitch = f.span / bays;
    const ww = Math.min(pitch * 0.56, 7.5);

    for (let fl = 0; fl < floors; fl++) {
      const y0 = fl * fh;
      /* the string course that separates this floor from the one below */
      if (fl > 0) {
        const [cx, cz] = at(0, 0.28);
        const [sx, sz] = dims(f.span + 0.4, 0.7);
        push(trim, cx, y0, cz, sx, 0.85, sz);
        const [ix, iz] = at(0, 0.5);
        const [ax, az] = dims(f.span + 0.2, 0.24);
        push(ink, ix, y0 - 0.62, iz, ax, 0.3, az);
      }
      /* the coursing line halfway up each storey — the drawn brick
         joint that stops a wall reading as a blank plane */
      const [hx, hz] = at(0, 0.16);
      const [hxs, hzs] = dims(f.span - 0.6, 0.16);
      push(ink, hx, y0 + fh * 0.5, hz, hxs, 0.16, hzs);

      const wh = fl === 0 ? fh * 0.62 : fh * 0.5;
      const yc = y0 + (fl === 0 ? fh * 0.44 : fh * 0.55);
      for (let i = 0; i < bays; i++) {
        const a = -f.span / 2 + pitch * (i + 0.5);
        const doorway = fl === 0 && i === Math.floor(bays / 2);
        const openW = doorway ? Math.min(pitch * 0.42, 5) : ww;
        const openH = doorway ? fh * 0.76 : wh;
        const oy = doorway ? y0 + openH / 2 + 0.2 : yc;
        /* the reveal: a dark recess set back into the wall */
        const [gx, gz] = at(a, -0.18);
        const [gsx, gsz] = dims(openW, 0.5);
        push(glass, gx, oy, gz, gsx, openH, gsz);
        /* jamb and head lines drawn round it */
        const [jx, jz] = at(a, 0.14);
        const [jw, jt] = dims(openW + 0.9, 0.2);
        push(ink, jx, oy + openH / 2 + 0.32, jz, jw, 0.34, jt);
        for (const sd of [-1, 1]) {
          const [ex, ez] = at(a + sd * (openW / 2 + 0.3), 0.14);
          const [ew, et] = dims(0.34, 0.2);
          push(ink, ex, oy, ez, ew, openH + 0.9, et);
        }
        /* mullion up the middle, and a transom across it */
        const [mx, mz] = at(a, 0.06);
        const [mw, mt] = dims(0.24, 0.22);
        push(ink, mx, oy, mz, mw, openH - 0.2, mt);
        const [tw, tt] = dims(openW - 0.3, 0.2);
        push(ink, mx, oy + openH * 0.22, mz, tw, 0.2, tt);
        /* sill */
        const [sx2, sz2] = at(a, 0.34);
        const [sw, st] = dims(openW + 1.1, 0.85);
        push(stone, sx2, oy - openH / 2 - 0.3, sz2, sw, 0.42, st);
      }
    }
    /* a downpipe at one end of every face, read as a line */
    const [px, pz] = at(f.span / 2 - 1.6, 0.42);
    const [pw, pt] = dims(0.55, 0.55);
    push(ink, px, h / 2, pz, pw, h, pt);
    const [ox, oz] = at(f.span / 2 - 1.6, 0.55);
    push(ink, ox, h - 0.5, oz, pw * 1.7, 0.9, pt * 1.7);
  }

  /* cornice, parapet and coping — the drawn top of the wall */
  g.add(box(THREE, w + 2.2, 1.5, d + 2.2, P.stoneCap, 0, h + 0.75, 0));
  g.add(box(THREE, w + 1.2, 0.8, d + 1.2, P.roadDark, 0, h + 1.85, 0));
  g.add(box(THREE, w + 0.4, 2.6, d + 0.4, body, 0, h + 3.5, 0));
  g.add(box(THREE, w + 1.0, 0.5, d + 1.0, P.stoneCap, 0, h + 4.95, 0));
  g.add(box(THREE, w - 3.5, 0.6, d - 3.5, P.roadDark, 0, h + 0.4, 0));

  /* a fire escape down one flank: stringers, landings, ladders */
  if (b.fireEscape !== false && floors >= 3) {
    const fx = -w / 2 - 0.9, esc = [];
    for (let fl = 1; fl < floors; fl++) {
      const y = fl * fh + 0.6;
      push(esc, fx - 1.6, y, 0, 3.6, 0.24, d * 0.42);
      push(esc, fx - 3.3, y + 1.9, 0, 0.22, 3.6, d * 0.42);
      for (let i = 0; i < 5; i++)
        push(esc, fx - 3.3, y + 0.5 + i * 0.85, -d * 0.2 + i * (d * 0.1), 0.5, 0.16, 0.5);
      push(esc, fx - 2.4, y + 2.4, d * 0.19, 2.0, 4.4, 0.18);
    }
    for (const fl of [0]) void fl;
    g.add(inst(THREE, U, P.iron, esc));
  }

  /* roof plant */
  const rw = w / 2 - 4, rd = d / 2 - 4;
  const rk = [];
  for (let i = 0; i < Math.max(2, Math.round(w * d / 900)); i++)
    rk.push(["acunit", (K.rnd() * 2 - 1) * rw, (K.rnd() * 2 - 1) * rd]);
  for (let i = 0; i < 3; i++) rk.push(["roofvent", (K.rnd() * 2 - 1) * rw, (K.rnd() * 2 - 1) * rd]);
  rk.push(["dish", rw * 0.7, -rd * 0.7]);
  if (h > 24 && w > 60) rk.push(["watertank", -rw * 0.5, rd * 0.4]);
  for (const [n, x, z] of rk) K.add(n, (b.x || 0) + x, (b.z || 0) + z, { y: h + 0.7, ry: K.rnd() * 6.3 });
  /* and a standpipe and a meter at the pavement */
  K.add("standpipe", (b.x || 0) + w * 0.28, (b.z || 0) + d / 2 + 0.5, { y: 0.5, ry: 0 });
  K.add("wallac", (b.x || 0) - w * 0.3, (b.z || 0) + d / 2 + 0.6, { y: fh * 1.2, ry: 0 });

  if (glass.length) g.add(inst(THREE, U, P.glass, glass));
  if (ink.length) g.add(inst(THREE, U, P.iron, ink));
  if (trim.length) g.add(inst(THREE, U, P.stoneCap, trim));
  if (stone.length) g.add(inst(THREE, U, P.concrete, stone));

  g.position.set(b.x || 0, 0, b.z || 0);
  return g;
}

/* ------------------------------------------------------------------
   THE APRON
   The survey stops at a property line and the world does not. Left
   alone the block ends in a hard rectangle laid across a hillside,
   which is the single thing that most gives away that a district was
   dropped on this planet rather than grown on it.

   So the slab is collared by a ragged annulus of the surrounding
   green: subdivided radially and around, its outer edge pushed in
   and out by two sine terms so no straight run of it survives, and
   dropped steadily as it goes out so it feathers down into the land
   instead of ending on a lip. It is a ring, not a disc, because the
   middle is under the slab anyway and a fan triangulated from the
   centre would chord straight through the curve when the whole thing
   is bent onto the sphere.
   ------------------------------------------------------------------ */
const APRON_OUT = 1.30;   /* how far past the fence the collar reaches */
function apron(THREE, P, rx, rz, gz, skirt) {
  const N = 96, M = 7, OUT = APRON_OUT;
  const pos = [], idx = [];
  const wob = (a) => 1 + 0.17 * Math.sin(a * 3 + 0.7) + 0.10 * Math.sin(a * 7 - 1.4)
    + 0.055 * Math.sin(a * 13 + 2.2);
  for (let j = 0; j <= M; j++) {
    const t = j / M;                       /* 0 at the slab edge, 1 at the fringe */
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const grow = 1 + (OUT - 1) * t * wob(a);
      /* a square footprint has corners further out than its sides, so
         the collar is laid on the SQUARE, not on an inscribed circle */
      const c = Math.cos(a), sn = Math.sin(a);
      const m = Math.max(Math.abs(c), Math.abs(sn));
      /* It falls away gently, not off a diving board. The land beyond
         the fence is already sloping back down to open country at
         roughly this rate (the world's pad skirt), so a collar that
         plunges submerges itself in three steps and leaves the slab's
         own tan rim standing out of the hillside like a kerbstone —
         which is exactly what the first cut of it did. */
      pos.push((c / m) * rx * grow, 0.05 - skirt * 0.22 * t * t, (sn / m) * rz * grow + gz);
    }
  }
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), dd = c + 1;
      idx.push(a, b, c, b, dd, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  /* double sided: the collar is a thin sheet at the very rim of the
     block, and a single-sided one seen from a hair below the plateau
     is a window straight through the planet */
  const m = new THREE.Mesh(g, cel(THREE, 0x7ea866, { side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */
export function buildSite(slug, THREE = THREE_DEFAULT) {
  const spec = SURVEY[slug];
  const hero = build(slug, THREE);
  if (!hero) return null;
  if (!spec) return hero;

  const P = pal(THREE);
  const S = spec.scale;
  const d = new THREE.Group();          /* the district, in FEET */
  /* one prop kit for the whole block, seeded off the slug: the same
     cone is in the same gutter every time you walk down the street */
  const K = makeKit(THREE, seedOf(slug));

  /* THE GROUND THE WHOLE BLOCK SITS ON.
     It used to be one 0.3ft-thick box with eight corners. Eight
     corners cannot describe a spherical cap, and this block is about
     to be bent onto a planet of radius 40 — see conformToSphere() in
     uprise-world.js — where its own corners sit nearly three units
     off the tangent plane. So the slab is SUBDIVIDED, giving the
     bend somewhere to put the curve, and given a deep skirt so the
     bent rim is let INTO the hillside instead of hanging over it.
     The apron finishes the job the survey cannot: a rectangle is
     what a plot plan looks like, not what a clearing looks like. */
  const gw = spec.ground?.[0] ?? 520, gd = spec.ground?.[1] ?? 560, gz = spec.ground?.[2] ?? 0;
  /* The skirt is only there to keep daylight from under the bent rim,
     so it is SHALLOW. A deep one has a second cost that is not
     obvious: it drops the site's bounding box, and the world seats a
     site by lifting it clear of its own lowest point — so a deep
     skirt lifted every district bodily into the air and put the
     player under a brown cliff made of its underside. */
  const skirt = Math.max(gw, gd) * 0.095;
  const slab = new THREE.BoxGeometry(gw, skirt, gd, 30, 1, 30);
  slab.translate(0, 0.05 - skirt / 2, gz);
  d.add(shadowed(new THREE.Mesh(slab, P.grassDry)));
  d.add(apron(THREE, P, gw * 0.5, gd * 0.5, gz, skirt));
  /* how far out this site reaches, measured to the far corner of the
     fence and already in the district's own scaled units. The world
     needs it to know how much land to flatten under the block, and
     it is the only party that knows how big a block is. */
  const padRadius = Math.hypot(gw, gd) * 0.5 * S;

  for (const s of spec.streets) {
    roadway(THREE, P, s, d);
    paving(THREE, P, s, d);
    streetLife(THREE, P, s, d);
    streetProps(THREE, P, K, s, d);
    crosswalk(THREE, P, d, s, -s.length / 2 + 44);
    crosswalk(THREE, P, d, s, s.length / 2 - 44);
    if (!s.sign) continue;
    /* the blade goes at the near kerb, one block along, facing the
       walker approaching down the front of the building */
    const pl = place(s.side);
    const along = pl.axis === "z";
    const o = s.offset * pl.sign, near = -pl.sign;
    const k = o + near * (s.width / 2 + 9);
    const face = along ? (near > 0 ? Math.PI / 2 : -Math.PI / 2) : (near > 0 ? 0 : Math.PI);
    for (const t of [-s.length / 2 + 90, s.length / 2 - 90])
      d.add(streetBlade(THREE, P, s.name, along ? k : t, along ? t : k, face));
  }

  if (spec.embankment) {
    embankment(THREE, P, spec.embankment, spec.monopoles, d);
    /* the corner itself: Broad Street x Railroad Avenue */
    const fr = spec.streets.find((x) => x.side === "front");
    const rt = spec.streets.find((x) => x.side === "right");
    if (fr && rt) intersection(THREE, P, rt.offset, fr.offset, d);
  }

  if (spec.mural) {
    const m = spec.mural;
    d.add(drawnBuilding(THREE, P, K, { x: m.x, z: m.z, w: m.w, d: m.d, h: m.h, mat: P.brickWall, floorH: 13 }));
    /* the loading yard it works out of: pallets, boxes, drums, a
       dumpster and a chain-link line, the way a warehouse yard is */
    const yx = m.x + m.w / 2 + 16, yz = m.z;
    K.add("dumpster", yx, yz + 34, { y: 0.2, ry: 0.2 });
    K.add("drum", yx - 3, yz - 26, { y: 0.2 });
    K.add("drum", yx + 1.5, yz - 22, { y: 0.2 });
    for (let i = 0; i < 5; i++)
      K.add(K.chance(0.5) ? "pallet" : "crate", yx + K.jit(9), yz + K.jit(52), { y: 0.2, ry: K.rnd() * 3 });
    for (let i = 0; i < 4; i++)
      K.add("cardbox", yx + K.jit(7), yz + K.jit(46), { y: 0.2, ry: K.rnd() * 3, s: 0.8 + K.rnd() * 0.5 });
    fenceRun(K, m.x - m.w / 2, m.z - m.d / 2 - 12, m.x + m.w / 2 + 26, m.z - m.d / 2 - 12);
    /* the painted wall along Railroad Avenue */
    d.add(box(THREE, 0.6, m.h * 0.62, m.d - 8, P.mural, m.x + m.w / 2 + 0.4, m.h * 0.42, m.z));
    const nm = inscription(THREE, m.name, 0.2, 0.1);
    if (nm) {
      const t = shadowed(new THREE.Mesh(nm, P.signWhite));
      t.rotation.y = Math.PI / 2;
      t.position.set(m.x + m.w / 2 + 0.9, m.h * 0.72, m.z);
      d.add(t);
    }
  }

  /* the Harbor Station stack on the skyline, red and white banded */
  if (spec.stack) {
    const st = spec.stack;
    /* it stands on its own plinth so it never reads as floating when
       it sits beyond the edge of the block's ground plane */
    d.add(box(THREE, 34, 6, 34, P.concrete, st.x, 3, st.z));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(7, 12, st.h, 12), P.signWhite);
    shaft.position.set(st.x, st.h / 2 + 5, st.z);
    d.add(shadowed(shaft));
    const bands = [];
    for (let i = 0; i < 4; i++)
      bands.push([st.x, 5 + st.h * (0.45 + i * 0.14), st.z, 0, 0, 0, 1.06, 1, 1.06]);
    d.add(inst(THREE, new THREE.CylinderGeometry(7.6, 8.4, st.h * 0.07, 12), P.stackRed, bands));
  }

  if (spec.behind) {
    const b = spec.behind;
    d.add(drawnBuilding(THREE, P, K, { x: 8, z: b.offset - b.d / 2, w: b.w, d: b.d, h: b.h, mat: P.brickWall }));
    const nm = inscription(THREE, b.name, 0.24, 0.12);
    if (nm) {
      const t = shadowed(new THREE.Mesh(nm, P.signWhite));
      t.position.set(8, b.h * 0.62, b.offset + 0.4);
      d.add(t);
    }
  }

  if (spec.lot) {
    const l = spec.lot;
    const cz = l.offset + l.d / 2;
    d.add(box(THREE, l.w, 0.4, l.d, P.road, l.x, 0.2, cz));
    const bays = [];
    for (let i = 0; i < 9; i++)
      bays.push([l.x - l.w / 2 + 12 + i * ((l.w - 24) / 8), 0.42, cz, 0, 0, 0, 0.6, 0.1, l.d - 20]);
    d.add(inst(THREE, new THREE.BoxGeometry(1, 1, 1), P.line, bays));
    /* a lot is never just paint: it is fenced, lit, drained, coned,
       and it has the bins the building behind it puts out */
    fenceRun(K, l.x - l.w / 2, cz + l.d / 2, l.x + l.w / 2, cz + l.d / 2);
    fenceRun(K, l.x + l.w / 2, cz + l.d / 2, l.x + l.w / 2, cz - l.d / 2);
    K.add("dumpster", l.x + l.w / 2 - 14, cz + l.d / 2 - 12, { y: 0.4, ry: Math.PI / 2 });
    K.add("dumpster", l.x + l.w / 2 - 14, cz + l.d / 2 - 22, { y: 0.4, ry: Math.PI / 2 });
    for (let i = 0; i < 10; i++)
      K.add("manhole", l.x + K.jit(l.w / 2 - 20), cz + K.jit(l.d / 2 - 20), { y: 0.4, ry: K.rnd() * 3 });
    for (let i = 0; i < 8; i++)
      K.add("cone", l.x + K.jit(l.w / 2 - 14), cz + K.jit(l.d / 2 - 14), { y: 0.4, ry: K.rnd() * 3 });
    for (let i = 0; i < 6; i++)
      K.add("bollard", l.x - l.w / 2 + 4, cz - l.d / 2 + 18 + i * 22, { y: 0.4 });
    for (let i = 0; i < 5; i++)
      K.add("litter", l.x + K.jit(l.w / 2), cz + K.jit(l.d / 2), { y: 0.4, ry: K.rnd() * 3 });
  }

  for (const a of spec.across || []) {
    d.add(drawnBuilding(THREE, P, K, { x: a.x, z: a.offset + a.d / 2, w: a.w, d: a.d, h: a.h, mat: P.brickWall }));
    if (a.name) {
      const nm = inscription(THREE, a.name, 0.5, 0.2);
      if (nm) {
        const t = shadowed(new THREE.Mesh(nm, P.signWhite));
        t.rotation.y = Math.PI;
        t.position.set(a.x, a.h * 0.52, a.offset - 0.6);
        d.add(t);
      }
    }
  }

  if (spec.plaza) {
    const p = spec.plaza;
    const oval = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.4, 28), P.grass);
    oval.scale.set(p.rx, 1, p.rz);
    oval.position.set(p.offX, 0.2, p.offZ);
    d.add(shadowed(oval));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 32), P.walk);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(p.rx * 0.78, p.rz * 0.78, 1);
    ring.position.set(p.offX, 0.45, p.offZ);
    d.add(shadowed(ring));
    d.add(streetBlade(THREE, P, p.name, p.offX, p.offZ + p.rz + 14, 0));
    /* a public lawn is furnished: benches round the walk, bins beside
       them, bollards on the kerb line, and paper blown into it */
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rx = p.rx * 0.88, rz = p.rz * 0.88;
      const x = p.offX + Math.sin(a) * rx, z = p.offZ + Math.cos(a) * rz;
      K.add(i % 3 === 2 ? "bin" : "bench", x, z, { y: 0.4, ry: a + Math.PI });
      K.add("bollard", p.offX + Math.sin(a + 0.3) * p.rx * 1.06, p.offZ + Math.cos(a + 0.3) * p.rz * 1.06, { y: 0.2 });
    }
    for (let i = 0; i < 12; i++)
      K.add("litter", p.offX + K.jit(p.rx), p.offZ + K.jit(p.rz), { y: 0.42, ry: K.rnd() * 3 });
    for (let i = 0; i < 6; i++)
      K.add("planter", p.offX + K.jit(p.rx * 0.7), p.offZ + K.jit(p.rz * 0.7), { y: 0.4, ry: K.rnd() * 3 });
  }

  /* the block itself — the perimeter, the yard, the ironwork. The
     ring is taken off the hero's real bounding box, in feet. */
  const hbb = new THREE.Box3().setFromObject(hero);
  blockDress(THREE, P, K, spec,
    Math.max(Math.abs(hbb.min.x), Math.abs(hbb.max.x)) / S,
    Math.max(Math.abs(hbb.min.z), Math.abs(hbb.max.z)) / S);

  /* the crossings at every corner where two of these streets meet */
  for (const a of spec.streets)
    for (const b of spec.streets) {
      if (a === b) continue;
      const pa = place(a.side), pb = place(b.side);
      if (pa.axis === pb.axis) continue;
      crosswalk(THREE, P, d, a, b.offset * pb.sign - (b.width / 2 + 16) * pb.sign);
    }

  /* every prop placed above, emitted as one InstancedMesh per bucket */
  K.flush(d);

  d.scale.setScalar(S);

  const site = new THREE.Group();
  site.add(d);
  site.add(hero);
  site.userData = Object.assign({}, hero.userData, {
    padRadius,
    slug,
    frontBearing: spec.frontBearing,
    district: true,
    streets: spec.streets.map((s) => s.name)
  });
  site.name = slug + "-site";
  return site;
}

export const DISTRICT_SLUGS = Object.keys(SURVEY);
