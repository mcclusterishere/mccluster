const MAX_SYNTHESIS_MESSAGES = 40;
const MAX_SYNTHESIS_CHARS = 96_000;

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

function boundedMessages(messages) {
  const list = Array.isArray(messages) ? messages.slice(-MAX_SYNTHESIS_MESSAGES) : [];
  const selected = [];
  let remaining = MAX_SYNTHESIS_CHARS;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!message || typeof message !== 'object') continue;
    const raw = String(message.content || '');
    if (!raw.trim()) continue;
    const content = raw.slice(0, Math.min(24_000, remaining));
    selected.push({
      id: message.id ? String(message.id).slice(0, 200) : null,
      role: String(message.role || 'unknown').slice(0, 80),
      model: message.model ? String(message.model).slice(0, 160) : null,
      occurred_at: message.occurred_at ? String(message.occurred_at).slice(0, 80) : null,
      content
    });
    remaining -= content.length;
    if (remaining <= 0) break;
  }
  return selected.reverse();
}

async function alreadyQueued(env, orgId, conversationId, fingerprint) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    job_type: 'eq.objective_synthesis',
    target_id: `eq.${conversationId}`,
    select: 'id,status,input,created_at',
    order: 'created_at.desc',
    limit: '20'
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, {
    headers: serviceHeaders(env)
  });
  if (!res.ok) throw Object.assign(new Error('objective synthesis dedupe lookup failed'), { status: 502 });
  const rows = await res.json().catch(() => []);
  return rows.find((row) => row?.input?.source?.fingerprint === fingerprint) || null;
}

export async function queueObjectiveSynthesis(env, { orgId, ingestBody, ingestResult }) {
  if (ingestBody?.synthesize_objectives === false) return { queued: false, reason: 'disabled' };
  const conversationId = ingestResult?.receipt?.conversation_id;
  if (!conversationId) return { queued: false, reason: 'missing_conversation_id' };

  const messages = boundedMessages(ingestBody?.messages);
  if (!messages.length) return { queued: false, reason: 'no_messages' };

  const provider = String(ingestBody?.provider || 'unknown').slice(0, 120);
  const idempotencyKey = String(ingestBody?.idempotency_key || '').slice(0, 500);
  const fingerprint = await sha256(`${orgId}\n${provider}\n${conversationId}\n${idempotencyKey}`);
  const duplicate = await alreadyQueued(env, orgId, conversationId, fingerprint);
  if (duplicate) return { queued: false, duplicate: true, job_id: duplicate.id, fingerprint };

  const source = {
    provider,
    conversation_id: conversationId,
    external_conversation_id: String(ingestBody?.external_conversation_id || '').slice(0, 500),
    idempotency_key: idempotencyKey,
    fingerprint,
    source_url: ingestBody?.source_url ? String(ingestBody.source_url).slice(0, 2000) : null,
    observed_at: String(ingestBody?.last_message_at || new Date().toISOString()).slice(0, 80)
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      job_type: 'objective_synthesis',
      target_type: 'conversation',
      target_id: conversationId,
      status: 'queued',
      priority: 45,
      input: {
        messages,
        source,
        schedule_reflection: ingestBody?.schedule_reflection !== false
      },
      max_attempts: 2
    })
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok || !rows?.length) {
    throw Object.assign(new Error('failed to queue objective synthesis'), { status: 502, detail: rows });
  }
  return { queued: true, job_id: rows[0].id, fingerprint, conversation_id: conversationId };
}
