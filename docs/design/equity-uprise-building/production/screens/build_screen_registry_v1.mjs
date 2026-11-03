#!/usr/bin/env node
/* Equity Uprise screen registry — deterministic generator (v1).

   Every display surface in the building (monitors, wall screens, kiosks, check-in terminals, media consoles, B1
   NOC/MDF consoles, rack KVM/BMC consoles, policy-lab workstations, F6 command screens, the roof portal board) is
   bound to a canonical asset-registry id and given: floor, room, position in the Core V2 authority frame, kind,
   the full-page app it opens, the modes it is available in and its access boundary.

   Reads only canonical sources; adds no geometry and moves nothing:
     production/asset-registry/generated/equity-uprise-asset-registry-v1.json   (asset ids, center_ft)
     production/basement-b1/basement-b1-object-inventory.json + production/floor-0N/floor-0N-object-inventory.json
     production/generated/equity-uprise-basement-b1-core-v2.glb                (B1 objects carry no plan placement)
     production/core-v2-floor-programs.json + production/basement-b1-program.json (room lookup)
     production/electronics/generated/equity-uprise-electronics-manifest-v1.json  (IDF rack support point)
     production/workplace-occupancy-v1.json                                       (who works on each floor)
     production/lab-runtime/distributed-building-scenario-pack-v1.json + learner-experience-v1.json +
       electronics/generated/equity-uprise-it-lab-catalog-v1.json                 (TRAINING seeds per floor)
     data/seo/domain-architecture.json                                            (roof destinations)

   Writes (and, with --check, verifies byte-for-byte):
     production/screens/equity-uprise-screen-registry-v1.json      authority copy (indexed with the building)
     production/screens/roof-destination-registry-v1.json          L7 destination registry (routing contract §4)
     screens/data/screen-registry-v1.json                          published mirror (docs/ is not published)
     screens/data/roof-destination-registry-v1.json                published mirror

   Usage: node build_screen_registry_v1.mjs [--check] */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostnameFor } from "../../../../../js/eu-screens/net.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, "..");
const ROOT = resolve(PROD, "../../../..");
const FT = 0.3048;
const PLATE = 72;
const CENTER = [36, 36];

const LEVELS = [
  { id: "B1", index: 0, elevation_ft: -13.5, inventory: "basement-b1/basement-b1-object-inventory.json", glb: "generated/equity-uprise-basement-b1-core-v2.glb", program: "b1" },
  { id: "F1", index: 1, elevation_ft: 0, inventory: "floor-01/floor-01-object-inventory.json", program: "floor-01" },
  { id: "F2", index: 2, elevation_ft: 13.5, inventory: "floor-02/floor-02-object-inventory.json", program: "floor-02" },
  { id: "F3", index: 3, elevation_ft: 27, inventory: "floor-03/floor-03-object-inventory.json", program: "floor-03" },
  { id: "F4", index: 4, elevation_ft: 40.5, inventory: "floor-04/floor-04-object-inventory.json", program: "floor-04" },
  { id: "F5", index: 5, elevation_ft: 54, inventory: "floor-05/floor-05-object-inventory.json", program: "floor-05" },
  { id: "F6", index: 6, elevation_ft: 67.5, inventory: "floor-06/floor-06-object-inventory.json", program: "floor-06" },
  { id: "L7", index: 7, elevation_ft: 81, inventory: "floor-07/floor-07-object-inventory.json", program: "level-07" },
];
const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

export const MODES = Object.freeze(["WORKPLACE", "TRAINING", "MISSION"]);
export const MODE_LABELS = Object.freeze({ WORKPLACE: "Workplace", TRAINING: "Training", MISSION: "PRIM3 Mission" });

/* app id -> page and the modes the app supports; one rule table, no per-screen hand edits */
export const APPS = Object.freeze({
  terminal: { page: "screens/terminal.html", title: "Terminal", modes: ["WORKPLACE", "TRAINING", "MISSION"] },
  kiosk: { page: "screens/kiosk.html", title: "Check-in", modes: ["WORKPLACE", "TRAINING", "MISSION"] },
  noc: { page: "screens/noc.html", title: "Operations", modes: ["WORKPLACE", "TRAINING", "MISSION"] },
  vms: { page: "screens/vms.html", title: "Cameras", modes: ["WORKPLACE", "TRAINING", "MISSION"] },
  studio: { page: "screens/studio.html", title: "Studio", modes: ["WORKPLACE", "TRAINING"] },
  evidence: { page: "screens/evidence.html", title: "Evidence", modes: ["WORKPLACE", "TRAINING"] },
  departures: { page: "screens/departures.html", title: "Departures", modes: ["WORKPLACE", "MISSION"] },
  wall: { page: "screens/wall.html", title: "Wall", modes: ["WORKPLACE", "TRAINING"] },
});

/* default height above finished floor for a screen centre when the source gives none (viewing convention, not geometry) */
const KIND_Z = {
  workstation_monitor: 4.25, wall_display: 5.5, kiosk: 4.2, checkin_terminal: 4.2, reception_console: 3.9,
  security_console: 4.0, noc_wall: 5.7, noc_console: 3.9, rack_console: 4.5, bmc_console: 4.0, studio_console: 4.4,
  evidence_terminal: 4.2, command_display: 5.5, portal_board: 5.2, portal_terminal: 3.4, vms_console: 4.0,
};

const read = (rel) => JSON.parse(readFileSync(join(PROD, rel), "utf8"));
const readRoot = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const r2 = (v) => Math.round(v * 100) / 100;

function glbNodeBounds(rel) {
  const b = readFileSync(join(PROD, rel));
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
  const out = new Map();
  for (const node of j.nodes || []) {
    if (node.mesh == null || !node.name) continue;
    const mesh = j.meshes[node.mesh];
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const prim of mesh.primitives || []) {
      const acc = j.accessors[prim.attributes.POSITION];
      if (!acc || !acc.min) continue;
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], acc.min[i]); mx[i] = Math.max(mx[i], acc.max[i]); }
    }
    if (!Number.isFinite(mn[0])) continue;
    out.set(node.name, { min: mn.map((v) => v / FT), max: mx.map((v) => v / FT) });
  }
  return out;
}

function unionBounds(nodes, id) {
  const screen = nodes.get(id + "::screen");
  const parts = screen ? [screen] : [...nodes.entries()].filter(([k]) => k === id || k.startsWith(id + "::")).map(([, v]) => v);
  if (!parts.length) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.min[i]); mx[i] = Math.max(mx[i], p.max[i]); }
  return { x1: mn[0], y1: mn[1], x2: mx[0], y2: mx[1], z1: mn[2], z2: mx[2], screen_node: Boolean(screen) };
}

const CARDINAL = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
function facingTowardCenter(x, y, thinAxis) {
  const dx = CENTER[0] - x, dy = CENTER[1] - y;
  if (thinAxis === "y" || (!thinAxis && Math.abs(dy) >= Math.abs(dx))) return dy >= 0 ? "north" : "south";
  return dx >= 0 ? "east" : "west";
}

function rectContains(b, x, y) { return b && x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; }

function buildRooms(programs, b1Program) {
  const rooms = {};
  for (const lv of programs.levels) {
    const levelId = lv.id === "level-07" ? "L7" : "F" + Number(lv.id.slice(-2));
    rooms[levelId] = (lv.zones || []).map((z, i) => ({ zone_id: "zone_" + String(i + 1).padStart(2, "0"), label: z.label || z.name, bounds: z.bounds_ft || z.bounds }));
  }
  rooms.B1 = (b1Program.zones || []).map((z) => ({ zone_id: z.id, label: z.label || z.name, bounds: z.bounds_ft || z.bounds || { x1: z.x1, y1: z.y1, x2: z.x2, y2: z.y2 } }));
  const common = programs.common_support || {};
  for (const id of Object.keys(rooms)) {
    if (id === "B1" || id === "L7") continue;
    for (const [key, v] of Object.entries(common)) rooms[id].push({ zone_id: key, label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), bounds: v.bounds_ft });
  }
  return rooms;
}

function roomFor(rooms, levelId, x, y, fallbackZone) {
  const list = rooms[levelId] || [];
  /* smallest containing rectangle wins: a check-in terminal sits inside the atrium */
  const hits = list.filter((r) => rectContains(r.bounds, x, y)).sort((a, b) =>
    (a.bounds.x2 - a.bounds.x1) * (a.bounds.y2 - a.bounds.y1) - (b.bounds.x2 - b.bounds.x1) * (b.bounds.y2 - b.bounds.y1));
  if (hits.length) return { zone_id: hits[0].zone_id, label: hits[0].label };
  const named = list.find((r) => r.zone_id === fallbackZone);
  if (named) return { zone_id: named.zone_id, label: named.label };
  return { zone_id: fallbackZone || "floor", label: fallbackZone ? fallbackZone.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Floor" };
}

/* ---------------------------------------------------------------- screen selection rules */

function classify(asset, inv) {
  const id = asset.asset_id;
  const type = asset.classification.asset_type;
  const level = asset.location.level_id;
  const label = asset.label || "";
  if (type === "monitor") {
    if (level === "F4") return { kind: "studio_console", app: "studio", variant: "edit-bay" };
    if (level === "F5") return { kind: "evidence_terminal", app: "evidence", variant: "policy-lab" };
    return { kind: "workstation_monitor", app: "terminal", variant: "workstation" };
  }
  if (type === "vms_nvr") return { kind: "vms_console", app: "vms", variant: "recorder" };
  if (type === "virtualization_host" || type === "nas_storage" || type === "backup_appliance") return { kind: "bmc_console", app: "terminal", variant: "bmc" };
  if (type === "collapsed_core_switch" || type === "firewall" || type === "edge_router") return { kind: "rack_console", app: "terminal", variant: "mdf" };
  if (type === "rack_ups") return { kind: "rack_console", app: "terminal", variant: "ups" };
  if (level === "L7" && (type === "display" || type === "terminal")) {
    return { kind: type === "display" ? "portal_board" : "portal_terminal", app: "departures", variant: /RETURN/.test(id) ? "return" : /ACCESS-STATE/.test(id) ? "restricted" : /PORTAL/.test(id) ? "portal" : "board" };
  }
  if (id === "F6-ROOF-TRANSITION-01") return { kind: "portal_terminal", app: "departures", variant: "transition" };
  if (id === "F1-RECEPTION-MONITOR-01") return { kind: "reception_console", app: "kiosk", variant: "reception" };
  if (id === "F1-RECEPTION-SECURITY-01") return { kind: "security_console", app: "vms", variant: "reception-security" };
  if (/PASSPORT-KIOSK/.test(id)) return { kind: "kiosk", app: "kiosk", variant: "passport" };
  if (id === "F1-DIRECTORY-01") return { kind: "kiosk", app: "kiosk", variant: "directory" };
  if (/MEMBER-CHECKIN/.test(id)) return { kind: "checkin_terminal", app: "kiosk", variant: "checkin" };
  if (id === "B1-LAB-DASHBOARD-01") return { kind: "noc_wall", app: "noc", variant: "digital-twin" };
  if (id === "B1-OPS-STATUS-01") return { kind: "noc_wall", app: "noc", variant: "incident" };
  if (id === "B1-OPS-OCCUPANCY-01") return { kind: "noc_wall", app: "noc", variant: "occupancy" };
  if (id === "B1-OPS-ROUTE-01") return { kind: "noc_console", app: "noc", variant: "route" };
  if (id === "B1-TELECOM-CONSOLE-01") return { kind: "noc_console", app: "terminal", variant: "noc" };
  if (id === "B1-LAB-CONSOLE-01") return { kind: "noc_console", app: "terminal", variant: "bas" };
  if (id === "B1-TELECOM-RACKS-01-I001") return { kind: "rack_console", app: "terminal", variant: "mdf" };
  if (inv && /RACK|SYSTEMS-01$/.test(id) && level !== "B1") return { kind: "rack_console", app: "terminal", variant: "idf" };
  if (level === "F4") return { kind: id === "F4-FLOOR-CONTROL-01" ? "studio_console" : "wall_display", app: "studio", variant: id === "F4-FLOOR-CONTROL-01" ? "floor-control" : /GALLERY/.test(id) ? "gallery" : /RECORDING/.test(id) ? "recording" : /EDIT/.test(id) ? "edit-bay" : "media-wall" };
  if (level === "F5") return { kind: /WORKSTATION|ARCHIVE-SEARCH|NAVIGATOR/.test(id) ? "evidence_terminal" : "wall_display", app: "evidence", variant: /NAVIGATOR/.test(id) ? "navigator" : /ARCHIVE-SEARCH/.test(id) ? "archive" : /PUB/.test(id) ? "publication" : /SOURCE/.test(id) ? "source-review" : "policy-wall" };
  if (level === "F6" && /^F6-DISPLAY-/.test(id)) return { kind: "command_display", app: "noc", variant: "command" };
  return { kind: "wall_display", app: "wall", variant: /INTAKE/.test(id) ? "intake" : /TALK/.test(id) ? "listening" : "surface" };
}

/* B1 MDF: the electronics fabric gives these devices placeholder coordinates (placement_authority "unknown");
   their consoles are put on the modelled B1-TELECOM-RACKS-01 bays instead, one bay per device family */
const B1_RACK_BAY = { collapsed_core_switch: 0, rack_ups: 0, firewall: 1, edge_router: 1, virtualization_host: 2, nas_storage: 3, backup_appliance: 3, vms_nvr: 3 };

const SCREEN_TYPES = new Set(["monitor", "display", "interactive_terminal", "terminal", "vms_nvr", "virtualization_host", "nas_storage", "backup_appliance", "collapsed_core_switch", "firewall", "edge_router", "rack_ups"]);
const INVENTORY_SCREEN = /(DISPLAY|MONITOR|SECURITY-01$|INFO-01$|RACK-01$|IT-RACK|SYSTEMS-01$|FRAME-0\d$|PUB-WORKSTATION|TELECOM-CONSOLE|LAB-CONSOLE|OPS-ROUTE)/;
const EXCLUDE = /(FREIGHT|LOCK-|MECH-PIPE|WORKSHOP|STAGING|DESK-01$|AUDIT-STORAGE|ARCHIVE-FRAME)/;

/* a human title for the device-type labels the fabric generates ("Vms Nvr", "Virtualization Host") */
function titleFor(asset, cls) {
  const id = asset.asset_id, n = (/-I00(\d)$/.exec(id) || [])[1];
  switch (asset.classification.asset_type) {
    case "vms_nvr": return "Video recorder console";
    case "virtualization_host": return `Virtualization host ${n} · BMC`;
    case "nas_storage": return "Storage array · BMC";
    case "backup_appliance": return "Backup appliance · BMC";
    case "collapsed_core_switch": return `Core switch ${n} · console`;
    case "firewall": return `Firewall ${n} · console`;
    case "edge_router": return "Edge router · console";
    case "rack_ups": return `${asset.location.level_id} IDF rack UPS`;
    default: return cls.kind === "rack_console" && !/console/i.test(asset.label) ? asset.label + " · console" : asset.label;
  }
}

/* which asset a screen's app talks to (terminal host, display decoder, workstation) */
function networkBinding(asset, assetsById, level) {
  const id = asset.asset_id;
  let m;
  if ((m = /^(B1|F[1-6])-USER-MON-(\d+)-\d+$/.exec(id))) return `${m[1]}-USER-WS-${m[2]}`;
  if (assetsById.has(id + "::AV-DECODER")) return id + "::AV-DECODER";
  const t = asset.classification.asset_type;
  if (["virtualization_host", "nas_storage", "backup_appliance", "collapsed_core_switch", "firewall", "edge_router", "rack_ups", "vms_nvr"].includes(t)) return id;
  if (/RACK|SYSTEMS-01$/.test(id) && level !== "B1") {
    const sw = `${level}-NET-ACCESS-SW-01`;
    return assetsById.has(sw) ? sw : null;
  }
  if (id === "B1-TELECOM-RACKS-01-I001" || id === "B1-TELECOM-CONSOLE-01") return "B1-NET-CORE-SW-01-I001";
  if (id === "B1-LAB-CONSOLE-01") return assetsById.has("B1-BAS-CTRL-01") ? "B1-BAS-CTRL-01" : null;
  return null;
}

export function buildScreenRegistry() {
  const registry = read("asset-registry/generated/equity-uprise-asset-registry-v1.json");
  const assetsById = new Map(registry.assets.map((a) => [a.asset_id, a]));
  const programs = read("core-v2-floor-programs.json");
  const b1Program = read("basement-b1-program.json");
  const manifest = read("electronics/generated/equity-uprise-electronics-manifest-v1.json");
  const occupancy = read("workplace-occupancy-v1.json");
  const rooms = buildRooms(programs, b1Program);
  const b1Nodes = glbNodeBounds(LEVEL.B1.glb);
  const rackPoint = manifest.physical_routing.floor_support_points_ft.data_rack;

  const inventory = new Map();
  for (const lv of LEVELS) for (const o of read(lv.inventory).objects) inventory.set(o.id, { ...o, level: lv.id });

  const picked = [];
  for (const asset of registry.assets) {
    const type = asset.classification && asset.classification.asset_type;
    const level = asset.location && asset.location.level_id;
    if (!LEVEL[level]) continue;
    const inv = inventory.get(asset.asset_id);
    const isInvScreen = inv && INVENTORY_SCREEN.test(asset.asset_id) && !EXCLUDE.test(asset.asset_id);
    const isTypedScreen = SCREEN_TYPES.has(type) || (type === "interactive_terminal");
    if (!isTypedScreen && !isInvScreen) continue;
    if (asset.asset_id.includes("::")) continue;
    if (type === "display" && !inv && !asset.location.center_ft) continue;
    picked.push({ asset, inv });
  }

  const screens = [];
  for (const { asset, inv } of picked) {
    const lv = LEVEL[asset.location.level_id];
    const cls = classify(asset, inv);
    const z0 = KIND_Z[cls.kind] || 4.5;
    let x, y, z = z0, source, thin = null, width_ft = null, facing = null;
    const c = asset.location.center_ft;
    const pl = inv && inv.placement;
    const bay = lv.id === "B1" ? B1_RACK_BAY[asset.classification.asset_type] : undefined;
    const glb = lv.id === "B1" ? (bay !== undefined ? unionBounds(b1Nodes, "B1-TELECOM-RACKS-01::" + bay) : unionBounds(b1Nodes, asset.asset_id.replace(/-I00\d$/, ""))) : null;
    if (pl && pl.bounds_ft && !Array.isArray(pl.bounds_ft)) {
      const b = pl.bounds_ft; x = (b.x1 + b.x2) / 2; y = (b.y1 + b.y2) / 2;
      thin = (b.x2 - b.x1) < (b.y2 - b.y1) ? "x" : "y"; width_ft = Math.max(b.x2 - b.x1, b.y2 - b.y1);
      source = "inventory.placement.bounds_ft";
    } else if (glb) {
      x = (glb.x1 + glb.x2) / 2; y = (glb.y1 + glb.y2) / 2; z = (glb.z1 + glb.z2) / 2;
      thin = (glb.x2 - glb.x1) < (glb.y2 - glb.y1) ? "x" : "y"; width_ft = Math.max(glb.x2 - glb.x1, glb.y2 - glb.y1);
      source = glb.screen_node ? "b1_glb.screen_node_bounds" : bay !== undefined ? "b1_glb.telecom_rack_bay" : "b1_glb.node_bounds";
      if (bay !== undefined) { z = KIND_Z[cls.kind] || z; thin = "y"; }
    } else if (Array.isArray(c) && c.length >= 2) {
      x = c[0]; y = c[1]; if (c.length >= 3 && c[2] > 0.5) z = c[2];
      source = "asset_registry.location.center_ft";
    } else if (pl && Array.isArray(pl.center_ft)) {
      x = pl.center_ft[0]; y = pl.center_ft[1]; if (pl.center_ft[2] > 0.5) z = pl.center_ft[2];
      source = "inventory.placement.center_ft";
    } else if (cls.kind === "rack_console") {
      x = rackPoint[0]; y = rackPoint[1]; source = "electronics_manifest.floor_support_points_ft.data_rack";
    } else {
      const zone = (rooms[lv.id] || []).find((r) => r.zone_id === asset.location.zone_id && r.bounds && Number.isFinite(r.bounds.x1));
      if (!zone) { console.error("no placement for " + asset.asset_id); continue; }
      x = (zone.bounds.x1 + zone.bounds.x2) / 2; y = (zone.bounds.y1 + zone.bounds.y2) / 2;
      source = "program_zone.centroid";
    }
    if (pl && pl.facing) facing = pl.facing;
    if (!facing) facing = facingTowardCenter(x, y, thin);
    const n = CARDINAL[facing];
    /* two viewpoints, both viewer conventions (not geometry): a cutaway framing from above the clipped walls, and a
       standing eye in front of the screen for walk/room modes */
    const eye = [r2(x + n[0] * 8), r2(y + n[1] * 8), 14];
    const standing = [r2(x + n[0] * 5.5), r2(y + n[1] * 5.5), 5.25];
    const room = roomFor(rooms, lv.id, x, y, asset.location.zone_id);
    const app = APPS[cls.app];
    const net = networkBinding(asset, assetsById, lv.id);
    screens.push({
      screen_id: "SCR-" + asset.asset_id,
      label: asset.label,
      title: titleFor(asset, cls),
      floor: lv.id,
      level_index: lv.index,
      room,
      asset_id: asset.asset_id,
      asset_type: asset.classification.asset_type,
      inventory_id: inv ? inv.id : null,
      mesh_node_prefix: asset.asset_id.replace(/-I00\d$/, ""),
      kind: cls.kind,
      app: { id: cls.app, page: app.page, variant: cls.variant },
      network_asset_id: net,
      host: net ? hostnameFor(net) : null,
      position: {
        frame: "core-v2-local-ft",
        x: r2(x), y: r2(y), z_aff: r2(z), elevation_ft: lv.elevation_ft, z_abs: r2(lv.elevation_ft + z),
        facing, width_ft: width_ft ? r2(width_ft) : null, source,
      },
      approach: { eye_ft: eye, standing_eye_ft: standing, look_ft: [r2(x), r2(y), r2(z)] },
      modes: [...app.modes],
      access: {
        level: "open",
        note: lv.id === "B1" ? "B1 is an open, normal staffed floor (owner, 2026-11-03); room-level safety rules still apply" : "open to the platform's owner-gated session",
        control_target: "SANDBOX",
        live_control_allowed: false,
        asset_visibility: (asset.security && asset.security.visibility) || null,
      },
    });
  }
  screens.sort((a, b) => a.level_index - b.level_index || a.screen_id.localeCompare(b.screen_id));
  /* devices sharing one B1 rack bay are stacked in rack units, bottom-up in id order, so each console is its own target */
  const bays = new Map();
  for (const s of screens) if (s.position.source === "b1_glb.telecom_rack_bay") {
    const k = s.position.x + ":" + s.position.y;
    if (!bays.has(k)) bays.set(k, []);
    bays.get(k).push(s);
  }
  for (const list of bays.values()) list.forEach((s, i) => {
    s.position.z_aff = r2(1.6 + i * 1.15); s.position.z_abs = r2(s.position.elevation_ft + s.position.z_aff);
    s.approach.look_ft[2] = s.position.z_aff;
  });

  /* TRAINING seeds: one floor-native guided scenario per floor, straight from the distributed pack */
  const pack = read("lab-runtime/distributed-building-scenario-pack-v1.json");
  const catalog = read("electronics/generated/equity-uprise-it-lab-catalog-v1.json");
  const learner = read("lab-runtime/learner-experience-v1.json");
  const labs = new Map(catalog.labs.map((l) => [l.lab_id, l]));
  const training_seeds = {};
  for (const s of pack.scenarios) {
    const floor = s.floor_scope[0];
    if (training_seeds[floor]) continue;
    const lab = labs.get(s.source_lab_id);
    const t = learner.tickets[s.source_lab_id] || {};
    training_seeds[floor] = {
      scenario_id: s.scenario_id,
      source_lab_id: s.source_lab_id,
      title: s.title,
      fault_ids: (lab.fault_injection || []).filter((f) => f !== "none"),
      target_selectors: [...s.target_selectors],
      ticket: { title: t.title || s.title, reporter: t.reporter || null, role: t.role || null, issue_report: t.issue_report || s.learner_brief, goal: t.goal || null, known: t.known || [], success_message: t.success_message || null },
    };
  }

  /* MISSION preset the demo and the game share: blind a floor = PoE pulled from every camera on it */
  const mission_presets = {};
  for (const lv of LEVELS) {
    const cams = registry.assets.filter((a) => a.classification.asset_type === "camera" && a.location.level_id === lv.id).map((a) => a.asset_id).sort();
    if (cams.length) mission_presets[lv.id] = { preset_id: "blind-the-floor", label: "Blind the floor", faults: cams.map((id) => ({ fault_id: "poe_disabled", target_selectors: [id] })) };
  }

  const floors = {};
  for (const lv of LEVELS) {
    const o = occupancy.floors[lv.id];
    floors[lv.id] = {
      level_index: lv.index,
      elevation_ft: lv.elevation_ft,
      title: o ? o.title : lv.id,
      people: o ? o.people.map(([name, station, role]) => ({ name, station, role })) : [],
      screen_count: screens.filter((s) => s.floor === lv.id).length,
    };
  }

  return {
    schema_version: "1.0.0",
    registry_id: "equity-uprise-screen-registry-v1",
    status: "canonical-screen-registry",
    generated_by: "docs/design/equity-uprise-building/production/screens/build_screen_registry_v1.mjs",
    not_for_construction: true,
    execution_target: "SANDBOX",
    live_control_allowed: false,
    frame: {
      id: "core-v2-local-ft",
      units: "feet",
      axes: "x east, y north (72 x 72 plate), z_aff above the level's finished floor; z_abs = elevation_ft + z_aff",
      three_js_world: "metres: [x * 0.3048, z_abs * 0.3048, -y * 0.3048] (the canonical viewers load each GLB with rotation.x = -PI/2)",
      plate_ft: [PLATE, PLATE],
    },
    source_revisions: { asset_registry: registry.source_revision || null, registry_version: registry.registry_version || null },
    modes: MODES.map((id) => ({ id, label: MODE_LABELS[id] })),
    apps: Object.fromEntries(Object.entries(APPS).map(([id, a]) => [id, { page: a.page, title: a.title, modes: a.modes }])),
    floors,
    training_seeds,
    mission_presets,
    screen_count: screens.length,
    screens,
  };
}

/* L7 destination registry, per FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md §4. Destinations come from the domain
   architecture; only their routing state is stated here, each with its authority. */
const ROUTING_STATE = {
  human_uprise: { enabled: false, state_reason: "inert until the owner routes humanuprise.com to Worker mccluster (AGENTS.md hard rule 15)" },
};
export function buildDestinationRegistry() {
  const arch = readRoot("data/seo/domain-architecture.json");
  const entities = Object.values(arch.entities || {});
  const destinations = Object.entries(arch.properties).map(([key, p]) => {
    const entity = entities.find((e) => e.id === p.entity) || null;
    const state = ROUTING_STATE[key] || { enabled: true, state_reason: null };
    const code = p.host.replace(/^www\./, "").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
    return {
      id: key,
      code,
      display_name: p.host,
      url: p.origin + "/",
      scene_id: null,
      arrival_route: "/",
      departure_asset: "vertical-lift",
      arrival_asset: null,
      access: "public",
      enabled: state.enabled,
      state_reason: state.state_reason,
      return_route: "screens/building.html#floor=L7",
      metadata: { entity_type: entity ? entity.type : null, entity_id: p.entity, answers: p.answers || null, source: "data/seo/domain-architecture.json#properties." + key },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: "1.0.0",
    registry_id: "equity-uprise-roof-destinations-v1",
    authority: "docs/design/equity-uprise-building/FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md; destinations derived from data/seo/domain-architecture.json",
    travel_metaphor: "vertical-lift",
    allowed_url_rule: "https only; host must be one of the destinations' own hosts",
    destinations,
  };
}

const json = (v) => JSON.stringify(v, null, 2) + "\n";
function main() {
  const check = process.argv.includes("--check");
  const outs = [];
  const screens = json(buildScreenRegistry());
  const dests = json(buildDestinationRegistry());
  outs.push([join(HERE, "equity-uprise-screen-registry-v1.json"), screens]);
  outs.push([join(HERE, "roof-destination-registry-v1.json"), dests]);
  outs.push([join(ROOT, "screens/data/screen-registry-v1.json"), screens]);
  outs.push([join(ROOT, "screens/data/roof-destination-registry-v1.json"), dests]);
  let stale = 0;
  for (const [path, text] of outs) {
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) { console.error("STALE: " + path); stale++; }
    } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
  }
  if (check && stale) { console.error("Run: node docs/design/equity-uprise-building/production/screens/build_screen_registry_v1.mjs"); process.exit(1); }
  const reg = JSON.parse(screens);
  console.log((check ? "CHECK OK" : "WROTE") + ` screen registry: ${reg.screen_count} screens; ` + Object.entries(reg.floors).map(([k, v]) => `${k}:${v.screen_count}`).join(" "));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
