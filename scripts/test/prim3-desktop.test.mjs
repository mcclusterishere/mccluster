// PRIM3 desktop (PRIM3/desktop, Godot 4): keeps the PC build tied to the web game's rules, to the
// canonical Site 0 master and to McCluster Core's game-studio launch contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { buildGodotArgs, parseStudioLine } from '../../core/src/game-studio/godot-runtime.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const desk = path.join(root, 'PRIM3/desktop');
const read = (p) => fs.readFileSync(path.join(desk, p), 'utf8');

test('the dice and shot vectors the Godot tests check are the web resolver\'s own numbers', () => {
  const vectors = JSON.parse(read('tests/resolver-vectors.json'));
  for (const v of vectors.rolls) {
    const s = R.createState({ width: 4, height: 4, seed: v.seed, units: [{ id: 'A', faction: 'PLAYER' }] });
    assert.deepEqual(R.drawRolls(s, v.rolls.length).rolls, v.rolls, `rolls for seed ${v.seed}`);
  }
  assert.ok(vectors.previews.length >= 5);
  for (const c of vectors.previews) {
    const s = R.createState({
      width: 16, height: 16, seed: 1,
      cover: c.cover ? [{ x: c.t.x, y: c.t.y, z: 0, ...c.cover }] : [],
      units: [
        { id: 'A', faction: 'PLAYER', x: c.a.x, y: c.a.y, aim: c.a.aim, crit: c.a.crit, weaponDamage: 3, critBonus: 2, ammo: 4 },
        { id: 'T', faction: 'THREAT', x: c.t.x, y: c.t.y, hunkered: Boolean(c.hunkered) }
      ]
    });
    const p = R.shotPreview(s, 'A', 'T');
    assert.deepEqual({ hitChance: p.hitChance, critChance: p.critChance, cover: p.cover, flanked: p.flanked, distance: p.distance }, c.expect);
    assert.equal(R.shotPreview(s, 'A', 'T', { reaction: true }).hitChance, c.reactionHitChance);
  }
});

test('the desktop project answers Core\'s godot launch contract', () => {
  const project = read('project.godot');
  assert.match(project, /run\/main_scene="res:\/\/scenes\/main\.tscn"/, 'staging-gate reads run/main_scene');
  assert.match(project, /rendering_method="forward_plus"/, 'Forward+ for the web game\'s lit look (shadows, SSAO, HDRI)');
  assert.match(project, /fallback_to_opengl3=true/, 'falls back to OpenGL on laptops without Vulkan/D3D12');
  const studio = read('scripts/studio.gd');
  const args = buildGodotArgs({ projectPath: desk, scenario: { id: 'X', seed: 3, max_steps: 9 } });
  for (const flag of args.filter((a) => a.startsWith('--mccluster-'))) {
    assert.ok(studio.includes(flag.split('=')[0] + '='), `studio.gd reads ${flag.split('=')[0]}`);
  }
  assert.ok(studio.includes('print("MCCLUSTER_EVENT " + JSON.stringify(payload))'), 'events use the line prefix parseStudioLine expects');
  assert.deepEqual(parseStudioLine('MCCLUSTER_EVENT {"kind":"terminal"}'), { kind: 'terminal' });
  for (const kind of ['"observation"', '"action"', '"terminal"']) assert.ok(studio.includes(kind), `emits ${kind}`);
  for (const key of ['completed_goals', 'failed_goals', 'elapsed_ms', 'frame_ref', 'state_ref']) assert.ok(studio.includes(`"${key}"`), `carries ${key}`);
});

test('the Site 0 master is copied in at build time, checked against its manifest, never duplicated in git', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^assets\/site0\/$/m);
  const build = read('build.sh');
  assert.ok(build.includes('PRIM3_Site0_Master_Facility_v04.glb') && build.includes('PRIM3_Site0_Master_Facility_v04_manifest.json'));
  assert.ok(build.includes('sha256sum'), 'build.sh refuses a master that does not match its manifest');
  assert.ok(read('scripts/facility.gd').includes('PRIM3_Site0_Master_Facility_v04.glb'), 'the viewer shows v04, the canonical master');
  for (const banned of ['v02', 'v03', 'Handoff']) assert.ok(!read('scripts/facility.gd').includes(banned), `no ${banned}`);
});

test('the board reuses the web game\'s art, copied in at build time and never duplicated in git', () => {
  assert.match(read('.gitignore'), /^assets\/web\/$/m);
  const build = read('build.sh');
  for (const src of ['assets/3d/prim3-operators', 'assets/3d/prim3-tactics', 'assets/3d/prim3-kit/white-industrial']) assert.ok(build.includes(src), `build.sh copies ${src}`);
  for (const role of ['E', 'R', 'T']) assert.ok(fs.existsSync(path.join(root, 'assets/3d/prim3-operators', `${role}.glb`)), `${role} loadout model exists`);
  const missions = JSON.parse(read('data/missions.json')).missions;
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/3d/prim3-kit/white-industrial/catalog.json'), 'utf8'));
  const ids = new Set(catalog.assets.map((a) => a.id));
  for (const m of missions) {
    assert.ok(m.environment && m.environment.ground && m.environment.wall, `${m.id} has its own environment`);
    for (const id of [...m.environment.high, ...m.environment.low, ...(m.environment.dressing || []).map((d) => d[0])]) assert.ok(ids.has(id), `${m.id}: kit asset ${id} exists`);
    for (const set of [m.environment.ground, m.environment.wall, m.environment.apron].filter(Boolean)) assert.ok(fs.existsSync(path.join(root, 'assets/3d/prim3-tactics/pbr', `${set}_diff.jpg`)), `${m.id}: PBR set ${set} exists`);
  }
  assert.equal(new Set(missions.map((m) => m.environment.ground + m.environment.wall + m.environment.fog)).size, missions.length, 'each mission looks different');
});

test('the three missions are well formed', () => {
  const { missions } = JSON.parse(read('data/missions.json'));
  assert.ok(missions.length >= 3);
  for (const m of missions) {
    const widths = new Set(m.map.map((r) => r.length));
    assert.equal(widths.size, 1, `${m.id} map is rectangular`);
    const count = (ch) => m.map.join('').split(ch).length - 1;
    assert.equal(count('P'), m.squad.length, `${m.id} has a spawn per operative`);
    assert.equal(count('H'), m.hostiles.length, `${m.id} has a spawn per hostile`);
    assert.ok(count('X') > 0, `${m.id} has an extraction zone`);
    for (const n of m.nodes) assert.equal(count(n.cell), 1, `${m.id} places node ${n.id} once`);
    assert.deepEqual(m.squad.map((u) => u.role).sort(), ['E', 'R', 'T'], 'Entry, Recon and Technical, as on the web');
    assert.ok(['L1', 'L2', 'B3'].includes(m.level), `${m.id} names a real Site 0 level`);
  }
  assert.match(JSON.parse(read('data/missions.json')).note, /not Site 0 geometry/);
});

test('the web game is untouched by the desktop build', () => {
  for (const page of ['prim3.html', 'prim3-world.html', 'prim3-mission.html', 'prim3-city-tactics.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(!html.includes('PRIM3/desktop'), `${page} does not load desktop files`);
  }
});

const godot = process.env.MCCLUSTER_GODOT_BIN || process.env.GODOT_BIN;
test('Godot rules tests and a studio playtest pass headless', { skip: !godot && 'set MCCLUSTER_GODOT_BIN to run Godot' }, () => {
  const t = spawnSync(godot, ['--headless', '--path', desk, '-s', 'res://tests/run_tests.gd'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(t.status, 0, t.stdout + t.stderr);
  const run = spawnSync(godot, ['--headless', '--path', desk, '--', '--mccluster-scenario=ci', '--mccluster-mission=site0-through-road', '--mccluster-seed=2', '--mccluster-max-steps=4000'], { encoding: 'utf8', timeout: 120000 });
  const events = run.stdout.split(/\r?\n/).map(parseStudioLine).filter(Boolean);
  const terminal = events.find((e) => e.kind === 'terminal');
  assert.ok(terminal, run.stdout + run.stderr);
  assert.ok(events.some((e) => e.kind === 'action' && e.type === 'move'));
  assert.ok(events.some((e) => e.kind === 'observation' && e.state?.units?.length));
});
