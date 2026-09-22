const DEFAULT_BASE = 'http://127.0.0.1:18056';
const SUPPORTED_PLATFORMS = new Set(['google_meet', 'teams', 'zoom', 'jitsi']);
const SUPPORTED_MODES = new Set(['notes', 'delegate', 'observe']);

function clean(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function stripTrailingSlash(value) {
  return clean(value, 2000).replace(/\/+$/, '');
}

function requirePlatform(value) {
  const platform = clean(value, 100);
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw Object.assign(new Error('platform must be google_meet, teams, zoom, or jitsi'), { status: 400 });
  }
  return platform;
}

export function inferMeetingPlatform(meetingUrl) {
  const url = new URL(clean(meetingUrl, 4000));
  const host = url.hostname.toLowerCase();
  if (host === 'meet.google.com') return 'google_meet';
  if (host.endsWith('zoom.us')) return 'zoom';
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'teams';
  if (host === 'meet.jit.si' || host.includes('jitsi')) return 'jitsi';
  throw Object.assign(new Error(`Unsupported meeting host: ${host}`), { status: 400 });
}

export function inferNativeMeetingId(platform, meetingUrl) {
  const url = new URL(clean(meetingUrl, 4000));
  const path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');

  if (platform === 'google_meet') {
    const id = path.split('/').filter(Boolean).pop() || '';
    return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(id) ? id : id;
  }

  if (platform === 'zoom') {
    const match = path.match(/(?:^|\/)j\/(\d+)/i);
    return match?.[1] || '';
  }

  if (platform === 'teams') {
    const numeric = path.match(/(?:^|\/)meet\/(\d+)/i);
    return numeric?.[1] || '';
  }

  if (platform === 'jitsi') return path.split('/').filter(Boolean).pop() || '';
  return '';
}

export function normalizeMeetingTarget(args = {}) {
  const meetingUrl = clean(args.meeting_url, 4000);
  const platform = requirePlatform(args.platform || (meetingUrl ? inferMeetingPlatform(meetingUrl) : ''));
  const nativeMeetingId = clean(args.native_meeting_id || (meetingUrl ? inferNativeMeetingId(platform, meetingUrl) : ''), 1000);

  if (!meetingUrl && !nativeMeetingId) {
    throw Object.assign(new Error('meeting_url or native_meeting_id is required'), { status: 400 });
  }
  if ((platform === 'zoom' || platform === 'jitsi') && !meetingUrl) {
    throw Object.assign(new Error(`${platform} requires meeting_url for reliable joining`), { status: 400 });
  }

  return {
    platform,
    meeting_url: meetingUrl || null,
    native_meeting_id: nativeMeetingId || null,
    passcode: clean(args.passcode, 500) || null,
  };
}

export function normalizeMeetingMode(value = 'notes') {
  const mode = clean(value, 30) || 'notes';
  if (!SUPPORTED_MODES.has(mode)) {
    throw Object.assign(new Error('mode must be notes, delegate, or observe'), { status: 400 });
  }
  return mode;
}

export function delegateDisplayName(mode = 'notes', principalName = 'Matthew McCluster') {
  const normalizedMode = normalizeMeetingMode(mode);
  const first = clean(principalName, 200).split(/\s+/).filter(Boolean)[0] || 'Matthew';
  if (normalizedMode === 'delegate') return `McCluster AI Delegate for ${first}`;
  if (normalizedMode === 'observe') return `McCluster AI Observer for ${first}`;
  return `McCluster AI Notes for ${first}`;
}

export function meetingEngineConfigured(env = process.env) {
  return Boolean(clean(env.MCCLUSTER_MEETING_ENGINE_URL || DEFAULT_BASE, 2000) && clean(env.MCCLUSTER_MEETING_ENGINE_API_KEY, 4000));
}

export function createMeetingEngineClient({
  baseUrl = process.env.MCCLUSTER_MEETING_ENGINE_URL || DEFAULT_BASE,
  apiKey = process.env.MCCLUSTER_MEETING_ENGINE_API_KEY || '',
  fetchImpl = globalThis.fetch,
  interactiveEnabled = process.env.MCCLUSTER_MEETING_INTERACTIVE === '1',
  timeoutMs = Number(process.env.MCCLUSTER_MEETING_TIMEOUT_MS || 45_000),
} = {}) {
  const base = stripTrailingSlash(baseUrl || DEFAULT_BASE);
  const token = clean(apiKey, 8000);
  if (!base) throw Object.assign(new Error('MCCLUSTER_MEETING_ENGINE_URL is required'), { status: 503 });
  if (!token) throw Object.assign(new Error('MCCLUSTER_MEETING_ENGINE_API_KEY is required'), { status: 503 });
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  async function request(path, { method = 'GET', body = undefined } = {}) {
    const headers = { 'X-API-Key': token };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; }
    catch { data = raw; }

    if (!response.ok) {
      const detail = typeof data === 'object' && data ? (data.detail || data.error || data.message) : data;
      throw Object.assign(new Error(clean(detail || `meeting engine returned ${response.status}`, 2000)), {
        status: response.status,
        code: 'MEETING_ENGINE_ERROR',
        detail: data,
      });
    }
    return data;
  }

  return { request, baseUrl: base, interactiveEnabled };
}

export async function joinMeeting(args = {}, client = createMeetingEngineClient()) {
  const target = normalizeMeetingTarget(args);
  const mode = normalizeMeetingMode(args.mode);
  const principalName = clean(args.principal_name || process.env.MCCLUSTER_MEETING_PRINCIPAL_NAME || 'Matthew McCluster', 200);
  const transcribe = args.transcribe_enabled !== undefined ? args.transcribe_enabled === true : mode !== 'observe';
  const recording = args.recording_enabled === true;

  if (transcribe && args.transcription_authorized !== true) {
    throw Object.assign(new Error('transcription_authorized=true is required when transcription is enabled'), {
      status: 409,
      code: 'TRANSCRIPTION_AUTH_REQUIRED',
    });
  }
  if (recording && args.recording_authorized !== true) {
    throw Object.assign(new Error('recording_authorized=true is required when recording is enabled'), {
      status: 409,
      code: 'RECORDING_AUTH_REQUIRED',
    });
  }

  const payload = {
    platform: target.platform,
    bot_name: delegateDisplayName(mode, principalName),
    language: clean(args.language || 'en', 50),
    transcribe_enabled: transcribe,
    recording_enabled: recording,
  };
  if (target.meeting_url) payload.meeting_url = target.meeting_url;
  if (target.native_meeting_id) payload.native_meeting_id = target.native_meeting_id;
  if (target.passcode) payload.passcode = target.passcode;

  const result = await client.request('/bots', { method: 'POST', body: payload });
  return {
    provider: 'vexa-compatible',
    mode,
    target,
    bot_display_name: payload.bot_name,
    transcribe_enabled: transcribe,
    recording_enabled: recording,
    result,
  };
}

export async function leaveMeeting(args = {}, client = createMeetingEngineClient()) {
  const target = normalizeMeetingTarget(args);
  if (!target.native_meeting_id) {
    throw Object.assign(new Error('native_meeting_id is required to remove an active bot'), { status: 400 });
  }
  const path = `/bots/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.native_meeting_id)}`;
  return {
    provider: 'vexa-compatible',
    target,
    result: await client.request(path, { method: 'DELETE' }),
  };
}

export async function getMeetingStatus(args = {}, client = createMeetingEngineClient()) {
  const target = (args.meeting_url || args.native_meeting_id || args.platform) ? normalizeMeetingTarget(args) : null;
  const result = await client.request('/bots/status');
  return { provider: 'vexa-compatible', target, result };
}

export async function getMeetingTranscript(args = {}, client = createMeetingEngineClient()) {
  const target = normalizeMeetingTarget(args);
  if (!target.native_meeting_id) {
    throw Object.assign(new Error('native_meeting_id is required to fetch a transcript'), { status: 400 });
  }
  const path = `/transcripts/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.native_meeting_id)}`;
  return {
    provider: 'vexa-compatible',
    target,
    result: await client.request(path),
  };
}

export async function readMeetingChat(args = {}, client = createMeetingEngineClient()) {
  if (!client.interactiveEnabled) {
    throw Object.assign(new Error('interactive meeting controls are disabled until this engine build is live-validated'), {
      status: 409,
      code: 'MEETING_INTERACTIVE_DISABLED',
    });
  }
  const target = normalizeMeetingTarget(args);
  if (!target.native_meeting_id) throw Object.assign(new Error('native_meeting_id is required'), { status: 400 });
  const path = `/bots/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.native_meeting_id)}/chat`;
  return { provider: 'vexa-compatible', target, result: await client.request(path) };
}

export async function sendMeetingChat(args = {}, client = createMeetingEngineClient()) {
  if (!client.interactiveEnabled) {
    throw Object.assign(new Error('interactive meeting controls are disabled until this engine build is live-validated'), {
      status: 409,
      code: 'MEETING_INTERACTIVE_DISABLED',
    });
  }
  const target = normalizeMeetingTarget(args);
  if (!target.native_meeting_id) throw Object.assign(new Error('native_meeting_id is required'), { status: 400 });
  const text = clean(args.text, 4000);
  if (!text) throw Object.assign(new Error('text is required'), { status: 400 });
  const path = `/bots/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.native_meeting_id)}/chat`;
  return { provider: 'vexa-compatible', target, result: await client.request(path, { method: 'POST', body: { text } }) };
}

export async function speakInMeeting(args = {}, client = createMeetingEngineClient()) {
  if (!client.interactiveEnabled) {
    throw Object.assign(new Error('interactive meeting controls are disabled until this engine build is live-validated'), {
      status: 409,
      code: 'MEETING_INTERACTIVE_DISABLED',
    });
  }
  const target = normalizeMeetingTarget(args);
  if (!target.native_meeting_id) throw Object.assign(new Error('native_meeting_id is required'), { status: 400 });
  const text = clean(args.text, 4000);
  if (!text) throw Object.assign(new Error('text is required'), { status: 400 });
  const path = `/bots/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.native_meeting_id)}/speak`;
  return { provider: 'vexa-compatible', target, result: await client.request(path, { method: 'POST', body: { text } }) };
}
