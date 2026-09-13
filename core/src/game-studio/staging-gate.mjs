import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function which(candidates) {
  for (const cmd of candidates) {
    const probe = spawnSync('sh', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
    if (probe.status === 0) return probe.stdout.trim();
  }
  return null;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: result.status === 0,
  };
}

export function probeGameStudioHost({ project_dir } = {}) {
  const godot = process.env.GODOT_BIN || which(['godot4', 'godot']);
  const projectDir = resolve(project_dir || process.env.PRIM3_TEST_PROJECT || 'core/fixtures/prim3-test-mission-000');
  const projectFile = resolve(projectDir, 'project.godot');

  const report = {
    schema_version: '0.1',
    checked_at: new Date().toISOString(),
    godot_bin: godot,
    godot_version: null,
    project_dir: projectDir,
    project_file_exists: existsSync(projectFile),
    project_declares_mccluster_events: false,
    ready: false,
    blockers: [],
  };

  if (!godot) report.blockers.push('godot-not-installed');
  if (!report.project_file_exists) report.blockers.push('test-project-missing');

  if (godot) {
    const version = run(godot, ['--version'], { timeout: 15000 });
    if (version.ok) report.godot_version = version.stdout.trim() || version.stderr.trim();
    else report.blockers.push('godot-version-probe-failed');
  }

  if (report.project_file_exists) {
    try {
      const project = readFileSync(projectFile, 'utf8');
      report.project_declares_mccluster_events = project.includes('run/main_scene');
      if (!report.project_declares_mccluster_events) report.blockers.push('fixture-main-scene-not-declared');
    } catch {
      report.blockers.push('fixture-unreadable');
    }
  }

  report.ready = report.blockers.length === 0;
  return report;
}

export function smokeLaunchGameStudioHost({ project_dir, timeout_ms = 30000 } = {}) {
  const probe = probeGameStudioHost({ project_dir });
  if (!probe.ready) return { ...probe, smoke_ok: false, smoke: null };

  const smoke = run(probe.godot_bin, ['--headless', '--path', probe.project_dir, '--quit-after', '10'], {
    timeout: timeout_ms,
    env: { MCCLUSTER_SMOKE: '1' },
  });

  const eventSeen = /MCCLUSTER_EVENT/.test(`${smoke.stdout}\n${smoke.stderr}`);
  return {
    ...probe,
    smoke_ok: smoke.ok && eventSeen,
    smoke: {
      status: smoke.status,
      signal: smoke.signal,
      event_seen: eventSeen,
      stdout_tail: smoke.stdout.slice(-8000),
      stderr_tail: smoke.stderr.slice(-8000),
    },
  };
}
