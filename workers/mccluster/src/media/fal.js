import { fal } from '@fal-ai/client';

function configured(env) {
  return Boolean(env.FAL_KEY);
}

function setup(env) {
  if (!configured(env)) throw Object.assign(new Error('fal gateway is not configured'), { status: 503 });
  fal.config({ credentials: env.FAL_KEY });
}

export async function submitFal(env, modelId, input) {
  setup(env);
  const result = await fal.queue.submit(modelId, { input });
  return { request_id: result.request_id || result.requestId };
}

export async function statusFal(env, modelId, requestId) {
  setup(env);
  return fal.queue.status(modelId, { requestId, logs: true });
}

export async function resultFal(env, modelId, requestId) {
  setup(env);
  const result = await fal.queue.result(modelId, { requestId });
  return { data: result.data, request_id: result.requestId || requestId };
}

export function normalizeFalStatus(raw) {
  const value = String(raw?.status || '').toUpperCase();
  if (value === 'COMPLETED') return 'completed';
  if (value === 'IN_PROGRESS') return 'running';
  if (value === 'IN_QUEUE') return 'queued';
  if (value === 'ERROR' || value === 'FAILED') return 'failed';
  return 'queued';
}

export function collectAssetCandidates(value, path = '', out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectAssetCandidates(item, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value !== 'object') return out;

  if (typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) {
    const mime = value.content_type || value.mime_type || value.mimeType || null;
    const lower = `${path} ${mime || ''} ${value.url}`.toLowerCase();
    let assetType = 'file';
    if (/image|\.png|\.jpe?g|\.webp|\.gif/.test(lower)) assetType = 'image';
    else if (/video|\.mp4|\.webm|\.mov/.test(lower)) assetType = 'video';
    else if (/audio|\.wav|\.mp3|\.m4a|\.ogg/.test(lower)) assetType = 'audio';
    out.push({
      asset_type: assetType,
      role: path || 'result',
      url: value.url,
      mime_type: mime,
      width: Number.isFinite(value.width) ? value.width : null,
      height: Number.isFinite(value.height) ? value.height : null,
      duration_seconds: Number.isFinite(value.duration) ? value.duration : null,
      metadata: value
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'url') collectAssetCandidates(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}
