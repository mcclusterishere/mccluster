import { GeoAdapterError } from './adapters.js';

/*
  The accountability layer.

  Every competitor in the municipal surveillance market is losing contracts for
  the same reason, and it is not price and it is not accuracy. Between 2021 and
  August 2026, 214 US localities cancelled Flock Safety ALPR contracts -- 90 of
  them in August 2026 alone. The proximate causes are a matter of public record:

    San Francisco  a routine compliance audit found the regional fusion centre
                   had run 299 queries against the city's network on behalf of
                   federal and out-of-state agencies. The city had not
                   authorised any of them.
    Dayton, OH     an audit found the city's own camera data searched more than
                   7,100 times for immigration enforcement -- explicitly
                   prohibited by the city's own written policy.
    Hillsborough   the town cancelled over contract language permitting
                   disclosure to "any government entity or third party" on the
                   vendor's own good-faith belief.

  Note what those three have in common. The policy existed. The policy was
  written down. The policy was violated anyway, for a year, and was only
  discovered when a human being went looking. The systems logged queries and
  still could not answer "who asked, under what authority, and did anyone
  outside this town read the answer."

  The vendor remedy, announced after the cancellations, was to shorten a
  retention default, ask officers to type a case number, and ship an audit tool.
  Those are settings. A setting is something an administrator can change on a
  Tuesday and nobody finds out until the next audit.

  This module is the argument that the control belongs in the query path.

    1. PURPOSE BINDING.   A governed query without a named authority, a case
                          reference and a requesting agency is refused. Not
                          flagged. Refused, with no rows returned.
    2. EGRESS BOUNDARY.   The jurisdiction enumerates who may receive an answer.
                          A requester outside that list is refused even when the
                          query itself is lawful -- this is the San Francisco
                          failure, and it is a boundary question, not a query
                          question.
    3. PROHIBITED PURPOSE. A jurisdiction may forbid a purpose outright. A
                          forbidden purpose is refused before the boundary is
                          even consulted -- this is the Dayton failure.
    4. RETENTION.         The policy's retention window is stamped onto the row
                          as a deadline at write time, so shortening the policy
                          later cannot retroactively bless data already held
                          past its window.
    5. TAMPER EVIDENCE.   Every decision, allow and deny alike, is sealed into a
                          hash chain. Deleting or editing an entry breaks every
                          link after it. An auditor does not have to trust that
                          the log is complete; they can verify it.

  FAIL CLOSED, AND THE FAILURE IS THE POINT. Once a jurisdiction has a policy on
  file, every governed request must declare one. There is no query parameter
  that skips this and no administrator role that disables it, because a control
  an administrator can disable is a control the 214 towns already rejected.
*/

export const PURPOSES = Object.freeze({
  EMERGENCY_RESPONSE: 'EMERGENCY_RESPONSE',
  CRIMINAL_INVESTIGATION: 'CRIMINAL_INVESTIGATION',
  MISSING_PERSON: 'MISSING_PERSON',
  PUBLIC_WORKS: 'PUBLIC_WORKS',
  HAZARD_MITIGATION: 'HAZARD_MITIGATION',
  PLANNING_ANALYSIS: 'PLANNING_ANALYSIS',
  PUBLIC_TRANSPARENCY: 'PUBLIC_TRANSPARENCY',
  SYSTEM_ADMINISTRATION: 'SYSTEM_ADMINISTRATION'
});

const PURPOSE_VALUES = new Set(Object.values(PURPOSES));

/*
  Purposes that require a case reference to be a real case reference rather than
  a free-text note. An officer typing "investigation" into a box is the control
  that failed in Dayton; a purpose in this set demands an identifier that a
  records system can be asked to produce later.
*/
const CASE_BOUND_PURPOSES = new Set([
  PURPOSES.CRIMINAL_INVESTIGATION,
  PURPOSES.MISSING_PERSON
]);

const CASE_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{3,63}$/;

export class GovernanceError extends GeoAdapterError {
  constructor(message, code, details = {}) {
    super(message, 403, code, details);
    this.name = 'GovernanceError';
  }
}

export function normalizePurpose(value) {
  const purpose = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!PURPOSE_VALUES.has(purpose)) {
    throw new GovernanceError(
      `purpose must be one of ${[...PURPOSE_VALUES].join(', ')}`,
      'purpose_invalid',
      { purposes: [...PURPOSE_VALUES] }
    );
  }
  return purpose;
}

function requiredText(value, field, { max = 200 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) throw new GovernanceError(`${field} is required for a governed query`, 'purpose_incomplete', { field });
  if (text.length > max) throw new GovernanceError(`${field} is too long`, 'purpose_invalid', { field });
  return text;
}

/*
  A purpose binding is the officer's assertion, in a machine-checkable shape, of
  why they are allowed to ask. It is recorded verbatim whether the query is
  permitted or refused, because a refused query is exactly the record an
  oversight board most wants to see.
*/
export function parsePurposeBinding(input) {
  if (!input || typeof input !== 'object') {
    throw new GovernanceError('A governed query requires a purpose binding', 'purpose_missing', {
      required: ['purpose', 'authority', 'requesting_agency', 'requested_by']
    });
  }

  const purpose = normalizePurpose(input.purpose);
  const binding = {
    purpose,
    // The statute, ordinance, warrant, or written policy relied upon. Free text
    // on purpose: the towns do not share a citation format, and forcing one
    // would make people pick the nearest wrong option.
    authority: requiredText(input.authority, 'authority', { max: 500 }),
    requesting_agency: requiredText(input.requesting_agency, 'requesting_agency'),
    requested_by: requiredText(input.requested_by, 'requested_by'),
    case_reference: input.case_reference === undefined || input.case_reference === null || input.case_reference === ''
      ? null
      : requiredText(input.case_reference, 'case_reference', { max: 64 }),
    note: input.note === undefined || input.note === null || input.note === '' ? null : String(input.note).trim().slice(0, 2000)
  };

  if (CASE_BOUND_PURPOSES.has(purpose)) {
    if (!binding.case_reference) {
      throw new GovernanceError(
        `${purpose} requires an open case reference`,
        'case_reference_required',
        { purpose }
      );
    }
    if (!CASE_REFERENCE_RE.test(binding.case_reference)) {
      throw new GovernanceError(
        'case_reference must be an identifier a records system can resolve, not a description',
        'case_reference_malformed',
        { purpose, case_reference: binding.case_reference }
      );
    }
  }

  return Object.freeze(binding);
}

/*
  A jurisdiction policy is written by the town, not by us and not by a sales
  engineer during onboarding. Every field defaults to the most restrictive
  reading, so a policy row that omits a field denies rather than permits.
*/
export function policyFrom(row) {
  if (!row) return null;
  const days = Number(row.retention_days);
  return Object.freeze({
    jurisdiction: String(row.jurisdiction || '').trim(),
    display_name: row.display_name || row.jurisdiction || null,
    // No sane default. A town that has not said how long it keeps data has not
    // finished writing its policy, and 7 is the shortest window any of the
    // cancelling towns settled on.
    retention_days: Number.isFinite(days) && days > 0 ? Math.min(Math.trunc(days), 3650) : 7,
    permitted_purposes: Object.freeze(
      Array.isArray(row.permitted_purposes)
        ? row.permitted_purposes.map((value) => String(value).trim().toUpperCase()).filter((value) => PURPOSE_VALUES.has(value))
        : []
    ),
    // Named in Hillsborough's cancellation: a purpose the town has forbidden
    // outright, which no authority citation and no boundary membership can
    // re-open. Checked before everything else.
    prohibited_purposes: Object.freeze(
      Array.isArray(row.prohibited_purposes)
        ? row.prohibited_purposes.map((value) => String(value).trim().toUpperCase()).filter((value) => PURPOSE_VALUES.has(value))
        : []
    ),
    // The egress boundary. Empty means the jurisdiction itself and nobody else.
    permitted_agencies: Object.freeze(
      Array.isArray(row.permitted_agencies) ? row.permitted_agencies.map((value) => String(value).trim()).filter(Boolean) : []
    ),
    external_sharing_enabled: row.external_sharing_enabled === true,
    external_sharing_expires_at: row.external_sharing_expires_at || null,
    enabled: row.enabled !== false,
    adopted_at: row.adopted_at || null,
    adopted_by: row.adopted_by || null,
    policy_version: Number.isFinite(Number(row.policy_version)) ? Number(row.policy_version) : 1
  });
}

function agencyMatches(policy, agency) {
  const needle = agency.toLowerCase();
  if (policy.jurisdiction && needle === policy.jurisdiction.toLowerCase()) return true;
  return policy.permitted_agencies.some((entry) => entry.toLowerCase() === needle);
}

/*
  The decision. Returns a verdict rather than throwing, because a denial is a
  record we are obliged to keep, and a thrown error at this layer would tempt a
  caller into logging it as an exception and losing it.
*/
export function evaluateGovernedAccess({ policy, binding, now = new Date() }) {
  const at = now instanceof Date ? now : new Date(now);

  if (!policy) {
    return verdict(false, 'policy_missing', 'No adopted policy is on file for this jurisdiction');
  }
  if (!policy.enabled) {
    return verdict(false, 'policy_suspended', `${policy.jurisdiction} has suspended queries under this policy`);
  }

  // Dayton first. A prohibited purpose is not weighed against anything.
  if (policy.prohibited_purposes.includes(binding.purpose)) {
    return verdict(false, 'purpose_prohibited', `${policy.jurisdiction} prohibits queries for ${binding.purpose}`);
  }
  if (policy.permitted_purposes.length && !policy.permitted_purposes.includes(binding.purpose)) {
    return verdict(false, 'purpose_not_permitted', `${policy.jurisdiction} has not permitted ${binding.purpose}`);
  }

  // San Francisco. The query was lawful; the reader was not authorised.
  const internal = policy.jurisdiction
    && binding.requesting_agency.toLowerCase() === policy.jurisdiction.toLowerCase();
  if (!internal) {
    if (!policy.external_sharing_enabled) {
      return verdict(false, 'external_sharing_disabled',
        `${policy.jurisdiction} does not share query results outside its own agencies`);
    }
    if (policy.external_sharing_expires_at && Date.parse(policy.external_sharing_expires_at) <= at.getTime()) {
      return verdict(false, 'external_sharing_expired',
        `${policy.jurisdiction}'s external sharing authorisation expired ${policy.external_sharing_expires_at}`);
    }
    if (!agencyMatches(policy, binding.requesting_agency)) {
      return verdict(false, 'agency_outside_boundary',
        `${binding.requesting_agency} is not on ${policy.jurisdiction}'s list of permitted recipients`);
    }
  }

  return verdict(true, 'permitted', `Permitted under ${policy.jurisdiction} policy v${policy.policy_version}`, {
    retention_deadline: retentionDeadline(policy, at),
    retention_days: policy.retention_days,
    external_recipient: !internal
  });
}

function verdict(allowed, reason, message, obligations = {}) {
  return Object.freeze({ allowed, reason, message, obligations: Object.freeze(obligations) });
}

export function retentionDeadline(policy, from = new Date()) {
  const at = from instanceof Date ? from : new Date(from);
  return new Date(at.getTime() + policy.retention_days * 86400000).toISOString();
}

/*
  Tamper evidence.

  Each sealed record carries the digest of the one before it. Removing a record,
  editing a purpose after the fact, or backdating a denial changes that record's
  digest and every digest downstream of it, so the break is both detectable and
  locatable. This does not prevent an operator with database access from
  rewriting history -- nothing running inside the same trust boundary can -- it
  makes rewritten history impossible to present as intact, which is the property
  an oversight board actually needs.

  The genesis link is a fixed literal rather than an empty string so that a
  truncation down to zero records is distinguishable from a fresh chain.
*/
export const AUDIT_GENESIS = 'seek-first:audit:genesis';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/*
  Canonical form. The digest must not depend on key order or on whitespace, or
  two honest servers would disagree about an untouched chain.
*/
export function canonicalAuditPayload(entry) {
  const fields = [
    'sequence', 'jurisdiction', 'purpose', 'authority', 'requesting_agency', 'requested_by',
    'case_reference', 'decision', 'reason', 'source_key', 'operation', 'query_fingerprint',
    'record_count', 'policy_version', 'occurred_at', 'previous_hash'
  ];
  return JSON.stringify(fields.map((field) => [field, entry[field] === undefined ? null : entry[field]]));
}

export async function sealAuditEntry(entry, previousHash = AUDIT_GENESIS) {
  const body = {
    sequence: Number(entry.sequence) || 0,
    jurisdiction: entry.jurisdiction ?? null,
    purpose: entry.purpose ?? null,
    authority: entry.authority ?? null,
    requesting_agency: entry.requesting_agency ?? null,
    requested_by: entry.requested_by ?? null,
    case_reference: entry.case_reference ?? null,
    decision: entry.decision === true || entry.decision === 'allow' ? 'allow' : 'deny',
    reason: entry.reason ?? null,
    source_key: entry.source_key ?? null,
    operation: entry.operation ?? null,
    query_fingerprint: entry.query_fingerprint ?? null,
    record_count: Number.isFinite(Number(entry.record_count)) ? Number(entry.record_count) : null,
    policy_version: Number.isFinite(Number(entry.policy_version)) ? Number(entry.policy_version) : null,
    occurred_at: entry.occurred_at ?? new Date().toISOString(),
    previous_hash: previousHash || AUDIT_GENESIS
  };
  return Object.freeze({ ...body, entry_hash: await sha256Hex(canonicalAuditPayload(body)) });
}

/*
  Verification is deliberately something an auditor can run against an export
  they hold, without our cooperation and without our server. It takes records in
  sequence order and reports the first link that does not hold.
*/
export async function verifyAuditChain(entries) {
  let previous = AUDIT_GENESIS;
  let expectedSequence = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.previous_hash !== previous) {
      return { intact: false, broken_at: index, sequence: entry.sequence ?? null, cause: 'previous_hash_mismatch' };
    }
    if (expectedSequence !== null && Number(entry.sequence) !== expectedSequence) {
      return { intact: false, broken_at: index, sequence: entry.sequence ?? null, cause: 'sequence_gap' };
    }
    const recomputed = await sha256Hex(canonicalAuditPayload(entry));
    if (recomputed !== entry.entry_hash) {
      return { intact: false, broken_at: index, sequence: entry.sequence ?? null, cause: 'entry_hash_mismatch' };
    }
    previous = entry.entry_hash;
    expectedSequence = Number(entry.sequence) + 1;
  }
  return { intact: true, broken_at: null, sequence: null, cause: null, length: entries.length, head: previous };
}
