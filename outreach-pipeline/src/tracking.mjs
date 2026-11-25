/* Replies and per frame reply rates (A student interview, B observation plus question, C power). */
import { FRAME_KEYS, FRAMES } from './config.mjs';

export async function recordReply({ store, fromEmail, receivedAt, messageId = null, snippet = null }) {
  const sends = await store.listSends();
  const send = sends.filter((s) => String(s.to_email).toLowerCase() === String(fromEmail).toLowerCase()).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
  if (!send) return { matched: false };
  const row = await store.insertReply({ send_id: send.id, draft_id: send.draft_id, frame: send.frame, from_email: String(fromEmail).toLowerCase(), received_at: new Date(receivedAt).toISOString(), gmail_message_id: messageId, snippet: snippet ? String(snippet).slice(0, 500) : null });
  return { matched: true, duplicate: !row, reply: row, frame: send.frame };
}

export function frameStats({ sends, replies }) {
  const repliedSends = new Set(replies.map((r) => r.send_id));
  return FRAME_KEYS.map((f) => {
    const s = sends.filter((x) => x.frame === f);
    const replied = s.filter((x) => repliedSends.has(x.id)).length;
    return { frame: f, label: FRAMES[f].label, sent: s.length, replied, reply_rate: s.length ? +(replied / s.length).toFixed(4) : null };
  });
}
