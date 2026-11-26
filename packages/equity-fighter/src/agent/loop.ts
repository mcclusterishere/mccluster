/* A small agent loop with save-and-resume checkpoints.

   Pi-style: a short, fixed list of steps with hard caps, no hidden
   planner. LangGraph-style: every finished step is written to ef_steps
   (run id, sequence, kind, output) before the next one starts, so a crash
   resumes from the last saved step instead of starting over. A step that
   already has a saved "done" checkpoint is never re-run; its saved output is
   handed forward. Steps that talk to the harness must be idempotent anyway
   (dispatch.turn is, on message_id), so a crash between "the harness did it"
   and "the checkpoint was saved" replays safely. */

export interface Checkpoint {
  seq: number;
  kind: string;
  status: 'done' | 'failed';
  output: unknown;
}

export interface CheckpointStore {
  loadSteps(runId: string): Promise<Checkpoint[]>;
  saveStep(runId: string, checkpoint: Checkpoint): Promise<void>;
}

export interface Step<C> {
  kind: string;
  /** `saved` holds the outputs of earlier steps by kind. */
  run(ctx: C, saved: Record<string, unknown>): Promise<unknown>;
}

export interface LoopLimits {
  maxSteps: number;
  deadlineMs: number;
  now?: () => number;
}

export const DEFAULT_LIMITS: LoopLimits = { maxSteps: 8, deadlineMs: 120_000 };

export class LoopLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopLimitError';
  }
}

export async function runLoop<C>(
  runId: string,
  steps: readonly Step<C>[],
  ctx: C,
  store: CheckpointStore,
  limits: LoopLimits = DEFAULT_LIMITS,
): Promise<{ outputs: Record<string, unknown>; resumedFrom: number; ran: string[] }> {
  if (steps.length > limits.maxSteps) throw new LoopLimitError(`loop has ${steps.length} steps; the cap is ${limits.maxSteps}`);
  const now = limits.now ?? (() => Date.now());
  const started = now();
  const saved = new Map<number, Checkpoint>();
  for (const cp of await store.loadSteps(runId)) if (cp.status === 'done') saved.set(cp.seq, cp);
  const outputs: Record<string, unknown> = {};
  const ran: string[] = [];
  let resumedFrom = 0;
  for (let seq = 0; seq < steps.length; seq += 1) {
    const step = steps[seq]!;
    const prior = saved.get(seq);
    if (prior && prior.kind === step.kind) {
      outputs[step.kind] = prior.output;
      resumedFrom = seq + 1;
      continue;
    }
    if (now() - started > limits.deadlineMs) throw new LoopLimitError(`run ${runId} passed its ${limits.deadlineMs} ms wall-clock cap before ${step.kind}`);
    let output: unknown;
    try {
      output = await step.run(ctx, outputs);
    } catch (error) {
      await store.saveStep(runId, { seq, kind: step.kind, status: 'failed', output: { error: String((error as Error)?.message || error) } }).catch(() => {});
      throw error;
    }
    await store.saveStep(runId, { seq, kind: step.kind, status: 'done', output: output ?? null });
    outputs[step.kind] = output ?? null;
    ran.push(step.kind);
  }
  return { outputs, resumedFrom, ran };
}
