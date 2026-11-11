import { createGeneration, modelById, operationIdFrom } from './router.js';
import { validateBakeoff } from './input-contract.js';

/* The router's operation_id rule (router.js OPERATION_ID): 1-128 characters,
   first one alphanumeric, then letters, digits, ".", "_", ":" or "-". */
const MAX_OPERATION_ID = 128;

/* FNV-1a, 32-bit, as eight lowercase hex digits. Dependency-free and
   synchronous so a child id is a pure function of its inputs. */
export function fnv1a32Hex(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* Audit C5: one stable child operation id per requested model, derived from
   the caller's operation id, so a retried compare resolves each lane to the
   job it already made instead of fanning out a second paid run.

   `${parent}:${model}` is kept verbatim whenever it fits the router's
   128-character rule, so every child id minted so far is unchanged. When it
   does not fit, the PARENT is shortened, never the model: an eight-hex FNV-1a
   of the full untruncated `${parent}:${model}` sits between the shortened
   parent and the model, so two models under one long parent (or two long
   parents sharing a 128-character prefix) can never share a child id. The
   old `.slice(0, 128)` on the joined string cut the model suffix off, which
   made every child of a 128-character parent the parent itself: one model's
   claim won and every other model was refused as a payload mismatch.

   Child ids are opaque: callers read a lane back by the exact
   routing.operation_id the bakeoff reported; nothing parses them. */
export function childOperationId(parentOperationId, modelId) {
  if (!parentOperationId) return undefined;
  const suffix = String(modelId).replace(/[^A-Za-z0-9._-]/g, '_');
  const full = `${parentOperationId}:${suffix}`;
  if (full.length <= MAX_OPERATION_ID) return full;
  /* A model id longer than 100 characters is pathological; cap it so the
     parent always keeps at least 18 characters of its own prefix. */
  const tail = `:${fnv1a32Hex(full)}:${suffix.slice(0, 100)}`;
  return parentOperationId.slice(0, MAX_OPERATION_ID - tail.length) + tail;
}

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

  /* The parent id obeys the router's rule (400 on the compare itself, before
     any claim or reservation); each child id is derived by childOperationId
     above. Absent parent: a deliberate one-off, children carry no id. */
  const parentOperationId = operationIdFrom(body);
  const settled = await Promise.allSettled(modelIds.map((modelId) => {
    const synthetic = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        operation_id: childOperationId(parentOperationId, modelId),
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
