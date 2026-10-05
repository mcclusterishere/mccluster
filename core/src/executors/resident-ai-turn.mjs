import { rest } from '../supabase.mjs';
import { localAiChat } from '../compute/local-ai-client.mjs';
import { callCoreCapability, unwrapCapabilityResult } from '../game-studio/capability-client.mjs';

function clean(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

const CURRENT_INTENT = /\b(current|currently|latest|today|tonight|now|right now|recent|recently|this (?:week|month|year)|as of|what(?:'s| is) happening|what(?:'s| is) going on|up[- ]to[- ]date|breaking|newest)\b/i;

export function needsCurrentResearch(value) {
  return CURRENT_INTENT.test(String(value || ''));
}

function researchObjective(messages, fallback) {
  const recentUsers = (messages || [])
    .filter((message) => message && message.role === 'user')
    .slice(-2)
    .map((message) => clean(message.content, 1600))
    .filter(Boolean);
  return clean(recentUsers.join('\nFollow-up: ') || fallback, 3000);
}

async function fetchCurrentResearch(messages, fallback) {
  const objective = researchObjective(messages, fallback);
  if (!needsCurrentResearch(objective)) return { attempted: false, evidence: null, error: null };
  try {
    const called = await callCoreCapability('research.web', { objective, limit: 6 });
    const rawEvidence = unwrapCapabilityResult(called) || {};
    const results = Array.isArray(rawEvidence.results) ? rawEvidence.results.filter((row) => row && row.url) : [];
    if (!results.length) {
      return { attempted: true, evidence: null, error: 'current web research returned no usable results' };
    }
    const evidence = { ...rawEvidence, results, result_count: results.length };
    return { attempted: true, evidence, error: null };
  } catch (error) {
    return {
      attempted: true,
      evidence: null,
      error: clean(error?.message || error || 'current web research failed', 1000),
    };
  }
}

function researchPrompt(research) {
  if (!research?.attempted) return null;
  if (!research.evidence) {
    return [
      'CURRENT-WEB-LOOKUP STATUS: FAILED.',
      'The user asked for information whose answer depends on the current state.',
      'Do not answer from training memory as though it is current.',
      'Say that McCluster could not verify the current state and separate any historical background from current facts.',
      research.error ? 'Lookup error: ' + research.error : '',
    ].filter(Boolean).join('\n');
  }

  const evidence = research.evidence;
  const rows = Array.isArray(evidence.results) ? evidence.results.slice(0, 6) : [];
  const compact = rows.map((row, index) => ({
    rank: index + 1,
    title: clean(row?.title, 500),
    url: clean(row?.url, 1500),
    snippet: clean(row?.snippet, 1800),
  }));
  return [
    'CURRENT-WEB-DISCOVERY EVIDENCE follows.',
    'This material was fetched for this turn. Search-result snippets are discovery evidence, not canonical truth.',
    'Use only claims supported by the supplied evidence, distinguish uncertainty, and name/link the source URLs you rely on.',
    'Do not claim a training cutoff or present older model memory as the current state when this evidence is available.',
    JSON.stringify({
      fetched_at: evidence.fetched_at || null,
      provider: evidence.provider || null,
      objective: evidence.objective || null,
      results: compact,
    }),
  ].join('\n');
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

async function recentThreadMessages({ orgId, threadId, throughCreatedAt = null, limit = 24 }) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    thread_id: `eq.${threadId}`,
    select: 'id,role,content,model,implementation,metadata,created_at',
    order: 'created_at.desc',
    limit: String(Math.min(40, Math.max(1, Number(limit) || 24))),
  });
  if (throughCreatedAt) params.set('created_at', `lte.${throughCreatedAt}`);
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

  const threadMessages = await recentThreadMessages({
    orgId,
    threadId,
    throughCreatedAt: userMessage.created_at,
    limit: 24,
  });
  const turnIndex = threadMessages.findIndex((message) => String(message.id) === userMessageId);
  if (turnIndex < 0) throw new Error('resident AI turn history does not contain its queued user message');

  const history = threadMessages
    .slice(0, turnIndex + 1)
    .filter((message) => ['system', 'user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: clean(message.content, 6000),
    }))
    .filter((message) => message.content);

  const research = await fetchCurrentResearch(history, userMessage.content);
  const currentEvidence = researchPrompt(research);

  history.unshift({
    role: 'system',
    content: [
      'You are McCluster AI, the resident assistant running on McCluster-owned compute.',
      'Continue this conversation naturally and be precise about what you know.',
      'Never claim an external action happened unless the system actually performed it.',
      'Never present stale model memory as current information. If current verification was required and lookup failed, say so plainly.',
      'When current web evidence is supplied, cite the source title or URL for current factual claims and distinguish search snippets from verified primary-source facts.',
      'Your conversation history is durably stored by McCluster. The browser is only a terminal: complete this turn even if the browser disconnects.',
    ].join(' '),
  });
  if (currentEvidence) history.splice(1, 0, { role: 'system', content: currentEvidence });

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

  const answer = clean(response?.message?.content || response?.content || response?.text || response?.answer, 30000);
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
      current_research: {
        attempted: research.attempted,
        ok: Boolean(research.evidence),
        fetched_at: research.evidence?.fetched_at || null,
        provider: research.evidence?.provider || null,
        result_count: Number(research.evidence?.result_count || 0),
        error: research.error || null,
      },
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
    current_research: {
      attempted: research.attempted,
      ok: Boolean(research.evidence),
      fetched_at: research.evidence?.fetched_at || null,
      provider: research.evidence?.provider || null,
      result_count: Number(research.evidence?.result_count || 0),
      error: research.error || null,
    },
    summary: 'McCluster resident AI reply persisted independently of the browser session.',
  };
}
