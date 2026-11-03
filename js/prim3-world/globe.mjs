/* PRIM3 World: the clickable country globe.

   Reused rather than reinvented:
   - three.js 0.180.0 from jsdelivr, the same build and import map the tactics game already loads
     (prim3-transit.html), with its OrbitControls for one-finger rotate and pinch zoom. Cesium (the World's and
     Analytics' engine) is several megabytes and a separate runtime; nothing here needs terrain or imagery.
   - data/geo/country-boundaries-110m.json, the Natural Earth 1:110m countries the Analytics globe already ships
     (public domain, ISO alpha-2 codes, 134 KB): the lightest country set in the repo with every cast nation in it.
   - js/world-countries.js's countryAt (point in country, holes respected), the World globe's own tap test.

   The map is painted once into a 2048 x 1024 equirectangular canvas and wrapped on a sphere; it is repainted only
   when the highlight changes. There are no pins (owner, 2026-11-02): countries with a stationed agent are teal, the
   three featured characters' countries carry an amber edge, and a tap on a country opens its card. Day look. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../world-countries.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const TEX_W = 2048, TEX_H = 1024;
const MIN_D = 1.32, MAX_D = 4.2;
const COLORS = {
  sea: '#cfdfe8', land: '#f6f8f8', border: 'rgba(22,32,42,.30)', grat: 'rgba(22,32,42,.07)',
  mission: 'rgba(15,169,186,.42)', missionDim: 'rgba(15,169,186,.16)', missionEdge: 'rgba(11,128,142,.85)',
  selected: 'rgba(15,169,186,.78)', selectedEdge: '#16202a', featuredEdge: '#d98a0a'
};

export function toVec(lat, lon, r = 1) {
  const phi = (90 - lat) * D2R, theta = (lon + 180) * D2R;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}
export function toLatLon(v) {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, n.y))) * R2D;
  let phi = Math.atan2(n.z, -n.x); if (phi < 0) phi += 2 * Math.PI;
  let lon = phi * R2D - 180; if (lon < -180) lon += 360; if (lon >= 180) lon -= 360;
  return { lat, lon };
}
function featuresOf(data) {
  return (data.countries || []).map((c) => {
    let b = [180, 90, -180, -90];
    const coordinates = (c.p || []).map((poly) => poly.map((flat) => {
      const ring = [];
      for (let i = 0; i + 1 < flat.length; i += 2) { const lon = flat[i], lat = flat[i + 1]; ring.push([lon, lat]); if (lon < b[0]) b[0] = lon; if (lat < b[1]) b[1] = lat; if (lon > b[2]) b[2] = lon; if (lat > b[3]) b[3] = lat; }
      if (ring.length) ring.push(ring[0].slice());
      return ring;
    }));
    return { type: 'Feature', properties: { a2: c.c, name: c.n, bbox: b }, geometry: { type: 'MultiPolygon', coordinates } };
  });
}

export function createGlobe(host, opts = {}) {
  const C = globalThis.HuCountries;
  const reduced = !!opts.reducedMotion;
  const stage = document.createElement('div'); stage.className = 'pw-globe-stage';
  host.append(stage);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
  camera.position.copy(toVec(opts.start?.lat ?? 28, opts.start?.lon ?? -30, 3.1));
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enablePan: false, enableDamping: !reduced, dampingFactor: 0.09, minDistance: MIN_D, maxDistance: MAX_D, rotateSpeed: 0.55, zoomSpeed: 0.8 });
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  const canvas = document.createElement('canvas'); canvas.width = TEX_W; canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.MeshBasicMaterial({ map: texture }));
  scene.add(globe);
  // a thin rim so the sphere reads against the page
  const rim = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 48), new THREE.MeshBasicMaterial({ color: 0x0fa9ba, transparent: true, opacity: 0.10, side: THREE.BackSide }));
  scene.add(rim);

  let features = [], highlight = { codes: new Set(), dim: new Set(), featured: new Set(), selected: null };
  let anim = null, alive = true;

  const X = (lon) => ((lon + 180) / 360) * TEX_W, Y = (lat) => ((90 - lat) / 180) * TEX_H;
  function tracePoly(poly) {
    for (const ring of poly) { ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(X(lon), Y(lat)) : ctx.moveTo(X(lon), Y(lat)))); ctx.closePath(); }
  }
  function paint() {
    ctx.fillStyle = COLORS.sea; ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = COLORS.grat; ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) { ctx.beginPath(); ctx.moveTo(X(lon), 0); ctx.lineTo(X(lon), TEX_H); ctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); ctx.moveTo(0, Y(lat)); ctx.lineTo(TEX_W, Y(lat)); ctx.stroke(); }
    for (const f of features) {
      const code = f.properties.a2;
      const sel = code && code === highlight.selected, on = code && highlight.codes.has(code), dim = code && highlight.dim.has(code), feat = code && highlight.featured.has(code);
      ctx.beginPath(); for (const poly of f.geometry.coordinates) tracePoly(poly);
      ctx.fillStyle = COLORS.land; ctx.fill('evenodd');
      if (sel || on || dim) { ctx.fillStyle = sel ? COLORS.selected : on ? COLORS.mission : COLORS.missionDim; ctx.fill('evenodd'); }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = sel ? COLORS.selectedEdge : feat && on ? COLORS.featuredEdge : on ? COLORS.missionEdge : COLORS.border;
      ctx.lineWidth = sel ? 2.6 : feat && on ? 3 : on ? 1.6 : 1;
      ctx.stroke();
    }
    texture.needsUpdate = true;
  }

  const ready = fetch(opts.boundariesUrl || 'data/geo/country-boundaries-110m.json')
    .then((r) => { if (!r.ok) throw Error('Country shapes did not load (' + r.status + ')'); return r.json(); })
    .then((data) => { features = featuresOf(data); paint(); return true; });

  const tmp = new THREE.Vector3();

  /* ---------- taps ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hitAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(globe, false)[0];
    return hit ? toLatLon(hit.point) : null;
  }
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 8 || dt > 600) return;
    const ll = hitAt(e.clientX, e.clientY); if (!ll) return;
    const f = C && C.countryAt(features, ll.lon, ll.lat);
    opts.onCountry && opts.onCountry(f ? f.properties.a2 : null, f ? f.properties.name : null, ll);
  });
  /* ---------- camera ---------- */
  function focus(lat, lon, dist) {
    const d = Math.max(MIN_D, Math.min(MAX_D, dist || camera.position.length()));
    const to = toVec(lat, lon, 1).normalize(), from = camera.position.clone().normalize(), fromD = camera.position.length();
    if (reduced) { camera.position.copy(to.multiplyScalar(d)); controls.update(); return; }
    anim = { from, to, fromD, toD: d, t0: performance.now(), ms: 700 };
  }
  function zoom(dir) {
    const d = Math.max(MIN_D, Math.min(MAX_D, camera.position.length() * (dir > 0 ? 0.8 : 1.25)));
    anim = null; camera.position.setLength(d); controls.update();
  }
  function step(now) {
    if (!anim) return;
    const k = Math.min(1, (now - anim.t0) / anim.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const q = new THREE.Quaternion().setFromUnitVectors(anim.from, anim.to);
    const v = anim.from.clone().applyQuaternion(new THREE.Quaternion().slerp(q, e));
    camera.position.copy(v.multiplyScalar(anim.fromD + (anim.toD - anim.fromD) * e));
    if (k >= 1) anim = null;
  }

  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(stage); resize();
  renderer.setAnimationLoop((now) => {
    if (!alive) return;
    step(now); controls.update(); renderer.render(scene, camera);
  });

  return {
    ready,
    setHighlight({ codes = [], dim = [], featured = [], selected = null } = {}) { highlight = { codes: new Set(codes), dim: new Set(dim), featured: new Set(featured), selected }; if (features.length) paint(); },
    focus, zoom,
    reset() { focus(opts.start?.lat ?? 28, opts.start?.lon ?? -30, 3.1); },
    countryAt(lat, lon) { const f = C && C.countryAt(features, lon, lat); return f ? { code: f.properties.a2, name: f.properties.name } : null; },
    countries() { return features.filter((f) => f.properties.a2).map((f) => ({ code: f.properties.a2, name: f.properties.name })).sort((a, b) => a.name.localeCompare(b.name)); },
    screenOf(lat, lon) { tmp.copy(toVec(lat, lon, 1)).project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (tmp.x * 0.5 + 0.5) * r.width, y: r.top + (-tmp.y * 0.5 + 0.5) * r.height }; },
    busy() { return !!anim; },
    destroy() { alive = false; renderer.setAnimationLoop(null); ro.disconnect(); controls.dispose(); renderer.dispose(); texture.dispose(); host.textContent = ''; }
  };
}
