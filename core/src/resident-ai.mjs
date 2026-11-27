import { randomUUID } from 'node:crypto';
import { rest } from './supabase.mjs';
import { validateChatImages } from './compute/ai-chat-images.mjs';
import { assertWorkspaceSchema, normalizeOwnerRoute, requireWorkspaceOwner, workspaceError } from './compute/owner-routing.mjs';

// Images per chat turn (ai.chat itself takes four; a turn carries at most two).
export const TURN_IMAGE_CAP = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function requireUuid(value, label) {
  const id = clean(value, 100);
  if (!UUID.test(id)) throw Object.assign(new Error(`${label} must be a UUID`), { status: 400 });
  return id;
}

// allow_browser needs the owner: the broker injects options.actor from the
// signed edge envelope only after the Worker's house-owner check.
function requireOwnerActor(actor) {
  if (actor?.kind !== 'owner' || !UUID.test(clean(actor?.user_id, 100))) {
    throw Object.assign(new Error('allow_browser requires the house owner session'), { status: 403, code: 'BROWSER_OWNER_REQUIRED' });
  }
  return clean(actor.user_id, 100);
}

// The kind of the broker-injected actor ('owner' after the Worker's house-owner
// check), stored on the durable turn so the turn executor reads who submitted
// it instead of inferring it from the browser flag.
function actorKindOf(actor) {
  const kind = clean(actor?.kind, 40).toLowerCase();
  return /^[a-z][a-z0-9_-]{0,39}$/.test(kind) ? kind : null;
}

function normalizeImages(images, content) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) throw Object.assign(new Error('images must be an array of base64 strings'), { status: 400, code: 'AI_CHAT_IMAGE_INVALID', retryable: false });
  if (!images.length) return [];
  if (images.length > TURN_IMAGE_CAP) throw Object.assign(new Error(`at most ${TURN_IMAGE_CAP} images per turn`), { status: 400, code: 'AI_TURN_IMAGES_TOO_MANY', retryable: false });
  validateChatImages({ messages: [{ role: 'user', content, images }] }, { maxPerRequest: TURN_IMAGE_CAP });
  return images;
}

export async function submitResidentAiTurn({ orgId, threadId, messageId, content, inputMode = 'text', images, allowBrowser = false, actor, route, reviewOfTurnId } = {}, { restImpl = rest } = {}) {
  const org = requireUuid(orgId, 'org_id');
  const thread = requireUuid(threadId, 'thread_id');
  const userMessageId = requireUuid(messageId, 'message_id');
  const assistantMessageId = randomUUID();
  const body = clean(content, 12000);
  if (!body) throw Object.assign(new Error('content is required'), { status: 400 });
  if (route !== undefined) return submitWorkspaceTurn({ orgId: org, threadId: thread, messageId: userMessageId, assistantMessageId, content: body, inputMode, images, allowBrowser, actor, route, reviewOfTurnId }, { restImpl });
  const mode = inputMode === 'voice' ? 'voice' : 'text';
  const browser = allowBrowser === true;
  const actorUserId = browser ? requireOwnerActor(actor) : (UUID.test(clean(actor?.user_id, 100)) ? clean(actor.user_id, 100) : null);
  const actorKind = actorUserId ? actorKindOf(actor) : null;
  const turnImages = normalizeImages(images, body);

  // Images and the browser flag ride on the user message's metadata. The RPC
  // inserts the user message `on conflict (id) do nothing` and compares only
  // thread, role and content, so the row is written here first, with its
  // metadata and exactly the content the RPC will compare (btrim is a no-op on
  // an already trimmed string), and the RPC then only adds the job.
  let preInserted = false;
  if (turnImages.length || browser) {
    const metadata = {
      input_mode: mode, execution_kind: 'resident_ai_turn', agent_job_id: userMessageId, task_status: 'queued',
      ...(turnImages.length ? { images: turnImages } : {}),
      allow_browser: browser,
      ...(actorUserId ? { actor_user_id: actorUserId } : {}),
      ...(actorKind ? { actor_kind: actorKind } : {}),
    };
    const { body: inserted = [] } = await restImpl('ops_ai_messages?on_conflict=id&select=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ id: userMessageId, thread_id: thread, org_id: org, role: 'user', content: body, metadata }),
    });
    preInserted = Array.isArray(inserted) && inserted.length > 0;
  }

  let rows = [];
  try {
    ({ body: rows = [] } = await restImpl('rpc/ops_ai_submit_turn', {
      method: 'POST',
      body: JSON.stringify({
        p_org_id: org,
        p_thread_id: thread,
        p_user_message_id: userMessageId,
        p_assistant_message_id: assistantMessageId,
        p_content: body,
        p_input_mode: mode,
      }),
    }));
  } catch (error) {
    // The job was not created: the message written above must not look queued.
    if (preInserted) {
      const params = new URLSearchParams({ id: `eq.${userMessageId}`, org_id: `eq.${org}`, role: 'eq.user' });
      await restImpl(`ops_ai_messages?${params.toString()}`, {
        method: 'PATCH',
        body: JSON.stringify({ metadata: { input_mode: mode, execution_kind: 'resident_ai_turn', agent_job_id: userMessageId, task_status: 'failed', task_error: clean(error?.message || error, 1000), allow_browser: browser, ...(actorUserId ? { actor_user_id: actorUserId } : {}), ...(actorKind ? { actor_kind: actorKind } : {}), ...(turnImages.length ? { images: turnImages } : {}) } }),
      }).catch(() => null);
    }
    throw error;
  }

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
    images: turnImages.length,
    allow_browser: browser,
  };
}

export async function getResidentAiTurn({ orgId, turnId } = {}, { restImpl = rest } = {}) {
  const org = requireUuid(orgId, 'org_id');
  const turn = requireUuid(turnId, 'turn_id');
  const params = new URLSearchParams({
    id: `eq.${turn}`,
    org_id: `eq.${org}`,
    job_type: 'eq.resident_ai_turn',
    select: '*',
    limit: '1',
  });
  const { body: jobs = [] } = await restImpl(`ops_agent_jobs?${params.toString()}`);
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
    const result = await restImpl(`ops_ai_messages?${messageParams.toString()}`);
    messages = Array.isArray(result.body) ? result.body : [];
  }

  const user = messages.find((message) => String(message.id) === userId) || null;
  const progress = user?.metadata?.workspace_progress || null;
  return {
    ...(progress ? { progress: { ...progress, status: job.status === 'canceled' ? 'canceled' : progress.status } } : {}),
    turn: job,
    user_message: messages.find((message) => String(message.id) === userId) || null,
    assistant_message: messages.find((message) => String(message.id) === assistantId) || null,
  };
}


async function submitWorkspaceTurn({ orgId, threadId, messageId, assistantMessageId, content, inputMode, images, allowBrowser, actor, route, reviewOfTurnId }, { restImpl }) {
  requireWorkspaceOwner(orgId, actor);
  await assertWorkspaceSchema(restImpl);
  const requestedRoute = normalizeOwnerRoute(route);
  if (requestedRoute.target && allowBrowser === true) {
    throw workspaceError('AI_ROUTE_TOOLS_DISABLED', 'This compute selection runs inference only. Turn off browser access to send this message.', 400);
  }
  const turnImages = normalizeImages(images, content);
  if ((turnImages.length || allowBrowser === true) && !requestedRoute.implementation.includes('-vl.')) throw workspaceError('AI_MODEL_NEEDS_VISION', 'Choose a connected vision model to use images or the browser.', 400);
  let reviewSource = null;
  if (reviewOfTurnId) {
    const previous = await getResidentAiTurn({ orgId, turnId: requireUuid(reviewOfTurnId, 'review_of_turn_id') }, { restImpl });
    const answer = previous.assistant_message;
    const sourceNode = answer?.metadata?.node?.node_id;
    if (!answer || answer.metadata?.inference === 'refused' || !sourceNode) throw workspaceError('AI_REVIEW_NOT_READY', 'Only a completed answer with a verified device receipt can be reviewed.');
    if (requestedRoute.mode !== 'node' || requestedRoute.node_id === sourceNode) throw workspaceError('AI_REVIEW_DEVICE_REQUIRED', 'Choose a different worker for this review.');
    reviewSource = { turn_id: reviewOfTurnId, message_id: answer.id, node_id: sourceNode };
  }
  const metadata = {
    input_mode: inputMode === 'voice' ? 'voice' : 'text', execution_kind: 'resident_ai_turn',
    agent_job_id: messageId, task_status: 'queued', workspace_route: requestedRoute,
    actor_user_id: actor.user_id, actor_kind: 'owner', allow_browser: allowBrowser === true,
    ...(turnImages.length ? { images: turnImages } : {}),
    ...(reviewSource ? { review_of_turn_id: reviewOfTurnId, review_source: reviewSource } : {}),
  };
  const { body: row } = await restImpl('rpc/ops_ai_submit_workspace_turn', { method: 'POST', body: JSON.stringify({
    p_org_id: orgId, p_thread_id: threadId, p_user_message_id: messageId, p_assistant_message_id: assistantMessageId, p_content: content, p_metadata: metadata,
  }) });
  if (!row?.job_id) throw workspaceError('AI_TURN_NOT_QUEUED', 'Core could not durably queue this turn.', 503);
  return { queued: true, turn_id: row.job_id, job_status: row.job_status, thread_id: threadId, user_message_id: row.user_message_id, assistant_message_id: row.assistant_message_id, route: requestedRoute };
}

export async function stopResidentAiTurn({ orgId, turnId, actor } = {}, { restImpl = rest } = {}) {
  requireWorkspaceOwner(orgId, actor);
  await assertWorkspaceSchema(restImpl);
  const { body } = await restImpl('rpc/ops_ai_stop_workspace_turn', { method: 'POST', body: JSON.stringify({ p_org_id: requireUuid(orgId, 'org_id'), p_turn_id: requireUuid(turnId, 'turn_id') }) });
  return body;
}
