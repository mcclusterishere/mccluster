async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deterministicUuid(hex) {
  const chars = String(hex).slice(0, 32).padEnd(32, '0').split('');
  chars[12] = '5';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16] || '0', 16) % 4];
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function readExisting(env, jobId) {
  const params = new URLSearchParams({ id: `eq.${jobId}`, select: 'id,status,target_id,input,created_at', limit: '1' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, { headers: serviceHeaders(env) });
  if (!res.ok) throw Object.assign(new Error('objective synthesis dedupe read failed'), { status: 502 });
  const rows = await res.json().catch(() => []);
  return rows?.[0] || null;
}

async function upsertConversationSignal(env, { orgId, ingestBody, receipt, fingerprint }) {
  const provider = String(ingestBody?.provider || 'unknown').slice(0, 120);
  const conversationId = String(receipt?.conversation_id || '').slice(0, 200);
  const observedAt = String(ingestBody?.last_message_at || '').slice(0, 80) || new Date().toISOString();
  const signalRes = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_signals?on_conflict=org_id,fingerprint`, {
    method: 'POST',
    headers: serviceHeaders(env, { Prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify({
      org_id: orgId,
      signal_type: 'conversation',
      source: provider === 'chatgpt' || provider === 'claude' ? provider : 'conversation',
      source_ref: conversationId,
      severity: 55,
      confidence: 1,
      payload: {
        summary: `Conversation activity from ${provider}; private transcript remains in ai_context.`,
        provider,
        conversation_id: conversationId,
        receipt_id: receipt?.id || null,
        privacy_boundary: ingestBody?.privacy_boundary || null,
        scope: ingestBody?.scope || null,
        transcript_persisted_here: false,
        project: ingestBody?.project || null,
        initiative: ingestBody?.initiative || null,
      },
      observed_at: observedAt,
      fingerprint,
      status: 'new',
      updated_at: new Date().toISOString(),
    }),
  });
  const inserted = await signalRes.json().catch(() => []);
  if (!signalRes.ok) throw Object.assign(new Error('conversation signal write failed'), { status: 502, detail: inserted });
  if (inserted?.[0]) return inserted[0];
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, fingerprint: `eq.${fingerprint}`, select: '*', limit: '1' });
  const existingRes = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_signals?${params.toString()}`, { headers: serviceHeaders(env) });
  const existing = await existingRes.json().catch(() => []);
  if (!existingRes.ok) throw Object.assign(new Error('conversation signal dedupe read failed'), { status: 502, detail: existing });
  return existing?.[0] || null;
}

export async function queueObjectiveSynthesis(env, { orgId, ingestBody, ingestResult }) {
  if (ingestBody?.synthesize_objectives === false) return { queued: false, reason: 'disabled' };

  const receipt = ingestResult?.receipt || {};
  const conversationId = String(receipt.conversation_id || '').slice(0, 200);
  const receiptId = String(receipt.id || '').slice(0, 200);
  if (!conversationId || !receiptId) return { queued: false, reason: 'missing_context_reference' };

  const provider = String(ingestBody?.provider || 'unknown').slice(0, 120);
  const idempotencyKey = String(ingestBody?.idempotency_key || '').slice(0, 500);
  const fingerprint = await sha256(`${orgId}\n${provider}\n${conversationId}\n${receiptId}\n${idempotencyKey}`);
  const jobId = deterministicUuid(await sha256(`objective-synthesis:${fingerprint}`));
  const signal = await upsertConversationSignal(env, { orgId, ingestBody, receipt, fingerprint });

  const source = {
    provider,
    conversation_id: conversationId,
    receipt_id: receiptId,
    signal_id: signal?.id || null,
    source_type: 'conversation',
    source_ref: conversationId,
    fingerprint,
    observed_at: String(ingestBody?.last_message_at || '').slice(0, 80) || null,
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?on_conflict=id`, {
    method: 'POST',
    headers: serviceHeaders(env, { Prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify({
      id: jobId,
      org_id: orgId,
      job_type: 'objective_synthesis',
      target_type: 'conversation',
      target_id: conversationId,
      status: 'queued',
      priority: 45,
      input: { source, schedule_reflection: ingestBody?.schedule_reflection !== false },
      max_attempts: 3,
    }),
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw Object.assign(new Error('failed to queue objective synthesis'), { status: 502, detail: rows });
  const created = rows?.[0] || (await readExisting(env, jobId));
  if (!created) throw Object.assign(new Error('objective synthesis enqueue produced no durable job'), { status: 502 });

  return {
    queued: Boolean(rows?.length),
    duplicate: !rows?.length,
    job_id: created.id,
    fingerprint,
    signal_id: signal?.id || null,
    conversation_id: conversationId,
    private_context_reference_only: true,
  };
}
