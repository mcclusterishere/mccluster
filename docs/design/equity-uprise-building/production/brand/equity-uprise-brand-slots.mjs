// Equity Uprise brand slots — runtime artwork application.
//
// Builders emit empty glTF nodes named `brand-slot::<id>` whose extras
// (three.js: node.userData.brand_slot) describe where a mark may go. This
// module places the OWNER-SUPPLIED artwork named in brand-manifest.json on each
// enabled slot as one textured plane, scaled proportionally to fit inside the
// slot (contain). It never crops, stretches, recolours, traces or adds a plate.
//
// Usage (three.js r150+):
//   import { applyBrandSlots } from './equity-uprise-brand-slots.mjs';
//   await applyBrandSlots(THREE, gltf.scene, manifest, { baseUrl: '/' });
//
// To give the building a new logo, change the manifest's artwork path; nothing
// here or in the GLBs changes.

export function containSize(maxW, maxH, aspect) {
  if (!(maxW > 0 && maxH > 0 && aspect > 0)) throw new Error('brand slot: invalid size or aspect');
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  return { width: w, height: h };
}

export function resolveArtwork(manifest, slot) {
  if (!slot || slot.enabled === false) return null;
  const key = slot.artwork || 'default';
  const art = manifest.artwork ? manifest.artwork[key] : null;
  if (!art || !art.path) return null; // empty slot: correct when the owner has not supplied this variant
  if (art.source !== 'owner-supplied' && !String(art.source || '').startsWith('owner-requested')) {
    throw new Error(`brand slot ${slot.id}: artwork ${art.path} is not owner-supplied`);
  }
  return art;
}

function loadTexture(THREE, url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

export async function applyBrandSlots(THREE, root, manifest, opts = {}) {
  const baseUrl = opts.baseUrl ?? '/';
  const FT = 0.3048;
  const placed = [];
  const slots = [];
  root.traverse((o) => {
    if (o.name && o.name.startsWith('brand-slot::') && o.userData && o.userData.brand_slot) slots.push(o);
  });
  const cache = new Map();
  for (const node of slots) {
    const rec = node.userData.brand_slot;
    const live = (manifest.slots || []).find((s) => s.id === rec.id) || rec; // manifest wins: re-branding needs no GLB rebuild
    const art = resolveArtwork(manifest, live);
    if (!art) continue;
    const url = baseUrl.replace(/\/?$/, '/') + art.path.replace(/^\//, '');
    if (!cache.has(url)) cache.set(url, loadTexture(THREE, url));
    const tex = await cache.get(url);
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const img = tex.image || {};
    const aspect = img.width && img.height ? img.width / img.height : (art.aspect || 1);
    const { width, height } = containSize(live.max_width_ft * FT, live.max_height_ft * FT, aspect);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !!art.transparent, side: THREE.FrontSide, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    plane.name = `brand-artwork::${live.id}`;
    // Orient the plane: +Z of the plane -> slot normal, +Y -> slot up (building frame == GLB frame).
    const n = new THREE.Vector3(...live.normal).normalize();
    const up = new THREE.Vector3(...(live.up || [0, 0, 1])).normalize();
    const x = new THREE.Vector3().crossVectors(up, n).normalize();
    const y = new THREE.Vector3().crossVectors(n, x).normalize();
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
    // slot nodes sit at the GLB origin; the record carries the position (building feet, absolute Z)
    const zOrigin = rec.glb_origin_z_ft || 0;
    plane.position.set(live.center_ft[0] * FT, live.center_ft[1] * FT, (live.center_ft[2] - zOrigin) * FT).add(n.clone().multiplyScalar(0.006));
    node.add(plane);
    placed.push({ id: live.id, url, width_m: width, height_m: height });
  }
  return placed;
}
