import { createGeneration } from './router.js';

export async function createBakeoff(request, env, user) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const modelIds = Array.isArray(body.model_ids) ? [...new Set(body.model_ids.filter(Boolean))] : [];
  if (modelIds.length < 2) throw Object.assign(new Error('model_ids must contain at least two models'), { status: 400 });
  if (modelIds.length > 5) throw Object.assign(new Error('Bakeoffs are limited to five models per run'), { status: 400 });
  if (!body.input && !body.prompt) throw Object.assign(new Error('input or prompt is required'), { status: 400 });

  const settled = await Promise.allSettled(modelIds.map((modelId) => {
    const synthetic = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        org_id: body.org_id || null,
        model_id: modelId,
        prompt: body.prompt || null,
        input: body.input || {},
        budget_cents: body.budget_cents || null,
        strategy: 'bakeoff'
      })
    });
    return createGeneration(synthetic, env, user);
  }));

  const jobs = [];
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') jobs.push(result.value);
    else failures.push({ model_id: modelIds[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });

  if (!jobs.length) throw Object.assign(new Error('Every bakeoff submission failed'), { status: 502, detail: failures });
  return { jobs, failures, requested_models: modelIds.length, submitted_models: jobs.length };
}
