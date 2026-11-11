/* Connecticut General Assembly bill record parser (proposed pilot). Input is a
   normalised record extracted from the official bill page/download; the live
   payload format was NOT verified (bulk download timed out in the bounded
   read), so this parser documents the fields it needs rather than a verified
   wire format. Pure; no network. */
import { provenance, intakeRecord } from '../provenance.js';

export const PARSER_VERSION = 'eup.ct-assembly/1';
export const SOURCE_ID = 'official_ct_legislation';
const RIGHTS = 'ct-cga-public-2026-11-unreviewed';
export const CT_JURISDICTION = 'ct-state';

export function parseCtAssemblyBill(record, { fetched_at, raw_hash = null }) {
  if (!record?.session || !record?.bill_number) throw Object.assign(new Error('CGA bill record needs session and bill_number'), { status: 400, reason: 'parse_failed' });
  const key = `${record.session}-${String(record.bill_number).replace(/\s+/g, '').toUpperCase()}`;
  const url = record.url || `https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Bill&bill_num=${encodeURIComponent(record.bill_number)}&which_year=${encodeURIComponent(record.session)}`;
  const enacted = Boolean(record.public_act_number);
  const base = { source_id: SOURCE_ID, url, fetched_at, upstream_updated_at: record.updated_at || null, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' };
  const bill = intakeRecord(`bill:${key}`, {
    jurisdiction_external_id: CT_JURISDICTION, body: record.chamber || 'General Assembly', session: String(record.session), identifier: String(record.bill_number).toUpperCase(),
    title: String(record.title || '').trim(), status: record.status || 'unknown', enacted, enacted_at: enacted ? (record.signed_on || null) : null, effective_at: record.effective_on || null,
    text_hash: record.text_version ? `cga:${key}:${record.text_version}` : null, version_label: record.text_version || null, text_published_at: record.text_published_on || null
  }, provenance({ ...base, source_record_id: `bill:${key}` }), raw_hash);
  const actions = (record.actions || []).filter((a) => a?.date && a?.text).map((a, i) => intakeRecord(`action:${key}:${a.date}:${i}`, {
    bill_external_id: `bill:${key}`, action_at: a.date, chamber: a.chamber || null, description: String(a.text).slice(0, 1000), committee_external_id: a.committee ? `committee:${a.committee}` : null
  }, provenance({ ...base, source_record_id: `action:${key}:${a.date}:${i}` }), raw_hash));
  const amendments = (record.amendments || []).filter((m) => m?.label).map((m) => intakeRecord(`amendment:${key}:${m.label}`, {
    bill_external_id: `bill:${key}`, label: String(m.label), status: m.status || 'proposed', applies_to_version: Number.isInteger(m.applies_to_version) ? m.applies_to_version : null
  }, provenance({ ...base, source_record_id: `amendment:${key}:${m.label}` }), raw_hash));
  return { bill, actions, amendments };
}
