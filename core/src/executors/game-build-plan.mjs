import { buildGameStudioPlan } from '../game-studio.mjs';

export async function gameBuildPlan(job) {
  const plan = buildGameStudioPlan(job.input || {});

  return {
    executor: 'game_build_plan:v0.1',
    summary: `Prepared ${plan.stages.length}-stage autonomous game studio plan for ${plan.spec.campaign}.`,
    plan,
    safety: {
      direct_code_changes: false,
      direct_deployments: false,
      direct_spending: false,
      direct_external_communications: false,
      note: 'v0.1 plans and validates the production loop; later executors perform gated child work.',
    },
  };
}
