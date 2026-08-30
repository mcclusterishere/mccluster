/* ============================================================
   UPRISE WORLD — THE CROSSING
   The title sequence that plays once, the first time the seam
   lets you through onto the Deep End.

   The owner's ask, verbatim: "the third world situation needs to
   begin with a three d generated or graphic generated world
   rotating after the heal the three graphic I showed you."

   So it runs in that order:
     1. THE PLATE. The Heal the 3 cover, held. Letterboxed, set in
        an inked cream frame with a hard offset shadow, on a field
        of ink with a gold bloom behind it. A beat of stillness —
        long enough to read the painting.
     2. THE TURN. The plate dissolves into the same picture made
        dimensional: a globe built in the game's own ink — toon
        material, three-step gradient ramp, OutlineEffect — green
        hemisphere on the right, burning hemisphere on the left,
        the gold seam down the middle exactly as the cover frames
        it. Then the world turns, three quarters of a revolution,
        and the burning side swings round to face you.
     3. THE TYPE. "THE DEEP END" over it, "THE THREE" under that,
        in the site's display face with an ink outline and the
        same offset shadow the cards use.
     4. THE HANDOFF. Everything fades off the scorched side of the
        planet you are already standing on.

   Rules it keeps:
   - SKIPPABLE, always: tap, click, any key, Escape, or the Skip
     chip. Plus a watchdog timer, so a stalled frame can never
     trap the player inside a cutscene.
   - prefers-reduced-motion: no spin, no push-in, no letterbox
     slide. The cover cross-fades to a still title card.
   - No CDN, no external URLs. three.js is the vendored copy.
   - If a second WebGL context cannot be had — and on a phone
     already running the world, that is a real possibility — the
     whole thing degrades to the graphic sequence with no globe,
     and still resolves.
   Its clothes live in uprise-world.html; this file only drives.
   ============================================================ */
import * as THREE from "../vendor/three.module.min.js";
import { OutlineEffect } from "../vendor/three-addons/effects/OutlineEffect.js";

/* the ink is a very dark blue-brown, never pure black — same as
   the world's, so the two sequences are drawn with one pen */
const INK = [0.040, 0.034, 0.040];
const INK_BASE = 0.0170;

/* the album's own colours, read off the cover and matched to the
   world palette so the globe is the cover and not a cousin */
const C = {
  grass: 0x8fbc6a, grassLit: 0xafd184, canopy: 0x5e9a45, leafDark: 0x487c37,
  sage: 0xc9d9b6, water: 0x86c9cf, waterDeep: 0x5aa9b4, waterPale: 0xa8dbdf,
  ash: 0xa8a49b, ashLit: 0xc9c5bb, charred: 0x7d6152, charDark: 0x4f3c33,
  charSoot: 0x33271f, burnt: 0xb8503a, ember: 0xc4652f,
  lava: 0xff7a33, lavaHot: 0xffc061,
  gold: 0xe0ad3c, goldHot: 0xffdc7a,
  smoke: 0xcdc2b9, smokeDark: 0xa79c93, cloud: 0xf1f8f5,
  dove: 0xf7f4ec, bark: 0x4e3a30,
};

/* ---------- the timeline, in milliseconds ---------- */
const T = {
  in: 60,          /* the overlay arrives */
  plate: 320,      /* the cover lands in its frame */
  globe: 3150,     /* the dissolve into three dimensions begins */
  turn: 4050,      /* the world starts to turn */
  turnDur: 4200,   /* how long the turn takes */
  title: 4950,     /* the type comes up over it */
  out: 9250,       /* the handoff back to the ground */
  end: 10250,      /* gone */
};
const T_RM = { in: 40, plate: 200, globe: 2500, turn: 0, turnDur: 0, title: 3450, out: 7000, end: 7800 };

/* three quarters of a turn, taken the long way round, so the green
   side sweeps off to the right and the world comes back at you on
   fire rather than simply flipping over */
const TURN = -Math.PI * 1.5;
const DRIFT = -0.085;  /* it is never quite still: radians a second */
/* Where the globe sits when it is first uncovered. The cover puts
   the burning half on the left and the green on the right with the
   gold seam bending down the middle, so the start is biased just
   past the seam — and biased FORWARD of it, because the drift is
   already running by the time the plate lets go. */
const START = 0.55;

const easeInOutSine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ============================================================
   Entry point. Resolves when the sequence is off the screen,
   however it got there — played out, skipped, or failed.
   ============================================================ */
export function playIntro(opts = {}) {
  const host = opts.root || document.body;
  const reduced = !!(opts.reduced ?? matchMedia("(prefers-reduced-motion: reduce)").matches);
  const t = reduced ? T_RM : T;

  return new Promise((resolve) => {
    let done = false;
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));

    /* ---------- the layer ---------- */
    const wrap = document.createElement("div");
    wrap.className = "uwi";
    wrap.tabIndex = -1;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Crossing into the Deep End");

    const gl = document.createElement("canvas");
    gl.className = "uwi__gl";
    gl.setAttribute("aria-hidden", "true");

    const stage = document.createElement("div");
    stage.className = "uwi__stage";
    const plate = document.createElement("figure");
    plate.className = "uwi__plate";
    const img = document.createElement("img");
    img.src = "assets/img/heal-the-3-cover.jpg";
    img.alt = "Heal the 3 — a world with one half green and one half burning, a gold seam between them";
    img.decoding = "async";
    plate.appendChild(img);
    /* The cover is a third of a megabyte and this page has never
       asked for it before, so on the crossing it is very likely
       still on the wire. Hold the plate beat until the picture is
       actually there — an empty frame is not a title card. The cap
       means a slow connection delays the sequence by a beat and
       never stalls it. */
    const coverReady = Promise.race([
      /* decode() is the only one that means READY TO PAINT — load
         fires before the bitmap exists, which is how you get an
         empty frame on screen for a beat */
      (img.decode ? img.decode() : Promise.reject()).catch(() => new Promise((res) => {
        if (img.complete && img.naturalWidth) return res();
        img.addEventListener("load", res, { once: true });
        img.addEventListener("error", res, { once: true });
      })),
      new Promise((res) => setTimeout(res, 2600)),
    ]);
    const cap = document.createElement("figcaption");
    cap.className = "uwi__cap";
    cap.innerHTML = '<span class="uwi__tag">The seam opens</span>'
      + '<span class="uwi__capline">Four check-ins. The far side of the world is yours.</span>';
    stage.appendChild(plate);
    stage.appendChild(cap);

    const type = document.createElement("div");
    type.className = "uwi__type";
    type.innerHTML =
      '<h2 class="uwi__h">The Deep End</h2>'
      + '<p class="uwi__sub">The Three</p>'
      + '<p class="uwi__line">Ukraine and Russia. The third world, still burning &mdash;'
      + ' and <i>Deep End</i> is what plays here.</p>';

    const vig = document.createElement("div"); vig.className = "uwi__vig";
    const grain = document.createElement("div"); grain.className = "uwi__grain";
    const barT = document.createElement("div"); barT.className = "uwi__bar";
    const barB = document.createElement("div"); barB.className = "uwi__bar uwi__bar--b";

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "uwi__skip";
    skip.textContent = "Skip";

    const sr = document.createElement("p");
    sr.className = "uwi__sr";
    sr.setAttribute("aria-live", "polite");
    sr.textContent = "Crossing the seam. The Deep End, also called the Three: the far side of the world.";

    wrap.append(gl, vig, stage, type, grain, barT, barB, skip, sr);
    host.appendChild(wrap);
    document.body.classList.add("uw--cine");

    /* ---------- the way out, from anywhere ---------- */
    function finish() {
      if (done) return;
      done = true;
      for (const id of timers) clearTimeout(id);
      timers.length = 0;
      window.removeEventListener("keydown", onKey, true);
      wrap.removeEventListener("pointerdown", onTap);
      try { teardownGL && teardownGL(); } catch (e) { /* nothing left to lose */ }
      document.body.classList.remove("uw--cine");
      wrap.remove();
      resolve();
    }
    /* the sequence's own graceful exit: fade, then go */
    function bowOut() {
      if (done) return;
      wrap.classList.add("uwi--out");
      at(t.end - t.out, finish);
    }
    /* skipping is not a fade-to-black — it is out of the way now */
    function bail() {
      if (done) return;
      wrap.classList.add("uwi--out");
      for (const id of timers) clearTimeout(id);
      timers.length = 0;
      timers.push(setTimeout(finish, reduced ? 260 : 380));
    }
    /* You are almost certainly still holding W, or still dragging,
       at the instant you cross. So: auto-repeat never counts, held
       keys never count, and nothing counts at all for the first
       beat. Otherwise the sequence would skip itself for every
       player who arrived walking — which is all of them. */
    const opened = performance.now();
    const GRACE = 900;
    function armed() { return performance.now() - opened > GRACE; }
    function onKey(e) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Tab" || e.key === "Shift") return;
      if (!armed()) return;
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") e.preventDefault();
      bail();
    }
    function onTap() { if (armed()) bail(); }
    window.addEventListener("keydown", onKey, true);
    wrap.addEventListener("pointerdown", onTap);
    skip.addEventListener("click", (e) => { e.stopPropagation(); bail(); });
    skip.addEventListener("pointerdown", (e) => e.stopPropagation());

    /* THE WATCHDOG. Whatever else happens — a lost context, a
       throw in the loop, a tab that slept through its own timers —
       the player gets the world back. A cutscene must never be a
       door that locks. */
    const guard = setTimeout(finish, t.end + 2600 + 5000);
    timers.push(guard);

    /* ---------- three dimensions, if the device will give them ---------- */
    let teardownGL = null;
    let setTurnStart = null;
    try {
      const rig = buildGlobeRig(gl, reduced);
      teardownGL = rig.dispose;
      setTurnStart = rig.startTurn;
      wrap.classList.add("uwi--has3d");
    } catch (e) {
      /* no second context. The graphic sequence carries it alone —
         the cover cross-fades straight to the title card. */
      gl.remove();
    }

    /* ---------- the beats ---------- */
    /* The ink field goes up at once — whatever else happens, the
       world is covered and the crossing has begun. Everything after
       that hangs off the moment the cover is ready to paint, so the
       beat of stillness is a real beat on a slow connection instead
       of an empty frame followed by a rush. */
    at(t.in, () => wrap.classList.add("uwi--in"));
    coverReady.then(() => {
      if (done) return;
      const base = t.plate;
      wrap.classList.add("uwi--plate");
      at(t.globe - base, () => wrap.classList.add("uwi--globe"));
      if (!reduced && setTurnStart) at(t.turn - base, () => setTurnStart());
      at(t.title - base, () => wrap.classList.add("uwi--title"));
      at(t.out - base, bowOut);
    });
  });
}

/* ============================================================
   THE GLOBE
   The album cover, made dimensional, in the game's own ink.
   ============================================================ */
function buildGlobeRig(canvas, reduced) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: "high-performance", stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  renderer.setClearColor(0x000000, 0);

  const software = isSoftware(renderer);
  /* IcosahedronGeometry's second argument is a SUBDIVISION count,
     not a power — each of the twenty faces becomes (detail+1)^2
     triangles. The world's low tier runs 26 on a planet that only
     ever shows a slice; this globe shows its whole silhouette, so
     it needs at least that much to draw a clean circle. */
  const detail = software ? 26 : 36;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, software ? 1 : 2));

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 60);

  const ink = makeInk();
  const globe = buildGlobe(ink, detail);
  scene.add(globe);

  const doves = buildDoves(ink);
  scene.add(doves.group);

  /* Flat and bright, the way the refs are lit: ambient carries the
     image and the sun only decides which of three bands a face
     lands in. The key sits camera-left-high so the burning side is
     legible the moment it comes round. */
  scene.add(new THREE.AmbientLight(0xfff3e4, 0.86));
  const key = new THREE.DirectionalLight(0xfff0d8, 0.70);
  key.position.set(-0.55, 0.85, 1.25);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc98a, 0.34);
  rim.position.set(1.1, -0.35, -0.8);
  scene.add(rim);

  const outline = new OutlineEffect(renderer, {
    defaultThickness: INK_BASE, defaultColor: INK, defaultAlpha: 0.95, defaultKeepAlive: true,
  });
  function setInk(scale, alpha) {
    for (const m of ink.inked) {
      const p = m.userData.outlineParameters;
      p.thickness = INK_BASE * (m.userData.inkWeight || 1) * scale;
      p.alpha = alpha;
    }
  }

  /* the globe starts exactly as the cover is framed: the seam
     facing you, green on the right, fire on the left */
  globe.rotation.y = START;

  let raf = 0, stopped = false, turnAt = -1;
  const t0 = performance.now();

  function size() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    /* hold the globe at a constant share of the SHORT edge, so it
       lands on the cover it dissolved out of on any screen */
    const half = h <= w ? 1 / 0.72 : (1 / 0.72) * (h / w);
    cam.position.set(0, 0, half / Math.tan((cam.fov / 2) * (Math.PI / 180)));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }
  size();
  const onResize = () => { if (!stopped) size(); };
  addEventListener("resize", onResize);

  function frame(now) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const el = (now - t0) / 1000;

    if (!reduced) {
      let rot = START + DRIFT * el;
      if (turnAt >= 0) rot += TURN * easeInOutSine(clamp01((now - turnAt) / (reduced ? 1 : T.turnDur)));
      globe.rotation.y = rot;
      globe.rotation.x = 0.10 + 0.035 * Math.sin(el * 0.5);
      doves.step(el);
    } else {
      /* no spin: the still card shows the burning side already
         turned to face you, which is where the sequence lands */
      globe.rotation.y = START + TURN;
      globe.rotation.x = 0.10;
      doves.step(0);
    }

    /* the double outline: a wide faint wash, then the stroke
       landing inside it — a brush edge, not a vector one */
    setInk(1.5, 0.22);
    outline.render(scene, cam);
    setInk(1.0, 1.0);
    outline.renderOutline(scene, cam);
  }
  raf = requestAnimationFrame(frame);

  return {
    startTurn() { turnAt = performance.now(); },
    dispose() {
      stopped = true;
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      const lose = renderer.getContext().getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    },
  };
}

function isSoftware(renderer) {
  try {
    const g = renderer.getContext();
    const dbg = g.getExtension("WEBGL_debug_renderer_info");
    const d = dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
    return /swiftshader|llvmpipe|software|angle \(google/i.test(d);
  } catch (e) { return false; }
}

/* ---------- the ink and the flat fill, same recipe as the world ---------- */
function makeInk() {
  const data = new Uint8Array([
    0x84, 0x84, 0x84, 0xff,
    0xec, 0xec, 0xec, 0xff,
    0xff, 0xff, 0xff, 0xff,
  ]);
  const gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const inked = [];
  function register(m, outline) {
    if (outline === false) { m.userData.outlineParameters = { visible: false }; return m; }
    const w = typeof outline === "number" ? outline : 1;
    m.userData.outlineParameters = { thickness: INK_BASE * w, color: INK, alpha: 0.95, keepAlive: true };
    m.userData.inkWeight = w;
    inked.push(m);
    return m;
  }
  /* flatShading must be ASSIGNED, never passed: the constructor
     drops the key and you get a smooth ball with no facets */
  function toon(o = {}) {
    const { outline, ...rest } = o;
    const m = new THREE.MeshToonMaterial({ gradientMap, ...rest });
    m.flatShading = rest.flatShading !== false;
    return register(m, outline);
  }
  function flat(o = {}) {
    const { outline, ...rest } = o;
    return register(new THREE.MeshBasicMaterial({ toneMapped: false, ...rest }), outline);
  }
  return { toon, flat, gradientMap, inked };
}

/* ---------- the shape of the cover ---------- */
/* a wobbling meridian, so the seam is a drawn line rather than a
   geometric one — the cover's gold band bends */
function seamVal(x, y, z) {
  return x + 0.30 * Math.sin(y * 3.0 + 0.5) + 0.12 * Math.sin(y * 6.1 - 1.2) + 0.06 * Math.sin(z * 2.2 + 2.0);
}
function fbm(x, y, z) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    s += a * Math.sin(x * f * 2.13 + i * 1.7) * Math.sin(y * f * 1.87 + i * 2.31) * Math.sin(z * f * 2.41 + i * 0.93);
    a *= 0.52; f *= 2.03;
  }
  return s * 1.75;
}
function landVal(x, y, z) { return fbm(x * 2.0, y * 2.0, z * 2.0); }
function heightAt(x, y, z) {
  if (seamVal(x, y, z) > 0) {
    const n = landVal(x, y, z);
    return n > -0.05 ? 0.034 + 0.026 * n : -0.016;      /* land stands out of the water */
  }
  /* broken ground, no sea left — and rougher, so the burning limb
     is a torn edge rather than a clean circle */
  const cr = fbm(x * 3.4 + 11.2, y * 3.4 - 4.7, z * 3.4 + 2.9);
  const rd = fbm(x * 7.1 - 3.3, y * 7.1 + 8.8, z * 7.1 - 1.4);
  return 0.020 + 0.038 * cr + 0.012 * rd;
}
/* a stable per-face jitter, so the same planet is drawn every run.
   Kept small: the tone has to come from PATCHES of noise, never
   from the face index, or the ball turns into a checkerboard. */
function jitter(f) { return 1 + ((((f * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.038; }
function rnd(i) { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }

function buildGlobe(ink, detail) {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const dir = new Float32Array(n * 3);
  const a = new THREE.Vector3(), mid = new THREE.Vector3();
  const c = new THREE.Color();

  const K = (h) => new THREE.Color(h);
  const grassLit = K(C.grassLit), grass = K(C.grass), canopy = K(C.canopy), leafDark = K(C.leafDark);
  const water = K(C.water), waterDeep = K(C.waterDeep), waterPale = K(C.waterPale);
  const ashLit = K(C.ashLit), ash = K(C.ash), charred = K(C.charred), charDark = K(C.charDark), charSoot = K(C.charSoot);
  const burnt = K(C.burnt), ember = K(C.ember), goldC = K(C.gold);

  for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(pos, i).normalize();
    dir[i * 3] = a.x; dir[i * 3 + 1] = a.y; dir[i * 3 + 2] = a.z;
    const h = heightAt(a.x, a.y, a.z);
    pos.setXYZ(i, a.x * (1 + h), a.y * (1 + h), a.z * (1 + h));
  }

  const lavaTri = [], seamTri = [];
  for (let f = 0; f < n; f += 3) {
    mid.set(0, 0, 0);
    for (let k = 0; k < 3; k++) mid.add(a.set(dir[(f + k) * 3], dir[(f + k) * 3 + 1], dir[(f + k) * 3 + 2]));
    mid.normalize();
    const sv = seamVal(mid.x, mid.y, mid.z);
    const onSeam = Math.abs(sv) < 0.055;

    if (sv > 0) {
      /* the green half: land in tonal patches, water in two depths.
         Every choice comes from noise sampled at the face's own
         position, so tones pool into fields the way flat fills do
         on the cover — never off the face index. */
      const nn = landVal(mid.x, mid.y, mid.z);
      if (nn > -0.05) {
        const tv = fbm(mid.x * 3.3 + 21.7, mid.y * 3.3 - 9.1, mid.z * 3.3 + 4.2);
        c.copy(tv > 0.28 ? grassLit : tv > -0.10 ? grass : tv > -0.42 ? canopy : leafDark);
      } else {
        c.copy(nn < -0.42 ? waterDeep : nn < -0.20 ? water : waterPale);
      }
    } else {
      /* the burning half: ash to charcoal in fields, with ember
         veins cut through it. Lava is a small share of the face
         count on purpose — pools and cracks, not a paint job. */
      const tv = fbm(mid.x * 1.7 - 6.4, mid.y * 1.7 + 3.9, mid.z * 1.7 + 7.6);
      /* weighted to the two ends — pale ash and near-black char —
         with only a thin band of mid-brown between them, so the
         burning half reads GRAPHIC instead of camouflage */
      c.copy(tv > 0.30 ? ashLit : tv > -0.02 ? ash : tv > -0.26 ? charred
        : tv > -0.50 ? charDark : charSoot);
      const lv = fbm(mid.x * 4.3 + 5.3, mid.y * 4.3 + 2.1, mid.z * 4.3 - 3.7);
      if (lv > 0.56 && !onSeam) lavaTri.push(f);
      else if (lv > 0.44 && !onSeam) c.copy(burnt);   /* ember red banding the vein */
      else if (lv > 0.34 && !onSeam) c.copy(ember);   /* and the scorch ring outside it */
    }
    if (onSeam) { c.copy(goldC); seamTri.push(f); }

    c.multiplyScalar(jitter(f));
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = c.r; colors[(f + k) * 3 + 1] = c.g; colors[(f + k) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  group.add(new THREE.Mesh(geo, ink.toon({ vertexColors: true, outline: 1.6 })));

  /* the lava, and the gold seam, as unlit overlays lifted a hair
     off the crust: flat colour the sun cannot touch, which is how
     both are painted on the cover */
  const lava = liftFaces(geo, lavaTri, 1.004, [C.lava, C.lavaHot, C.lava]);
  if (lava) group.add(new THREE.Mesh(lava, ink.flat({ vertexColors: true, outline: 0.55 })));
  const seam = liftFaces(geo, seamTri, 1.010, [C.gold, C.goldHot, C.goldHot]);
  if (seam) group.add(new THREE.Mesh(seam, ink.flat({ vertexColors: true, outline: 0.5 })));

  const bake = baker();
  addCanopy(bake, ink);
  addTown(bake, ink);
  addRuin(bake, ink);
  addSmoke(bake, ink);
  addClouds(bake, ink);
  bake.flush(group);
  return group;
}

/* copy a set of faces out of the crust and float them just above it */
function liftFaces(src, tris, lift, hexes) {
  if (!tris.length) return null;
  const sp = src.attributes.position;
  const p = new Float32Array(tris.length * 9);
  const col = new Float32Array(tris.length * 9);
  const v = new THREE.Vector3();
  const cols = hexes.map((h) => new THREE.Color(h));
  let o = 0;
  for (const f of tris) {
    const c = cols[(f * 11 >>> 0) % cols.length];
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(sp, f + k).multiplyScalar(lift);
      p[o] = v.x; p[o + 1] = v.y; p[o + 2] = v.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      o += 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/* ---------- baking the props down ----------
   Every tree, slab, puff and building is authored as its own little
   Object3D because that is the only sane way to write them, and
   then BAKED into one geometry per material before it ever reaches
   the renderer. Six hundred outlined meshes is eighteen hundred
   draw calls once the double ink pass runs; baked, it is about
   fifteen. The picture is identical and the sequence actually
   holds its timing on a phone. */
function baker() {
  const byMat = new Map();
  const v = new THREE.Vector3(), w = new THREE.Vector3(), m3 = new THREE.Matrix3();
  function append(bin, geo, mat4) {
    const p = geo.attributes.position, n = geo.attributes.normal, idx = geo.index;
    m3.getNormalMatrix(mat4);
    const one = (i) => {
      v.fromBufferAttribute(p, i).applyMatrix4(mat4);
      bin.pos.push(v.x, v.y, v.z);
      w.fromBufferAttribute(n, i).applyMatrix3(m3).normalize();
      bin.nrm.push(w.x, w.y, w.z);
    };
    if (idx) for (let i = 0; i < idx.count; i++) one(idx.getX(i));
    else for (let i = 0; i < p.count; i++) one(i);
  }
  return {
    add(obj) {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        let bin = byMat.get(o.material);
        if (!bin) { bin = { pos: [], nrm: [] }; byMat.set(o.material, bin); }
        append(bin, o.geometry, o.matrixWorld);
      });
    },
    flush(group) {
      for (const [mat, bin] of byMat) {
        if (!bin.pos.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(bin.pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(bin.nrm, 3));
        g.computeBoundingSphere();
        group.add(new THREE.Mesh(g, mat));
      }
      byMat.clear();
    },
  };
}

/* stand a thing on the sphere without ever combing the hairy ball
   flat: build the frame from a reference that is never parallel to
   the normal, so there is no pole to lock at */
const _ref = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _m = new THREE.Matrix4();
function standOn(obj, nx, ny, nz, r) {
  const up = new THREE.Vector3(nx, ny, nz).normalize();
  _ref.set(0, 1, 0);
  if (Math.abs(_ref.dot(up)) > 0.94) _ref.set(1, 0, 0);
  _r.crossVectors(_ref, up).normalize();
  _f.crossVectors(up, _r).normalize();
  _m.makeBasis(_r, up, _f);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(up).multiplyScalar(r);
}

/* Scatter points evenly over the sphere on a Fibonacci spiral, so
   there is no clumping at a pole and no bald patch anywhere — the
   silhouette has to be broken at EVERY angle of the turn, not only
   on the face that happens to start toward camera. */
function* onSphere(n, seed) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * ga + seed;
    yield [r * Math.cos(th), y, r * Math.sin(th), i];
  }
}

/* the green side: canopy as bold blobs, the way the refs draw a
   tree — a graphic mass, not a trunk with leaves modelled on it */
function addCanopy(bake, ink) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const trunkG = new THREE.CylinderGeometry(0.008, 0.011, 0.05, 5);
  const mats = [
    ink.toon({ color: C.canopy, outline: 1.2 }),
    ink.toon({ color: C.leafDark, outline: 1.2 }),
    ink.toon({ color: C.grass, outline: 1.2 }),
  ];
  const barkM = ink.toon({ color: C.bark, outline: 1.1 });
  for (const [x, y, z, i] of onSphere(420, 0.7)) {
    if (seamVal(x, y, z) < 0.10) continue;
    if (landVal(x, y, z) < 0.02) continue;              /* keep them out of the water */
    if (rnd(i * 3.7) > 0.70) continue;
    const r = 1 + heightAt(x, y, z);
    const tree = new THREE.Group();
    const sc = 0.042 + rnd(i * 13.3) * 0.038;
    const crown = new THREE.Mesh(g, mats[i % 3]);
    crown.scale.set(sc, sc * (0.82 + rnd(i * 5.5) * 0.6), sc);
    crown.position.y = 0.038 + sc * 0.6;
    const trunk = new THREE.Mesh(trunkG, barkM);
    trunk.position.y = 0.024;
    tree.add(trunk, crown);
    standOn(tree, x, y, z, r);
    bake.add(tree);
  }
}

/* a few blocks of the standing world, so the green limb has
   architecture on it the way the reference planet does — flat
   pastel walls, one ink line, a roof box */
function addTown(bake, ink) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = [
    ink.toon({ color: 0xeae5d6, outline: 1.25 }),
    ink.toon({ color: 0xe0ac9e, outline: 1.25 }),
    ink.toon({ color: 0xc6c8bf, outline: 1.25 }),
    ink.toon({ color: 0xe0b453, outline: 1.25 }),
  ];
  const roofM = ink.toon({ color: 0xb0554c, outline: 1.25 });
  let placed = 0;
  for (const [x, y, z, i] of onSphere(160, 2.3)) {
    if (placed >= 22) break;
    if (seamVal(x, y, z) < 0.18) continue;
    if (landVal(x, y, z) < 0.14) continue;
    const r = 1 + heightAt(x, y, z);
    const b = new THREE.Group();
    const w = 0.045 + rnd(i * 2.9) * 0.035;
    const h = 0.055 + rnd(i * 6.1) * 0.075;
    const body = new THREE.Mesh(box, walls[i % 4]);
    body.scale.set(w, h, w * (0.7 + rnd(i * 4.4) * 0.6));
    body.position.y = h / 2;
    const roof = new THREE.Mesh(box, roofM);
    roof.scale.set(w * 1.18, 0.012, w * 0.95);
    roof.position.y = h + 0.006;
    b.add(body, roof);
    b.rotation.y = rnd(i * 8.2) * Math.PI;
    standOn(b, x, y, z, r);
    b.rotateOnAxis(new THREE.Vector3(0, 1, 0), rnd(i * 8.2) * Math.PI);
    bake.add(b);
    placed++;
  }
}

/* the burning side: dead trees as stark inked spikes, broken
   slabs leaning out of the ground, and rubble — all of it drawn
   as silhouette, all of it breaking the circle */
function addRuin(bake, ink) {
  const spike = new THREE.ConeGeometry(0.010, 0.16, 4);
  const limb = new THREE.BoxGeometry(1, 1, 1);
  const chunk = new THREE.IcosahedronGeometry(1, 0);
  const barkM = ink.toon({ color: 0x4e3a30, outline: 1.4 });
  const slabM = ink.toon({ color: C.ash, outline: 1.35 });
  const slabM2 = ink.toon({ color: C.charred, outline: 1.35 });
  const rockM = ink.toon({ color: C.charDark, outline: 1.2 });
  const rockM2 = ink.toon({ color: C.ashLit, outline: 1.2 });

  for (const [x, y, z, i] of onSphere(460, 4.1)) {
    if (seamVal(x, y, z) > -0.08) continue;
    const r = 1 + heightAt(x, y, z);
    const roll = rnd(i * 17.1);
    if (roll > 0.66) {
      /* a burnt tree: a bare spike with two broken limbs */
      const t = new THREE.Group();
      const sc = 0.7 + rnd(i * 3.9) * 0.75;
      const trunk = new THREE.Mesh(spike, barkM);
      trunk.scale.set(sc, sc, sc);
      trunk.position.y = 0.16 * sc * 0.5;
      t.add(trunk);
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(limb, barkM);
        b.scale.set(0.045 * sc, 0.007, 0.007);
        b.position.set(0.02 * sc * (k ? 1 : -1), 0.10 * sc, 0);
        b.rotation.z = (k ? -1 : 1) * (0.5 + rnd(i + k) * 0.5);
        t.add(b);
      }
      standOn(t, x, y, z, r);
      t.rotateOnAxis(new THREE.Vector3(0, 0, 1), (rnd(i * 4.4) - 0.5) * 0.45);
      bake.add(t);
    } else if (roll > 0.40) {
      /* a slab of a building, leaning, half down */
      const s = new THREE.Mesh(limb, rnd(i * 6.6) > 0.5 ? slabM : slabM2);
      const w = 0.035 + rnd(i * 5.1) * 0.045;
      const h = 0.05 + rnd(i * 9.3) * 0.10;
      s.scale.set(w, h, w * 0.5);
      s.position.y = h * 0.42;
      const holder = new THREE.Group();
      holder.add(s);
      standOn(holder, x, y, z, r);
      holder.rotateOnAxis(new THREE.Vector3(0, 1, 0), rnd(i * 2.2) * Math.PI);
      holder.rotateOnAxis(new THREE.Vector3(0, 0, 1), (rnd(i * 7.4) - 0.5) * 0.9);
      bake.add(holder);
    } else if (roll > 0.18) {
      const m = new THREE.Mesh(chunk, rnd(i * 6.6) > 0.5 ? rockM : rockM2);
      const sc = 0.016 + rnd(i * 8.8) * 0.026;
      m.scale.set(sc * 1.4, sc * 0.7, sc);
      standOn(m, x, y, z, r + sc * 0.25);
      bake.add(m);
    }
  }
}

/* Smoke drawn as FLAT grey shapes with outlines, the way the art
   bible calls it — never a particle system, never a soft sprite.
   It goes up in PLUMES from the ground, three or four blobs
   stacked and tapering, so it reads as drawn smoke instead of
   rocks in orbit. */
function addSmoke(bake, ink) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const m1 = ink.toon({ color: C.smoke, outline: 1.0 });
  const m2 = ink.toon({ color: C.smokeDark, outline: 1.0 });
  let placed = 0;
  for (const [x, y, z, i] of onSphere(220, 6.9)) {
    if (placed >= 9) break;
    if (seamVal(x, y, z) > -0.26) continue;
    if (rnd(i * 4.7) > 0.34) continue;
    const plume = new THREE.Group();
    const n = 4 + (rnd(i * 2.1) > 0.5 ? 1 : 0);
    const lean = (rnd(i * 3.3) - 0.5) * 0.55;
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(g, k % 2 ? m1 : m2);
      /* it opens as it climbs, the way a column of smoke is drawn */
      const sc = (0.026 + rnd(i * 6.1 + k) * 0.013) * (1 + k * 0.20);
      b.scale.set(sc * 1.15, sc * 0.86, sc);
      b.position.set(lean * k * 0.045 + (rnd(i + k) - 0.5) * 0.018,
        0.024 + k * 0.036, (rnd(i - k) - 0.5) * 0.016);
      plume.add(b);
    }
    standOn(plume, x, y, z, 1 + heightAt(x, y, z));
    bake.add(plume);
    placed++;
  }
}

/* and clouds over the green side, painted the same flat way */
function addClouds(bake, ink) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const m = ink.toon({ color: C.cloud, outline: 0.55 });
  let placed = 0;
  for (const [x, y, z, i] of onSphere(180, 9.4)) {
    if (placed >= 9) break;
    if (seamVal(x, y, z) < 0.24) continue;
    if (landVal(x, y, z) > -0.10) continue;   /* they sit over the water, as on the cover */
    if (rnd(i * 5.9) > 0.55) continue;
    const lift = 1.10 + rnd(i * 3.3) * 0.08;
    const puff = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(g, m);
      const sc = 0.016 + rnd(i * 10 + k) * 0.016;
      b.scale.set(sc * 1.45, sc * 0.62, sc * 0.95);
      b.position.set((k - 1.5) * sc * 1.6, (rnd(i + k) - 0.5) * sc * 0.4, (rnd(i - k) - 0.5) * sc);
      puff.add(b);
    }
    standOn(puff, x, y, z, lift);
    bake.add(puff);
    placed++;
  }
}

/* the doves off the cover, circling the whole thing */
function buildDoves(ink) {
  const group = new THREE.Group();
  const body = new THREE.IcosahedronGeometry(1, 1);
  const wing = new THREE.BoxGeometry(1, 0.06, 0.5);
  const mat = ink.toon({ color: C.dove, outline: 1.25 });
  const birds = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Group();
    const core = new THREE.Mesh(body, mat);
    core.scale.set(0.030, 0.022, 0.048);
    b.add(core);
    const wl = new THREE.Mesh(wing, mat); wl.scale.set(0.115, 0.5, 0.052);
    const wr = wl.clone();
    wl.position.x = -0.058; wr.position.x = 0.058;
    wl.position.z = -0.014; wr.position.z = -0.014;
    wl.rotation.y = 0.42; wr.rotation.y = -0.42;
    wl.rotation.z = 0.30; wr.rotation.z = -0.30;
    /* a tail, so the silhouette is a bird and not a cross */
    const tail = new THREE.Mesh(wing, mat);
    tail.scale.set(0.030, 0.5, 0.046);
    tail.position.z = -0.048;
    b.add(wl, wr, tail);
    const holder = new THREE.Group();
    holder.add(b);
    holder.rotation.z = 0.5 + i * 0.55;
    holder.rotation.x = -0.32 + i * 0.24;
    b.position.set(1.34 + i * 0.10, 0, 0);
    group.add(holder);
    birds.push({ holder, b, wl, wr, sp: 0.30 + i * 0.06, ph: i * 2.1 });
  }
  return {
    group,
    step(t) {
      for (const k of birds) {
        k.holder.rotation.y = k.ph + t * k.sp;
        k.b.rotation.z = Math.PI / 2;
        const flap = Math.sin(t * 6.2 + k.ph) * 0.55;
        k.wl.rotation.z = 0.35 + flap;
        k.wr.rotation.z = -0.35 - flap;
      }
    },
  };
}
