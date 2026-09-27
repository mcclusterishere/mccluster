import { randomUUID } from 'node:crypto';
import { rest } from './supabase.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function requireUuid(value, label) {
  const id = clean(value, 100);
  if (!UUID.test(id)) throw Object.assign(new Error(`${label} must be a UUID`), { status: 400 });
  return id;
}

export async function submitResidentAiTurn({ orgId, threadId, messageId, content, inputMode = 'text' } = {}) {
  const org = requireUuid(orgId, 'org_id');
  const thread = requireUuid(threadId, 'thread_id');
  const userMessageId = requireUuid(messageId, 'message_id');
  const assistantMessageId = randomUUID();
  const body = clean(content, 12000);
  if (!body) throw Object.assign(new Error('content is required'), { status: 400 });
  const mode = inputMode === 'voice' ? 'voice' : 'text';

  const { body: rows = [] } = await rest('rpc/ops_ai_submit_turn', {
    method: 'POST',
    body: JSON.stringify({
      p_org_id: org,
      p_thread_id: thread,
      p_user_message_id: userMessageId,
      p_assistant_message_id: assistantMessageId,
      p_content: body,
      p_input_mode: mode,
    }),
  });

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.job_id) {
    throw Object.assign(new Error('Resident AI turn was not durably queued'), {
      status: 503,
      code: 'AI_TURN_NOT_QUEUED',
    });
  }

  return {
    queued: true,
    turn_id: row.job_id,
    job_status: row.job_status || 'queued',
    thread_id: thread,
    user_message_id: row.user_message_id || userMessageId,
    assistant_message_id: row.assistant_message_id || assistantMessageId,
  };
}

export async function getResidentAiTurn({ orgId, turnId } = {}) {
  const org = requireUuid(orgId, 'org_id');
  const turn = requireUuid(turnId, 'turn_id');
  const params = new URLSearchParams({
    id: `eq.${turn}`,
    org_id: `eq.${org}`,
    job_type: 'eq.resident_ai_turn',
    select: '*',
    limit: '1',
  });
  const { body: jobs = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!job) throw Object.assign(new Error('Resident AI turn not found'), { status: 404 });

  const userId = clean(job?.input?.user_message_id, 100);
  const assistantId = clean(job?.input?.assistant_message_id, 100);
  const ids = [userId, assistantId].filter((id) => UUID.test(id));
  let messages = [];
  if (ids.length) {
    const messageParams = new URLSearchParams({
      org_id: `eq.${org}`,
      id: `in.(${ids.join(',')})`,
      select: '*',
      order: 'created_at.asc',
    });
    const result = await rest(`ops_ai_messages?${messageParams.toString()}`);
    messages = Array.isArray(result.body) ? result.body : [];
  }

  return {
    turn: job,
    user_message: messages.find((message) => String(message.id) === userId) || null,
    assistant_message: messages.find((message) => String(message.id) === assistantId) || null,
  };
}
