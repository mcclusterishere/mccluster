import {
  joinMeeting,
  sendMeetingChat,
} from '../meeting/engine.mjs';
import { openMeetingTarget } from '../meeting/target-crypto.mjs';
import {
  addMeetingSessionEvent,
  updateMeetingSession,
} from '../meeting/store.mjs';

function clean(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function providerBotId(result) {
  const body = result?.result || {};
  return clean(body.bot_id || body.id || body.meeting_id || body.data?.bot_id || body.data?.id, 500) || null;
}

function providerStatus(result) {
  const body = result?.result || {};
  return clean(body.status || body.state || body.data?.status || body.data?.state, 200) || null;
}

function disclosure(principalName = 'Matthew McCluster') {
  const first = clean(principalName, 200).split(/\s+/).filter(Boolean)[0] || 'Matthew';
  return `Hi, I am the McCluster AI Delegate for ${first}. ${first} is unavailable to attend personally. I am here as a disclosed AI assistant to capture the discussion and, only within the authority he provided, answer project questions. Anything requiring his approval will be recorded for follow up.`;
}

export async function meetingDelegateDispatch(job) {
  const orgId = job.org_id;
  const input = job.input || {};
  const sessionId = clean(input.session_id, 100);
  if (!orgId || !sessionId) {
    throw new Error('meeting_delegate_dispatch requires org_id and input.session_id');
  }
  const target = openMeetingTarget(input.sealed_target);

  await updateMeetingSession({
    orgId,
    sessionId,
    patch: { status: 'dispatching', last_error: null },
  });

  await addMeetingSessionEvent({
    orgId,
    sessionId,
    eventType: 'dispatch_started',
    payload: { worker_job_id: job.id, platform: target.platform },
  });

  try {
    const joined = await joinMeeting({
      ...target,
      mode: input.mode || 'notes',
      principal_name: input.principal_name || 'Matthew McCluster',
      transcribe_enabled: input.transcribe_enabled === true,
      transcription_authorized: input.transcription_authorized === true,
      recording_enabled: input.recording_enabled === true,
      recording_authorized: input.recording_authorized === true,
    });

    let chatDisclosure = null;
    if (input.policy?.allow_chat === true && process.env.MCCLUSTER_MEETING_INTERACTIVE === '1') {
      try {
        chatDisclosure = await sendMeetingChat({
          ...target,
          text: disclosure(input.principal_name),
        });
      } catch (error) {
        chatDisclosure = { ok: false, error: clean(error.message, 1000) };
      }
    }

    const botId = providerBotId(joined);
    const engineStatus = providerStatus(joined);
    const now = new Date().toISOString();

    await updateMeetingSession({
      orgId,
      sessionId,
      patch: {
        status: 'dispatched',
        provider_bot_id: botId,
        dispatched_at: now,
        last_error: null,
      },
    });

    await addMeetingSessionEvent({
      orgId,
      sessionId,
      eventType: 'dispatch_accepted',
      payload: {
        bot_id: botId,
        bot_display_name: joined.bot_display_name,
        platform: joined.target.platform,
        engine_status: engineStatus,
        chat_disclosure: chatDisclosure,
      },
    });

    return {
      executor: 'meeting_delegate_dispatch:v1',
      summary: `Dispatched ${joined.bot_display_name} to ${joined.target.platform}`,
      session_id: sessionId,
      provider: joined.provider,
      mode: joined.mode,
      platform: joined.target.platform,
      bot_display_name: joined.bot_display_name,
      provider_bot_id: botId,
      engine_status: engineStatus,
      chat_disclosure: chatDisclosure,
    };
  } catch (error) {
    await updateMeetingSession({
      orgId,
      sessionId,
      patch: { status: 'failed', last_error: clean(error.message, 4000) },
    }).catch(() => null);

    await addMeetingSessionEvent({
      orgId,
      sessionId,
      eventType: 'dispatch_failed',
      payload: {
        error: clean(error.message, 4000),
        code: error.code || null,
        status: error.status || null,
      },
    }).catch(() => null);
    throw error;
  }
}
