/* Congress.gov parsers: bill, actions and text versions. Bill identity is
   congress + type + number (jurisdiction/body/session/identifier). A new text
   version is a new version row; the current status is kept with its action
   lineage, never overwritten without history. "Became law" is the only state
   that sets enacted. Pure; no network; key binding is checked by the gate. */
import { provenance, intakeRecord } from '../provenance.js';

export const PARSER_VERSION = 'eup.congress/1';
export const SOURCE_ID = 'congress_gov';
const RIGHTS = 'congress-gov-api-2026-11';
export const US_FEDERAL_JURISDICTION = 'us-federal';

const billKey = (b) => `${b.congress}-${String(b.type).toLowerCase()}${b.number}`;

export function parseCongressBill(json, { fetched_at, raw_hash = null }) {
  const b = json?.bill || json;
  if (!b?.congress || !b?.type || !b?.number) throw Object.assign(new Error('Congress bill record incomplete'), { status: 400, reason: 'parse_failed' });
  const key = billKey(b);
  const url = `https://api.congress.gov/v3/bill/${b.congress}/${String(b.type).toLowerCase()}/${b.number}`;
  const latest = b.latestAction || {};
  const enacted = /became (public |private )?law/i.test(latest.text || '') || Array.isArray(b.laws) && b.laws.length > 0;
  return intakeRecord(`bill:${key}`, {
    jurisdiction_external_id: US_FEDERAL_JURISDICTION, body: String(b.originChamber || 'Congress'), session: String(b.congress), identifier: `${String(b.type).toUpperCase()} ${b.number}`,
    title: String(b.title || '').trim() || `${String(b.type).toUpperCase()} ${b.number}`,
    status: latest.text ? String(latest.text).slice(0, 200) : 'unknown', status_at: latest.actionDate || null,
    enacted, enacted_at: enacted ? (latest.actionDate || null) : null, effective_at: null
  }, provenance({ source_id: SOURCE_ID, source_record_id: `bill:${key}`, url, fetched_at, upstream_updated_at: b.updateDate || null, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' }), raw_hash);
}

export function parseCongressActions(json, bill, { fetched_at, raw_hash = null }) {
  const key = billKey(bill);
  const url = `https://api.congress.gov/v3/bill/${bill.congress}/${String(bill.type).toLowerCase()}/${bill.number}/actions`;
  return (json?.actions || []).filter((a) => a?.actionDate && a?.text).map((a, i) => intakeRecord(`action:${key}:${a.actionDate}:${a.actionCode || i}`, {
    bill_external_id: `bill:${key}`, action_at: a.actionDate, chamber: a.sourceSystem?.name || null, description: String(a.text).slice(0, 1000),
    committee_external_id: a.committees?.[0]?.systemCode ? `committee:${a.committees[0].systemCode}` : null
  }, provenance({ source_id: SOURCE_ID, source_record_id: `action:${key}:${a.actionDate}:${a.actionCode || i}`, url, fetched_at, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' }), raw_hash));
}

/* Each text version becomes a bill record carrying text_hash so the store
   appends a version row only when the text changes. */
export function parseCongressTextVersions(json, billRecord, { fetched_at, raw_hash = null }) {
  const versions = (json?.textVersions || []).filter((v) => v?.type);
  return versions.map((v, i) => ({
    ...billRecord,
    text_hash: v.formats?.find((f) => f.url)?.url ? `url:${v.formats.find((f) => f.url).url}` : `type:${v.type}:${v.date || i}`,
    version_label: String(v.type), text_published_at: v.date ? String(v.date).slice(0, 10) : null,
    raw_hash: raw_hash ? `${raw_hash}:${i}` : null,
    provenance: provenance({ ...billRecord.provenance, fetched_at, coverage: 'partial' })
  }));
}
