/* mentor_outreach_research: the daily mentor outreach research run (outreach-pipeline/ at the repo root).
   It discovers, verifies, researches and writes letters into public.outreach_drafts with status
   'pending_review'. It NEVER sends: it imports only outreach-pipeline/src/pipeline.mjs, which has no
   path to the send code (outreach-pipeline/test/review-send.test.mjs proves that by walking the imports).
   Off unless OUTREACH_PIPELINE_ENABLED=true. The pipeline folder is found at OUTREACH_PIPELINE_DIR,
   else beside core/ in the checkout. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rest } from '../supabase.mjs';

export const JOB_TYPE = 'mentor_outreach_research';

export function pipelineDir(env = process.env) {
  if (env.OUTREACH_PIPELINE_DIR) return path.resolve(env.OUTREACH_PIPELINE_DIR);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'outreach-pipeline');
}

async function load(dir, file) {
  const p = path.join(dir, 'src', file);
  if (!fs.existsSync(p)) throw new Error(`outreach pipeline not found at ${dir} (set OUTREACH_PIPELINE_DIR)`);
  return import(pathToFileURL(p).href);
}

export async function mentorOutreachResearch(job, { env = process.env, restImpl = rest, deps = null } = {}) {
  const dir = pipelineDir(env);
  const [{ loadConfig }, { SupabaseStore }, { runDaily }, { createSearch }, { createFetcher }, { createLlm, createEmbedder }, { llmComposer }, { loadHistory }] = await Promise.all(
    ['config.mjs', 'store.mjs', 'pipeline.mjs', 'search.mjs', 'fetch-page.mjs', 'llm.mjs', 'compose.mjs', 'history.mjs'].map((f) => load(dir, f)),
  );
  const config = loadConfig(env);
  if (!config.enabled) {
    return { executor: `${JOB_TYPE}:v1`, summary: 'Mentor outreach research skipped: OUTREACH_PIPELINE_ENABLED is not true', skipped: true };
  }
  const llm = deps?.llm ?? createLlm(config);
  const result = await runDaily({
    config,
    store: deps?.store ?? new SupabaseStore(restImpl),
    search: deps?.search ?? createSearch(config),
    fetchPage: deps?.fetchPage ?? createFetcher(config),
    composer: deps?.composer ?? (llm ? llmComposer(llm) : null),
    llm,
    embed: deps?.embed ?? createEmbedder(config),
    seed: deps?.seed ?? loadHistory(config.historyDir),
    now: deps?.now ?? new Date(),
  });
  return {
    executor: `${JOB_TYPE}:v1`,
    summary: `Mentor outreach ${result.day}: ${result.queued_total || 0} letters queued for review (A ${result.queued.A}, B ${result.queued.B}, C ${result.queued.C}); nothing sent`,
    review_queue: { status: 'pending_review', day: result.day, queued: result.queued },
    run: result,
    sent: 0,
  };
}
