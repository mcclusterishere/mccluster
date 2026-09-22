import { rest } from '../supabase.mjs';

function clean(value, max = 8000) {
  return String(value ?? '').trim().slice(0, max);
}

function queryValue(value) {
  return encodeURIComponent(String(value));
}

export async function findMeetingSession({ orgId, calendarEventId } = {}) {
  if (!orgId || !calendarEventId) return null;
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    calendar_event_id: `eq.${calendarEventId}`,
    select: '*',
    limit: '1',
  });
  const { body = [] } = await rest(`ops_meeting_delegate_sessions?${params.toString()}`);
  return body[0] || null;
}

export async function meetingSessionById({ orgId, sessionId } = {}) {
  if (!orgId || !sessionId) return null;
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    id: `eq.${sessionId}`,
    select: '*',
    limit: '1',
  });
  const { body = [] } = await rest(`ops_meeting_delegate_sessions?${params.toString()}`);
  return body[0] || null;
}

export async function createMeetingSession({
  orgId,
  calendarEventId = null,
  provider = 'vexa-compatible',
  platform,
  meetingUrlHash = null,
  nativeMeetingId = null,
  mode,
  botDisplayName,
  scheduledStart = null,
  scheduledEnd = null,
  brief = {},
  policy = {},
} = {}) {
  if (!orgId) throw new Error('createMeetingSession requires orgId');
  if (!platform) throw new Error('createMeetingSession requires platform');
  if (!mode) throw new Error('createMeetingSession requires mode');

  if (calendarEventId) {
    const existing = await findMeetingSession({ orgId, calendarEventId });
    if (existing) return existing;
  }

  const row = {
    org_id: orgId,
    calendar_event_id: calendarEventId ? clean(calendarEventId, 1000) : null,
    provider,
    platform,
    meeting_url_hash: meetingUrlHash,
    native_meeting_id: nativeMeetingId ? clean(nativeMeetingId, 1000) : null,
    mode,
    bot_display_name: clean(botDisplayName, 300),
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    brief: brief && typeof brief === 'object' ? brief : {},
    policy: policy && typeof policy === 'object' ? policy : {},
    status: 'scheduled',
  };

  const { body = [] } = await rest('ops_meeting_delegate_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!body[0]) throw new Error('Failed to create meeting delegate session');
  return body[0];
}

export async function updateMeetingSession({ orgId, sessionId, patch } = {}) {
  if (!orgId || !sessionId) throw new Error('updateMeetingSession requires orgId and sessionId');
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${sessionId}` });
  const safePatch = {
    ...(patch && typeof patch === 'object' ? patch : {}),
    updated_at: new Date().toISOString(),
  };
  const { body = [] } = await rest(`ops_meeting_delegate_sessions?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(safePatch),
  });
  if (!body[0]) throw new Error(`Meeting delegate session not found: ${sessionId}`);
  return body[0];
}

export async function addMeetingSessionEvent({
  orgId,
  sessionId,
  eventType,
  payload = {},
  occurredAt = new Date().toISOString(),
} = {}) {
  if (!orgId || !sessionId || !eventType) throw new Error('meeting event requires orgId, sessionId, and eventType');
  const row = {
    org_id: orgId,
    session_id: sessionId,
    event_type: clean(eventType, 160),
    payload: payload && typeof payload === 'object' ? payload : { value: clean(payload, 8000) },
    occurred_at: occurredAt,
  };
  const { body = [] } = await rest('ops_meeting_delegate_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return body[0] || null;
}
