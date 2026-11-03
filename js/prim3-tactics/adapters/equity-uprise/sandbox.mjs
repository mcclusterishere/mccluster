/* PRIM3 × Equity Uprise — the sandbox binding (layer c). SIMULATION / SANDBOX only; live control is never allowed.

   A mission keeps a fault LEDGER: the approved simulation faults its actors have applied (e.g. camera_link_down
   on B1-SEC-CAM-02) and not yet restored. The building's state under that ledger is the electronics SANDBOX's
   own answer: the package carries, for every fault a mission may author, the asset and connection states the
   real engine (production/lab-runtime/equity-uprise-electronics-sandbox.mjs) produced for it. The browser
   combines them (worst availability wins); scripts/test/prim3-equity-uprise-adapter.test.mjs replays ledgers
   through the real engine (reset, then inject each fault) and checks the answers are identical.

   Restoring = removing a fault from the ledger (the sandbox's reset-and-replay). The building authority and
   the sandbox baseline are never touched: the ledger lives only in the mission's own state (the PRIM3 save),
   and a restart clears it. Mode: the ledger is mission state; the WORKPLACE layer never reads it.             */

export const MODES = Object.freeze(['WORKPLACE', 'PRIM3_MISSION', 'TRAINING']);
const RANK = { available: 0, degraded: 1, unavailable: 2 };
const WORST = ['available', 'degraded', 'unavailable'];
export const OFFLINE_UNTIL = 1e9; // an engine machine whose feed the sandbox reports down stays down until restored

export function faultKey(f) { return `${f.fault_id}|${f.target}`; }

// the building's simulated state under a ledger: { assets: {id: availability}, connections: {id: availability} }
export function sandboxView(pkg, ledger = []) {
  if (pkg.sandbox.execution_target !== 'SANDBOX' || pkg.sandbox.live_control_allowed !== false) throw new Error('sandbox binding refuses LIVE control');
  const assets = {}, connections = {};
  for (const f of ledger) {
    const imp = pkg.sandbox.impacts[faultKey(f)];
    if (!imp) throw new Error(`fault not in the approved mission vocabulary: ${faultKey(f)}`);
    for (const a of imp.assets) assets[a.id] = WORST[Math.max(RANK[assets[a.id] || 'available'], RANK[a.availability])];
    for (const c of imp.connections) connections[c.id] = WORST[Math.max(RANK[connections[c.id] || 'available'], RANK[c.availability])];
  }
  return { execution_target: 'SANDBOX', live_control_allowed: false, assets, connections };
}
export const availability = (view, id) => view.assets[id] || 'available';

// apply a ledger to a resolver state: camera machines whose feed is down are offline (JAMMED until restored);
// a camera whose feed is back resumes. Returns a new state (resolver states are values).
export function bindCameras(state, pkg, ledger, cameraIds) {
  const view = sandboxView(pkg, ledger);
  const next = { ...state, machines: (state.machines || []).map((m) => ({ ...m, markedBy: [...(m.markedBy || [])], ...(m.cells ? { cells: m.cells.map((c) => ({ ...c })) } : {}), playerSeen: m.playerSeen ? { ...m.playerSeen } : null })) };
  for (const m of next.machines) {
    if (!cameraIds.includes(m.id)) continue;
    const down = availability(view, m.id) === 'unavailable';
    if (down && !(m.state === 'JAMMED' && m.jammedUntilRound >= OFFLINE_UNTIL)) {
      m.resumeState = m.state === 'JAMMED' ? (m.resumeState || 'ACTIVE') : m.state;
      m.state = 'JAMMED'; m.jammedUntilRound = OFFLINE_UNTIL; m.jammedPhase = 'PLAYER'; m.offline = true;
    } else if (!down && m.offline) {
      m.state = m.resumeState || 'ACTIVE'; m.jammedUntilRound = null; m.jammedPhase = null; m.resumeState = null; delete m.offline;
    }
  }
  return next;
}

/* Node only: drive the real electronics sandbox from a ledger (reset, then inject each fault in order) and read
   back the same view. Used by the tests to prove the packaged consequences equal the engine's. */
export function realView(sandbox, ledger) {
  sandbox.reset();
  for (const f of ledger) sandbox.injectFault(f.fault_id, { target_selectors: [f.target] });
  const snap = sandbox.snapshot();
  const out = { assets: {}, connections: {} };
  for (const a of snap.asset_states) out.assets[a.asset_id] = a.availability;
  for (const c of snap.connection_states) out.connections[c.connection_id] = c.availability;
  sandbox.reset();
  return out;
}
