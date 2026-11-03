/* Additive Bridgeport block: sourced footprints where supplied, illustrative facades/heights.
   The established harbor and HQ geometry stay in scene.mjs. No third-party storefront marks.
   Only the land surfaces are resident; everything else here is built per streamed chunk (neighborhood-chunks.mjs). */
import * as THREE from 'three';
import { yardFixtures } from './spatial.mjs';

const PALETTE = { paving: '#c9bdab', curb: '#e8dfce', road: '#565d60', brick: '#a56e55', trim: '#e7d9bd',
  glass: '#456064', iron: '#3c4b4a', roof: '#62645b', amber: '#d2a65f' };

/* Resident ground: one slab per land surface, so streaming can never open a hole under a body. Streets, signs, lamps,
   trees and buildings stream per chunk (neighborhood-chunks.mjs → buildNeighborhoodChunk). */
export function buildNeighborhoodGround({ neighborhoods, batch }) {
  for (const neighborhood of neighborhoods) for (const s of neighborhood.surfaces || []) {
    batch.add('box', PALETTE.paving, (s.minX + s.maxX) / 2, -.32, (s.minZ + s.maxZ) / 2, s.maxX - s.minX, .8, s.maxZ - s.minZ);
  }
}

/* One streamed chunk of a surveyed neighbourhood: its street pieces, painted dashes, road-name posts, lamps, trees
   and buildings. `batch` is the chunk's shared instanced batch (streets and furniture); every building gets its own
   batch via `placeBatch()` so its windows live in bins bounded by that building alone and the renderer's frustum test
   drops them whenever the building is off screen. `targetFor(id)` returns the stable interaction target the scene
   registered at start-up, so picking, prompts and occlusion fades survive any number of unload/reload cycles. */
export function buildNeighborhoodChunk(chunk, { batch, placeBatch, parent, kit, tree, lamp, placeById, targetFor, pickables, tag = () => {} }) {
  const box = (color, x, y, z, w, h, d, rotation) => batch.add('box', color, x, y, z, w, h, d, rotation);
  for (const r of chunk.roads || []) {
    if (r.rect) {
      const { x, z, width: w, depth: d } = r;
      box(PALETTE.curb, x, .11, z, w + 5.2, .12, d + 5.2);
      box(PALETTE.road, x, .18, z, w, .055, d);
      const horizontal = w >= d, length = horizontal ? w : d;
      for (let at = -length / 2 + 3; at < length / 2 - 2; at += 8) box('#ded3ae', x + (horizontal ? at : 0), .215, z + (horizontal ? 0 : at), horizontal ? 3.5 : .16, .018, horizontal ? .16 : 3.5);
      continue;
    }
    const dx = r.bx - r.ax, dz = r.bz - r.az, length = Math.hypot(dx, dz); if (length < .05) continue;
    const angle = -Math.atan2(dz, dx), ux = dx / length, uz = dz / length;
    // the kerb and road surface overhang only a segment's real ends; pieces of one segment abut exactly
    const kerbStart = r.startCap ? 1.2 : 0, kerbEnd = r.endCap ? 1.2 : 0, roadStart = r.startCap ? .075 : 0, roadEnd = r.endCap ? .075 : 0;
    const kerbLength = length + kerbStart + kerbEnd, roadLength = length + roadStart + roadEnd;
    const kcx = (r.ax + r.bx) / 2 + ux * (kerbEnd - kerbStart) / 2, kcz = (r.az + r.bz) / 2 + uz * (kerbEnd - kerbStart) / 2;
    const rcx = (r.ax + r.bx) / 2 + ux * (roadEnd - roadStart) / 2, rcz = (r.az + r.bz) / 2 + uz * (roadEnd - roadStart) / 2;
    box(PALETTE.curb, kcx, .11, kcz, kerbLength, .12, r.width + (r.width <= 3 ? 0 : 4.4), [0, angle, 0]);
    box(PALETTE.road, rcx, .18, rcz, roadLength, .055, r.width, [0, angle, 0]);
  }
  for (const d of chunk.dashes || []) box('#ded3ae', d.x, .215, d.z, d.length, .018, .16, [0, d.angle, 0]);
  for (const s of chunk.signs || []) {
    batch.add('cylinder', PALETTE.iron, s.x, 2.0, s.z, .12, 3.8, .12);
    // Road names are ordinary wayfinding, distinct from any supplied company artwork.
    const sign = kit.sign(parent, s.name, '', { x: s.x, y: 3.7, z: s.z, width: 8.5, height: .95, background: '#34574f', accent: '#d8c69c' });
    tag(sign, 'neighborhood:signs');
  }
  for (const p of chunk.lamps || []) lamp(p[0], p[1]);
  for (const p of chunk.trees || []) tree(p[0], p[1], p[2] || 0);
  for (const id of chunk.places || []) {
    const b = placeById.get(id), target = targetFor(id);
    if (!b || !target) continue;
    const own = placeBatch();
    buildNeighborhoodPlace(b, { batch: own, parent, kit, target, pickables, tag });
    for (const m of own.finish()) { tag(m, b.footprint ? 'neighborhood:windows+facades' : 'neighborhood:massing'); if (m.userData.instanceTargets.some(Boolean)) pickables.push(m); }
  }
}

function polygonFace(b) {
  const ring = b.footprint;
  let best = null, distance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 2.4) continue;
    const t = Math.max(.1, Math.min(.9, ((b.entrance[0] - a[0]) * dx + (b.entrance[1] - a[1]) * dz) / (length * length)));
    const x = a[0] + dx * t, z = a[1] + dz * t, d = Math.hypot(b.entrance[0] - x, b.entrance[1] - z);
    if (d >= distance) continue;
    distance = d;
    let nx = dz / length, nz = -dx / length;
    if ((b.entrance[0] - x) * nx + (b.entrance[1] - z) * nz < 0) { nx *= -1; nz *= -1; }
    best = { x, z, nx, nz, yaw: Math.atan2(nx, nz), width: Math.min(t, 1 - t) * length * 2, edgeIndex: i };
  }
  return best;
}

function polygonBody(b, parent, kit, target, height) {
  const ring = b.footprint;
  const shape = new THREE.Shape(ring.map(p => new THREE.Vector2(p[0], -p[1])));
  for (const hole of b.footprintHoles || []) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p[0], -p[1]))));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  const material = kit.material(b.color || PALETTE.brick).clone();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = .16; mesh.userData.target = target; mesh.userData.solidBuilding = true;
  mesh.userData.ownedGeometry = geometry; mesh.userData.ownedMaterial = material; parent.add(mesh);
  return mesh;
}

function polygonWindows(b, batch, target, height) {
  const ring = b.footprint;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length]; area += a[0] * c[1] - c[0] * a[1];
  }
  const direction = area >= 0 ? 1 : -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 4) continue;
    const nx = dz / length * direction, nz = -dx / length * direction, yaw = Math.atan2(nx, nz);
    const columns = Math.floor((length - 1) / 3.1);
    for (let y = 5.2; y + 1 < height; y += 3.1) for (let col = 0; col < columns; col++) {
      const t = (col + .5) / columns, x = a[0] + dx * t, z = a[1] + dz * t;
      batch.add('box', PALETTE.trim, x + nx * .04, y, z + nz * .04, 1.15, 1.8, .08, [0, yaw, 0], target);
      batch.add('box', PALETTE.glass, x + nx * .10, y, z + nz * .10, .93, 1.55, .065, [0, yaw, 0], target);
      batch.add('box', PALETTE.trim, x + nx * .14, y - .9, z + nz * .14, 1.3, .12, .28, [0, yaw, 0], target);
    }
  }
}

export function buildNeighborhoodPlace(b, { batch, parent, kit, target, pickables, tag = () => {} }) {
  const [x, z] = b.position, [w, d, rawH] = b.size, h = rawH || 10;
  const style = b.style || 'brick-row', front = b.entrance[1] > z ? 1 : -1;
  const box = (color, bx, by, bz, bw, bh, bd, rotation) => batch.add('box', color, bx, by, bz, bw, bh, bd, rotation, target);
  batch.setTarget(target);

  if (style === 'yard') {
    box('#8a8b7a', x, .14, z, w, .06, d);
    for (const f of yardFixtures(b)) {
      if (f.type === 'table') {
        box('#877150', f.x, f.height, f.z, f.w, .15, f.d);
        for (const side of [-1, 1]) box('#4e5850', f.x + side * .9, .57, f.z, .13, 1.0, .9);
        box('#e3d5b4', f.x - .25, 1.17, f.z, .14, .14, .14);
        box('#e3d5b4', f.x + .22, 1.17, f.z + .2, .14, .14, .14);
      } else if (f.type === 'car') {
        const color = /west/.test(f.id) ? '#8b9b8a' : '#b6aa8f';
        box(color, f.x, .75, f.z, f.w, .85, f.d - .3);
        box(color, f.x - .25, 1.3, f.z, f.w * .55, .6, f.d - .4);
        box('#415b60', f.x - .25, 1.35, f.z + f.d / 2 - .18, f.w * .48, .4, .045);
        box('#415b60', f.x - .25, 1.35, f.z - f.d / 2 + .18, f.w * .48, .4, .045);
        box('#415b60', f.x + f.w * .24, 1.35, f.z, .04, .4, f.d - .6);
        for (const side of [-1, 1]) {
          box('#e5dabc', f.x + f.w / 2 + .01, .85, f.z + side * .73, .04, .2, .4);
          for (const end of [-1, 1]) batch.add('cylinder', '#313b3a', f.x + end * 1.55, .5, f.z + side * (f.d / 2 - .13), .85, .25, .85, [Math.PI / 2, 0, 0], target);
        }
      } else {
        box('#6c7469', f.x, 1.05, f.z, f.w, .09, .1);
        box('#6c7469', f.x, 1.75, f.z, f.w, .09, .1);
        for (let at = -f.w / 2; at <= f.w / 2; at += 2.5) box('#6c7469', f.x + at, .98, f.z, .11, 1.8, .12);
      }
    }
    const sign = kit.sign(parent, b.name, b.tagline || b.category || (b.yardType === 'vehicle' || /railside/.test(b.id) ? 'VEHICLE YARD' : 'THE BLOCK OLYMPICS'), { x, y: 2.2, z: z - front * (d / 2 - .1), width: Math.min(w - 2, 12), height: 1.35, yaw: front === 1 ? 0 : Math.PI, background: '#3a5049' });
    sign.userData.target = target; tag(sign, 'neighborhood:signs'); pickables.push(sign); batch.setTarget(null); return;
  }

  let face = { x, z: z + front * d / 2, nx: 0, nz: front, yaw: front === 1 ? 0 : Math.PI, width: w };
  if (Array.isArray(b.footprint) && b.footprint.length >= 3) {
    const body = polygonBody(b, parent, kit, target, h); tag(body, 'neighborhood:bodies'); pickables.push(body);
    polygonWindows(b, batch, target, h);
    face = polygonFace(b) || face;
  } else {
    box(b.color || PALETTE.brick, x, h / 2 + .16, z, w, h, d);
    box('#a49e8a', x, .45, z, w + .14, .56, d + .14);
    box(PALETTE.trim, x, h + .12, z, w + .25, .22, d + .25);
    // Recessed roof and a parapet produce a varied silhouette without extending the collision footprint.
    box(PALETTE.roof, x, h + .24, z, Math.max(1, w - .65), .09, Math.max(1, d - .65));
    for (const side of [-1, 1]) box(b.color || PALETTE.brick, x, h + .5, z + side * (d / 2 - .15), w, .8, .3);
  }

  const { nx, nz, yaw } = face;
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const frontBox = (color, along, y, outward, width, height, depth) => box(color,
    face.x + tx * along + nx * outward, y, face.z + tz * along + nz * outward, width, height, depth, [0, yaw, 0]);
  const usableWidth = Math.max(3, face.width - 1.5), columns = Math.max(1, Math.floor(usableWidth / 3.0));
  const floors = Math.max(1, Math.floor(h / 3.2));
  for (let level = 1; level < floors; level++) {
    const y = 2.1 + level * 3.1;
    if (y + .9 >= h) continue;
    for (let col = 0; !b.footprint && col < columns; col++) {
      const along = (col - (columns - 1) / 2) * Math.min(3.1, usableWidth / columns);
      frontBox(PALETTE.trim, along, y, .035, 1.15, 1.8, .08);
      frontBox(PALETTE.glass, along, y + .02, .09, .91, 1.52, .07);
      frontBox(PALETTE.trim, along, y - .88, .15, 1.3, .14, .3);
      frontBox('#b7b7a1', along, y, .15, .055, 1.48, .03);
    }
    frontBox('#b99476', 0, y - 1.25, .04, Math.min(usableWidth, 25), .12, .12);
  }
  frontBox(PALETTE.trim, 0, 1.7, .08, 2.05, 3.15, .15);
  frontBox('#3d4e4a', 0, 1.65, .17, 1.77, 2.95, .09);
  frontBox('#bdad7b', .53, 1.55, .24, .065, .4, .05);
  if (!/church|chapel|home|residential|apartment|walkup/.test(style)) {
    for (const side of [-1, 1]) {
      frontBox(PALETTE.trim, side * Math.min(4, usableWidth * .29), 1.8, .08, Math.min(4.4, usableWidth * .28), 2.7, .12);
      frontBox(PALETTE.glass, side * Math.min(4, usableWidth * .29), 1.8, .16, Math.min(4.1, usableWidth * .26), 2.45, .07);
    }
  }

  if (/warehouse|industrial/.test(style)) {
    // Roof kit is illustrative. Keep all teeth within the supplied plan silhouette's central zone.
    const roofW = Math.min(w * .68, 16), roofD = Math.min(d * .56, 10);
    for (let i = 0; i < 3; i++) batch.add('roof', '#74786d', x + (i - 1) * roofW / 3, h + .2, z, roofW / 3 - .15, 1.5, roofD, null, target);
    frontBox('#797b6c', Math.min(usableWidth * .3, 5), 2, .2, Math.min(4.5, usableWidth * .27), 3.8, .15);
  } else if (/church|chapel/.test(style)) {
    const towerW = Math.min(3.4, w * .22), towerZ = z + front * Math.min(d * .22, 4);
    box('#d6c6a4', x, h + 2.5, towerZ, towerW, 4.6, towerW);
    batch.add('cone', '#52665c', x, h + 6.2, towerZ, towerW + .3, 3.7, towerW + .3, [0, Math.PI / 4, 0], target);
    box('#e6d7b8', x, h + 8.9, towerZ, .14, 1.7, .14);
    box('#e6d7b8', x, h + 9.05, towerZ, .8, .13, .14);
    for (const side of [-1, 1]) {
      frontBox('#e3d1ad', side * Math.min(5, usableWidth * .3), 3.2, .1, 1.5, 3.5, .16);
      frontBox('#637d72', side * Math.min(5, usableWidth * .3), 3.2, .21, 1.18, 3.18, .08);
    }
  } else if (/donation/.test(style) || b.donationBin) {
    // Set into the facade footprint so walking collision and the visible bin agree.
    const bx = face.x + tx * Math.min(5, usableWidth * .29) - nx * .6;
    const bz = face.z + tz * Math.min(5, usableWidth * .29) - nz * .6;
    box('#54776d', bx, 1.1, bz, 1.6, 2.1, 1.35, [0, yaw, 0]);
    box('#2f453f', bx + nx * .7, 1.57, bz + nz * .7, 1.16, .35, .06, [0, yaw, 0]);
  }
  const sign = kit.sign(parent, b.name, b.tagline || '', { x: face.x + nx * .27, y: Math.min(h - .55, 4.45), z: face.z + nz * .27,
    width: Math.min(usableWidth, 14), height: 1.35, yaw, background: '#344c45', accent: '#d5bd8b' });
  sign.userData.target = target; tag(sign, 'neighborhood:signs'); pickables.push(sign); batch.setTarget(null);
}

export function buildStoryProp(beat, { batch, parent, kit, target, pickables }) {
  if (beat.prop !== 'donation-bin' || !Array.isArray(beat.propPosition)) return;
  const [x, z] = beat.propPosition;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  batch.setTarget(target);
  const box = (color, bx, by, bz, w, h, d, rotation) => batch.add('box', color, bx, by, bz, w, h, d, rotation, target);
  box('#52786c', x, 1.12, z, 1.6, 2.1, 1.35);
  box('#6e8c7a', x, 2.22, z - .04, 1.57, .25, 1.3);
  box('#293e36', x, 1.7, z + .64, 1.22, .47, .055);
  box('#b4b7a2', x, 1.43, z + .6, 1.2, .07, .13, [-.15, 0, 0]);
  // The shoes are plain sculpted props: white uppers, dark soles, no copied or invented mark.
  for (const side of [-1, 1]) {
    const sx = x + side * .24;
    box('#303b38', sx, 1.51, z + .45, .31, .065, .56);
    box('#e6e4d7', sx, 1.62, z + .43, .27, .2, .49);
    box('#e6e4d7', sx, 1.8, z + .28, .25, .3, .19);
    box('#728278', sx, 1.94, z + .28, .18, .035, .12);
    for (let i = 0; i < 3; i++) box('#b8bba9', sx, 1.735, z + .45 + i * .055, .21, .023, .02);
  }
  const sign = kit.sign(parent, 'DONATIONS', 'CLOTHING & SHOES', { x, y: .75, z: z + .681, width: 1.25, height: .55, background: '#d3d6bd', foreground: '#294137', accent: '#52786c' });
  sign.userData.target = target; pickables.push(sign); batch.setTarget(null);
}

export function buildStoryInteriorFixtures(world, batch) {
  for (const f of world.fixtures) {
    const box = (color, x, y, z, w, h, d) => batch.add('box', color, x, y, z, w, h, d);
    if (f.type === 'pew') {
      box('#8b6c4c', f.x, .65, f.z, f.w, .2, f.d);
      box('#8b6c4c', f.x, .96, f.z - .38, f.w, .47, .18);
      for (const side of [-1, 1]) box('#5d5847', f.x + side * (f.w / 2 - .3), .36, f.z, .15, .65, .7);
    } else if (f.type === 'washer') {
      box('#d4d6c8', f.x, .98, f.z, f.w, 1.65, f.d);
      batch.add('torus', '#667c79', f.x, 1.05, f.z + f.d / 2 + .02, 1.06, 1.06, .2);
      batch.add('cylinder', '#354b4c', f.x, 1.05, f.z + f.d / 2 + .02, .8, .055, .8, [Math.PI / 2, 0, 0]);
      box('#677c78', f.x, 1.63, f.z + f.d / 2 + .03, 1.2, .15, .05);
    } else if (f.type === 'sofa' || f.type === 'chair') {
      box('#7d8a6d', f.x, .65, f.z, f.w, .85, f.d);
      box('#68765e', f.x, 1.05, f.z - f.d * .38, f.w, .5, .32);
      for (const side of [-1, 1]) box('#68765e', f.x + side * (f.w / 2 - .15), .88, f.z, .3, .7, f.d);
    } else if (f.type === 'crates') {
      box('#a28158', f.x, f.height / 2 + .16, f.z, f.w, f.height, f.d);
      for (const y of [.45, f.height - .2]) box('#c9af7b', f.x, y, f.z + f.d / 2 + .01, f.w, .12, .04);
      box('#e1d7b9', f.x, Math.min(f.height - .15, .85), f.z + f.d / 2 + .04, .55, .38, .03);
    } else {
      box(f.type === 'altar' ? '#d8c6a1' : '#a18664', f.x, f.height, f.z, f.w, .16, f.d);
      for (const side of [-1, 1]) box('#635c4c', f.x + side * (f.w / 2 - .2), f.height / 2, f.z, .17, f.height, f.d * .7);
    }
  }
}
