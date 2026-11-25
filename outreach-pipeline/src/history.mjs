/* Seed the similarity history and the do-not-contact lists from the hand built campaign files.
   Those files hold real names and addresses, so they stay on the box (default /workspace/hnw-outreach)
   and are read at run time; nothing from them is committed to this public repo. */
import fs from 'node:fs';
import path from 'node:path';

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/* "### 1. Andrew Ng  |  Frame A  |  AI education" sections, each with To:, Subject:, then the body until "---". */
export function parseCampaignHistory(md) {
  const text = String(md || '');
  const drafts = [];
  const sectionRe = /^###\s+\d+\.\s+(.+?)\s+\|\s+Frame\s+([ABC])\s+\|\s+(.+)$/gmu;
  const heads = [...text.matchAll(sectionRe)];
  heads.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    let chunk = text.slice(start, end);
    chunk = chunk.split(/^---\s*$/mu)[0];
    const to = (chunk.match(/^To:\s*(\S+)/mu) || [])[1] || '';
    const subject = (chunk.match(/^Subject:\s*(.+)$/mu) || [])[1] || '';
    const afterSubject = chunk.split(/^Subject:.*$/mu)[1] || '';
    const body = afterSubject.split(/^(Follow up|Follow-up|Followup|Sources?|Research|Notes?)\b.*$/imu)[0].trim();
    drafts.push({ recipient: m[1].trim(), frame: m[2], category: m[3].trim(), to: to.trim(), subject: subject.trim(), body });
  });
  const holdSection = (text.split(/^##\s+Hold list.*$/imu)[1] || '').split(/^##\s+/mu)[0];
  const hold = [];
  for (const m of holdSection.matchAll(/^[-*]\s+(.+)$/gmu)) {
    const lead = m[1].split(/\.\s/u)[0].replace(/\([^)]*\)/gu, ' ');
    for (const piece of lead.split(/,|\/|\band\b|;/u)) {
      const name = piece.trim().match(/^((?:[A-Z][\p{L}'.]+\s){1,2}[A-Z][\p{L}'.]+)$/u);
      if (name) hold.push(name[1].trim());
    }
  }
  return { drafts, hold };
}

export function loadHistory(dir) {
  const out = { items: [], contactedEmails: new Set(), contactedNames: new Set(), holdNames: new Set(), files: [] };
  if (!dir || !fs.existsSync(dir)) return out;
  const read = (f) => { const p = path.join(dir, f); if (!fs.existsSync(p)) return null; out.files.push(p); return fs.readFileSync(p, 'utf8'); };
  const seen = new Set();
  const add = (item, source) => {
    const key = `${String(item.to || '').toLowerCase()}|${String(item.subject || '').trim()}`;
    if (!item.body || seen.has(key)) return;
    seen.add(key);
    out.items.push({ ...item, source, label: item.recipient || item.to });
  };
  const draftsJson = read('drafts.json');
  if (draftsJson) {
    for (const d of JSON.parse(draftsJson)) add({ to: d.to, subject: d.subject, body: d.body, id: `seed:drafts.json:${d.n ?? d.to}` }, 'drafts.json');
  }
  const md = read('campaign-history.md');
  if (md) {
    const { drafts, hold } = parseCampaignHistory(md);
    for (const d of drafts) add({ ...d, id: `seed:campaign-history:${d.to || d.recipient}` }, 'campaign-history.md');
    for (const h of hold) out.holdNames.add(h.toLowerCase());
  }
  const log = read('split-test-log.csv');
  if (log) {
    for (const r of parseCsv(log)) {
      if (r.email) out.contactedEmails.add(r.email.toLowerCase());
      if (r.recipient) out.contactedNames.add(r.recipient.toLowerCase());
    }
  }
  const shortlist = read('shortlist.csv');
  if (shortlist) {
    for (const r of parseCsv(shortlist)) {
      if (r.email) out.contactedEmails.add(r.email.toLowerCase());
      if (r.name) out.contactedNames.add(r.name.toLowerCase());
    }
  }
  for (const it of out.items) if (it.to) out.contactedEmails.add(String(it.to).toLowerCase());
  return out;
}
