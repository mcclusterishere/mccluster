/* PRIM3 × Equity Uprise — the gameplay pipeline: building package (a) → adapter (b) → resolver config, with the
   sandbox binding (c). A mission is DATA (missions/*.mjs): which levels it spans, which rooms its doors open,
   which cameras/devices/equipment are its interactive objects, its squads, nodes and clock. This module turns
   that data into a createState() config for the vendored PRIM3 resolver, the same way for every floor.     */
import * as A from './adapter.mjs';

const PKG_URL = new URL('./equity-uprise-package.json', import.meta.url);
let cached = null;
export async function loadPackage() {
  if (cached) return cached;
  if (typeof window !== 'undefined' && typeof fetch === 'function') { const r = await fetch(PKG_URL); if (!r.ok) throw new Error('building package not found'); cached = await r.json(); }
  else { const { readFile } = await import('node:fs/promises'); cached = JSON.parse(await readFile(PKG_URL, 'utf8')); }
  if (cached.schema !== 'prim3.equity-uprise.package/1') throw new Error('incompatible building package: ' + cached.schema);
  return cached;
}

/* spec: { levels, rules, site, openings, elevators,
           cameras: { level, faction } — every security camera on that level becomes an engine CAMERA machine,
           anchors: { name: { device|equipment|door: id, level } } — resolved through the frame }            */
export function buildBattlefield(pkg, spec) {
  const t = A.traversal(pkg, spec);
  const anchors = {};
  for (const [name, a] of Object.entries(spec.anchors || {})) {
    const g = t.grids[a.level];
    anchors[name] = a.device ? A.deviceAnchor(pkg, g, a.device) : a.equipment ? A.equipmentAnchor(g, a.equipment) : A.doorAnchor(g, a.door);
  }
  let cameras = [], machines = [];
  if (spec.cameras) {
    const g = t.grids[spec.cameras.level];
    cameras = A.camerasOn(pkg, g);
    machines = cameras.map((c) => ({ id: c.asset_id, kind: 'CAMERA', x: c.cell.x, y: c.cell.y, z: c.cell.z, faction: spec.cameras.faction, detectionRadius: c.detectionRadius }));
  }
  return { ...t, anchors, cameras, machines };
}

// walkable cells of one level (for lanes, spawn checks and the sector map)
export function walkableCells(bf, level) {
  const g = bf.grids[level], solid = new Set(bf.blockers.map((b) => A.key(b.x, b.y, b.z)));
  return [...g.cells.values()].filter((c) => (c.kind === 'open' || c.kind === 'stair') && !solid.has(A.key(c.x, c.y, g.z))).map((c) => ({ x: c.x, y: c.y, z: g.z }));
}
