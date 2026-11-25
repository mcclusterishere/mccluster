/* Storage. Two interchangeable stores with the same methods:
     LocalStore     one JSON file under OUTREACH_DATA_DIR (default ./outreach-data, git ignored). Offline runs and tests.
     SupabaseStore  the outreach_* tables from supabase/pending/20261125090000_mentor_outreach_pipeline_v1.sql,
                    over PostgREST with the service key the Core runner already holds.
   Draft statuses: drafted -> pending_review -> approved | rejected; approved -> sent. 'seeded' marks history
   imported from the hand built campaign files (already sent or reviewed elsewhere). */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DRAFT_STATUSES = Object.freeze(['drafted', 'pending_review', 'approved', 'rejected', 'sent', 'seeded']);
const now = () => new Date().toISOString();

export class LocalStore {
  constructor(dir) {
    this.dir = dir || path.resolve(process.cwd(), 'outreach-data');
    this.file = path.join(this.dir, 'store.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : { candidates: [], sources: [], drafts: [], sends: [], replies: [], runs: [] };
  }
  save() { fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1), { mode: 0o600 }); }
  async findCandidate({ nameKey, email }) {
    return this.data.candidates.find((c) => (nameKey && c.name_key === nameKey) || (email && c.email && c.email.toLowerCase() === email.toLowerCase())) || null;
  }
  async upsertCandidate(c) {
    const existing = await this.findCandidate({ nameKey: c.name_key });
    if (existing) { Object.assign(existing, c, { id: existing.id, updated_at: now() }); this.save(); return existing; }
    const row = { id: randomUUID(), created_at: now(), updated_at: now(), ...c };
    this.data.candidates.push(row); this.save(); return row;
  }
  async addSources(rows) { for (const r of rows) this.data.sources.push({ id: randomUUID(), created_at: now(), ...r }); this.save(); }
  async insertDraft(d) { const row = { id: randomUUID(), created_at: now(), updated_at: now(), ...d }; this.data.drafts.push(row); this.save(); return row; }
  async updateDraft(id, patch) { const d = this.data.drafts.find((x) => x.id === id); if (!d) throw new Error(`no draft ${id}`); Object.assign(d, patch, { updated_at: now() }); this.save(); return d; }
  async getDraft(id) { return this.data.drafts.find((x) => x.id === id || x.id.startsWith(id)) || null; }
  async listDrafts({ status, reviewDay } = {}) {
    return this.data.drafts.filter((d) => (!status || [].concat(status).includes(d.status)) && (!reviewDay || d.review_day === reviewDay));
  }
  async insertSend(s) {
    if (this.data.sends.some((x) => x.draft_id === s.draft_id)) throw new Error('draft already sent');
    const row = { id: randomUUID(), ...s }; this.data.sends.push(row); this.save(); return row;
  }
  async listSends({ day } = {}) { return this.data.sends.filter((s) => !day || s.sent_day === day); }
  async insertReply(r) {
    if (r.gmail_message_id && this.data.replies.some((x) => x.gmail_message_id === r.gmail_message_id)) return null;
    const row = { id: randomUUID(), created_at: now(), ...r }; this.data.replies.push(row); this.save(); return row;
  }
  async listReplies() { return this.data.replies; }
  async recordRun(run) { this.data.runs.push(run); this.save(); }
}

/* rest(path, init) is the Core runner's PostgREST helper (core/src/supabase.mjs), or any function with that shape. */
export class SupabaseStore {
  constructor(rest) { if (typeof rest !== 'function') throw new Error('SupabaseStore needs a rest(path, init) function'); this.rest = rest; }
  async q(p, init) { const { body } = await this.rest(p, init); return body; }
  post(table, row, prefer = 'return=representation') { return this.q(table, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(row) }); }
  async findCandidate({ nameKey, email }) {
    const params = new URLSearchParams({ select: '*', limit: '1' });
    if (nameKey && email) params.set('or', `(name_key.eq.${nameKey},email.eq.${email.toLowerCase()})`);
    else if (nameKey) params.set('name_key', `eq.${nameKey}`);
    else params.set('email', `eq.${String(email).toLowerCase()}`);
    return (await this.q(`outreach_candidates?${params}`))[0] || null;
  }
  async upsertCandidate(c) {
    const rows = await this.post('outreach_candidates?on_conflict=name_key', { ...c, updated_at: now() }, 'resolution=merge-duplicates,return=representation');
    return rows[0];
  }
  async addSources(rows) { if (rows.length) await this.post('outreach_sources', rows, 'return=minimal'); }
  async insertDraft(d) { return (await this.post('outreach_drafts', d))[0]; }
  async updateDraft(id, patch) {
    const rows = await this.q(`outreach_drafts?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!rows.length) throw new Error(`no draft ${id}`); return rows[0];
  }
  async getDraft(id) { return (await this.q(`outreach_drafts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0] || null; }
  async listDrafts({ status, reviewDay } = {}) {
    const params = new URLSearchParams({ select: '*', order: 'created_at.asc', limit: '5000' });
    if (status) params.set('status', `in.(${[].concat(status).join(',')})`);
    if (reviewDay) params.set('review_day', `eq.${reviewDay}`);
    return this.q(`outreach_drafts?${params}`);
  }
  async insertSend(s) { return (await this.post('outreach_sends', s))[0]; }
  async listSends({ day } = {}) { return this.q(`outreach_sends?select=*${day ? `&sent_day=eq.${day}` : ''}&limit=10000`); }
  async insertReply(r) { const rows = await this.post('outreach_replies?on_conflict=gmail_message_id', r, 'resolution=ignore-duplicates,return=representation'); return rows[0] || null; }
  async listReplies() { return this.q('outreach_replies?select=*&limit=10000'); }
  async recordRun(run) { await this.post('outreach_runs', run, 'return=minimal').catch(() => null); }
}
