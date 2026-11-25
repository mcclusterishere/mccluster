/* #715 → #713: the B1 mission's real sandbox outages reach the building screens' MISSION session (not only the
   screens' fixed preset), and never WORKPLACE. The game's ledger is the source; the screens read it unchanged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as M from '../../js/prim3-tactics/missions/blind-the-floor.mjs';
import { loadPackage } from '../../js/prim3-tactics/adapters/equity-uprise/pipeline.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const P = ROOT + 'docs/design/equity-uprise-building/production/';
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const registry = j(ROOT + 'screens/data/screen-registry-v1.json');
const assets = j(P + 'asset-registry/generated/equity-uprise-asset-registry-v1.json');
const connections = j(P + 'electronics/generated/equity-uprise-electronics-connections-v1.json');
const manifest = j(P + 'electronics/generated/equity-uprise-electronics-manifest-v1.json');
const state = await import(ROOT + 'js/eu-screens/state.mjs');
const { ScreenSandbox } = await import(ROOT + 'js/eu-screens/sandbox-session.mjs');
const { createNet } = await import(ROOT + 'js/eu-screens/net.mjs');
const { ElectronicsSandbox } = await import(P + 'lab-runtime/equity-uprise-electronics-sandbox.mjs');
const sandbox = new ElectronicsSandbox({ registry: assets, connections, manifest });

test('the mission ledger (defend: red team cut all four links) becomes the screens\' MISSION outages; a restore clears one', async () => {
  const pkg = await loadPackage();
  let s = M.createMission(pkg, { side: 'defend', seed: 3 });
  const faults = M.screenFaults(s);
  assert.equal(faults.length, 4);
  assert.ok(faults.every((f) => f.fault_id === M.CAMERA_FAULT && /^B1-SEC-CAM-0[1-4]$/.test(f.target_selectors[0])));
  state.resetAllSessions();
  state.setMissionFaults(faults, { presetId: 'equity-uprise-b1' });
  const net = createNet(new ScreenSandbox({ sandbox, screens: registry, mode: 'MISSION' }));
  const b1 = net.cameras().filter((c) => net.levelOf(c) === 'B1');
  assert.ok(b1.length >= 4);
  for (const f of faults) assert.notEqual(net.cameraFeed(f.target_selectors[0]).state, 'live', f.target_selectors[0] + ' is down on the screens');
  const work = createNet(new ScreenSandbox({ sandbox, screens: registry, mode: 'WORKPLACE' }));
  assert.ok(work.cameras().every((c) => work.cameraFeed(c).state === 'live'), 'WORKPLACE never sees a mission outage');
  // a restore in the game removes exactly that outage from the screens
  const T = s.units.find((u) => u.faction === 'PLAYER' && u.role === 'T');
  const rack = s.battlefield.eu && M.engineConfig(pkg, { side: 'defend' }).nodes.find((n) => n.id === 'RACK').at;
  s = { ...s, units: s.units.filter((u) => u.faction === 'PLAYER').map((u) => (u.id === T.id ? { ...u, x: rack.x, y: rack.y, z: rack.z, ap: 2 } : u)) };
  const out = M.performMission(pkg, s, 'eu:restore', T.id);
  const after = M.screenFaults(out.state);
  assert.equal(after.length, 3);
  state.setMissionFaults(after, { presetId: 'equity-uprise-b1' });
  const net2 = createNet(new ScreenSandbox({ sandbox, screens: registry, mode: 'MISSION' }));
  const restored = faults.find((f) => !after.some((a) => a.target_selectors[0] === f.target_selectors[0])).target_selectors[0];
  assert.equal(net2.cameraFeed(restored).state, 'live', restored + ' is back on the screens');
  state.resetAllSessions();
});

test('transit mirrors the hook only for a level that declares it (B1); other levels never touch the screens', () => {
  const page = readFileSync(ROOT + 'js/prim3-tactics/transit.mjs', 'utf8');
  assert.match(page, /HOOKS\.screenFaults/);
  assert.match(page, /import\('\.\.\/eu-screens\/state\.mjs'\)/);
  assert.match(readFileSync(ROOT + 'js/prim3-tactics/levels/equity-uprise-b1.mjs', 'utf8'), /screenFaults: \(s\) => M\.screenFaults\(s\)/);
  assert.doesNotMatch(readFileSync(ROOT + 'js/prim3-tactics/levels/equity-uprise-hq.mjs', 'utf8'), /screenFaults/);
});
