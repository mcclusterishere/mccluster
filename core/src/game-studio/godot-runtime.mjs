import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { createPlaytestRun, finishPlaytest, recordAction, recordObservation } from './playtest-contract.mjs';

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function resolveGodotBinary(env = process.env) {
  return text(env.MCCLUSTER_GODOT_BIN, 1000) || 'godot';
}

export function buildGodotArgs({ projectPath, scenario }) {
  if (!projectPath) throw new Error('godot runtime requires projectPath');
  if (!scenario?.id) throw new Error('godot runtime requires scenario');
  return [
    '--headless',
    '--path',
    projectPath,
    '--',
    `--mccluster-scenario=${scenario.id}`,
    `--mccluster-seed=${scenario.seed}`,
    `--mccluster-max-steps=${scenario.max_steps}`,
  ];
}

export function parseStudioLine(line) {
  const prefix = 'MCCLUSTER_EVENT ';
  if (!line.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(line.slice(prefix.length));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function ensureExecutable(binary) {
  if (!binary.includes('/')) return;
  await access(binary, fsConstants.X_OK);
}

export async function runGodotPlaytest({
  scenario,
  projectPath,
  artifactRoot,
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  const binary = resolveGodotBinary(env);
  await ensureExecutable(binary);

  const run = createPlaytestRun(scenario);
  const timeoutMs = integer(scenario.max_seconds, 600, 1, 21600) * 1000;
  const root = artifactRoot || path.join(process.cwd(), '.mccluster-artifacts', run.run_id);
  await mkdir(root, { recursive: true });

  const args = buildGodotArgs({ projectPath, scenario: run.scenario });
  const stdoutLines = [];
  const stderrLines = [];
  const child = spawnImpl(binary, args, {
    cwd: projectPath,
    env: { ...env, MCCLUSTER_PLAYTEST_RUN_ID: run.run_id, MCCLUSTER_ARTIFACT_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let timedOut = false;
  let buffer = '';
  const consume = (chunk) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) {
      stdoutLines.push(line);
      const event = parseStudioLine(line);
      if (!event) continue;
      run.events.push(event);
      if (event.kind === 'observation') {
        recordObservation(run, {
          t_ms: event.t_ms,
          frame_ref: event.frame_ref,
          state_ref: event.state_ref,
          summary: event.summary,
        });
      } else if (event.kind === 'action') {
        recordAction(run, {
          t_ms: event.t_ms,
          type: event.type,
          target: event.target,
          params: event.params,
          result: event.result,
        });
      }
    }
  };

  child.stdout?.on('data', consume);
  child.stderr?.on('data', (chunk) => stderrLines.push(chunk.toString('utf8')));

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }, timeoutMs);
  timer.unref();

  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));

  if (buffer) consume(`${buffer}\n`);
  const terminalEvent = [...run.events].reverse().find((event) => event.kind === 'terminal');
  const terminalStatus = timedOut
    ? 'timeout'
    : terminalEvent?.status || (exit.code === 0 ? 'completed' : 'crashed');

  finishPlaytest(run, {
    status: terminalStatus,
    reason: timedOut
      ? `Godot exceeded ${run.scenario.max_seconds}s runtime budget.`
      : terminalEvent?.reason || `Godot exited code=${exit.code} signal=${exit.signal || 'none'}`,
    completed_goals: terminalEvent?.completed_goals || [],
    failed_goals: terminalEvent?.failed_goals || [],
    elapsed_ms: terminalEvent?.elapsed_ms || 0,
  });

  const evidence = {
    engine: 'godot',
    binary,
    args,
    exit,
    timed_out: timedOut,
    artifact_dir: root,
    stdout_tail: stdoutLines.slice(-200),
    stderr_tail: stderrLines.join('').slice(-16000),
    run,
  };
  await writeFile(path.join(root, 'playtest-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}
