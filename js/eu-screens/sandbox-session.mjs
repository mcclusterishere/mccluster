/* Equity Uprise screens — one mode's sandbox session over the canonical Codex lab runtime.

   The state engine is production/lab-runtime/equity-uprise-electronics-sandbox.mjs (ElectronicsSandbox), built from
   the canonical asset registry, connection graph and electronics manifest. This wrapper adds only what a screen
   needs on top of it:
     - a fault log per mode (state.mjs), replayed onto a fresh sandbox on every page, so a session survives
       navigation into and out of the building;
     - clearing one fault by recomposition: reset the sandbox to baseline and re-inject the remaining faults (the
       same simulation-only mitigation the guided scenarios use), so every result is deterministic;
     - TRAINING seeds from the distributed scenario pack (one floor-native ticket per floor), MISSION outages handed
       in by the PRIM3 game, and a WORKPLACE that is always the canonical baseline.
   SANDBOX only: the sandbox refuses a registry with live control enabled, and nothing here talks to a building. */

import { loadSession, saveSession, blankSession } from "./state.mjs";
import { normalizeMode } from "./contract.mjs";

export const DATA_BASE = "/equity-uprise-preview";
const STAMP = "fc1986ec0f4c";
const v = (url) => url + (STAMP.startsWith("__") ? "" : "?v=" + STAMP);

// Keep runtime asset URLs and cache stamps in one loader; apps do not own publication paths.
export function loadComputerWorkbench(base = DATA_BASE) {
  return import(v(base + "/lab-runtime/equity-uprise-computer-workbench.mjs"));
}

let datasetPromise = null;
export function loadDatasets(base = DATA_BASE) {
  if (!datasetPromise) {
    const get = (p) => fetch(v(base + p), { cache: "force-cache" }).then((r) => { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); });
    datasetPromise = Promise.all([
      import(v(base + "/lab-runtime/equity-uprise-electronics-sandbox.mjs")),
      get("/equity-uprise-asset-registry-v1.json"),
      get("/equity-uprise-electronics-connections-v1.json"),
      get("/equity-uprise-electronics-manifest-v1.json"),
      import(v(base + "/lab-runtime/equity-uprise-computer-hardware.mjs")),
      get("/lab-runtime/computer-hardware-profile-v1.json"),
      get("/electronics/server-lab-hardware-v1.json"),
    ]).then(([mod, registry, connections, manifest, hardware, profile, serverHardware]) => ({ ElectronicsSandbox: mod.ElectronicsSandbox, registry, connections, manifest, hardware, profile, serverHardware }))
      .catch((e) => { datasetPromise = null; throw e; });
  }
  return datasetPromise;
}

let screenRegistryPromise = null;
export function loadScreenRegistry(url = new URL("../../screens/data/screen-registry-v1.json", import.meta.url).href) {
  if (!screenRegistryPromise) screenRegistryPromise = fetch(v(url), { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("screen registry " + r.status); return r.json(); }).catch((e) => { screenRegistryPromise = null; throw e; });
  return screenRegistryPromise;
}

export class ScreenSandbox {
  /* sandbox: an ElectronicsSandbox; screens: the screen registry; storage: { load(mode), save(mode, s) } */
  constructor({ sandbox, screens, mode, storage = { load: loadSession, save: saveSession }, hardwareFactory = null }) {
    this.sandbox = sandbox;
    this.screens = screens;
    this.mode = normalizeMode(mode);
    this.storage = storage;
    this.session = storage.load(this.mode) || blankSession(this.mode);
    this.errors = [];
    this.replay();
    this.hardware = hardwareFactory ? hardwareFactory(this) : null;
    this.wrapEquipmentShell = null;
  }

  get readOnly() { return this.mode === "WORKPLACE"; }

  persist() { this.session = this.storage.save(this.mode, this.session); }

  replay() {
    this.sandbox.reset();
    this.errors = [];
    if (this.mode === "WORKPLACE") { this.session.faults = []; return; }
    for (const f of this.session.faults) {
      try {
        const r = this.sandbox.injectFault(f.fault_id, { target_selectors: f.target_selectors });
        f.targets = r.changed_asset_ids;
        f.connections = r.changed_connection_ids;
        f.level = levelOfSelectors(f.target_selectors, this.sandbox);
        delete f.error;
      } catch (e) { f.error = e.code || e.message; this.errors.push({ id: f.id, error: f.error }); }
    }
  }

  entries() { return this.session.faults.filter((f) => !f.error); }

  /* add a sandbox fault (TRAINING / MISSION only); returns the log entry */
  inject(faultId, targetSelectors, source = "user") {
    if (this.readOnly) throw Object.assign(new Error("WORKPLACE mode is normal operations: nothing changes here"), { code: "READ_ONLY_MODE" });
    const entry = { id: "F" + (++this.session.seq), fault_id: faultId, target_selectors: [...targetSelectors], source };
    this.session.faults.push(entry);
    this.replay();
    if (entry.error) { this.session.faults = this.session.faults.filter((f) => f !== entry); this.replay(); throw Object.assign(new Error(entry.error), { code: entry.error }); }
    this.persist();
    return entry;
  }

  /* remove log entries matching pred, recompose the rest; returns the removed entries */
  clear(pred) {
    if (this.readOnly) return [];
    const removed = this.session.faults.filter((f) => !f.error && pred(f));
    if (!removed.length) return [];
    this.session.faults = this.session.faults.filter((f) => !removed.includes(f));
    this.replay();
    for (const r of removed) if (r.source === "training") this.session.resolved.push(r.fault_id + "@" + (r.level || "?"));
    this.persist();
    return removed;
  }

  /* entries for fault ids in faultIds that touched any of assetIds (or, with level, sit on that level) */
  clearFor(faultIds, { assetIds = [], level = null, connectionIds = [] } = {}) {
    const ids = new Set(assetIds), cons = new Set(connectionIds), faults = new Set(faultIds);
    return this.clear((f) => faults.has(f.fault_id) && (
      (f.targets || []).some((a) => ids.has(a)) || (f.connections || []).some((c) => cons.has(c)) || (level && f.level === level)));
  }

  state(assetId) { const base = this.sandbox.assetStates.get(assetId) || null; return this.hardware ? this.hardware.effectiveAsset(assetId, base) : base; }
  connState(id) { const base = this.sandbox.connectionStates.get(id) || null; return this.hardware ? this.hardware.effectiveConnection(id, base) : base; }
  has(assetId, faultId) { const s = this.state(assetId); return Boolean(s && s.active_fault_ids.includes(faultId)); }
  available(assetId) { const s = this.state(assetId); return !s || s.availability !== "unavailable"; }
  summary() { return this.sandbox.summary(); }

  /* TRAINING: open the floor's guided ticket once; MISSION faults come from the game via state.setMissionFaults */
  seedTraining(floor) {
    if (this.mode !== "TRAINING") return null;
    const seeds = this.screens.training_seeds || {};
    const seed = seeds[floor] || seeds.B1;
    if (!seed) return null;
    const key = seed === seeds[floor] ? floor : "B1";
    this.session.seeded = this.session.seeded && typeof this.session.seeded === "object" ? this.session.seeded : {};
    if (this.session.seeded[key]) return this.ticket(key);
    for (const faultId of seed.fault_ids) {
      this.session.faults.push({ id: "F" + (++this.session.seq), fault_id: faultId, target_selectors: [...seed.target_selectors], source: "training", scenario_id: seed.scenario_id });
    }
    this.session.seeded[key] = "active";
    this.replay();
    this.persist();
    return this.ticket(key);
  }

  ticket(floor) {
    const seeds = this.screens.training_seeds || {};
    const key = seeds[floor] ? floor : "B1";
    const seed = seeds[key];
    if (!seed || this.mode !== "TRAINING") return null;
    const open = this.entries().filter((f) => f.source === "training" && f.scenario_id === seed.scenario_id);
    const status = !this.session.seeded || !this.session.seeded[key] ? "not-started" : this.session.seeded[key] === "cleared" ? "cleared" : open.length ? "open" : "resolved";
    return { floor: key, status, seed, open_fault_ids: open.map((f) => f.fault_id) };
  }

  /* back to the canonical baseline for this mode; tickets stay closed until `lab start` */
  reset() {
    delete this.session.hardware;
    this.session.faults = [];
    if (this.session.seeded && typeof this.session.seeded === "object") for (const k of Object.keys(this.session.seeded)) this.session.seeded[k] = "cleared";
    this.replay();
    this.persist();
  }

  restartTicket(floor) {
    if (this.session.seeded && this.session.seeded[floor]) delete this.session.seeded[floor];
    const seeds = this.screens.training_seeds || {};
    const seed = seeds[floor] || seeds.B1;
    this.session.faults = this.session.faults.filter((f) => !(f.source === "training" && seed && f.scenario_id === seed.scenario_id));
    return this.seedTraining(floor);
  }

  addEvidence(record) {
    this.session.evidence.push(record);
    this.persist();
  }
  pushHistory(line) { this.session.history.push(line); this.session.history = this.session.history.slice(-200); this.persist(); }
}

function levelOfSelectors(selectors, sandbox) {
  for (const s of selectors) {
    const m = /^level:(B1|F[1-6]|L7):/.exec(s);
    if (m) return m[1];
    const a = sandbox.assetsById.get(s);
    if (a && a.location && a.location.level_id) return a.location.level_id;
  }
  return null;
}

/* browser convenience: datasets + registry + one mode's session in a single await */
export async function openScreenSession(mode, { base = DATA_BASE } = {}) {
  const [data, screens] = await Promise.all([loadDatasets(base), loadScreenRegistry()]);
  const sandbox = new data.ElectronicsSandbox({ registry: data.registry, connections: data.connections, manifest: data.manifest });
  const catalog = data.hardware.buildComputerCatalog({ ...data, screens });
  const ss = new ScreenSandbox({ sandbox, screens, mode, hardwareFactory: ss => new data.hardware.ComputerFleet({
    catalog, sandbox, mode: ss.mode, readSession: () => ss.session, persist: () => ss.persist(),
  }) });
  ss.wrapEquipmentShell = (shell, screen) => data.hardware.wrapEquipmentShell(shell, ss, screen);
  return ss;
}
