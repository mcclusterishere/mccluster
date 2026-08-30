/* ============================================================
   UPRISE WORLD — the walkable planet.

   The Heal the 3 cover is a globe with one half burning and one
   half green, a gold seam snaking between them and doves over the
   top. That artwork is a level map, so this builds it.

   YOU SPAWN ON THE HEALED SIDE. That side is America, and it holds
   all four landmarks — Bridgeport, Hartford, Atlanta and the Shiloh
   corner — each a real place tied to a real document. They are
   modelled from photographs of streets that are standing, so they
   belong in a world that is standing.

   The seam is a WALL until all four are checked in. Behind it is
   THE DEEP END, also called THE THREE: the far side of the world,
   Ukraine and Russia, still burning. Heal the 3rd World — you do
   not begin in the wreckage, you earn your way to it. None of the
   hellfire is gone; it lives on the side you have to unlock.

   ART DIRECTION — a hand-inked comic, rendered in 3D.
   Not photoreal, and not "low-poly pastel" either: thick black
   brush outlines on every form, flat pastel fills with one small
   shadow band, and richness that comes from the DENSITY of small
   drawn props rather than from polygon count or PBR.

   How the ink is made: MeshToonMaterial with a three-step gradient
   map sampled at NearestFilter (LinearFilter smooths the steps and
   the whole look dies), flatShading assigned after construction
   because Material.setValues drops it from the constructor, and
   OutlineEffect drawn twice at two weights — a wide soft pass and
   a narrow dark one — so the line tapers and wobbles like a brush
   instead of sitting there like a vector stroke. Prop normals are
   roughened a little for the same reason.

   Light is deliberately flat and bright. Ambient carries most of
   it; the sun only decides which single band a face falls into.
   Nothing is near-black except the ink: even the burnt hemisphere
   is ash grey, charred brown and burnt orange, destroyed but
   drawn, not drowned.

   Movement is spherical gravity, which sounds harder than it is.
   "Down" is just the direction from you to the planet's core, so
   there is no edge and no falling off — walking is a rotation of
   your position vector around an axis you compute from where you
   are and which way you are facing.

   Orientation is built INCREMENTALLY, by transporting the same
   rotation onto the body's quaternion. It is never rebuilt with
   setFromUnitVectors(up, normal): that has no continuous solution
   over a whole sphere (you cannot comb a hairy ball flat) and it
   flips or locks at the poles. Same reason the camera's `up` is
   the live surface normal instead of world +Y.

   The record underneath is the point. This is a layer over
   equity-uprise.html, never a replacement for it — with WebGL off
   or reduced motion on, the documents are still right there.
   ============================================================ */
import * as THREE from "../vendor/three.module.min.js";
import { EffectComposer } from "../vendor/three-addons/postprocessing/EffectComposer.js";
import { Pass } from "../vendor/three-addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "../vendor/three-addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/three-addons/postprocessing/OutputPass.js";

/* ---------- world constants ---------- */
/* PLANET RADIUS.
   Was 40, and that was the quiet cause of most of the composition
   problems. On a sphere this size the horizon at eye height sits
   11.5 units out — you literally cannot see ground further than that,
   which is about half the width of ONE landmark site. Nothing could
   be revealed because nothing could be seen approaching; every frame
   was either inside a site or looking at an empty green dome.

   70 puts the horizon at 15.2 units and takes the circumference from
   251 to 440, which is the room the four sites needed to stop
   overlapping. It is deliberately not larger than that: the walk
   between landmarks has to stay a walk, and doubling again would
   turn traversal into commuting. */
const R = 70;
const EYE = 1.72;
const WALK = 3.6;        /* metres per second along the surface */
const RUN = 6.6;
const TURN_RATE = 9.0;   /* how fast the body swings to a new heading */
const CAM_TURN = 3.4;    /* deliberately slower than TURN_RATE, so the camera trails */
const CAM_LERP = 0.09;
/* ---------- the over-the-shoulder rig ----------
   The old numbers were 56-63 degrees of FOV at 7.0-8.6 units back and
   3.15 up, dead behind the player. In a baseline capture that put him
   at roughly a twelfth of frame height with forty percent of the frame
   an empty foreground of flat ground, and a wide lens on a sphere of
   radius 40 bends the horizon into a fisheye that flattens every
   building behind it.

   Closer and longer fixes both at once: a narrower lens compresses the
   ground plane, so architecture stacks up behind the player instead of
   falling away, and the shorter boom gives him real presence. The
   shoulder offset is what turns "third person" into a composed shot —
   it puts the player off the centre line so the space he is walking
   into is the subject, which is the whole trick behind why walking
   around doing nothing feels good. */
const CAM_HEIGHT = 2.55;      /* was 3.15 — less top-down, more eye-level */
const CAM_DIST = 5.15;        /* was 7.0 */
const CAM_SHOULDER = 0.72;    /* lateral offset; 0 was a dead-centre shot */
const CAM_FOV = 51;           /* was 56 */
const CAM_FOV_RUN = 55;       /* a touch wider under speed, not 63 */
const CAM_LEAD = 0.30;        /* how far the aim leads the walk direction */
const GRAVITY = 22;
const JUMP = 8.4;
const MAX_DT = 0.1;      /* a backgrounded tab must not fling the player into orbit */
const LANDMARK_CLEAR = 8.0;  /* how far the camera is held off a building */
/* how wide a whole surveyed block is allowed to be once it is set
   down on a planet of radius 40 — a walkable pocket, not a county */
const LANDMARK_SITE_SPAN = 22.0;
/* how close to the gold line you may get before the four check-ins
   are done. Positive because the healed face is +x. */
const SEAM_GATE = 0.045;

/* ============================================================
   1. NOISE
   Classic Perlin gradient noise over a fixed permutation, so the
   planet is identical on every device and in every screenshot.
   ============================================================ */
const PERM = (() => {
  const p = new Uint8Array(512);
  let s = 1337;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = src[i]; src[i] = src[j]; src[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = src[i & 255];
  return p;
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  switch (h & 15) {
    case 0: return x + y;  case 1: return -x + y;  case 2: return x - y;  case 3: return -x - y;
    case 4: return x + z;  case 5: return -x + z;  case 6: return x - z;  case 7: return -x - z;
    case 8: return y + z;  case 9: return -y + z;  case 10: return y - z; case 11: return -y - z;
    case 12: return y + x; case 13: return -y + z; case 14: return y - x; default: return -y - z;
  }
}
function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const l = (a, b, t) => a + t * (b - a);
  return l(
    l(l(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      l(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    l(l(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      l(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}
/* fractal brownian motion — the difference between "terrain" and "a sine wave" */
function fbm(x, y, z, oct, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise3(x * f, y * f, z * f);
    norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}
/* ridged multifractal — sharp crests instead of rolling blobs */
function ridged(x, y, z, oct, lac = 2.11, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise3(x * f, y * f, z * f)) * 2;
    sum += a * n * n; norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/* ============================================================
   2. TERRAIN
   One height function, queried by the mesh builder and by the
   movement code, so what you walk on is exactly what is drawn.
   ============================================================ */

/* the seam is not the x=0 great circle — it snakes, like the gold
   line on the cover. Everything hemispheric keys off this field. */
function seamField(x, y, z) {
  return x
    + 0.150 * Math.sin(y * 3.30 + 0.60)
    + 0.085 * Math.sin(z * 2.20 - 1.15)
    + 0.045 * Math.sin(y * 7.10 + z * 3.4);
}

/* craters, placed once and shared by every query */
const CRATERS = (() => {
  const out = [];
  let s = 90210;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 30; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() < 1e-4) { i--; continue; }
    v.normalize();
    /* bias them onto the burning face — the healed side keeps its skin */
    if (v.x > 0) v.x = -v.x;
    v.normalize();
    out.push({ n: v, r: 0.06 + rnd() * 0.10, d: 1.0 + rnd() * 2.0 });
  }
  return out;
})();

function craterField(x, y, z) {
  let h = 0;
  for (let i = 0; i < CRATERS.length; i++) {
    const c = CRATERS[i], n = c.n;
    const dot = clamp(x * n.x + y * n.y + z * n.z, -1, 1);
    const ang = Math.acos(dot);
    if (ang > c.r * 1.9) continue;
    const t = ang / c.r;
    /* bowl inside, raised rim at the lip, settling to nothing outside */
    const bowl = -c.d * (1 - smoothstep(0.0, 1.0, t)) * (1 - t * t * 0.35);
    const rim = c.d * 0.44 * Math.exp(-Math.pow((t - 1.05) * 3.2, 2));
    h += bowl + rim;
  }
  return h;
}

/* The cracked crust. Ridged noise peaks along thin lines, so a
   high frequency and a late threshold give a network of fissures;
   a low frequency and an early one give general lumpiness, which
   is what makes a "cracked" planet read as a dirty one instead. */
function crackField(x, y, z) {
  const r = ridged(x * 9.0 + 11.2, y * 9.0 - 4.1, z * 9.0 + 2.7, 3);
  return smoothstep(0.60, 0.95, r);
}

/* THE FOOTPATHS.
   A worn path and a crack in the ground are the same shape — a thin
   branching network — so the healed side gets the burnt side's trick
   with the sign reversed: the crests of a ridged field, thresholded
   thin. Nobody planned these; they are where the walking went. */
function pathField(x, y, z) {
  return smoothstep(0.795, 0.965, ridged(x * 3.9 - 5.5, y * 3.9 + 2.2, z * 3.9 - 8.1, 3));
}
/* THE FIELD EDGES.
   Drawn country is not one green, it is a patchwork with dark lines
   between the patches — hedges, walls, tree lines. Same network at a
   higher frequency, laid in as the darkest green there is. */
function hedgeField(x, y, z) {
  return smoothstep(0.755, 0.935, ridged(x * 7.1 + 13.0, y * 7.1 - 9.4, z * 7.1 + 4.3, 2));
}

/* the river on the healed side, and the floodplain it sits in */
function riverField(x, y, z) {
  return y + 0.34 * Math.sin(z * 3.6 + 0.4) + 0.20 * Math.sin(x * 4.9 - 1.2) + 0.06;
}

/* WHERE THE FOUR STAND.
   The HEALED face is +x, so the landmarks ring that pole. Every one
   of them is an American building drawn from photographs of a street
   that is standing, and it belongs in a world that is standing. The
   spread widens with order: the first is in sight from spawn, and
   the fourth — the Shiloh corner — sits nearest the seam, because it
   is the one that opens the Deep End.

   It lives at module scope because the terrain has to know where the
   districts are BEFORE it is built: the crust is meshed once, and a
   plateau discovered afterwards is a plateau nothing is drawn to. */
function landmarkNormal(i) {
  /* SPREAD. The old spacing put 0.285 radians between sites, which on
     a radius-40 planet was about 11 units of arc between CENTRES —
     against a site span of 22. Adjacent blocks therefore overlapped,
     and a measured sweep found the four sites clustered so tightly
     that standing 21 units off Bridgeport put you 2.3 units from
     Atlanta. There was no ground between landmarks to be quiet on.

     0.72 radians on the larger planet is roughly 50 units between
     centres, so ~28 units of open ground separate the site edges:
     comfortably past the 15-unit horizon, which is what buys the
     sequence of quiet, then a roofline over the curve, then arrival.
     The spread stays inside |lon| < 1.2 so nothing drifts toward the
     seam and gets shoved back by the loop below. */
  const lat = -0.24 + (i % 2 ? 0.40 : -0.12) + i * 0.05;
  const lon = -1.08 + i * 0.72;
  const n = new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)
  ).normalize();
  /* Nothing may drift onto the burning side. A landmark is pulled
     back until it stands clear on the healed ground, whatever the
     latitude spread does. */
  for (let k = 0; k < 60; k++) {
    const sf = seamField(n.x, n.y, n.z);
    if (sf > 0.075) break;
    n.x += (0.075 - sf) * 0.6; n.normalize();
  }
  return n;
}

const TERRAIN = { sea: -1.75, lava: -2.55 };

/* ============================================================
   DISTRICT PADS
   A surveyed block is drawn flat, because that is how a survey is
   drawn, and this is a round world. On a planet of radius 40 a
   22-unit block has a sagitta of about a metre and a half, so a
   flat slab set down on it either buries its middle in the hill or
   floats its four corners over open air. Both happened, at all
   four sites, and it was the loudest wrong thing in the world.

   The fix has two halves and needs both. This is the first: the
   LAND under a district is pressed into a plateau at the average
   height of what it replaces, with a wide soft skirt back out to
   whatever the country was doing. It lives inside terrainHeight, so
   the drawn crust, the collision floor and every prop placement
   agree about it without any of them being told. The second half is
   conformToSphere() further down, which bends the block itself.
   ============================================================ */
const PADS = [];

/* how much of a district's plateau is felt at this direction, and at
   what height — the strongest pad wins rather than the average, so
   two sites that reach each other do not sag into a saddle between
   them. Each pad carries its OWN radius, because a site is only as
   big as its own survey and flattening a fixed disc round all four
   ironed the whole hemisphere into a putting green. */
function padAt(x, y, z) {
  let w = 0, h = 0;
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    const dot = x * p.n.x + y * p.n.y + z * p.n.z;
    if (dot < p.cosFade) continue;
    const t = smoothstep(p.fade, p.flat, Math.acos(clamp(dot, -1, 1)));
    if (t > w) { w = t; h = p.h; }
  }
  return w > 0 ? { w, h } : null;
}

/* Sample the ground a district is about to replace and take its
   AVERAGE, not the single value under the centre pin. A site that
   happens to be pinned in a dip would otherwise quarry a pit out of
   the hillside around it, and one pinned on a crest would stand on a
   table. Called once per landmark before the crust is ever built. */
function setupPads(sites) {
  PADS.length = 0;
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), c = new THREE.Vector3();
  for (const site of sites) {
    const n = site.n;
    /* Dead flat only as far as the fence, and back to open country
       not much past the apron's fringe. Generous radii here iron the
       whole hemisphere into a putting green — four sites this close
       together merge into one table, the relief goes, and the prop
       scatter that keys off the same field strips the trees with it.
       The plateau is meant to be the size of a city block. */
    const flat = Math.min(0.42, (site.r * 1.06) / R);
    const fade = Math.min(0.66, (site.r * 1.62) / R);
    t1.set(0, 1, 0).cross(n);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(n);
    t1.normalize();
    t2.crossVectors(n, t1).normalize();
    let sum = terrainHeight(n.x, n.y, n.z), k = 1;
    for (let ring = 1; ring <= 2; ring++) {
      const rad = flat * (ring / 2);
      for (let a = 0; a < 10; a++) {
        const th = (a / 10) * Math.PI * 2 + ring * 0.37;
        c.copy(n)
          .addScaledVector(t1, Math.cos(th) * rad)
          .addScaledVector(t2, Math.sin(th) * rad).normalize();
        sum += terrainHeight(c.x, c.y, c.z); k++;
      }
    }
    /* never below the waterline: a drowned district is worse than a tilted one */
    const h = Math.max(sum / k, TERRAIN.sea + 1.1);
    PADS.push({ n: n.clone(), h, flat, fade, cosFade: Math.cos(fade) });
  }
}

/* Amplitudes are deliberately modest. The reference frames put a
   nearly flat street under the camera and let the props and the
   visible curve of a small planet do the work; big alpine relief
   fights that, swallows the camera in canyons, and hides the very
   density that is supposed to carry the image. */
function terrainHeight(x, y, z) {
  const sf = seamField(x, y, z);
  const healed = smoothstep(-0.055, 0.055, sf);   /* 0 scorched .. 1 healed */

  /* broad continental relief, shared by both faces */
  let h = fbm(x * 1.85, y * 1.85, z * 1.85, 5) * 2.5;

  /* scorched: ridged spines and shallow canyons; healed: rolling hills */
  const spines = (ridged(x * 3.15 - 3.0, y * 3.15 + 7.0, z * 3.15, 4) - 0.42) * 3.0;
  const hills = fbm(x * 4.4 + 21, y * 4.4, z * 4.4 - 13, 4) * 1.35;
  h += mix(spines, hills, healed);

  /* medium and fine detail everywhere, so nothing is ever a flat plate */
  h += fbm(x * 9.1, y * 9.1 + 5, z * 9.1, 3) * 0.55;
  h += fbm(x * 19.0, y * 19.0, z * 19.0 + 9, 2) * 0.18;
  /* rolling micro-relief. Small, but it is the difference between
     ground you can read the shape of and a sanded ball: at this
     amplitude it never fights the camera and it always catches the
     light band somewhere across a facet. */
  h += fbm(x * 33.0 + 4, y * 33.0 - 6, z * 33.0, 2) * 0.085;

  const scorched = 1 - healed;
  if (scorched > 0.01) {
    h += craterField(x, y, z) * scorched;
    h -= crackField(x, y, z) * 0.55 * scorched;
  }

  /* the river valley, healed side only */
  if (healed > 0.01) {
    const s = riverField(x, y, z);
    const channel = Math.exp(-Math.pow(s / 0.075, 2)) * 2.6;
    const plain = Math.exp(-Math.pow(s / 0.30, 2)) * 1.0;
    h -= (channel + plain) * healed;
  }

  /* a district flattens what it stands on, and lets its skirt down
     into the land around it. Ahead of the seam, which still wins. */
  if (PADS.length) {
    const pad = padAt(x, y, z);
    if (pad) h = mix(h, pad.h, pad.w);
  }

  /* the gold seam is a real feature: a raised, walkable causeway */
  const onSeam = Math.exp(-Math.pow(sf / 0.075, 2));
  if (onSeam > 0.002) h = mix(h, 2.1 + fbm(x * 22, y * 22, z * 22, 2) * 0.18, onSeam * 0.92);

  return h;
}

/* the contract the world is DRAWN to: given a unit normal, the
   radius of the terrain surface under it */
const _gv = new THREE.Vector3();
function groundAt(n) {
  return R + terrainHeight(n.x, n.y, n.z);
}

/* What a body can stand on, which is not always the terrain. The
   riverbed is real ground and it is also two metres under the
   water, so walking it puts the fellow in up to his neck with the
   surface drawn over his face. He wades the shallows instead, and
   never wades into lava at all. Props are placed against groundAt,
   so only bodies use this. */
function walkAt(n) {
  const g = groundAt(n);
  const healed = seamField(n.x, n.y, n.z) > 0;
  const limit = healed ? R + TERRAIN.sea - 0.42 : R + TERRAIN.lava + 0.55;
  return g > limit ? g : limit;
}

/* slope, by finite difference along two tangents — drives the
   cliff/flat material split and keeps props off the cliffs */
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _pp = new THREE.Vector3();
function slopeAt(x, y, z) {
  _pp.set(x, y, z);
  _t1.set(0, 1, 0).cross(_pp);
  if (_t1.lengthSq() < 1e-6) _t1.set(1, 0, 0).cross(_pp);
  _t1.normalize();
  _t2.crossVectors(_pp, _t1).normalize();
  const e = 0.012, h0 = terrainHeight(x, y, z);
  const a = terrainHeight(x + _t1.x * e, y + _t1.y * e, z + _t1.z * e);
  const b = terrainHeight(x + _t2.x * e, y + _t2.y * e, z + _t2.z * e);
  return clamp(Math.hypot(a - h0, b - h0) / (e * R), 0, 1.6);
}

/* ============================================================
   3. THE INK AND THE FLAT FILL
   Three grey steps, sampled with NearestFilter so the bands stay
   hard. The steps are weighted BRIGHT — 0x84 / 0xec / 0xff — so
   most of any surface lands in one flat tone and only faces
   turned right away pick up the shadow band. That weighting is
   the difference between a comic panel and a shaded 3D render.
   ============================================================ */
function makeGradientMap() {
  const data = new Uint8Array([
    0x84, 0x84, 0x84, 0xff,   /* the one shadow band */
    0xec, 0xec, 0xec, 0xff,   /* almost the full tone */
    0xff, 0xff, 0xff, 0xff,   /* the flat fill */
  ]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const INK = [0.040, 0.034, 0.040];     /* the ink is a very dark blue-brown, never pure black */
/* OutlineEffect offsets the hull by `thickness` in NDC, so the line
   is a constant fraction of the viewport height whatever the
   distance: 0.014 lands around five and a half pixels on an 800px
   canvas, which is where the reference frames sit. */
const INK_BASE = 0.0140;

/* every material that carries an outline is registered here, so
   the double-weight brush pass can retune all of them at once */
function makeToonFactory() {
  const gradientMap = makeGradientMap();
  const inked = [];
  /* flatShading must be ASSIGNED, not passed: Material.setValues()
     drops keys the constructor never initialised, and this is one.
     Never set alphaTest on these — it fights the outline pass. */
  function toon(opts = {}) {
    const { outline, ...rest } = opts;
    const m = new THREE.MeshToonMaterial({ gradientMap, ...rest });
    m.flatShading = rest.flatShading !== false;
    if (outline === false) {
      m.userData.outlineParameters = { visible: false };
    } else {
      const w = typeof outline === "number" ? outline : 1;
      m.userData.outlineParameters = { thickness: INK_BASE * w, color: INK, alpha: 0.95, keepAlive: true };
      m.userData.inkWeight = w;
      inked.push(m);
    }
    return m;
  }
  /* an unlit fill — lava, the seam, the beacons: flat colour that
     the sun cannot touch, which is exactly how they are painted */
  function flat(opts = {}) {
    const { outline, ...rest } = opts;
    const m = new THREE.MeshBasicMaterial({ toneMapped: false, ...rest });
    if (outline === false) m.userData.outlineParameters = { visible: false };
    else {
      const w = typeof outline === "number" ? outline : 1;
      m.userData.outlineParameters = { thickness: INK_BASE * w, color: INK, alpha: 0.95, keepAlive: true };
      m.userData.inkWeight = w;
      inked.push(m);
    }
    return m;
  }
  return { toon, flat, gradientMap, inked };
}

/* ============================================================
   4. QUALITY TIERS
   Renderer capabilities, pixel ratio, memory and cores give a
   first guess; a timed probe frame confirms or demotes it. High
   end gets everything, including the second brush-weight outline
   pass, which is a whole extra scene draw and the first thing to
   go when the device cannot hold it.
   ============================================================ */
const TIERS = {
  high: {
    name: "high", detail: 64, pixelRatio: 2, shadows: true, shadowMap: 2048,
    post: true, bloom: 0.52, terrainShadows: true, brushPass: true,
    rocks: 460, deadTrees: 300, canopy: 230, bushes: 420, grass: 2400,
    rubble: 620, debris: 320, ruins: 54, poleChains: 11, smoke: 70,
    embers: 900, ash: 620, doves: 12, stars: 900, skyTexture: 1024,
    atmosphere: true, water: true,
  },
  medium: {
    name: "medium", detail: 44, pixelRatio: 1.75, shadows: true, shadowMap: 1024,
    post: true, bloom: 0.48, terrainShadows: false, brushPass: false,
    rocks: 240, deadTrees: 150, canopy: 120, bushes: 220, grass: 800,
    rubble: 300, debris: 150, ruins: 28, poleChains: 6, smoke: 36,
    embers: 420, ash: 280, doves: 8, stars: 520, skyTexture: 768,
    atmosphere: true, water: true,
  },
  low: {
    name: "low", detail: 26, pixelRatio: 1.25, shadows: false, shadowMap: 512,
    post: false, bloom: 0, terrainShadows: false, brushPass: false,
    rocks: 100, deadTrees: 60, canopy: 52, bushes: 80, grass: 0,
    rubble: 100, debris: 50, ruins: 14, poleChains: 3, smoke: 16,
    embers: 160, ash: 110, doves: 5, stars: 300, skyTexture: 384,
    atmosphere: false, water: true,
  },
};

function guessTier(renderer) {
  const gl = renderer.getContext();
  let desc = "";
  try {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) desc = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
  } catch (e) { /* some browsers hide this; the probe still runs */ }
  const software = /swiftshader|llvmpipe|softwarerasterizer|mesa offscreen/i.test(desc);
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const maxTex = renderer.capabilities.maxTextureSize || 2048;
  const webgl2 = renderer.capabilities.isWebGL2 !== false;
  if (software) return { tier: "low", why: "software rasteriser: " + (desc || "unknown") };
  if (!webgl2 || maxTex < 4096 || mem <= 2 || cores <= 2) return { tier: "low", why: "limited capabilities" };
  if (mem <= 4 || cores <= 4 || maxTex < 8192) return { tier: "medium", why: "mid capabilities" };
  return { tier: "high", why: desc || "capable device" };
}

/* a real frame, timed with a pipeline flush, so a device that
   claims to be capable and is not gets demoted before the world is
   ever built at a size it cannot hold */
function probe(renderer) {
  const s = new THREE.Scene();
  const c = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  c.position.z = 6;
  s.add(new THREE.DirectionalLight(0xffffff, 1));
  const g = new THREE.IcosahedronGeometry(2, 22);   /* ~10k triangles */
  const m = new THREE.MeshToonMaterial({ color: 0x888888 });
  m.flatShading = true;
  const mesh = new THREE.Mesh(g, m);
  s.add(mesh);
  const gl = renderer.getContext();
  renderer.render(s, c); gl.finish();
  const t0 = performance.now();
  for (let i = 0; i < 6; i++) { mesh.rotation.y += 0.1; renderer.render(s, c); }
  gl.finish();
  const ms = (performance.now() - t0) / 6;
  g.dispose(); m.dispose();
  return ms;
}

function pickTier(renderer, override) {
  if (override && TIERS[override]) return { key: override, why: "forced", probeMs: 0 };
  const guess = guessTier(renderer);
  let key = guess.tier, why = guess.why, ms = 0;
  try {
    ms = probe(renderer);
    if (ms > 16 && key === "high") { key = "medium"; why = "probe " + ms.toFixed(1) + "ms"; }
    if (ms > 40) { key = "low"; why = "probe " + ms.toFixed(1) + "ms"; }
  } catch (e) { /* if the probe cannot run, trust the capability guess */ }
  return { key, why, probeMs: ms };
}

/* ============================================================
   5. PALETTE
   Read off the reference frames. Muted, warm, airy. The darkest
   value in the whole world is the ink; the scorched hemisphere is
   ash and burnt orange, not black — destroyed but still drawn.
   ============================================================ */
const C = {
  /* scorched ground */
  ash: 0xbcab98, ashLit: 0xd2cabe, ashGrey: 0xb3b2ab, charred: 0x8a6a56, charDark: 0x66493b,
  burnt: 0xc07444, emberRed: 0xb8503a, cinder: 0x9a8578,
  charBurn: 0x4e3a30, charSoot: 0x3b2c25,   /* burnt wood, read as silhouette */
  /* fire */
  lava: 0xff7a33, lavaHot: 0xffc061, fissure: 0xff8a3c,
  /* healed ground */
  sage: 0xc9d9b6, sageLit: 0xdde8cc, grass: 0x8fbc6a, grassLit: 0xafd184,
  canopy: 0x5e9a45, canopyLit: 0x84b95e, leafDark: 0x487c37,
  soil: 0xc0ac8c, sand: 0xdccfae, cliff: 0xb2b4a4, stone: 0xc4c4b8,
  water: 0x86c9cf, waterDeep: 0x5aa9b4,
  /* the seam */
  gold: 0xe0ad3c, goldHot: 0xffdc7a,
  /* built things */
  concrete: 0xc6c8bf, concreteDark: 0xa9aca2, salmon: 0xe0ac9e,
  brick: 0xb0554c, mustard: 0xe0b453, teal: 0x8ec9c2, cream: 0xeae5d6,
  bark: 0x7a6350, deadBark: 0x8d7864, timber: 0xa98f6f, rust: 0xa9643f,
  metal: 0x9aa0a0, wire: 0x2a2622,
  /* sky */
  skyHealed: 0x8fd6ce, skyHealedHi: 0x5cb3ae, skyScorch: 0xdb9c66, skyScorchHi: 0xa07360,
  cloud: 0xf1f8f5, cloudSmoke: 0xc9b6a6,
  /* life */
  dove: 0xf7f4ec, smoke: 0xc3bab3, smokeDark: 0xa79d96,
  /* him */
  skin: 0x7a4f33, skinShade: 0x63402a, hair: 0x3a2820,
  hoodie: 0xd8552f, jeans: 0x3d4a63, shoe: 0xf0ece0, shoeSole: 0xc4402f,
};

/* ============================================================
   6. MOUNT
   ============================================================ */
export async function mount(canvas, opts = {}) {
  const design = await fetch("data/uprise-world.json", { cache: "no-cache" }).then(r => r.json());
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  const forced = opts.quality || params.get("q") || null;

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: "high-performance", stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const picked = pickTier(renderer, forced);
  const Q = TIERS[picked.key];
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pixelRatio));
  if (Q.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const ink = makeToonFactory();
  const { toon, flat, gradientMap } = ink;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(56, 1, 0.12, 1600);

  /* ============================================================
     THE FOUR SITES ARE BUILT BEFORE THE LAND IS
     A district flattens the ground it stands on, and only the
     district knows how wide it is. So the four blocks are assembled
     first, measured, and their footprints surveyed onto the terrain
     — and only then is the crust meshed. A plateau discovered after
     the crust is a plateau nothing is drawn to: the collision floor
     would have it and the picture would not, which is the same
     disagreement between what you walk on and what you see, one
     layer down. They are placed later, once there is a planet to
     place them on.
     ============================================================ */
  /* The district builder stands the real building on its real block,
     with its streets named and on the correct sides. It takes a SLUG
     and THREE — the old call here passed the landmark record and an
     options bag, so every lookup missed and every landmark silently
     fell back to the placeholder box. */
  let landmarkBuilder = null;
  try {
    const mod = await import("./uprise-district.js");
    if (mod && typeof mod.buildSite === "function") landmarkBuilder = mod.buildSite;
  } catch (e) { landmarkBuilder = null; }
  if (!landmarkBuilder) {
    try {
      const mod = await import("./uprise-landmarks.js");
      if (mod && typeof mod.build === "function") landmarkBuilder = mod.build;
    } catch (e) { landmarkBuilder = null; }
  }

  const sites = design.landmarks.map((L, i) => {
    const n = landmarkNormal(i);
    let body = null, r = 0;
    if (landmarkBuilder) {
      try {
        body = landmarkBuilder(L.slug, THREE);
        /* A district is surveyed in real feet, so a city block comes
           out about as wide as this planet. Fit each site into the
           check-in pocket the world budgets for a landmark, keeping
           its internal proportions — the geography is in the layout,
           not in the absolute size. */
        if (body && body.isObject3D) {
          const bb = new THREE.Box3().setFromObject(body);
          const sz = bb.getSize(new THREE.Vector3());
          const span = Math.max(sz.x, sz.z);
          if (span > 0) {
            const k = LANDMARK_SITE_SPAN / span;
            body.scale.setScalar(k);
            /* A DISTRICT IS SEATED ON ITS GROUND, NOT ON ITS BOX.
               Lifting a site clear of its lowest point is right for a
               bare building and wrong for a block: a block's lowest
               point is the bottom of the skirt buried under it, so
               the lift raised the whole district into the air and the
               player walked out under a brown cliff of its underside.
               A district is already drawn with its ground at y = 0. */
            body.position.y = body.userData && body.userData.district ? 0 : -bb.min.y * k;
            r = (body.userData && body.userData.padRadius ? body.userData.padRadius : span * 0.55) * k;
          }
        }
        /* a builder that returns something that is not an Object3D is
           a builder that would take the whole world down with it */
        if (!body || !body.isObject3D) body = null;
      } catch (e) { body = null; }
    }
    if (!body) { body = placeholderLandmark(L, toon); r = 7.5; }
    return { L, i, n, body, r: r || 7.5, placeholder: !!(body.userData && body.userData.placeholder) };
  });
  setupPads(sites);

  /* ---------- the planet ---------- */
  const build = buildPlanet(Q, toon, flat);
  scene.add(build.crust, build.fissures, build.lavaPools, build.seamRibbon);
  if (Q.water) scene.add(build.water);

  /* ============================================================
     7. LIGHT — flat and bright on purpose
     The refs have almost no shading: a surface is one tone, with a
     small darker band where it turns away. So ambient carries the
     image and the sun only decides which band a face lands in.
     A warm key over the burn and a cool one over the green keeps
     the two hemispheres reading as different weather.
     ============================================================ */
  const ambient = new THREE.AmbientLight(0xffffff, 0.60);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xdff2ee, 0xbfa894, 0.30);
  scene.add(hemi);

  const SUN_DIR = new THREE.Vector3(-0.48, 0.72, 0.50).normalize();
  const key = new THREE.DirectionalLight(0xfff0d8, 0.72);
  key.position.copy(SUN_DIR).multiplyScalar(120);
  if (Q.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 200;
    const S = 40;
    key.shadow.camera.left = -S; key.shadow.camera.right = S;
    key.shadow.camera.top = S; key.shadow.camera.bottom = -S;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.35;
    key.shadow.radius = 3;
  }
  scene.add(key); scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xcdeee0, 0.22);
  fill.position.set(88, 24, -46);
  scene.add(fill);
  /* the lava is a light source in its own right, not just a colour */
  const lavaGlow = new THREE.PointLight(0xff8a3c, 0, 48, 2);
  scene.add(lavaGlow);

  /* ---------- sky, stars, air ---------- */
  const sky = buildSky(Q.skyTexture);
  scene.add(sky);
  const cloudShell = sky.userData.clouds;
  const burnSky = sky.userData.burn;
  const stars = buildStars(Q.stars);
  scene.add(stars);
  if (Q.atmosphere) scene.add(buildAtmosphere());
  scene.fog = new THREE.FogExp2(C.skyHealed, 0.0012);

  /* ---------- everything repeated, instanced ---------- */
  const props = buildProps(Q, toon, flat, scene);
  const doves = buildDoves(Q, toon); scene.add(doves.group);
  const embers = buildEmbers(Q); scene.add(embers.points);
  const ash = buildAsh(Q); scene.add(ash.points);

  /* ============================================================
     8. LANDMARKS
     The buildings are somebody else's file. If it is there we use
     it; if it is not, an honest placeholder stands in and the
     world still runs.
     ============================================================ */
  const marks = [];
  const RUBY = 0xe5383b;
  sites.forEach(({ L, i, n, body, placeholder }) => {
    const g = new THREE.Group();
    g.add(body);
    /* AND BEND IT ONTO THE WORLD. Without this the block is a flat
       card laid across a ball: its middle buried, its four corners
       nearly three units up in the air, its edges slicing the
       hillside open. With it, the streets curve away over the
       horizon the way they do in the reference frames. The land
       under it is already a plateau, so the two agree and the join
       is a skirt into a hillside rather than a cut through one. */
    if (!placeholder) conformToSphere(g, groundAt(n));

    /* ---------- the mark on the ground ----------
       This was a ruby icosahedron on a translucent shaft, floating
       nine units over every site. In a baseline capture it was the
       first thing the eye found in almost every frame — a quest arrow
       hovering over four real buildings, which is the single loudest
       "videogame prototype" tell in the project and the thing most at
       odds with an illustrated world.

       What replaces it is an annotation rather than a marker: a
       hand-drawn ring laid ON the ground at the site, the red
       editorial circle from the Living Sketch language, sitting flat
       where a pen would have put it. It reads as somebody marked this
       place on the drawing, not as a floating objective. It is under
       the horizon, so it never interrupts a skyline; the buildings
       themselves have to do the wayfinding, which is what they are
       for.

       The circle is deliberately imperfect — an overdrawn arc that
       does not quite close, with the radius wobbling around the
       sweep — because a struck compass circle reads as UI and a drawn
       one reads as a mark.

       The ring has to be walked around the SPHERE, not drawn flat and
       laid on top of it. A flat circle of radius 9.4 on a planet of
       radius 40 leaves the ground by nearly a unit at its edges: half
       of it sinks and half floats, and from any distance the floating
       half reads as stray red lines cutting across the sky. So each
       point is carried out from the site along a great circle and then
       dropped onto the terrain height there. */
    const RING_N = 84, RING_R = 9.4;
    const ringT1 = new THREE.Vector3(-n.z, 0, n.x);
    if (ringT1.lengthSq() < 1e-8) ringT1.set(1, 0, 0);
    ringT1.normalize();
    const ringT2 = new THREE.Vector3().crossVectors(n, ringT1).normalize();
    const theta = RING_R / R;                            /* angular radius */
    const ringPts = [], _rd = new THREE.Vector3();
    for (let i = 0; i <= RING_N; i++) {
      const a = (i / RING_N) * Math.PI * 2.13;           /* past 2pi: the overdraw */
      const wob = 1 + Math.sin(a * 3.1 + 0.7) * 0.020 + Math.sin(a * 7.3) * 0.012;
      const th = theta * wob;
      _rd.copy(n).multiplyScalar(Math.cos(th))
         .addScaledVector(ringT1, Math.cos(a) * Math.sin(th))
         .addScaledVector(ringT2, Math.sin(a) * Math.sin(th))
         .normalize();
      ringPts.push(_rd.clone().multiplyScalar(groundAt(_rd) + 0.07));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: RUBY, transparent: true, opacity: 0.55 }));
    ring.renderOrder = 2;
    scene.add(ring);      /* world space: it is drawn ON the planet, not parented to the block */

    g.position.copy(n).multiplyScalar(groundAt(n));
    orientToSurface(g, n);
    g.traverse(o => { if (o.isMesh) { o.castShadow = Q.shadows; o.receiveShadow = Q.shadows; } });
    scene.add(g);
    marks.push({ n, g, ring, data: L, done: false });
  });

  /* ---------- the fellow ---------- */
  /* THE REAL FELLOW.
     js/uprise-character.js has carried the actual likeness for a
     while now — the blue HM hoodie, the twists, the chest badge, the
     matching joggers, a real idle/walk/run rig — and nothing ever
     imported it. The world kept building its own capsule stand-in
     below, in an orange hoodie, so the shirt was never blue no
     matter how many times the character module was fixed. It is
     imported here and adapted to the { root, pose } shape the loop
     already speaks; the stand-in survives only as the fallback. */
  const fellow = await (async () => {
    try {
      const mod = await import("./uprise-character.js");
      if (!mod || typeof mod.buildFellow !== "function") return null;
      const api = mod.buildFellow(THREE, { reducedMotion: reduced,
        /* the world already lays a contact shadow under the player
           (buildContactShadow, below) and it is the one that reads
           the terrain height. Letting the character draw its own too
           stacked two ellipses into a soft radial smudge. */
        contactShadow: false });
      if (!api || !api.group || !api.group.isObject3D) return null;
      const root = new THREE.Group();
      root.add(api.group);
      let last = 0;
      return {
        root,
        api,
        pose(t, speedFactor, runBlend, grounded, now) {
          /* the loop owns the clock, so the rig is stepped off the
             same frame delta rather than running a second one */
          const dt = now && last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
          if (now) last = now;
          api.setAnimation(speedFactor < 0.05 ? "idle" : (runBlend > 0.5 ? "run" : "walk"));
          api.update(dt, mix(WALK, RUN, runBlend || 0) * (speedFactor || 0));
          api.setPhase(t / (Math.PI * 2));
        }
      };
    } catch (e) { return null; }
  })() || buildFellow(toon);
  const you = fellow.root;
  scene.add(you);

  /* ---------- who still gets a hull ----------
     The world's line comes from depth now. Hull ink is reserved for
     hero emphasis, so every material registered by the toon factory
     is switched off here and only the player's are switched back on.
     `renderOutline` still walks the graph, but it issues draws for
     the fellow alone — 33 meshes instead of 575.

     Landmarks deliberately get NO hull at this stage. If one turns
     out to need a stronger outer contour it should get a simplified
     proxy silhouette, not an outline round every window and kerb. */
  for (const m of ink.inked) {
    if (m.userData.outlineParameters) m.userData.outlineParameters.visible = false;
  }
  ink.inked.length = 0;

  /* ---------- THE HERO CONTOUR ----------
     OutlineEffect is gone from this path. It renders the whole scene
     whichever materials opt in, so "hull on the player only" measured
     at 1,133 calls instead of 619 — the line was hidden on 547 objects
     that were still being drawn.

     What replaces it exploits a fact about this rig: it is NOT
     skinned. It animates by rotating groups, and every mesh under
     them is rigid. So a hull can simply be a CHILD of the mesh it
     outlines. That one decision buys three things at once —

       - it inherits the animated transform exactly, every frame, with
         no skeleton bookkeeping and no per-frame matrix copying;
       - it draws inside the ordinary scene render, so depth is
         correct and the hero cannot appear through a wall or a tree;
       - it costs one draw call per hero mesh and nothing else. No
         second pass, no full-scene traversal.

     The expansion is along the vertex normal in object space, back
     faces only, which is the classic inverted hull — but authored per
     part rather than uniformly, so the head and torso carry the
     heaviest line and the hands stay restrained. Hierarchy, not
     noise. */
  const HERO_INK = new THREE.Color(INK[0], INK[1], INK[2]);
  const heroInkMats = new Map();
  function heroInkMaterial(weight) {
    const key = weight.toFixed(2);
    if (heroInkMats.has(key)) return heroInkMats.get(key);
    const m = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: 0.0132 * weight }, ink: { value: HERO_INK } },
      vertexShader: `
        uniform float thickness;
        void main(){
          vec3 p = position + normalize(normal) * thickness;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: "uniform vec3 ink; void main(){ gl_FragColor = vec4(ink, 1.0); }",
      side: THREE.BackSide, depthTest: true, depthWrite: true,
    });
    heroInkMats.set(key, m);
    return m;
  }
  /* weight by part, read off the material tint the rig already uses —
     the rig names nothing, but it does colour consistently */
  function heroWeightFor(mesh) {
    const c = mesh.material && mesh.material.color ? mesh.material.color.getHex() : 0;
    if (c === 0x2d2831 || c === 0x40312a) return 1.30;   /* hair, beard: strongest */
    if (c === 0x3f6a9e || c === 0xeae2d2) return 1.15;   /* hoodie and its print */
    if (c === 0x603722) return 0.72;                     /* skin: hands and face, restrained */
    if (c === 0x2c2f38 || c === 0xe8e3d6) return 1.00;   /* shoes */
    return 1.00;                                          /* pants, cuffs and the rest */
  }
  let heroHulls = 0;
  you.traverse((o) => {
    if (!o.isMesh || o.userData.isHeroInk) return;
    const w = o.userData.heroInkWeight || heroWeightFor(o);
    const hull = new THREE.Mesh(o.geometry, heroInkMaterial(w));
    hull.userData.isHeroInk = true;
    hull.castShadow = false; hull.receiveShadow = false;
    hull.renderOrder = -1;          /* behind its own surface */
    o.add(hull);                    /* child: inherits the animated transform */
    heroHulls++;
  });

  /* ---------- the keepers ----------
     People on the four sites, and the errand that carries the record
     between them. Built after the landmarks because each keeper
     stands relative to a mark, and after the fellow because both use
     the same rig. If the module or the data is missing the world runs
     exactly as it did — check-ins never depended on this. */
  const keepers = await (async () => {
    try {
      const mod = await import("./uprise-npc.js");
      if (!mod || typeof mod.buildKeepers !== "function") return null;
      return await mod.buildKeepers(THREE, {
        people: design.people, marks, groundAt, reduced,
        onTalk: (ev, st) => opts.onTalk && opts.onTalk(ev, st),
        onLeave: (k, st) => opts.onLeave && opts.onLeave(k, st)
      });
    } catch (e) { return null; }
  })();
  if (keepers) {
    keepers.group.traverse(o => { if (o.isMesh) { o.castShadow = Q.shadows; o.receiveShadow = Q.shadows; } });
    scene.add(keepers.group);
  }
  const contact = buildContactShadow();
  scene.add(contact.mesh);

  /* Spawn wants a clearing, not a cupboard. The nominal point is on
     the HEALED face a walk short of the first landmark; from there,
     spiral out until the ground is flat enough to stand on, far
     enough off a building to see it, and close enough that the
     first beacon is still in shot.

     You begin in the world that is standing. The Deep End is on the
     far side and you have to earn it. */
  const spawnN = (() => {
    const want = new THREE.Vector3(0.94, 0.20, 0.28).normalize();
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), cand = new THREE.Vector3(), at = new THREE.Vector3();
    t1.set(0, 1, 0).cross(want).normalize();
    t2.crossVectors(want, t1).normalize();
    /* Everything is scored rather than filtered, except the two
       things that make a spot unusable at all. A stack of hard
       filters that no candidate satisfies silently falls back to the
       nominal point, which is exactly the spot we were trying to
       leave — the failure is invisible and looks like a bug in
       something else entirely. */
    let best = null, bestScore = -1e9;
    for (let k = 0; k < 420; k++) {
      const a = k * 2.39996, rad = 0.010 * Math.sqrt(k);
      cand.copy(want).addScaledVector(t1, Math.cos(a) * rad).addScaledVector(t2, Math.sin(a) * rad).normalize();
      if (seamField(cand.x, cand.y, cand.z) < 0.16) continue;
      if (terrainHeight(cand.x, cand.y, cand.z) < TERRAIN.sea + 1.2) continue;

      /* A plateau edge passes a slope test underfoot and still drops
         away behind you, which puts the camera out over the void and
         the fellow apparently in mid-air. Test the ground all round,
         not just where he is standing. */
      const h0 = terrainHeight(cand.x, cand.y, cand.z);
      let ledge = 0;
      for (let d = 0; d < 8; d++) {
        const ang = (d / 8) * Math.PI * 2, reach = 9 / R;
        at.copy(cand)
          .addScaledVector(t1, Math.cos(ang) * reach)
          .addScaledVector(t2, Math.sin(ang) * reach).normalize();
        ledge = Math.max(ledge, Math.abs(terrainHeight(at.x, at.y, at.z) - h0));
      }

      at.copy(cand).multiplyScalar(groundAt(cand));
      let nearest = 1e9, toBeacon = 1e9;
      for (const m of marks) {
        const dd = m.g.position.distanceTo(at);
        nearest = Math.min(nearest, dd);
        toBeacon = Math.min(toBeacon, Math.abs(dd - 26));
      }
      /* far enough not to trip the check-in on frame one, near enough
         that the first beacon is already leading you somewhere */
      const score = Math.min(nearest, 26) * 1.4
        - Math.max(0, 15 - nearest) * 6
        - toBeacon * 0.35
        - ledge * 7
        - slopeAt(cand.x, cand.y, cand.z) * 22
        - rad * 10;
      if (score > bestScore) { bestScore = score; best = cand.clone(); }
    }
    return best || want;
  })();
  you.position.copy(spawnN).multiplyScalar(walkAt(spawnN));
  /* the ONE place an absolute orientation is taken — at spawn, well
     away from either pole. Everything after this is incremental. */
  orientToSurface(you, spawnN);
  orientToSurface(cloudShell, spawnN);

  const velocity = new THREE.Vector3();
  let grounded = true, speedFactor = 0, sprinting = false, jumpWanted = false;

  /* ============================================================
     9. INPUT — drag to walk, identical on desktop and phone
     Pointer Events, so a mouse, a trackpad and a thumb all take
     one code path. Press anywhere, drag a direction, the fellow
     walks that way; let go and he stops. WASD still works for
     desktop players who reach for it.
     ============================================================ */
  const keys = Object.create(null);
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === " " && !e.repeat) jumpWanted = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  const drag = { on: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
  const DRAG_MAX = 78;    /* px of travel for full speed */
  const DRAG_DEAD = 6;
  const DRAG_RUN = 0.82;  /* past this much of the ring, he runs */
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    drag.on = true; drag.id = e.pointerId;
    drag.ox = e.clientX; drag.oy = e.clientY; drag.dx = 0; drag.dy = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.ox;
    drag.dy = e.clientY - drag.oy;
    /* if the thumb travels past the ring, drag the ring with it, so
       a long swipe never runs out of joystick */
    const len = Math.hypot(drag.dx, drag.dy);
    if (len > DRAG_MAX) {
      const k = (len - DRAG_MAX) / len;
      drag.ox += drag.dx * k; drag.oy += drag.dy * k;
      drag.dx *= DRAG_MAX / len; drag.dy *= DRAG_MAX / len;
    }
  });
  const dragOff = (e) => {
    if (e && e.pointerId !== drag.id && drag.id !== -1) return;
    drag.on = false; drag.id = -1; drag.dx = drag.dy = 0;
  };
  canvas.addEventListener("pointerup", dragOff);
  canvas.addEventListener("pointercancel", dragOff);
  canvas.addEventListener("lostpointercapture", dragOff);

  /* ============================================================
     10. THE INK
     OutlineEffect is retired. It was the world's outline system and
     it drew a second full copy of the scene to do it — a measured 2x
     on draw calls, and it could not be aimed at one object, because
     hiding a material's outline stops the line without stopping the
     call. The world's line is now derived from depth (see drawWorld),
     and the hero's is a child hull on his own meshes. Neither needs
     a second scene render.
     ============================================================ */
  let inkRT = null, inkQuad = null, inkScene = null, inkCam = null, inkMat = null;

  function buildInk(w, h) {
    const pr = renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * pr)), H = Math.max(2, Math.floor(h * pr));
    if (inkRT) { inkRT.dispose(); if (inkRT.depthTexture) inkRT.depthTexture.dispose(); }
    inkRT = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    inkRT.depthTexture = new THREE.DepthTexture(W, H);
    inkRT.depthTexture.type = THREE.UnsignedIntType;
    /* COLOUR SPACE. Rendering to the canvas applies the output
       transfer function; rendering to a target does not, so routing
       the world through an RT and blitting it back handed the display
       linear values and the whole frame came out dark and muddy.
       Declaring the target's colour space makes the scene pass encode
       on the way in, and a raw ShaderMaterial does no second
       conversion on the way out. */
    inkRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

    if (!inkMat) {
      inkScene = new THREE.Scene();
      inkCam = new THREE.Camera();
      inkMat = new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null }, tDepth: { value: null },
          texel: { value: new THREE.Vector2() },
          cnear: { value: cam.near }, cfar: { value: cam.far },
          ink: { value: new THREE.Color(INK[0], INK[1], INK[2]) },
        },
        vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }",
        fragmentShader: `
          varying vec2 vUv;
          uniform sampler2D tColor; uniform highp sampler2D tDepth;
          uniform vec2 texel; uniform float cnear, cfar; uniform vec3 ink;
          float lin(vec2 uv){
            float z = texture2D(tDepth, uv).x;
            return (2.0*cnear) / (cfar + cnear - (z*2.0-1.0)*(cfar-cnear));
          }
          void main(){
            /* Sample width grows with distance so a far line does not
               thin to a crawling single pixel — the usual cause of
               sparkle when the camera moves by a subpixel. */
            float c = lin(vUv);
            float wide = 1.0 + smoothstep(0.02, 0.35, c) * 1.35;
            vec2 t = texel * wide;
            float l = lin(vUv - vec2(t.x,0.)), r = lin(vUv + vec2(t.x,0.));
            float u = lin(vUv - vec2(0.,t.y)), d = lin(vUv + vec2(0.,t.y));

            /* SILHOUETTE: a depth step. Survives to any distance. */
            /* NEAR SENSITIVITY. A rock a few metres away meets the
               ground at a shallow depth step, so a single global
               threshold left the foreground almost uninked while
               distant silhouettes read fine. The threshold therefore
               tightens up close and relaxes with distance — near
               objects get a contour, far ones do not gain noise. */
            float near = 1.0 - smoothstep(0.008, 0.10, c);
            float step1 = (abs(r-l) + abs(d-u)) / max(c, 1e-4);
            float t0 = mix(0.010, 0.0045, near);
            float sil = smoothstep(t0, t0 * 5.5, step1);

            /* FORM SEAM: depth curvature, faded out with distance, so
               near architecture keeps structural lines and far
               architecture simplifies toward silhouette. */
            float step2 = (abs(l + r - 2.0*c) + abs(u + d - 2.0*c)) / max(c, 1e-4);
            float s0 = mix(0.0016, 0.0011, near);
            float seam = smoothstep(s0, s0 * 5.6, step2);
            seam *= 1.0 - smoothstep(0.06, 0.26, c);

            float e = clamp(max(sil, seam * 0.85), 0.0, 1.0);
            vec3 col = texture2D(tColor, vUv).rgb;
            /* warm charcoal, never absolute black, and never fully
               opaque, so the fill still breathes through the line */
            vec3 outc = mix(col, ink, e * 0.88);
            /* The scene was rendered into a linear target, so the
               display transfer function has not been applied. Doing it
               here is what keeps the frame from coming back dark and
               muddy; a raw ShaderMaterial gets no automatic
               conversion on the way to the canvas. */
            outc = mix(outc * 12.92,
                       1.055 * pow(max(outc, vec3(1e-5)), vec3(1.0/2.4)) - 0.055,
                       step(vec3(0.0031308), outc));
            gl_FragColor = vec4(outc, 1.0);
          }`,
        depthTest: false, depthWrite: false,
      });
      inkQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), inkMat);
      inkQuad.frustumCulled = false;
      inkScene.add(inkQuad);
    }
    inkMat.uniforms.tColor.value = inkRT.texture;
    inkMat.uniforms.tDepth.value = inkRT.depthTexture;
    inkMat.uniforms.texel.value.set(1 / W, 1 / H);
    inkMat.uniforms.cnear.value = cam.near;
    inkMat.uniforms.cfar.value = cam.far;
  }

  function drawWorld() {
    const target = renderer.getRenderTarget();
    if (!inkRT) buildInk(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);

    /* 1. the world, once, into the depth-carrying target */
    renderer.setRenderTarget(inkRT);
    renderer.clear();
    renderer.render(scene, cam);

    /* 2. one fullscreen composite: colour, with the line laid into it */
    renderer.setRenderTarget(target);
    renderer.render(inkScene, inkCam);

    /* There is no third step. The hero's contour is a child mesh of
       each of his own meshes, so it was already drawn — in the right
       place in the depth order, occluded by anything in front of him,
       at the cost of one call per hero part. */
  }

  class WorldPass extends Pass {
    constructor() { super(); this.needsSwap = false; this.clear = true; }
    render(rend, writeBuffer, readBuffer) {
      rend.setRenderTarget(this.renderToScreen ? null : readBuffer);
      outline.autoClear = this.clear;
      drawWorld();
    }
  }

  let composer = null, bloomPass = null;
  function buildComposer(w, h) {
    if (composer) composer.dispose();
    composer = new EffectComposer(renderer);
    composer.setSize(w, h);
    composer.addPass(new WorldPass());
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), Q.bloom, 0.5, 0.95);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    buildInk(w, h);              /* the depth target follows the canvas */
    if (Q.post) buildComposer(w, h);
  }
  addEventListener("resize", resize);
  resize();

  /* ============================================================
     11. THE WALK
     ============================================================ */
  const LOCAL_UP = new THREE.Vector3(0, 1, 0);
  const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _fwdT = new THREE.Vector3();
  const _axis = new THREE.Vector3(), _q = new THREE.Quaternion();
  const _want = new THREE.Vector3(), _camF = new THREE.Vector3(), _camR = new THREE.Vector3();
  const _camPos = new THREE.Vector3(), _tmp = new THREE.Vector3(), _off = new THREE.Vector3();
  /* the shoulder axis and the aim point, allocated once — the camera
     runs every frame and this loop is already allocation-free */
  const _shoulder = new THREE.Vector3(), _aim = new THREE.Vector3();
  /* the camera's own heading, transported along with the player so
     it stays tangent, and lerped toward his — slower than he turns,
     so it trails instead of being welded on */
  const camDir = new THREE.Vector3();
  you.getWorldDirection(camDir);
  let camInit = false, camSwing = 0, camFov = 56;
  let started = false, walkPhase = 0, runBlend = 0;
  /* ---------- body feel ----------
     The fellow moved like a rigid piece sliding over the sphere: one
     symmetric ramp for both starting and stopping, a hard linear clamp
     on the turn, and no lean, settle or slope response at all. These
     drive a tilt node UNDER the transported orientation, so none of it
     can corrupt the parallel transport that keeps him upright on a
     ball. */
  let turnSigned = 0;      /* smoothed signed yaw rate, radians/sec */
  let leanRoll = 0;        /* bank into the corner */
  let bodyPitch = 0;       /* lean forward under acceleration, back when braking */
  let slopePitch = 0;      /* the ground is not flat; neither is he */
  let settleVel = 0;       /* damped spring that absorbs the stop */
  let prevSpeed = 0;
  /* the rig's own group, tilted locally — never `you`, whose quaternion
     is the transported frame */
  const tiltNode = (fellow.root.children && fellow.root.children[0]) || null;
  let camHold = false;
  /* seeded from where he actually spawns, so frame one is graded
     right rather than easing into it from the wrong hemisphere */
  let hemiT = smoothstep(-0.20, 0.20, seamField(spawnN.x, spawnN.y, spawnN.z));
  let gatePush = 0;   /* 1 the frame you are turned back at the seam, decaying */
  let crossedOnce = false;  /* the seam is only crossed for the first time once */
  const allCheckedIn = () => marks.length > 0 && marks.every(m => m.done);

  /* The healed fog IS the healed sky. Any other colour draws a band
     of weather across the bottom of a backdrop that has none in it —
     in the reference the teal runs all the way down to the ground
     line. What little density is left is depth cue for the far side
     of a small planet, nothing more. */
  const fogScorch = new THREE.Color(0xd8a276), fogHealed = new THREE.Color(C.skyHealed);
  const ambScorch = new THREE.Color(0xffe6cf), ambHealed = new THREE.Color(0xf2fbff);
  const hemiSkyS = new THREE.Color(0xf0c9a4), hemiSkyH = new THREE.Color(0xdff2ee);
  const hemiGndS = new THREE.Color(0xb08a72), hemiGndH = new THREE.Color(0xa8c08c);

  function step(dt, now) {
    /* CLAMP AT BOTH ENDS. A backgrounded tab must not fling the
       fellow into orbit, which is what the upper clamp is for — but
       the LOWER one matters just as much and was missing. Chrome
       hands requestAnimationFrame the time the FRAME began, which can
       be earlier than the performance.now() taken when the loop was
       armed, so the very first dt is often negative. Every smoothed
       value in the frame is of the form mix(v, target, 1 - exp(-k dt)),
       and a negative dt makes that blend factor negative, so the value
       does not ease toward its target, it is thrown AWAY from it.
       hemiT — which grades the sky, the fog, the ambient and the key
       — was landing near -2 on frame one and taking ten seconds of
       real time to crawl back. The visible symptom was a burning
       orange sky over the healed hemisphere at spawn, and it survived
       four rounds of looking straight at it. */
    dt = clamp(dt, 0, MAX_DT);

    _up.copy(you.position).normalize();
    you.up.copy(_up);

    /* ---- what the drag is asking for, in world space ---- */
    let wantLen = 0, wantRun = false;
    _want.set(0, 0, 0);
    cam.getWorldDirection(_camF);
    _camF.addScaledVector(_up, -_camF.dot(_up));
    if (_camF.lengthSq() < 1e-6) _camF.copy(camDir);
    _camF.normalize();
    _camR.crossVectors(_camF, _up).normalize();

    if (drag.on) {
      const len = Math.hypot(drag.dx, drag.dy);
      if (len > DRAG_DEAD) {
        /* screen up is forward along the camera's ground direction,
           screen right is the camera's right; the drag vector is
           just those two, projected onto the tangent plane under
           the fellow's feet */
        _want.copy(_camF).multiplyScalar(-drag.dy).addScaledVector(_camR, -drag.dx);
        wantLen = clamp((len - DRAG_DEAD) / (DRAG_MAX - DRAG_DEAD), 0, 1);
        wantRun = wantLen > DRAG_RUN;
      }
    }
    let kf = 0, kr = 0;
    if (keys.w || keys.arrowup) kf += 1;
    if (keys.s || keys.arrowdown) kf -= 1;
    if (keys.a || keys.arrowleft) kr -= 1;
    if (keys.d || keys.arrowright) kr += 1;
    if (kf || kr) {
      _want.addScaledVector(_camF, kf).addScaledVector(_camR, kr);
      wantLen = 1;
    }
    sprinting = wantRun || !!keys.shift;
    if (_want.lengthSq() > 1e-8) _want.addScaledVector(_up, -_want.dot(_up)).normalize();
    else wantLen = 0;

    /* ---- acceleration ramp: weight, not a light switch ----
       Asymmetric on purpose. One rate for both directions is what made
       him feel like a dragged object: a body has to overcome its own
       mass to start and has to bleed momentum to stop, and those are
       not the same number. Pulling away is deliberately the slower of
       the two so there is a beat of effort before he is up to speed,
       and the release still carries a little so he glides rather than
       stopping like a paused video. */
    const ACCEL = 6.2, DECEL = 9.5;
    prevSpeed = speedFactor;
    speedFactor = mix(speedFactor, wantLen, 1 - Math.exp(-(wantLen > speedFactor ? ACCEL : DECEL) * dt));
    if (speedFactor < 0.004) speedFactor = 0;
    /* the kick that absorbs a stop — a body arriving at rest keeps
       going a little and comes back, it does not become a statue */
    const dSpeed = (speedFactor - prevSpeed) / Math.max(dt, 1e-4);
    if (!reduced) settleVel += clamp(dSpeed, -40, 40) * dt * 0.9;
    runBlend = mix(runBlend, sprinting && speedFactor > 0.5 ? 1 : 0, 1 - Math.exp(-4.5 * dt));

    /* ---- jump and radial gravity ---- */
    if (jumpWanted && grounded && !reduced) { velocity.addScaledVector(_up, JUMP); grounded = false; }
    jumpWanted = false;

    const radial = velocity.dot(_up);
    _tmp.copy(velocity).addScaledVector(_up, -radial);
    velocity.copy(_tmp).addScaledVector(_up, radial - GRAVITY * dt);
    you.position.addScaledVector(velocity, dt);
    const floor = walkAt(_up);
    if (you.position.length() <= floor) {
      you.position.copy(_up).multiplyScalar(floor);
      const rs = velocity.dot(_up);
      if (rs < 0) velocity.addScaledVector(_up, -rs);
      grounded = true;
    } else if (grounded) {
      /* Being above the ground is only ever legal while a jump is in
         the air. Anything else — the first frames after mount, a
         long dt after a stall, a snap that landed a hair high — is
         drift, and it shows as the fellow standing on nothing. So
         the contract is: grounded means ON the ground, exactly. */
      you.position.copy(_up).multiplyScalar(floor);
      const rs = velocity.dot(_up);
      velocity.addScaledVector(_up, -rs);
    }

    /* ---- turn toward the wanted heading, incrementally ---- */
    you.getWorldDirection(_fwd);
    _fwdT.copy(_fwd).addScaledVector(_up, -_fwd.dot(_up));
    if (_fwdT.lengthSq() < 1e-8) _fwdT.copy(_camF);
    _fwdT.normalize();

    let turnNow = 0;
    if (speedFactor > 0.01 && wantLen > 0) {
      const cosA = clamp(_fwdT.dot(_want), -1, 1);
      const sinA = _axis.crossVectors(_fwdT, _want).dot(_up);
      const delta = Math.atan2(sinA, cosA);
      /* TURN RESPONSE. A flat clamp turns as hard at a sprint as it
         does at a shuffle, which is what makes a character feel like a
         cursor. Momentum should cost you agility, so the ceiling
         tightens as he opens up; and easing toward the target instead
         of running at the clamp gives the swing a start and a finish
         rather than a constant angular velocity. */
      const ceiling = TURN_RATE * (1 - 0.42 * runBlend) * dt;
      const eased = delta * (1 - Math.exp(-11 * dt));
      const turn = clamp(eased, -ceiling, ceiling);
      turnNow = turn / Math.max(dt, 1e-4);
      /* rotateOnAxis on the body's OWN up — never a fresh
         setFromUnitVectors, which cannot be continuous over a sphere */
      you.rotateOnAxis(LOCAL_UP, turn);
      you.getWorldDirection(_fwd);
      _fwdT.copy(_fwd).addScaledVector(_up, -_fwd.dot(_up)).normalize();
    }
    /* smoothed so a single frame of input does not snap the body over */
    turnSigned = mix(turnSigned, turnNow, 1 - Math.exp(-9 * dt));

    /* ---- walk: rotate position AND orientation by one quaternion,
       which parallel-transports the frame and keeps local +Y on the
       surface normal for free ---- */
    if (grounded && speedFactor > 0.01) {
      const speed = mix(WALK, RUN, runBlend) * speedFactor;
      _axis.crossVectors(_up, _fwdT);
      if (_axis.lengthSq() > 1e-10) {
        _axis.normalize();
        _q.setFromAxisAngle(_axis, (speed * dt) / R);
        you.position.applyQuaternion(_q);
        you.quaternion.premultiply(_q);
        camDir.applyQuaternion(_q);
        /* the painted cloud layer rides the local horizon */
        cloudShell.quaternion.premultiply(_q);
        started = true;
      }
      const nn = _tmp.copy(you.position).normalize();

      /* THE SEAM IS A WALL UNTIL 4/4.
         The Deep End is the reward, not the lobby. Walk at the gold
         line before the fourth check-in and the ground turns you
         back: the crossing component of the step is removed and you
         slide along the seam instead of stopping dead, so it reads
         as a barrier you are leaning on rather than a bug. */
      if (!allCheckedIn()) {
        const sf = seamField(nn.x, nn.y, nn.z);
        if (sf < SEAM_GATE) {
          nn.x += (SEAM_GATE - sf) * 1.02;
          nn.normalize();
          you.position.copy(nn).multiplyScalar(walkAt(nn));
          gatePush = 1;
        }
      }
      you.position.copy(nn).multiplyScalar(walkAt(nn));
    }
    gatePush *= Math.exp(-4.0 * dt);

    /* ---- the cycle: a gentle walk, a bouncy run ---- */
    walkPhase += mix(7.0, 11.6, runBlend) * speedFactor * dt;
    fellow.pose(walkPhase, speedFactor, runBlend, grounded, reduced ? 0 : now);

    /* ---- body attitude ----
       Everything here is cosmetic and rides a node UNDER the
       transported orientation, so it can never feed back into the
       spherical walk. Reduced motion gets none of it. */
    if (tiltNode && !reduced) {
      /* BANK INTO THE CORNER. Roll opposes the turn and scales with
         how fast he is actually travelling — leaning hard while
         standing still is a dance move, not locomotion. */
      const speedNorm = clamp(speedFactor * mix(0.55, 1, runBlend), 0, 1);
      const leanTarget = clamp(-turnSigned * 0.085, -0.34, 0.34) * speedNorm;
      leanRoll = mix(leanRoll, leanTarget, 1 - Math.exp(-7 * dt));

      /* PITCH. Forward into acceleration, back against the brake, and
         the settle spring bleeds through the same axis so arriving at
         rest reads as weight rather than a snap to zero. */
      settleVel -= settleVel * (1 - Math.exp(-6.5 * dt));
      const pitchTarget = clamp(speedFactor * mix(0.05, 0.13, runBlend) - settleVel * 0.05, -0.16, 0.2);
      bodyPitch = mix(bodyPitch, pitchTarget, 1 - Math.exp(-8 * dt));

      /* SLOPE. Sample the ground a stride ahead and behind along the
         travel direction; the difference is the grade he is on. Two
         cheap height lookups, no raycast. */
      _tmp.copy(you.position).addScaledVector(_fwdT, 1.5).normalize();
      const ahead = walkAt(_tmp);
      _tmp.copy(you.position).addScaledVector(_fwdT, -1.5).normalize();
      const behind = walkAt(_tmp);
      slopePitch = mix(slopePitch, clamp((behind - ahead) * 0.16, -0.22, 0.22), 1 - Math.exp(-5 * dt));

      tiltNode.rotation.set(bodyPitch + slopePitch, tiltNode.rotation.y, leanRoll);
    }

    /* ---- camera: trails behind, and swings round toward the front
       as he opens up into a run, the way a camera operator would ---- */
    _up.copy(you.position).normalize();
    /* A screenshot harness needs to stand somewhere the player is not
       — over a district, out at orbit — so the whole rig is skippable
       while _debug.freeCam holds it. Nothing else in the frame is. */
    if (!camHold) {
    camDir.addScaledVector(_up, -camDir.dot(_up));
    if (camDir.lengthSq() < 1e-8) camDir.copy(_fwdT);
    camDir.normalize().lerp(_fwdT, reduced ? 1 : 1 - Math.exp(-CAM_TURN * dt));
    camDir.addScaledVector(_up, -camDir.dot(_up)).normalize();

    const swingTarget = reduced ? 0 : runBlend * 1.95;
    camSwing = mix(camSwing, swingTarget, 1 - Math.exp(-1.7 * dt));
    _off.copy(camDir).applyAxisAngle(_up, camSwing);

    const gh = walkAt(_up);
    const dist = mix(CAM_DIST, CAM_DIST + 0.85, runBlend);   /* slight pullback under speed */
    const hgt = mix(CAM_HEIGHT, CAM_HEIGHT - 0.22, runBlend);
    _camPos.copy(_up).multiplyScalar(gh + hgt).addScaledVector(_off, -dist);
    /* THE SHOULDER. Push the boom sideways along the tangent that is
       perpendicular to the view direction, so the player sits off the
       centre line and the space ahead of him becomes the subject of
       the frame. It eases out under a run — at speed you want to see
       where you are going more than you want the composition. */
    _shoulder.crossVectors(_up, _off).normalize();
    _camPos.addScaledVector(_shoulder, CAM_SHOULDER * (1 - runBlend * 0.45));
    /* Never let a ridge swallow the camera. Walk the segment from
       his feet out to the camera, find the highest ground under it,
       and float the camera above that — a single test at the camera
       point lets a crest between the two cut the view. */
    let need = walkAt(_up) + 1.9;
    for (let i = 2; i <= 9; i++) {
      _tmp.copy(you.position).lerp(_camPos, i / 9).normalize();
      need = Math.max(need, walkAt(_tmp) + 2.3);
    }
    if (_camPos.length() < need) {
      _tmp.copy(_camPos).normalize();
      _camPos.copy(_tmp).multiplyScalar(need);
    }
    /* Landmarks are the only things here big enough to swallow the
       camera whole, and standing at one is exactly when the player
       is looking. Shortening the boom is the fix — the same thing a
       camera operator does when a wall gets behind them. Shoving the
       camera sideways out of the building instead moves it somewhere
       with no relation to the shot, and can leave it below the
       player looking up at his shoes. */
    let inside = false;
    for (const m of marks) {
      if (m.g.position.distanceToSquared(_camPos) < LANDMARK_CLEAR * LANDMARK_CLEAR) { inside = true; break; }
    }
    if (inside) {
      for (let s = 5; s >= 1; s--) {
        _camPos.copy(_up).multiplyScalar(gh + hgt).addScaledVector(_off, -dist * (s / 6))
               .addScaledVector(_shoulder, CAM_SHOULDER * (1 - runBlend * 0.45));
        let clear = true;
        for (const m of marks) {
          if (m.g.position.distanceToSquared(_camPos) < LANDMARK_CLEAR * LANDMARK_CLEAR) { clear = false; break; }
        }
        if (clear) break;
      }
      const nn = _tmp.copy(_camPos).normalize();
      const floorR = walkAt(nn) + 2.0;
      if (_camPos.length() < floorR) _camPos.copy(nn).multiplyScalar(floorR);
    }

    if (!camInit) { cam.position.copy(_camPos); camInit = true; }
    else cam.position.lerp(_camPos, reduced ? 1 : CAM_LERP);
    cam.up.copy(_up);
    /* AIM AHEAD, NOT AT HIM. Looking straight at the player centres him
       and throws the composition away; leading the aim along the
       direction of travel opens the frame in front of him and lets the
       shoulder offset actually read. The lead eases in with speed, so
       standing still is still a portrait of the player. */
    _aim.copy(you.position).addScaledVector(_up, EYE * 0.62)
        .addScaledVector(_off, CAM_LEAD * (0.5 + speedFactor))
        .addScaledVector(_shoulder, -CAM_SHOULDER * 0.55);
    cam.lookAt(_aim);
    const fovTarget = mix(CAM_FOV, CAM_FOV_RUN, runBlend);
    if (Math.abs(fovTarget - camFov) > 0.01) {
      camFov = mix(camFov, fovTarget, reduced ? 1 : 1 - Math.exp(-3 * dt));
      cam.fov = camFov; cam.updateProjectionMatrix();
    }
    }

    /* soft contact patch under him, the way the refs ground a
       character — a painted blob, not a hard shadow */
    contact.place(you.position, _up, speedFactor);

    /* ---- the grade follows the hemisphere you are standing in ---- */
    const sf = seamField(_up.x, _up.y, _up.z);
    /* THE CROSSING. The one frame his own footing goes over onto
       the scorched side with all four check-ins made. The title
       sequence itself lives in js/uprise-intro.js — this is only
       the trip wire, and it trips once. */
    if (!crossedOnce && sf < 0 && allCheckedIn()) {
      crossedOnce = true;
      if (opts.onCross) { try { opts.onCross(); } catch (e) { /* never stall the world for a cutscene */ } }
    }
    const target = smoothstep(-0.20, 0.20, sf);
    hemiT = mix(hemiT, target, 1 - Math.exp(-2.2 * dt));
    /* only enough haze to separate the far side of a small planet.
       The refs keep their distance saturated — fog is depth cue
       here, never atmosphere for its own sake. */
    /* the far sky catches fire as you come up on the gold line */
    if (burnSky) burnSky.material.opacity = smoothstep(0.88, 0.22, hemiT);
    scene.fog.color.copy(fogScorch).lerp(fogHealed, hemiT);
    scene.fog.density = mix(0.0050, 0.0008, hemiT);
    ambient.color.copy(ambScorch).lerp(ambHealed, hemiT);
    ambient.intensity = mix(0.56, 0.64, hemiT);
    hemi.color.copy(hemiSkyS).lerp(hemiSkyH, hemiT);
    hemi.groundColor.copy(hemiGndS).lerp(hemiGndH, hemiT);
    key.intensity = mix(0.80, 0.68, hemiT);
    fill.intensity = mix(0.16, 0.30, hemiT);
    renderer.toneMappingExposure = mix(0.98, 1.04, hemiT);

    /* the key light rides with the player so its shadow map spends
       every texel on ground that is actually on screen */
    key.position.copy(you.position).addScaledVector(SUN_DIR, 110);
    key.target.position.copy(you.position);
    key.target.updateMatrixWorld();

    lavaGlow.position.copy(_up).multiplyScalar(walkAt(_up) - 1.2);
    lavaGlow.intensity = (1 - hemiT) * 4.0;

    /* ---- living detail, all of it off under reduced motion ---- */
    if (!reduced) {
      embers.update(dt, now);
      ash.update(dt, now);
      doves.update(dt, now);
      build.pulse(now);
      /* the ring sits still — it is a mark on paper, not a hovering
         object, and a bobbing annotation would put the videogame back */
    }

    /* ---- check-ins ---- */
    const pn = _tmp.copy(you.position).normalize();
    for (const m of marks) {
      if (!m.done && m.n.angleTo(pn) * R < 8.5) {
        m.done = true;
        /* checked in: the mark is struck through rather than recoloured
           to a "done" green. An editor does not repaint a circle when
           the note is dealt with; the annotation stays and quiets. */
        m.ring.material.opacity = 0.26;
        if (opts.onCheckIn) opts.onCheckIn(m.data, marks.filter(x => x.done).length, marks.length);
      }
    }

    /* ---- the keepers ----
       After the check-ins on purpose. Walking up to a keeper trips
       the landmark first, so the document card is already the reason
       you looked up before the person speaks. */
    if (keepers) keepers.update(dt, now, you.position);
  }

  /* ---------- the loop ----------
     renderer.info resets itself on every render() call, and a frame
     here is a shadow pass plus two or three scene passes plus the
     post chain. Turn the auto-reset off and clear it once a frame,
     so the numbers reported are what the frame actually cost. */
  renderer.info.autoReset = false;
  let raf = 0, last = performance.now(), stopped = false;
  let frameTris = 0, frameCalls = 0, frameMs = 0;
  function loop(now) {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    const dt = clamp((now - last) / 1000, 0, MAX_DT);
    last = now;
    const t0 = performance.now();
    renderer.info.reset();
    step(dt, now);
    if (Q.post && composer) composer.render(dt);
    else drawWorld();
    frameTris = renderer.info.render.triangles;
    frameCalls = renderer.info.render.calls;
    frameMs = mix(frameMs, performance.now() - t0, 0.1);
  }
  raf = requestAnimationFrame(loop);

  function stats() {
    const m = renderer.info.memory;
    return {
      tier: Q.name, tierReason: picked.why, probeMs: +picked.probeMs.toFixed(2),
      triangles: frameTris, drawCalls: frameCalls, cpuFrameMs: +frameMs.toFixed(1),
      geometries: m.geometries,
      textures: m.textures, pixelRatio: renderer.getPixelRatio(),
      post: !!Q.post, brushPass: !!Q.brushPass, shadows: !!Q.shadows, shadowMap: Q.shadowMap,
      terrainDetail: Q.detail, textureBytes: textureBytes(Q),
    };
  }

  return {
    stop() {
      stopped = true; cancelAnimationFrame(raf);
      if (composer) composer.dispose();
      renderer.dispose();
    },
    get progress() { return { done: marks.filter(m => m.done).length, total: marks.length, moved: started }; },
    stats,
    /* the checkers will want to drive it without hands */
    _debug: {
      marks, cam, scene, renderer, quality: Q, groundAt, walkAt, terrainHeight, seamField, props, spawnN,
      get gateHeld() { return gatePush; }, SEAM_GATE, get locked() { return !allCheckedIn(); },
      keepers, get errand() { return keepers ? keepers.state : null; },
      teleport(n, heading) {
        const u = n.clone().normalize();
        you.position.copy(u).multiplyScalar(walkAt(u));
        orientToSurface(you, u);
        orientToSurface(cloudShell, u);
        if (typeof heading === "number") you.rotateOnAxis(LOCAL_UP, heading);
        you.getWorldDirection(camDir);
        camDir.addScaledVector(u, -camDir.dot(u)).normalize();
        camInit = false; camSwing = 0;
        velocity.set(0, 0, 0);
        hemiT = smoothstep(-0.20, 0.20, seamField(u.x, u.y, u.z));
      },
      pose(t, run) { walkPhase = t; runBlend = run || 0; fellow.pose(t, 1, run || 0, true, 0); },
      get player() { return you; },
      setBloom(v) { if (bloomPass) bloomPass.strength = v; },
      /* park the camera anywhere and look at anything — the harness
         uses it to photograph a district from outside itself */
      freeCam(pos, target, fov, up) {
        camHold = true;
        cam.position.set(pos[0], pos[1], pos[2]);
        cam.up.set(...(up || [0, 1, 0]));
        cam.lookAt(target[0], target[1], target[2]);
        if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      },
      releaseCam() { camHold = false; camInit = false; },
      get hemiT() { return hemiT; },
      get burnOpacity() { return burnSky ? burnSky.material.opacity : -1; },
      landmarkNormal, PADS,
    },
  };

}

/* ============================================================
   ORIENTATION
   The only absolute orientation in the file, used once per body at
   placement time and never again per frame. Props are static, and
   the player is spawned well away from either pole; after that his
   frame is carried by parallel transport.
   ============================================================ */
const _oUp = new THREE.Vector3(), _oRef = new THREE.Vector3(), _oR = new THREE.Vector3(), _oF = new THREE.Vector3();
const _oM = new THREE.Matrix4(), _oY = new THREE.Vector3(0, 1, 0);
function orientToSurface(obj, n, spin = 0) {
  _oUp.copy(n).normalize();
  _oRef.set(0, 1, 0);
  if (Math.abs(_oUp.y) > 0.985) _oRef.set(1, 0, 0);
  _oR.crossVectors(_oRef, _oUp).normalize();
  _oF.crossVectors(_oR, _oUp).normalize();
  _oM.makeBasis(_oR, _oUp, _oF);
  obj.quaternion.setFromRotationMatrix(_oM);
  if (spin) obj.rotateOnAxis(_oY, spin);
}

/* ============================================================
   BENDING A BLOCK ONTO THE PLANET
   The second half of the district fix. The land under a site is
   already a plateau (see PADS); this bends the SITE, so its streets
   follow the curve of the world instead of hanging off the end of
   it.

   Every vertex is carried into the site's own tangent frame — origin
   on the surface, +Y the outward normal — and its horizontal distance
   from the site centre is read as an ARC ALONG THE SURFACE rather
   than as a straight line across a plane. A point at the centre does
   not move at all. A point eleven units out drops by exactly the
   sagitta it was floating by. A street that runs off the footprint
   now runs OVER THE HORIZON, which is the small-planet read the
   reference frames are built on and the thing the flat slab denied.

   Instanced props cannot have their geometry bent, because every
   instance shares it — so each instance is MOVED to where the bend
   puts it and TILTED by the rotation the bend applies there. A lamp
   post is small enough that rigid is right. A four-hundred-foot road
   is not, and gets the per-vertex treatment.
   ============================================================ */
const _cbP = new THREE.Vector3(), _cbU = new THREE.Vector3();
const _cbM = new THREE.Matrix4(), _cbMi = new THREE.Matrix4(), _cbI = new THREE.Matrix4();
const _cbQ = new THREE.Quaternion(), _cbA = new THREE.Vector3();
const _cbT = new THREE.Vector3(), _cbS = new THREE.Vector3(), _cbR = new THREE.Quaternion();

/* the flat tangent point (x, y, z) as it lands on a sphere of radius
   r0 whose surface passes through the origin with +Y outward */
function bendPoint(v, r0) {
  const d = Math.hypot(v.x, v.z);
  if (d < 1e-9) return v;
  const th = d / r0, rr = r0 + v.y, k = (Math.sin(th) * rr) / d;
  v.set(v.x * k, Math.cos(th) * rr - r0, v.z * k);
  return v;
}
/* the rotation the bend applies at that point, for things that must
   stay rigid: swing local +Y round onto the new surface normal */
function bendTilt(p, r0, out) {
  const d = Math.hypot(p.x, p.z);
  if (d < 1e-9) return out.identity();
  _cbA.set(p.z / d, 0, -p.x / d);
  return out.setFromAxisAngle(_cbA, d / r0);
}

function conformToSphere(root, r0) {
  root.updateMatrixWorld(true);
  _cbI.copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh) return;
    /* the matrix that takes this mesh's own vertices into the frame
       standing on the surface under the site */
    _cbM.multiplyMatrices(_cbI, o.matrixWorld);
    _cbMi.copy(_cbM).invert();

    if (o.isInstancedMesh) {
      const arr = o.instanceMatrix.array;
      const M = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) {
        M.fromArray(arr, i * 16).premultiply(_cbM);
        M.decompose(_cbT, _cbR, _cbS);
        _cbU.copy(_cbT);
        bendPoint(_cbT, r0);
        bendTilt(_cbU, r0, _cbQ);
        _cbR.premultiply(_cbQ);
        M.compose(_cbT, _cbR, _cbS).premultiply(_cbMi);
        M.toArray(arr, i * 16);
      }
      o.instanceMatrix.needsUpdate = true;
      o.computeBoundingSphere();
      return;
    }

    /* always a clone: geometries get reused across meshes here, and
       bending one twice bends it twice */
    const g = o.geometry.clone();
    o.geometry = g;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      _cbP.fromBufferAttribute(pos, i).applyMatrix4(_cbM);
      bendPoint(_cbP, r0);
      _cbP.applyMatrix4(_cbMi);
      pos.setXYZ(i, _cbP.x, _cbP.y, _cbP.z);
    }
    pos.needsUpdate = true;
    /* the ink is drawn by pushing the hull down the vertex normal, so
       a bent hull with its old normals inks its old shape */
    g.computeVertexNormals();
    g.computeBoundingSphere();
  });
}

/* ============================================================
   PLANET GEOMETRY
   IcosahedronGeometry, never SphereGeometry — the poles pinch and
   every prop placed near them shears. PolyhedronGeometry is
   non-indexed, so painting all three corners of a triangle the
   same colour gives a genuinely flat facet instead of a gradient
   smeared across it.
   ============================================================ */
function buildPlanet(Q, toon, flat) {
  const geo = new THREE.IcosahedronGeometry(R, Q.detail);
  const pos = geo.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);

  const ash = new THREE.Color(C.ash), ashLit = new THREE.Color(C.ashLit);
  const ashGrey = new THREE.Color(C.ashGrey), emberRed = new THREE.Color(C.emberRed);
  const charred = new THREE.Color(C.charred), charDark = new THREE.Color(C.charDark);
  const burnt = new THREE.Color(C.burnt), cinder = new THREE.Color(C.cinder);
  const fissureC = new THREE.Color(C.fissure), lavaHot = new THREE.Color(C.lavaHot);
  const sage = new THREE.Color(C.sage), sageLit = new THREE.Color(C.sageLit);
  const leafDark = new THREE.Color(C.leafDark);
  const grass = new THREE.Color(C.grass), grassLit = new THREE.Color(C.grassLit);
  /* four flat greens, snapped to, never blended between */
  const GREENS = [0x5d8a3c, 0x6d9b45, 0x7fae52, 0x8fbc63, 0x9cc46e].map(h => new THREE.Color(h));
  const bone = new THREE.Color(0xe4ddc9);   /* a worn footpath */
  const soil = new THREE.Color(C.soil), sand = new THREE.Color(C.sand);
  const cliff = new THREE.Color(C.cliff), stone = new THREE.Color(C.stone);
  const gold = new THREE.Color(C.gold), goldHot = new THREE.Color(C.goldHot);
  const padTone = new THREE.Color(0x86a86a);   /* the district's own apron green */
  const c = new THREE.Color(), c2 = new THREE.Color();
  const a = new THREE.Vector3(), mid = new THREE.Vector3();

  const lavaTri = [], waterTri = [], fissTri = [], seamTri = [], fissCol = [];

  /* displace every vertex first */
  const dir = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(pos, i).normalize();
    dir[i * 3] = a.x; dir[i * 3 + 1] = a.y; dir[i * 3 + 2] = a.z;
    const h = terrainHeight(a.x, a.y, a.z);
    pos.setXYZ(i, a.x * (R + h), a.y * (R + h), a.z * (R + h));
  }

  /* then colour per FACE, from the centroid */
  for (let f = 0; f < n; f += 3) {
    mid.set(0, 0, 0);
    for (let k = 0; k < 3; k++) mid.add(a.set(dir[(f + k) * 3], dir[(f + k) * 3 + 1], dir[(f + k) * 3 + 2]));
    mid.normalize();
    const x = mid.x, y = mid.y, z = mid.z;
    const h = terrainHeight(x, y, z);
    const sf = seamField(x, y, z);
    const healed = smoothstep(-0.055, 0.055, sf);
    const slope = slopeAt(x, y, z);
    const crack = crackField(x, y, z);
    /* Two scales of mottle. The wide one is the burn scar — whole
       regions that took the fire and whole regions that did not,
       which is what stops the hemisphere reading as one beige
       sheet. The tight one is the painterly patchiness the
       reference ground carries everywhere. */
    const scar = fbm(x * 2.3 - 12, y * 2.3 + 6, z * 2.3, 3) * 0.5 + 0.5;
    const patch = fbm(x * 7.4 + 40, y * 7.4, z * 7.4 - 17, 3) * 0.5 + 0.5;

    /* --- The burnt hemisphere. Ash grey, charred brown, burnt
       orange, ember red — the cover's palette, laid in as broad
       flat regions so the ground is composed rather than mottled.
       Nothing here goes anywhere near black: what says "destroyed"
       is the shapes and the cracks, not the darkness. --- */
    c.copy(ashGrey).lerp(ashLit, smoothstep(-1.5, 3.5, h) * 0.55);
    /* grey ash drifts in the hollows, warm scorched ground on the rises */
    c.lerp(ash, smoothstep(0.70, 0.34, scar));
    c.lerp(charred, smoothstep(0.40, 0.66, scar));
    c.lerp(charDark, smoothstep(0.66, 0.90, scar) * 0.9);
    /* burnt orange scorch, keyed off the tighter field so it lands
       in patches across the char rather than following it exactly */
    c.lerp(burnt, smoothstep(0.58, 0.80, patch) * smoothstep(0.42, 0.68, scar) * 0.85);
    c.lerp(emberRed, smoothstep(0.80, 0.96, patch) * smoothstep(0.55, 0.80, scar) * 0.6);
    c.lerp(stone, smoothstep(0.45, 1.05, slope) * 0.65);
    /* the fissure network burns through whatever is laid on top */
    c.lerp(charDark, smoothstep(0.02, 0.30, crack) * 0.9);
    c.lerp(fissureC, smoothstep(0.34, 0.80, crack) * 0.9);
    c.lerp(lavaHot, smoothstep(0.78, 1.0, crack) * 0.8);

    /* --- THE HEALED HEMISPHERE ---
       It used to be four greens lerped into each other by three
       smooth fields, and a continuum of greens is an airbrush: the
       whole side came out as one pale sage blob with no shapes in it
       at all. Drawn country is FLAT PATCHES with edges between them.
       So the base green is QUANTISED to four steps — the mixing
       happens before the snap, never after — and then the things that
       are supposed to be lines are drawn ON TOP as lines: the field
       edges dark, the footpaths bone, the scuffed earth at their
       shoulders. --- */
    const lush = clamp(smoothstep(-2.4, 2.8, h) * 0.42 + patch * 0.40
      + fbm(x * 13.5 + 7, y * 13.5, z * 13.5 - 3, 2) * 0.34 + 0.10, 0, 0.999);
    c2.copy(GREENS[(lush * GREENS.length) | 0]);
    /* one darker band where a whole region turns away, still flat */
    if (scar > 0.70) c2.lerp(leafDark, 0.34);
    /* the hedges and tree lines between the fields */
    c2.lerp(leafDark, hedgeField(x, y, z) * 0.9);
    /* bare rock and soil where it is too steep to hold grass */
    c2.lerp(cliff, smoothstep(0.42, 0.95, slope));
    c2.lerp(soil, smoothstep(0.70, 1.20, slope) * 0.55);
    /* the paths, and the scuffed earth at their shoulders */
    const pth = pathField(x, y, z);
    if (pth > 0.01 && slope < 0.85) {
      c2.lerp(soil, smoothstep(0.02, 0.42, pth) * 0.80);
      c2.lerp(bone, smoothstep(0.40, 0.90, pth) * 0.92);
    }
    c2.lerp(sand, smoothstep(0.9, 0.15, Math.abs(h - TERRAIN.sea)) * 0.85);

    c.lerp(c2, healed);

    /* A district does not begin at its fence. The ground for a good
       way out of one is the mown, walked, slightly drier green of a
       place people arrive at, so the apron the block wears has
       something to meet — otherwise the collar is a green ring on a
       differently green hill and the join shows anyway. */
    if (PADS.length) {
      const pd = padAt(x, y, z);
      if (pd) c.lerp(padTone, smoothstep(0.02, 0.62, pd.w) * 0.72);
    }

    /* the seam: gold, hottest right on the line */
    const onSeam = Math.exp(-Math.pow(sf / 0.048, 2));
    if (onSeam > 0.02) {
      c.lerp(gold, onSeam * 0.96);
      c.lerp(goldHot, Math.exp(-Math.pow(sf / 0.013, 2)) * 0.85);
    }

    /* A last per-facet nudge. Even a hand-painted flat plane is
       never one exact value all the way across, and without this
       the ground reads as vinyl. Hashed off the face index, so the
       planet is the same picture on every device. */
    const j = 1 + ((((f * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.09;
    c.multiplyScalar(j);

    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = c.r; colors[(f + k) * 3 + 1] = c.g; colors[(f + k) * 3 + 2] = c.b;
    }

    if (healed < 0.5 && h < TERRAIN.lava && onSeam < 0.25) lavaTri.push(f);
    if (healed >= 0.5 && h < TERRAIN.sea && onSeam < 0.25) waterTri.push(f);
    if (healed < 0.5 && crack > 0.30 && onSeam < 0.3) { fissTri.push(f); fissCol.push(smoothstep(0.30, 0.99, crack)); }
    if (onSeam > 0.72) seamTri.push(f);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const crust = new THREE.Mesh(geo, toon({ vertexColors: true, outline: 1.5 }));
  crust.receiveShadow = !!Q.shadows;
  crust.castShadow = !!Q.terrainShadows;
  crust.name = "crust";

  function shell(list, radius, colorFn) {
    if (!list.length) return null;
    const p = new Float32Array(list.length * 9);
    const col = colorFn ? new Float32Array(list.length * 9) : null;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      for (let k = 0; k < 3; k++) {
        const j = (f + k) * 3;
        const rr = typeof radius === "function" ? radius(dir[j], dir[j + 1], dir[j + 2]) : radius;
        p[i * 9 + k * 3] = dir[j] * rr;
        p[i * 9 + k * 3 + 1] = dir[j + 1] * rr;
        p[i * 9 + k * 3 + 2] = dir[j + 2] * rr;
        if (col) {
          const cc = colorFn(i);
          col[i * 9 + k * 3] = cc.r; col[i * 9 + k * 3 + 1] = cc.g; col[i * 9 + k * 3 + 2] = cc.b;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /* lava fills the crater floors and canyon bottoms: a flat orange
     shape with an ink edge, exactly as it would be painted */
  const lavaGeo = shell(lavaTri, R + TERRAIN.lava);
  const lavaMat = flat({ color: C.lava, fog: true, outline: 1.4 });
  const lavaPools = lavaGeo ? new THREE.Mesh(lavaGeo, lavaMat) : new THREE.Group();

  const fissureBase = new THREE.Color(0xb03a12), fissureHot = new THREE.Color(0xff9236);
  const fc = new THREE.Color();
  const fissGeo = shell(fissTri, (x, y, z) => R + terrainHeight(x, y, z) + 0.10,
    (i) => { fc.copy(fissureBase).lerp(fissureHot, Math.pow(fissCol[i], 1.9)); return fc; });
  const fissures = fissGeo
    ? new THREE.Mesh(fissGeo, flat({ vertexColors: true, fog: true, outline: false }))
    : new THREE.Group();

  const waterGeo = shell(waterTri, R + TERRAIN.sea);
  const water = waterGeo
    ? new THREE.Mesh(waterGeo, toon({ color: C.water, transparent: true, opacity: 0.9, outline: 1.2 }))
    : new THREE.Group();
  if (waterGeo) water.receiveShadow = !!Q.shadows;

  const seamGeo = shell(seamTri, (x, y, z) => R + terrainHeight(x, y, z) + 0.09);
  const seamRibbon = seamGeo
    ? new THREE.Mesh(seamGeo, flat({ color: C.gold, fog: true, outline: 1.0 }))
    : new THREE.Group();

  const baseLava = new THREE.Color(C.lava);
  const pulseC = new THREE.Color();
  function pulse(now) {
    const k = 0.5 + 0.5 * Math.sin(now * 0.0011);
    pulseC.copy(baseLava).lerp(fissureHot, k * 0.3);
    lavaMat.color.copy(pulseC);
  }

  return { crust, lavaPools, fissures, water, seamRibbon, pulse };
}

/* ============================================================
   SKY
   Genuinely a PAINTED backdrop. The reference frames do not have a
   shader gradient behind them; they have flat teal with loose
   white strokes laid over it, and the strokes have ends and edges
   the way a brush leaves them. So this paints one: an equirect
   canvas, base colour written per texel from the real direction
   vector (so the seam in the sky lines up with the seam on the
   ground), then actual curved strokes drawn with the 2D API.
   No file ships; the texture is made at load.
   ============================================================ */
function paintSky(size, scorched) {
  const W = size, H = size / 2;
  const cvs = document.createElement("canvas");
  cvs.width = W; cvs.height = H;
  const g = cvs.getContext("2d");
  const img = g.createImageData(W, H);
  const d = img.data;
  const healedLo = new THREE.Color(C.skyHealed), healedHi = new THREE.Color(C.skyHealedHi);
  const scorchLo = new THREE.Color(C.skyScorch), scorchHi = new THREE.Color(C.skyScorchHi);
  const c = new THREE.Color(), c2 = new THREE.Color();

  /* three's SphereGeometry maps u around +Y and v from the top
     down; reproduce that exactly so the painted seam sits over the
     real one rather than a quarter turn away from it */
  const dirOf = (u, v, out) => {
    const theta = u * Math.PI * 2, phi = v * Math.PI;
    out.set(-Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
    return out;
  };
  /* Both the base and the strokes are written per texel from the
     DIRECTION, never from canvas coordinates. Strokes painted in UV
     space look right on the flat canvas and then fan into vertical
     stripes around the pole, because equirect meridians converge
     there. Direction space has no pole to converge at. */
  const dv = new THREE.Vector3();
  const cloud = new THREE.Color(C.cloud), cloudSmoke = new THREE.Color(C.cloudSmoke);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      dirOf((x + 0.5) / W, v, dv);
      /* A PAINTED BACKDROP, NOT A RAMP.
         The reference sky is flat colour. It has a value change up
         near the zenith and it has brush strokes on it, and that is
         all — the moment it becomes a smooth vertical gradient it
         reads as a cheap sunset shader, which is what this was. So
         the vertical is QUANTISED into two flat steps, and the edge
         between them is pushed about by a little noise so it is a
         painted line rather than a ruled one. */
      const wob = 0.075 * fbm(dv.x * 2.6 + 9, dv.y * 2.6, dv.z * 2.6 - 4, 3);
      const b = dv.y + wob;
      const step = b > 0.40 ? 1 : (b > 0.06 ? 0.48 : 0);
      /* And the hemispheres meet at an EDGE. A 0.32-wide wash let the
         scorch orange bleed a third of the way round the world, so
         the player standing well inside the healed side had a sunset
         burning across his horizon. */
      const healed = smoothstep(-0.03, 0.03, seamField(dv.x, dv.y, dv.z));
      let alpha = 255;
      if (scorched) {
        c.copy(scorchLo).lerp(scorchHi, step);
        alpha = (1 - healed) * 255;
      } else {
        c.copy(healedLo).lerp(healedHi, step * 0.70);
      }

      const i = (y * W + x) * 4;
      d[i] = c.r * 255; d[i + 1] = c.g * 255; d[i + 2] = c.b * 255; d[i + 3] = alpha;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/* THE CLOUD LAYER, painted with real strokes.
   It lives on its own shell for one reason: cloud streaks in the
   reference frames run parallel to the HORIZON, and on a walkable
   planet the horizon is wherever you are standing. A world-locked
   sky puts its bands at whatever tilt your latitude happens to
   give, which reads as a smear filter rather than a painted sky.
   So the colour shell stays world-locked (its seam has to sit over
   the real one), and this one is carried around by the player's own
   frame, by the same parallel transport that moves his body.

   The strokes are drawn with the 2D API, and their length in u is
   divided by sin(phi) so a stroke covers the same ANGLE near the
   zenith as it does near the horizon — otherwise equirect fans them
   into a starburst overhead. */
function paintClouds(size) {
  const W = size, H = size / 2;
  const cvs = document.createElement("canvas");
  cvs.width = W; cvs.height = H;
  const g = cvs.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.lineCap = "round";
  const rnd = rng(31337);
  /* Torn fragments first, under the streaks: the little floating
     chips with ragged closed edges that are all over the reference
     sky and are most of what says "painted" about it. */
  for (let i = 0; i < Math.round(size * 0.16); i++) {
    const v = 0.06 + rnd() * 0.46;
    const phi = v * Math.PI;
    const stretch = 1 / Math.max(0.28, Math.sin(phi));
    const cx = rnd() * W, cy = v * H;
    const rw = H * (0.012 + rnd() * 0.045) * stretch, rh = H * (0.006 + rnd() * 0.020);
    const n = 5 + ((rnd() * 4) | 0);
    g.fillStyle = "rgba(255,255,255," + (0.42 + rnd() * 0.45).toFixed(3) + ")";
    for (const dx of [0, -W]) {
      g.beginPath();
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const j = 0.55 + rnd() * 0.75;         /* the tear */
        const px = cx + dx + Math.cos(a) * rw * j, py = cy + Math.sin(a) * rh * j;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
    }
  }
  for (let i = 0; i < Math.round(size * 0.42); i++) {
    /* v = 0 is straight up; keep out of the last few degrees of the
       zenith, where nothing drawn in u can behave */
    const v = 0.10 + rnd() * 0.40;
    const phi = v * Math.PI;
    const stretch = 1 / Math.max(0.28, Math.sin(phi));
    const y = v * H;
    const x = rnd() * W;
    const len = W * (0.035 + rnd() * 0.13) * stretch;
    const lift = (rnd() - 0.5) * H * 0.035;
    const fade = smoothstep(0.54, 0.42, v);        /* thinner toward the horizon */
    /* three overlapping passes: a soft wide body, a firmer core, a
       bright highlight. Roughly how a loaded brush lands. The first
       cut of this was so faint you could not point at a single cloud
       in a 1280x800 frame, which is not a painted sky, it is a haze. */
    for (const [wf, af] of [[1.0, 0.34], [0.58, 0.55], [0.26, 0.92]]) {
      g.strokeStyle = "rgba(255,255,255," + (af * fade).toFixed(3) + ")";
      g.lineWidth = Math.max(2.5, H * 0.062 * wf * (0.55 + rnd() * 0.9));
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len * 0.5, y + lift, x + len, y + lift * 0.35);
      g.stroke();
      /* draw it again a wrap over, so the seam in u never shows */
      g.beginPath();
      g.moveTo(x - W, y);
      g.quadraticCurveTo(x - W + len * 0.5, y + lift, x - W + len, y + lift * 0.35);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function buildSky(size) {
  /* A backdrop carries no props and is never walked on, so the pole
     pinch that rules SphereGeometry out for the planet is exactly
     the seam a texture wants here.

     TWO SHELLS, NOT ONE. The sky is painted from the DIRECTION out of
     the world's centre, and on a planet this small the ring of
     directions along your own horizon is very nearly a great circle —
     which means it crosses the seam wherever you stand. Paint both
     hemispheres into one shell and a player deep inside the healed
     side gets the burning half's sky laid across the bottom of his
     view as a band of sunset orange, in a world whose reference is
     flat teal down to the ground line.

     So the teal is the backdrop, always, and the burn is a second
     shell over it, masked to its own hemisphere and faded in by how
     close to the seam you are standing. Walk toward the gold line and
     the far sky catches fire ahead of you; stand in the green and the
     sky is the green world's sky. */
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.SphereGeometry(820, 64, 32),
    new THREE.MeshBasicMaterial({ map: paintSky(size, false), side: THREE.BackSide, fog: false, depthWrite: false }));
  base.material.userData.outlineParameters = { visible: false };
  base.renderOrder = -10; base.frustumCulled = false; base.name = "sky";

  const burn = new THREE.Mesh(
    new THREE.SphereGeometry(810, 64, 32),
    new THREE.MeshBasicMaterial({
      map: paintSky(size, true), side: THREE.BackSide, fog: false,
      transparent: true, depthWrite: false, opacity: 0,
    }));
  burn.material.userData.outlineParameters = { visible: false };
  burn.renderOrder = -9.5; burn.frustumCulled = false; burn.name = "sky-burn";
  group.userData.burn = burn;

  const cloudShell = new THREE.Mesh(
    new THREE.SphereGeometry(760, 48, 24),
    new THREE.MeshBasicMaterial({
      map: paintClouds(size * 2), side: THREE.BackSide, fog: false,
      transparent: true, depthWrite: false, opacity: 0.85,
    }));
  cloudShell.material.userData.outlineParameters = { visible: false };
  cloudShell.renderOrder = -9; cloudShell.frustumCulled = false; cloudShell.name = "clouds";

  group.add(base);
  group.add(burn);
  group.add(cloudShell);
  group.userData.clouds = cloudShell;
  return group;
}

function buildStars(count) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  let seed = 5150;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let made = 0, guard = 0;
  while (made < count && guard++ < count * 30) {
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() < 1e-6) continue;
    v.normalize();
    /* only over the burnt half, where the sky is dark enough to hold them */
    if (seamField(v.x, v.y, v.z) > -0.25) continue;
    if (v.y < 0.05) continue;
    v.multiplyScalar(700 + rnd() * 80);
    p[made * 3] = v.x; p[made * 3 + 1] = v.y; p[made * 3 + 2] = v.z;
    made++;
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setDrawRange(0, made);
  const m = new THREE.PointsMaterial({
    color: 0xfdf6e6, size: 2.6, sizeAttenuation: true, fog: false,
    transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false,
  });
  m.userData.outlineParameters = { visible: false };
  const pts = new THREE.Points(g, m);
  pts.renderOrder = -9;
  pts.frustumCulled = false;
  return pts;
}

/* A shell of air, warm over the burn and cool over the green, so
   the thing reads as a globe with weather on it rather than a
   painted ball. It sits well outside the cloud deck: an additive
   shell close to the surface is a shell the camera stands INSIDE,
   and it washes the whole frame white. */
function buildAtmosphere() {
  const g = new THREE.IcosahedronGeometry(R * 1.62, 5);
  const pos = g.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  const warm = new THREE.Color(0xffb478), cool = new THREE.Color(0xb6ece6);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    c.copy(warm).lerp(cool, smoothstep(-0.22, 0.22, seamField(v.x, v.y, v.z)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, transparent: true, opacity: 0.07,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  m.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -8;
  return mesh;
}

/* ============================================================
   GEOMETRY KIT
   Small helpers: a deterministic RNG, a scatter that respects the
   terrain, a merge that bakes colour into vertices so a whole
   prop is one instanced draw, and a normal roughener that makes
   the ink line wobble instead of sitting perfectly even.
   ============================================================ */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/* A uniform sprinkle reads as a uniform sprinkle. Real ground has
   groves and clearings, so the scatters are gated on a low-frequency
   field: props bunch where it is high and leave holes where it is
   not, which looks far denser than the same count spread evenly. */
function clump(x, y, z, freq, bias) {
  return smoothstep(-0.02, 0.15, fbm(x * freq + bias, y * freq - bias, z * freq + bias * 0.5, 3));
}

/* A Fibonacci spiral walks monotonically from one pole to the
   other, so stopping it the moment `count` points have been
   accepted fills a CAP and leaves the rest of the world bare —
   which is exactly what it did here, and why the ground looked
   empty however high the counts went. So: walk the WHOLE spiral
   first, keep every point that passes, and only then thin the
   survivors down to `count`, uniformly at random. */
function scatter(count, test, seed) {
  const rnd = rng(seed);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const probe = Math.min(220000, Math.max(count * 6, 4000));
  const v = new THREE.Vector3();
  const hits = [];
  for (let i = 0; i < probe; i++) {
    const yy = 1 - (i / (probe - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = golden * i;
    v.set(Math.cos(th) * rad, yy, Math.sin(th) * rad);
    /* jitter, so the spiral never shows AS a spiral */
    v.x += (rnd() - 0.5) * 0.05; v.y += (rnd() - 0.5) * 0.05; v.z += (rnd() - 0.5) * 0.05;
    v.normalize();
    if (test(v.x, v.y, v.z, rnd)) hits.push(v.clone());
  }
  if (hits.length <= count) return hits;
  /* partial Fisher-Yates: shuffle only the first `count` slots */
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rnd() * (hits.length - i));
    const t = hits[i]; hits[i] = hits[j]; hits[j] = t;
  }
  hits.length = count;
  return hits;
}

const _iO = new THREE.Object3D();
function placeInstances(mesh, points, sizeFn, seed, lift = 0) {
  const rnd = rng(seed);
  for (let i = 0; i < points.length; i++) {
    const n = points[i];
    _iO.position.copy(n).multiplyScalar(groundAt(n) + lift);
    orientToSurface(_iO, n, rnd() * Math.PI * 2);
    /* a little lean, so nothing stands to attention */
    _iO.rotateOnAxis(new THREE.Vector3(1, 0, 0), (rnd() - 0.5) * 0.12);
    _iO.rotateOnAxis(new THREE.Vector3(0, 0, 1), (rnd() - 0.5) * 0.12);
    const s = sizeFn(rnd, n);
    _iO.scale.set(s.x, s.y, s.z);
    _iO.updateMatrix();
    mesh.setMatrixAt(i, _iO.matrix);
  }
  mesh.count = points.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;   /* the instances ring a planet; one bounding sphere means nothing */
  return mesh;
}

/* the ink line is drawn by pushing the hull along the vertex
   normal. Nudge the normals and the line thickens and thins along
   its length, which is what a brush does and a vector does not. */
function roughenNormals(geo, amount) {
  const nr = geo.attributes.normal;
  if (!nr) return geo;
  const rnd = rng(4242);
  const v = new THREE.Vector3();
  for (let i = 0; i < nr.count; i += 3) {
    const k = 1 + (rnd() - 0.5) * amount;
    for (let j = 0; j < 3; j++) {
      v.fromBufferAttribute(nr, i + j).multiplyScalar(k);
      nr.setXYZ(i + j, v.x, v.y, v.z);
    }
  }
  nr.needsUpdate = true;
  return geo;
}

function mergeParts(parts) {
  let total = 0;
  const prepared = parts.map(p => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  prepared.forEach((g, gi) => {
    const c = new THREE.Color(parts[gi].color === undefined ? 0xffffff : parts[gi].color);
    const gp = g.attributes.position.array, gn = g.attributes.normal.array;
    for (let i = 0; i < g.attributes.position.count; i++) {
      pos[(o + i) * 3] = gp[i * 3]; pos[(o + i) * 3 + 1] = gp[i * 3 + 1]; pos[(o + i) * 3 + 2] = gp[i * 3 + 2];
      nor[(o + i) * 3] = gn[i * 3]; nor[(o + i) * 3 + 1] = gn[i * 3 + 1]; nor[(o + i) * 3 + 2] = gn[i * 3 + 2];
      col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b;
    }
    o += g.attributes.position.count;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function m4(x, y, z, rx, ry, rz, sx, sy, sz) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x || 0, y || 0, z || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
    new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
}

/* ---------- the prop kit ---------- */
/* Burnt trees read as stark inked silhouettes in the cover art, so
   they are drawn dark against the ash ground and given a lot of
   thin crooked branching — the ink does most of the work and the
   fill is nearly one value. */
/* The burnt side gets the same treatment: one repeated skeleton is
   as much wallpaper as one repeated blob. Three silhouettes — the
   standing skeleton, the snapped-off stump with its top hanging, and
   the leaning burnt conifer whose skirts have gone. */
function deadSnapGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.CylinderGeometry(0.22, 0.34, 2.1, 6), matrix: m4(0, 1.05, 0, 0, 0, 0.04), color: C.charBurn },
    /* the top, snapped and hung up on its own stump */
    { geo: new THREE.CylinderGeometry(0.07, 0.2, 3.4, 5), matrix: m4(1.1, 1.6, 0.25, 0, 0, -1.18), color: C.charSoot },
    { geo: new THREE.CylinderGeometry(0.04, 0.1, 1.5, 4), matrix: m4(2.1, 1.15, 0.5, 0.5, 0, -1.5), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.05, 0.09, 1.1, 4), matrix: m4(-0.4, 1.9, -0.2, 0.6, 0, 0.9), color: C.charBurn },
  ]), 0.5);
}
function deadConiferGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.CylinderGeometry(0.06, 0.26, 6.2, 6), matrix: m4(0, 3.1, 0, 0, 0, 0.11), color: C.charSoot },
    { geo: new THREE.CylinderGeometry(0.03, 0.08, 1.5, 4), matrix: m4(0.55, 2.2, 0.1, 0, 0, -1.28), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.03, 0.075, 1.4, 4), matrix: m4(-0.48, 3.0, -0.15, 0.2, 0, 1.24), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.025, 0.065, 1.2, 4), matrix: m4(0.46, 3.9, 0.2, 0, 0, -1.2), color: C.charSoot },
    { geo: new THREE.CylinderGeometry(0.025, 0.06, 1.1, 4), matrix: m4(-0.4, 4.7, -0.18, 0.3, 0, 1.18), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.02, 0.05, 0.9, 4), matrix: m4(0.3, 5.5, 0.1, 0, 0, -1.15), color: C.charSoot },
  ]), 0.5);
}
function deadTreeGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.CylinderGeometry(0.08, 0.30, 4.4, 6), matrix: m4(0, 2.2, 0, 0, 0, 0.06), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.05, 0.13, 2.3, 5), matrix: m4(0.58, 3.6, 0.1, 0, 0, -0.86), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.045, 0.12, 2.0, 5), matrix: m4(-0.52, 3.2, -0.22, 0.26, 0, 0.8), color: C.charSoot },
    { geo: new THREE.CylinderGeometry(0.035, 0.09, 1.6, 5), matrix: m4(0.2, 4.3, 0.5, -0.66, 0, -0.3), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.03, 0.075, 1.3, 5), matrix: m4(-0.24, 4.5, -0.46, 0.68, 0, 0.24), color: C.charSoot },
    { geo: new THREE.CylinderGeometry(0.025, 0.055, 1.0, 4), matrix: m4(0.86, 4.3, -0.28, 0.32, 0, -1.1), color: C.charBurn },
    { geo: new THREE.CylinderGeometry(0.02, 0.045, 0.9, 4), matrix: m4(-0.78, 4.1, 0.4, -0.4, 0, 1.1), color: C.charSoot },
    { geo: new THREE.CylinderGeometry(0.02, 0.04, 0.8, 4), matrix: m4(0.15, 5.1, -0.1, 0.9, 0, 0.15), color: C.charBurn },
  ]), 0.5);
}

/* ------------------------------------------------------------------
   TREES

   They used to be one hexagonal icosahedron on a stick, and they read
   as green rocks, which is what the owner called them. Two things
   were wrong and only one of them was the shape.

   THE SHAPE. A drawn tree is a TRUNK that you can see, a couple of
   BRANCHES breaking the outline, and two to four canopy masses that
   overlap into one silhouette with steps in it. One blob has no
   silhouette to speak of and nothing for the ink to catch on. So
   every species below is built from masses, and there are five of
   them, because a hillside of one repeated shape reads as wallpaper
   however good the shape is.

   THE INK. This is the bug that made them look like they had
   exploded. three's PolyhedronGeometry gives FLAT per-face normals at
   detail 0, and OutlineEffect draws the line by pushing the hull out
   along the vertex normal — so at every facet edge the three copies
   of that corner fly apart in three different directions and the
   outline comes off the silhouette as black shards. A canopy needs a
   SMOOTH hull to be inked even though it is FLAT SHADED, which is not
   a contradiction: flat shading is computed per fragment from screen
   derivatives and does not read the normal attribute at all. So the
   blobs get their normals set to the direction from their own centre,
   which for a ball is exactly the smooth normal, and the ink comes
   out as one clean line round the outside.
   ------------------------------------------------------------------ */

/* the smooth hull an outline wants, on a shape the fill will still
   render as facets: normal = the direction out of the part's centre */
function hullNormals(geo) {
  const pos = geo.attributes.position;
  const n = geo.attributes.normal || new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
  const v = new THREE.Vector3();
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); }
  cx /= pos.count; cy /= pos.count; cz /= pos.count;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz);
    if (v.lengthSq() < 1e-9) v.set(0, 1, 0);
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  geo.setAttribute("normal", n);
  return geo;
}
/* a canopy mass: a ball with a smooth hull, ready to be merged */
function leafMass(r, mx, color) {
  return { geo: hullNormals(new THREE.IcosahedronGeometry(r, 1)), matrix: mx, color };
}
/* a limb: a tapered stick leaning out of the trunk */
function limb(r0, r1, len, mx, color) {
  return { geo: new THREE.CylinderGeometry(r0, r1, len, 5), matrix: mx, color };
}

/* 1. THE BROADLEAF. The default street and hedgerow tree: a visible
      tapered trunk, two limbs that break the outline on both sides,
      and four canopy masses stepped in three greens. */
function oakGeometry() {
  return roughenNormals(mergeParts([
    limb(0.16, 0.40, 3.5, m4(0, 1.75, 0, 0, 0, 0.03), C.bark),
    limb(0.07, 0.15, 1.9, m4(0.62, 3.15, 0.12, 0, 0, -0.78), C.bark),
    limb(0.06, 0.13, 1.6, m4(-0.55, 3.35, -0.2, 0.2, 0, 0.72), C.bark),
    leafMass(1.62, m4(-0.15, 4.7, 0.1, 0.3, 0.4, 0, 1.16, 0.88, 1.12), C.canopy),
    leafMass(1.18, m4(1.02, 4.05, 0.38, 0, 0.7, 0, 1, 0.86, 1), C.canopyLit),
    leafMass(1.06, m4(-1.02, 4.25, -0.58, 0.5, 0, 0.3), C.leafDark),
    leafMass(0.94, m4(0.18, 5.95, -0.22, 0, 0.3, 0.4, 1.05, 0.9, 1.05), C.canopyLit),
  ]), 0.16);
}

/* 2. THE CONIFER. Three stacked skirts on a bare lower trunk — the
      one silhouette on a hillside that is unmistakably not a blob. */
function spruceGeometry() {
  return roughenNormals(mergeParts([
    limb(0.10, 0.30, 5.6, m4(0, 2.8, 0), C.bark),
    { geo: new THREE.ConeGeometry(1.55, 2.5, 7), matrix: m4(0, 2.5, 0, 0, 0.3, 0.02), color: C.leafDark },
    { geo: new THREE.ConeGeometry(1.25, 2.3, 7), matrix: m4(0.05, 3.9, 0.04, 0, 0.9, -0.02), color: C.canopy },
    { geo: new THREE.ConeGeometry(0.92, 2.1, 7), matrix: m4(-0.04, 5.15, 0.02, 0, 1.6, 0.03), color: C.canopy },
    { geo: new THREE.ConeGeometry(0.55, 1.7, 6), matrix: m4(0.02, 6.3, -0.03, 0, 2.2, 0), color: C.canopyLit },
  ]), 0.14);
}

/* 3. THE POPLAR. Tall and narrow, for the field edges and the drives
      — it is the vertical in a landscape of round things. */
function poplarGeometry() {
  return roughenNormals(mergeParts([
    limb(0.10, 0.26, 5.2, m4(0, 2.6, 0, 0, 0, -0.02), C.bark),
    leafMass(1.05, m4(0, 4.6, 0, 0, 0.4, 0, 0.72, 2.05, 0.72), C.canopy),
    leafMass(0.72, m4(0.26, 6.6, 0.1, 0.2, 0, 0.1, 0.8, 1.5, 0.8), C.canopyLit),
    leafMass(0.6, m4(-0.24, 3.5, -0.12, 0, 0.8, 0, 0.9, 1.2, 0.9), C.leafDark),
  ]), 0.14);
}

/* 4. THE UMBRELLA. Short bole, wide low crown, the shape that puts a
      patch of shade on the ground under it. */
function umbrellaGeometry() {
  return roughenNormals(mergeParts([
    limb(0.22, 0.48, 2.1, m4(0, 1.05, 0, 0, 0, 0.06), C.bark),
    limb(0.08, 0.17, 1.9, m4(0.78, 2.0, 0.2, 0, 0, -1.05), C.bark),
    limb(0.07, 0.15, 1.7, m4(-0.7, 2.1, -0.3, 0.3, 0, 1.0), C.bark),
    leafMass(1.5, m4(0, 3.05, 0, 0.06, 0.3, 0, 1.5, 0.6, 1.45), C.canopy),
    leafMass(1.1, m4(1.25, 2.75, 0.3, 0, 0.7, 0.08, 1.3, 0.58, 1.2), C.leafDark),
    leafMass(1.05, m4(-1.15, 2.85, -0.42, 0, 1.3, -0.08, 1.25, 0.6, 1.2), C.canopyLit),
    leafMass(0.8, m4(0.1, 3.7, -0.35, 0, 0.2, 0.1, 1.2, 0.55, 1.1), C.canopyLit),
  ]), 0.14);
}

/* 5. THE SCRUB TREE. Half height, leaning, two masses — the young and
      the poor ground, so a grove is not all one age. */
function scrubTreeGeometry() {
  return roughenNormals(mergeParts([
    limb(0.10, 0.22, 2.2, m4(0, 1.1, 0, 0, 0, 0.14), C.bark),
    limb(0.05, 0.11, 1.2, m4(0.42, 2.0, 0.1, 0, 0, -0.9), C.bark),
    leafMass(1.02, m4(0.2, 2.9, 0.05, 0.2, 0.5, 0.1, 1.1, 0.82, 1.05), C.canopy),
    leafMass(0.74, m4(-0.62, 2.55, -0.3, 0, 1.1, 0.2), C.leafDark),
    leafMass(0.6, m4(0.55, 3.5, 0.28, 0.3, 0, -0.2), C.canopyLit),
  ]), 0.16);
}

const CANOPY_SPECIES = [oakGeometry, spruceGeometry, poplarGeometry, umbrellaGeometry, scrubTreeGeometry];

function bushGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.IcosahedronGeometry(0.74, 0), matrix: m4(0, 0.55, 0, 0.3, 0.4, 0, 1.2, 0.85, 1.1), color: C.canopy },
    { geo: new THREE.IcosahedronGeometry(0.54, 0), matrix: m4(0.6, 0.42, 0.24, 0, 0.8, 0.2), color: C.canopyLit },
    { geo: new THREE.IcosahedronGeometry(0.46, 0), matrix: m4(-0.5, 0.38, -0.3, 0.6, 0, 0.4), color: C.leafDark },
  ]), 0.5);
}

function rockGeometry(tone, tone2) {
  return roughenNormals(mergeParts([
    { geo: new THREE.IcosahedronGeometry(1, 0), matrix: m4(0, 0.45, 0, 0.3, 0.5, 0.2, 1.3, 0.78, 1.0), color: tone },
    { geo: new THREE.IcosahedronGeometry(0.55, 0), matrix: m4(0.8, 0.28, 0.3, 0.4, 0, 0.6), color: tone2 },
  ]), 0.55);
}

function rubbleGeometry(tone, tone2) {
  const parts = [];
  const rnd = rng(313);
  for (let i = 0; i < 5; i++) {
    const s = 0.22 + rnd() * 0.42;
    parts.push({
      geo: new THREE.IcosahedronGeometry(s, 0),
      matrix: m4((rnd() - 0.5) * 1.5, s * 0.7, (rnd() - 0.5) * 1.5, rnd() * 3, rnd() * 3, rnd() * 3,
        1, 0.6 + rnd() * 0.5, 1),
      color: i % 2 ? tone : tone2,
    });
  }
  return roughenNormals(mergeParts(parts), 0.6);
}

/* debris: the overturned, snapped, bent things that say a place
   was hit rather than just eroded */
function debrisGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.BoxGeometry(1.5, 0.14, 0.9), matrix: m4(0, 0.3, 0, 0.15, 0.5, 0.42), color: C.timber },
    { geo: new THREE.BoxGeometry(1.1, 0.12, 0.7), matrix: m4(0.5, 0.62, 0.3, -0.3, 1.2, 0.25), color: C.rust },
    { geo: new THREE.CylinderGeometry(0.08, 0.08, 1.9, 5), matrix: m4(-0.35, 0.5, -0.3, 1.4, 0.4, 0.3), color: C.metal },
    { geo: new THREE.BoxGeometry(0.55, 0.5, 0.5), matrix: m4(-0.8, 0.3, 0.5, 0.2, 0.7, 0.1), color: C.concreteDark },
  ]), 0.55);
}

/* a collapsed structure: two leaning walls, a fallen slab, a bent
   post. Silhouette does the work, the ink does the rest. */
function ruinGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.BoxGeometry(3.4, 3.0, 0.22), matrix: m4(0, 1.5, -1.4, 0.12, 0, 0.06), color: C.concrete },
    { geo: new THREE.BoxGeometry(0.22, 2.4, 2.6), matrix: m4(-1.6, 1.2, -0.2, 0, 0, -0.14), color: C.concreteDark },
    { geo: new THREE.BoxGeometry(2.8, 0.22, 2.2), matrix: m4(0.8, 0.5, 0.6, 0.28, 0.3, -0.18), color: C.concrete },
    { geo: new THREE.BoxGeometry(1.2, 1.6, 0.2), matrix: m4(1.5, 0.9, -1.2, 0, 0.4, 0.35), color: C.salmon },
    { geo: new THREE.CylinderGeometry(0.09, 0.09, 3.2, 5), matrix: m4(1.7, 1.3, 0.9, 0.4, 0, 0.5), color: C.metal },
    { geo: new THREE.BoxGeometry(0.9, 0.7, 0.7), matrix: m4(-0.9, 0.35, 1.1, 0.1, 0.6, 0.2), color: C.brick },
  ]), 0.4);
}

/* A tuft has to be DARKER than the ground it stands in and carry an
   ink line, or it disappears into its own colour and the ground
   reads bare however many thousand of them are placed. */
function grassGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    parts.push({
      geo: new THREE.ConeGeometry(0.055, 0.46, 3),
      matrix: m4(Math.cos(a) * 0.08, 0.22, Math.sin(a) * 0.08, Math.cos(a) * 0.36, a, Math.sin(a) * 0.36),
      color: i % 2 ? C.canopy : C.leafDark,
    });
  }
  return mergeParts(parts);
}

function smokeGeometry() {
  return roughenNormals(mergeParts([
    { geo: new THREE.IcosahedronGeometry(1.7, 1), matrix: m4(0, 2.2, 0), color: C.smoke },
    { geo: new THREE.IcosahedronGeometry(1.3, 1), matrix: m4(0.95, 3.9, 0.4), color: C.smokeDark },
    { geo: new THREE.IcosahedronGeometry(1.05, 1), matrix: m4(-0.6, 5.3, -0.35), color: C.smoke },
    { geo: new THREE.IcosahedronGeometry(0.85, 1), matrix: m4(0.35, 6.5, 0.25), color: C.smokeDark },
  ]), 0.5);
}

/* the utility pole from the refs — crossarms, insulators, a lean */
function poleGeometry(broken) {
  const parts = [
    { geo: new THREE.CylinderGeometry(0.14, 0.20, broken ? 4.6 : 8.2, 6), matrix: m4(0, broken ? 2.3 : 4.1, 0), color: C.timber },
  ];
  if (!broken) {
    parts.push({ geo: new THREE.BoxGeometry(3.0, 0.16, 0.16), matrix: m4(0, 7.4, 0), color: C.timber });
    parts.push({ geo: new THREE.BoxGeometry(2.2, 0.14, 0.14), matrix: m4(0, 6.6, 0), color: C.timber });
    for (let i = -1; i <= 1; i += 2) {
      parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 0.26, 5), matrix: m4(i * 1.35, 7.6, 0), color: C.teal });
      parts.push({ geo: new THREE.CylinderGeometry(0.08, 0.08, 0.22, 5), matrix: m4(i * 1.0, 6.8, 0), color: C.teal });
    }
    parts.push({ geo: new THREE.BoxGeometry(0.5, 0.7, 0.4), matrix: m4(0.28, 5.4, 0.2), color: C.metal });
  } else {
    /* snapped off, with the top hanging */
    parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.14, 2.6, 6), matrix: m4(0.9, 4.4, 0.3, 0, 0, -1.1), color: C.timber });
    parts.push({ geo: new THREE.BoxGeometry(1.9, 0.15, 0.15), matrix: m4(1.7, 5.2, 0.3, 0, 0, -0.9), color: C.timber });
  }
  return roughenNormals(mergeParts(parts), 0.35);
}

function buildProps(Q, toon, flat, scene) {
  const out = {};
  const vt = (w) => toon({ vertexColors: true, outline: w });

  /* Wild scatter stops AT a district, not a district's postcode. The
     first pass thinned all the way out through the skirt and took
     every tree on the healed side with it — a bald planet is a worse
     bug than a tilted slab. So: nothing inside the block, a ragged
     thinning across its apron, and untouched country beyond that. */
  const offPad = (x, y, z, rnd) => {
    if (!PADS.length) return false;
    const pd = padAt(x, y, z);
    if (!pd) return false;
    return rnd() < smoothstep(0.34, 0.66, pd.w);
  };
  const scorchTest = (x, y, z, rnd) => {
    if (seamField(x, y, z) > -0.09) return false;
    if (terrainHeight(x, y, z) < TERRAIN.lava + 0.35) return false;
    if (slopeAt(x, y, z) > 0.72) return false;
    return rnd() > 0.12;
  };
  const healTest = (x, y, z, rnd) => {
    if (seamField(x, y, z) < 0.09) return false;
    if (terrainHeight(x, y, z) < TERRAIN.sea + 0.45) return false;
    if (slopeAt(x, y, z) > 0.75) return false;
    /* Wild scatter stops at a district. Not with a hard circle — a
       ring of bare ground round each site is its own tell — but by
       thinning out through the skirt, so the woods run up to the
       block and stop where the block does. */
    if (offPad(x, y, z, rnd)) return false;
    return rnd() > 0.1;
  };

  /* one scatter, dealt out between several geometries */
  function addSpecies(name, geos, count, test, sizeFn, seed, lift, weight) {
    if (!count || !geos.length) return;
    const pts = scatter(count, test, seed);
    const buckets = geos.map(() => []);
    for (let i = 0; i < pts.length; i++) {
      /* hashed off the index, not round-robin: a spiral dealt in turn
         puts the same species on the same diagonal every time */
      buckets[(((i * 2654435761) >>> 0) % geos.length)].push(pts[i]);
    }
    const mat = vt(weight);
    geos.forEach((geo, k) => {
      if (!buckets[k].length) return;
      const m = new THREE.InstancedMesh(geo, mat, buckets[k].length);
      placeInstances(m, buckets[k], sizeFn, seed + 900 + k * 37, lift);
      m.castShadow = !!Q.shadows; m.receiveShadow = !!Q.shadows;
      scene.add(m);
      out[name + (k ? k : "")] = m;
    });
  }

  function add(name, geo, count, test, sizeFn, seed, lift, weight, matOpts) {
    if (!count) return;
    const mat = matOpts ? toon({ vertexColors: true, outline: weight, ...matOpts }) : vt(weight);
    const m = new THREE.InstancedMesh(geo, mat, count);
    const pts = scatter(count, test, seed);
    placeInstances(m, pts, sizeFn, seed + 900, lift);
    m.castShadow = !!Q.shadows; m.receiveShadow = !!Q.shadows;
    scene.add(m); out[name] = m;
  }

  /* ---- the burnt half: rubble, wreckage, dead wood, smoke ---- */
  add("rocks", rockGeometry(C.ashGrey, C.charDark), Q.rocks, scorchTest,
    (r) => { const s = 0.32 + r() * 0.85; return { x: s, y: s * (0.55 + r() * 0.7), z: s }; }, 11, -0.22, 1.0);
  add("rubble", rubbleGeometry(C.concrete, C.charDark), Q.rubble,
    (x, y, z, r) => scorchTest(x, y, z, r) && r() < 0.3 + clump(x, y, z, 4.6, 23) * 0.9,
    (r) => { const s = 0.42 + r() * 0.75; return { x: s, y: s, z: s }; }, 12, -0.15, 0.8);
  add("debris", debrisGeometry(), Q.debris, (x, y, z, r) => scorchTest(x, y, z, r) && r() > 0.3,
    (r) => { const s = 0.7 + r() * 0.9; return { x: s, y: s, z: s }; }, 13, -0.05, 0.85);
  addSpecies("deadTrees", [deadTreeGeometry(), deadSnapGeometry(), deadConiferGeometry()], Q.deadTrees,
    (x, y, z, r) => scorchTest(x, y, z, r) && r() < clump(x, y, z, 3.4, -7) * 1.2,
    (r) => { const s = 0.55 + r() * 0.6; return { x: s, y: s * (0.9 + r() * 0.6), z: s }; }, 14, -0.35, 1.15);
  add("ruins", ruinGeometry(), Q.ruins, (x, y, z, r) => scorchTest(x, y, z, r) && slopeAt(x, y, z) < 0.4 && r() > 0.4,
    (r) => { const s = 0.9 + r() * 1.1; return { x: s, y: s * (0.85 + r() * 0.4), z: s }; }, 15, -0.5, 1.25);
  if (Q.smoke) {
    const m = new THREE.InstancedMesh(smokeGeometry(),
      toon({ vertexColors: true, transparent: true, opacity: 0.6, outline: 0.6 }), Q.smoke);
    const pts = scatter(Q.smoke, (x, y, z) =>
      seamField(x, y, z) < -0.16 && terrainHeight(x, y, z) < TERRAIN.lava + 0.9, 16);
    placeInstances(m, pts, (r) => { const s = 0.5 + r() * 0.5; return { x: s * 1.3, y: s * (1.0 + r() * 0.6), z: s * 1.3 }; }, 916, 8.5);
    scene.add(m); out.smoke = m;
  }

  /* ---- the healed half: canopy, scrub, stone ---- */
  add("greenRocks", rockGeometry(C.cliff, C.stone), Math.round(Q.rocks * 0.4), healTest,
    (r) => { const s = 0.3 + r() * 0.65; return { x: s, y: s * (0.6 + r() * 0.6), z: s }; }, 21, -0.18, 0.9);
  /* ---- the woods ----
     One scatter, five silhouettes. Splitting the SCATTER rather than
     scattering five times keeps the groves and clearings the clump
     field draws — five independent scatters would each find their own
     clumps and the sum of them is an even sprinkle again, which is
     the look this whole system exists to avoid. */
  addSpecies("canopy", CANOPY_SPECIES.map(f => f()), Q.canopy,
    (x, y, z, r) => healTest(x, y, z, r) && r() < clump(x, y, z, 2.6, 4) * 1.2,
    (r) => { const s = 0.62 + r() * 0.55; return { x: s, y: s * (0.9 + r() * 0.5), z: s }; }, 22, -0.3, 1.15);
  add("bushes", bushGeometry(), Q.bushes,
    (x, y, z, r) => healTest(x, y, z, r) && r() < 0.35 + clump(x, y, z, 4.2, 11) * 0.8,
    (r) => { const s = 0.42 + r() * 0.55; return { x: s, y: s * (0.75 + r() * 0.6), z: s }; }, 23, -0.12, 0.8);
  if (Q.grass) {
    const m = new THREE.InstancedMesh(grassGeometry(), toon({ vertexColors: true, outline: 0.55 }), Q.grass);
    const pts = scatter(Q.grass, (x, y, z, r) => seamField(x, y, z) > 0.07
      && terrainHeight(x, y, z) > TERRAIN.sea + 0.2 && slopeAt(x, y, z) < 0.6
      && !offPad(x, y, z, r), 24);
    placeInstances(m, pts, (r) => { const s = 0.7 + r() * 0.7; return { x: s, y: s * (0.8 + r() * 0.7), z: s }; }, 924, -0.04);
    scene.add(m); out.grass = m;
  }

  /* ---- power lines: the single most Messenger thing in the refs.
     Poles walk in chains across the ground and the wires sag
     between their tops, drawn as ink-thin lines across the sky. ---- */
  const lines = buildPowerLines(Q, toon);
  if (lines) { scene.add(lines.poles, lines.wires); out.poles = lines.poles; out.wires = lines.wires; }
  return out;
}

function buildPowerLines(Q, toon) {
  if (!Q.poleChains) return null;
  const rnd = rng(6060);
  const whole = poleGeometry(false), broken = poleGeometry(true);
  const placedWhole = [], placedBroken = [], wire = [];
  const start = new THREE.Vector3(), dirv = new THREE.Vector3(), axis = new THREE.Vector3();
  const p = new THREE.Vector3(), prevTop = new THREE.Vector3(), top = new THREE.Vector3();
  const up = new THREE.Vector3(), mid = new THREE.Vector3();

  for (let chain = 0; chain < Q.poleChains; chain++) {
    /* a chain walks a great-circle arc; half of them on each face */
    const scorchChain = chain % 2 === 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      start.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (start.lengthSq() < 1e-4) continue;
      start.normalize();
      const sf = seamField(start.x, start.y, start.z);
      if (scorchChain ? sf > -0.2 : sf < 0.2) continue;
      break;
    }
    dirv.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    axis.crossVectors(start, dirv);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize();
    p.copy(start);
    let have = false;
    const span = 5.5 / R;   /* metres between poles, as an angle */
    const count = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < count; i++) {
      p.applyAxisAngle(axis, span).normalize();
      if (slopeAt(p.x, p.y, p.z) > 0.65) { have = false; continue; }
      if (terrainHeight(p.x, p.y, p.z) < TERRAIN.lava + 0.4) { have = false; continue; }
      const snapped = scorchChain && rnd() < 0.34;
      (snapped ? placedBroken : placedWhole).push({ n: p.clone(), spin: rnd() * Math.PI * 2 });
      up.copy(p);
      top.copy(p).multiplyScalar(groundAt(p) + (snapped ? 4.4 : 7.4));
      if (have && !snapped) {
        /* three sagging segments read as a catenary and cost nothing */
        mid.copy(prevTop).add(top).multiplyScalar(0.5);
        const sag = mid.clone().normalize().multiplyScalar(mid.length() - 0.55);
        wire.push(prevTop.x, prevTop.y, prevTop.z, sag.x, sag.y, sag.z);
        wire.push(sag.x, sag.y, sag.z, top.x, top.y, top.z);
      }
      prevTop.copy(top);
      have = !snapped;
    }
  }

  const total = placedWhole.length + placedBroken.length;
  if (!total) return null;
  const mat = toon({ vertexColors: true, outline: 0.9 });
  const poles = new THREE.InstancedMesh(whole, mat, Math.max(1, placedWhole.length));
  const rnd2 = rng(7070);
  placedWhole.forEach((it, i) => {
    _iO.position.copy(it.n).multiplyScalar(groundAt(it.n) - 0.4);
    orientToSurface(_iO, it.n, it.spin);
    _iO.rotateOnAxis(new THREE.Vector3(1, 0, 0), (rnd2() - 0.5) * 0.10);
    _iO.scale.setScalar(0.95 + rnd2() * 0.2);
    _iO.updateMatrix();
    poles.setMatrixAt(i, _iO.matrix);
  });
  poles.count = placedWhole.length;
  poles.instanceMatrix.needsUpdate = true;
  poles.frustumCulled = false;
  poles.castShadow = !!Q.shadows;

  /* the snapped ones share the draw call by living in a second
     instanced mesh — still two calls for every pole on the planet */
  const brokenMesh = new THREE.InstancedMesh(broken, mat, Math.max(1, placedBroken.length));
  placedBroken.forEach((it, i) => {
    _iO.position.copy(it.n).multiplyScalar(groundAt(it.n) - 0.4);
    orientToSurface(_iO, it.n, it.spin);
    _iO.rotateOnAxis(new THREE.Vector3(1, 0, 0), (rnd2() - 0.5) * 0.5);
    _iO.scale.setScalar(0.95 + rnd2() * 0.2);
    _iO.updateMatrix();
    brokenMesh.setMatrixAt(i, _iO.matrix);
  });
  brokenMesh.count = placedBroken.length;
  brokenMesh.instanceMatrix.needsUpdate = true;
  brokenMesh.frustumCulled = false;
  poles.add(brokenMesh);

  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
  const wm = new THREE.LineBasicMaterial({ color: C.wire, fog: true });
  wm.userData.outlineParameters = { visible: false };
  const wires = new THREE.LineSegments(wg, wm);
  wires.frustumCulled = false;
  return { poles, wires };
}

/* Doves: three instanced meshes for the whole flock — bodies, left
   wings, right wings — with the flap baked into each instance
   matrix, so twelve birds cost three draw calls, not thirty-six. */
function buildDoves(Q, toon) {
  const group = new THREE.Group();
  const n = Q.doves;
  const bodyGeo = mergeParts([
    { geo: new THREE.IcosahedronGeometry(0.34, 1), matrix: m4(0, 0, 0, 0, 0, 0, 1.7, 0.85, 0.9), color: C.dove },
    { geo: new THREE.IcosahedronGeometry(0.19, 0), matrix: m4(0.52, 0.12, 0), color: C.dove },
    { geo: new THREE.ConeGeometry(0.16, 0.62, 4), matrix: m4(-0.64, 0, 0, 0, 0, Math.PI / 2), color: 0xe8e3d6 },
  ]);
  const wingGeo = mergeParts([
    { geo: new THREE.IcosahedronGeometry(0.5, 0), matrix: m4(0, 0, 0.45, 0, 0, 0, 0.9, 0.13, 1.95), color: C.dove },
  ]);
  const mat = toon({ vertexColors: true, outline: 0.85 });
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, n);
  const wingL = new THREE.InstancedMesh(wingGeo, mat, n);
  const wingR = new THREE.InstancedMesh(wingGeo, mat, n);
  [bodies, wingL, wingR].forEach(m => { m.frustumCulled = false; group.add(m); });

  const rnd = rng(404);
  const birds = [];
  for (let i = 0; i < n; i++) {
    const seamBird = i % 3 === 0;
    birds.push({
      phase: rnd() * Math.PI * 2, speed: 0.10 + rnd() * 0.09,
      alt: R + 10 + rnd() * 13, tilt: seamBird ? 0.03 : 0.35 + rnd() * 0.5,
      flap: 5.5 + rnd() * 3, scale: 0.85 + rnd() * 0.7,
    });
  }
  const p = new THREE.Vector3(), fw = new THREE.Vector3(), up = new THREE.Vector3(), rt = new THREE.Vector3();
  const bm = new THREE.Matrix4(), wm = new THREE.Matrix4(), lm = new THREE.Matrix4();
  const sc = new THREE.Vector3(), rx = new THREE.Matrix4();

  function update(dt, now) {
    const t = now * 0.001;
    for (let i = 0; i < n; i++) {
      const b = birds[i];
      const a = b.phase + t * b.speed;
      /* a ring tilted off the seam plane; x is the seam axis, so a
         small tilt keeps them tracing the gold line, as on the cover */
      p.set(Math.sin(b.tilt) * Math.cos(a), Math.sin(a), Math.cos(a) * Math.cos(b.tilt)).normalize();
      up.copy(p);
      p.multiplyScalar(b.alt + Math.sin(a * 3.1) * 1.4);
      fw.set(Math.sin(b.tilt) * -Math.sin(a), Math.cos(a), -Math.sin(a) * Math.cos(b.tilt)).normalize();
      fw.addScaledVector(up, -fw.dot(up)).normalize();
      rt.crossVectors(fw, up).normalize();
      bm.makeBasis(fw, up, rt);
      bm.setPosition(p);
      sc.setScalar(b.scale);
      bm.scale(sc);
      bodies.setMatrixAt(i, bm);
      const flap = Math.sin(t * b.flap + b.phase) * 0.85;
      lm.copy(bm).multiply(rx.makeRotationX(-flap));
      wingL.setMatrixAt(i, lm);
      wm.copy(bm).multiply(rx.makeRotationX(Math.PI + flap));
      wingR.setMatrixAt(i, wm);
    }
    bodies.instanceMatrix.needsUpdate = true;
    wingL.instanceMatrix.needsUpdate = true;
    wingR.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  return { group, update };
}

/* ============================================================
   PARTICLES — embers rising off the burn, ash drifting over it
   ============================================================ */

/* one generated soft disc, shared by every particle system, so
   nothing in the world needs an image file */
let _disc = null;
function softDisc(hex) {
  const key = "d" + hex;
  _disc = _disc || {};
  if (_disc[key]) return _disc[key];
  const S = 32;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const g = cvs.getContext("2d");
  const col = new THREE.Color(hex);
  const rgb = Math.round(col.r * 255) + "," + Math.round(col.g * 255) + "," + Math.round(col.b * 255);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(" + rgb + ",1)");
  grd.addColorStop(0.4, "rgba(" + rgb + ",0.72)");
  grd.addColorStop(1, "rgba(" + rgb + ",0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cvs);
  t.colorSpace = THREE.SRGBColorSpace;
  _disc[key] = t;
  return t;
}
function buildEmbers(Q) {
  const n = Q.embers;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), home = new Float32Array(n * 3);
  const life = new Float32Array(n), rise = new Float32Array(n);
  const rnd = rng(808), v = new THREE.Vector3();
  let made = 0, guard = 0;
  while (made < n && guard++ < n * 60) {
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() < 1e-6) continue;
    v.normalize();
    if (seamField(v.x, v.y, v.z) > -0.02) continue;
    if (crackField(v.x, v.y, v.z) < 0.30 && terrainHeight(v.x, v.y, v.z) > TERRAIN.lava + 1.2) continue;
    home[made * 3] = v.x; home[made * 3 + 1] = v.y; home[made * 3 + 2] = v.z;
    life[made] = rnd();
    rise[made] = 1.8 + rnd() * 3.6;
    made++;
  }
  const count = made;
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setDrawRange(0, count);
  /* an untextured Point is a hard SQUARE, which on an additive
     material reads as a glowing tile — the one thing embers must
     not look like. A generated soft disc fixes it with no file. */
  const m = new THREE.PointsMaterial({
    color: 0xffa54a, size: 0.30, sizeAttenuation: true, transparent: true,
    map: softDisc(0xffc27a), opacity: 0.75, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
  });
  m.userData.outlineParameters = { visible: false };
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;

  function write() {
    for (let i = 0; i < count; i++) {
      const r = groundAt(_gv.set(home[i * 3], home[i * 3 + 1], home[i * 3 + 2])) + life[i] * rise[i];
      p[i * 3] = home[i * 3] * r; p[i * 3 + 1] = home[i * 3 + 1] * r; p[i * 3 + 2] = home[i * 3 + 2] * r;
    }
    g.attributes.position.needsUpdate = true;
  }
  write();
  return {
    points, count,
    update(dt) {
      for (let i = 0; i < count; i++) { life[i] += dt * 0.24; if (life[i] > 1) life[i] -= 1; }
      write();
    },
  };
}

function buildAsh(Q) {
  const n = Q.ash;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3);
  const base = [];
  const rnd = rng(909), v = new THREE.Vector3();
  let made = 0, guard = 0;
  while (made < n && guard++ < n * 40) {
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() < 1e-6) continue;
    v.normalize();
    if (seamField(v.x, v.y, v.z) > 0.02) continue;
    base.push({ n: v.clone(), h: 1 + rnd() * 16, ph: rnd() * Math.PI * 2, sp: 0.3 + rnd() * 0.7 });
    made++;
  }
  const count = made;
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setDrawRange(0, count);
  const m = new THREE.PointsMaterial({
    color: 0xcbbaa9, size: 0.26, sizeAttenuation: true, transparent: true,
    map: softDisc(0xffffff), opacity: 0.42, depthWrite: false, fog: true,
  });
  m.userData.outlineParameters = { visible: false };
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), q = new THREE.Vector3();
  function write(time) {
    for (let i = 0; i < count; i++) {
      const b = base[i];
      t1.set(0, 1, 0).cross(b.n);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(b.n);
      t1.normalize(); t2.crossVectors(b.n, t1).normalize();
      const a = b.ph + time * 0.0096 * b.sp;
      q.copy(b.n).multiplyScalar(groundAt(b.n) + b.h + Math.sin(a * 0.7) * 1.6)
        .addScaledVector(t1, Math.sin(a) * 2.4).addScaledVector(t2, Math.cos(a * 0.8) * 2.4);
      p[i * 3] = q.x; p[i * 3 + 1] = q.y; p[i * 3 + 2] = q.z;
    }
    g.attributes.position.needsUpdate = true;
  }
  write(0);
  return { points, count, update: (dt, now) => write(now) };
}

/* ============================================================
   THE CONTACT PATCH
   The refs ground their character with a soft painted blob, not a
   hard shadow. One generated radial texture, one quad, no files.
   ============================================================ */
function buildContactShadow() {
  /* A DRAWN shadow, not a soft radial gradient.
     The gradient version was wrong twice over: it contradicted the
     flat-fill law that everything else in this world obeys, and at
     0.42 peak alpha over mid-green ground it was invisible in a 3x
     crop under the fellow's own feet. This is a flat ellipse with a
     hard edge and one narrow soft rim — the same way the reference
     draws a contact shadow, and dark enough to actually read. */
  const S = 128;
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = S;
  const g2 = cvs.getContext("2d");
  g2.clearRect(0, 0, S, S);
  const grd = g2.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.46);
  grd.addColorStop(0, "rgba(34,26,22,0.52)");
  grd.addColorStop(0.66, "rgba(34,26,22,0.44)");
  grd.addColorStop(1, "rgba(34,26,22,0)");
  g2.fillStyle = grd;
  g2.beginPath();
  g2.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
  g2.fill();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: true,
  });
  mat.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), mat);
  mesh.renderOrder = 1;
  const q = new THREE.Quaternion(), fromZ = new THREE.Vector3(0, 0, 1);
  return {
    mesh,
    place(worldPos, up, speed) {
      mesh.position.copy(up).multiplyScalar(walkAt(up) + 0.045);
      /* a plane's face is +Z, so it aims along the normal; this is
         a flat decal with no handedness, so the pole degeneracy
         that matters for bodies does not bite here */
      q.setFromUnitVectors(fromZ, up);
      mesh.quaternion.copy(q);
      const s = 1 - speed * 0.16;
      mesh.scale.set(s, s, 1);
    },
  };
}

/* ============================================================
   THE FELLOW
   Jointed, so he has a walk instead of a glide: hips, shoulders,
   knees and elbows on sine phases, with a gentle walk and a
   bouncier run blended by the same value that drives the camera.
   The likeness is deliberately graphic — a solid inked hair mass
   of shoulder-length twists, a full beard, one flat skin tone with
   a single warm shadow band — rather than an attempt at a portrait
   in a hundred triangles.
   ============================================================ */
function buildFellow(toon) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const skin = toon({ color: C.skin, outline: 0.72 });
  const hoodie = toon({ color: C.hoodie, outline: 0.78 });
  const jeans = toon({ color: C.jeans, outline: 0.75 });
  const shoe = toon({ color: C.shoe, outline: 0.68 });
  const sole = toon({ color: C.shoeSole, outline: 0.68 });
  const hair = toon({ color: C.hair, outline: 0.8 });

  const hips = new THREE.Group(); hips.position.y = 0.94; model.add(hips);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.50, 3, 8), hoodie);
  torso.position.y = 0.40; hips.add(torso);
  const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), hoodie);
  chest.position.y = 0.62; chest.scale.set(1.18, 0.9, 0.86); hips.add(chest);
  const hood = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30, 1), hoodie);
  hood.position.set(0, 0.80, -0.16); hood.scale.set(1.1, 0.7, 0.9); hips.add(hood);

  const neck = new THREE.Group(); neck.position.y = 0.88; hips.add(neck);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30, 1), skin);
  head.scale.set(0.96, 1.08, 0.98); neck.add(head);
  /* the beard: one solid inked mass along the jaw, not strands */
  const beard = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), hair);
  beard.position.set(0, -0.10, 0.06); beard.scale.set(1.0, 0.78, 0.92); neck.add(beard);
  /* the hair: a bold graphic cap with a few carved twist grooves */
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.31, 1), hair);
  crown.position.y = 0.10; crown.scale.set(1.02, 0.9, 1.02); neck.add(crown);
  const twistGeo = new THREE.CapsuleGeometry(0.055, 0.30, 2, 4);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const back = 0.55 + 0.45 * Math.cos(a);      /* longest at the back */
    const t = new THREE.Mesh(twistGeo, hair);
    t.position.set(Math.sin(a) * 0.30, 0.02 - back * 0.26, Math.cos(a) * 0.30);
    t.scale.set(1, 0.7 + back * 1.1, 1);
    t.rotation.set(Math.cos(a) * 0.24, -a, -Math.sin(a) * 0.24);
    neck.add(t);
  }

  function limb(px, py, upperLen, lowerLen, upperR, lowerR, matU, matL, withShoe) {
    const shoulder = new THREE.Group();
    shoulder.position.set(px, py, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperR, upperLen, 3, 6), matU);
    upper.position.y = -upperLen / 2; shoulder.add(upper);
    const joint = new THREE.Group();
    joint.position.y = -upperLen; shoulder.add(joint);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerR, lowerLen, 3, 6), matL);
    lower.position.y = -lowerLen / 2; joint.add(lower);
    if (withShoe) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.38), shoe);
      f.position.set(0, -lowerLen - 0.04, 0.08); joint.add(f);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.40), sole);
      s.position.set(0, -lowerLen - 0.11, 0.08); joint.add(s);
    }
    return { shoulder, joint };
  }

  const armL = limb(-0.42, 0.72, 0.34, 0.32, 0.10, 0.088, hoodie, skin, false);
  const armR = limb(0.42, 0.72, 0.34, 0.32, 0.10, 0.088, hoodie, skin, false);
  hips.add(armL.shoulder, armR.shoulder);
  const legL = limb(-0.18, 0.02, 0.40, 0.38, 0.13, 0.108, jeans, jeans, true);
  const legR = limb(0.18, 0.02, 0.40, 0.38, 0.13, 0.108, jeans, jeans, true);
  hips.add(legL.shoulder, legR.shoulder);

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  function pose(phase, speed, run, grounded, now) {
    const s = clamp(speed, 0, 1);
    const sw = Math.sin(phase), sw2 = Math.sin(phase + Math.PI);
    /* the run lifts the knees, pumps the arms and bounces */
    const swing = mix(0.68, 1.15, run) * s;
    const armSwing = mix(0.56, 1.05, run) * s;
    const bounce = mix(0.09, 0.20, run) * s;

    legL.shoulder.rotation.x = sw * swing;
    legR.shoulder.rotation.x = sw2 * swing;
    legL.joint.rotation.x = Math.max(0, -sw + 0.15) * mix(0.85, 1.45, run) * s;
    legR.joint.rotation.x = Math.max(0, -sw2 + 0.15) * mix(0.85, 1.45, run) * s;

    armL.shoulder.rotation.x = sw2 * armSwing;
    armR.shoulder.rotation.x = sw * armSwing;
    armL.shoulder.rotation.z = 0.13 + s * 0.05;
    armR.shoulder.rotation.z = -0.13 - s * 0.05;
    armL.joint.rotation.x = -0.25 - Math.max(0, sw2) * mix(0.5, 1.1, run) * s;
    armR.joint.rotation.x = -0.25 - Math.max(0, sw) * mix(0.5, 1.1, run) * s;

    /* idle breathing arrives as now === 0 under reduced motion, so
       it simply does not happen there */
    const idle = now ? Math.sin(now * 0.0016) * 0.014 * (1 - s) : 0;
    hips.position.y = 0.94 + Math.max(0, Math.sin(phase * 2)) * bounce + idle;
    hips.rotation.y = -sw * mix(0.10, 0.16, run) * s;
    hips.rotation.x = mix(0.04, 0.16, run) * s;
    neck.rotation.x = -mix(0.03, 0.10, run) * s + (now ? Math.sin(now * 0.0011) * 0.02 * (1 - s) : 0);
    if (!grounded) {
      legL.shoulder.rotation.x = -0.5; legR.shoulder.rotation.x = 0.32;
      armL.shoulder.rotation.x = -1.05; armR.shoulder.rotation.x = -1.05;
    }
  }
  pose(0, 0, 0, true, 0);
  return { root, model, pose };
}

/* ============================================================
   PLACEHOLDER LANDMARK
   Only used when js/uprise-landmarks.js is absent or throws. It is
   deliberately a marked site, not a fake building — an honest
   placeholder beats a bad likeness.
   ============================================================ */
function placeholderLandmark(L, toon) {
  const g = new THREE.Group();
  const stone = toon({ color: L.isFinale ? C.cream : C.concrete, outline: 1.3 });
  const dark = toon({ color: C.concreteDark, outline: 1.3 });
  const trim = toon({ color: C.salmon, outline: 1.2 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.8, 1.0, 12), dark);
  plinth.position.y = 0.5; g.add(plinth);
  const box = new THREE.Mesh(new THREE.BoxGeometry(7.6, 5.0, 5.4), stone);
  box.position.y = 3.5; g.add(box);
  const band = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.5, 5.6), trim);
  band.position.y = 5.9; g.add(band);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 2.6, 4), dark);
  roof.position.y = 7.4; roof.rotation.y = Math.PI / 4; g.add(roof);
  for (let i = 0; i < 5; i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 4.6, 8), stone);
    col.position.set(-2.8 + i * 1.4, 3.3, 2.95); g.add(col);
  }
  g.userData.placeholder = true;
  return g;
}

/* ============================================================
   TEXTURE BUDGET
   The world ships no image files at all: the only sampled textures
   are the 3x1 cel ramp and a 64px generated contact patch. The
   rest of the video memory is render targets, and those scale with
   the tier.
   ============================================================ */
function textureBytes(Q) {
  const ramp = 3 * 1 * 4;
  const patch = 64 * 64 * 4;
  const shadow = Q.shadows ? Q.shadowMap * Q.shadowMap * 4 : 0;
  let post = 0;
  if (Q.post) {
    const dpr = Math.min(devicePixelRatio || 1, Q.pixelRatio);
    const w = 1440 * dpr, h = 900 * dpr;
    post += w * h * 8 * 2;                       /* two RGBA16F composer targets */
    let mw = w / 2, mh = h / 2;
    for (let i = 0; i < 5; i++) { post += mw * mh * 8 * 2; mw /= 2; mh /= 2; }
  }
  const total = ramp + patch + shadow + post;
  return {
    imageFiles: 0,
    rampBytes: ramp, contactPatchBytes: patch,
    shadowBytes: shadow, postBytes: Math.round(post),
    totalMB: +(total / (1024 * 1024)).toFixed(2),
  };
}
