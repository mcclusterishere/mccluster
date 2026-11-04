/* Page lifecycle over the canonical pure engine. No new combat rules or backend. */
import { beginThreatPhase, resolveClockStatePhase, beginPlayerPhase, missionComplete } from './tactical-resolver.mjs';
import { runThreatPhase } from './tactical-threat-ai.mjs';

// Resolve into an isolated candidate. A failed AI or mission hook never commits a partial turn,
// spends the clock, or gives the player another round. The caller may retry the same seed/state.
export function resolveHostileTurn(state, hooks = null, threat = runThreatPhase) {
  if (state.phase !== 'PLAYER') throw new Error('End turn requires the player phase');
  const snapshot = JSON.parse(JSON.stringify(state));
  let next = threat(beginThreatPhase(snapshot)).state;
  const lines = [];
  if (hooks) { const result = hooks.afterThreat(next); next = result.state; lines.push(...result.log); }
  const events = next.events.slice(state.events.length);
  next = beginPlayerPhase(resolveClockStatePhase(next));
  if (hooks) next = hooks.sync(next);
  return { state: next, events, log: lines };
}

export function genericOutcome(state, objectiveNode) {
  const squad = state.units.filter((u) => u.faction === 'PLAYER');
  if (!squad.length || squad.every((u) => u.dead)) return 'lose-all';
  if (missionComplete(state)) return 'win';
  if (state.mission.clock <= 0 || state.mission.escalation === 'TERMINAL') return 'lose-clock';
  const unfinished = state.nodes.some((n) => n.id === objectiveNode && !['VERIFIED', 'SEALED_STABILIZED'].includes(n.state));
  if (unfinished && !squad.some((u) => u.role === 'T' && !u.dead && !u.downed && !(u.statuses || []).includes('EXTRACTED'))) return 'lose-t';
  // These exercises have stabilization, but no revive/carry action. Every living operative must
  // extract; leaving a downed survivor behind must not leave the drill permanently unwinnable.
  if (state.mission.extractionRequired && squad.some((u) => u.downed && !u.dead && !(u.statuses || []).includes('EXTRACTED'))) return 'lose-downed';
  if (squad.every((u) => u.dead || u.downed || (u.statuses || []).includes('EXTRACTED'))) return 'lose-all';
  return null;
}

const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const point = (v) => object(v) && [v.x, v.y, v.z].every(finite);
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
// Resume validation is corruption protection, not anti-cheat. Legacy v1 saves keep their keys.
export function parseResume(raw, template, width, height) {
  if (raw == null) return null;
  const save = JSON.parse(raw), s = save && save.state;
  const reject = () => { throw new Error('This browser save is damaged or belongs to a different level.'); };
  if (!save || save.v !== 1 || !object(s) || s.width !== width || s.height !== height || s.floors !== template.floors || s.phase !== 'PLAYER' || !Number.isInteger(s.round) || s.round < 0) reject();
  for (const key of ['units', 'nodes', 'objectives', 'cover', 'blockers', 'events']) if (!Array.isArray(s[key])) reject();
  for (const key of ['mission', 'battlefield', 'technicalTruth']) if (!object(s[key])) reject();
  if (s.events.some((e) => !object(e) || typeof e.type !== 'string')) reject();
  if (s.nodes.some((n) => !object(n) || typeof n.state !== 'string') || s.objectives.some((o) => !object(o) || typeof o.state !== 'string')) reject();
  if (template.battlefield.eu && !object(s.battlefield.eu)) reject();
  if (!finite(s.mission.clock) || s.mission.clock < 0 || !Array.isArray(s.mission.extractedUnitIds)) reject();
  if (s.rng && (!finite(s.rng.seed) || !Number.isInteger(s.rng.n) || s.rng.n < 0)) reject();
  for (const key of ['units', 'nodes', 'objectives']) {
    const ids = s[key].map((x) => x && x.id);
    if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length || template[key].some((x) => !ids.includes(x.id))) reject();
  }
  for (const u of s.units) {
    if (![u.x, u.y, u.z, u.hp, u.maxHp, u.ap, u.maxAp, u.ammo, u.magazineSize, u.reserveAmmo, u.moveRange, u.detectionRadius].every(finite) || u.x < 0 || u.x >= width || u.y < 0 || u.y >= height || u.ap < 0 || u.maxAp < 0 || u.ap > u.maxAp || u.hp < 0 || u.hp > u.maxHp || !Array.isArray(u.statuses)) reject();
    if (u.faction === 'PLAYER' && !['E', 'R', 'T'].includes(u.role)) reject();
  }
  for (const c of s.cover) if (!point(c) || !strings(c.sides)) reject();
  for (const b of s.blockers) if (!point(b)) reject();
  for (const n of s.nodes) if (n.at != null && (!point(n.at) || !finite(n.at.range) || (n.at.roles !== undefined && !strings(n.at.roles)))) reject();
  // Optional engine collections did not exist in the earliest v1 saves. Absence stays valid;
  // malformed present values must not reach projection/filter/map or geometry consumers.
  if (s.surfaces != null && (!Array.isArray(s.surfaces) || s.surfaces.some((v) => !point(v) || ![v.w, v.d, v.height].every(finite)))) reject();
  if (s.links != null && (!Array.isArray(s.links) || s.links.some((v) => !object(v) || !point(v.from) || !point(v.to) || !finite(v.cost)))) reject();
  if (s.battlefield.objectiveTiles != null && (!Array.isArray(s.battlefield.objectiveTiles) || s.battlefield.objectiveTiles.some((v) => !object(v) || ![v.x, v.y].every(finite) || (v.z != null && !finite(v.z))))) reject();
  if (s.machines !== undefined) {
    if (!Array.isArray(s.machines)) reject();
    const ids = new Set();
    for (const m of s.machines) {
      if (!point(m) || typeof m.id !== 'string' || ids.has(m.id) || !['CAMERA', 'TURRET', 'DOOR'].includes(m.kind) || typeof m.state !== 'string' || typeof m.faction !== 'string' || !finite(m.detectionRadius) || !strings(m.markedBy)) reject();
      ids.add(m.id);
      if (m.cells !== undefined && (!Array.isArray(m.cells) || m.cells.some((c) => !point(c)))) reject();
      if (m.kind === 'DOOR' && (!Array.isArray(m.cells) || typeof m.open !== 'boolean')) reject();
      if (m.kind === 'TURRET' && ![m.aim, m.weaponDamage, m.crit, m.critBonus].every(finite)) reject();
      if (m.playerSeen != null && (!object(m.playerSeen) || !finite(m.playerSeen.round) || typeof m.playerSeen.state !== 'string' || typeof m.playerSeen.faction !== 'string')) reject();
    }
  }
  if (s.mission.extractedUnitIds.some((id) => !s.units.some((u) => u.id === id))) reject();
  const log = Array.isArray(save.log) ? save.log.filter((v) => typeof v === 'string').slice(-120) : [];
  const explored = Array.isArray(save.explored) && save.explored.length === width * height && save.explored.every((v) => v === 0 || v === 1) ? save.explored : null;
  return { state: s, log, explored };
}
