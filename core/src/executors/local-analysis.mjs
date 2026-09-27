import { localAiChat } from '../compute/local-ai-client.mjs';

const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function bounded(value, max) {
  return String(value ?? '').slice(0, max);
}

export async function localAnalysis(job) {
  const task = bounded(job.input?.task || job.input?.prompt || '', 24_000).trim();
  if (!task) throw new Error('local_analysis requires input.task or input.prompt');

  const evidence = job.input?.evidence ?? job.input?.context ?? null;
  const system = [
    'You are McCluster Core local analysis.',
    'Work only from the supplied job input. Do not claim you searched the web, email, files, databases, or live systems unless that evidence is explicitly included.',
    'Separate facts from inference. Prefer concrete next actions. Do not execute external actions.',
    'Return concise JSON with keys: summary, findings, assumptions, next_actions.'
  ].join(' ');

  const user = JSON.stringify({
    task,
    target_type: job.target_type,
    target_id: job.target_id,
    evidence,
  });

  const data = await localAiChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    numCtx: Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
    priority: -20,
    metadata: { job_type: job.job_type || 'local_analysis', job_id: job.id || null },
  });

  const text = String(data?.message?.content || '').trim();
  if (!text) throw new Error('Local AI returned an empty analysis');

  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = { summary: text }; }

  return {
    executor: 'local_analysis:v2',
    model: data?.model || MODEL,
    evidence_scope: 'job_input_only',
    analysis: parsed,
    usage: {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
      queue_wait_ms: data?.queue_wait_ms ?? null,
    },
  };
}
