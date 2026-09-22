import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMeetingEngineClient,
  delegateDisplayName,
  inferMeetingPlatform,
  joinMeeting,
  meetingEngineConfigured,
  normalizeMeetingTarget,
  speakInMeeting,
} from '../src/meeting/engine.mjs';
import { openMeetingTarget, sealMeetingTarget } from '../src/meeting/target-crypto.mjs';

test('meeting platform inference covers Meet, Zoom, Teams and Jitsi', () => {
  assert.equal(inferMeetingPlatform('https://meet.google.com/abc-defg-hij'), 'google_meet');
  assert.equal(inferMeetingPlatform('https://acme.zoom.us/j/123456789'), 'zoom');
  assert.equal(inferMeetingPlatform('https://teams.microsoft.com/l/meetup-join/abc'), 'teams');
  assert.equal(inferMeetingPlatform('https://meet.jit.si/mccluster-test'), 'jitsi');
});

test('meeting target preserves full URL while deriving native id when possible', () => {
  const meet = normalizeMeetingTarget({ meeting_url: 'https://meet.google.com/abc-defg-hij' });
  assert.equal(meet.platform, 'google_meet');
  assert.equal(meet.native_meeting_id, 'abc-defg-hij');

  const zoom = normalizeMeetingTarget({ meeting_url: 'https://acme.zoom.us/j/123456789?pwd=secret' });
  assert.equal(zoom.platform, 'zoom');
  assert.equal(zoom.native_meeting_id, '123456789');
  assert.equal(zoom.meeting_url, 'https://acme.zoom.us/j/123456789?pwd=secret');
});

test('delegate identity is always disclosed in the display name', () => {
  assert.equal(delegateDisplayName('delegate', 'Matthew McCluster'), 'McCluster AI Delegate for Matthew');
  assert.equal(delegateDisplayName('notes', 'Matthew McCluster'), 'McCluster AI Notes for Matthew');
  assert.equal(delegateDisplayName('observe', 'Matthew McCluster'), 'McCluster AI Observer for Matthew');
});

test('engine configuration requires an API key', () => {
  assert.equal(meetingEngineConfigured({
    MCCLUSTER_MEETING_ENGINE_URL: 'http://127.0.0.1:18056',
    MCCLUSTER_MEETING_ENGINE_API_KEY: '',
  }), false);
  assert.equal(meetingEngineConfigured({
    MCCLUSTER_MEETING_ENGINE_URL: 'http://127.0.0.1:18056',
    MCCLUSTER_MEETING_ENGINE_API_KEY: 'owned-key',
  }), true);
});

test('join sends a transparent bot identity and never exposes the API key in payload', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 201,
      async text() { return JSON.stringify({ id: 'bot-1', status: 'requested' }); },
    };
  };
  const client = createMeetingEngineClient({
    baseUrl: 'http://127.0.0.1:18056',
    apiKey: 'top-secret-key',
    fetchImpl,
  });

  const result = await joinMeeting({
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    mode: 'delegate',
    principal_name: 'Matthew McCluster',
    transcription_authorized: true,
  }, client);

  assert.equal(result.bot_display_name, 'McCluster AI Delegate for Matthew');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:18056/bots');
  assert.equal(calls[0].init.headers['X-API-Key'], 'top-secret-key');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.bot_name, 'McCluster AI Delegate for Matthew');
  assert.equal(body.platform, 'google_meet');
  assert.equal(body.native_meeting_id, 'abc-defg-hij');
  assert.equal(JSON.stringify(body).includes('top-secret-key'), false);
});

test('transcription fails closed without authorization', async () => {
  const client = createMeetingEngineClient({
    baseUrl: 'http://127.0.0.1:18056',
    apiKey: 'key',
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });

  await assert.rejects(
    () => joinMeeting({
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      mode: 'notes',
      transcription_authorized: false,
    }, client),
    /transcription_authorized=true/
  );
});

test('speaking is fail-closed until interactive mode is explicitly enabled', async () => {
  const client = createMeetingEngineClient({
    baseUrl: 'http://127.0.0.1:18056',
    apiKey: 'key',
    interactiveEnabled: false,
    fetchImpl: async () => { throw new Error('fetch should not run'); },
  });

  await assert.rejects(
    () => speakInMeeting({
      platform: 'google_meet',
      native_meeting_id: 'abc-defg-hij',
      text: 'hello',
    }, client),
    /interactive meeting controls are disabled/
  );
});


test('scheduled meeting targets encrypt credentials at rest', () => {
  const secret = 'correct-horse-battery-staple-owned-key';
  const target = {
    platform: 'zoom',
    meeting_url: 'https://acme.zoom.us/j/123456789?pwd=secret-pass',
    native_meeting_id: '123456789',
    passcode: 'secret-pass',
  };

  const sealed = sealMeetingTarget(target, { secret });
  assert.equal(sealed.includes('secret-pass'), false);
  assert.deepEqual(openMeetingTarget(sealed, { secret }), target);
  assert.throws(() => openMeetingTarget(sealed, {
    secret: 'a-different-and-long-enough-secret-value'
  }));
});
