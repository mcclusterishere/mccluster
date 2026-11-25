#!/usr/bin/env node
/* PRIM3 × Equity Uprise: build the frozen, read-only building package the tactics game plays on.

   Layer (a) is the building authority in docs/design/equity-uprise-building/: it is READ here and never
   written. This script extracts what the game needs (levels, zones, cores, site, doorways, equipment,
   security cameras with their position/aim/optics, the camera cabling, and the electronics sandbox's
   own fault consequences) into one small JSON package that the browser can load:

     js/prim3-tactics/adapters/equity-uprise/equity-uprise-package.json

   Every source file is recorded with its sha256 so a session can name the building revision it played
   on; scripts/test/prim3-equity-uprise-adapter.test.mjs rebuilds the package in memory and fails if the
   committed copy has drifted from the authority. The fault consequences come from running the real
   SANDBOX electronics engine (production/lab-runtime/equity-uprise-electronics-sandbox.mjs): the game
   never re-implements propagation.

   Usage:  node scripts/prim3/build-equity-uprise-package.mjs [--check]   */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const BLD = 'docs/design/equity-uprise-building/production/';
export const PACKAGE_PATH = 'js/prim3-tactics/adapters/equity-uprise/equity-uprise-package.json';
export const SOURCES = {
  core: BLD + 'building-core-v2.json',
  programs: BLD + 'core-v2-floor-programs.json',
  b1: BLD + 'basement-b1-program.json',
  site: BLD + 'floor-01/floor-01-site-egress.json',
  roof: BLD + 'floor-07/floor-07-object-inventory.json',
  tunnel: BLD + 'underground-tunnel-network.json',
  devices: BLD + 'electronics/generated/equity-uprise-device-components-v1.json',
  connections: BLD + 'electronics/generated/equity-uprise-electronics-connections-v1.json',
  manifest: BLD + 'electronics/generated/equity-uprise-electronics-manifest-v1.json',
  registry: BLD + 'asset-registry/generated/equity-uprise-asset-registry-v1.json',
  b1Model: BLD + 'generated/equity-uprise-basement-b1-core-v2.glb',
  sandbox: BLD + 'lab-runtime/equity-uprise-electronics-sandbox.mjs'
};
// the faults a PRIM3 mission may author against a camera or its switch (approved simulation vocabulary,
// all in the sandbox's SUPPORTED_FAULT_IDS; the sandbox refuses anything else)
export const CAMERA_FAULTS = ['camera_link_down', 'poe_disabled'];
export const SWITCH_FAULTS = ['access_switch_failed'];

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r2 = (v) => Math.round(v * 100) / 100;
const rect = (b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });

// metres GLB → feet bounds per node: every mesh node's accessor box, carried through the node hierarchy (TRS)
function glbNodeBounds(buf) {
  const len = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const out = new Map();
  const visit = (i, parent) => {
    const n = json.nodes[i], m = mul(parent, trs(n));
    if (n.mesh != null) {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of json.meshes[n.mesh].primitives) {
        const a = json.accessors[p.attributes.POSITION];
        for (let k = 0; k < 8; k += 1) {
          const v = [k & 1 ? a.max[0] : a.min[0], k & 2 ? a.max[1] : a.min[1], k & 4 ? a.max[2] : a.min[2]];
          const w = [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
          for (let d = 0; d < 3; d += 1) { lo[d] = Math.min(lo[d], w[d]); hi[d] = Math.max(hi[d], w[d]); }
        }
      }
      out.set(n.name, { x1: r2(lo[0] / 0.3048), y1: r2(lo[1] / 0.3048), z1: r2(lo[2] / 0.3048), x2: r2(hi[0] / 0.3048), y2: r2(hi[1] / 0.3048), z2: r2(hi[2] / 0.3048) });
    }
    for (const c of n.children || []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene || 0].nodes) visit(r, I);
  return out;
}

export async function buildPackage(root = ROOT) {
  const read = (p) => readFile(new URL(p, root));
  const raw = {};
  for (const [k, p] of Object.entries(SOURCES)) raw[k] = await read(p);
  const J = (k) => JSON.parse(raw[k].toString('utf8'));
  const core = J('core'), programs = J('programs'), b1 = J('b1'), site = J('site'), roof = J('roof'), tunnel = J('tunnel');
  const devices = J('devices'), connections = J('connections'), manifest = J('manifest'), registry = J('registry');

  const provenance = Object.fromEntries(Object.entries(SOURCES).map(([k, p]) => [p, createHash('sha256').update(raw[k]).digest('hex')]));

  /* levels: elevations from Core V2; zones from the floor programs, B1 from its own program */
  const levels = core.levels.map((l) => ({ level: l.level, id: l.id, name: l.name, elevation_ft: l.finished_floor_elevation_ft, below_grade: !!l.below_grade, open_air: !!l.open_air, zones: [] }));
  for (const p of programs.levels) {
    const L = levels.find((l) => l.level === p.level);
    L.zones = p.zones.map((z, i) => ({ id: `${p.id}-z${String(i + 1).padStart(2, '0')}`, label: z.label, kind: z.kind, bounds_ft: rect(z.bounds_ft) }));
    if (p.level >= 1 && p.level <= 6) for (const [k, v] of Object.entries(programs.common_support)) L.zones.push({ id: `${p.id}-${k}`, label: k.replace(/_/g, ' '), kind: k === 'corridor' ? 'zone' : 'room', bounds_ft: rect(v.bounds_ft), common_support: true });
  }
  const B1 = levels.find((l) => l.level === 0);
  B1.zones = b1.zones.map((z) => ({ id: z.id, label: z.label, kind: z.kind, bounds_ft: rect(z.bounds_ft), hazard_class: z.hazard_class || null, live_access: z.live_access || null, training_mode: z.training_mode || null }));
  B1.access = { normal_staff_access: b1.normal_staff_access, learner_instructor_access: b1.learner_instructor_access, normal_public_access: b1.normal_public_access, training_access: b1.training_access };

  /* B1 doorways and equipment, from the B1 production model (the builder's own room shells: a lintel
     spans each door opening). Equipment keeps its bounds and top height for cover. */
  const nb = glbNodeBounds(raw.b1Model);
  B1.doors = [];
  for (const [name, b] of nb) {
    const m = /^(B1-[A-Z]+-(?:ROOM|ZONE)-01)::([nsew])-lintel$/.exec(name);
    if (!m) continue;
    const side = { n: 'north', s: 'south', e: 'east', w: 'west' }[m[2]];
    const room = { 'B1-MECH-ROOM-01': 'b1-mechanical-plant', 'B1-ELEC-ROOM-01': 'b1-electrical-emergency', 'B1-FIRE-ROOM-01': 'b1-fire-water', 'B1-TELECOM-ROOM-01': 'b1-telecom-core', 'B1-FLOOD-ROOM-01': 'b1-water-flood', 'B1-WORKSHOP-ROOM-01': 'b1-facilities-workshop', 'B1-LAB-ZONE-01': 'b1-systems-lab', 'B1-LOCK-ROOM-01': 'b1-tunnel-transfer-lock' }[m[1]];
    // the opening's centre line on the wall face (feet)
    const vertical = side === 'east' || side === 'west';
    B1.doors.push({ id: `${m[1]}::door`, zone: room, side, x: vertical ? (side === 'east' ? b.x2 : b.x1) : r2((b.x1 + b.x2) / 2), y: vertical ? r2((b.y1 + b.y2) / 2) : (side === 'north' ? b.y2 : b.y1), width_ft: r2(vertical ? b.y2 - b.y1 : b.x2 - b.x1) });
  }
  for (const id of ['B1-LOCK-INNER-DOOR-01', 'B1-LOCK-OUTER-DOOR-01']) { const b = nb.get(id); B1.doors.push({ id, zone: 'b1-tunnel-transfer-lock', side: id.includes('OUTER') ? 'north' : 'south', x: r2((b.x1 + b.x2) / 2), y: id.includes('OUTER') ? b.y2 : b.y1, width_ft: r2(b.x2 - b.x1), leaf: true }); }
  B1.doors.sort((a, b) => a.id.localeCompare(b.id));
  // equipment: the union of a record's nodes (the record id itself and its '::part' children), so a builder that
  // renames a part does not lose the record
  const union = (prefix) => { let o = null; for (const [name, b] of nb) if (name === prefix || name.startsWith(prefix + '::')) o = o ? { x1: Math.min(o.x1, b.x1), y1: Math.min(o.y1, b.y1), x2: Math.max(o.x2, b.x2), y2: Math.max(o.y2, b.y2), z2: Math.max(o.z2, b.z2) } : { ...b }; return o; };
  const EQUIP = ['B1-TELECOM-CONSOLE-01', 'B1-LAB-TABLE-01', 'B1-LAB-CONSOLE-01', 'B1-OPS-DESK-01', 'B1-WORKSHOP-BENCH-01', 'B1-STAGING-RACK-01', 'B1-LAB-GLASS-01', 'B1-LOCK-PANEL-01', ...[0, 1, 2, 3].map((j) => `B1-TELECOM-RACKS-01::${j}`)];
  B1.equipment = EQUIP.map((id) => { const b = union(id); return b && { id, bounds_ft: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 }, top_ft: b.z2 }; }).filter(Boolean);

  /* cores and site */
  const vs = core.vertical_systems;
  const cores = Object.values(vs).map((v) => ({ id: v.id, type: v.type, bounds_ft: rect(v.shaft_bounds_ft || v.enclosure_bounds_ft || v.bounds_ft), serves_levels: v.serves_levels, opening_ft: v.access_opening_concept_ft || v.door_opening_concept_ft || null, access_side: v.access_side || v.door_facing || null }));
  const siteOut = {
    bounds_ft: rect(site.site_bounds_ft),
    elements: site.site_elements.filter((e) => e.bounds_ft).map((e) => ({ id: e.id, label: e.label, kind: e.kind || e.type, bounds_ft: rect(e.bounds_ft) })),
    openings: site.exterior_openings.map((o) => ({ id: o.object_id, ...o.location }))
  };
  const roofObjects = roof.objects.filter((o) => o.placement && (o.placement.bounds_ft || o.placement.center_ft)).map((o) => ({ id: o.id, label: o.label, bounds_ft: o.placement.bounds_ft || null, center_ft: o.placement.center_ft || null, height_ft: o.placement.height_ft ?? null }));
  const tunnelOut = { id: tunnel.id, b1_interfaces: tunnel.b1_interfaces.map((i) => ({ id: i.id, label: i.label, bounds_ft: rect(i.bounds_ft) })), first_node: tunnel.backbone.first_node };

  /* security cameras (every level), their cabling, and the devices a camera mission touches */
  const regById = new Map(registry.assets.map((a) => [a.asset_id, a]));
  const camConn = (id) => connections.connections.filter((c) => c.to_asset_id === id || c.to_asset_id === id + '::DATA-JACK' || c.from_asset_id === id + '::DATA-JACK').map((c) => ({ id: c.connection_id, from: c.from_asset_id, to: c.to_asset_id, cable: c.cable_type, from_port: c.from_port, to_port: c.to_port, route_ft: (c.route || []).map((p) => p.map(r2)) }));
  const cameras = devices.devices.filter((d) => d.asset_type === 'camera').map((d) => {
    const reg = regById.get(d.asset_id) || {}, loc = reg.location || {};
    return { asset_id: d.asset_id, label: d.label, level_id: loc.level_id || d.asset_id.split('-')[0], zone_id: loc.zone_id || null, maturity: d.maturity, placement_authority: loc.placement_authority || null,
      position_ft: d.position_ft.map(r6), aim_vector: d.aim_vector.map(r6), optics: d.optics, lab_behaviors: d.lab_behaviors || [], connections: camConn(d.asset_id) };
  }).sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  const devTypes = new Set(['patch_panel', 'access_switch', 'access_controller', 'access_reader', 'rack_ups', 'intercom', 'workstation']);
  const b1Devices = devices.devices.filter((d) => d.asset_id.startsWith('B1-') && devTypes.has(d.asset_type)).map((d) => ({ asset_id: d.asset_id, label: d.label, asset_type: d.asset_type, position_ft: d.position_ft.map(r6) })).sort((a, b) => a.asset_id.localeCompare(b.asset_id));

  /* the sandbox's own consequences of each authored fault (layer c, computed by the real engine) */
  const { ElectronicsSandbox, ELECTRONICS_SANDBOX_VERSION } = await import(new URL(SOURCES.sandbox, root).href);
  const sb = new ElectronicsSandbox({ registry, connections, manifest });
  const impacts = {};
  const run = (fault, target) => {
    sb.reset();
    const r = sb.injectFault(fault, { target_selectors: [target] });
    const snap = sb.snapshot();
    impacts[`${fault}|${target}`] = {
      fault_id: fault, target, execution_target: r.execution_target, live_control_allowed: r.live_control_allowed,
      assets: snap.asset_states.map((a) => ({ id: a.asset_id, availability: a.availability })),
      connections: snap.connection_states.map((c) => ({ id: c.connection_id, availability: c.availability }))
    };
  };
  for (const c of cameras) for (const f of CAMERA_FAULTS) run(f, c.asset_id);
  for (const d of devices.devices.filter((x) => x.asset_type === 'access_switch')) for (const f of SWITCH_FAULTS) run(f, d.asset_id);
  sb.reset();
  const baseline = sb.summary();

  return {
    schema: 'prim3.equity-uprise.package/1',
    note: 'Generated by scripts/prim3/build-equity-uprise-package.mjs from the Equity Uprise building authority (read-only). Do not edit; rebuild.',
    units: 'feet', coordinate_system: core.coordinate_system,
    provenance,
    shell: { width_ft: core.shell.width_ft, depth_ft: core.shell.depth_ft, floor_to_floor_ft: core.shell.floor_to_floor_ft },
    levels, cores, site: siteOut, roof_objects: roofObjects, tunnel: tunnelOut,
    cameras, b1_devices: b1Devices,
    sandbox: { version: ELECTRONICS_SANDBOX_VERSION, execution_target: 'SANDBOX', live_control_allowed: false, baseline: { asset_availability: baseline.asset_availability, connection_availability: baseline.connection_availability, assets_total: baseline.assets_total, connections_total: baseline.connections_total }, impacts }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const pkg = await buildPackage();
  const text = JSON.stringify(pkg) + '\n';
  const out = new URL(PACKAGE_PATH, ROOT);
  if (process.argv.includes('--check')) {
    const cur = await readFile(out, 'utf8').catch(() => '');
    if (cur !== text) { console.error('equity-uprise-package.json is stale: run node scripts/prim3/build-equity-uprise-package.mjs'); process.exit(1); }
    console.log('package up to date');
  } else { await writeFile(out, text); console.log('wrote', fileURLToPath(out), (text.length / 1024).toFixed(1), 'KB'); }
}
