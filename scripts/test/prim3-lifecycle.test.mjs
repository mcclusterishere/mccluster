import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as L from '../../js/prim3-tactics/levels/transit-relay.mjs';
import { playerProjection } from '../../js/prim3-tactics/tactical-hints.mjs';
import { resolveHostileTurn, genericOutcome, parseResume } from '../../js/prim3-tactics/lifecycle.mjs';

const fresh = () => R.beginPlayerPhase(R.createState(L.engineConfig({ seed: 31 })));
const t = (s) => s.units.find((u) => u.id === 'T1');
const completeObjective = (s) => { for (const n of s.nodes.filter((n) => n.required)) n.state = 'VERIFIED'; for (const o of s.objectives.filter((o) => o.required)) o.state = 'COMPLETE'; };
const serialize = (state, extra = {}) => JSON.stringify({ v: 1, state, log: ['old log'], ...extra });

test('AI failure preserves exact round, clock, seed, AP, events and mission state for deterministic retry', () => {
  const s = fresh(), before = JSON.stringify(s);
  assert.throws(() => resolveHostileTurn(s, null, (candidate) => {
    candidate.rng.n += 5; candidate.units[0].hp = 0; candidate.mission.clock = 0;
    throw new Error('AI failed halfway');
  }), /AI failed halfway/);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(resolveHostileTurn(s), resolveHostileTurn(JSON.parse(before)));
});

test('mission hook failures are also atomic and never commit a partial hostile turn', () => {
  for (const failAt of ['afterThreat', 'sync']) {
    const s = fresh(), before = JSON.stringify(s);
    const hooks = {
      afterThreat(candidate) { candidate.battlefield.partial = true; if (failAt === 'afterThreat') throw new Error('hook failed'); return {state:candidate,log:['only committed on success']}; },
      sync(candidate) { candidate.mission.clock = 0; throw new Error('hook failed'); }
    };
    assert.throws(() => resolveHostileTurn(s, hooks), /hook failed/);
    assert.equal(JSON.stringify(s), before);
  }
});

test('successful turn commits one clock tick and one round and returns only new threat events', () => {
  const s = fresh(), before = JSON.stringify(s), result = resolveHostileTurn(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(result.state.round, s.round + 1);
  assert.equal(result.state.mission.clock, s.mission.clock - 1);
  assert.equal(result.state.phase, 'PLAYER');
  assert.equal(result.events[0].type, 'THREAT_PHASE_BEGIN');
});

test('terminal clock ends a generic mission even if some operatives can still act', () => {
  const s = fresh(); s.mission.clock = 0;
  assert.equal(genericOutcome(s, 'RELAY'), 'lose-clock');
  s.mission.clock = 5; s.mission.escalation = 'TERMINAL';
  assert.equal(genericOutcome(s, 'RELAY'), 'lose-clock');
});

test('downed Technical cannot leave an unfinished objective in an endless mission', () => {
  const s = fresh(); t(s).downed = true; t(s).hp = 0;
  assert.equal(genericOutcome(s, 'RELAY'), 'lose-t');
});

test('stabilized survivors still cannot extract without a carry/revive mechanic', () => {
  const s = fresh(); completeObjective(s);
  t(s).downed = true; t(s).hp = 0; t(s).statuses.push('STABILIZED');
  assert.equal(genericOutcome(s, 'RELAY'), 'lose-downed');
});

test('Technical death after completing the work does not discard a possible extraction', () => {
  const s = fresh(); completeObjective(s); t(s).dead = true; t(s).hp = 0;
  assert.equal(genericOutcome(s, 'RELAY'), null);
  s.mission.extractedUnitIds = ['E1','R1'];
  for (const u of s.units.filter((u) => s.mission.extractedUnitIds.includes(u.id))) u.statuses.push('EXTRACTED');
  assert.equal(genericOutcome(s, 'RELAY'), 'win');
});

test('an all-dead or empty squad cannot win through vacuous extraction', () => {
  const s = fresh(); completeObjective(s);
  for (const u of s.units.filter((u) => u.faction === 'PLAYER')) u.dead = true;
  assert.equal(genericOutcome(s, 'RELAY'), 'lose-all');
  s.units = s.units.filter((u) => u.faction !== 'PLAYER');
  assert.equal(genericOutcome(s, 'RELAY'), 'lose-all');
});

test('valid legacy saves survive unchanged and new saves restore explored tiles', () => {
  const s = fresh(), old = parseResume(serialize(s), s, L.W, L.H);
  assert.deepEqual(old.state, s); assert.deepEqual(old.log, ['old log']); assert.equal(old.explored, null);
  const explored = Array(L.W * L.H).fill(0); explored[42] = 1;
  assert.deepEqual(parseResume(serialize(s, {explored}), s, L.W, L.H).explored, explored);
});

test('corrupt resume structure is rejected before rendering or invoking engine functions', () => {
  const initial = fresh();
  for (const mutate of [s => {delete s.mission;}, s => {delete s.cover;}, s => {s.units[0].statuses=null;}, s => {s.units[0].x=-1;}, s => {s.units[0].ap=1e10;}, s => {s.units.pop();}, s => {s.units[0].hp=null;}, s => {s.mission.extractedUnitIds=['missing'];}]) {
    const s=structuredClone(initial); mutate(s);
    assert.throws(() => parseResume(serialize(s),initial,L.W,L.H));
  }
  assert.throws(() => parseResume('{bad JSON', initial,L.W,L.H));
});


test('hostile-turn resolution refuses a turn outside the player phase', () => {
  const s=fresh();s.phase='THREAT';const before=JSON.stringify(s);
  assert.throws(()=>resolveHostileTurn(s),/player phase/);assert.equal(JSON.stringify(s),before);
});

test('legacy HQ and both B1 exercise save shapes remain resumable', async () => {
  const HQ=await import('../../js/prim3-tactics/levels/equity-uprise-hq.mjs');
  const M=await import('../../js/prim3-tactics/missions/blind-the-floor.mjs');
  const {loadPackage}=await import('../../js/prim3-tactics/adapters/equity-uprise/pipeline.mjs');
  const pkg=await loadPackage();
  const states=[R.beginPlayerPhase(R.createState(HQ.engineConfig({seed:31}))),...['attack','defend'].map(side=>M.createMission(pkg,{side,seed:31}))];
  for(const state of states) assert.deepEqual(parseResume(serialize(state),state,HQ.W,HQ.H).state,state);
});


test('malformed optional machines are rejected before projection and legacy absence remains valid', () => {
  const initial=fresh();
  const machine=R.createState({machines:[{id:'camera',kind:'CAMERA',x:1,y:1}]}).machines[0];
  for(const machines of [{},null,[null],[{}],[{...machine,markedBy:null}],[{...machine,cells:[null]}],[{...machine,kind:'DOOR',open:false}],[{...machine,playerSeen:{}}]]) {
    const s=structuredClone(initial);s.machines=machines;
    assert.throws(()=>parseResume(serialize(s),initial,L.W,L.H),/damaged|different level/);
  }
  const legacy=structuredClone(initial);delete legacy.machines;
  const resumed=parseResume(serialize(legacy),initial,L.W,L.H);
  assert.deepEqual(resumed.state,legacy);
  assert.doesNotThrow(()=>playerProjection(resumed.state));
  const current=structuredClone(initial);current.machines=[machine];
  assert.doesNotThrow(()=>playerProjection(parseResume(serialize(current),initial,L.W,L.H).state));
});

test('null geometry and positioned-node rows cannot escape resume validation', () => {
  const initial=fresh();
  for(const mutate of [s=>s.blockers.push(null),s=>s.cover.push(null),s=>s.cover[0].sides={},s=>s.nodes.push(null),s=>s.nodes[0].at={roles:null},s=>s.surfaces=[null],s=>s.links=[null],s=>s.links=[{from:null,to:{x:1,y:1,z:0},cost:1}],s=>s.battlefield.objectiveTiles=[null]]) {
    const s=structuredClone(initial);mutate(s);assert.throws(()=>parseResume(serialize(s),initial,L.W,L.H));
  }
});

test('partial hostile and clock phases are retained as rejected saves, never replayed as player turns', () => {
  const initial=fresh();
  for(const phase of ['THREAT','CLOCK_STATE','BRIEF']) {
    const s=structuredClone(initial);s.phase=phase;const raw=serialize(s);
    assert.throws(()=>parseResume(raw,initial,L.W,L.H));assert.equal(serialize(s),raw);
  }
});
