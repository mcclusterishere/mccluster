export const PROVIDERS = ['chatgpt', 'claude', 'grok', 'gemini', 'copilot', 'local', 'other'];
export const ROLES = ['user', 'assistant', 'system', 'tool', 'other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGES = 400;
const MAX_CONTENT = 24_000;

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function validateEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('envelope required'), { status: 400 });
  }
  const org_id = clean(body.org_id, 36);
  if (!UUID.test(org_id)) throw Object.assign(new Error('org_id required'), { status: 400 });
  const provider = clean(body.provider, 32).toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw Object.assign(new Error('provider must be chatgpt, claude, grok, gemini, copilot, local, or other'), { status: 400 });
  }
  const external_conversation_id = clean(body.external_conversation_id, 256);
  if (!external_conversation_id) {
    throw Object.assign(new Error('external_conversation_id required'), { status: 400 });
  }
  const idempotency_key = clean(body.idempotency_key, 256);
  if (!idempotency_key) throw Object.assign(new Error('idempotency_key required'), { status: 400 });

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length > MAX_MESSAGES) {
    throw Object.assign(new Error('too many messages'), { status: 413 });
  }
  const messages = rawMessages.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {};
    let role = clean(row.role, 16).toLowerCase();
    if (!ROLES.includes(role)) role = 'other';
    return {
      id: clean(row.id, 128) || undefined,
      role,
      model: clean(row.model, 128) || undefined,
      content: clean(row.content, MAX_CONTENT),
      occurred_at: clean(row.occurred_at, 40) || undefined,
      ordinal: Number.isInteger(row.ordinal) ? row.ordinal : index,
      metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}
    };
  });

  return {
    org_id,
    provider,
    account_label: clean(body.account_label, 64) || 'default',
    adapter_version: clean(body.adapter_version, 32) || '1',
    external_conversation_id,
    title: clean(body.title, 240) || undefined,
    source_url: clean(body.source_url, 500) || undefined,
    model_family: clean(body.model_family, 64) || undefined,
    started_at: clean(body.started_at, 40) || undefined,
    last_message_at: clean(body.last_message_at, 40) || undefined,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
    idempotency_key,
    messages
  };
}

export const CATALOG = {
  service: 'mccluster',
  plane: 'control',
  docs: 'https://github.com/mcclusterishere/mccluster/blob/main/docs/control-plane/AI-HARNESS.md',
  routes: [
    { path: '/health', method: 'GET', auth: 'none' },
    { path: '/v1', method: 'GET', auth: 'none' },
    { path: '/v1/me', method: 'GET', auth: 'user' },
    { path: '/v1/status', method: 'GET', auth: 'house-owner' },
    { path: '/v1/apps', method: 'GET', auth: 'none' },
    { path: '/v1/fees/quote', method: 'GET', auth: 'none' },
    { path: '/v1/geo', method: 'GET', auth: 'none' },
    { path: '/v1/geo/plane', method: 'GET', auth: 'none' },
    { path: '/v1/geo/sources', method: 'GET', auth: 'none' },
    { path: '/v1/geo/fetch/:source', method: 'POST', auth: 'house-owner' },
    { path: '/v1/geo/ingest/:source', method: 'POST', auth: 'house-owner' },
    { path: '/v1/geo/live/ais', method: 'GET', auth: 'house-owner' },
    { path: '/v1/ai/ingest', method: 'POST', auth: 'house-owner' },
    { path: '/v1/ai/retrieve', method: 'POST', auth: 'house-owner' },
    { path: '/v1/ai/decisions', method: 'POST', auth: 'house-owner' },
    { path: '/v1/ai/status', method: 'GET', auth: 'house-owner' },
    { path: '/v1/media/models', method: 'GET', auth: 'user' },
    { path: '/v1/media/generate', method: 'POST', auth: 'user' },
    { path: '/v1/social', method: 'GET', auth: 'user' },
    { path: '/api/*', method: '*', auth: 'whip-identity' }
  ]
};
