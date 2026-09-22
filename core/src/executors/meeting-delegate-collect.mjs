import {
  getMeetingTranscript,
  leaveMeeting,
} from '../meeting/engine.mjs';
import {
  addMeetingSessionEvent,
  updateMeetingSession,
} from '../meeting/store.mjs';

const OLLAMA = String(process.env.MCCLUSTER_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.MCCLUSTER_OLLAMA_MODEL || 'qwen3:8b';

function clean(value, max = 100000) {
  return String(value ?? '').trim().slice(0, max);
}

function transcriptSegments(payload) {
  const root = payload?.result ?? payload ?? {};
  const candidates = [
    root?.data?.transcripts,
    root?.transcripts,
    root?.data?.segments,
    root?.segments,
    Array.isArray(root?.data) ? root.data : null,
    Array.isArray(root) ? root : null,
  ];
  return candidates.find(Array.isArray) || [];
}

function transcriptText(payload, maxChars = 90_000) {
  const segments = transcriptSegments(payload);
  const lines = [];
  for (const segment of segments) {
    const speaker = clean(segment?.speaker || segment?.speaker_name || segment?.name || 'Speaker', 200);
    const text = clean(segment?.text || segment?.content || segment?.transcript || '', 8000);
    if (!text) continue;
    const stamp = clean(segment?.time || segment?.timestamp || segment?.start || '', 100);
    lines.push(`${stamp ? `[${stamp}] ` : ''}${speaker}: ${text}`);
    if (lines.join('\n').length >= maxChars) break;
  }
  return clean(lines.join('\n'), maxChars);
}

function parseModelJson(text) {
  const raw = clean(text, 80_000);
  if (!raw) throw new Error('Ollama returned an empty meeting debrief');
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try { return JSON.parse(unfenced); }
  catch {
    return {
      executive_summary: raw,
      decisions: [],
      commitments_by_others: [],
      requested_from_matthew: [],
      open_questions: [],
      next_actions: [],
      risks: [],
      followup_draft: null,
    };
  }
}

async function summarizeMeeting({ transcript, brief, mode }) {
  const system = [
    'You are McCluster Core meeting debrief.',
    'Use only the supplied transcript and meeting brief.',
    'Do not invent decisions, commitments, prices, people, or facts.',
    'Separate what was actually said from inference.',
    'Return valid JSON only with keys: executive_summary, decisions, commitments_by_others, requested_from_matthew, open_questions, next_actions, risks, followup_draft.',
    'Each list item should be concise and concrete.',
    'followup_draft may be null when no follow up is justified.',
    'Do not execute or promise any external action.'
  ].join(' ');

  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({
            meeting_mode: mode,
            brief: brief || {},
            transcript,
          }),
        },
      ],
      options: {
        temperature: 0.1,
        num_ctx: Number(process.env.MCCLUSTER_OLLAMA_CONTEXT || 16384),
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.MCCLUSTER_OLLAMA_TIMEOUT_MS || 10 * 60_000)),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Ollama returned ${response.status}`);
  return {
    model: MODEL,
    debrief: parseModelJson(data?.message?.content || ''),
    usage: {
      prompt_eval_count: data?.prompt_eval_count ?? null,
      eval_count: data?.eval_count ?? null,
      total_duration_ns: data?.total_duration ?? null,
    },
  };
}

export async function meetingDelegateCollect(job) {
  const orgId = job.org_id;
  const input = job.input || {};
  const sessionId = clean(input.session_id, 100);
  if (!orgId || !sessionId) throw new Error('meeting_delegate_collect requires org_id and input.session_id');

  await updateMeetingSession({
    orgId,
    sessionId,
    patch: { status: 'collecting', last_error: null },
  });

  await addMeetingSessionEvent({
    orgId,
    sessionId,
    eventType: 'collection_started',
    payload: { worker_job_id: job.id },
  });

  try {
    let transcriptPayload = null;
    let transcript = '';

    if (input.transcribe_enabled === true) {
      transcriptPayload = await getMeetingTranscript(input.target || {});
      transcript = transcriptText(transcriptPayload);
      if (!transcript) {
        throw Object.assign(new Error('Meeting transcript is not available yet'), {
          code: 'TRANSCRIPT_NOT_READY',
          status: 409,
        });
      }
    }

    let leaveResult = null;
    try {
      leaveResult = await leaveMeeting(input.target || {});
    } catch (error) {
      leaveResult = { ok: false, error: clean(error.message, 1000), status: error.status || null };
    }

    let analysis = null;
    if (transcript) {
      analysis = await summarizeMeeting({
        transcript,
        brief: input.brief || {},
        mode: input.mode || 'notes',
      });
    } else {
      analysis = {
        model: null,
        debrief: {
          executive_summary: 'No transcript was requested for this meeting.',
          decisions: [],
          commitments_by_others: [],
          requested_from_matthew: [],
          open_questions: [],
          next_actions: [],
          risks: [],
          followup_draft: null,
        },
        usage: null,
      };
    }

    const now = new Date().toISOString();
    const transcriptForStorage = transcriptPayload?.result ?? transcriptPayload ?? null;
    const completed = await updateMeetingSession({
      orgId,
      sessionId,
      patch: {
        status: 'completed',
        completed_at: now,
        transcript: transcriptForStorage,
        summary: analysis.debrief,
        last_error: null,
      },
    });

    await addMeetingSessionEvent({
      orgId,
      sessionId,
      eventType: 'collection_completed',
      payload: {
        transcript_characters: transcript.length,
        model: analysis.model,
        leave_result: leaveResult,
      },
    });

    return {
      executor: 'meeting_delegate_collect:v1',
      summary: clean(analysis.debrief?.executive_summary || 'Meeting collected', 1000),
      session_id: sessionId,
      session_status: completed.status,
      transcript_characters: transcript.length,
      debrief: analysis.debrief,
      model: analysis.model,
      usage: analysis.usage,
      leave_result: leaveResult,
    };
  } catch (error) {
    await updateMeetingSession({
      orgId,
      sessionId,
      patch: { status: error.code === 'TRANSCRIPT_NOT_READY' ? 'collecting' : 'failed', last_error: clean(error.message, 4000) },
    }).catch(() => null);
    await addMeetingSessionEvent({
      orgId,
      sessionId,
      eventType: 'collection_failed',
      payload: { error: clean(error.message, 4000), code: error.code || null, status: error.status || null },
    }).catch(() => null);
    throw error;
  }
}
