/* ============================================================
   UPRISE PROP KIT — the human-scale clutter.

   The reference art does not get its richness from polygons or from
   light. It gets it from DENSITY OF SMALL DRAWN OBJECTS: a cone at a
   kerb, a hydrant, a mailbox, three cardboard boxes stacked by a
   roller door, an AC condenser on every roof, a chain-link run along
   a lot line, a manhole and a patch and a crack in the asphalt. Each
   one simple, each one outlined, and there are dozens of them in
   every frame.

   This module is that kit. Every prop is declared once as a list of
   parts; parts sharing a material are merged into a single geometry
   at first use, so a prop costs at most two or three geometries no
   matter how many pieces it is drawn from. Placement then goes
   through an instancer:

       const K = makeKit(THREE);
       K.add("cone", x, z, { ry: 0.4 });
       K.add("hydrant", x2, z2);
       K.flush(group);            // one InstancedMesh per prop-material

   Distances are in FEET, the same frame js/uprise-district.js lays
   its streets out in. Nothing here touches a scene, a camera or a
   renderer.
   ============================================================ */

import * as THREE_DEFAULT from "../vendor/three.module.min.js";
import { H } from "./uprise-landmarks.js";

const { cel, mergeGeoms, shadowed } = H;

/* ------------------------------------------------------------------
   PALETTE — muted, warm, never saturated. One material per colour,
   shared with the landmark kit so the ink weight matches.
   ------------------------------------------------------------------ */
const PALS = new WeakMap();
export function propPalette(THREE) {
  let p = PALS.get(THREE);
  if (p) return p;
  const c = (hex, o) => cel(THREE, hex, o);
  p = {
    ink:       c(0x24272b),
    inkSoft:   c(0x3b4045),
    steel:     c(0x9aa0a6),
    steelDark: c(0x6a7076),
    galv:      c(0xb0b4b6),
    orange:    c(0xd8663a),
    orangeDim: c(0xa8492a),
    white:     c(0xf1efe6),
    paper:     c(0xdcd6c6),
    red:       c(0xb0402f),
    redDim:    c(0x8c3325),
    blue:      c(0x3d5a80),
    teal:      c(0x6f9a97),
    green:     c(0x4a6b52),
    leaf:      c(0x5c8a4e),
    leafDim:   c(0x466b3d),
    terra:     c(0xa8735a),
    soil:      c(0x51412f),
    wood:      c(0x9c7a52),
    woodDim:   c(0x7a5c3c),
    card:      c(0xbfa07a),
    yellow:    c(0xd9b64e),
    concrete:  c(0x9d988e),
    asphalt:   c(0x5f5c56),
    lineWhite: c(0xe8e3d4),
    lineYellow:c(0xd0a844),
    glassPale: c(0x9fc3c8),
    signGreen: c(0x2f6b45),
    rust:      c(0x8a5a44)
  };
  PALS.set(THREE, p);
  return p;
}

/* ------------------------------------------------------------------
   PART DECLARATION
   part = [material, geometry, x, y, z, rx, ry, rz]
   ------------------------------------------------------------------ */
function B(THREE, w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function C(THREE, rt, rb, h, n) { return new THREE.CylinderGeometry(rt, rb, h, n || 8); }
function CN(THREE, r, h, n) { return new THREE.ConeGeometry(r, h, n || 8); }

/* a flat plate standing in XY facing +Z, drawn as an n-gon */
function plate(THREE, r, t, n, spin) {
  const g = new THREE.CylinderGeometry(r, r, t, n);
  const m = new THREE.Matrix4();
  g.applyMatrix4(m.makeRotationY(spin || 0));
  g.applyMatrix4(m.makeRotationX(Math.PI / 2));
  return g;
}

/* a flat n-gon lying in XZ — the ground-marking primitive. A 3-gon
   comes out with its vertex on +Z, so `spin` aims the arrowhead. */
function flat(THREE, r, t, n, spin) {
  const g = new THREE.CylinderGeometry(r, r, t, n);
  if (spin) g.applyMatrix4(new THREE.Matrix4().makeRotationY(spin));
  return g;
}

/* ------------------------------------------------------------------
   THE PROPS
   Each entry returns [[matName, geometry, x,y,z, rx,ry,rz], ...].
   They stand on y = 0 and face +Z.
   ------------------------------------------------------------------ */
const DEFS = {

  /* --- street furniture ------------------------------------------ */

  cone(T) {
    return [
      ["orangeDim", B(T, 2.0, 0.16, 2.0), 0, 0.08, 0],
      ["orange", CN(T, 0.82, 2.5, 8), 0, 1.33, 0],
      ["white", C(T, 0.52, 0.58, 0.38, 8), 0, 1.14, 0]
    ];
  },

  hydrant(T) {
    const p = [
      ["red", C(T, 0.78, 0.88, 0.32, 8), 0, 0.16, 0],
      ["red", C(T, 0.5, 0.56, 2.3, 8), 0, 1.35, 0],
      ["ink", C(T, 0.6, 0.6, 0.14, 8), 0, 0.58, 0],
      ["red", C(T, 0.44, 0.54, 0.45, 8), 0, 2.7, 0],
      ["ink", C(T, 0.16, 0.24, 0.36, 6), 0, 3.05, 0]
    ];
    for (const [dx, dz, rz, rx] of [[0.6, 0, Math.PI / 2, 0], [-0.6, 0, Math.PI / 2, 0], [0, 0.6, 0, Math.PI / 2]])
      p.push(["ink", C(T, 0.26, 0.26, 0.5, 8), dx, 1.7, dz, rx, 0, rz]);
    return p;
  },

  /* the blue relay box that shows up in every American street frame */
  mailbox(T) {
    return [
      ["blue", B(T, 2.8, 3.0, 2.2), 0, 2.05, 0],
      ["blue", B(T, 2.94, 0.55, 2.34), 0, 3.78, 0],
      ["ink", B(T, 2.84, 0.1, 2.24), 0, 3.48, 0],
      ["ink", B(T, 1.7, 0.16, 0.14), 0, 3.3, 1.1],
      ["ink", B(T, 0.1, 2.0, 0.1), 0.9, 2.2, 1.11],
      ["ink", B(T, 0.34, 0.6, 1.9), 1.1, 0.3, 0],
      ["ink", B(T, 0.34, 0.6, 1.9), -1.1, 0.3, 0]
    ];
  },

  /* a newspaper vending box — squat, legged, one dark window */
  newsbox(T) {
    const p = [
      ["red", B(T, 1.7, 2.7, 1.5), 0, 1.9, 0],
      ["ink", B(T, 1.2, 1.1, 0.12), 0, 2.65, 0.78],
      ["ink", B(T, 1.5, 0.12, 0.12), 0, 1.6, 0.78],
      ["ink", B(T, 1.76, 0.16, 1.56), 0, 3.32, 0]
    ];
    for (const dx of [-0.65, 0.65]) for (const dz of [-0.55, 0.55])
      p.push(["ink", C(T, 0.1, 0.1, 1.1, 6), dx, 0.55, dz]);
    return p;
  },

  bin(T) {
    return [
      ["green", C(T, 1.02, 0.84, 2.7, 10), 0, 1.35, 0],
      ["ink", C(T, 1.06, 1.06, 0.16, 10), 0, 1.9, 0],
      ["ink", C(T, 0.94, 0.94, 0.14, 10), 0, 0.75, 0],
      ["ink", C(T, 1.14, 1.14, 0.26, 10), 0, 2.8, 0],
      ["inkSoft", C(T, 0.86, 0.86, 0.16, 10), 0, 2.98, 0]
    ];
  },

  dumpster(T) {
    const p = [
      ["green", B(T, 6.4, 3.4, 3.8), 0, 2.0, 0],
      ["ink", B(T, 6.7, 0.34, 4.0), 0, 3.87, 0],
      ["inkSoft", B(T, 6.7, 0.4, 0.14), 0, 4.06, 0],
      ["ink", B(T, 6.5, 0.16, 3.9), 0, 0.34, 0]
    ];
    for (const dx of [-2.1, -0.7, 0.7, 2.1]) for (const dz of [-1.92, 1.92])
      p.push(["ink", B(T, 0.2, 3.0, 0.1), dx, 2.0, dz]);
    for (const dx of [-2.6, 2.6]) for (const dz of [-1.5, 1.5])
      p.push(["ink", C(T, 0.3, 0.3, 0.24, 8), dx, 0.3, dz, 0, 0, Math.PI / 2]);
    return p;
  },

  bench(T) {
    const p = [
      ["ink", B(T, 0.34, 1.35, 3.6), 2.2, 0.68, 0],
      ["ink", B(T, 0.34, 1.35, 3.6), -2.2, 0.68, 0],
      ["ink", B(T, 0.3, 1.9, 0.26), 2.2, 2.3, -1.5],
      ["ink", B(T, 0.3, 1.9, 0.26), -2.2, 2.3, -1.5]
    ];
    for (const dz of [-1.15, -0.1, 0.95])
      p.push(["wood", B(T, 5.4, 0.22, 0.82), 0, 1.45, dz]);
    for (const dy of [2.35, 3.05])
      p.push(["wood", B(T, 5.4, 0.55, 0.2), 0, dy, -1.55]);
    return p;
  },

  bollard(T) {
    return [
      ["ink", C(T, 0.36, 0.42, 3.2, 8), 0, 1.6, 0],
      ["yellow", C(T, 0.44, 0.44, 0.42, 8), 0, 2.42, 0],
      ["yellow", C(T, 0.44, 0.44, 0.42, 8), 0, 1.42, 0],
      ["ink", C(T, 0.26, 0.4, 0.34, 8), 0, 3.32, 0]
    ];
  },

  planter(T) {
    const p = [
      ["terra", C(T, 1.55, 1.12, 2.0, 8), 0, 1.0, 0],
      ["terra", C(T, 1.72, 1.66, 0.3, 8), 0, 2.02, 0],
      ["ink", C(T, 1.6, 1.6, 0.1, 8), 0, 1.86, 0],
      ["soil", C(T, 1.44, 1.44, 0.16, 8), 0, 2.06, 0]
    ];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      p.push(["leaf", B(T, 0.12, 2.7, 1.15), Math.sin(a) * 0.5, 3.3, Math.cos(a) * 0.5,
        Math.cos(a) * 0.42, a, -Math.sin(a) * 0.42]);
    }
    p.push(["leafDim", B(T, 0.12, 2.2, 0.95), 0, 3.1, 0, 0, 0.8, 0.1]);
    return p;
  },

  /* a low shrub in a square concrete planter — the ref's kerb greenery */
  boxplanter(T) {
    const p = [
      ["concrete", B(T, 3.4, 1.7, 3.4), 0, 0.85, 0],
      ["ink", B(T, 3.5, 0.16, 3.5), 0, 1.72, 0],
      ["soil", B(T, 3.0, 0.14, 3.0), 0, 1.76, 0]
    ];
    for (const [dx, dz, s] of [[0, 0, 1.5], [0.85, 0.6, 1.1], [-0.8, -0.55, 1.2]])
      p.push(["leaf", new T.IcosahedronGeometry(s, 0), dx, 1.9 + s * 0.55, dz]);
    return p;
  },

  /* --- signage ---------------------------------------------------- */

  stopsign(T) {
    const p = [
      ["steelDark", C(T, 0.16, 0.2, 7.4, 6), 0, 3.7, 0],
      ["red", plate(T, 1.95, 0.16, 8, Math.PI / 8), 0, 7.0, 0],
      ["white", plate(T, 1.68, 0.1, 8, Math.PI / 8), 0, 7.0, 0.12],
      ["red", plate(T, 1.48, 0.1, 8, Math.PI / 8), 0, 7.0, 0.17]
    ];
    const t = H.inscription(T, "STOP", 0.13, 0.08);
    if (t) { t.translate(0, 6.55, 0.22); p.push(["white", t, 0, 0, 0]); }
    return p;
  },

  /* the red warning triangle that is the loudest object in the refs */
  warnsign(T) {
    return [
      ["steelDark", C(T, 0.15, 0.19, 7.0, 6), 0, 3.5, 0],
      ["red", plate(T, 2.3, 0.16, 3, Math.PI), 0, 7.4, 0],
      ["white", plate(T, 1.85, 0.1, 3, Math.PI), 0, 7.34, 0.12],
      ["red", plate(T, 1.5, 0.1, 3, Math.PI), 0, 7.3, 0.17],
      ["white", B(T, 0.34, 0.9, 0.1), 0, 7.5, 0.22],
      ["white", B(T, 0.34, 0.26, 0.1), 0, 6.95, 0.22]
    ];
  },

  /* generic white regulatory blade: NO PARKING, ONE WAY, permit signs */
  signpost(T) {
    return [
      ["steelDark", C(T, 0.13, 0.16, 8.0, 6), 0, 4.0, 0],
      ["white", B(T, 1.9, 2.7, 0.14), 0, 6.9, 0.1],
      ["ink", B(T, 1.5, 0.2, 0.06), 0, 7.7, 0.19],
      ["ink", B(T, 1.5, 0.2, 0.06), 0, 7.25, 0.19],
      ["red", B(T, 1.5, 0.22, 0.06), 0, 6.35, 0.19],
      ["white", B(T, 2.6, 0.9, 0.12), 0, 4.9, 0.1],
      ["ink", B(T, 2.1, 0.16, 0.06), 0, 4.9, 0.18]
    ];
  },

  /* parking meter / pay station */
  meter(T) {
    return [
      ["steelDark", C(T, 0.13, 0.17, 3.6, 6), 0, 1.8, 0],
      ["ink", B(T, 0.95, 1.5, 0.75), 0, 4.3, 0],
      ["glassPale", B(T, 0.65, 0.7, 0.1), 0, 4.6, 0.4],
      ["ink", C(T, 0.5, 0.5, 0.16, 8), 0, 5.12, 0]
    ];
  },

  /* --- shelter, cabinets, plant ----------------------------------- */

  busshelter(T) {
    const p = [
      ["steelDark", B(T, 12.6, 0.45, 5.8), 0, 8.3, 0],
      ["ink", B(T, 12.9, 0.16, 6.1), 0, 8.6, 0],
      ["glassPale", B(T, 12.0, 6.4, 0.16), 0, 4.6, -2.5],
      ["glassPale", B(T, 0.16, 6.4, 4.8), 5.9, 4.6, 0],
      ["red", B(T, 0.22, 5.6, 3.4), -5.9, 4.6, 0],
      ["white", B(T, 0.1, 4.6, 2.6), -6.02, 4.6, 0],
      ["wood", B(T, 9.0, 0.28, 1.4), 0, 2.1, -1.7],
      ["ink", B(T, 0.24, 2.0, 1.3), 3.6, 1.05, -1.7],
      ["ink", B(T, 0.24, 2.0, 1.3), -3.6, 1.05, -1.7],
      ["ink", B(T, 12.1, 0.12, 0.1), 0, 6.9, -2.42]
    ];
    for (const dx of [-5.9, 5.9]) for (const dz of [-2.5, 2.5])
      p.push(["steelDark", B(T, 0.36, 8.3, 0.36), dx, 4.15, dz]);
    return p;
  },

  /* the street-side utility cabinet: pad, door seam, warning placard */
  cabinet(T) {
    return [
      ["concrete", B(T, 4.0, 0.3, 2.6), 0, 0.15, 0],
      ["teal", B(T, 3.2, 4.2, 1.8), 0, 2.4, 0],
      ["ink", B(T, 0.12, 3.6, 0.06), 0, 2.4, 0.92],
      ["ink", B(T, 3.0, 0.1, 0.06), 0, 4.35, 0.92],
      ["ink", B(T, 3.4, 0.24, 2.0), 0, 4.62, 0],
      ["yellow", B(T, 0.8, 0.9, 0.08), 1.0, 3.4, 0.94],
      ["ink", B(T, 0.5, 0.5, 0.05), -0.9, 2.2, 0.94]
    ];
  },

  /* wall standpipe / siamese fire connection */
  standpipe(T) {
    const p = [
      ["red", C(T, 0.3, 0.3, 4.6, 8), 0, 2.3, 0],
      ["ink", C(T, 0.38, 0.38, 0.2, 8), 0, 0.3, 0],
      ["ink", C(T, 0.38, 0.38, 0.2, 8), 0, 4.3, 0]
    ];
    for (const dx of [-0.62, 0.62])
      p.push(["red", C(T, 0.26, 0.26, 1.0, 8), dx, 3.5, 0.28, Math.PI / 2, 0, 0.32 * Math.sign(dx)]);
    return p;
  },

  /* --- roof plant -------------------------------------------------- */

  acunit(T) {
    const p = [
      ["galv", B(T, 3.2, 2.0, 2.6), 0, 1.0, 0],
      ["ink", B(T, 2.3, 0.16, 1.9), 0, 2.08, 0],
      ["steelDark", C(T, 0.88, 0.88, 0.16, 10), 0, 2.18, 0],
      ["ink", B(T, 1.8, 0.08, 0.14), 0, 2.29, 0],
      ["ink", B(T, 0.14, 0.08, 1.8), 0, 2.29, 0]
    ];
    for (let i = 0; i < 4; i++)
      p.push(["ink", B(T, 2.9, 0.11, 0.1), 0, 0.4 + i * 0.42, 1.32]);
    for (const dx of [-1.3, 1.3]) for (const dz of [-1.05, 1.05])
      p.push(["ink", B(T, 0.24, 0.3, 0.24), dx, 0.15, dz]);
    return p;
  },

  /* the small wall-hung split condenser seen on the ref facades */
  wallac(T) {
    const p = [
      ["galv", B(T, 2.4, 1.6, 1.1), 0, 0.8, 0],
      ["ink", B(T, 2.5, 0.12, 1.16), 0, 1.62, 0],
      ["steelDark", C(T, 0.6, 0.6, 0.12, 10), 0, 0.85, 0.58, Math.PI / 2, 0, 0]
    ];
    for (let i = 0; i < 3; i++)
      p.push(["ink", B(T, 2.1, 0.1, 0.08), 0, 0.35 + i * 0.42, 0.6]);
    return p;
  },

  roofvent(T) {
    return [
      ["galv", C(T, 0.5, 0.5, 1.7, 8), 0, 0.85, 0],
      ["ink", C(T, 0.86, 0.6, 0.34, 8), 0, 1.85, 0],
      ["ink", C(T, 0.58, 0.58, 0.12, 8), 0, 1.1, 0]
    ];
  },

  dish(T) {
    return [
      ["ink", C(T, 0.13, 0.16, 2.4, 6), 0, 1.2, 0],
      ["ink", B(T, 0.9, 0.16, 0.9), 0, 0.08, 0],
      ["white", C(T, 1.45, 1.05, 0.28, 12), 0, 2.7, 0.2, Math.PI * 0.34, 0, 0],
      ["ink", B(T, 0.1, 0.1, 1.5), 0, 2.35, 0.85, 0.5, 0, 0]
    ];
  },

  /* a rooftop water tank on a small stand — the ref's skyline signature */
  watertank(T) {
    const p = [
      ["green", C(T, 3.0, 3.0, 5.2, 12), 0, 8.0, 0],
      ["ink", C(T, 3.08, 3.08, 0.18, 12), 0, 9.4, 0],
      ["ink", C(T, 3.08, 3.08, 0.18, 12), 0, 6.6, 0],
      ["ink", C(T, 3.1, 2.4, 0.5, 12), 0, 10.8, 0],
      ["galv", C(T, 0.22, 0.22, 6.4, 6), 3.3, 4.0, 0]
    ];
    for (const [dx, dz] of [[2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]])
      p.push(["ink", B(T, 0.4, 5.4, 0.4), dx, 2.7, dz]);
    p.push(["ink", B(T, 6.4, 0.35, 6.4), 0, 5.5, 0]);
    return p;
  },

  /* --- yard clutter ----------------------------------------------- */

  pallet(T) {
    const p = [];
    for (const dx of [-1.7, 0, 1.7]) p.push(["woodDim", B(T, 0.55, 0.5, 4.0), dx, 0.25, 0]);
    for (let i = 0; i < 5; i++) p.push(["wood", B(T, 4.0, 0.22, 0.6), 0, 0.61, -1.7 + i * 0.85]);
    return p;
  },

  cardbox(T) {
    return [
      ["card", B(T, 2.0, 1.8, 1.9), 0, 0.9, 0],
      ["ink", B(T, 2.04, 0.1, 1.94), 0, 1.78, 0],
      ["ink", B(T, 0.14, 0.1, 1.94), 0, 1.85, 0],
      ["ink", B(T, 1.5, 0.09, 0.09), 0, 1.2, 0.96]
    ];
  },

  crate(T) {
    const p = [
      ["wood", B(T, 3.0, 2.4, 2.2), 0, 1.2, 0]
    ];
    for (const dy of [0.45, 1.95]) {
      p.push(["woodDim", B(T, 3.06, 0.2, 2.26), 0, dy, 0]);
    }
    for (const dx of [-1.2, 1.2]) p.push(["woodDim", B(T, 0.2, 2.44, 2.26), dx, 1.2, 0]);
    return p;
  },

  /* a 10ft chain-link panel, running along local X */
  fence(T) {
    const p = [
      ["galv", C(T, 0.17, 0.17, 6.2, 6), -5, 3.1, 0],
      ["galv", C(T, 0.17, 0.17, 6.2, 6), 5, 3.1, 0],
      ["galv", C(T, 0.1, 0.1, 10.0, 6), 0, 6.0, 0, 0, 0, Math.PI / 2],
      ["galv", C(T, 0.09, 0.09, 10.0, 6), 0, 0.5, 0, 0, 0, Math.PI / 2]
    ];
    for (let i = 0; i < 9; i++)
      p.push(["galv", B(T, 0.07, 5.4, 0.07), -4.4 + i * 1.1, 3.25, 0]);
    return p;
  },

  /* a small box van, the vehicle a service yard actually has in it */
  van(T) {
    const p = [
      ["white", B(T, 7.2, 6.4, 15.0), 0, 4.2, -1.5],
      ["ink", B(T, 7.3, 0.2, 15.1), 0, 7.45, -1.5],
      ["ink", B(T, 7.3, 0.18, 0.2), 0, 4.2, -9.0],
      ["ink", B(T, 6.2, 4.6, 0.14), 0, 4.2, -9.05],
      ["blue", B(T, 6.9, 4.4, 6.0), 0, 3.0, 8.4],
      ["glassPale", B(T, 6.4, 2.0, 0.16), 0, 4.3, 11.45],
      ["ink", B(T, 7.0, 0.5, 6.1), 0, 5.3, 8.4],
      ["ink", B(T, 6.6, 0.7, 0.5), 0, 1.1, 11.5]
    ];
    for (const dx of [-3.2, 3.2]) for (const dz of [7.6, -1.0, -7.0])
      p.push(["ink", C(T, 1.5, 1.5, 1.0, 10), dx, 1.5, dz, 0, 0, Math.PI / 2]);
    return p;
  },

  /* a stack of tyres against a wall */
  tyres(T) {
    const p = [];
    for (let i = 0; i < 4; i++) {
      p.push(["ink", C(T, 1.5, 1.5, 0.7, 12), 0, 0.4 + i * 0.72, 0]);
      p.push(["steelDark", C(T, 0.85, 0.85, 0.74, 12), 0, 0.4 + i * 0.72, 0]);
    }
    return p;
  },

  /* gas bottles in a cage */
  gasbottle(T) {
    const p = [["ink", B(T, 3.6, 0.2, 2.2), 0, 0.1, 0]];
    for (const [dx, dz] of [[-1.0, 0.4], [0, -0.4], [1.0, 0.4]]) {
      p.push(["orange", C(T, 0.55, 0.55, 3.4, 10), dx, 1.9, dz]);
      p.push(["ink", C(T, 0.58, 0.58, 0.16, 10), dx, 3.0, dz]);
      p.push(["ink", C(T, 0.3, 0.42, 0.5, 8), dx, 3.75, dz]);
    }
    p.push(["ink", B(T, 3.5, 0.14, 0.14), 0, 2.6, 0.9]);
    return p;
  },

  /* a site generator on skids */
  generator(T) {
    const p = [
      ["yellow", B(T, 5.4, 3.0, 3.0), 0, 1.9, 0],
      ["ink", B(T, 5.6, 0.22, 3.2), 0, 3.5, 0],
      ["ink", B(T, 5.6, 0.4, 3.2), 0, 0.2, 0],
      ["ink", C(T, 0.3, 0.3, 2.2, 8), 1.8, 4.5, -0.9]
    ];
    for (let i = 0; i < 5; i++)
      p.push(["ink", B(T, 0.12, 2.0, 3.05), -2.0 + i * 0.4, 1.9, 0]);
    return p;
  },

  /* a stack of drums by a loading bay */
  drum(T) {
    return [
      ["rust", C(T, 1.05, 1.05, 3.0, 10), 0, 1.5, 0],
      ["ink", C(T, 1.12, 1.12, 0.16, 10), 0, 1.0, 0],
      ["ink", C(T, 1.12, 1.12, 0.16, 10), 0, 2.0, 0],
      ["ink", C(T, 1.1, 1.1, 0.14, 10), 0, 3.02, 0]
    ];
  },

  /* --- ground decals ---------------------------------------------- */

  manhole(T) {
    return [
      ["asphalt", C(T, 1.75, 1.75, 0.08, 14), 0, 0.04, 0],
      ["ink", C(T, 1.42, 1.42, 0.1, 14), 0, 0.06, 0],
      ["asphalt", C(T, 1.15, 1.15, 0.12, 14), 0, 0.07, 0],
      ["ink", C(T, 0.5, 0.5, 0.14, 14), 0, 0.08, 0]
    ];
  },

  /* a rectangular utility cut, darker asphalt with an inked seam */
  patch(T) {
    return [
      ["asphalt", B(T, 7.0, 0.07, 4.6), 0, 0.035, 0],
      ["ink", B(T, 7.3, 0.06, 0.16), 0, 0.05, 2.35],
      ["ink", B(T, 7.3, 0.06, 0.16), 0, 0.05, -2.35],
      ["ink", B(T, 0.16, 0.06, 4.8), 3.55, 0.05, 0],
      ["ink", B(T, 0.16, 0.06, 4.8), -3.55, 0.05, 0]
    ];
  },

  crack(T) {
    return [
      ["ink", B(T, 11.0, 0.05, 0.16), 0, 0.05, 0],
      ["ink", B(T, 3.4, 0.05, 0.13), 2.6, 0.05, 1.0, 0, 0.5, 0],
      ["ink", B(T, 2.6, 0.05, 0.11), -3.0, 0.05, -0.9, 0, -0.6, 0]
    ];
  },

  /* kerbside catch basin: the throat under the kerb and its grate */
  drain(T) {
    const p = [
      ["concrete", B(T, 4.0, 1.1, 2.0), 0, 0.55, 0],
      ["ink", B(T, 3.0, 0.55, 0.3), 0, 0.5, 1.0],
      ["ink", B(T, 4.1, 0.12, 2.1), 0, 1.12, 0]
    ];
    for (let i = 0; i < 5; i++)
      p.push(["ink", B(T, 2.4, 0.1, 0.2), 0, 0.46, 1.5 + i * 0.34]);
    return p;
  },

  /* a straight-ahead lane arrow */
  arrow(T) {
    return [
      ["lineWhite", B(T, 1.15, 0.06, 7.0), 0, 0.03, -1.6],
      ["lineWhite", flat(T, 2.1, 0.06, 3, 0), 0, 0.03, 3.0]
    ];
  },

  /* a left-turn arrow: shaft, elbow, head */
  arrowLeft(T) {
    return [
      ["lineWhite", B(T, 1.15, 0.06, 5.4), 0, 0.03, -2.4],
      ["lineWhite", B(T, 3.6, 0.06, 1.15), -1.7, 0.03, 0.35],
      ["lineWhite", flat(T, 1.9, 0.06, 3, -Math.PI / 2), -4.3, 0.03, 0.35]
    ];
  },

  /* loose paper blown into a corner — flat, drawn, almost free */
  litter(T) {
    return [
      ["paper", B(T, 1.1, 0.04, 0.85), 0, 0.03, 0],
      ["paper", B(T, 0.9, 0.04, 0.7), 1.3, 0.03, 0.7, 0, 0.7, 0],
      ["paper", B(T, 0.75, 0.04, 0.6), -0.9, 0.03, -0.8, 0, -0.5, 0]
    ];
  },

  /* a parking bay tee */
  baytee(T) {
    return [
      ["lineWhite", B(T, 0.5, 0.06, 5.0), 0, 0.03, 0],
      ["lineWhite", B(T, 3.4, 0.06, 0.5), 0, 0.03, 2.4]
    ];
  }
};

/* ------------------------------------------------------------------
   BUILT PROPS — parts merged per material, cached per THREE
   ------------------------------------------------------------------ */
const BUILT = new WeakMap();
function built(THREE, name) {
  let all = BUILT.get(THREE);
  if (!all) { all = new Map(); BUILT.set(THREE, all); }
  let b = all.get(name);
  if (b) return b;
  const def = DEFS[name];
  if (!def) throw new Error("unknown prop: " + name);
  const parts = def(THREE);
  const byMat = new Map();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const [mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0] of parts) {
    e.set(rx, ry, rz, "YXZ");
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(geo);
  }
  b = [];
  for (const [mat, geos] of byMat) b.push([mat, geos.length === 1 ? geos[0] : mergeGeoms(THREE, geos)]);
  all.set(name, b);
  return b;
}

export const PROP_NAMES = Object.keys(DEFS);

/* ------------------------------------------------------------------
   THE KIT — collect placements, emit one InstancedMesh per bucket
   ------------------------------------------------------------------ */
export function makeKit(THREE = THREE_DEFAULT, seed = 1) {
  const P = propPalette(THREE);
  const rows = new Map();          /* name -> [[x,y,z,ry,s], ...] */
  let st = (seed >>> 0) || 1;
  const rnd = () => {
    st |= 0; st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const kit = {
    rnd,
    /** pick one of a list, deterministically */
    pick: (a) => a[Math.floor(rnd() * a.length) % a.length],
    /** chance gate */
    chance: (p) => rnd() < p,
    /** jitter around 0 */
    jit: (r) => (rnd() * 2 - 1) * r,

    add(name, x, z, opt = {}) {
      if (!DEFS[name]) throw new Error("unknown prop: " + name);
      let r = rows.get(name);
      if (!r) { r = []; rows.set(name, r); }
      r.push([x, opt.y || 0, z, opt.ry || 0, opt.s == null ? 1 : opt.s]);
      return kit;
    },

    /** how many of everything has been placed — for the record */
    count() {
      let n = 0;
      for (const r of rows.values()) n += r.length;
      return n;
    },

    flush(parent) {
      const o = new THREE.Object3D();
      for (const [name, list] of rows) {
        for (const [matName, geo] of built(THREE, name)) {
          const mat = P[matName] || P.ink;
          const im = new THREE.InstancedMesh(geo, mat, list.length);
          for (let i = 0; i < list.length; i++) {
            const [x, y, z, ry, s] = list[i];
            o.position.set(x, y, z);
            o.rotation.set(0, ry, 0);
            o.scale.setScalar(s);
            o.updateMatrix();
            im.setMatrixAt(i, o.matrix);
          }
          im.instanceMatrix.needsUpdate = true;
          im.frustumCulled = false;
          parent.add(shadowed(im));
        }
      }
      rows.clear();
      return parent;
    }
  };
  return kit;
}

/* ------------------------------------------------------------------
   RUNS — helpers for the things that come in lines
   ------------------------------------------------------------------ */

/** A chain-link run from (x0,z0) to (x1,z1), in 10ft panels. */
export function fenceRun(kit, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 10));
  const ry = Math.atan2(dx, dz) - Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    kit.add("fence", x0 + dx * t, z0 + dz * t, { ry, s: len / n / 10 });
  }
  return kit;
}

/** Evenly spaced props along a line, with a per-step chooser. */
export function runAlong(kit, x0, z0, x1, z1, step, choose) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.floor(len / step));
  const ry = Math.atan2(dx, dz);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const name = choose(i, kit.rnd());
    if (name) kit.add(name, x0 + dx * t, z0 + dz * t, { ry: ry + (kit.rnd() - 0.5) * 0.25 });
  }
  return kit;
}
