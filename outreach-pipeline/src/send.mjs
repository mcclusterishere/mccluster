/* GATED SEND. Not called by the daily run, the Core executor, the timer or the CLI.
   It exists so a future, explicit human step can send ONE approved letter. Every gate must hold:
     * the caller passes approved: true AND confirmedBy (the human who said send);
     * OUTREACH_SEND_ENABLED=true in the environment;
     * the draft row is status 'approved' with approved_by and approved_at set;
     * from is mattmccluster@gmail.com, and the text still has no dashes;
     * today's sends are under 150 total and 50 for the frame (America/New_York day);
     * this address has never been sent this campaign before.
   transport is injected ({ send({ from, to, subject, body }) => { messageId, threadId } }). */
import { assertCanSend } from './caps.mjs';
import { dashViolations } from './text-rules.mjs';
import { nyDay } from './config.mjs';

export async function sendApprovedDraft({ store, draftId, approved, confirmedBy, transport, config, env = process.env, now = new Date() }) {
  if (approved !== true) throw new Error('refused: sendApprovedDraft needs approved: true from a human step');
  if (!String(confirmedBy || '').trim()) throw new Error('refused: confirmedBy is required');
  if (String(env.OUTREACH_SEND_ENABLED || '').toLowerCase() !== 'true') throw new Error('refused: OUTREACH_SEND_ENABLED is not true');
  if (!transport?.send) throw new Error('refused: no transport');
  const draft = await store.getDraft(draftId);
  if (!draft) throw new Error(`no draft ${draftId}`);
  if (draft.status !== 'approved' || !draft.approved_by || !draft.approved_at) throw new Error(`refused: draft ${draft.id} is ${draft.status}, not approved`);
  if ((draft.from_email || config.sendFrom) !== config.sendFrom) throw new Error('refused: wrong sending address');
  if (dashViolations(draft.subject).length || dashViolations(draft.body).length) throw new Error('refused: dash rule');
  const day = nyDay(now, config.timeZone);
  assertCanSend({ sendsToday: await store.listSends({ day }), frame: draft.frame, config });
  const everSent = await store.listSends();
  if (everSent.some((s) => String(s.to_email).toLowerCase() === String(draft.to_email).toLowerCase())) throw new Error(`refused: ${draft.to_email} was already sent`);
  const result = await transport.send({ from: config.sendFrom, to: draft.to_email, subject: draft.subject, body: draft.body });
  return recordSend({ store, draft, messageId: result?.messageId, threadId: result?.threadId, sentAt: now, config, confirmedBy });
}

/* Record a send that happened elsewhere (for example the Gmail connector after Matthew approved in chat). */
export async function recordSend({ store, draft, messageId = null, threadId = null, sentAt = new Date(), config, confirmedBy = null }) {
  if (draft.status !== 'approved') throw new Error(`draft ${draft.id} is ${draft.status}; only approved letters can be recorded as sent`);
  const day = nyDay(sentAt, config.timeZone);
  assertCanSend({ sendsToday: await store.listSends({ day }), frame: draft.frame, config });
  const send = await store.insertSend({ draft_id: draft.id, to_email: draft.to_email, frame: draft.frame, from_email: config.sendFrom, gmail_message_id: messageId, gmail_thread_id: threadId, sent_at: new Date(sentAt).toISOString(), sent_day: day, confirmed_by: confirmedBy });
  await store.updateDraft(draft.id, { status: 'sent' });
  return send;
}

/* Gmail API transport. Needs a user OAuth access token with gmail.send scope in GMAIL_ACCESS_TOKEN.
   Only constructed by a human driven script; never by the scheduled run. */
export function gmailTransport(accessToken, { fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken) throw new Error('gmailTransport needs an access token');
  return {
    async send({ from, to, subject, body }) {
      const mime = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
      const raw = Buffer.from(mime, 'utf8').toString('base64url');
      const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
      if (!res.ok) throw new Error(`gmail send ${res.status}`);
      const out = await res.json();
      return { messageId: out.id, threadId: out.threadId };
    },
  };
}
