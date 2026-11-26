/* Append only ledger of everything that touches a recipient: send attempts, sends, failures, replies and opt outs.
   It lives in the state dir (gitignored, never committed). Every send is logged before and after the transport call. */
import fs from 'node:fs';
import path from 'node:path';

const OPT_OUT_RE = /\b(unsubscribe|remove me|opt out|do not (contact|email)|don't (contact|email)|stop emailing|take me off)\b/i;

export class Ledger {
  constructor(stateDir) {
    this.dir = stateDir;
    this.file = path.join(stateDir, 'send-log.jsonl');
    fs.mkdirSync(stateDir, { recursive: true });
  }
  entries() {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  append(event) {
    const row = { at: new Date().toISOString(), ...event, email: String(event.email || '').toLowerCase() };
    fs.appendFileSync(this.file, `${JSON.stringify(row)}\n`);
    return row;
  }
  /* Why this address can never get an automated letter again, or null if it can get its one initial letter. */
  blockReason(email) {
    const e = String(email || '').toLowerCase();
    const rows = this.entries().filter((r) => r.email === e);
    if (rows.some((r) => r.type === 'opt_out')) return 'opted_out';
    if (rows.some((r) => r.type === 'reply')) return 'replied';
    if (rows.some((r) => ['sent', 'send_attempt', 'send_failed', 'contacted'].includes(r.type))) return 'already_contacted';
    return null;
  }
  recordReply(email, { text = '', messageId = null } = {}) {
    const row = this.append({ type: 'reply', email, messageId });
    if (OPT_OUT_RE.test(text)) this.append({ type: 'opt_out', email, source: 'reply_text' });
    return row;
  }
  optOut(email, source = 'manual') { return this.append({ type: 'opt_out', email, source }); }
  markContacted(email, source = 'manual') { return this.append({ type: 'contacted', email, source }); }
}
