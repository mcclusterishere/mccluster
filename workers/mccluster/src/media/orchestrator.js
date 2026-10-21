import { createGeneration, modelById } from './router.js';
import { validateBakeoff } from './input-contract.js';

export async function createBakeoff(request, env, user) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const modelIds = Array.isArray(body.model_ids) ? [...new Set(body.model_ids.filter(Boolean))] : [];
  if (modelIds.length < 2) throw Object.assign(new Error('model_ids must contain at least two models'), { status: 400 });
  if (modelIds.length > 5) throw Object.assign(new Error('Bakeoffs are limited to five models per run'), { status: 400 });
  if (!body.input && !body.prompt) throw Object.assign(new Error('input or prompt is required'), { status: 400 });

  /* Validate the entire paid comparison before any individual model reserves
     budget or reaches FAL. Partial spend is not an acceptable bakeoff result. */
  const models = await Promise.all(modelIds.map((id) => modelById(env, id)));
  const unknown = modelIds.filter((id, index) => !models[index]);
  if (unknown.length) {
    throw Object.assign(new Error('Unknown or disabled media model in bakeoff; nothing was submitted'), {
      status: 404,
      detail: { model_ids: unknown }
    });
  }
  const input = { ...(body.input || {}) };
  if (body.prompt && !input.prompt) input.prompt = body.prompt;
  validateBakeoff(models, input);

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
