import { rest } from '../supabase.mjs';
import { localAiChat } from '../compute/local-ai-client.mjs';

function clean(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

async function messageById({ orgId, id }) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    id: `eq.${id}`,
    select: '*',
    limit: '1',
  });
  const { body = [] } = await rest(`ops_ai_messages?${params.toString()}`);
  return Array.isArray(body) ? body[0] || null : null;
}

async function recentThreadMessages({ orgId, threadId, limit = 24 }) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    thread_id: `eq.${threadId}`,
    select: 'id,role,content,model,implementation,metadata,created_at',
    order: 'created_at.desc',
    limit: String(Math.min(40, Math.max(1, Number(limit) || 24))),
  });
  const { body = [] } = await rest(`ops_ai_messages?${params.toString()}`);
  return (Array.isArray(body) ? body : []).reverse();
}

async function updateUserState({ orgId, userMessage, status, error = null }) {
  if (!userMessage?.id) return null;
  const metadata = {
    ...(userMessage.metadata || {}),
    execution_kind: 'resident_ai_turn',
    agent_job_id: userMessage.metadata?.agent_job_id || userMessage.id,
    task_status: status,
  };
  if (error) metadata.task_error = clean(error, 1000);
  else delete metadata.task_error;

  const params = new URLSearchParams({
    id: `eq.${userMessage.id}`,
    org_id: `eq.${orgId}`,
    select: '*',
  });
  const { body = [] } = await rest(`ops_ai_messages?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ metadata }),
  });
  return Array.isArray(body) ? body[0] || null : null;
}

export async function residentAiTurn(job) {
  const orgId = clean(job.org_id, 100);
  const threadId = clean(job?.input?.thread_id, 100);
  const userMessageId = clean(job?.input?.user_message_id, 100);
  const assistantMessageId = clean(job?.input?.assistant_message_id, 100);
  if (!orgId || !threadId || !userMessageId || !assistantMessageId) {
    throw new Error('resident_ai_turn requires org, thread, user message, and assistant message ids');
  }

  const existingAssistant = await messageById({ orgId, id: assistantMessageId });
  if (existingAssistant) {
    return {
      executor: 'resident_ai_turn:v1',
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      model: existingAssistant.model || 'unknown',
      implementation: existingAssistant.implementation || 'mccluster-owned',
      replayed: true,
      summary: 'Recovered already-persisted McCluster reply without re-running inference.',
    };
  }

  const userMessage = await messageById({ orgId, id: userMessageId });
  if (!userMessage || userMessage.thread_id !== threadId || userMessage.role !== 'user') {
    throw new Error('resident AI user message is missing or does not belong to the queued thread');
  }

  await updateUserState({ orgId, userMessage, status: 'running' }).catch(() => null);

  const history = (await recentThreadMessages({ orgId, threadId, limit: 24 }))
    .filter((message) => ['system', 'user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: clean(message.content, 6000),
    }))
    .filter((message) => message.content);

  history.unshift({
    role: 'system',
    content: 'You are McCluster AI, the resident assistant running on McCluster-owned compute. Continue this conversation naturally. Be precise about what you know. Never claim an external action happened unless the system actually performed it. Your conversation history is durably stored by McCluster. The browser is only a terminal: complete this turn even if the browser disconnects.',
  });

  let response;
  try {
    response = await localAiChat({
      messages: history,
      temperature: 0.3,
      numCtx: 8192,
      priority: 100,
      metadata: {
        source: 'resident-ai-turn',
        thread_id: threadId,
        turn_id: job.id,
      },
    });
  } catch (error) {
    await updateUserState({
      orgId,
      userMessage,
      status: 'retrying',
      error: error?.message || String(error),
    }).catch(() => null);
    throw error;
  }

  const answer = clean(response?.content || response?.text || response?.answer, 30000);
  if (!answer) throw new Error('McCluster completed the resident AI turn without response content');

  const assistantBody = {
    id: assistantMessageId,
    thread_id: threadId,
    org_id: orgId,
    role: 'assistant',
    content: answer,
    model: response?.model || null,
    implementation: response?.implementation || 'mccluster-owned',
    compute_task_id: null,
    metadata: {
      capability: 'ai.chat',
      execution_kind: 'resident_ai_turn',
      agent_job_id: job.id,
      task_status: 'done',
      queue_wait_ms: response?.queue_wait_ms ?? null,
    },
  };

  const { body: inserted = [] } = await rest('ops_ai_messages?on_conflict=id&select=*', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(assistantBody),
  });
  const assistant = (Array.isArray(inserted) && inserted[0])
    || await messageById({ orgId, id: assistantMessageId });
  if (!assistant) throw new Error('McCluster reply completed but could not be persisted');

  await updateUserState({ orgId, userMessage, status: 'done' }).catch(() => null);

  return {
    executor: 'resident_ai_turn:v1',
    thread_id: threadId,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    model: assistant.model || response?.model || 'unknown',
    implementation: assistant.implementation || response?.implementation || 'mccluster-owned',
    replayed: false,
    queue_wait_ms: response?.queue_wait_ms ?? null,
    summary: 'McCluster resident AI reply persisted independently of the browser session.',
  };
}
