import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlaytestScenario } from '../game-studio/playtest-contract.mjs';
import { runGodotPlaytest } from '../game-studio/godot-runtime.mjs';
import { evaluatePlaytest } from '../game-studio/evaluator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.resolve(here, '..', '..');

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

export async function gamePlaytest(job) {
  const input = job.input || {};
  const scenario = normalizePlaytestScenario(input.scenario || input);
  if (scenario.engine !== 'godot') throw new Error(`game_playtest v0.1 supports godot only, got ${scenario.engine}`);

  const projectPath = path.resolve(text(input.project_path, 2000) || path.join(coreRoot, 'fixtures', 'prim3-tactical-sandbox'));
  const artifactRoot = text(input.artifact_root, 2000)
    ? path.resolve(input.artifact_root)
    : path.join(coreRoot, '.mccluster-artifacts', `job-${job.id || 'manual'}`);

  const evidence = await runGodotPlaytest({ scenario, projectPath, artifactRoot });
  const evaluation = evaluatePlaytest(evidence.run);

  return {
    executor: 'game_playtest:v0.1',
    summary: `Godot playtest ${scenario.id} finished ${evidence.run.terminal?.status || 'unknown'} with score ${evaluation.score}.`,
    scenario,
    evidence: {
      artifact_dir: evidence.artifact_dir,
      exit: evidence.exit,
      timed_out: evidence.timed_out,
      run: evidence.run,
    },
    evaluation,
    safety: {
      production_mutation: false,
      network_required: false,
      bounded_runtime_seconds: scenario.max_seconds,
      bounded_steps: scenario.max_steps,
      merge_or_deploy: false,
    },
  };
}
