import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeGameStudioHost } from '../src/game-studio/staging-gate.mjs';

test('staging gate fails closed when Godot or fixture is unavailable', () => {
  const prior = process.env.GODOT_BIN;
  process.env.GODOT_BIN = '/definitely/not/a/real/godot';
  const dir = mkdtempSync(join(tmpdir(), 'mccluster-game-gate-'));
  const report = probeGameStudioHost({ project_dir: dir });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes('test-project-missing'));
  if (prior === undefined) delete process.env.GODOT_BIN;
  else process.env.GODOT_BIN = prior;
});

test('staging gate recognizes a declared Godot fixture', () => {
  const prior = process.env.GODOT_BIN;
  process.env.GODOT_BIN = '/definitely/not/a/real/godot';
  const dir = mkdtempSync(join(tmpdir(), 'mccluster-game-gate-'));
  writeFileSync(join(dir, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n');
  const report = probeGameStudioHost({ project_dir: dir });
  assert.equal(report.project_file_exists, true);
  assert.equal(report.project_declares_mccluster_events, true);
  if (prior === undefined) delete process.env.GODOT_BIN;
  else process.env.GODOT_BIN = prior;
});
