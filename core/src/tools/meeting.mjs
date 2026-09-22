import crypto from 'node:crypto';
import { enqueueJob, hasPendingJob } from '../supabase.mjs';
import {
  delegateDisplayName,
  getMeetingStatus,
  getMeetingTranscript,
  joinMeeting,
  leaveMeeting,
  meetingEngineConfigured,
  normalizeMeetingMode,
  normalizeMeetingTarget,
  readMeetingChat,
  sendMeetingChat,
  speakInMeeting,
} from '../meeting/engine.mjs';
import { sealMeetingTarget } from '../meeting/target-crypto.mjs';
import {
  createMeetingSession,
  meetingSessionById,
  updateMeetingSession,
} from '../meeting/store.mjs';

function clean(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function requireOrg(value) {
  const orgId = clean(value, 100);
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });
  return orgId;
}

function iso(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw Object.assign(new Error(`${field} must be a valid ISO datetime`), { status: 400 });
  }
  return date.toISOString();
}

function targetKey(target, start) {
  const source = target.native_meeting_id || target.meeting_url || 'meeting';
  return crypto.createHash('sha256').update(`${target.platform}:${source}:${start || ''}`).digest('hex').slice(0, 24);
}

function policyFromArgs(args, mode) {
  return {
    identity_disclosed: true,
    transcription_authorized: args.transcription_authorized === true,
    recording_authorized: args.recording_authorized === true,
    allow_speaking: mode === 'delegate' && args.allow_speaking === true,
    allow_chat: mode === 'delegate' && args.allow_chat === true,
    financial_authority: false,
    contracting_authority: false,
    legal_authority: false,
    medical_authority: false,
    academic_commitment_authority: false,
  };
}

const TARGET_PROPERTIES = {
  platform: { type: 'string', enum: ['google_meet', 'teams', 'zoom', 'jitsi'] },
  meeting_url: { type: 'string' },
  native_meeting_id: { type: 'string' },
  passcode: { type: 'string' },
};

export const MEETING_TOOLS = Object.freeze([
  {
    name: 'core.meeting.schedule',
    title: 'Schedule McCluster AI meeting attendance',
    description: 'Queue a disclosed McCluster AI attendee before a future meeting and a transcript/debrief collection job after it.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'scheduled_start', 'scheduled_end', 'transcription_authorized'],
      properties: {
        org_id: { type: 'string' },
        calendar_event_id: { type: 'string' },
        scheduled_start: { type: 'string' },
        scheduled_end: { type: 'string' },
        mode: { type: 'string', enum: ['notes', 'delegate', 'observe'] },
        principal_name: { type: 'string' },
        brief: { type: 'object' },
        transcription_authorized: { type: 'boolean' },
        recording_enabled: { type: 'boolean' },
        recording_authorized: { type: 'boolean' },
        allow_chat: { type: 'boolean' },
        allow_speaking: { type: 'boolean' },
        join_lead_seconds: { type: 'integer', minimum: 0, maximum: 900 },
        collect_delay_seconds: { type: 'integer', minimum: 0, maximum: 3600 },
        ...TARGET_PROPERTIES,
      },
    },
  },
  {
    name: 'core.meeting.join',
    title: 'Join meeting with McCluster AI',
    description: 'Immediately dispatch a transparently named McCluster AI attendee through the configured self-hosted meeting engine.',
    inputSchema: {
      type: 'object',
      required: ['transcription_authorized'],
      properties: {
        mode: { type: 'string', enum: ['notes', 'delegate', 'observe'] },
        principal_name: { type: 'string' },
        language: { type: 'string' },
        transcribe_enabled: { type: 'boolean' },
        transcription_authorized: { type: 'boolean' },
        recording_enabled: { type: 'boolean' },
        recording_authorized: { type: 'boolean' },
        ...TARGET_PROPERTIES,
      },
    },
  },
  {
    name: 'core.meeting.cancel',
    title: 'Remove McCluster AI from meeting',
    description: 'Remove the configured McCluster AI attendee from an active meeting.',
    inputSchema: { type: 'object', properties: TARGET_PROPERTIES },
  },
  {
    name: 'core.meeting.status',
    title: 'Read McCluster meeting bot status',
    description: 'Read live bot status from the configured self-hosted meeting engine.',
    inputSchema: { type: 'object', properties: TARGET_PROPERTIES },
  },
  {
    name: 'core.meeting.transcript',
    title: 'Read meeting transcript',
    description: 'Read the speaker-attributed transcript for one meeting from the configured self-hosted meeting engine.',
    inputSchema: { type: 'object', properties: TARGET_PROPERTIES },
  },
  {
    name: 'core.meeting.chat.read',
    title: 'Read meeting chat',
    description: 'Experimental: read meeting chat after the deployed engine build passes interactive-control validation.',
    inputSchema: { type: 'object', properties: TARGET_PROPERTIES },
  },
  {
    name: 'core.meeting.chat.send',
    title: 'Send meeting chat as AI delegate',
    description: 'Experimental: send clearly attributable AI delegate chat after interactive-control validation.',
    inputSchema: { type: 'object', required: ['text'], properties: { ...TARGET_PROPERTIES, text: { type: 'string' } } },
  },
  {
    name: 'core.meeting.speak',
    title: 'Speak as McCluster AI delegate',
    description: 'Experimental: synthesize speech into a live meeting only when the deployed engine has passed a live speaking test.',
    inputSchema: { type: 'object', required: ['text'], properties: { ...TARGET_PROPERTIES, text: { type: 'string' } } },
  },
  {
    name: 'core.meeting.session.get',
    title: 'Read meeting delegate session',
    description: 'Read one durable McCluster meeting delegate session from the canonical control plane.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'session_id'],
      properties: { org_id: { type: 'string' }, session_id: { type: 'string' } },
    },
  },
]);

export function activeMeetingTools() {
  return meetingEngineConfigured() ? MEETING_TOOLS : [];
}

export async function scheduleMeetingDelegate(args = {}) {
  const orgId = requireOrg(args.org_id);
  const target = normalizeMeetingTarget(args);
  const mode = normalizeMeetingMode(args.mode);
  const start = iso(args.scheduled_start, 'scheduled_start');
  const end = iso(args.scheduled_end, 'scheduled_end');
  if (new Date(end) <= new Date(start)) {
    throw Object.assign(new Error('scheduled_end must be after scheduled_start'), { status: 400 });
  }

  const principalName = clean(
    args.principal_name || process.env.MCCLUSTER_MEETING_PRINCIPAL_NAME || 'Matthew McCluster',
    200,
  );
  const botDisplayName = delegateDisplayName(mode, principalName);
  const brief = args.brief && typeof args.brief === 'object' ? args.brief : {};
  const policy = policyFromArgs(args, mode);

  if (mode !== 'observe' && policy.transcription_authorized !== true) {
    throw Object.assign(new Error('transcription_authorized=true is required for notes or delegate mode'), {
      status: 409,
      code: 'TRANSCRIPTION_AUTH_REQUIRED',
    });
  }
  if (args.recording_enabled === true && policy.recording_authorized !== true) {
    throw Object.assign(new Error('recording_authorized=true is required when recording is enabled'), {
      status: 409,
      code: 'RECORDING_AUTH_REQUIRED',
    });
  }

  const session = await createMeetingSession({
    orgId,
    calendarEventId: clean(args.calendar_event_id, 1000) || null,
    platform: target.platform,
    meetingUrlHash: target.meeting_url
      ? crypto.createHash('sha256').update(target.meeting_url).digest('hex')
      : null,
    nativeMeetingId: null,
    mode,
    botDisplayName,
    scheduledStart: start,
    scheduledEnd: end,
    brief,
    policy,
  });

  const sealedTarget = sealMeetingTarget(target);
  const key = clean(args.calendar_event_id, 1000) || targetKey(target, start);
  const joinLead = Math.min(900, Math.max(0, Number(args.join_lead_seconds ?? 120)));
  const collectDelay = Math.min(3600, Math.max(0, Number(args.collect_delay_seconds ?? 300)));
  const joinAtMs = Math.max(Date.now(), new Date(start).getTime() - joinLead * 1000);
  const collectAtMs = new Date(end).getTime() + collectDelay * 1000;

  const commonInput = {
    session_id: session.id,
    sealed_target: sealedTarget,
    target_platform: target.platform,
    mode,
    principal_name: principalName,
    brief,
    policy,
    transcribe_enabled: mode !== 'observe',
    transcription_authorized: policy.transcription_authorized,
    recording_enabled: args.recording_enabled === true,
    recording_authorized: policy.recording_authorized,
  };

  let joinJob = null;
  if (!(await hasPendingJob({ orgId, jobType: 'meeting_delegate_dispatch', targetId: key }))) {
    joinJob = await enqueueJob({
      orgId,
      jobType: 'meeting_delegate_dispatch',
      targetType: 'meeting',
      targetId: key,
      priority: 95,
      runAfter: new Date(joinAtMs).toISOString(),
      maxAttempts: 3,
      input: commonInput,
    });
  }

  let collectJob = null;
  if (!(await hasPendingJob({ orgId, jobType: 'meeting_delegate_collect', targetId: key }))) {
    collectJob = await enqueueJob({
      orgId,
      jobType: 'meeting_delegate_collect',
      targetType: 'meeting',
      targetId: key,
      priority: 90,
      runAfter: new Date(collectAtMs).toISOString(),
      maxAttempts: 4,
      input: commonInput,
    });
  }

  const updated = await updateMeetingSession({
    orgId,
    sessionId: session.id,
    patch: {
      status: 'scheduled',
      join_job_id: joinJob?.id || session.join_job_id || null,
      collect_job_id: collectJob?.id || session.collect_job_id || null,
    },
  });

  return {
    scheduled: true,
    session: updated,
    join_job: joinJob,
    collect_job: collectJob,
    join_at: new Date(joinAtMs).toISOString(),
    collect_at: new Date(collectAtMs).toISOString(),
  };
}

export async function callMeetingTool(name, args = {}) {
  if (name === 'core.meeting.schedule') return scheduleMeetingDelegate(args);
  if (name === 'core.meeting.join') return joinMeeting(args);
  if (name === 'core.meeting.cancel') return leaveMeeting(args);
  if (name === 'core.meeting.status') return getMeetingStatus(args);
  if (name === 'core.meeting.transcript') return getMeetingTranscript(args);
  if (name === 'core.meeting.chat.read') return readMeetingChat(args);
  if (name === 'core.meeting.chat.send') return sendMeetingChat(args);
  if (name === 'core.meeting.speak') return speakInMeeting(args);
  if (name === 'core.meeting.session.get') {
    const orgId = requireOrg(args.org_id);
    const sessionId = clean(args.session_id, 100);
    if (!sessionId) throw Object.assign(new Error('session_id is required'), { status: 400 });
    const session = await meetingSessionById({ orgId, sessionId });
    if (!session) throw Object.assign(new Error('meeting delegate session not found'), { status: 404 });
    return { session };
  }
  throw Object.assign(new Error(`Unknown meeting tool: ${name}`), { status: 404 });
}
