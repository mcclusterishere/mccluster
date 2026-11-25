/* Import the hand built batch (split-test-log.csv plus its letters) into a store, so per frame reply rates
   include it and the similarity guard sees it from the database too. Idempotent by recipient address. */
import { nyDay } from './config.mjs';

export async function seedStoreFromHistory({ store, history, logRows = [], config }) {
  const existing = await store.listDrafts();
  const have = new Set(existing.map((d) => `${String(d.to_email).toLowerCase()}|${d.subject}`));
  let drafts = 0, sends = 0, replies = 0;
  for (const item of history.items) {
    const to = String(item.to || '').toLowerCase();
    if (!to || have.has(`${to}|${item.subject}`)) continue;
    const log = logRows.find((r) => String(r.email || '').toLowerCase() === to);
    const draft = await store.insertDraft({ recipient_name: item.recipient || item.label || to, to_email: to, frame: log?.frame || item.frame || 'A', subject: item.subject, body: item.body, status: 'seeded', from_email: config.sendFrom, review_day: null, run_id: 'seed:hnw-outreach', guard_report: { seeded_from: item.source } });
    drafts += 1;
    if (log?.date_sent) {
      const sentAt = new Date(`${log.date_sent.replace(' ', 'T')}:00-05:00`);
      const send = await store.insertSend({ draft_id: draft.id, to_email: to, frame: draft.frame, from_email: config.sendFrom, gmail_message_id: (String(log.message_id || '').match(/^[0-9a-f]{12,}/) || [null])[0], sent_at: sentAt.toISOString(), sent_day: nyDay(sentAt, config.timeZone), seeded: true });
      sends += 1;
      if (/^y/i.test(log['replied (y/n)'] || log.replied || '')) {
        await store.insertReply({ send_id: send.id, draft_id: draft.id, frame: draft.frame, from_email: to, received_at: log.reply_date ? new Date(log.reply_date).toISOString() : sentAt.toISOString(), gmail_message_id: null, snippet: null });
        replies += 1;
      }
    }
  }
  return { drafts, sends, replies };
}
