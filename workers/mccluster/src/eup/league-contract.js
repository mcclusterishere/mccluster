/* E=Up League wire contract: the single source of truth for the Environmental
   Justice League commands, documents, state machines, errors, routes and media
   rules. Frozen data plus tiny pure helpers; imports nothing.

   Who reads it: the SQL (supabase/pending/eup_league_v1.sql), the Worker owner
   and member routes (./league.js, ./league-member.js), the media module
   (./league-media.js), the Control League tab and the member page. When any of
   them disagrees with this file, this file wins and the other is the defect.

   Boundaries this contract carries (owner direction 2026-11-09, admin-only release):
   - Three service-only RPCs. The actor is always the Worker-verified session
     user; no document may name another account.
   - Module state (enabled, draining, disabled) is NOT here. It lives in the
     module policy authority; every action below only names its guard class.
   - Owner policy VALUES (byte caps, durations, retention days, notice texts)
     are NOT here. This file ships shapes and hard technical ceilings only.
   - No points, payment, commission, live broadcast, or publication wider than
     a campaign's released audience: no action, route, state or enum for them.

   Decisions the design map left open are marked DECISION with a one-line reason. */

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

export const CONTRACT = 'eup.league.contract/v1';
export const MODULE = 'league';
/* The three functions and their argument names, in order. */
export const RPC = deepFreeze({ owner: 'eup_league_command', member: 'eup_league_member_command', seal: 'eup_league_media_seal' });
export const RPC_ARGUMENTS = deepFreeze({
  owner: ['p_action', 'p_actor', 'p_id', 'p_document', 'p_revision', 'p_key'],
  member: ['p_action', 'p_actor', 'p_id', 'p_document', 'p_revision', 'p_key'],
  seal: ['p_upload', 'p_actor', 'p_result']
});
export const PREFIX = deepFreeze({ owner: '/v1/eup/league', member: '/v1/eup/member/league' });

/* ------------------------------------------------------------------ 1. primitives */

export const PATTERNS = deepFreeze({
  uuid: /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, // any case on the wire, lower case when stored, hashed or put in a path
  idempotency_key: /^[A-Za-z0-9._:-]{8,128}$/,
  slug: /^[a-z0-9][a-z0-9-]{1,79}$/,
  sha256: /^[0-9a-f]{64}$/,
  notice_revision: /^[A-Za-z0-9._:-]{1,64}$/,
  rubric_id: /^[a-z0-9][a-z0-9_-]{0,39}$/,
  consumer: /^[a-z0-9][a-z0-9_-]{0,63}$/,
  operation: /^[a-z][a-z0-9_.]{2,63}$/,
  outbox_seq: /^[1-9][0-9]{0,17}$/,
  query_integer: /^(0|[1-9][0-9]{0,9})$/,
  timestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/ // RFC 3339, UTC with Z only
});
/* DECISION (review 2026-11-10): the form of a timestamp in an ANSWER. The SQL prints a timestamptz as PostgreSQL's jsonb
   does in a UTC session (its three functions pin TimeZone to UTC): RFC 3339 with the offset +00:00 and 0 to 6 fraction
   digits; a value the Worker makes itself may write the same instant with Z. PATTERNS.timestamp stays the INPUT form
   (Z only): a client parses an answered timestamp and never echoes it back as an input. */
export const RESULT_TIMESTAMP = deepFreeze(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/);

/* Text rules. Length is counted in Unicode code points (SQL length()), never UTF-16 units.
   text      : no U+0000..U+001F and no U+007F.
   multiline : the same, except LINE FEED (U+000A) and TAB (U+0009) are allowed.
   DECISION: carriage return is refused (clients send LF only) so one lyric has one byte form and one digest.
   Text is stored exactly as sent: no trimming, no Unicode normalisation. */
export const TEXT_RULES = deepFreeze({
  text: { refused: /[\u0000-\u001f\u007f]/ },
  multiline: { refused: /[\u0000-\u0008\u000b-\u001f\u007f]/ }
});

/* TECHNICAL limits only. Owner policy values are listed by NAME in OWNER_POLICY_FIELDS and have no value here (D3). */
export const LIMITS = deepFreeze({
  body_max_bytes: 65536, // HTTP request body, enforced by the Worker before parsing (413)
  document_max_bytes: 49152, // octet length of p_document as jsonb text, enforced in SQL (22023)
  revision_max: 2147483646,
  idempotency_key: PATTERNS.idempotency_key.source, // 8..128 of letters, digits, dot, underscore, colon, hyphen
  text: { title: 180, purpose: 2000, requirements: 4000, acceptance: 4000, rubric_label: 200, statement: 4000, reason: 2000, note: 500,
    policy_reason: 500, notice_text: 8000, lyrics: 10000, credit_name: 120, credit_role: 80, derivative_permissions: 2000, etag: 200 },
  count: { proof_modes: 5, rubric_criteria: 12, credits: 24, proof_media: 3, capacity: 100000 },
  list: { campaigns: 200, rows: 500, outbox: 200, purge_batch: 50 },
  /* Abuse bounds, all raise EU017. A member session bearer has no edge rate limit, so SQL holds the line. */
  rate: {
    applications_open_per_actor: 10, // applications in draft, submitted or changes_requested, across missions
    application_saves_per_application: 200, // ceiling of an application's revision counter for applications.save
    draft_saves_per_assignment: 5000, // ceiling of a draft's revision counter
    uploads_staged_per_assignment: 3, // staged at one time
    uploads_total_per_assignment: 30, // upload rows of an assignment, every state
    proof_revisions_per_assignment: 20,
    appeals_per_subject: 2, // appeals ever opened against one application or proof
    /* DECISION (review 2026-11-10): publication consents ever granted on one proof. Without it one participant's grant
       and revoke churn grew the consent table, the outbox, the receipts and their own member read without limit. With
       at most proof_revisions_per_assignment private_review consents beside it, one proof never lists more consent
       rows than an owner list returns (LIMITS.list.rows). */
    publish_consents_per_proof: 100
  },
  /* Validity ranges of owner policy fields: ceilings and floors, never defaults. */
  policy: { bytes: [1, 104857600], duration_seconds: [1, 3600], retention_days: [1, 3650] },
  /* DECISION: a publish consent must end within 366 days so "finite expiry" means something; the member picks the date. */
  consent_max_days: 366
});
export const OWNER_POLICY_FIELDS = deepFreeze(['entitlement', 'media.enabled', 'media.kinds', 'media.audio_max_bytes', 'media.video_max_bytes',
  'media.max_duration_seconds', 'retention.completed_days', 'retention.withdrawn_days',
  'notices.participation', 'notices.private_review', 'notices.publication']);

/* ------------------------------------------------------------------ 2. enumerations */

export const ENUMS = deepFreeze({
  CAMPAIGN_STATES: ['draft', 'released', 'paused', 'withdrawn'],
  MISSION_STATES: ['draft', 'released', 'paused', 'withdrawn'],
  TRANSITION_TARGETS: ['released', 'paused', 'withdrawn'],
  /* D5. Anything wider is impossible by CHECK; the two words below are listed only so every lane refuses them by name. */
  AUDIENCES: ['admin_preview', 'invited'],
  IMPOSSIBLE_AUDIENCES: ['public', 'members'],
  TEMPLATES: ['write-a-song', 'explain-a-source', 'map-a-community-resource', 'understand-a-policy', 'community-action-session'],
  /* DECISION: only the song template has a frozen proof rule, so only it can be RELEASED; the other four stay
     creatable drafts. A member is never led into a mission that cannot be completed. */
  RELEASABLE_TEMPLATES: ['write-a-song'],
  PROOF_MODES: ['audio', 'video', 'lyrics', 'text', 'link'],
  APPLICATION_STATUSES: ['draft', 'submitted', 'changes_requested', 'approved', 'declined', 'withdrawn'],
  APPLICATION_DECISIONS: ['approved', 'declined', 'changes_requested'],
  /* DECISION: no stored 'paused' assignment. Pause is a property of the campaign and mission (the audience gate),
     so nothing has to remember what to restore on re-release, and a paused seat is still a taken seat. */
  ASSIGNMENT_STATUSES: ['offered', 'accepted', 'completed', 'withdrawn'],
  SEAT_STATUSES: ['offered', 'accepted', 'completed'],
  PROOF_STATES: ['submitted', 'accepted', 'needs_changes', 'rejected'],
  MODERATION_STATES: ['clear', 'held'],
  PUBLICATION_STATES: ['private', 'published_released_audience', 'withdrawn'],
  PUBLICATION_DECISIONS: ['published', 'withdrawn'],
  PUBLICATION_ROW_STATES: ['published', 'withdrawn'],
  WITHDRAWN_REASONS: ['owner', 'consent_revoked', 'moderation_hold', 'media_purged', 'assignment_withdrawn', 'mission_withdrawn', 'campaign_withdrawn'],
  REVIEW_DIMENSIONS: ['mission', 'rights', 'safety'],
  DIMENSION_DECISIONS: ['pass', 'changes', 'fail'],
  CONSENT_PURPOSES: ['private_review', 'publish_proof'],
  CONSENT_AUDIENCES: ['reviewers', 'released_audience'],
  CONSENT_STATES: ['open', 'revoked', 'superseded', 'expired'],
  APPEAL_SUBJECTS: ['application', 'proof'],
  APPEAL_STATES: ['open', 'withdrawn', 'upheld', 'overturned'],
  APPEAL_OUTCOMES: ['upheld', 'overturned'],
  GRANT_STATES: ['open', 'revoked'],
  UPLOAD_STATES: ['staged', 'sealed', 'rejected', 'discarded', 'expired', 'purged'],
  SCAN_STATES: ['not_scanned'], // inspection is not malware scanning; every surface says so
  MEDIA_KINDS: ['audio', 'video'],
  MEDIA_FAMILIES: ['mpeg', 'iso_bmff', 'riff_wave', 'ebml', 'ogg'],
  SEAL_OUTCOMES: ['sealed', 'rejected'],
  REJECT_REASONS: ['empty', 'too_large', 'size_mismatch', 'unrecognised', 'family_mismatch'],
  DUE_REASONS: ['discarded', 'rejected', 'expired', 'staged_expired', 'retention_completed', 'retention_withdrawn'],
  /* DECISION: a second valid value exists so the owner can save media, retention and notices before deciding who
     may take part, and so EU012 is reachable from a VALID policy (an invalid one is EU010). */
  ENTITLEMENT_RULES: ['none_required', 'not_decided'],
  RIGHTS_VERSIONS: ['music-rights-v1'],
  SURFACES: ['owner', 'member', 'media'],
  GUARD_CLASSES: ['enabled', 'reduce', 'none'],
  MEMBER_GATES: ['audience', 'ownership', 'readiness', 'entitlement', 'media']
});
/* The consent pairs that exist. private_review is written by proofs.submit; publish_proof by consents.grant. */
export const CONSENT_SCOPES = deepFreeze({ private_review: 'reviewers', publish_proof: 'released_audience' });
/* Mission fields whose change is a change of what a participant agreed to. */
export const REQUIREMENTS_FIELDS = deepFreeze(['title', 'requirements', 'acceptance', 'proof_modes', 'rubric']);
export const TEMPLATE_RULES = deepFreeze({
  'write-a-song': { modes_allowed: ['audio', 'video', 'lyrics'], modes_required: ['lyrics'], modes_any_of: ['audio', 'video'] }
});

/* ------------------------------------------------------------------ 3. field notation and the document checker */

const R = (spec) => ({ ...spec, required: true });
const O = (spec) => ({ ...spec, required: false });
const F = {
  uuid: { type: 'uuid' },
  bool: { type: 'boolean' },
  sha256: { type: 'sha256' },
  timestamp: { type: 'timestamp' },
  int: (min, max) => ({ type: 'integer', min, max }),
  line: (max, min = 1) => ({ type: 'text', min, max }),
  lines: (max, min = 1) => ({ type: 'multiline', min, max }),
  like: (pattern) => ({ type: 'pattern', pattern }),
  oneOf: (...values) => ({ type: 'enum', values }),
  list: (of, min, max, unique = false) => ({ type: 'list', of, min, max, unique }),
  object: (fields, rules = []) => ({ type: 'object', fields, rules }),
  union: (on, variants) => ({ type: 'union', on, variants }),
  orNull: (spec) => ({ ...spec, nullable: true })
};
const HARD_MAX_BYTES = LIMITS.policy.bytes[1];
const REVISION = F.int(1, LIMITS.revision_max);

/* Cross-field rules. SQL enforces every one of them; check() is the same rule for callers that validate early. */
export const RULES = deepFreeze({
  media_enabled_complete: { text: 'When media.enabled is true: kinds, max_duration_seconds and the byte cap of every listed kind are required.',
    check: (m) => m.enabled !== true || (Array.isArray(m.kinds) && m.max_duration_seconds !== undefined && m.kinds.every((k) => m[`${k}_max_bytes`] !== undefined)) },
  template_modes: { text: 'A mission whose template has a TEMPLATE_RULES entry uses only its allowed proof modes, all required ones and at least one of the any-of set.',
    check: (m) => { const t = TEMPLATE_RULES[m.template]; const modes = m.proof_modes; if (!t || !Array.isArray(modes)) return true;
      return modes.every((x) => t.modes_allowed.includes(x)) && t.modes_required.every((x) => modes.includes(x)) && t.modes_any_of.some((x) => modes.includes(x)); } },
  rubric_ids_unique: { text: 'Criterion ids are unique within one rubric list.',
    check: (r) => ['application', 'proof'].every((k) => !Array.isArray(r[k]) || new Set(r[k].map((c) => c?.id)).size === r[k].length) },
  answers_unique: { text: 'A rubric answer list names each criterion id at most once.',
    check: (d) => !Array.isArray(d.rubric) || new Set(d.rubric.map((a) => a?.id)).size === d.rubric.length },
  at_least_one_field: { text: 'The document carries at least one field.', check: (d) => Object.keys(d).length > 0 },
  submit_complete: { text: 'When submit is true the statement has at least one character.', check: (d) => d.submit !== true || (typeof d.statement === 'string' && d.statement.length > 0) },
  reason_unless_approved: { text: 'A reason is required unless the decision is approved.', check: (d) => d.decision === 'approved' || typeof d.reason === 'string' },
  reason_unless_all_pass: { text: 'A reason is required unless mission, rights and safety all pass.',
    check: (d) => (d.mission_decision === 'pass' && d.rights_decision === 'pass' && d.safety_decision === 'pass') || typeof d.reason === 'string' },
  media_xor_accommodation: { text: 'Exactly one of media (one to three sealed uploads) or accommodation (a written statement) is present.',
    check: (d) => (d.media !== undefined) !== (d.accommodation !== undefined) },
  uploads_unique: { text: 'An upload is listed at most once.', check: (d) => !Array.isArray(d.media) || new Set(d.media.map((m) => String(m?.upload_id).toLowerCase())).size === d.media.length },
  derivative_permissions: { text: 'derivative_permissions is not empty when parody_or_derivative is true.', check: (r) => r.parody_or_derivative !== true || (typeof r.derivative_permissions === 'string' && r.derivative_permissions.length > 0) },
  mime_matches_kind: { text: 'The MIME type belongs to the declared kind.', check: (u) => typeof u.mime !== 'string' || !MEDIA_TYPES[u.mime] || MEDIA_TYPES[u.mime].kind === u.kind },
  consent_when_published: { text: 'consent_id is required when the decision is published; reason is required when it is withdrawn.',
    check: (d) => (d.decision === 'published' ? d.consent_id !== undefined : typeof d.reason === 'string') },
  sealed_size_agrees: { text: 'bytes equals storage.size.', check: (s) => s.bytes === s.storage?.size }
});

const codePoints = (s) => { let n = 0; for (const _ of s) n += 1; return n; };
const wellFormed = (s) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
/* A real calendar instant, by the same integer rules as the SQL (eup_league_timestamp_ok): year 1 or later, a day the
   month has (Gregorian leap years), hour 0..23, minute and second 0..59. DECISION (review 2026-11-10): Date.parse is not
   the test, because it rolls 2027-02-30 into March and T24:00 into the next day, which the SQL refuses. */
function calendarInstant(s) {
  const n = (from, to) => Number(s.slice(from, to));
  const year = n(0, 4), month = n(5, 7), day = n(8, 10);
  if (year < 1 || month < 1 || month > 12 || day < 1 || n(11, 13) > 23 || n(14, 16) > 59 || n(17, 19) > 59) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/* checkDocument(spec, value): null when the value satisfies the spec, else 'path: problem'.
   Objects are CLOSED: a key the spec does not list is refused (22023 in SQL). That is also what keeps
   location, gps, points, payout and account-naming keys out of every document. */
export function checkDocument(spec, value, path = '$') {
  if (value === null) return spec.nullable ? null : `${path}: null not allowed`;
  switch (spec.type) {
    case 'uuid': return typeof value === 'string' && PATTERNS.uuid.test(value) ? null : `${path}: uuid expected`;
    case 'boolean': return typeof value === 'boolean' ? null : `${path}: boolean expected`;
    case 'sha256': return typeof value === 'string' && PATTERNS.sha256.test(value) ? null : `${path}: lower-case sha256 hex expected`;
    case 'timestamp': return typeof value === 'string' && PATTERNS.timestamp.test(value) && calendarInstant(value) ? null : `${path}: UTC timestamp expected`;
    case 'pattern': return typeof value === 'string' && PATTERNS[spec.pattern].test(value) ? null : `${path}: ${spec.pattern} expected`;
    case 'enum': return spec.values.includes(value) ? null : `${path}: one of ${spec.values.join(', ')} expected`;
    case 'integer': return Number.isSafeInteger(value) && value >= spec.min && value <= spec.max ? null : `${path}: integer ${spec.min}..${spec.max} expected`;
    case 'text': case 'multiline': {
      if (typeof value !== 'string' || !wellFormed(value) || TEXT_RULES[spec.type].refused.test(value)) return `${path}: ${spec.type} expected`;
      const n = codePoints(value);
      return n >= spec.min && n <= spec.max ? null : `${path}: length ${spec.min}..${spec.max} expected`;
    }
    case 'list': {
      if (!Array.isArray(value) || value.length < spec.min || value.length > spec.max) return `${path}: list of ${spec.min}..${spec.max} expected`;
      for (let i = 0; i < value.length; i += 1) { const problem = checkDocument(spec.of, value[i], `${path}[${i}]`); if (problem) return problem; }
      if (spec.unique && new Set(value.map((v) => (typeof v === 'string' ? v.toLowerCase() : v))).size !== value.length) return `${path}: duplicate entry`;
      return null;
    }
    case 'union': {
      const variant = value && typeof value === 'object' && !Array.isArray(value) ? spec.variants[value[spec.on]] : null;
      return variant ? checkDocument(variant, value, path) : `${path}.${spec.on}: one of ${Object.keys(spec.variants).join(', ')} expected`;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return `${path}: object expected`;
      for (const key of Object.keys(value)) if (!Object.hasOwn(spec.fields, key)) return `${path}.${key}: unknown field`;
      for (const [key, field] of Object.entries(spec.fields)) {
        if (value[key] === undefined) { if (field.required) return `${path}.${key}: required`; continue; }
        const problem = checkDocument(field, value[key], `${path}.${key}`);
        if (problem) return problem;
      }
      for (const rule of spec.rules) if (!RULES[rule].check(value)) return `${path}: ${rule}`;
      return null;
    }
    default: return `${path}: unknown spec`;
  }
}

/* ------------------------------------------------------------------ 4. media table (needed by the document specs) */

const MEDIA_TYPES = {
  'audio/mpeg': { kind: 'audio', ext: 'mp3', families: ['mpeg'] },
  'audio/mp4': { kind: 'audio', ext: 'm4a', families: ['iso_bmff'] },
  'audio/x-m4a': { kind: 'audio', ext: 'm4a', families: ['iso_bmff'] },
  'audio/wav': { kind: 'audio', ext: 'wav', families: ['riff_wave'] },
  'audio/webm': { kind: 'audio', ext: 'webm', families: ['ebml'] },
  'audio/ogg': { kind: 'audio', ext: 'ogg', families: ['ogg'] },
  'video/mp4': { kind: 'video', ext: 'mp4', families: ['iso_bmff'] },
  'video/webm': { kind: 'video', ext: 'webm', families: ['ebml'] },
  'video/quicktime': { kind: 'video', ext: 'mov', families: ['iso_bmff'] }
};

/* ------------------------------------------------------------------ 5. documents (what p_document and p_result carry) */

const notice = F.object({ revision: R(F.like('notice_revision')), text: R(F.lines(LIMITS.text.notice_text)) });
const criterion = F.object({ id: R(F.like('rubric_id')), label: R(F.line(LIMITS.text.rubric_label)) });
const rubric = F.object({
  application: O(F.list(criterion, 0, LIMITS.count.rubric_criteria)),
  proof: O(F.list(criterion, 0, LIMITS.count.rubric_criteria))
}, ['rubric_ids_unique']);
const answer = F.object({ id: R(F.like('rubric_id')), met: R(F.bool), note: O(F.line(LIMITS.text.note)) });
const answers = F.list(answer, 0, LIMITS.count.rubric_criteria);
const accommodation = F.object({ statement: R(F.lines(LIMITS.text.statement)) });
const proofModes = F.list(F.oneOf(...ENUMS.PROOF_MODES), 1, LIMITS.count.proof_modes, true);
const capacity = F.orNull(F.int(1, LIMITS.count.capacity)); // null means no limit; an omitted capacity on update keeps the stored value
/* D7: the music-rights-v1 attestation fields. A declaration, not a verdict: the reviewer's rights decision judges it. */
const rights = F.object({
  version: R(F.oneOf('music-rights-v1')),
  owns_master: R(F.bool), controls_composition: R(F.bool), samples_cleared: R(F.bool), collaborators_cleared: R(F.bool),
  parody_or_derivative: R(F.bool),
  derivative_permissions: R(F.lines(LIMITS.text.derivative_permissions, 0))
}, ['derivative_permissions']);
const credit = F.object({ name: R(F.line(LIMITS.text.credit_name)), role: R(F.line(LIMITS.text.credit_role)) });
const uploadIds = F.list(F.uuid, 1, LIMITS.list.purge_batch, true);
const EMPTY = F.object({});

/* League policy: CONFIGURATION only. No state, no enabled flag for the module (DECISIONS section 4).
   A policy is VALID when checkDocument(DOCUMENTS.policy, doc) is null. Missing or invalid: EU010. */
const policy = F.object({
  entitlement: R(F.oneOf(...ENUMS.ENTITLEMENT_RULES)),
  media: R(F.object({
    enabled: R(F.bool),
    kinds: O(F.list(F.oneOf(...ENUMS.MEDIA_KINDS), 1, 2, true)),
    audio_max_bytes: O(F.int(1, HARD_MAX_BYTES)),
    video_max_bytes: O(F.int(1, HARD_MAX_BYTES)),
    max_duration_seconds: O(F.int(...LIMITS.policy.duration_seconds)) // declared by the client and enforced at capture; not measured server-side
  }, ['media_enabled_complete'])),
  retention: R(F.object({ completed_days: R(F.int(...LIMITS.policy.retention_days)), withdrawn_days: R(F.int(...LIMITS.policy.retention_days)) })),
  notices: R(F.object({ participation: R(notice), private_review: R(notice), publication: R(notice) }))
});

export const DOCUMENTS = deepFreeze({
  policy,
  /* DECISION: a reason is mandatory on a League policy change too, as on every module policy command (D11). */
  policy_set: F.object({ policy: R(policy), reason: R(F.line(LIMITS.text.policy_reason)) }),

  campaign_create: F.object({ slug: R(F.like('slug')), title: R(F.line(LIMITS.text.title)), purpose: R(F.lines(LIMITS.text.purpose)),
    audience: O(F.oneOf('admin_preview')) }), // a campaign is always created admin_preview; widening is campaigns.audience.set
  transition: F.object({ to: R(F.oneOf(...ENUMS.TRANSITION_TARGETS)) }),
  audience_set: F.object({ audience: R(F.oneOf(...ENUMS.AUDIENCES)) }),
  grant: F.object({ account: R(F.uuid), note: O(F.line(LIMITS.text.note)) }),
  grant_revoke: F.object({ reason: O(F.line(LIMITS.text.note)) }),

  mission_create: F.object({ slug: R(F.like('slug')), title: R(F.line(LIMITS.text.title)), template: R(F.oneOf(...ENUMS.TEMPLATES)),
    proof_modes: R(proofModes), capacity: O(capacity), requirements: R(F.lines(LIMITS.text.requirements)),
    acceptance: O(F.lines(LIMITS.text.acceptance)), rubric: O(rubric) }, ['template_modes']),
  /* PATCH semantics: every field optional, omitted fields keep their value, slug and template never change. */
  mission_update: F.object({ title: O(F.line(LIMITS.text.title)), proof_modes: O(proofModes), capacity: O(capacity),
    requirements: O(F.lines(LIMITS.text.requirements)), acceptance: O(F.lines(LIMITS.text.acceptance)), rubric: O(rubric) }, ['at_least_one_field']),

  /* D10: an owner records an application for an account; the row keeps recorded_by. */
  application_create: F.object({ applicant: R(F.uuid), requirements_revision: R(REVISION), statement: R(F.lines(LIMITS.text.statement)), accommodation: O(accommodation) }),
  /* Member application: one document for save-as-draft and submit. accommodation null clears a saved request. */
  application_save: F.object({ submit: R(F.bool), requirements_revision: R(REVISION), statement: O(F.lines(LIMITS.text.statement, 0)),
    accommodation: O(F.orNull(accommodation)) }, ['submit_complete']),
  application_decide: F.object({ decision: R(F.oneOf(...ENUMS.APPLICATION_DECISIONS)), reason: O(F.lines(LIMITS.text.reason)), rubric: O(answers) },
    ['reason_unless_approved', 'answers_unique']),
  applications_filter: F.object({ status: O(F.oneOf(...ENUMS.APPLICATION_STATUSES)) }),

  assignment_accept: F.object({ requirements_revision: R(REVISION), notice_revision: R(F.like('notice_revision')) }),

  /* Draft: a lenient, full-replace working copy (empty strings allowed). Nothing here is evidence until proofs.submit. */
  draft_save: F.object({
    title: O(F.line(LIMITS.text.title, 0)), lyrics: O(F.lines(LIMITS.text.lyrics, 0)),
    credits: O(F.list(F.object({ name: R(F.line(LIMITS.text.credit_name, 0)), role: R(F.line(LIMITS.text.credit_role, 0)) }), 0, LIMITS.count.credits)),
    rights: O(F.object({ version: O(F.oneOf('music-rights-v1')), owns_master: O(F.bool), controls_composition: O(F.bool), samples_cleared: O(F.bool),
      collaborators_cleared: O(F.bool), parody_or_derivative: O(F.bool), derivative_permissions: O(F.lines(LIMITS.text.derivative_permissions, 0)) })),
    media: O(F.list(F.uuid, 0, LIMITS.count.proof_media, true)),
    accommodation: O(F.orNull(F.object({ statement: R(F.lines(LIMITS.text.statement, 0)) })))
  }),

  upload_begin: F.object({ kind: R(F.oneOf(...ENUMS.MEDIA_KINDS)), mime: R(F.oneOf(...Object.keys(MEDIA_TYPES))), bytes: R(F.int(1, HARD_MAX_BYTES)),
    duration_seconds: O(F.int(...LIMITS.policy.duration_seconds)) }, ['mime_matches_kind']),
  upload_get: F.object({ sign: O(F.bool) }),
  /* p_result of the seal function: what the Worker measured, never what the client claimed. */
  seal_result: F.union('outcome', {
    sealed: F.object({ outcome: R(F.oneOf('sealed')), bytes: R(F.int(1, HARD_MAX_BYTES)), sha256: R(F.sha256), family: R(F.oneOf(...ENUMS.MEDIA_FAMILIES)),
      storage: R(F.object({ object_id: R(F.uuid), etag: R(F.line(LIMITS.text.etag)), size: R(F.int(1, HARD_MAX_BYTES)) })) }, ['sealed_size_agrees']),
    rejected: F.object({ outcome: R(F.oneOf('rejected')), reason: R(F.oneOf(...ENUMS.REJECT_REASONS)) })
  }),

  /* The song proof (template write-a-song). D8: the accommodation statement stands in for media with equal standing. */
  proof_submit: F.object({
    title: R(F.line(LIMITS.text.title)), lyrics: R(F.lines(LIMITS.text.lyrics)),
    credits: R(F.list(credit, 1, LIMITS.count.credits)), rights: R(rights),
    media: O(F.list(F.object({ upload_id: R(F.uuid), sha256: R(F.sha256) }), 1, LIMITS.count.proof_media)), // sha256 is the fingerprint the participant was shown
    accommodation: O(accommodation),
    review_notice_revision: R(F.like('notice_revision')) // must equal policy.notices.private_review.revision; grants the private_review consent
  }, ['media_xor_accommodation', 'uploads_unique']),
  proofs_filter: F.object({ state: O(F.oneOf(...ENUMS.PROOF_STATES)) }),
  proof_get: F.object({ revision: R(REVISION), media: O(F.bool) }),
  /* Three decisions, one derived outcome (reviewOutcome): there is no separate overall field to contradict them. */
  proof_review: F.object({ asset_revision: R(F.sha256), mission_decision: R(F.oneOf(...ENUMS.DIMENSION_DECISIONS)),
    rights_decision: R(F.oneOf(...ENUMS.DIMENSION_DECISIONS)), safety_decision: R(F.oneOf(...ENUMS.DIMENSION_DECISIONS)),
    rubric: O(answers), reason: O(F.lines(LIMITS.text.reason)) }, ['reason_unless_all_pass', 'answers_unique']),
  proof_moderate: F.object({ hold: R(F.bool), reason: R(F.lines(LIMITS.text.reason)) }),

  /* Only the publication consent is granted by command. expires_at: UTC, later than now, at most consent_max_days ahead. */
  consent_grant: F.object({ purpose: R(F.oneOf('publish_proof')), audience: R(F.oneOf('released_audience')), asset_revision: R(F.sha256),
    notice_revision: R(F.like('notice_revision')), expires_at: R(F.timestamp) }),
  publications_filter: F.object({ state: O(F.oneOf(...ENUMS.PUBLICATION_ROW_STATES)) }),
  publication_decide: F.object({ decision: R(F.oneOf(...ENUMS.PUBLICATION_DECISIONS)), consent_id: O(F.uuid), reason: O(F.line(LIMITS.text.note)) }, ['consent_when_published']),

  appeal_open: F.object({ subject: R(F.oneOf(...ENUMS.APPEAL_SUBJECTS)), statement: R(F.lines(LIMITS.text.statement)) }),
  appeals_filter: F.object({ state: O(F.oneOf(...ENUMS.APPEAL_STATES)) }),
  appeal_resolve: F.object({ outcome: R(F.oneOf(...ENUMS.APPEAL_OUTCOMES)), reason: R(F.lines(LIMITS.text.reason)) }),

  media_due: F.object({ uploads: O(uploadIds), limit: O(F.int(1, LIMITS.list.purge_batch)) }),
  media_purged: F.object({ uploads: R(uploadIds) }),
  outbox_list: F.object({ after: O(F.int(0, Number.MAX_SAFE_INTEGER)), limit: O(F.int(1, LIMITS.list.outbox)), consumer: O(F.like('consumer')) }),
  outbox_ack: F.object({ consumer: R(F.like('consumer')) }),
  receipt_get: F.object({ operation: R(F.like('operation')), key: R(F.like('idempotency_key')) }),
  empty: EMPTY
});

/* ------------------------------------------------------------------ 6. result shapes
   DECISION: results are LEAN and member answers are MEMBER-SAFE (both rules below): a receipt must not become a second
   copy of someone's lyrics or accommodation note, and a tester has no use for a reviewer's account id.
   Type words: uuid int text bool timestamp (written as RESULT_TIMESTAMP) sha256 seq json; enum:NAME (ENUMS); shape:NAME (below);
   document:NAME (DOCUMENTS); suffix [] for a list, |null when the value may be null.
   Lists are bare JSON arrays ordered by created_at ascending unless a shape says otherwise. */

const ROW = { id: 'uuid', tenant: 'uuid', created_at: 'timestamp', updated_at: 'timestamp' };
/* Two rules for results.
   LEAN: a mutation result (and so its stored receipt) carries ids, states and revisions, never text a member wrote.
   MEMBER-SAFE: nothing a member route answers carries another account's id (FOREIGN_ID_FIELDS). */
export const FOREIGN_ID_FIELDS = deepFreeze(['created_by', 'updated_by', 'recorded_by', 'decided_by', 'granted_by', 'reviewer', 'published_by', 'withdrawn_by', 'resolved_by', 'revoked_by', 'applicant', 'appellant', 'account']);
export const SHAPES = deepFreeze({
  /* ---- owner surface ---- */
  policy: { revision: 'int', document: 'document:policy|null', valid: 'bool', updated_by: 'uuid|null', updated_at: 'timestamp|null' }, // revision 0 and document null when no row exists
  campaign: { ...ROW, slug: 'text', title: 'text', state: 'enum:CAMPAIGN_STATES', audience: 'enum:AUDIENCES', revision: 'int', document: 'document:campaign_create', created_by: 'uuid' },
  campaign_listed: { extends: 'campaign', missions: 'shape:mission[]' },
  mission: { ...ROW, campaign_id: 'uuid', slug: 'text', title: 'text', template: 'enum:TEMPLATES', state: 'enum:MISSION_STATES', revision: 'int',
    requirements_revision: 'int', capacity: 'int|null', proof_modes: 'enum:PROOF_MODES[]', document: 'document:mission_create', created_by: 'uuid', assigned: 'int' }, // document = the current merged mission document; assigned counts SEAT_STATUSES
  grant: { id: 'uuid', tenant: 'uuid', campaign_id: 'uuid', account: 'uuid', state: 'enum:GRANT_STATES', note: 'text|null', granted_by: 'uuid', granted_at: 'timestamp', revoked_by: 'uuid|null', revoked_at: 'timestamp|null' },
  application_decision: { decision: 'enum:APPLICATION_DECISIONS', reason: 'text|null', rubric: 'json', requirements_revision: 'int', decided_by: 'uuid', decided_at: 'timestamp' },
  /* The accommodation request is a boolean on every owner row; its text is read through applications.accommodation.get only. */
  application_row: { ...ROW, mission_id: 'uuid', requirements_revision: 'int', applicant: 'uuid', recorded_by: 'uuid|null', status: 'enum:APPLICATION_STATUSES', revision: 'int',
    accommodation_requested: 'bool', decided_by: 'uuid|null', decision_reason: 'text|null', decided_at: 'timestamp|null' },
  application: { extends: 'application_row', document: 'json', decisions: 'shape:application_decision[]' }, // document is { statement }
  application_decided: { extends: 'application_row', assignment: 'shape:assignment|null' },
  accommodation_read: { application_id: 'uuid', applicant: 'uuid', accommodation: 'json|null', read_at: 'timestamp' },
  assignment: { ...ROW, application_id: 'uuid', mission_id: 'uuid', participant: 'uuid', status: 'enum:ASSIGNMENT_STATUSES', revision: 'int',
    offered_requirements_revision: 'int', accepted_requirements_revision: 'int|null', accepted_notice_revision: 'text|null',
    accepted_at: 'timestamp|null', completed_at: 'timestamp|null', withdrawn_at: 'timestamp|null' },
  /* storage is filled only by uploads.get, proofs.get with media and the seal. No path is ever stored or returned:
     the path is mediaObjectPath(tenant, assignment_id, id, ext) and nothing else. */
  upload: { ...ROW, assignment_id: 'uuid', participant: 'uuid', kind: 'enum:MEDIA_KINDS', mime: 'text', ext: 'text', declared_bytes: 'int', max_bytes: 'int',
    duration_seconds: 'int|null', state: 'enum:UPLOAD_STATES', scan_state: 'enum:SCAN_STATES', expires_at: 'timestamp', bytes: 'int|null', sha256: 'sha256|null',
    family: 'enum:MEDIA_FAMILIES|null', rejected_reason: 'enum:REJECT_REASONS|null', sealed_at: 'timestamp|null', discarded_at: 'timestamp|null', purged_at: 'timestamp|null',
    storage: 'shape:storage_identity|null' },
  storage_identity: { object_id: 'uuid', etag: 'text', size: 'int' },
  proof_media: { upload_id: 'uuid', kind: 'enum:MEDIA_KINDS', mime: 'text', bytes: 'int', sha256: 'sha256' },
  review: { id: 'uuid', proof_id: 'uuid', proof_revision: 'int', asset_revision: 'sha256', reviewer: 'uuid', mission_decision: 'enum:DIMENSION_DECISIONS',
    rights_decision: 'enum:DIMENSION_DECISIONS', safety_decision: 'enum:DIMENSION_DECISIONS', decision: 'enum:PROOF_STATES', rubric: 'json', reason: 'text|null', created_at: 'timestamp' }, // decision = reviewOutcome(...)
  proof_row: { ...ROW, assignment_id: 'uuid', participant: 'uuid', revision: 'int', state: 'enum:PROOF_STATES', reviewed_revision: 'int|null', asset_revision: 'sha256',
    moderation_state: 'enum:MODERATION_STATES', publication_state: 'enum:PUBLICATION_STATES' },
  proof: { extends: 'proof_row', document: 'document:proof_submit', media: 'shape:proof_media[]', reviews: 'shape:review[]' }, // the current revision's document
  proof_reviewed: { extends: 'proof_row', review: 'shape:review', credit: 'shape:credit|null' },
  proof_with_media: { extends: 'proof', uploads: 'shape:upload[]' }, // proofs.get: uploads carry storage only when media was asked for
  consent: { id: 'uuid', tenant: 'uuid', mission_id: 'uuid', assignment_id: 'uuid', proof_id: 'uuid', proof_revision: 'int', asset_revision: 'sha256', actor: 'uuid',
    purpose: 'enum:CONSENT_PURPOSES', audience: 'enum:CONSENT_AUDIENCES', notice_revision: 'text', state: 'enum:CONSENT_STATES', granted_at: 'timestamp',
    expires_at: 'timestamp|null', revoked_at: 'timestamp|null', revoked_by: 'uuid|null', superseded_at: 'timestamp|null' }, // state is derived; expired = neither revoked nor superseded, and past expires_at
  publication: { id: 'uuid', tenant: 'uuid', campaign_id: 'uuid', mission_id: 'uuid', assignment_id: 'uuid', proof_id: 'uuid', proof_revision: 'int', asset_revision: 'sha256',
    consent_id: 'uuid', audience: 'enum:CONSENT_AUDIENCES', state: 'enum:PUBLICATION_ROW_STATES', effective: 'bool', published_by: 'uuid', published_at: 'timestamp',
    withdrawn_by: 'uuid|null', withdrawn_at: 'timestamp|null', withdrawn_reason: 'enum:WITHDRAWN_REASONS|null' },
  appeal_row: { id: 'uuid', tenant: 'uuid', subject: 'enum:APPEAL_SUBJECTS', subject_id: 'uuid', appellant: 'uuid', state: 'enum:APPEAL_STATES',
    resolved_by: 'uuid|null', resolution_reason: 'text|null', created_at: 'timestamp', resolved_at: 'timestamp|null' },
  appeal: { extends: 'appeal_row', statement: 'text' },
  /* One row per completed assignment. Deliberately NO field for points, publication, consent, media or accommodation:
     a private proof and an accommodation proof earn the identical credit. kind is the literal mission_completion. */
  credit: { id: 'uuid', tenant: 'uuid', campaign_id: 'uuid', mission_id: 'uuid', assignment_id: 'uuid', participant: 'uuid', proof_id: 'uuid', proof_revision: 'int',
    asset_revision: 'sha256', review_id: 'uuid', kind: 'text', created_at: 'timestamp' },
  due_upload: { id: 'uuid', tenant: 'uuid', assignment_id: 'uuid', ext: 'text', kind: 'enum:MEDIA_KINDS', state: 'enum:UPLOAD_STATES', due: 'bool', reason: 'enum:DUE_REASONS|null', due_at: 'timestamp|null' },
  due_list: { retention_evaluated: 'bool', uploads: 'shape:due_upload[]' }, // retention_evaluated false: no valid policy, so only the policy-independent reasons were computed
  purge_result: { purged: 'uuid[]', already_purged: 'uuid[]', publications_withdrawn: 'uuid[]' },
  outbox_event: { seq: 'seq', tenant: 'uuid', type: 'text', payload: 'json', created_at: 'timestamp', consumed: 'bool|null' }, // consumed is null unless a consumer was named
  consumption: { seq: 'seq', consumer: 'text', consumed_at: 'timestamp' },
  receipt: { surface: 'enum:SURFACES', operation: 'text', idempotency_key: 'text', result: 'json', created_at: 'timestamp' },
  /* overview keys: campaigns {drafts, released, paused, withdrawn}; missions {drafts, released}; queues {applications, proofs,
     reviews, appeals, media_due}; policy {present, valid, media_enabled, revision}; audience {invited_campaigns, open_grants}. */
  overview: { campaigns: 'json', missions: 'json', queues: 'json', policy: 'json', audience: 'json', latest_change: 'timestamp|null' },

  /* ---- shared by both surfaces ---- */
  /* The member projection of a mission. missions.preview returns exactly this, so the owner preview IS the member view.
     open = campaign and mission both released. requirements, acceptance and rubric come from the mission document. */
  mission_card: { id: 'uuid', campaign_id: 'uuid', slug: 'text', title: 'text', template: 'enum:TEMPLATES', state: 'enum:MISSION_STATES', open: 'bool',
    requirements_revision: 'int', requirements: 'text', acceptance: 'text|null', proof_modes: 'enum:PROOF_MODES[]', rubric: 'json', capacity: 'int|null', seats_taken: 'int' },

  /* ---- member surface ---- */
  /* The member read: the catalogue the actor is in the audience of, and everything the actor may see about themselves. */
  me: { actor: 'uuid', policy: 'shape:member_policy|null', catalogue: 'shape:member_campaign[]', applications: 'shape:own_application[]',
    assignments: 'shape:own_assignment[]', published: 'shape:published_proof[]' }, // policy null: no valid policy, every gated mutation would answer EU010
  member_policy: { revision: 'int', entitlement: 'enum:ENTITLEMENT_RULES', media: 'json', retention: 'json', notices: 'json' },
  member_campaign: { id: 'uuid', slug: 'text', title: 'text', purpose: 'text', state: 'enum:CAMPAIGN_STATES', audience: 'enum:AUDIENCES', missions: 'shape:mission_card[]' }, // released campaigns and their released missions only
  member_application: { id: 'uuid', mission_id: 'uuid', requirements_revision: 'int', status: 'enum:APPLICATION_STATUSES', revision: 'int', accommodation_requested: 'bool',
    recorded: 'bool', created_at: 'timestamp', updated_at: 'timestamp' }, // recorded true: an owner recorded it for this account (D10)
  own_application: { extends: 'member_application', mission: 'shape:mission_card', document: 'json', accommodation: 'json|null', decisions: 'shape:member_decision[]', appeals: 'shape:member_appeal[]' },
  member_decision: { decision: 'enum:APPLICATION_DECISIONS', reason: 'text|null', rubric: 'json', decided_at: 'timestamp' },
  own_assignment: { extends: 'assignment', mission: 'shape:mission_card', draft: 'shape:draft|null', uploads: 'shape:member_upload[]', proof: 'shape:own_proof|null', credit: 'shape:credit|null' },
  draft_saved: { assignment_id: 'uuid', revision: 'int', updated_at: 'timestamp' },
  draft: { extends: 'draft_saved', document: 'document:draft_save' },
  member_upload: { id: 'uuid', assignment_id: 'uuid', kind: 'enum:MEDIA_KINDS', mime: 'text', ext: 'text', declared_bytes: 'int', max_bytes: 'int', duration_seconds: 'int|null',
    state: 'enum:UPLOAD_STATES', scan_state: 'enum:SCAN_STATES', expires_at: 'timestamp', bytes: 'int|null', sha256: 'sha256|null', rejected_reason: 'enum:REJECT_REASONS|null',
    created_at: 'timestamp', sealed_at: 'timestamp|null', discarded_at: 'timestamp|null', purged_at: 'timestamp|null' }, // an upload row without tenant, participant, family and storage identity
  member_review: { proof_revision: 'int', asset_revision: 'sha256', mission_decision: 'enum:DIMENSION_DECISIONS', rights_decision: 'enum:DIMENSION_DECISIONS',
    safety_decision: 'enum:DIMENSION_DECISIONS', decision: 'enum:PROOF_STATES', rubric: 'json', reason: 'text|null', created_at: 'timestamp' },
  member_consent: { id: 'uuid', proof_id: 'uuid', proof_revision: 'int', asset_revision: 'sha256', purpose: 'enum:CONSENT_PURPOSES', audience: 'enum:CONSENT_AUDIENCES',
    notice_revision: 'text', state: 'enum:CONSENT_STATES', granted_at: 'timestamp', expires_at: 'timestamp|null', revoked_at: 'timestamp|null', superseded_at: 'timestamp|null' },
  consent_revoked: { extends: 'member_consent', publication: 'shape:member_publication|null' }, // the publication this revocation withdrew, if any
  member_publication: { id: 'uuid', proof_id: 'uuid', proof_revision: 'int', asset_revision: 'sha256', consent_id: 'uuid', state: 'enum:PUBLICATION_ROW_STATES', effective: 'bool',
    published_at: 'timestamp', withdrawn_at: 'timestamp|null', withdrawn_reason: 'enum:WITHDRAWN_REASONS|null' },
  member_appeal_row: { id: 'uuid', subject: 'enum:APPEAL_SUBJECTS', subject_id: 'uuid', state: 'enum:APPEAL_STATES', resolution_reason: 'text|null',
    created_at: 'timestamp', resolved_at: 'timestamp|null' },
  member_appeal: { extends: 'member_appeal_row', statement: 'text' },
  proof_submitted: { id: 'uuid', assignment_id: 'uuid', revision: 'int', state: 'enum:PROOF_STATES', asset_revision: 'sha256', moderation_state: 'enum:MODERATION_STATES',
    publication_state: 'enum:PUBLICATION_STATES', media: 'shape:proof_media[]', consent: 'shape:member_consent', created_at: 'timestamp', updated_at: 'timestamp' }, // consent = the private_review consent just written
  own_proof: { id: 'uuid', assignment_id: 'uuid', revision: 'int', state: 'enum:PROOF_STATES', reviewed_revision: 'int|null', asset_revision: 'sha256',
    moderation_state: 'enum:MODERATION_STATES', publication_state: 'enum:PUBLICATION_STATES', document: 'document:proof_submit', media: 'shape:proof_media[]',
    reviews: 'shape:member_review[]', consents: 'shape:member_consent[]', publication: 'shape:member_publication|null', appeals: 'shape:member_appeal[]',
    created_at: 'timestamp', updated_at: 'timestamp' },
  /* What the released audience sees of an effective publication. No account id: the credits list is the only attribution.
     Each media entry is playable through GET uploads/:id/url while the publication is effective. */
  published_proof: { publication_id: 'uuid', campaign_id: 'uuid', mission_id: 'uuid', title: 'text', lyrics: 'text', credits: 'json', media: 'shape:proof_media[]', published_at: 'timestamp' }
});
/* shapeFields(name): the shape's own fields with extends resolved. projectShape(name, row): the row cut down to exactly
   those keys (missing keys become null), for a route whose answer is narrower than the row it holds. */
export function shapeFields(name) {
  const shape = Object.hasOwn(SHAPES, name) ? SHAPES[name] : null;
  if (!shape) return null;
  const { extends: parent, ...own } = shape;
  return parent ? { ...shapeFields(parent), ...own } : own;
}
export function projectShape(name, row) {
  const fields = shapeFields(name);
  if (!fields || !row || typeof row !== 'object') return null;
  return Object.fromEntries(Object.keys(fields).map((key) => [key, row[key] ?? null]));
}

/* ------------------------------------------------------------------ 7. actions

   COMMON RULES (every action, both command functions)
   - p_actor is the verified session user. Null or unknown: 42501. Owner function: not a house owner: 42501.
   - Reads take no key, write nothing (one exception, marked audited) and are never guarded: they answer in every module state.
   - Mutations require p_key matching PATTERNS.idempotency_key (22023 otherwise). The receipt key is
     (tenant, actor, operation, key) with operation = the action name; an advisory transaction lock on that key is taken
     BEFORE the receipt lookup. Same key and equal (p_id, p_revision, p_document): the stored result is returned in every
     module state. Same key, different payload: EU003. A failed command leaves no receipt.
   - Order inside a mutation: actor check; key lock and exact-replay return; module guard of the action's class; domain
     row locks in the one order campaign, mission, application, assignment, proof, upload; then the checks below.
   - Member check order (first failure wins): the row named by p_id exists (P0002); audience (EU011); ownership (42501); readiness, that is a
     valid League policy (EU010); entitlement, that is policy.entitlement = none_required (EU012); for upload actions
     media.enabled (EU010); then revision and state (40001); then the action's own rules.
     Each action lists the gates that apply to it. Reduce-only actions apply ownership only, so a participant can always
     withdraw, discard and revoke, whatever happened to the campaign, the grant or the policy.
   - AUDIENCE: the actor is in the released audience of a mission when its campaign is released AND the mission is
     released AND (the actor is a house owner OR (campaign.audience = invited AND the actor holds an open grant on it)).
   - p_revision is compare-and-swap on the row named by the action. 40001 when it differs. Where revision_min is 0,
     0 means "this row does not exist yet" (40001 when it does).
   - 40001 also answers "the row is not in a state that allows this action", whether or not the action takes p_revision.
     22023 answers a malformed document, an unknown action, and, for the two transition actions, a (from, to) pair the
     lifecycle does not contain or a release whose precondition (campaign released, releasable template) is unmet.
   - Every mutation writes exactly one outbox row in the same transaction (outbox.ack excepted: an acknowledgement
     that produced an event would never drain).

   DECISIONS made here (the design map left each open):
   - DECISION: every document is closed (an unlisted key is 22023): one rule keeps out account-naming, location and money keys.
   - DECISION: 40001 means "reload" (stale revision or state moved on) and 22023 means "the request is wrong", including a
     transition the caller asked for with the current revision in hand: the caller's next step differs, so the code does.
   - DECISION: revision 0 means "no row yet" for policy.set, applications.save, drafts.save and proofs.submit: the first
     write of an upserted row needs a compare-and-swap value too, or two devices would both create.
   - DECISION: a member application compares its OWN revision and names the requirements_revision it was shown; it no
     longer compares the mission revision, which also moves on pause, release and capacity and stranded applicants.
   - DECISION: requirements_revision moves only when a REQUIREMENTS_FIELDS value changes: a capacity change or a pause
     must not ask every participant to accept again.
   - DECISION: member mutations on a paused or withdrawn mission answer EU011 like any other "not released to you" (the
     map's audience rule); the reason a participant sees comes from me.get, which always shows their own records.
   - DECISION: mission.rubric holds two lists (application, proof). A decision answers every criterion once; approval and a
     mission pass need all met: a criterion that may be unmet is not a criterion.
   - DECISION: proofs.submit carries the whole proof and the draft is only a working copy: the idempotency digest then
     covers exactly what was submitted, and a lost answer is recovered from the receipt alone.
   - DECISION: the accommodation path needs no prior approval; the application's accommodation request is a separate,
     restricted note (D8 asks for equal standing, not a gate).
   - DECISION: reviews and application decisions are owner-route only. An invited tester takes part; a tester cannot
     review (no member review route exists). The second identity D4 asks for is the participant.
   - DECISION: an owner-recorded application names its applicant explicitly and the applicant must be in the released
     audience, or the account could never act on its own assignment.
   - DECISION: a proof hold blocks the owner's signed media read too, and review: a hold exists to stop exposure first.
   - DECISION: a notice revision that is not current is EU013 on acceptance (it is part of what is accepted) and EU015 on
     a consent (it is part of the consent scope).
   - DECISION: media.purged takes the list of uploads the owner asked to purge, and media.due can be asked about named
     uploads: the route's document is then a pure function of the request, so the same key replays instead of conflicting.
   - DECISION: media.due never fails for a missing policy; it returns the policy-independent rows and says
     retention_evaluated false: discarded and rejected objects must be removable while the League is unconfigured.
   - DECISION: the seal takes the normal guard for both outcomes (DECISIONS section 4 lists no seal as reduce-only). While
     the module drains, a staged upload simply stays staged; the member can discard it and the purge removes it.
   - DECISION: sealed bytes must equal the declared bytes exactly: a recorder knows its blob size, so a difference is a
     different file.
   - DECISION: outbox events are numbered (seq, an integer) rather than uuids, so a consumer can ask for "after N". */

const COMMON_ERRORS = { all: ['42501', '22023', 'PGRST202'] };
const GATED = ['EU010', 'EU011', 'EU012'];
const ALL_GATES = ['audience', 'ownership', 'readiness', 'entitlement'];
const action = (kind, guard, o) => {
  const keyed = kind === 'mutation' && o.keyed !== false;
  const errors = [...new Set([...COMMON_ERRORS.all, ...(kind === 'mutation' ? ['40P01'] : []), ...(keyed ? ['EU003'] : []), ...(o.errors || [])])].sort();
  return { kind, guard, keyed, id: null, id_optional: false, document: null, revision: null, revision_min: 1, bumps: [], outbox: kind === 'mutation', effects: [], ...o, errors };
};
const read = (o) => action('read', 'none', o);
const write = (o) => action('mutation', 'enabled', o);
const reduce = (o) => action('mutation', 'reduce', o);

export const OWNER_ACTIONS = deepFreeze({
  /* ---- reads (stay from the existing SQL: the seven lists and overview) ---- */
  'overview': read({ result: 'overview' }), // used by ./overview.js, no League route
  'policy.get': read({ result: 'policy' }),
  'campaigns.list': read({ result: 'campaign_listed[]' }),
  'audience.grants.list': read({ id: 'campaign', result: 'grant[]', errors: ['P0002'] }),
  'missions.list': read({ id: 'campaign', id_optional: true, result: 'mission[]' }),
  'missions.preview': read({ id: 'mission', result: 'mission_card', errors: ['P0002'] }),
  'applications.list': read({ id: 'mission', id_optional: true, document: 'applications_filter', result: 'application[]' }),
  /* The one audited read: it records who read which request and when (no content) in a table that is NOT behind the
     module guard trigger, because reads answer in every module state. */
  'applications.accommodation.get': read({ id: 'application', result: 'accommodation_read', audited: true, errors: ['P0002'] }),
  'assignments.list': read({ id: 'mission', id_optional: true, result: 'assignment[]' }),
  'proofs.list': read({ id: 'assignment', id_optional: true, document: 'proofs_filter', result: 'proof[]' }),
  /* revision must be the proof's current revision (40001). media true adds each upload's storage identity for signing and
     is refused while the proof is held (EU016).
     DECISION (review 2026-11-10): media true also needs the open private_review consent of that revision (EU015). That
     consent ends with assignments.withdraw and with the mission and campaign withdrawal cascades, and the reviewers'
     signed read ends with it (the consent's audience is the reviewers, as publish_proof's is the released audience).
     Without media the record is read in every state. */
  'proofs.get': read({ id: 'proof', document: 'proof_get', result: 'proof_with_media', errors: ['P0002', '40001', 'EU015', 'EU016'] }),
  'consents.list': read({ id: 'proof', id_optional: true, result: 'consent[]' }),
  'publications.list': read({ id: 'campaign', id_optional: true, document: 'publications_filter', result: 'publication[]' }),
  'appeals.list': read({ document: 'appeals_filter', result: 'appeal[]' }),
  'credits.list': read({ id: 'mission', id_optional: true, result: 'credit[]' }),
  /* Without uploads: the due rows, oldest first, up to limit. With uploads: every named row with its due flag (P0002 if one is unknown). */
  'media.due': read({ document: 'media_due', result: 'due_list', errors: ['P0002'] }),
  'outbox.list': read({ document: 'outbox_list', result: 'outbox_event[]' }), // seq ascending, seq > after
  'receipts.get': read({ document: 'receipt_get', result: 'receipt', errors: ['P0002'] }), // the caller's own receipts only

  /* ---- mutations ---- */
  'policy.set': write({ document: 'policy_set', revision: 'policy', revision_min: 0, bumps: ['policy'], result: 'policy', errors: ['40001'],
    effects: ['An invalid policy document is refused (22023): a stored policy is always valid.', 'Every revision is kept with its reason and actor.'] }),
  'campaigns.create': write({ document: 'campaign_create', result: 'campaign', errors: ['23505'], effects: ['Created draft, audience admin_preview, revision 1.'] }),
  'campaigns.transition': write({ id: 'campaign', document: 'transition', revision: 'campaign', bumps: ['campaign'], result: 'campaign', errors: ['P0002', '40001'],
    reduce_when: { field: 'to', values: ['paused', 'withdrawn'] },
    effects: ['paused: nothing else is rewritten; the audience gate closes every mission of the campaign for new work and hides its publications.',
      'withdrawn: every mission of the campaign becomes withdrawn with the mission cascade below (reason campaign_withdrawn).'] }),
  'campaigns.audience.set': write({ id: 'campaign', document: 'audience_set', revision: 'campaign', bumps: ['campaign'], result: 'campaign', errors: ['P0002', '40001'] }),
  /* A grant may be recorded while the campaign is admin_preview; it has effect only while the audience is invited. */
  'audience.grants.grant': write({ id: 'campaign', document: 'grant', result: 'grant', errors: ['P0002', '23505'], effects: ['One open grant per campaign and account (23505).'] }),
  'audience.grants.revoke': reduce({ id: 'grant', document: 'grant_revoke', result: 'grant', errors: ['P0002', '40001'],
    effects: ['The account keeps reading its own records and can still withdraw, discard and revoke.'] }),
  'missions.create': write({ id: 'campaign', document: 'mission_create', result: 'mission', errors: ['P0002', '23505', '40001'],
    effects: ['Created draft, revision 1, requirements_revision 1. Refused (40001) on a withdrawn campaign.'] }),
  'missions.update': write({ id: 'mission', document: 'mission_update', revision: 'mission', bumps: ['mission', 'assignment'], result: 'mission', errors: ['P0002', '40001', 'EU001'],
    effects: ['requirements_revision increases by one if and only if a REQUIREMENTS_FIELDS value changes; capacity alone never changes it.',
      'On that increase every accepted assignment of the mission returns to offered (offered_requirements_revision = the new value).',
      'A capacity below the seats taken is refused (EU001). The stored template still has to satisfy TEMPLATE_RULES (22023).'] }),
  'missions.transition': write({ id: 'mission', document: 'transition', revision: 'mission', bumps: ['mission', 'application', 'assignment'], result: 'mission', errors: ['P0002', '40001'],
    reduce_when: { field: 'to', values: ['paused', 'withdrawn'] },
    effects: ['released: the campaign must be released and the template in RELEASABLE_TEMPLATES (22023). Pause and re-release never change requirements_revision.',
      'withdrawn: draft, submitted and changes_requested applications become declined (decision_reason mission_withdrawn); offered and accepted assignments become withdrawn with the assignment-withdrawal effects; every publication of the mission is withdrawn. Completed assignments and credits stay.'] }),
  'applications.create': write({ id: 'mission', document: 'application_create', result: 'application_row', errors: ['P0002', '23505', 'EU011', 'EU013'],
    effects: ['Created submitted with recorded_by = the actor. The applicant must be in the released audience (EU011) and requirements_revision current (EU013).'] }),
  'applications.decide': write({ id: 'application', document: 'application_decide', revision: 'application', bumps: ['application'], result: 'application_decided',
    errors: ['P0002', '40001', 'EU001', 'EU002', 'EU013'],
    effects: ['Only a submitted application is decided (40001). The actor is never the applicant (EU002).',
      'rubric answers every mission.rubric.application criterion exactly once (22023); approved needs every one met (22023).',
      'approved: the mission and campaign are released (40001), the application is bound to the current requirements_revision (EU013), a seat is free under the mission row lock (EU001); one offered assignment is created.',
      'Every decision appends one decision row; none is overwritten.'] }),
  'proofs.review': write({ id: 'proof', document: 'proof_review', revision: 'proof', bumps: ['assignment'], result: 'proof_reviewed',
    errors: ['P0002', '40001', 'EU002', 'EU014', 'EU016'],
    effects: ['p_revision is the proof revision that was reviewed and asset_revision the digest that was shown: a stale revision is 40001, a different digest EU014.',
      'Only a submitted proof on an accepted assignment is reviewed (40001). The reviewer is never the participant (EU002). A held proof is not reviewed (EU016).',
      'rubric answers every mission.rubric.proof criterion exactly once (22023); mission_decision pass needs every one met (22023).',
      'The stored decision is reviewOutcome(...). accepted: the assignment becomes completed and exactly one credit row is written. The credit code reads neither consent nor publication.'] }),
  /* p_revision confirms which proof revision is held or released; moderation never changes the proof revision. */
  'proofs.moderate': write({ id: 'proof', document: 'proof_moderate', revision: 'proof', result: 'proof_row', errors: ['P0002', '40001'],
    reduce_when: { field: 'hold', values: [true] },
    effects: ['hold true on a clear proof, hold false on a held proof; anything else 40001.',
      'Placing a hold withdraws a live publication in the same transaction (reason moderation_hold).',
      'While held: consents.grant, publications.decide published, proofs.review and every signed media read answer EU016.'] }),
  'publications.decide': write({ id: 'proof', document: 'publication_decide', revision: 'proof', result: 'publication', errors: ['P0002', '40001', 'EU011', 'EU015', 'EU016'],
    reduce_when: { field: 'decision', values: ['withdrawn'] },
    effects: ['published: the proof is accepted, consent_id is an open, unexpired publish_proof consent of the participant whose proof, proof_revision and asset_revision equal the proof exactly (EU015), the proof is not held (EU016), campaign and mission are released (EU011). proof.publication_state becomes published_released_audience.',
      'withdrawn: only a published proof (40001); reason owner.',
      'Publication means visible to the campaign released audience only. Nothing here writes a public projection.'] }),
  'appeals.resolve': write({ id: 'appeal', document: 'appeal_resolve', result: 'appeal_row', bumps: ['application'], errors: ['P0002', '40001', 'EU002'],
    effects: ['Only an open appeal (40001). The resolver is never the appellant (EU002).',
      'overturned: a declined application returns to submitted; a rejected proof returns to submitted at the same revision. upheld changes nothing else.'] }),
  /* DECISION (review 2026-11-10): the purge DECISION is kept before anything is deleted. media.purged used to be the
     first write, after the Worker had deleted the objects, and it re-checked "due" under the policy in force then: a
     policy change in between (a longer retention) refused it and left sealed rows claiming deleted objects, against
     MEDIA.order. The purge route now records the decision first, with the request's own key. */
  'media.purging': reduce({ document: 'media_purged', result: 'due_list', errors: ['P0002', '40001'],
    effects: ['Every named upload must be due now, decided already or purged (40001 otherwise, and nothing changes).',
      'Each due upload that is not decided yet is marked decided; its state does not change. A decided upload stays due, whatever policy change follows, until media.purged records it. publications.decide refuses media whose purge is decided (40001).',
      'Answers the due list of exactly the uploads named, in the order named.'] }),
  /* Called by the Worker AFTER it deleted the objects. Every named upload must be due (a decided upload is due) or already purged, else 40001 and nothing changes. */
  'media.purged': reduce({ document: 'media_purged', result: 'purge_result', errors: ['P0002', '40001'],
    effects: ['State becomes purged; sha256, bytes and storage identity are kept as the record of what existed.',
      'A publication of a proof bound to a purged upload is withdrawn in the same transaction (reason media_purged).'] }),
  /* DECISION: state-idempotent. Acknowledging twice returns the same consumption row; a consumer may deliver at least once. */
  'outbox.ack': write({ id: 'outbox_seq', document: 'outbox_ack', result: 'consumption', outbox: false, errors: ['P0002'] })
});

export const MEMBER_ACTIONS = deepFreeze({
  /* EU011 only when the actor is in no released audience AND has no record of their own. Own records stay readable
     after a grant is revoked, a campaign is paused or withdrawn, and in every module state. */
  'me.get': read({ result: 'me', gates: [], errors: ['EU011'] }),
  /* The row's participant always reads it. sign true asks for the storage identity to sign a read: the upload must be
     sealed (EU014) and its proof not held (EU016); it is also allowed to an actor in the released audience of a campaign
     where the upload belongs to an effective publication. Anyone else: 42501. */
  'uploads.get': read({ id: 'upload', document: 'upload_get', result: 'upload', gates: ['ownership'], errors: ['P0002', 'EU014', 'EU016'] }),
  'receipts.get': read({ document: 'receipt_get', result: 'receipt', gates: [], errors: ['P0002'] }),

  /* p_id is the MISSION. Creates the actor's application or saves it; p_revision 0 when the actor has none for the mission. */
  'applications.save': write({ id: 'mission', document: 'application_save', revision: 'application', revision_min: 0, bumps: ['application'], result: 'member_application', gates: ALL_GATES,
    errors: ['P0002', '40001', 'EU013', 'EU017', ...GATED],
    effects: ['Allowed while the application is absent, draft, changes_requested, submitted or withdrawn (40001 otherwise).',
      'submit false keeps or creates a draft (changes_requested stays changes_requested); from submitted, submit must be true.',
      'submit true makes it submitted and binds it to requirements_revision, which must be current (EU013).'] }),
  'applications.withdraw': reduce({ id: 'application', document: 'empty', bumps: ['application'], result: 'member_application', gates: ['ownership'], errors: ['P0002', '40001'],
    effects: ['From draft, submitted or changes_requested (40001 otherwise).'] }),
  'assignments.accept': write({ id: 'assignment', document: 'assignment_accept', revision: 'assignment', bumps: ['assignment'], result: 'assignment', gates: ALL_GATES,
    errors: ['P0002', '40001', 'EU013', ...GATED],
    effects: ['Only an offered assignment (40001). requirements_revision must equal the mission current value and notice_revision the policy participation notice revision (EU013 for either).',
      'Appends one acceptance row (requirements revision, notice revision, time); earlier acceptances are kept.'] }),
  'assignments.withdraw': reduce({ id: 'assignment', document: 'empty', bumps: ['assignment'], result: 'assignment', gates: ['ownership'], errors: ['P0002', '40001'],
    effects: ['From offered or accepted (40001 otherwise). The seat is freed.',
      'Assignment-withdrawal effects: its open consents are revoked, its publication is withdrawn (reason assignment_withdrawn), its uploads stay until retention.withdrawn_days.'] }),
  /* p_id is the ASSIGNMENT. Full replace of the working copy; p_revision 0 when there is no draft yet. */
  'drafts.save': write({ id: 'assignment', document: 'draft_save', revision: 'draft', revision_min: 0, bumps: ['draft'], result: 'draft_saved', gates: ALL_GATES,
    errors: ['P0002', '40001', 'EU013', 'EU017', ...GATED],
    effects: ['The assignment is accepted against the current requirements_revision (EU013 when it is offered, 40001 when completed or withdrawn).'] }),
  'uploads.begin': write({ id: 'assignment', document: 'upload_begin', result: 'upload', gates: [...ALL_GATES, 'media'],
    errors: ['P0002', '40001', 'EU013', 'EU017', ...GATED],
    effects: ['Same assignment condition as drafts.save. kind must be in policy.media.kinds and in mission.proof_modes, bytes within the policy cap of the kind: 22023 with a REFUSAL_HINTS hint.',
      'Creates a staged row with max_bytes = the policy cap in force and expires_at = now + MEDIA.staged_ttl_seconds. The result carries no URL: the Worker signs the grant.'] }),
  'uploads.discard': reduce({ id: 'upload', document: 'empty', result: 'upload', gates: ['ownership'], errors: ['P0002', '40001', 'EU014'],
    effects: ['From staged, sealed or rejected (40001 otherwise). An upload listed by the current proof revision is not discarded (EU014): withdraw the assignment instead.'] }),
  /* p_id is the ASSIGNMENT. p_revision is the proof revision being replaced, 0 for the first submission. */
  'proofs.submit': write({ id: 'assignment', document: 'proof_submit', revision: 'proof', revision_min: 0, bumps: ['proof'], result: 'proof_submitted', gates: ALL_GATES,
    errors: ['P0002', '40001', 'EU013', 'EU014', 'EU015', 'EU017', ...GATED],
    effects: ['Same assignment condition as drafts.save. The proof is absent, submitted or needs_changes (40001 when accepted or rejected).',
      'Every media entry: the upload exists, is sealed, belongs to this assignment and participant, is not purged, and its stored sha256 equals the one sent (EU014 for any failure). kind must be in mission.proof_modes.',
      'review_notice_revision equals policy.notices.private_review.revision (EU015).',
      'Writes proof revision N with asset_revision = SHA-256 of the canonical manifest (section 12), supersedes the open consents of earlier revisions, and writes the private_review consent for revision N, all in one transaction.'] }),
  /* p_revision is the proof revision the consent is for; granting never changes it. */
  /* DECISION: one unrevoked publish consent per proof (open or expired), a second is 23505: an exact scope has exactly one
     grant to point at, and an expired one is revoked by its actor before another is granted. */
  'consents.grant': write({ id: 'proof', document: 'consent_grant', revision: 'proof', result: 'member_consent', gates: ALL_GATES,
    errors: ['P0002', '40001', '23505', 'EU015', 'EU016', 'EU017', ...GATED],
    effects: ['The proof is accepted, asset_revision equals the proof current digest, notice_revision equals policy.notices.publication.revision, expires_at is in the future and within LIMITS.consent_max_days (EU015 for any failure).',
      'Not while held (EU016). One unrevoked, unsuperseded publish_proof consent per proof, open or expired (23505): revoke it, even after it expired, before granting again.',
      'At most LIMITS.rate.publish_consents_per_proof publish_proof consents per proof, ever (EU017).',
      'A consent publishes nothing. Publication is the separate owner command publications.decide.'] }),
  /* DECISION: only publish_proof consents are revoked by command (22023 for a private_review id). The private_review
     consent ends with assignments.withdraw or a newer proof revision, so a reviewer can never lose access mid-review
     without the participant also leaving the review. */
  'consents.revoke': reduce({ id: 'consent', document: 'empty', result: 'consent_revoked', gates: ['ownership'], errors: ['P0002', '40001'],
    effects: ['Only an open or expired consent of the actor (40001 when already revoked or superseded). Works at any proof revision, in every campaign, mission, grant and module state.',
      'The publication bound to this consent is withdrawn in the same transaction (reason consent_revoked). The credit is untouched.'] }),
  /* p_id is the application or the proof named by document.subject. */
  'appeals.open': write({ id: 'subject', document: 'appeal_open', result: 'member_appeal_row', gates: ALL_GATES, errors: ['P0002', '40001', '23505', 'EU017', ...GATED],
    effects: ['Only against a declined application or a rejected proof of the actor (40001 otherwise). One open appeal per subject (23505).'] }),
  'appeals.withdraw': reduce({ id: 'appeal', document: 'empty', result: 'member_appeal_row', gates: ['ownership'], errors: ['P0002', '40001'], effects: ['Only an open appeal (40001).'] })
});

/* The third function. Called only by the Worker, after it inspected the stored object itself. It has no key:
   it is idempotent by state (write-once digest), so the route that calls it needs no idempotency key either. */
export const MEDIA_SEAL = deepFreeze({
  'media.seal': action('mutation', 'enabled', { keyed: false, id: 'upload', document: 'seal_result', result: 'upload', gates: [...ALL_GATES, 'media'],
    errors: ['P0002', '40001', 'EU014', ...GATED],
    effects: ['p_actor must be the upload participant (42501).',
      'staged and now <= expires_at, outcome sealed: bytes must equal declared_bytes and storage.size, be within max_bytes and the hard ceiling, and family must be one the row MIME allows (EU014 for any failure); the row becomes sealed with sha256, bytes, family and storage identity, written once.',
      'staged and now <= expires_at, outcome rejected: the row becomes rejected with the reason.',
      'staged and now > expires_at: the row becomes expired and is returned as such (no error, so the state is committed).',
      'sealed or rejected already, and p_result says the same thing: the row is returned unchanged. sealed with a different digest or identity: EU014. Any other state: 40001.'] })
});

/* Which guard a call takes. 'reduce' = the reduce entry point of the module policy authority; 'enabled' = the normal
   guard; 'none' = a read. Four owner actions are reduce-only for part of their input (reduce_when). */
export function guardClass(surface, name, document = null) {
  const table = surface === 'owner' ? OWNER_ACTIONS : surface === 'member' ? MEMBER_ACTIONS : surface === 'media' ? MEDIA_SEAL : null;
  const spec = table && Object.hasOwn(table, name) ? table[name] : null;
  if (!spec) return null;
  if (spec.reduce_when && document && spec.reduce_when.values.includes(document[spec.reduce_when.field])) return 'reduce';
  return spec.guard;
}
/* The complete reduce-only set, as "surface:action" or "surface:action?field=value". */
export const REDUCE_ONLY = deepFreeze([
  ...Object.entries(MEMBER_ACTIONS).filter(([, a]) => a.guard === 'reduce').map(([n]) => `member:${n}`),
  ...Object.entries(OWNER_ACTIONS).flatMap(([n, a]) => (a.guard === 'reduce' ? [`owner:${n}`]
    : a.reduce_when ? a.reduce_when.values.map((v) => `owner:${n}?${a.reduce_when.field}=${v}`) : []))
].sort());

/* Review outcome: accepted only when all three pass; rejected when any fails; otherwise needs_changes. */
export function reviewOutcome({ mission_decision, rights_decision, safety_decision }) {
  const all = [mission_decision, rights_decision, safety_decision];
  if (!all.every((d) => ENUMS.DIMENSION_DECISIONS.includes(d))) throw new TypeError('three decisions of pass, changes or fail are required');
  if (all.includes('fail')) return 'rejected';
  return all.every((d) => d === 'pass') ? 'accepted' : 'needs_changes';
}

/* Outbox events: type = "league." + action name; payload carries ids and revisions ONLY, from this closed key list.
   No text, no state, no storage identity: a consumer reads the row it is told about. */
export const OUTBOX = deepFreeze({
  type_prefix: 'league.',
  payload_keys: ['campaign_id', 'mission_id', 'application_id', 'assignment_id', 'proof_id', 'upload_id', 'upload_ids', 'consent_id', 'publication_id', 'publication_ids',
    'appeal_id', 'credit_id', 'grant_id', 'review_id', 'revision', 'requirements_revision', 'proof_revision', 'asset_revision', 'policy_revision'],
  value_kinds: ['uuid', 'uuid[]', 'int', 'sha256']
});

/* ------------------------------------------------------------------ 8. state machines
   by: "surface:action" names, or "clock" for a state that is derived from time and never written. from null = creation. */

const T = (from, to, ...by) => ({ from, to, by });
const LIFECYCLE = (transition, create, cascade = []) => [
  T(null, 'draft', create), T('draft', 'released', transition), T('draft', 'withdrawn', transition, ...cascade),
  T('released', 'paused', transition), T('released', 'withdrawn', transition, ...cascade),
  T('paused', 'released', transition), T('paused', 'withdrawn', transition, ...cascade)
];
export const STATE_MACHINES = deepFreeze({
  campaign: { field: 'state', states: ENUMS.CAMPAIGN_STATES, initial: 'draft', terminal: ['withdrawn'],
    transitions: LIFECYCLE('owner:campaigns.transition', 'owner:campaigns.create') },
  mission: { field: 'state', states: ENUMS.MISSION_STATES, initial: 'draft', terminal: ['withdrawn'],
    transitions: LIFECYCLE('owner:missions.transition', 'owner:missions.create', ['owner:campaigns.transition']) },
  application: { field: 'status', states: ENUMS.APPLICATION_STATUSES, initial: 'draft', terminal: ['approved'],
    transitions: [
      T(null, 'draft', 'member:applications.save'), T(null, 'submitted', 'member:applications.save', 'owner:applications.create'),
      T('draft', 'draft', 'member:applications.save'), T('draft', 'submitted', 'member:applications.save'),
      T('submitted', 'submitted', 'member:applications.save'),
      T('changes_requested', 'changes_requested', 'member:applications.save'), T('changes_requested', 'submitted', 'member:applications.save'),
      T('withdrawn', 'draft', 'member:applications.save'), T('withdrawn', 'submitted', 'member:applications.save'), // DECISION: a withdrawal is the member's own and reversible
      T('submitted', 'approved', 'owner:applications.decide'), T('submitted', 'declined', 'owner:applications.decide', 'owner:missions.transition', 'owner:campaigns.transition'),
      T('submitted', 'changes_requested', 'owner:applications.decide'),
      T('draft', 'declined', 'owner:missions.transition', 'owner:campaigns.transition'), T('changes_requested', 'declined', 'owner:missions.transition', 'owner:campaigns.transition'),
      T('draft', 'withdrawn', 'member:applications.withdraw'), T('submitted', 'withdrawn', 'member:applications.withdraw'), T('changes_requested', 'withdrawn', 'member:applications.withdraw'),
      T('declined', 'submitted', 'owner:appeals.resolve')
    ] },
  assignment: { field: 'status', states: ENUMS.ASSIGNMENT_STATUSES, initial: 'offered', terminal: ['completed', 'withdrawn'],
    transitions: [
      T(null, 'offered', 'owner:applications.decide'), T('offered', 'accepted', 'member:assignments.accept'),
      T('accepted', 'offered', 'owner:missions.update'), T('accepted', 'completed', 'owner:proofs.review'),
      T('offered', 'withdrawn', 'member:assignments.withdraw', 'owner:missions.transition', 'owner:campaigns.transition'),
      T('accepted', 'withdrawn', 'member:assignments.withdraw', 'owner:missions.transition', 'owner:campaigns.transition')
    ] },
  upload: { field: 'state', states: ENUMS.UPLOAD_STATES, initial: 'staged', terminal: ['purged'],
    transitions: [
      T(null, 'staged', 'member:uploads.begin'), T('staged', 'sealed', 'media:media.seal'), T('staged', 'rejected', 'media:media.seal'), T('staged', 'expired', 'media:media.seal'),
      T('staged', 'discarded', 'member:uploads.discard'), T('sealed', 'discarded', 'member:uploads.discard'), T('rejected', 'discarded', 'member:uploads.discard'),
      T('staged', 'purged', 'owner:media.purged'), T('sealed', 'purged', 'owner:media.purged'), T('rejected', 'purged', 'owner:media.purged'),
      T('discarded', 'purged', 'owner:media.purged'), T('expired', 'purged', 'owner:media.purged')
    ] },
  proof: { field: 'state', states: ENUMS.PROOF_STATES, initial: 'submitted', terminal: ['accepted'],
    transitions: [
      T(null, 'submitted', 'member:proofs.submit'), T('submitted', 'submitted', 'member:proofs.submit'), T('needs_changes', 'submitted', 'member:proofs.submit'),
      T('submitted', 'accepted', 'owner:proofs.review'), T('submitted', 'needs_changes', 'owner:proofs.review'), T('submitted', 'rejected', 'owner:proofs.review'),
      T('rejected', 'submitted', 'owner:appeals.resolve') // DECISION: rejected is final except through an overturned appeal; needs_changes is the path for revision
    ] },
  moderation: { field: 'moderation_state', states: ENUMS.MODERATION_STATES, initial: 'clear', terminal: [],
    transitions: [T('clear', 'held', 'owner:proofs.moderate'), T('held', 'clear', 'owner:proofs.moderate')] },
  publication: { field: 'publication_state', states: ENUMS.PUBLICATION_STATES, initial: 'private', terminal: [],
    transitions: [
      T('private', 'published_released_audience', 'owner:publications.decide'), T('withdrawn', 'published_released_audience', 'owner:publications.decide'),
      T('published_released_audience', 'withdrawn', 'owner:publications.decide', 'member:consents.revoke', 'member:assignments.withdraw', 'owner:proofs.moderate',
        'owner:media.purged', 'owner:missions.transition', 'owner:campaigns.transition')
    ] },
  /* A publication is EFFECTIVE (shown to the audience, media signable) only while: state published, its consent open and
     unexpired, the proof clear, campaign and mission released. Expiry and pause hide it without a write.
     DECISION: expiry is computed at read, never written: nothing runs on a schedule in this build, and a consent that
     lapsed must stop exposure whether or not anyone is there to record it. */
  consent: { field: 'state', states: ENUMS.CONSENT_STATES, initial: 'open', terminal: ['revoked', 'superseded'],
    transitions: [
      T(null, 'open', 'member:proofs.submit', 'member:consents.grant'), T('open', 'expired', 'clock'),
      T('open', 'revoked', 'member:consents.revoke', 'member:assignments.withdraw', 'owner:missions.transition', 'owner:campaigns.transition'),
      T('expired', 'revoked', 'member:consents.revoke'), T('open', 'superseded', 'member:proofs.submit')
    ] },
  appeal: { field: 'state', states: ENUMS.APPEAL_STATES, initial: 'open', terminal: ['withdrawn', 'upheld', 'overturned'],
    transitions: [T(null, 'open', 'member:appeals.open'), T('open', 'withdrawn', 'member:appeals.withdraw'), T('open', 'upheld', 'owner:appeals.resolve'), T('open', 'overturned', 'owner:appeals.resolve')] },
  grant: { field: 'state', states: ENUMS.GRANT_STATES, initial: 'open', terminal: ['revoked'],
    transitions: [T(null, 'open', 'owner:audience.grants.grant'), T('open', 'revoked', 'owner:audience.grants.revoke')] }
});

/* ------------------------------------------------------------------ 9. errors
   One row per SQLSTATE. code/owner_status answer an owner route; member_status and member_code (when it differs)
   answer a member route. member_detail false: the answer carries no message beyond the fixed code.
   DECISION: on member routes "no such row", "not your row", "not in the audience" and "schema absent" are ONE answer,
   404 not_available, so a member route never confirms that another account's record or an unreleased campaign exists.
   The EUM codes (module policy guard) are NOT defined here: the only mapping of them is MODULE_POLICY_ERRORS in
   ./modules.js, and League routes consult it first for any code that starts with EUM, and for 55P03 and 57014. */

const E = (code, owner_status, member_status, meaning, extra = {}) => ({ code, owner_status, member_status, member_detail: true, meaning, ...extra });
const HIDDEN = { member_code: 'not_available', member_detail: false };
export const ERRORS = deepFreeze({
  '42501': E('owner_required', 403, 404, 'Owner function: the actor is not a house owner. Member function: the actor is not the row applicant, participant, appellant or consent actor.', HIDDEN),
  '40001': E('revision_conflict', 409, 409, 'Expected revision differs, or the row is no longer in a state that allows the action. Reload, then decide again.'),
  '40P01': E('retry_conflict', 409, 409, 'Deadlock victim. Nothing was written; the same key may be sent again. Must not occur in the native mix test.'),
  'P0002': E('not_found', 404, 404, 'The row named by p_id (or a row it needs) does not exist in this tenant.', HIDDEN),
  '22023': E('invalid', 422, 422, 'Malformed document, unknown action, unknown key, or a transition the table does not contain. A REFUSAL_HINTS hint may refine it.'),
  '23505': E('exists', 409, 409, 'The thing already exists: slug, application, open grant, unrevoked publish consent (open or expired), open appeal.'),
  '23514': E('invalid', 422, 422, 'A CHECK refused the row, for example an audience that is impossible by constraint.'),
  'EU001': E('capacity_exhausted', 409, 409, 'No seat is free, or a capacity below the seats taken was asked for.'),
  'EU002': E('self_review_denied', 403, 403, 'Self-approval, self-review or resolving one own appeal.'),
  'EU003': E('idempotency_conflict', 409, 409, 'The idempotency key was already used with a different payload.'),
  'EU010': E('policy_unavailable', 503, 503, 'Readiness: the League policy is missing or invalid, or media is not enabled for an upload action.'),
  'EU011': E('audience_not_released', 422, 404, 'Released audience: campaign or mission not released, or the account is neither a house owner nor an open grant holder on an invited campaign.', HIDDEN),
  'EU012': E('entitlement_required', 403, 403, 'Entitlement: the policy does not say none_required.'),
  'EU013': E('requirements_changed', 409, 409, 'The requirements or participation notice revision sent is not the current one, or the assignment has not accepted the current requirements.'),
  'EU014': E('media_binding', 409, 409, 'An upload is missing, unsealed, foreign, purged, changed, or its digest is not the one named; or the asset revision reviewed is not the proof current one.'),
  'EU015': E('consent_scope', 409, 409, 'The consent does not match its exact scope: proof state, proof revision, asset revision, notice revision, expiry.'),
  'EU016': E('moderation_hold', 409, 409, 'The proof is held.'),
  'EU017': E('rate_limited', 429, 429, 'A LIMITS.rate bound was reached.'),
  'PGRST202': E('schema_not_applied', 503, 404, 'The function is not in the schema cache: the pending SQL is not applied.', HIDDEN)
});
export const ERROR_FALLBACK = deepFreeze({ code: 'storage_unavailable', owner_status: 503, member_status: 503, member_detail: false, meaning: 'Any other SQLSTATE, a timeout, a redirect or a malformed answer. No data is returned.' });
export const MODULE_ERRORS = deepFreeze({ prefix: 'EUM', also: ['55P03', '57014'], source: './modules.js', export: 'MODULE_POLICY_ERRORS', defined_here: false });
/* The refinement of 22023 that uploads.begin MUST set in the error hint, so the Worker can answer 415 or 413.
   DECISION: a hint, not a new SQLSTATE: the stable code list is frozen at EU010..EU017, and only the policy (in SQL) knows the cap. */
export const REFUSAL_HINTS = deepFreeze({
  media_type_not_allowed: { sqlstate: '22023', status: 415 }, // kind or MIME not allowed by the policy or the mission
  media_too_large: { sqlstate: '22023', status: 413 } // declared bytes above the policy cap of the kind
});
/* errorFor(sqlstate, surface, hint): { status, code, detail } for a League SQLSTATE; null for a module-policy code (ask ./modules.js). */
export function errorFor(sqlstate, surface, hint = null) {
  const code = String(sqlstate ?? '');
  if (code.startsWith(MODULE_ERRORS.prefix) || MODULE_ERRORS.also.includes(code)) return null;
  const row = Object.hasOwn(ERRORS, code) ? ERRORS[code] : ERROR_FALLBACK;
  const member = surface === 'member';
  const refined = code === '22023' && typeof hint === 'string' && Object.hasOwn(REFUSAL_HINTS, hint) ? hint : null;
  if (refined) return { status: REFUSAL_HINTS[refined].status, code: refined, detail: true };
  return { status: member ? row.member_status : row.owner_status, code: member ? (row.member_code || row.code) : row.code, detail: member ? row.member_detail : row !== ERROR_FALLBACK };
}
/* Answers the Worker produces without SQL. A member route never says not_found.
   DECISION (review 2026-11-10): authorization_unavailable is listed: the Worker's session check (member routes) or its
   house-owner check (owner routes) could not answer, so nothing ran. A client treats it as "try again", not a refusal. */
export const HTTP_REASONS = deepFreeze({
  authentication_required: 401, authorization_unavailable: 503, json_required: 415, body_required: 400, invalid_json: 400, body_too_large: 413,
  idempotency_key_required: 400, expected_revision_required: 400, field_refused: 422, invalid: 422,
  not_found: 404, not_available: 404, not_implemented: 501, storage_unavailable: 503,
  media_type_not_allowed: 415, media_too_large: 413, upload_missing: 409, upload_expired: 409, media_changed: 409
});

/* ------------------------------------------------------------------ 10. routes

   Every route: the body is at most LIMITS.body_max_bytes (413), JSON (415) and an object (400). Path ids that are not
   uuids answer 404 before any RPC (not_found on owner routes, not_available on member routes).
   Before ANY RPC: idempotency_key (400 idempotency_key_required) and expected_revision (400 expected_revision_required)
   where the route says so; expected_revision is an integer revision_min..LIMITS.revision_max and becomes p_revision.
   p_document = { ...body[wrapper] or the named top-level fields, ...mapped query values, ...fixed }.
   Member routes refuse a body that contains any REFUSED_MEMBER_FIELDS key at any depth (422 field_refused, no RPC).
   Answers: { ok: true, [response]: result } with cache-control private, no-store. Signed out: 401.

   DECISION: every route sends p_revision as expected_revision (the review route's old proof_revision is gone): one name
   for one meaning across Control and the member page.
   DECISION: three routes the map does not list: member POST appeals/:id/withdraw (the action had no route), owner
   GET publications and owner GET media/due (the owner must see what would be published or purged before commanding it).
   DECISION: POST media/purge carries the upload ids to purge (see media.purged).
   DECISION: GET uploads/:id/url is also how the released audience plays an effective publication's media, so no second
   signing route exists; the SQL decides, the answer is the same narrow shape either way. */

export const REFUSED_MEMBER_FIELDS = deepFreeze(['actor', 'applicant', 'participant', 'user_id', 'tenant']);
/* First segments under the owner prefix that stay 501 not_implemented for every method. Not routes, not actions. */
export const NOT_IMPLEMENTED_SEGMENTS = deepFreeze(['publish', 'broadcast', 'points', 'payouts']);

const route = (surface, method, path, name, o = {}) => ({ surface, method, path, action: name, rpc: name ? surface : null, before: [], id: null,
  idempotency_key: false, expected_revision: false, revision_min: 1, wrapper: null, fields: [], query: {}, required_query: [], fixed: {}, params: {}, response: null, answer: null, media: null, extra: [], ...o });
const cmd = (surface, method, path, name, response, o = {}) => route(surface, method, path, name, { idempotency_key: true, response, ...o });
const cas = (surface, method, path, name, response, o = {}) => cmd(surface, method, path, name, response, { expected_revision: true, ...o });
const ID = { id: 'id' };

export const ROUTES = deepFreeze([
  /* ---- member: PREFIX.member, verified bearer, actor from the session only ---- */
  route('member', 'GET', '', 'me.get', { response: 'league' }),
  cas('member', 'POST', 'missions/:id/application', 'applications.save', 'application', { ...ID, wrapper: 'application', revision_min: 0 }),
  cmd('member', 'POST', 'applications/:id/withdraw', 'applications.withdraw', 'application', ID),
  cas('member', 'POST', 'assignments/:id/accept', 'assignments.accept', 'assignment', { ...ID, fields: ['requirements_revision', 'notice_revision'] }),
  cmd('member', 'POST', 'assignments/:id/withdraw', 'assignments.withdraw', 'assignment', ID),
  cas('member', 'POST', 'assignments/:id/draft', 'drafts.save', 'draft', { ...ID, wrapper: 'draft', revision_min: 0 }),
  cmd('member', 'POST', 'assignments/:id/uploads', 'uploads.begin', 'upload', { ...ID, wrapper: 'upload', answer: 'member_upload', media: 'beginUpload', extra: ['grant'] }),
  route('member', 'POST', 'uploads/:id/complete', 'media.seal', { ...ID, rpc: 'media', before: ['uploads.get'], response: 'upload', answer: 'member_upload', media: 'completeUpload' }),
  cmd('member', 'POST', 'uploads/:id/discard', 'uploads.discard', 'upload', { ...ID, answer: 'member_upload', media: 'discardUpload' }),
  route('member', 'GET', 'uploads/:id/url', 'uploads.get', { ...ID, fixed: { sign: true }, response: 'media', answer: 'proof_media', media: 'signOwnRead', extra: ['url', 'expires_in'] }),
  cas('member', 'POST', 'assignments/:id/proof', 'proofs.submit', 'proof', { ...ID, wrapper: 'proof', revision_min: 0 }),
  cas('member', 'POST', 'proofs/:id/consent', 'consents.grant', 'consent', { ...ID, wrapper: 'consent' }),
  cmd('member', 'POST', 'consents/:id/revoke', 'consents.revoke', 'consent', ID),
  cmd('member', 'POST', 'applications/:id/appeal', 'appeals.open', 'appeal', { ...ID, wrapper: 'appeal', fixed: { subject: 'application' } }),
  cmd('member', 'POST', 'proofs/:id/appeal', 'appeals.open', 'appeal', { ...ID, wrapper: 'appeal', fixed: { subject: 'proof' } }),
  cmd('member', 'POST', 'appeals/:id/withdraw', 'appeals.withdraw', 'appeal', ID),
  route('member', 'GET', 'receipts/:operation/:key', 'receipts.get', { params: { operation: 'operation', key: 'key' }, response: 'receipt' }),

  /* ---- owner: PREFIX.owner, house owner only (the router checks before dispatch, SQL checks again) ---- */
  route('owner', 'GET', 'fixture', null, { response: 'fixture' }), // static draft catalogue from ./league-fixture.js, no RPC
  route('owner', 'GET', 'policy', 'policy.get', { response: 'policy' }),
  cas('owner', 'POST', 'policy', 'policy.set', 'policy', { fields: ['policy', 'reason'], revision_min: 0 }),
  route('owner', 'GET', 'campaigns', 'campaigns.list', { response: 'campaigns' }),
  cmd('owner', 'POST', 'campaigns', 'campaigns.create', 'campaign', { wrapper: 'campaign' }),
  cas('owner', 'POST', 'campaigns/:id/transition', 'campaigns.transition', 'campaign', { ...ID, fields: ['to'] }),
  cas('owner', 'POST', 'campaigns/:id/audience', 'campaigns.audience.set', 'campaign', { ...ID, fields: ['audience'] }),
  route('owner', 'GET', 'campaigns/:id/audience/grants', 'audience.grants.list', { ...ID, response: 'grants' }),
  cmd('owner', 'POST', 'campaigns/:id/audience/grants', 'audience.grants.grant', 'grant', { ...ID, wrapper: 'grant' }),
  cmd('owner', 'POST', 'audience/grants/:id/revoke', 'audience.grants.revoke', 'grant', { ...ID, fields: ['reason'] }),
  cmd('owner', 'POST', 'campaigns/:id/missions', 'missions.create', 'mission', { ...ID, wrapper: 'mission' }),
  route('owner', 'GET', 'missions', 'missions.list', { query: { campaign: 'id' }, response: 'missions' }),
  cas('owner', 'PATCH', 'missions/:id', 'missions.update', 'mission', { ...ID, wrapper: 'mission' }), // PATCH: the old PUT is gone (CORS never allowed it)
  cas('owner', 'POST', 'missions/:id/transition', 'missions.transition', 'mission', { ...ID, fields: ['to'] }),
  route('owner', 'GET', 'missions/:id/preview', 'missions.preview', { ...ID, response: 'mission' }),
  cmd('owner', 'POST', 'missions/:id/applications', 'applications.create', 'application', { ...ID, wrapper: 'application' }),
  route('owner', 'GET', 'applications', 'applications.list', { query: { mission: 'id', status: 'status' }, response: 'applications' }),
  cas('owner', 'POST', 'applications/:id/decision', 'applications.decide', 'application', { ...ID, fields: ['decision', 'reason', 'rubric'] }),
  route('owner', 'GET', 'applications/:id/accommodation', 'applications.accommodation.get', { ...ID, response: 'accommodation' }),
  route('owner', 'GET', 'assignments', 'assignments.list', { query: { mission: 'id' }, response: 'assignments' }),
  route('owner', 'GET', 'proofs', 'proofs.list', { query: { assignment: 'id', state: 'state' }, response: 'proofs' }),
  route('owner', 'GET', 'proofs/:id/media', 'proofs.get', { ...ID, query: { revision: 'revision' }, required_query: ['revision'], fixed: { media: true }, response: 'proof', media: 'signReviewRead', extra: ['media'] }),
  cas('owner', 'POST', 'proofs/:id/review', 'proofs.review', 'proof', { ...ID, wrapper: 'review' }),
  cas('owner', 'POST', 'proofs/:id/moderation', 'proofs.moderate', 'proof', { ...ID, fields: ['hold', 'reason'] }),
  cas('owner', 'POST', 'proofs/:id/publication', 'publications.decide', 'publication', { ...ID, fields: ['decision', 'consent_id', 'reason'] }),
  route('owner', 'GET', 'publications', 'publications.list', { query: { campaign: 'id', state: 'state' }, response: 'publications' }),
  route('owner', 'GET', 'consents', 'consents.list', { query: { proof: 'id' }, response: 'consents' }),
  route('owner', 'GET', 'appeals', 'appeals.list', { query: { state: 'state' }, response: 'appeals' }),
  cmd('owner', 'POST', 'appeals/:id/resolve', 'appeals.resolve', 'appeal', { ...ID, fields: ['outcome', 'reason'] }),
  route('owner', 'GET', 'credits', 'credits.list', { query: { mission: 'id' }, response: 'credits' }),
  route('owner', 'GET', 'media/due', 'media.due', { query: { limit: 'limit' }, response: 'due' }),
  cmd('owner', 'POST', 'media/purge', 'media.purged', 'purge', { fields: ['uploads'], before: ['media.purging'], media: 'purgeDue' }),
  route('owner', 'GET', 'outbox', 'outbox.list', { query: { after: 'after', limit: 'limit', consumer: 'consumer' }, response: 'events' }),
  cmd('owner', 'POST', 'outbox/:seq/ack', 'outbox.ack', 'consumption', { id: 'seq', fields: ['consumer'] }),
  route('owner', 'GET', 'receipts/:operation/:key', 'receipts.get', { params: { operation: 'operation', key: 'key' }, response: 'receipt' })
]);
/* Route field notes:
   id        the path parameter that becomes p_id ('id' is a uuid, 'seq' an outbox sequence); null sends ''.
   query     query parameter -> 'id' (becomes p_id, a uuid) or the p_document field it fills (integers match PATTERNS.query_integer).
   params    path parameter -> p_document field.
   before    calls on the same surface the route makes first (see MEDIA.order): reads, and the one keyed decision the
             purge route records with the request's own key before it deletes anything (media.purging).
   rpc       which function the action belongs to: owner, member, media (the seal), or null for a static answer.
   answer    the shape of the [response] value when the route narrows the action result with projectShape; otherwise the
             action result itself. A member route never answers a storage identity.
   extra     answer keys next to [response], produced by the media module.
   POST uploads/:id/complete answers 200 with the upload row whatever the outcome: the caller reads upload.state
   (sealed, rejected with rejected_reason, or expired). DECISION: a rejection is a committed fact, not a transport error. */

const SEGMENT = { id: PATTERNS.uuid, seq: PATTERNS.outbox_seq, operation: PATTERNS.operation, key: PATTERNS.idempotency_key };
/* matchRoute(surface, method, rest): rest is the path after the surface prefix, without a leading slash.
   Returns { route, params } or null. A parameter that does not match its pattern is no match (the caller answers 404). */
export function matchRoute(surface, method, rest) {
  const parts = rest ? String(rest).split('/') : [];
  for (const candidate of ROUTES) {
    if (candidate.surface !== surface || candidate.method !== method) continue;
    const want = candidate.path ? candidate.path.split('/') : [];
    if (want.length !== parts.length) continue;
    const params = {};
    const hit = want.every((segment, i) => {
      if (!segment.startsWith(':')) return segment === parts[i];
      const name = segment.slice(1);
      if (!SEGMENT[name].test(parts[i])) return false;
      params[name] = name === 'id' ? parts[i].toLowerCase() : parts[i];
      return true;
    });
    if (hit) return { route: candidate, params };
  }
  return null;
}
/* refusedMemberField(body): the dotted path of the first key that would name another account, or null.
   DECISION (review 2026-11-10): the walk keeps its own stack instead of recursing. A body within LIMITS.body_max_bytes
   can nest 32 765 arrays deep, which overflowed the call stack and answered 500 instead of a 4xx. The order is the
   recursive one: depth first, keys in order, a key checked before its value is entered. */
export function refusedMemberField(value) {
  if (!value || typeof value !== 'object') return null;
  const frame = (node, path) => ({ entries: Array.isArray(node) ? [...node.entries()] : Object.entries(node), array: Array.isArray(node), path, at: 0 });
  const stack = [frame(value, '')];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.at >= top.entries.length) { stack.pop(); continue; }
    const [key, child] = top.entries[top.at];
    top.at += 1;
    const here = top.path ? `${top.path}.${key}` : String(key);
    if (!top.array && REFUSED_MEMBER_FIELDS.includes(key)) return here;
    if (child && typeof child === 'object') stack.push(frame(child, here));
  }
  return null;
}

/* ------------------------------------------------------------------ 11. media (D2: the existing private, service-only bucket; no new bucket) */

export const MEDIA = deepFreeze({
  bucket: 'equity-uprise-private',
  path_template: 'league/v1/t/<tenant>/a/<assignment>/u/<upload>.<ext>',
  hard_max_bytes: HARD_MAX_BYTES, // the bucket object limit; a policy cap can only be lower
  signed_read_seconds: 300,
  /* DECISION: a staged row lives 24 hours, and a grant is signed only while now + upload_grant_seconds <= expires_at, so no
     signed upload can land after its row was purged. upload_grant_seconds is the storage service's signed-upload lifetime
     as documented, NOT verified against real storage in this build.
     DECISION (journey lane, 2026-11-10): for that to hold, media.due makes no upload due before its expires_at, whatever
     its state: a discarded or rejected row's due_at is the later of the discard (or rejection) and expires_at. A grant
     signed while the row was staged can outlive the discard, and the journey showed a PUT with it storing an object after
     an earlier purge, which no row would ever list as due again. Every retention date is already no earlier. */
  staged_ttl_seconds: 86400,
  upload_grant_seconds: 7200,
  sniff_bytes: 12, // the matcher reads at most the first 12 bytes
  kinds: ENUMS.MEDIA_KINDS,
  types: MEDIA_TYPES,
  extensions: [...new Set(Object.values(MEDIA_TYPES).map((t) => t.ext))],
  families: {
    mpeg: 'ID3v2 tag ("ID3") or an MPEG audio frame sync (11 set bits, valid version, layer, bitrate and sample-rate fields)',
    iso_bmff: '"ftyp" at byte offset 4 (MP4, M4A, QuickTime)',
    riff_wave: '"RIFF" at 0 and "WAVE" at 8',
    ebml: 'EBML magic 1A 45 DF A3 (WebM, Matroska)',
    ogg: '"OggS" at 0'
  },
  states: ENUMS.UPLOAD_STATES,
  scan_state: 'not_scanned',
  reject_reasons: {
    empty: 'the stored object has no bytes', too_large: 'more bytes than max_bytes or the hard ceiling (the read stops there)',
    size_mismatch: 'the bytes read differ from declared_bytes or from the listed size', unrecognised: 'no known magic-byte family',
    family_mismatch: 'a known family that the declared MIME type does not allow'
  },
  grant: { method: 'PUT', headers: ['content-type', 'x-upsert'], upsert: 'false' }, // content-type = the row MIME; answer key grant = { method, url, headers, expires_in }
  /* The order of effects, chosen so a failure never leaves a row claiming more than storage holds. */
  order: {
    begin: ['member:uploads.begin', 'sign one upload for mediaObjectPath(row)'],
    complete: ['member:uploads.get', 'if the row is already sealed or rejected: answer it, read nothing', 'list the object: absent answers 409 upload_missing and the row stays staged',
      'read it once: count, sniff, SHA-256', 'media:media.seal with what was measured', 'after a rejected or expired answer: delete the object'],
    discard: ['member:uploads.discard', 'delete the object (a failure is left to the purge)'],
    own_read: ['member:uploads.get with sign true', 'list the object: id, eTag or size differing from the stored identity answers 409 media_changed', 'sign for signed_read_seconds'],
    review_read: ['owner:proofs.get with media true and the revision asked for', 'the same identity check per upload', 'sign for signed_read_seconds'],
    purge: ['owner:media.purging with the uploads asked for and the request\'s key: the decision, kept before anything is deleted',
      'refuse (409) if one is neither due, decided nor purged, before deciding or deleting anything', 'delete the due objects',
      'only if every deletion succeeded: owner:media.purged with exactly the uploads asked for and the same key']
  }
});
/* The interface ./league-media.js exports and ./league.js and ./league-member.js import. ctx = { env, fetchImpl, fail, now, seal }.
   Every storage call uses redirect manual and a timeout; a 3xx, a timeout or a malformed answer is 503 storage_unavailable.
   No URL, token or key is logged, stored in a receipt or put in an error body.
   DECISION (media lane): the module reaches the third function only through ctx.seal, which the member route supplies.
   The module then names no RPC and maps no SQLSTATE: the route that owns the error table makes the call, and whatever
   it throws passes through completeUpload unchanged. Only completeUpload reads ctx.seal.
   Two refusals repeat a decision the SQL makes first, for a caller that skipped the read MEDIA.order names:
   completeUpload answers not_available when the actor is not the row's participant, and signReviewRead answers the
   EU016 pair of ERRORS when the proof arrives held. */
export const MEDIA_MODULE = deepFreeze({
  file: './league-media.js',
  context: {
    env: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    fetchImpl: 'fetch; the module calls it bare, never as a method of ctx',
    fail: '(status, message, reason) => the Error to throw',
    now: '() => epoch milliseconds',
    seal: 'async ({ p_upload, p_actor, p_result }) => the upload row after the seal; the keys are RPC_ARGUMENTS.seal and p_result satisfies DOCUMENTS.seal_result'
  },
  functions: {
    beginUpload: { args: ['ctx', 'upload'], returns: '{ method, url, headers, expires_in }', fails: ['upload_expired', 'storage_unavailable'] },
    completeUpload: { args: ['ctx', 'upload', 'actor'], returns: 'upload (the row after the seal; state says sealed, rejected or expired)', fails: ['upload_missing', 'storage_unavailable'] },
    discardUpload: { args: ['ctx', 'upload'], returns: '{ deleted }', fails: [] },
    signOwnRead: { args: ['ctx', 'upload'], returns: '{ url, expires_in }', fails: ['media_changed', 'storage_unavailable'] },
    signReviewRead: { args: ['ctx', 'proof'], returns: '[{ upload_id, kind, mime, bytes, sha256, url, expires_in }]', fails: ['media_changed', 'storage_unavailable'] },
    purgeDue: { args: ['ctx', 'due'], returns: '{ deleted, failed }', fails: ['storage_unavailable'] }
  }
});

/* mediaType(mime): the table row for a bare, lower-case MIME type, or null. Parameters are not accepted on the wire:
   a recorder's "audio/webm;codecs=opus" is sent as "audio/webm" (bareMime does that). */
export const mediaType = (mime) => (typeof mime === 'string' && Object.hasOwn(MEDIA_TYPES, mime) ? MEDIA.types[mime] : null);
export const bareMime = (value) => (typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '');

/* sniffMediaFamily(bytes): the magic-byte family of the first bytes of a file, or null. A family, not a codec check. */
export function sniffMediaFamily(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  const b = bytes;
  const ascii = (offset, text) => b.length >= offset + text.length && [...text].every((c, i) => b[offset + i] === c.charCodeAt(0));
  if (ascii(0, 'RIFF')) return ascii(8, 'WAVE') ? 'riff_wave' : null;
  if (ascii(4, 'ftyp')) return b.length >= 12 ? 'iso_bmff' : null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'ebml';
  if (ascii(0, 'OggS')) return 'ogg';
  if (ascii(0, 'ID3')) return b.length >= 10 && b[3] !== 0xff && b[4] !== 0xff ? 'mpeg' : null;
  /* MPEG audio frame header: sync 11 bits; version not reserved (01); layer not reserved (00); bitrate not 1111; sample rate not 11. */
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x18) !== 0x08 && (b[1] & 0x06) !== 0x00 && (b[2] & 0xf0) !== 0xf0 && (b[2] & 0x0c) !== 0x0c) return 'mpeg';
  return null;
}
/* mediaAccepts(mime, bytes): true only when the bytes belong to a family the declared MIME type allows. */
export function mediaAccepts(mime, bytes) {
  const type = mediaType(mime);
  const family = sniffMediaFamily(bytes);
  return Boolean(type && family && type.families.includes(family));
}
/* mediaObjectPath: the ONLY way a storage path is made. Ids only; anything that is not a uuid throws. */
export function mediaObjectPath({ tenant, assignment, upload, ext } = {}) {
  for (const id of [tenant, assignment, upload]) if (typeof id !== 'string' || !PATTERNS.uuid.test(id)) throw new TypeError('media path ids must be uuids');
  if (typeof ext !== 'string' || !MEDIA.extensions.includes(ext)) throw new TypeError('media path extension is not allowed');
  return `league/v1/t/${tenant.toLowerCase()}/a/${assignment.toLowerCase()}/u/${upload.toLowerCase()}.${ext}`;
}
export const bytesFromHex = (hex) => Uint8Array.from((String(hex).match(/[0-9a-f]{2}/gi) || []).map((pair) => parseInt(pair, 16)));

export const MAGIC_VECTORS = deepFreeze([
  { name: 'mp3 with ID3v2 tag', hex: '49443304000000000023545353', family: 'mpeg', accepts: ['audio/mpeg'] },
  { name: 'mp3 frame sync MPEG-1 layer III', hex: 'fffb9064000000000000000000', family: 'mpeg', accepts: ['audio/mpeg'] },
  { name: 'm4a', hex: '00000020667479704d344120000000004d344120', family: 'iso_bmff', accepts: ['audio/mp4', 'audio/x-m4a', 'video/mp4', 'video/quicktime'] },
  { name: 'mov', hex: '0000001466747970717420200000000071742020', family: 'iso_bmff', accepts: ['audio/mp4', 'audio/x-m4a', 'video/mp4', 'video/quicktime'] },
  { name: 'wav', hex: '524946462408000057415645666d7420', family: 'riff_wave', accepts: ['audio/wav'] },
  { name: 'webm', hex: '1a45dfa39f4286810142f7810142f281', family: 'ebml', accepts: ['audio/webm', 'video/webm'] },
  { name: 'ogg', hex: '4f67675300020000000000000000', family: 'ogg', accepts: ['audio/ogg'] },
  { name: 'html', hex: '3c21646f63747970652068746d6c3e', family: null, accepts: [] },
  { name: 'MZ executable', hex: '4d5a90000300000004000000ffff0000', family: null, accepts: [] },
  { name: 'empty', hex: '', family: null, accepts: [] },
  { name: 'RIFF that is not WAVE (AVI)', hex: '52494646240800004156492046', family: null, accepts: [] },
  { name: 'UTF-16 text with a byte order mark', hex: 'fffe3c00680074006d006c00', family: null, accepts: [] },
  { name: 'ADTS AAC (layer bits 00)', hex: 'fff15080000000000000000000', family: null, accepts: [] },
  { name: 'truncated ftyp', hex: '0000002066747970', family: null, accepts: [] },
  { name: 'png', hex: '89504e470d0a1a0a0000000d49484452', family: null, accepts: [] }
]);

/* ------------------------------------------------------------------ 12. proof manifest and asset_revision

   asset_revision = lower-case hex SHA-256 of the UTF-8 bytes of canonicalJson(manifest).

   The manifest (built by SQL at proofs.submit from validated values, never taken from the caller):
     schema                 the literal MANIFEST_SCHEMA
     tenant, mission_id, assignment_id     lower-case uuids
     requirements_revision  the mission requirements_revision the assignment accepted
     title, lyrics          exactly as submitted
     credits                [{ name, role }] in submitted order
     rights                 the seven music-rights-v1 fields
     media                  [{ upload_id, kind, mime, bytes, sha256 }] in submitted order, from the SEALED rows; [] on the accommodation path
     accommodation          { statement } or null
   It does not contain the proof revision, the participant, times or review data: the same work resubmitted
   unchanged has the same asset_revision; any change to words, credits, rights, files or the requirements gives a new one.
   DECISION: the manifest names its tenant, mission, assignment and requirements revision, so a digest reviewed in one
   place can never be presented as the reviewed digest of another; it omits the notice revision, which is consent, not content.

   canonicalJson (a strict subset of RFC 8785, small enough to write identically in SQL):
     object   { then members sorted by key in ascending byte order (keys are [a-z0-9_]+), "key":value joined by , then }
     array    [ then values in order joined by , then ]
     string   " then the text with \" \\ \b \f \n \r \t escaped so, every other code point below U+0020 as \u00xx in
              lower-case hex, and everything else (including / and all non-ASCII) as itself, then "
     number   integers only, plain decimal, no sign for zero, no exponent, no fraction
     true false null as written. No whitespace anywhere.
   The same function in SQL (run against the vectors below in PostgreSQL through PGlite: identical text and digest):
     create function canon(v jsonb) returns text language sql immutable as $$
       select case jsonb_typeof(v)
         when 'object' then '{' || coalesce((select string_agg(to_json(e.key)::text || ':' || canon(e.value), ','
                order by e.key collate "C") from jsonb_each(v) e), '') || '}'
         when 'array' then '[' || coalesce((select string_agg(canon(e.value), ',' order by e.ordinality)
                from jsonb_array_elements(v) with ordinality e), '') || ']'
         else v::text end $$;
     asset_revision = encode(sha256(convert_to(canon(manifest), 'UTF8')), 'hex')
   (the function name is the SQL lane's to choose; the manifest numbers are integers, so v::text prints them plainly). */

export const MANIFEST_SCHEMA = 'eup.league.proof-manifest/v1';
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('canonical JSON carries safe integers only');
    return String(value);
  }
  if (typeof value === 'string') {
    if (!wellFormed(value)) throw new TypeError('canonical JSON carries well-formed strings only');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    for (const key of keys) if (!/^[a-z0-9_]+$/.test(key)) throw new TypeError('canonical JSON keys are lower-case ASCII words');
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON cannot carry this value');
}
/* proofManifest: the manifest object for a validated proof document. media = the sealed upload rows, in the document's order. */
export function proofManifest({ tenant, mission_id, assignment_id, requirements_revision, proof, media = [] }) {
  for (const id of [tenant, mission_id, assignment_id]) if (typeof id !== 'string' || !PATTERNS.uuid.test(id)) throw new TypeError('manifest ids must be uuids');
  const r = proof.rights;
  return {
    schema: MANIFEST_SCHEMA,
    tenant: tenant.toLowerCase(), mission_id: mission_id.toLowerCase(), assignment_id: assignment_id.toLowerCase(),
    requirements_revision,
    title: proof.title, lyrics: proof.lyrics,
    credits: proof.credits.map((c) => ({ name: c.name, role: c.role })),
    rights: { version: r.version, owns_master: r.owns_master, controls_composition: r.controls_composition, samples_cleared: r.samples_cleared,
      collaborators_cleared: r.collaborators_cleared, parody_or_derivative: r.parody_or_derivative, derivative_permissions: r.derivative_permissions },
    media: proof.accommodation ? [] : media.map((m) => ({ upload_id: String(m.upload_id ?? m.id).toLowerCase(), kind: m.kind, mime: m.mime, bytes: m.bytes, sha256: m.sha256 })),
    accommodation: proof.accommodation ? { statement: proof.accommodation.statement } : null
  };
}
/* assetRevision(manifest): Web Crypto, so it runs in the Worker, in Node and in a browser without an import. */
export async function assetRevision(manifest) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(manifest)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Test vectors. Synthetic: the ids, words and digests below describe no person and no file.
   Each was also computed by the SQL form above in PostgreSQL (PGlite 17.5) with an identical result. */
const VECTOR_PROOF = {
  title: 'Test fixture: river song',
  lyrics: 'Line one of a test fixture\nLine "two"\twith a tab, a \\ backslash, a / slash\nL\u00ednea tres \u{1F30D}',
  credits: [{ name: 'Fixture Writer', role: 'lyrics' }, { name: 'Fixture Singer', role: 'voice' }],
  rights: { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' },
  review_notice_revision: 'fixture-review-1'
};
const VECTOR_IDS = { tenant: '0A000000-0000-4000-8000-000000000001', mission_id: '0a000000-0000-4000-8000-000000000002', assignment_id: '0a000000-0000-4000-8000-000000000003', requirements_revision: 2 };
const VECTOR_SHA = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
export const MANIFEST_VECTORS = deepFreeze([
  { name: 'one sealed audio upload',
    input: { ...VECTOR_IDS, proof: { ...VECTOR_PROOF, media: [{ upload_id: '0a000000-0000-4000-8000-000000000004', sha256: VECTOR_SHA }] },
      media: [{ id: '0a000000-0000-4000-8000-000000000004', kind: 'audio', mime: 'audio/webm', bytes: 4, sha256: VECTOR_SHA }] },
    canonical: '{"accommodation":null,"assignment_id":"0a000000-0000-4000-8000-000000000003","credits":[{"name":"Fixture Writer","role":"lyrics"},{"name":"Fixture Singer","role":"voice"}],"lyrics":"Line one of a test fixture\\nLine \\"two\\"\\twith a tab, a \\\\ backslash, a / slash\\nL\u00ednea tres \ud83c\udf0d","media":[{"bytes":4,"kind":"audio","mime":"audio/webm","sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","upload_id":"0a000000-0000-4000-8000-000000000004"}],"mission_id":"0a000000-0000-4000-8000-000000000002","requirements_revision":2,"rights":{"collaborators_cleared":true,"controls_composition":true,"derivative_permissions":"","owns_master":true,"parody_or_derivative":false,"samples_cleared":true,"version":"music-rights-v1"},"schema":"eup.league.proof-manifest/v1","tenant":"0a000000-0000-4000-8000-000000000001","title":"Test fixture: river song"}',
    asset_revision: '66e9cbc81eafad1bea295a71766aa66ed2e333bb378f0c1be4d1096e1fdaa9de' },
  { name: 'accommodation path, no media',
    input: { ...VECTOR_IDS, proof: { ...VECTOR_PROOF, accommodation: { statement: 'Test fixture statement: recording is not possible for me.\nI am submitting the words instead.' } }, media: [] },
    canonical: '{"accommodation":{"statement":"Test fixture statement: recording is not possible for me.\\nI am submitting the words instead."},"assignment_id":"0a000000-0000-4000-8000-000000000003","credits":[{"name":"Fixture Writer","role":"lyrics"},{"name":"Fixture Singer","role":"voice"}],"lyrics":"Line one of a test fixture\\nLine \\"two\\"\\twith a tab, a \\\\ backslash, a / slash\\nL\u00ednea tres \ud83c\udf0d","media":[],"mission_id":"0a000000-0000-4000-8000-000000000002","requirements_revision":2,"rights":{"collaborators_cleared":true,"controls_composition":true,"derivative_permissions":"","owns_master":true,"parody_or_derivative":false,"samples_cleared":true,"version":"music-rights-v1"},"schema":"eup.league.proof-manifest/v1","tenant":"0a000000-0000-4000-8000-000000000001","title":"Test fixture: river song"}',
    asset_revision: '6168ea4cfd2fd51ce351a897ce293d90c5f8d877af4f80d62adad0b499f78742' }
]);
