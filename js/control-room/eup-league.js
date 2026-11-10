/* Control · System · E=Up › Environmental Justice League: the owner's League tab.

   Registered as window.CR.eupLeague and created once per bound workspace by js/control-room/eup.js, which calls it
   from paneLeague, wirePane and load('league'), resets it with every private pane, and tells it when the E=Up tab
   leaves the League. It is presentation over the OWNER rows of the frozen League contract
   (workers/mccluster/src/eup/league-contract.js, ROUTES with surface 'owner'), reached through eup.js's bounded,
   epoch-stamped requester. It creates no permission and decides nothing the SQL decides: the Worker checks the house
   owner, and the SQL checks the actor, the revision, the key, the module policy and the audience again in one
   transaction. A 403 owner_required or a 401 conceals the whole workspace (eup.js). The browser cannot import the
   contract (the public export strips workers/), so COMMANDS, READS and the rules below MIRROR it;
   scripts/test/control-eup-league.test.mjs compares every one of them with the contract itself.

   Six local views inside the one League tab. No navigation leaf of its own; the one globe host is eup.js's.
     Setup                    League policy (owner-entered values and notices: nothing ships a default), the draft
                              catalogue, campaigns and missions created from it, requirements, capacity and rubric,
                              transitions, audience and tester grants, and the member preview (missions/:id/preview
                              answers exactly the card a member reads).
     Applications             the decision with rubric answers and a reason; the restricted, audited accommodation read.
     Proofs                   a media element fed by the 300 s review link, the fingerprint, lyrics, credits, rights
                              and three decisions; every upload says "not scanned"; the moderation hold.
     Consent and publication  the participant's exact-scope consents and the owner's separate publication decision.
     Appeals                  resolve upheld or overturned, with a reason.
     Retention                the uploads that are due, and the purge.

   Commands: the Sources pattern of eup.js, generalised. Every command carries a fresh idempotency key and, where the
   route compares one, the revision that was read (expected_revision). While it is pending its record's buttons wait
   (aria-disabled, still focusable). A documented refusal changed nothing and says why. A timeout, a lost answer and
   any answer this code cannot place are an UNKNOWN outcome: never resent automatically; the receipt is read by its key
   (GET receipts/<action>/<key>): found means it was recorded; not found offers the SAME command (same key, same body)
   by hand, which the store records at most once.

   Signed media links live only in memory (a closure, never the model) and in the media element's src. They are dropped
   on a tab switch (E=Up or League view), on an account or epoch change, and when they expire, counted from when the
   read was SENT so the page never holds a link longer than the store honours it. They are never written to the DOM as
   text, to storage or to the console. The accommodation text an owner reads is dropped the same way.

   Words: publication means visible to the campaign's released audience only; nothing here is public. Entitlement and
   the owner's per-mission decision are two separate gates, and no copy here offers a price, a purchase or an upgrade.
   Text headings only; no mark. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var PREFIX = '/v1/eup/league';
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  var isObject = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var isInt = function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && Math.abs(v) <= 9007199254740991; };

  /* ================================================================== contract mirror (checked by the unit test) */
  var PATTERNS = {
    uuid: /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
    slug: /^[a-z0-9][a-z0-9-]{1,79}$/,
    rubric_id: /^[a-z0-9][a-z0-9_-]{0,39}$/,
    notice_revision: /^[A-Za-z0-9._:-]{1,64}$/,
    idempotency_key: /^[A-Za-z0-9._:-]{8,128}$/
  };
  var TEXT_REFUSED = /[\u0000-\u001f\u007f]/;
  var MULTILINE_REFUSED = /[\u0000-\u0008\u000b-\u001f\u007f]/;
  var LIMITS = {
    text: { title: 180, purpose: 2000, requirements: 4000, acceptance: 4000, rubric_label: 200, reason: 2000, note: 500, policy_reason: 500, notice_text: 8000 },
    count: { rubric_criteria: 12, capacity: 100000 },
    list: { rows: 500, purge_batch: 50 },
    policy: { bytes: [1, 104857600], duration_seconds: [1, 3600], retention_days: [1, 3650] }
  };
  var ENUMS = {
    TRANSITION_TARGETS: ['released', 'paused', 'withdrawn'],
    AUDIENCES: ['admin_preview', 'invited'],
    PROOF_MODES: ['audio', 'video', 'lyrics', 'text', 'link'],
    RELEASABLE_TEMPLATES: ['write-a-song'],
    APPLICATION_STATUSES: ['draft', 'submitted', 'changes_requested', 'approved', 'declined', 'withdrawn'],
    APPLICATION_DECISIONS: ['approved', 'declined', 'changes_requested'],
    PROOF_STATES: ['submitted', 'accepted', 'needs_changes', 'rejected'],
    DIMENSION_DECISIONS: ['pass', 'changes', 'fail'],
    APPEAL_STATES: ['open', 'withdrawn', 'upheld', 'overturned'],
    APPEAL_OUTCOMES: ['upheld', 'overturned'],
    ENTITLEMENT_RULES: ['none_required', 'not_decided'],
    MEDIA_KINDS: ['audio', 'video'],
    NOTICES: ['participation', 'private_review', 'publication']
  };
  var TEMPLATE_RULES = { 'write-a-song': { modes_allowed: ['audio', 'video', 'lyrics'], modes_required: ['lyrics'], modes_any_of: ['audio', 'video'] } };
  /* The campaign and mission lifecycle: from → the targets a transition may name. withdrawn is final. */
  var LIFECYCLE = { draft: ['released', 'withdrawn'], released: ['paused', 'withdrawn'], paused: ['released', 'withdrawn'], withdrawn: [] };
  /* Every owner command this tab sends: the contract's route, whether it compares a revision, and its answer key. */
  var COMMANDS = {
    'policy.set': { method: 'POST', path: 'policy', expected_revision: true, revision_min: 0, response: 'policy', label: 'Save the League policy' },
    'campaigns.create': { method: 'POST', path: 'campaigns', response: 'campaign', label: 'Create the campaign' },
    'campaigns.transition': { method: 'POST', path: 'campaigns/:id/transition', expected_revision: true, response: 'campaign', label: 'Campaign transition' },
    'campaigns.audience.set': { method: 'POST', path: 'campaigns/:id/audience', expected_revision: true, response: 'campaign', label: 'Campaign audience' },
    'audience.grants.grant': { method: 'POST', path: 'campaigns/:id/audience/grants', response: 'grant', label: 'Grant tester access' },
    'audience.grants.revoke': { method: 'POST', path: 'audience/grants/:id/revoke', response: 'grant', label: 'Revoke tester access' },
    'missions.create': { method: 'POST', path: 'campaigns/:id/missions', response: 'mission', label: 'Create the mission' },
    'missions.update': { method: 'PATCH', path: 'missions/:id', expected_revision: true, response: 'mission', label: 'Save mission changes' },
    'missions.transition': { method: 'POST', path: 'missions/:id/transition', expected_revision: true, response: 'mission', label: 'Mission transition' },
    'applications.decide': { method: 'POST', path: 'applications/:id/decision', expected_revision: true, response: 'application', label: 'Record the decision' },
    'proofs.review': { method: 'POST', path: 'proofs/:id/review', expected_revision: true, response: 'proof', label: 'Record the review' },
    'proofs.moderate': { method: 'POST', path: 'proofs/:id/moderation', expected_revision: true, response: 'proof', label: 'Moderation' },
    'publications.decide': { method: 'POST', path: 'proofs/:id/publication', expected_revision: true, response: 'publication', label: 'Publication' },
    'appeals.resolve': { method: 'POST', path: 'appeals/:id/resolve', response: 'appeal', label: 'Resolve the appeal' },
    'media.purged': { method: 'POST', path: 'media/purge', response: 'purge', label: 'Purge due media' }
  };
  /* Every owner read: the route path, its answer key, list or object, and the query it may carry. */
  var READS = {
    policy: { path: 'policy', response: 'policy', list: false, what: 'the League policy' },
    fixture: { path: 'fixture', response: 'fixture', list: false, what: 'the draft catalogue' },
    campaigns: { path: 'campaigns', response: 'campaigns', list: true, what: 'campaigns' },
    applications: { path: 'applications', response: 'applications', list: true, filter: 'status', what: 'applications' },
    assignments: { path: 'assignments', response: 'assignments', list: true, what: 'assignments' },
    proofs: { path: 'proofs', response: 'proofs', list: true, filter: 'state', what: 'proofs' },
    credits: { path: 'credits', response: 'credits', list: true, what: 'credits' },
    publications: { path: 'publications', response: 'publications', list: true, what: 'publications' },
    appeals: { path: 'appeals', response: 'appeals', list: true, filter: 'state', what: 'appeals' },
    due: { path: 'media/due', response: 'due', list: false, query: 'limit=' + LIMITS.list.purge_batch, what: 'due media' }
  };
  var RECORD_READS = {
    grants: { path: 'campaigns/:id/audience/grants', response: 'grants', list: true, what: 'tester access' },
    preview: { path: 'missions/:id/preview', response: 'mission', list: false, what: 'the member preview' },
    accommodation: { path: 'applications/:id/accommodation', response: 'accommodation', list: false, what: 'the accommodation request' },
    review: { path: 'proofs/:id/media', response: 'proof', list: false, what: 'the proof under review' },
    /* one proof's consents (GET consents?proof=<id>): the store bounds them per proof, so this list is whole, while the
       tenant-wide list stops at LIMITS.list.rows, oldest first, and would hide later participants' consents */
    consents: { path: 'consents', response: 'consents', list: true, what: 'consents', by: 'proof' },
    receipt: { path: 'receipts/:operation/:key', response: 'receipt', list: false, what: 'the receipt' }
  };
  /* The member card fields (SHAPES.mission_card), in the order a member reads them. */
  var CARD_FIELDS = ['title', 'state', 'open', 'requirements_revision', 'requirements', 'acceptance', 'proof_modes', 'rubric', 'capacity', 'seats_taken', 'template', 'slug', 'id', 'campaign_id'];

  var VIEWS = [
    { id: 'setup', label: 'Setup' },
    { id: 'applications', label: 'Applications' },
    { id: 'proofs', label: 'Proofs' },
    { id: 'publication', label: 'Consent and publication' },
    { id: 'appeals', label: 'Appeals' },
    { id: 'retention', label: 'Retention' }
  ];
  var VIEW_READS = {
    setup: ['policy', 'fixture', 'campaigns'],
    applications: ['campaigns', 'applications'],
    proofs: ['campaigns', 'assignments', 'proofs', 'credits'],
    publication: ['campaigns', 'assignments', 'proofs', 'publications'],
    appeals: ['campaigns', 'appeals'],
    retention: ['policy', 'due']
  };
  var FILTERS = { applications: ['', 'draft', 'submitted', 'changes_requested', 'approved', 'declined', 'withdrawn'], proofs: ['', 'submitted', 'accepted', 'needs_changes', 'rejected'], appeals: ['', 'open', 'withdrawn', 'upheld', 'overturned'] };

  /* ================================================================== pure helpers (exported for the unit test) */
  function when(iso) {
    if (!iso) return 'not recorded';
    var d = new Date(iso); if (isNaN(d.getTime())) return 'invalid time';
    try { return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  var words = function (v) { return String(v == null ? 'unknown' : v).replace(/_/g, ' '); };
  var codePoints = function (s) { return Array.from(s).length; };
  var wellFormed = function (s) { return typeof s.isWellFormed !== 'function' || s.isWellFormed(); };
  /* One line of text (no control character), min..max code points, as the contract counts. */
  function lineProblem(value, max, min, label) {
    var lo = min == null ? 1 : min;
    if (typeof value !== 'string' || (lo > 0 && !value.trim())) return label + ' is required.';
    if (!wellFormed(value) || TEXT_REFUSED.test(value)) return label + ' must be one line without control characters.';
    var n = codePoints(value);
    if (n < lo) return label + ' is required.';
    if (n > max) return label + ' is longer than ' + max + ' characters.';
    return null;
  }
  /* Several lines: line feeds and tabs only (a carriage return is refused; browsers send LF). */
  function linesProblem(value, max, min, label) {
    var lo = min == null ? 1 : min;
    if (typeof value !== 'string' || (lo > 0 && !value.trim())) return label + ' is required.';
    if (!wellFormed(value) || MULTILINE_REFUSED.test(value)) return label + ' contains a character that is not allowed (only line breaks and tabs among control characters).';
    var n = codePoints(value);
    if (n < lo) return label + ' is required.';
    if (n > max) return label + ' is longer than ' + max + ' characters.';
    return null;
  }
  function intIn(v, range) { return isInt(v) && v >= range[0] && v <= range[1]; }
  /* A whole number typed into a field: { value } | { empty: true } | { problem }. */
  function wholeNumber(text, label, range) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return { empty: true };
    if (!/^[0-9]{1,16}$/.test(t)) return { problem: label + ' must be a whole number.' };
    var n = Number(t);
    if (!intIn(n, range)) return { problem: label + ' must be from ' + range[0] + ' to ' + range[1] + '.' };
    return { value: n };
  }
  function uniqueList(list) { return list.every(function (v, i) { return list.indexOf(v) === i; }); }

  /* The League policy check, rule for rule the contract's DOCUMENTS.policy (closed objects, ranges, notices and the
     media_enabled_complete rule). null when valid, else the first problem in words. */
  function policyProblem(d) {
    var k;
    if (!isObject(d)) return 'The League policy is not readable.';
    for (k in d) if (has(d, k) && ['entitlement', 'media', 'retention', 'notices'].indexOf(k) < 0) return 'The policy names an unknown field (' + k + ').';
    if (ENUMS.ENTITLEMENT_RULES.indexOf(d.entitlement) < 0) return 'Choose the entitlement rule.';
    var m = d.media;
    if (!isObject(m)) return 'The media settings are required.';
    for (k in m) if (has(m, k) && ['enabled', 'kinds', 'audio_max_bytes', 'video_max_bytes', 'max_duration_seconds'].indexOf(k) < 0) return 'The media settings name an unknown field (' + k + ').';
    if (typeof m.enabled !== 'boolean') return 'Say whether members may upload media.';
    if (has(m, 'kinds') && (!Array.isArray(m.kinds) || m.kinds.length < 1 || m.kinds.length > 2 || !m.kinds.every(function (x) { return ENUMS.MEDIA_KINDS.indexOf(x) >= 0; }) || !uniqueList(m.kinds))) return 'Media kinds are audio, video or both.';
    if (has(m, 'audio_max_bytes') && !intIn(m.audio_max_bytes, LIMITS.policy.bytes)) return 'The largest audio file is a whole number of bytes from 1 to ' + LIMITS.policy.bytes[1] + '.';
    if (has(m, 'video_max_bytes') && !intIn(m.video_max_bytes, LIMITS.policy.bytes)) return 'The largest video file is a whole number of bytes from 1 to ' + LIMITS.policy.bytes[1] + '.';
    if (has(m, 'max_duration_seconds') && !intIn(m.max_duration_seconds, LIMITS.policy.duration_seconds)) return 'The longest take is a whole number of seconds from 1 to ' + LIMITS.policy.duration_seconds[1] + '.';
    if (m.enabled === true && (!Array.isArray(m.kinds) || !has(m, 'max_duration_seconds') || !m.kinds.every(function (x) { return has(m, x + '_max_bytes'); })))
      return 'With uploads enabled, choose the kinds, the longest take and the largest file of every chosen kind.';
    var r = d.retention;
    if (!isObject(r)) return 'The retention settings are required.';
    for (k in r) if (has(r, k) && ['completed_days', 'withdrawn_days'].indexOf(k) < 0) return 'The retention settings name an unknown field (' + k + ').';
    if (!intIn(r.completed_days, LIMITS.policy.retention_days)) return 'Keep media of completed work for a whole number of days from 1 to ' + LIMITS.policy.retention_days[1] + '.';
    if (!intIn(r.withdrawn_days, LIMITS.policy.retention_days)) return 'Keep media of withdrawn work for a whole number of days from 1 to ' + LIMITS.policy.retention_days[1] + '.';
    var n = d.notices;
    if (!isObject(n)) return 'The three notices are required.';
    for (k in n) if (has(n, k) && ENUMS.NOTICES.indexOf(k) < 0) return 'The notices name an unknown notice (' + k + ').';
    for (var i = 0; i < ENUMS.NOTICES.length; i += 1) {
      var name = ENUMS.NOTICES[i], x = n[name], label = NOTICE_LABEL[name];
      if (!isObject(x)) return 'The ' + label + ' is required.';
      for (k in x) if (has(x, k) && ['revision', 'text'].indexOf(k) < 0) return 'The ' + label + ' names an unknown field (' + k + ').';
      if (typeof x.revision !== 'string' || !PATTERNS.notice_revision.test(x.revision)) return 'The ' + label + ' needs a revision label: 1 to 64 letters, digits, dots, underscores, colons or hyphens.';
      var p = linesProblem(x.text, LIMITS.text.notice_text, 1, 'The ' + label + ' text');
      if (p) return p;
    }
    return null;
  }
  var NOTICE_LABEL = { participation: 'participation notice', private_review: 'private review notice', publication: 'publication notice' };

  /* The policy form, as flat field values. Nothing is pre-filled unless a policy is stored: code ships no value. */
  function policyForm(doc) {
    var f = {};
    if (!isObject(doc)) return f;
    var m = isObject(doc.media) ? doc.media : {}, r = isObject(doc.retention) ? doc.retention : {}, n = isObject(doc.notices) ? doc.notices : {};
    var num = function (v) { return isInt(v) ? String(v) : ''; };
    f.entitlement = typeof doc.entitlement === 'string' ? doc.entitlement : '';
    f.media_enabled = m.enabled === true;
    f.kind_audio = Array.isArray(m.kinds) && m.kinds.indexOf('audio') >= 0;
    f.kind_video = Array.isArray(m.kinds) && m.kinds.indexOf('video') >= 0;
    f.audio_max_bytes = num(m.audio_max_bytes); f.video_max_bytes = num(m.video_max_bytes); f.max_duration_seconds = num(m.max_duration_seconds);
    f.completed_days = num(r.completed_days); f.withdrawn_days = num(r.withdrawn_days);
    ENUMS.NOTICES.forEach(function (k) { var x = isObject(n[k]) ? n[k] : {}; f[k + '_revision'] = typeof x.revision === 'string' ? x.revision : ''; f[k + '_text'] = typeof x.text === 'string' ? x.text : ''; });
    return f;
  }
  /* The policy document a form describes: { document } or { problem }. Empty number fields are left out, never zero. */
  function policyFromForm(f) {
    f = f || {};
    var doc = { entitlement: f.entitlement || '', media: { enabled: f.media_enabled === true }, retention: {}, notices: {} };
    var kinds = [];
    if (f.kind_audio === true) kinds.push('audio');
    if (f.kind_video === true) kinds.push('video');
    if (kinds.length) doc.media.kinds = kinds;
    var numbers = [
      ['audio_max_bytes', 'The largest audio file (bytes)', LIMITS.policy.bytes, doc.media], ['video_max_bytes', 'The largest video file (bytes)', LIMITS.policy.bytes, doc.media],
      ['max_duration_seconds', 'The longest take (seconds)', LIMITS.policy.duration_seconds, doc.media],
      ['completed_days', 'Days to keep media of completed work', LIMITS.policy.retention_days, doc.retention], ['withdrawn_days', 'Days to keep media of withdrawn work', LIMITS.policy.retention_days, doc.retention]
    ];
    for (var i = 0; i < numbers.length; i += 1) {
      var w = wholeNumber(f[numbers[i][0]], numbers[i][1], numbers[i][2]);
      if (w.problem) return { problem: w.problem };
      if (!w.empty) numbers[i][3][numbers[i][0]] = w.value;
    }
    ENUMS.NOTICES.forEach(function (k) { doc.notices[k] = { revision: String(f[k + '_revision'] == null ? '' : f[k + '_revision']).trim(), text: f[k + '_text'] == null ? '' : String(f[k + '_text']) }; });
    var problem = policyProblem(doc);
    return problem ? { problem: problem } : { document: doc };
  }

  /* Rubric criteria typed one per line as "id: label". { list } or { problem }. */
  function parseRubric(text, which) {
    var lines = String(text == null ? '' : text).split('\n'), list = [], seen = {};
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line) continue;
      var at = line.indexOf(':');
      if (at < 1) return { problem: which + ' criteria, line ' + (i + 1) + ': write it as "id: label".' };
      var id = line.slice(0, at).trim(), label = line.slice(at + 1).trim();
      if (!PATTERNS.rubric_id.test(id)) return { problem: which + ' criteria: "' + id + '" is not a criterion id (lower-case letters, digits, _ and -, up to 40, starting with a letter or digit).' };
      if (seen[id]) return { problem: which + ' criteria: the id "' + id + '" appears twice.' };
      var p = lineProblem(label, LIMITS.text.rubric_label, 1, which + ' criterion "' + id + '"');
      if (p) return { problem: p };
      seen[id] = true; list.push({ id: id, label: label });
    }
    if (list.length > LIMITS.count.rubric_criteria) return { problem: which + ' criteria: at most ' + LIMITS.count.rubric_criteria + '.' };
    return { list: list };
  }
  function rubricText(list) { return (Array.isArray(list) ? list : []).filter(isObject).map(function (c) { return c.id + ': ' + c.label; }).join('\n'); }
  /* A mission's criteria for 'application' or 'proof'; null when the mission itself is unknown. */
  function criteriaOf(mission, which) {
    if (!isObject(mission)) return null;
    var r = isObject(mission.document) && isObject(mission.document.rubric) ? mission.document.rubric : (isObject(mission.rubric) ? mission.rubric : {});
    return Array.isArray(r[which]) ? r[which].filter(function (c) { return isObject(c) && typeof c.id === 'string'; }) : [];
  }
  function templateProblem(template, modes) {
    var t = TEMPLATE_RULES[template];
    if (!t) return null;
    if (!modes.every(function (x) { return t.modes_allowed.indexOf(x) >= 0; })) return 'This template takes only ' + t.modes_allowed.join(', ') + '.';
    if (!t.modes_required.every(function (x) { return modes.indexOf(x) >= 0; })) return 'This template always needs ' + t.modes_required.join(' and ') + '.';
    if (!t.modes_any_of.some(function (x) { return modes.indexOf(x) >= 0; })) return 'This template needs at least one of ' + t.modes_any_of.join(' or ') + '.';
    return null;
  }
  /* The changes an edited mission form makes: { document } (only changed fields), { nothing: true } or { problem }. */
  function missionChanges(mission, f) {
    var doc = isObject(mission.document) ? mission.document : {}, out = {}, p;
    f = f || {};
    if (has(f, 'title')) {
      var title = String(f.title).trim();
      if (title !== (typeof doc.title === 'string' ? doc.title : mission.title)) { p = lineProblem(title, LIMITS.text.title, 1, 'The title'); if (p) return { problem: p }; out.title = title; }
    }
    if (has(f, 'requirements') && f.requirements !== (doc.requirements || '')) { p = linesProblem(f.requirements, LIMITS.text.requirements, 1, 'The requirements'); if (p) return { problem: p }; out.requirements = f.requirements; }
    if (has(f, 'acceptance') && f.acceptance !== (doc.acceptance || '')) {
      if (!String(f.acceptance).trim()) return { problem: 'The acceptance text cannot be emptied once it is set; write what acceptance means instead.' };
      p = linesProblem(f.acceptance, LIMITS.text.acceptance, 1, 'The acceptance text'); if (p) return { problem: p }; out.acceptance = f.acceptance;
    }
    if (has(f, 'capacity')) {
      var cap = wholeNumber(f.capacity, 'The capacity', [1, LIMITS.count.capacity]);
      if (cap.problem) return { problem: cap.problem };
      var next = cap.empty ? null : cap.value;
      if (next !== (isInt(mission.capacity) ? mission.capacity : null)) out.capacity = next;
    }
    var current = Array.isArray(mission.proof_modes) ? mission.proof_modes : (Array.isArray(doc.proof_modes) ? doc.proof_modes : []);
    var modes = ENUMS.PROOF_MODES.filter(function (x) { return has(f, 'mode_' + x) ? f['mode_' + x] === true : current.indexOf(x) >= 0; });
    if (modes.length !== current.length || !modes.every(function (x) { return current.indexOf(x) >= 0; })) {
      if (!modes.length) return { problem: 'Choose at least one proof mode.' };
      p = templateProblem(mission.template, modes); if (p) return { problem: p };
      out.proof_modes = modes;
    }
    if (has(f, 'rubric_application') || has(f, 'rubric_proof')) {
      var was = isObject(doc.rubric) ? doc.rubric : {};
      var a = has(f, 'rubric_application') ? parseRubric(f.rubric_application, 'Application') : { list: Array.isArray(was.application) ? was.application : [] };
      if (a.problem) return { problem: a.problem };
      var b = has(f, 'rubric_proof') ? parseRubric(f.rubric_proof, 'Proof') : { list: Array.isArray(was.proof) ? was.proof : [] };
      if (b.problem) return { problem: b.problem };
      var same = function (x, y) { return JSON.stringify((x || []).map(function (c) { return [c.id, c.label]; })) === JSON.stringify((y || []).map(function (c) { return [c.id, c.label]; })); };
      if (!same(a.list, was.application) || !same(b.list, was.proof)) out.rubric = { application: a.list, proof: b.list };
    }
    return Object.keys(out).length ? { document: out } : { nothing: true };
  }
  /* The stored outcome of three decisions, rule for rule the contract's reviewOutcome. */
  function reviewOutcome(mission, rights, safety) {
    var all = [mission, rights, safety];
    if (!all.every(function (d) { return ENUMS.DIMENSION_DECISIONS.indexOf(d) >= 0; })) return null;
    if (all.indexOf('fail') >= 0) return 'rejected';
    return all.every(function (d) { return d === 'pass'; }) ? 'accepted' : 'needs_changes';
  }

  /* ================================================================== what a refused or lost command means */
  var reasonOf = function (err) { return err && err.detail && typeof err.detail.reason === 'string' ? err.detail.reason : ''; };
  /* 401, or a 403 that is the owner check (no reason, or owner_required): the workspace is concealed by eup.js. A 403
     self_review_denied or entitlement_required is a League refusal and conceals nothing. */
  function ownerLost(err) { var r = reasonOf(err); return !!err && (err.status === 401 || (err.status === 403 && (!r || r === 'owner_required'))); }
  var REFUSAL = {
    revision_conflict: 'the record changed since it was read, or is no longer in a state that allows this. Nothing changed; it is read again below. Decide again.',
    retry_conflict: 'the store stopped this request to break a deadlock; nothing was written. The same command can be sent again.',
    exists: 'it already exists (a slug, an open grant, an open publication consent or an open appeal). Nothing changed.',
    capacity_exhausted: 'no seat is free on this mission, or the capacity asked for is below the seats already taken. Nothing changed.',
    self_review_denied: 'nobody approves, reviews or resolves their own work. Another house owner must decide this one. Nothing changed.',
    idempotency_conflict: 'this key was already used for a different command. Nothing was changed by this request.',
    policy_unavailable: 'the League policy is missing or not valid for this. Nothing changed.',
    audience_not_released: 'that account is not in the released audience of this mission. Nothing changed.',
    entitlement_required: 'the League policy has not opened participation (entitlement not decided). Nothing changed.',
    requirements_changed: 'the requirements or the notice changed since this was made: the person must read and accept the current version first. Nothing changed.',
    media_binding: 'the media or its digest is not the one sealed and shown for this revision. Nothing changed; open the proof again.',
    consent_scope: 'the participant\'s consent does not match this proof exactly (revision, digest, notice or expiry). Nothing changed.',
    moderation_hold: 'the proof is held. Release the hold first. Nothing changed.',
    rate_limited: 'a League limit was reached. Nothing changed.',
    invalid: 'the League refused it as not valid. Nothing changed.',
    not_found: 'the record was not found. Nothing changed.',
    not_implemented: 'not implemented. Nothing changed.',
    module_not_installed: 'the League module is not installed (Overview › Modules). Nothing changed.',
    module_draining: 'the League is draining: new work is stopped; reads, withdrawals, revocations, pauses and holds stay open. Nothing changed.',
    module_disabled: 'the League is disabled: new work is stopped; reads, withdrawals, revocations, pauses and holds stay open. Nothing changed.',
    module_policy_changed: 'the League module policy changed while this was sent. Nothing changed; the same command can be sent again.',
    module_policy_unavailable: 'the module policy could not be read, so nothing was allowed to change.',
    module_busy: 'the League was busy; nothing changed. The same command can be sent again.',
    schema_not_applied: 'the League schema is not applied (pending SQL). Nothing changed.'
  };
  var AGAIN = { retry_conflict: true, module_busy: true, module_policy_changed: true };
  var SETTLED_503 = ['policy_unavailable', 'module_not_installed', 'module_draining', 'module_policy_unavailable', 'module_busy', 'schema_not_applied', 'not_implemented'];
  var BEFORE_RPC = ['json_required', 'body_required', 'invalid_json', 'body_too_large', 'idempotency_key_required', 'expected_revision_required', 'field_refused'];
  /* { kind, settled, again, text }. settled: certainly nothing changed. Otherwise the outcome is unknown and the caller
     reads the receipt. A timeout, a network failure, a 5xx this table does not name and an unreadable answer are unknown. */
  function commandFailure(err) {
    var status = err && err.status, reason = reasonOf(err);
    if (err && (err.timeout || err.name === 'AbortError')) return { kind: 'unknown', settled: false, again: false, text: 'no answer within ' + Math.round((err.deadline || 15000) / 1000) + 's. The outcome is unknown and it was not resent.' };
    if (!status) return { kind: 'unknown', settled: false, again: false, text: (err && err.malformed ? 'the answer was not readable' : 'the connection failed before an answer arrived') + '. The outcome is unknown and it was not resent.' };
    if (has(REFUSAL, reason) && (status !== 503 || SETTLED_503.indexOf(reason) >= 0) && status !== 401) {
      var kind = reason === 'revision_conflict' ? 'conflict' : AGAIN[reason] ? 'busy' : 'error';
      return { kind: kind, settled: true, again: !!AGAIN[reason], text: REFUSAL[reason] };
    }
    if (BEFORE_RPC.indexOf(reason) >= 0) return { kind: 'error', settled: true, again: false, text: 'the Worker refused the request before running it (' + reason + '). Nothing changed.' };
    if ([400, 404, 409, 413, 415, 422, 429, 501].indexOf(status) >= 0) return { kind: 'error', settled: true, again: false, text: 'refused (HTTP ' + status + (reason ? ' ' + reason : '') + '). Nothing changed.' };
    if (status === 403 && reason) return { kind: 'error', settled: true, again: false, text: 'refused (HTTP 403 ' + reason + '). Nothing changed.' };
    return { kind: 'unknown', settled: false, again: false, text: 'answered HTTP ' + status + (reason ? ' ' + reason : '') + '. The outcome is unknown and it was not resent.' };
  }
  /* A short account of what a command result or receipt says. */
  function summary(r) {
    if (!isObject(r)) return 'no detail returned';
    var parts = [];
    if (typeof r.state === 'string') parts.push('state ' + words(r.state));
    if (typeof r.status === 'string') parts.push('status ' + words(r.status));
    if (typeof r.audience === 'string') parts.push('audience ' + words(r.audience));
    if (typeof r.moderation_state === 'string') parts.push('moderation ' + words(r.moderation_state));
    if (typeof r.publication_state === 'string') parts.push('publication ' + words(r.publication_state));
    if (isInt(r.revision)) parts.push('rev ' + r.revision);
    if (isInt(r.requirements_revision)) parts.push('requirements revision ' + r.requirements_revision);
    if (typeof r.valid === 'boolean') parts.push(r.valid ? 'valid' : 'not valid');
    if (typeof r.effective === 'boolean') parts.push(r.effective ? 'effective' : 'not effective');
    if (isObject(r.assignment)) parts.push('one ' + words(r.assignment.status || 'offered') + ' assignment');
    if (isObject(r.credit)) parts.push('one completion credit');
    if (Array.isArray(r.purged)) parts.push('purged ' + r.purged.length + (Array.isArray(r.already_purged) ? ' · already purged ' + r.already_purged.length : '') + (Array.isArray(r.publications_withdrawn) ? ' · publications withdrawn ' + r.publications_withdrawn.length : ''));
    return parts.length ? parts.join(' · ') : 'recorded';
  }
  function newKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    throw new Error('Secure key generation is unavailable; this browser cannot send League commands. Nothing was sent.');
  }
  /* The answer value a route promises under its key; an ok:false body is read by its reason, as eup.js reads it. */
  function answerOf(d, key, list) {
    if (d && d.ok !== true && d.reason) throw Object.assign(new Error(d.error || d.reason), { status: 503, detail: d });
    var v = d && d.ok === true ? d[key] : undefined;
    if (list ? !Array.isArray(v) : !isObject(v)) throw Object.assign(new Error('unreadable answer'), { malformed: true });
    return v;
  }
  var routePath = function (path, id) { return PREFIX + '/' + path.replace(':id', encodeURIComponent(String(id == null ? '' : id))); };

  /* ================================================================== the view */
  function create(host) {
    var gen = 0;
    var L = fresh();
    /* memory only: the signed links of the open review and the media elements that play them */
    var links = [], players = {}, expiryTimer = null;
    function fresh() { return { view: 'setup', data: {}, errors: {}, loading: {}, seq: {}, filters: { applications: '', proofs: '', appeals: '' }, forms: {}, outcomes: {}, open: {}, records: {}, review: null }; }
    var now = function () { return typeof host.now === 'function' ? host.now() : Date.now(); };
    var nowIso = function () { return new Date(now()).toISOString(); };
    function dead(g, p) { return g !== gen || !host.alive() || (p && p.epoch !== undefined && p.epoch !== host.epoch()); }
    var redraw = function () { if (host.alive()) host.redraw(); };
    var say = function (t) { if (host.alive()) host.say(t); };

    /* ---------- links: memory and the media element only ---------- */
    function dropLinks() {
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
      Object.keys(players).forEach(function (id) {
        var el = players[id];
        try { el.pause(); } catch (e) { /* not playing */ }
        try { el.removeAttribute('src'); el.load(); } catch (e) { /* nothing loaded */ }
        try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* already detached */ }
      });
      players = {}; links = [];
    }
    function closeReview() { dropLinks(); L.review = null; }
    /* What a tab switch drops: links, the open review, restricted texts and pending confirmations. */
    function leave() { closeReview(); dropRestricted(); L.open = {}; }
    function dropRestricted() { Object.keys(L.records).forEach(function (k) { if (k.indexOf('accommodation:') === 0) delete L.records[k]; }); }
    function reset() { gen += 1; dropLinks(); L = fresh(); }

    /* ---------- reads ---------- */
    function readPath(name) {
      var spec = READS[name], q = [];
      if (spec.filter && L.filters[name]) q.push(spec.filter + '=' + encodeURIComponent(L.filters[name]));
      if (spec.query) q.push(spec.query);
      return PREFIX + '/' + spec.path + (q.length ? '?' + q.join('&') : '');
    }
    function read(name) {
      var spec = READS[name], g = gen, mine = (L.seq[name] = (L.seq[name] || 0) + 1);
      L.loading[name] = true;
      var p = host.request(readPath(name));
      return p.then(function (d) {
        if (dead(g, p) || mine !== L.seq[name]) return;
        L.data[name] = answerOf(d, spec.response, spec.list); delete L.errors[name];
      }).catch(function (err) {
        if (dead(g, p) || mine !== L.seq[name]) return;
        if (ownerLost(err)) { host.concealed(err); return; }
        /* a failed read drops what was known: nothing remembered is shown as current */
        delete L.data[name]; L.errors[name] = err;
      }).then(function () { if (dead(g, p) || mine !== L.seq[name]) return; L.loading[name] = false; redraw(); });
    }
    function recordRead(kind, id, query) {
      var spec = RECORD_READS[kind], slot = kind + ':' + id, g = gen, prior = L.records[slot] || {}, mine = (prior.seq || 0) + 1;
      L.records[slot] = { seq: mine, loading: true, data: prior.data };
      redraw();
      var p = host.request(routePath(spec.path, id) + (query ? '?' + query : ''));
      return p.then(function (d) {
        var rec = L.records[slot];
        if (dead(g, p) || !rec || rec.seq !== mine) return;
        L.records[slot] = { seq: mine, loading: false, data: answerOf(d, spec.response, spec.list) };
      }).catch(function (err) {
        var rec = L.records[slot];
        if (dead(g, p) || !rec || rec.seq !== mine) return;
        if (ownerLost(err)) { host.concealed(err); return; }
        L.records[slot] = { seq: mine, loading: false, error: err };
      }).then(function () { if (!dead(g, p)) redraw(); });
    }
    /* Everything the current view shows, read again (also the read-back after every command). */
    /* The view is busy (aria-busy) from the first read of a load until its last dependent read has settled. */
    function load() {
      var g = gen, view = L.view, mine = (L.loadSeq = (L.loadSeq || 0) + 1);
      L.loadingView = true;
      redraw();
      var done = function () { if (dead(g) || mine !== L.loadSeq) return; L.loadingView = false; redraw(); };
      return Promise.all(VIEW_READS[view].map(read)).then(function () {
        if (dead(g) || L.view !== view) return;
        /* a review opened before the participant withdrew is closed: the store no longer signs its media */
        if (view === 'proofs' && L.review && withdrawn(proofById(L.review.proofId), index())) closeReview();
        if (view === 'publication' && Array.isArray(L.data.proofs)) {
          return Promise.all(L.data.proofs.filter(function (p) { return publishable(p) && validId(p.id); }).map(function (p) { return recordRead('consents', p.id, RECORD_READS.consents.by + '=' + encodeURIComponent(p.id)); }));
        }
        if (view !== 'setup' || !Array.isArray(L.data.campaigns)) return;
        return Promise.all(L.data.campaigns.filter(function (c) { return isObject(c) && validId(c.id) && c.state !== 'withdrawn'; }).map(function (c) { return recordRead('grants', c.id); }));
      }).then(done, done);
    }
    var validId = function (id) { return typeof id === 'string' && PATTERNS.uuid.test(id); };
    function proofById(id) { return (Array.isArray(L.data.proofs) ? L.data.proofs : []).filter(function (x) { return isObject(x) && x.id === id; })[0] || null; }
    /* the proofs the Consent and publication view lists */
    function publishable(p) { return isObject(p) && (p.state === 'accepted' || p.publication_state !== 'private'); }
    /* true when the assignment the proof belongs to is known and withdrawn: withdrawing revoked the participant's
       private_review consent, so the store answers a review or a media read of it with a refusal */
    function withdrawn(p, ix) { var a = p ? ix.assignments[p.assignment_id] : null; return !!a && a.status === 'withdrawn'; }

    /* ---------- commands ---------- */
    function pending(slot) { var o = L.outcomes[slot]; return !!o && o.kind === 'pending'; }
    /* Focus the element of the pane that carries this data-eup-focus key (after a redraw). */
    function focusKey(key) {
      if (!key || !lastPane || typeof lastPane.querySelector !== 'function') return;
      var el = lastPane.querySelector('[data-eup-focus="' + key + '"]');
      if (el && typeof el.focus === 'function') el.focus();
    }
    /* A command that was not sent: say why, and put focus on the field to fix when there is one. */
    function refuse(slot, text, focus) {
      L.outcomes[slot] = { kind: 'error', text: text };
      say(text); redraw();
      focusKey(focus);
    }
    /* An after-callback never turns an answer into a failure. */
    function afterward(sent, result, ok, reason) { if (!sent.after) return; try { sent.after(result, ok, reason); } catch (e) { /* bookkeeping only */ } }
    /* issue(slot, action, id, fields, revision, after): one owner command with a fresh key. */
    function issue(slot, action, id, fields, revision, after) {
      if (!host.alive() || pending(slot)) return;
      var spec = COMMANDS[action];
      if (spec.expected_revision && !(isInt(revision) && revision >= (spec.revision_min == null ? 1 : spec.revision_min))) { refuse(slot, spec.label + ': the revision of this record was not read; read it again before deciding. Nothing was sent.'); return; }
      var key;
      try { key = newKey(); } catch (e) { refuse(slot, e.message); return; }
      var body = { idempotency_key: key };
      if (spec.expected_revision) body.expected_revision = revision;
      Object.keys(fields || {}).forEach(function (k) { body[k] = fields[k]; });
      transmit({ slot: slot, action: action, method: spec.method, path: routePath(spec.path, id), body: body, key: key, label: spec.label, response: spec.response, after: after }, false);
    }
    function transmit(sent, again) {
      var g = gen, slot = sent.slot, stop = false;
      L.outcomes[slot] = { kind: 'pending', text: sent.label + ': sent with key ' + sent.key.slice(0, 8) + '…' + (again ? ' (the same key again)' : '') + '. Waiting for the answer.' };
      say(L.outcomes[slot].text); redraw();
      var p = host.request(sent.path, { method: sent.method, body: sent.body });
      return p.then(function (d) {
        if (dead(g, p)) { stop = true; return; }
        var result = answerOf(d, sent.response, false);
        L.outcomes[slot] = { kind: 'done', text: sent.label + ': recorded · ' + summary(result) + ' · ' + when(nowIso()) + '. Read back below.' };
        afterward(sent, result, true);
      }).catch(function (err) {
        if (stop || dead(g, p)) { stop = true; return; }
        if (ownerLost(err)) { stop = true; host.concealed(err); return; }
        var f = commandFailure(err);
        if (f.settled) {
          L.outcomes[slot] = { kind: f.kind, text: sent.label + ': ' + f.text, command: f.again ? sent : null, resend: f.again };
          afterward(sent, null, false, reasonOf(err));
          return;
        }
        L.outcomes[slot] = { kind: 'unknown', text: sent.label + ': ' + f.text + ' Reading its receipt…', command: sent, resend: false };
        say(L.outcomes[slot].text); redraw();
        return receipt(sent, g).then(function (gone) { if (gone) stop = true; });
      }).then(function () {
        if (stop || dead(g)) return;
        say(L.outcomes[slot].text);
        return readBack(slot, g);
      });
    }
    /* Everything shown is read again, then focus goes to the outcome when the control that had it is gone. A record a
       filter no longer lists keeps its outcome at the top of its view (awayBlock), and the status line says so. */
    function readBack(slot, g) {
      return load().then(function () {
        if (dead(g)) return;
        var away = awayOf(slot);
        if (away && L.outcomes[slot]) say(outcomeText(L.outcomes[slot], away));
        refocus('league:outcome:' + slot);
      });
    }
    /* When the control that had focus is gone after a redraw (Release became Pause, a confirm closed), focus lands on
       what changed instead of the page body. Focus that is anywhere else is left alone. */
    function refocus(key) {
      if (typeof document === 'undefined') return;
      var a = document.activeElement;
      if (a && a !== document.body && a.isConnected !== false) return;
      focusKey(key);
    }
    /* The read-back of an unknown outcome: the store's receipt for this action and key. Resolves true when the
       workspace was concealed meanwhile. */
    function receipt(sent, g) {
      var slot = sent.slot;
      var p = host.request(PREFIX + '/receipts/' + encodeURIComponent(sent.action) + '/' + encodeURIComponent(sent.key));
      return p.then(function (d) {
        if (dead(g, p)) return true;
        var r = answerOf(d, 'receipt', false);
        if (r.idempotency_key !== sent.key || r.operation !== sent.action) throw Object.assign(new Error('the receipt names another command'), { malformed: true });
        L.outcomes[slot] = { kind: 'done', text: sent.label + ' was recorded: its receipt was found by its key (' + summary(r.result) + ' · recorded ' + when(r.created_at) + '). It was not resent.' };
        afterward(sent, isObject(r.result) ? r.result : null, true);
        return false;
      }).catch(function (err) {
        if (dead(g, p)) return true;
        if (ownerLost(err)) { host.concealed(err); return true; }
        if (err && err.status === 404) {
          L.outcomes[slot] = { kind: 'unknown', command: sent, resend: true, text: sent.label + ': not recorded when its receipt was read (' + when(nowIso()) + '). It was not resent. Send the same command again: it carries the same key, so the store records it at most once. Or decide again from what is shown.' };
        } else {
          L.outcomes[slot] = { kind: 'unknown', command: sent, resend: false, receiptAgain: true, text: sent.label + ': the outcome is unknown and its receipt could not be read (' + failureWords(err) + '). It was not resent. Read the receipt again before deciding.' };
        }
        return false;
      });
    }
    function failureWords(err) {
      if (err && err.timeout) return 'no answer in time';
      if (err && err.malformed) return 'an unreadable answer';
      return err && err.status ? 'HTTP ' + err.status + (reasonOf(err) ? ' ' + reasonOf(err) : '') : 'the connection failed';
    }
    function resend(slot) {
      var o = L.outcomes[slot];
      if (!host.alive() || !o || !o.resend || !o.command || pending(slot)) return;
      transmit(o.command, true);
    }
    function receiptAgain(slot) {
      var o = L.outcomes[slot], g = gen;
      if (!host.alive() || !o || !o.receiptAgain || !o.command || pending(slot)) return;
      var sent = o.command;
      L.outcomes[slot] = { kind: 'pending', text: sent.label + ': reading its receipt again (key ' + sent.key.slice(0, 8) + '…).', command: sent };
      redraw();
      receipt(sent, g).then(function (gone) { if (gone || dead(g)) return; say(L.outcomes[slot].text); return readBack(slot, g); });
    }

    /* ---------- forms ---------- */
    function form(id) { return L.forms[id] || (L.forms[id] = {}); }
    function value(id, name, fallback) { var f = L.forms[id]; return f && has(f, name) ? f[name] : fallback; }
    function clearForm(id) { delete L.forms[id]; }
    /* Read every field of a form from the page into the model (an input event can be missed by a fast click). */
    function collect(pane, id) {
      if (!pane) return form(id);
      var f = form(id);
      Array.prototype.forEach.call(pane.querySelectorAll('[data-eup-league-input]'), function (el) {
        var key = el.getAttribute('data-eup-league-input'), at = key.indexOf('|');
        if (key.slice(0, at) === id) f[key.slice(at + 1)] = el.type === 'checkbox' ? el.checked === true : String(el.value == null ? '' : el.value);
      });
      return f;
    }
    var fid = function (id, name) { return 'eupL-' + (id + '-' + name).replace(/[^A-Za-z0-9_-]/g, '-'); };
    var fkey = function (id, name) { return 'league:' + id + '|' + name; };
    var inputAttrs = function (id, name) { return ' id="' + fid(id, name) + '" data-eup-league-input="' + esc(id + '|' + name) + '" data-eup-focus="' + esc(fkey(id, name)) + '"'; };
    /* Every field is one cell: its label, its control and, when there is one, a hint the control names with
       aria-describedby (read by a screen reader, visible without hover). A textarea cell spans the form. */
    var hintId = function (id, name) { return fid(id, name) + '-hint'; };
    function cell(id, name, inner, o, wide) {
      return '<div class="cr-eup-league__cell' + (wide ? ' cr-eup-league__cell--wide' : '') + '">' + inner + (o && o.hint ? '<p class="cr-eup-league__hint" id="' + hintId(id, name) + '">' + esc(o.hint) + '</p>' : '') + '</div>';
    }
    var described = function (id, name, o) { return o && o.hint ? ' aria-describedby="' + hintId(id, name) + '"' : ''; };
    function textField(id, name, label, fallback, o) {
      o = o || {};
      return cell(id, name, '<label class="cr-eup__field" for="' + fid(id, name) + '"><span>' + esc(label) + '</span><input type="text"' + inputAttrs(id, name) + described(id, name, o) +
        (o.max ? ' maxlength="' + o.max + '"' : '') + (o.numeric ? ' inputmode="numeric" pattern="[0-9]*"' : '') + ' autocomplete="off"' + (o.spell === false ? ' spellcheck="false" autocapitalize="off"' : '') +
        ' value="' + esc(value(id, name, fallback == null ? '' : fallback)) + '"></label>', o, false);
    }
    function areaField(id, name, label, fallback, o) {
      o = o || {};
      return cell(id, name, '<label class="cr-eup__field" for="' + fid(id, name) + '"><span>' + esc(label) + '</span><textarea rows="' + (o.rows || 3) + '"' + inputAttrs(id, name) + described(id, name, o) + (o.max ? ' maxlength="' + o.max + '"' : '') + '>' +
        esc(value(id, name, fallback == null ? '' : fallback)) + '</textarea></label>', o, true);
    }
    function checkField(id, name, label, fallback) {
      return '<label class="cr-eup-league__check" for="' + fid(id, name) + '"><input type="checkbox"' + inputAttrs(id, name) + (value(id, name, !!fallback) === true ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
    }
    function selectField(id, name, label, fallback, options) {
      var v = value(id, name, fallback == null ? '' : fallback);
      return cell(id, name, '<label class="cr-eup__field" for="' + fid(id, name) + '"><span>' + esc(label) + '</span><select' + inputAttrs(id, name) + '>' +
        options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>', null, false);
    }

    /* ---------- small renderers ---------- */
    var note = function (kind, text) { return host.note(kind, text); };
    var chip = function (kind, text, attr) { return '<span class="cr-eup__chip cr-eup__chip--' + esc(kind) + '"' + (attr || '') + '>' + esc(text) + '</span>'; };
    var code = function (v, id) { return '<code class="cr-eup-league__id"' + (id ? ' id="' + esc(id) + '"' : '') + '>' + esc(v == null ? 'none' : v) + '</code>'; };
    /* an element id made of a record id (the heading that names a campaign or mission, a grant's account) */
    var rid = function (kind, id) { return 'eupL-' + kind + '-' + String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '-'); };
    var line = function (text, attr) { return '<p class="cr-eup__unit-line"' + (attr || '') + '>' + esc(text) + '</p>'; };
    function cmdButton(action, id, arg, label, slot, extra) {
      return '<button type="button" class="cr-btn" data-eup-league-command="' + esc(action) + '" data-eup-league-id="' + esc(id || '') + '" data-eup-league-arg="' + esc(arg || '') +
        '" data-eup-focus="league:cmd:' + esc(action + ':' + (id || '') + ':' + (arg || '')) + '"' + (pending(slot) ? ' aria-disabled="true"' : '') + (extra || '') + '>' + esc(label) + '</button>';
    }
    function doButton(what, id, label, extra) {
      return '<button type="button" class="cr-btn" data-eup-league-do="' + esc(what) + '" data-eup-league-id="' + esc(id || '') + '" data-eup-focus="league:do:' + esc(what + ':' + (id || '')) + '"' + (extra || '') + '>' + esc(label) + '</button>';
    }
    var actions = function (html) { return html ? '<div class="cr-eup__actions">' + html + '</div>' : ''; };
    /* An outcome's words; away (a sentence) replaces "Read back below" when the record is not listed below. */
    function outcomeText(o, away) { return away ? String(o.text).replace(/ Read back below\.$/, '') + ' ' + away : o.text; }
    function outcome(slot, away) {
      var o = L.outcomes[slot];
      if (!o) return '';
      return '<p class="cr-eup__note cr-eup__note--' + esc(o.kind) + '" tabindex="-1" data-eup-note="' + esc(o.kind) + '" data-eup-league-outcome="' + esc(slot + ':' + o.kind) + '" data-eup-focus="league:outcome:' + esc(slot) + '">' + esc(outcomeText(o, away)) + '</p>' +
        (o.resend && o.command ? actions(doButton('resend', slot, 'Send the same command again')) + line('It carries the same key, so the store records it at most once.') : '') +
        (o.receiptAgain && o.command ? actions(doButton('receipt', slot, 'Read the receipt again')) : '');
    }
    function readNote(err, what) {
      if (err && err.malformed) return note('error', 'The answer for ' + what + ' was not readable; nothing from it is shown.');
      var r = host.reasonFor(err), reason = reasonOf(err);
      if (reason === 'schema_not_applied') return note(r.kind, 'The League schema is not applied (pending SQL), so ' + what + ' cannot be read. Nothing is shown.');
      if (r.kind === 'unavailable') return note(r.kind, 'Unavailable (' + err.status + (reason ? ' ' + reason : '') + '): ' + what + ' could not be read. Nothing from this read is shown; read again.');
      return note(r.kind, r.text);
    }
    function readState(name) {
      var what = READS[name].what;
      if (L.errors[name]) return readNote(L.errors[name], what);
      if (!has(L.data, name)) return note('loading', 'Reading ' + what + '…');
      return null;
    }
    function recordState(kind, id) {
      var rec = L.records[kind + ':' + id];
      if (!rec) return null;
      if (rec.error) return readNote(rec.error, RECORD_READS[kind].what);
      if (rec.data === undefined) return note('loading', 'Reading ' + RECORD_READS[kind].what + '…');
      return null;
    }
    function index() {
      var missions = {}, campaigns = {}, assignments = {};
      (Array.isArray(L.data.campaigns) ? L.data.campaigns : []).forEach(function (c) {
        if (!isObject(c)) return;
        campaigns[c.id] = c;
        (Array.isArray(c.missions) ? c.missions : []).forEach(function (m) { if (isObject(m)) missions[m.id] = { mission: m, campaign: c }; });
      });
      (Array.isArray(L.data.assignments) ? L.data.assignments : []).forEach(function (a) { if (isObject(a)) assignments[a.id] = a; });
      return { missions: missions, campaigns: campaigns, assignments: assignments, campaignsRead: Array.isArray(L.data.campaigns) };
    }
    /* The views a filter narrows: the record kind each lists (its outcome slots are '<kind>:<id>') and its filter. */
    var FILTERED = { applications: { kind: 'application', label: 'status', title: 'Application' }, proofs: { kind: 'proof', label: 'state', title: 'Proof' }, appeals: { kind: 'appeal', label: 'state', title: 'Appeal' } };
    function awayNote(view) {
      var f = L.filters[view];
      return f ? 'It no longer matches the filter (' + FILTERED[view].label + ' ' + words(f) + '), so it is not listed below: choose all and Show to see it.' : 'It is not among the rows the Worker returned, so it is not listed below.';
    }
    /* The sentence for an outcome whose record the current view's list does not hold, or null. */
    function awayOf(slot) {
      var spec = FILTERED[L.view];
      if (!spec || String(slot).indexOf(spec.kind + ':') !== 0 || !Array.isArray(L.data[L.view])) return null;
      var id = String(slot).slice(spec.kind.length + 1);
      return L.data[L.view].some(function (r) { return isObject(r) && r.id === id; }) ? null : awayNote(L.view);
    }
    /* Each such outcome at the top of the view, with its resend or receipt buttons, where focus can land on it. */
    function awayBlock(view) {
      var spec = FILTERED[view];
      return Object.keys(L.outcomes).filter(function (slot) { return awayOf(slot) !== null; }).map(function (slot) {
        return '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-away="' + esc(slot) + '"><h3>' + esc(spec.title) + ' ' + code(slot.slice(spec.kind.length + 1)) + '</h3>' + outcome(slot, awayOf(slot)) + '</article>';
      }).join('');
    }
    function missionName(ix, id) {
      var hit = ix.missions[id];
      return hit ? hit.mission.title + ' · ' + hit.campaign.title : (ix.campaignsRead ? 'Mission ' + id + ' (not in the campaign list)' : 'Mission ' + id + ' (missions not read)');
    }

    /* ---------- module state line (from the Overview read; no request of its own) ---------- */
    function moduleLine() {
      var u = typeof host.moduleUnit === 'function' ? host.moduleUnit() : null;
      var st = u && u.installed === true && ['enabled', 'draining', 'disabled'].indexOf(u.state) >= 0 ? u.state : u && u.installed === false ? 'not_installed' : 'unknown';
      var rev = st !== 'unknown' && st !== 'not_installed' && isInt(u.revision) ? ' (rev ' + u.revision + ')' : '';
      var text = {
        enabled: 'League module: enabled' + rev + '. The server checks the module state again on every command.',
        draining: 'League module: draining' + rev + '. New work is stopped; reads, withdrawals, revocations, pauses, holds and purges stay open.',
        disabled: 'League module: disabled' + rev + '. New work is stopped; reads, withdrawals, revocations, pauses, holds and purges stay open.',
        not_installed: 'League module: not installed. Install and enable it in Overview › Modules; until then every League command is refused.',
        unknown: 'League module state: not read on this page (Overview › Modules shows it). The server checks it on every command either way.'
      }[st];
      return '<p class="cr-eup__unit-line" data-eup-league-module="' + st + '">' + esc(text) + '</p>';
    }

    /* ================================================================== Setup */
    function policyCard() {
      var s = readState('policy');
      var head = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-policy><h3>League policy</h3>';
      if (s) return head + s + '</article>';
      var pol = L.data.policy, stored = isInt(pol.revision) && pol.revision > 0 && isObject(pol.document);
      var defaults = stored ? policyForm(pol.document) : {}, F = 'policy';
      var v = function (name) { return has(defaults, name) ? defaults[name] : ''; };
      var meta = stored
        ? 'Revision ' + pol.revision + ' · ' + (pol.valid === true ? 'valid' : 'NOT valid: every member action answers "not configured" until a valid policy is saved') + ' · saved ' + when(pol.updated_at) + (pol.updated_by ? ' by ' + pol.updated_by : '') + '.'
        : 'No League policy is stored. Nothing ships a default: every value below is yours to enter. Until a valid policy is saved, nobody can take part.';
      var notice = function (k, label, hint) {
        return '<fieldset class="cr-eup-league__set"><legend>' + esc(label) + '</legend>' + line(hint) +
          textField(F, k + '_revision', 'Revision label', v(k + '_revision'), { max: 64, spell: false, hint: 'A new label asks people to agree again.' }) +
          areaField(F, k + '_text', 'Text', v(k + '_text'), { rows: 4, max: LIMITS.text.notice_text }) + '</fieldset>';
      };
      return head + '<p class="cr-eup__unit-line" data-eup-league-policy-revision="' + esc(isInt(pol.revision) ? pol.revision : 'unknown') + '">' + esc(meta) + '</p>' +
        line('Configuration only. Whether the League runs at all is its module policy (Overview › Modules), a separate fact.') +
        '<div class="cr-eup-league__form">' +
        selectField(F, 'entitlement', 'Entitlement', v('entitlement'), [['', 'Choose…'], ['none_required', 'None required: taking part is still decided by your approval of each application'], ['not_decided', 'Not decided: nobody can take part yet']]) +
        '<fieldset class="cr-eup-league__set"><legend>Media</legend>' +
        checkField(F, 'media_enabled', 'Members may upload audio or video for proofs', defaults.media_enabled) +
        checkField(F, 'kind_audio', 'Audio', defaults.kind_audio) + checkField(F, 'kind_video', 'Video', defaults.kind_video) +
        textField(F, 'audio_max_bytes', 'Largest audio file (bytes)', v('audio_max_bytes'), { numeric: true, max: 9 }) +
        textField(F, 'video_max_bytes', 'Largest video file (bytes)', v('video_max_bytes'), { numeric: true, max: 9, hint: 'From 1 to ' + LIMITS.policy.bytes[1] + ' bytes, the private bucket\'s object limit: a cap can only be lower.' }) +
        textField(F, 'max_duration_seconds', 'Longest take (seconds)', v('max_duration_seconds'), { numeric: true, max: 4, hint: 'From 1 to ' + LIMITS.policy.duration_seconds[1] + '. Declared by the member\'s device and enforced while recording; the server does not measure it.' }) +
        '</fieldset><fieldset class="cr-eup-league__set"><legend>Retention</legend>' +
        textField(F, 'completed_days', 'Keep media of completed work (days)', v('completed_days'), { numeric: true, max: 4 }) +
        textField(F, 'withdrawn_days', 'Keep media of withdrawn work (days)', v('withdrawn_days'), { numeric: true, max: 4, hint: 'From 1 to ' + LIMITS.policy.retention_days[1] + ' days. After that the media is due and the Retention view can purge it.' }) +
        '</fieldset>' +
        notice('participation', 'Participation notice', 'Accepted together with a mission\'s requirements.') +
        notice('private_review', 'Private review notice', 'Agreed when a participant submits a proof for private review.') +
        notice('publication', 'Publication notice', 'Agreed when a participant consents to publication to the campaign\'s released audience.') +
        textField(F, 'reason', 'Reason for this change (required, kept with the revision)', '', { max: LIMITS.text.policy_reason }) +
        '</div>' + actions(cmdButton('policy.set', '', '', stored ? 'Save as revision ' + (pol.revision + 1) : 'Save the first League policy', 'policy')) + outcome('policy') + '</article>';
    }
    function fixtureCard() {
      var s = readState('fixture');
      var head = '<article class="cr-eup__card" data-eup-league-fixture><h3>Draft catalogue</h3>';
      if (s) return head + s + '</article>';
      var fx = L.data.fixture, missions = Array.isArray(fx.missions) ? fx.missions.filter(isObject) : [], F = 'campaign-new';
      return head + line('The owner\'s review kit: unpublished, unpriced, no points, no payment and no broadcast. Only the song mission can be released; the other four stay drafts.') +
        '<p><strong>' + esc(fx.title) + '</strong></p><p class="cr-eup-league__text">' + esc(fx.purpose) + '</p>' +
        '<ul class="cr-eup__list">' + missions.map(function (m) {
          return '<li data-eup-league-fixture-mission="' + esc(m.slug) + '"><strong>' + esc(m.title) + '</strong> ' + chip(ENUMS.RELEASABLE_TEMPLATES.indexOf(m.template) >= 0 ? 'current' : 'draft', ENUMS.RELEASABLE_TEMPLATES.indexOf(m.template) >= 0 ? 'can be released' : 'stays a draft') +
            '<br><small>template ' + esc(m.template) + ' · proof ' + esc((m.proof_modes || []).join(', ')) + '</small></li>';
        }).join('') + '</ul>' +
        '<h4>Create a campaign from it</h4><div class="cr-eup-league__form">' +
        textField(F, 'slug', 'Slug', fx.slug, { max: 80, spell: false, hint: 'Lower-case letters, digits and hyphens. A campaign is created as a draft for admin preview only.' }) +
        textField(F, 'title', 'Title', fx.title, { max: LIMITS.text.title }) +
        areaField(F, 'purpose', 'Purpose', fx.purpose, { rows: 4, max: LIMITS.text.purpose }) +
        '</div>' + actions(cmdButton('campaigns.create', '', '', 'Create the campaign as a draft', 'campaign:new')) + outcome('campaign:new') + '</article>';
    }
    var STATE_TEXT = { draft: 'Draft: house owners only.', released: 'Released: open to its audience.', paused: 'Paused: no new work; people keep reading their own records.', withdrawn: 'Withdrawn: final. Completed work and credits stay.' };
    var CASCADE = {
      campaign: 'Withdrawing is final. Every mission of this campaign is withdrawn: open applications are declined, offered and accepted assignments are withdrawn and every publication is withdrawn. Completed work and credits stay.',
      mission: 'Withdrawing is final. Open applications are declined, offered and accepted assignments are withdrawn and every publication of this mission is withdrawn. Completed work and credits stay.'
    };
    function transitionButtons(kind, row, slot, blockedRelease) {
      var targets = LIFECYCLE[row.state] || [], html = '', action = kind === 'campaign' ? 'campaigns.transition' : 'missions.transition';
      targets.forEach(function (to) {
        if (to === 'withdrawn') { if (!L.open['confirm:' + kind + ':' + row.id]) html += doButton('confirm', kind + ':' + row.id, 'Withdraw…'); return; }
        if (to === 'released' && blockedRelease) return;
        html += cmdButton(action, row.id, to, to === 'released' ? (row.state === 'paused' ? 'Release again' : 'Release') : 'Pause', slot);
      });
      var confirm = L.open['confirm:' + kind + ':' + row.id] ? '<div class="cr-eup-league__confirm" data-eup-league-confirm="' + esc(kind + ':' + row.id) + '">' + line(CASCADE[kind]) +
        actions(cmdButton(action, row.id, 'withdrawn', 'Withdraw for good', slot) + doButton('cancel', kind + ':' + row.id, 'Keep it')) + '</div>' : '';
      return actions(html) + confirm;
    }
    function campaignCard(c, fixture) {
      var ok = validId(c.id), slot = 'campaign:' + c.id, missions = Array.isArray(c.missions) ? c.missions.filter(isObject) : [];
      var html = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-campaign="' + esc(c.id) + '" data-eup-league-status="' + esc(c.state) + '" aria-labelledby="' + rid('campaign', c.id) + '">' +
        '<h3 id="' + rid('campaign', c.id) + '">' + esc(c.title || c.slug || c.id) + '</h3><p>' + chip(c.state || 'unknown', words(c.state)) + ' ' + chip(c.audience === 'invited' ? 'current' : 'draft', c.audience === 'invited' ? 'invited' : 'admin preview') +
        ' <small>' + esc(c.slug || '') + (isInt(c.revision) ? ' · rev ' + c.revision : '') + (c.created_at ? ' · created ' + esc(when(c.created_at)) : '') + '</small></p>';
      if (c.document && typeof c.document.purpose === 'string') html += '<p class="cr-eup-league__text">' + esc(c.document.purpose) + '</p>';
      if (!ok) return html + line('This record has no valid id; no command is offered for it.') + missions.map(function (m) { return '<p><strong>' + esc(m.title || m.id) + '</strong> · ' + esc(words(m.state)) + '</p>'; }).join('') + '</article>';
      html += '<h4>Lifecycle</h4>' + line(STATE_TEXT[c.state] || 'State ' + words(c.state) + '.') + transitionButtons('campaign', c, slot, false);
      if (c.state !== 'withdrawn') {
        html += '<h4>Audience</h4>' + line(c.audience === 'invited' ? 'Invited: house owners and accounts holding an open grant on this campaign. Nothing wider exists.' : 'Admin preview: house owners only. Nothing wider than invited exists.') +
          actions(cmdButton('campaigns.audience.set', c.id, c.audience === 'invited' ? 'admin_preview' : 'invited', c.audience === 'invited' ? 'Back to admin preview' : 'Open to invited accounts', slot));
      }
      html += outcome(slot);
      if (c.state !== 'withdrawn') html += grantsBlock(c);
      html += '<h4>Missions</h4>' + (missions.length ? missions.map(function (m) { return missionBlock(m, c); }).join('') : line('No mission yet.'));
      if (c.state !== 'withdrawn' && fixture) html += missionNewBlock(c, fixture);
      return html + '</article>';
    }
    function grantsBlock(c) {
      var rec = L.records['grants:' + c.id], s = recordState('grants', c.id), F = 'grant:' + c.id, slot = 'grants:' + c.id, list = rec && Array.isArray(rec.data) ? rec.data.filter(isObject) : null;
      return '<h4>Tester access</h4>' + line('A grant has effect only while the audience is invited and the campaign and mission are released. Revoking keeps the account\'s own records readable, and it can still withdraw, discard and revoke.') +
        (s || (list === null ? note('loading', 'Reading tester access…') : list.length ? '<ul class="cr-eup__list">' + list.map(function (g) {
          return '<li data-eup-league-grant="' + esc(g.id) + '" data-eup-league-status="' + esc(g.state) + '">' + code(g.account, rid('grant', g.id)) + ' ' + chip(g.state === 'open' ? 'current' : 'draft', words(g.state)) +
            '<br><small>' + (g.note ? esc(g.note) + ' · ' : '') + 'granted ' + esc(when(g.granted_at)) + (g.revoked_at ? ' · revoked ' + esc(when(g.revoked_at)) : '') + '</small>' +
            (g.state === 'open' && validId(g.id) ? actions(cmdButton('audience.grants.revoke', g.id, c.id, 'Revoke access', slot, ' aria-describedby="' + rid('grant', g.id) + '"')) : '') + '</li>';
        }).join('') + '</ul>' : line('No tester holds access to this campaign.'))) +
        '<div class="cr-eup-league__form">' + textField(F, 'account', 'Account id of the tester', '', { max: 36, spell: false }) + textField(F, 'note', 'Note (optional)', '', { max: LIMITS.text.note }) + '</div>' +
        actions(cmdButton('audience.grants.grant', c.id, '', 'Grant access', slot)) + outcome(slot);
    }
    function missionNewBlock(c, fixture) {
      var options = (Array.isArray(fixture.missions) ? fixture.missions : []).filter(isObject).map(function (m) { return [m.slug, m.title + (ENUMS.RELEASABLE_TEMPLATES.indexOf(m.template) >= 0 ? '' : ' (stays a draft)')]; });
      if (!options.length) return '';
      var F = 'mission-new:' + c.id, chosen = value(F, 'fixture', options[0][0]);
      return '<h4>Add a mission from the draft catalogue</h4><div class="cr-eup-league__form">' + selectField(F, 'fixture', 'Mission', chosen, options) +
        textField(F, 'slug', 'Slug', chosen, { max: 80, spell: false }) + '</div>' + actions(cmdButton('missions.create', c.id, '', 'Create the mission as a draft', 'mission-new:' + c.id)) + outcome('mission-new:' + c.id);
    }
    function missionBlock(m, c) {
      var ok = validId(m.id), slot = 'mission:' + m.id;
      var html = '<section class="cr-eup-league__mission" data-eup-league-mission="' + esc(m.id) + '" data-eup-league-status="' + esc(m.state) + '" aria-labelledby="' + rid('mission', m.id) + '"><h5 id="' + rid('mission', m.id) + '">' + esc(m.title || m.slug || m.id) + '</h5>' +
        '<p>' + chip(m.state || 'unknown', words(m.state)) + ' <small>template ' + esc(m.template || 'unknown') + (isInt(m.revision) ? ' · rev ' + m.revision : '') +
        (isInt(m.requirements_revision) ? ' · requirements revision ' + m.requirements_revision : '') + ' · seats ' + esc(isInt(m.assigned) ? m.assigned : 'unknown') + ' of ' + esc(isInt(m.capacity) ? m.capacity : 'no limit') +
        ' · proof ' + esc(Array.isArray(m.proof_modes) ? m.proof_modes.join(', ') : 'unknown') + '</small></p>';
      if (!ok) return html + line('This record has no valid id; no command is offered for it.') + '</section>';
      var blocked = null;
      if (LIFECYCLE[m.state] && LIFECYCLE[m.state].indexOf('released') >= 0) {
        if (ENUMS.RELEASABLE_TEMPLATES.indexOf(m.template) < 0) blocked = 'Only the song template has a frozen proof rule, so only it can be released; this mission stays a draft.';
        else if (c.state !== 'released') blocked = 'Release the campaign first: a mission is released only inside a released campaign.';
      }
      html += line(STATE_TEXT[m.state] || 'State ' + words(m.state) + '.') + (blocked ? line(blocked, ' data-eup-league-blocked="' + esc(m.id) + '"') : '') + transitionButtons('mission', m, slot, !!blocked);
      if (m.state !== 'withdrawn') html += actions(doButton('edit', m.id, L.open['edit:' + m.id] ? 'Close the editor' : 'Edit requirements, capacity and rubric', ' aria-expanded="' + !!L.open['edit:' + m.id] + '"') +
        doButton('preview', m.id, L.records['preview:' + m.id] ? 'Read the member preview again' : 'Show the member preview'));
      if (L.open['edit:' + m.id]) html += missionEditor(m, slot);
      html += outcome(slot) + previewCard(m.id);
      return html + '</section>';
    }
    function missionEditor(m, slot) {
      var F = 'mission:' + m.id, doc = isObject(m.document) ? m.document : {}, rubric = isObject(doc.rubric) ? doc.rubric : {};
      var allowed = TEMPLATE_RULES[m.template] ? TEMPLATE_RULES[m.template].modes_allowed : ENUMS.PROOF_MODES, modes = Array.isArray(m.proof_modes) ? m.proof_modes : [];
      return '<div class="cr-eup-league__editor" data-eup-league-editor="' + esc(m.id) + '">' +
        line('Requirements revision ' + (isInt(m.requirements_revision) ? m.requirements_revision : 'unknown') + '. Changing the title, requirements, acceptance, proof modes or rubric starts the next revision: everyone who accepted returns to offered and accepts again. Capacity alone does not.') +
        '<div class="cr-eup-league__form">' + textField(F, 'title', 'Title', doc.title || m.title, { max: LIMITS.text.title }) +
        areaField(F, 'requirements', 'Requirements', doc.requirements || '', { rows: 4, max: LIMITS.text.requirements }) +
        areaField(F, 'acceptance', 'Acceptance', doc.acceptance || '', { rows: 3, max: LIMITS.text.acceptance }) +
        textField(F, 'capacity', 'Capacity (seats; empty means no limit)', isInt(m.capacity) ? String(m.capacity) : '', { numeric: true, max: 6, hint: 'A capacity below the seats already taken is refused.' }) +
        '<fieldset class="cr-eup-league__set"><legend>Proof modes</legend>' + allowed.map(function (x) { return checkField(F, 'mode_' + x, words(x), modes.indexOf(x) >= 0); }).join('') + '</fieldset>' +
        areaField(F, 'rubric_application', 'Application criteria, one per line as "id: label"', rubricText(rubric.application), { rows: 3, hint: 'Every decision answers each criterion once; approval needs every one met.' }) +
        areaField(F, 'rubric_proof', 'Proof criteria, one per line as "id: label"', rubricText(rubric.proof), { rows: 3, hint: 'A mission pass needs every one met. At most ' + LIMITS.count.rubric_criteria + ' per list.' }) +
        '</div>' + actions(cmdButton('missions.update', m.id, '', 'Save mission changes', slot)) + '</div>';
    }
    function cardValue(field, v) {
      if (field === 'open') return v === true ? 'yes: members in the audience see it now' : 'no: members do not see it now';
      if (field === 'proof_modes') return Array.isArray(v) ? v.join(', ') : 'none';
      if (field === 'capacity') return isInt(v) ? String(v) : 'no limit';
      if (field === 'acceptance') return typeof v === 'string' ? v : 'none';
      if (field === 'rubric') {
        var r = isObject(v) ? v : {}, list = function (x) { return Array.isArray(x) && x.length ? x.map(function (c) { return c.label + ' (' + c.id + ')'; }).join('; ') : 'none'; };
        return 'application: ' + list(r.application) + ' · proof: ' + list(r.proof);
      }
      return v == null ? 'none' : String(v);
    }
    var CARD_LABEL = { title: 'Title', state: 'State', open: 'Open now', requirements_revision: 'Requirements revision', requirements: 'Requirements', acceptance: 'Acceptance', proof_modes: 'Proof', rubric: 'Rubric', capacity: 'Capacity', seats_taken: 'Seats taken', template: 'Template', slug: 'Slug', id: 'Mission id', campaign_id: 'Campaign id' };
    function previewCard(missionId) {
      var rec = L.records['preview:' + missionId];
      if (!rec) return '';
      var s = recordState('preview', missionId);
      if (s) return '<div class="cr-eup-league__preview" data-eup-league-preview="' + esc(missionId) + '"><h5>Member preview</h5>' + s + '</div>';
      var card = rec.data;
      return '<div class="cr-eup-league__preview" data-eup-league-preview="' + esc(missionId) + '"><h5>Member preview</h5>' +
        line('Exactly the card the member read answers for this mission: the server builds both from one projection.') +
        '<dl class="cr-eup-league__card">' + CARD_FIELDS.map(function (f) {
          return '<div><dt>' + esc(CARD_LABEL[f]) + '</dt><dd class="' + (f === 'requirements' || f === 'acceptance' ? 'cr-eup-league__text' : '') + '" data-eup-league-card-field="' + f + '" data-eup-league-card-value="' + esc(JSON.stringify(has(card, f) ? card[f] : null)) + '">' + esc(cardValue(f, card[f])) + '</dd></div>';
        }).join('') + '</dl>' + actions(doButton('preview-hide', missionId, 'Hide the member preview')) + '</div>';
    }
    function campaignsBlock() {
      var s = readState('campaigns');
      if (s) return '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-campaigns><h3>Campaigns</h3>' + s + '</article>';
      var list = L.data.campaigns.filter(isObject), fixture = isObject(L.data.fixture) ? L.data.fixture : null;
      if (!list.length) return '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-campaigns><h3>Campaigns</h3>' + note('empty', 'The Worker returned 0 campaigns. Create one from the draft catalogue.') + '</article>';
      return list.map(function (c) { return campaignCard(c, fixture); }).join('');
    }
    function viewSetup() { return '<div class="cr-eup__grid">' + policyCard() + fixtureCard() + campaignsBlock() + '</div>'; }

    /* ================================================================== Applications */
    function filterField(name, label) {
      var F = 'filter:' + name, options = FILTERS[name].map(function (v) { return [v, v ? words(v) : 'all']; });
      return '<div class="cr-eup-league__filter">' + selectField(F, 'value', label, L.filters[name], options) + actions(doButton('filter', name, 'Show')) + '</div>';
    }
    function rubricAnswers(F, criteria) {
      if (!criteria.length) return line('This mission has no criteria to answer.');
      return '<fieldset class="cr-eup-league__set"><legend>Criteria</legend>' + criteria.map(function (c) {
        return checkField(F, 'met:' + c.id, c.label + ' (' + c.id + '): met', false) + textField(F, 'note:' + c.id, 'Note on ' + c.id + ' (optional)', '', { max: LIMITS.text.note });
      }).join('') + '</fieldset>';
    }
    function answersFrom(f, criteria) {
      return criteria.map(function (c) {
        var a = { id: c.id, met: f['met:' + c.id] === true }, n = typeof f['note:' + c.id] === 'string' ? f['note:' + c.id].trim() : '';
        if (n) a.note = n;
        return a;
      });
    }
    function applicationCard(a, ix) {
      var slot = 'application:' + a.id, hit = ix.missions[a.mission_id], crit = hit ? criteriaOf(hit.mission, 'application') : null, F = 'decide:' + a.id;
      var doc = isObject(a.document) ? a.document : {}, decisions = Array.isArray(a.decisions) ? a.decisions.filter(isObject) : [];
      var html = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-application="' + esc(a.id) + '" data-eup-league-status="' + esc(a.status) + '"><h3>' + esc(missionName(ix, a.mission_id)) + '</h3>' +
        '<p>' + chip(a.status || 'unknown', words(a.status)) + ' <small>rev ' + esc(a.revision) + ' · requirements revision ' + esc(a.requirements_revision) + (a.recorded_by ? ' · recorded by a house owner' : '') + '</small></p>' +
        '<p class="cr-eup__unit-line">Applicant ' + code(a.applicant) + '</p>' +
        (typeof doc.statement === 'string' && doc.statement ? '<p class="cr-eup-league__text" data-eup-league-statement>' + esc(doc.statement) + '</p>' : line('No statement yet.'));
      if (a.accommodation_requested === true) html += accommodationBlock(a);
      if (decisions.length) html += '<h4>Decisions</h4><ul class="cr-eup__list">' + decisions.map(function (d) {
        var met = Array.isArray(d.rubric) ? d.rubric.filter(function (x) { return x && x.met === true; }).length + ' of ' + d.rubric.length + ' criteria met' : 'no criteria';
        return '<li>' + chip(d.decision || 'unknown', words(d.decision)) + ' <small>' + esc(met) + ' · requirements revision ' + esc(d.requirements_revision) + ' · ' + esc(when(d.decided_at)) + (d.decided_by ? ' · by ' + esc(d.decided_by) : '') + '</small>' +
          (d.reason ? '<br><span class="cr-eup-league__text">' + esc(d.reason) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
      if (a.status === 'submitted' && validId(a.id)) {
        if (crit === null) html += line('The mission and its criteria were not read, so no decision is offered. Read the view again.', ' data-eup-league-blocked="' + esc(a.id) + '"');
        else html += '<h4>Decide</h4><div class="cr-eup-league__form">' +
          selectField(F, 'decision', 'Decision', '', [['', 'Choose…'], ['approved', 'Approve: offer a seat'], ['changes_requested', 'Request changes'], ['declined', 'Decline']]) +
          rubricAnswers(F, crit) + areaField(F, 'reason', 'Reason (required unless you approve; the applicant reads it)', '', { rows: 3, max: LIMITS.text.reason }) +
          '</div>' + actions(cmdButton('applications.decide', a.id, '', 'Record the decision', slot));
      } else if (a.status !== 'submitted') html += line('Only a submitted application is decided.');
      return html + outcome(slot) + '</article>';
    }
    function accommodationBlock(a) {
      var rec = L.records['accommodation:' + a.id], s = rec ? recordState('accommodation', a.id) : null, html = '<h4>Accommodation request</h4>';
      if (!rec) return html + line('Requested. The text is restricted: each read is recorded with your account and the time, never the content.') + actions(doButton('accommodation', a.id, 'Read the accommodation request'));
      if (s) return html + s + actions(doButton('accommodation-hide', a.id, 'Close'));
      var r = rec.data, text = isObject(r.accommodation) && typeof r.accommodation.statement === 'string' ? r.accommodation.statement : null;
      return html + (text === null ? line('The applicant has no accommodation request on file now.') : '<p class="cr-eup-league__text" tabindex="-1" data-eup-focus="league:accommodation:' + esc(a.id) + '" data-eup-league-accommodation-text="' + esc(a.id) + '">' + esc(text) + '</p>') +
        line('Read ' + when(r.read_at) + '. This read was recorded with your account and the time, not the text. It is dropped from this page when you leave the view.') + actions(doButton('accommodation-hide', a.id, 'Close'));
    }
    function viewApplications() {
      var s = readState('applications'), ix = index();
      var head = filterField('applications', 'Status') + (L.errors.campaigns ? readNote(L.errors.campaigns, 'missions') : '');
      if (s) return head + '<div class="cr-eup__grid"><article class="cr-eup__card cr-eup__card--wide"><h3>Applications</h3>' + s + '</article></div>';
      var rows = L.data.applications.filter(isObject);
      return head + '<div class="cr-eup__grid">' + awayBlock('applications') + (rows.length ? rows.map(function (a) { return applicationCard(a, ix); }).join('') :
        '<article class="cr-eup__card cr-eup__card--wide"><h3>Applications</h3>' + note('empty', 'The Worker returned 0 applications' + (L.filters.applications ? ' with status ' + words(L.filters.applications) : '') + '.') + '</article>') + '</div>';
    }

    /* ================================================================== Proofs */
    function mediaList(media) {
      if (!Array.isArray(media) || !media.length) return line('No media: the accommodation path (a written statement) stands in for a recording, with equal standing.');
      return '<ul class="cr-eup__list">' + media.filter(isObject).map(function (m) {
        return '<li>' + esc(m.kind) + ' · ' + esc(m.mime) + ' · ' + esc(m.bytes) + ' bytes<br><small>fingerprint (SHA-256) ' + code(m.sha256) + '</small></li>';
      }).join('') + '</ul>';
    }
    function reviewsList(reviews) {
      reviews = Array.isArray(reviews) ? reviews.filter(isObject) : [];
      if (!reviews.length) return line('Not reviewed yet.');
      return '<h4>Reviews</h4><ul class="cr-eup__list">' + reviews.map(function (r) {
        return '<li data-eup-league-review="' + esc(r.id) + '">' + chip(r.decision || 'unknown', words(r.decision)) + ' <small>revision ' + esc(r.proof_revision) + ' · mission ' + esc(r.mission_decision) + ' · rights ' + esc(r.rights_decision) + ' · safety ' + esc(r.safety_decision) +
          ' · ' + esc(when(r.created_at)) + (r.reviewer ? ' · by ' + esc(r.reviewer) : '') + '</small>' + (r.reason ? '<br><span class="cr-eup-league__text">' + esc(r.reason) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    function proofHead(p, ix) {
      var a = ix.assignments[p.assignment_id], name = a ? missionName(ix, a.mission_id) : 'Assignment ' + p.assignment_id + (Array.isArray(L.data.assignments) ? ' (not in the assignment list)' : ' (assignments not read)');
      return '<h3>' + esc(name) + '</h3><p>' + chip(p.state || 'unknown', words(p.state), ' data-eup-league-proof-state="' + esc(p.state) + '"') + ' ' + chip(p.moderation_state === 'held' ? 'held' : 'current', p.moderation_state === 'held' ? 'held' : 'moderation clear') + ' ' +
        chip(p.publication_state === 'published_released_audience' ? 'current' : 'draft', p.publication_state === 'published_released_audience' ? 'published to the campaign audience' : words(p.publication_state)) +
        ' <small>revision ' + esc(p.revision) + (isInt(p.reviewed_revision) ? ' · reviewed revision ' + p.reviewed_revision : '') + '</small></p>' +
        '<p class="cr-eup__unit-line">Participant ' + code(p.participant) + '<br>Asset revision (fingerprint of the whole proof) ' + code(p.asset_revision) + '</p>';
    }
    function proofCard(p, ix) {
      var slot = 'proof:' + p.id, doc = isObject(p.document) ? p.document : {}, credit = (Array.isArray(L.data.credits) ? L.data.credits : []).filter(function (c) { return isObject(c) && c.proof_id === p.id; })[0];
      var open = L.review && L.review.proofId === p.id, F = 'moderate:' + p.id;
      var html = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-proof="' + esc(p.id) + '" data-eup-league-status="' + esc(p.state + ':' + p.moderation_state + ':' + p.publication_state) + '">' + proofHead(p, ix) +
        '<p><strong>' + esc(doc.title || 'Untitled') + '</strong></p>' + mediaList(p.media) + line('Not scanned: when each file was sealed its type and size were checked, never its safety. No malware scan exists.') + reviewsList(p.reviews);
      if (credit) html += '<p class="cr-eup__unit-line" data-eup-league-credit="' + esc(p.id) + '">Completion credit recorded ' + esc(when(credit.created_at)) + ' for revision ' + esc(credit.proof_revision) + ' (' + esc(credit.kind) + '). A private proof and an accommodation proof earn the identical credit; consent and publication never change it.</p>';
      if (!validId(p.id)) return html + line('This record has no valid id; no command is offered for it.') + '</article>';
      if (withdrawn(p, ix)) html += line('The participant withdrew from this mission. That revoked their private-review consent, so this proof is not reviewed and its media is not read.', ' data-eup-league-withdrawn="' + esc(p.id) + '"');
      else if (open) html += reviewPanel(p, ix);
      else if (p.state === 'submitted' && p.moderation_state !== 'held') html += actions(doButton('review', p.id, 'Open revision ' + p.revision + ' for review'));
      else if (p.state === 'submitted') html += line('Held: no review and no media read until the hold is released.');
      html += '<h4>Moderation</h4>' + line(p.moderation_state === 'held' ? 'Held: review, consent, publication and every signed media read are stopped.' : 'A hold stops exposure first: it withdraws a live publication and stops review and every signed media read until it is released.') +
        '<div class="cr-eup-league__form">' + textField(F, 'reason', p.moderation_state === 'held' ? 'Reason to release the hold (required)' : 'Reason for a hold (required)', '', { max: LIMITS.text.reason }) + '</div>' +
        actions(p.moderation_state === 'held' ? cmdButton('proofs.moderate', p.id, 'release', 'Release the hold', slot) : cmdButton('proofs.moderate', p.id, 'hold', 'Hold', slot));
      return html + outcome(slot) + '</article>';
    }
    function reviewPanel(p, ix) {
      var R = L.review, slot = 'proof:' + p.id, F = 'review:' + p.id;
      var html = '<section class="cr-eup-league__review" tabindex="-1" data-eup-focus="league:review:' + esc(p.id) + '" data-eup-league-review-panel="' + esc(p.id) + '" aria-label="Review of revision ' + esc(R.revision) + '"><h4>Review of revision ' + esc(R.revision) + '</h4>';
      if (R.loading) return html + note('loading', 'Opening revision ' + R.revision + ' and its media…') + '</section>';
      if (R.error) return html + readNote(R.error, 'the proof under review') + actions(doButton('review', p.id, 'Open the current revision') + doButton('review-close', p.id, 'Close')) + '</section>';
      var proof = R.proof, doc = isObject(proof.document) ? proof.document : {}, rights = isObject(doc.rights) ? doc.rights : {}, uploads = Array.isArray(proof.uploads) ? proof.uploads.filter(isObject) : [];
      var a = ix.assignments[proof.assignment_id], hit = a ? ix.missions[a.mission_id] : null, crit = hit ? criteriaOf(hit.mission, 'proof') : null;
      html += (R.expired ? '<p class="cr-eup__note cr-eup__note--timeout" data-eup-note="timeout" data-eup-league-expired="' + esc(p.id) + '">The ' + esc(R.seconds) + '-second media link expired and was dropped. Open the media again to keep listening.</p>' + actions(doButton('review', p.id, 'Open the media again')) : '');
      html += (R.media.length ? R.media.map(function (m, i) {
        var up = uploads.filter(function (u) { return u.id === m.upload_id; })[0];
        return '<div class="cr-eup-league__media"><p><strong>' + esc(m.kind) + ' ' + (i + 1) + '</strong> · ' + esc(m.mime) + ' · ' + esc(m.bytes) + ' bytes</p>' +
          (R.expired ? '' : '<div class="cr-eup-league__player" data-eup-league-player="' + esc(m.upload_id) + '"></div>') +
          '<p class="cr-eup__unit-line">Fingerprint (SHA-256) ' + code(m.sha256) + '</p>' +
          '<p class="cr-eup__unit-line" data-eup-league-scan="' + esc(m.upload_id) + '">' + (up && up.scan_state === 'not_scanned' ? 'Not scanned' : 'Scan state ' + esc(up ? up.scan_state : 'not returned') + ': not scanned') + ': the type and size were checked when it was sealed, never its safety.</p></div>';
      }).join('') + (R.expired ? '' : line('Played through a link that lasts ' + R.seconds + ' seconds. It is held only by this page\'s memory and the player, and is dropped when you leave the view.')) : '') +
        (isObject(doc.accommodation) ? '<h5>Accommodation path</h5><p class="cr-eup-league__text" data-eup-league-proof-accommodation>' + esc(doc.accommodation.statement) + '</p>' + line('A written statement stands in for a recording, with equal standing and the same credit.') : '') +
        '<h5>' + esc(doc.title || 'Untitled') + '</h5><p class="cr-eup-league__text" data-eup-league-lyrics>' + esc(doc.lyrics || '') + '</p>' +
        '<h5>Credits</h5><ul class="cr-eup__list">' + (Array.isArray(doc.credits) ? doc.credits : []).filter(isObject).map(function (c) { return '<li>' + esc(c.name) + ' · ' + esc(c.role) + '</li>'; }).join('') + '</ul>' +
        '<h5>Rights declaration (' + esc(rights.version || 'unknown') + ')</h5><ul class="cr-eup__list" data-eup-league-rights>' +
        [['owns_master', 'Owns the master recording'], ['controls_composition', 'Controls the composition'], ['samples_cleared', 'Samples cleared'], ['collaborators_cleared', 'Collaborators cleared'], ['parody_or_derivative', 'Parody or derivative work']].map(function (r) {
          return '<li>' + esc(r[1]) + ': ' + (rights[r[0]] === true ? 'yes' : rights[r[0]] === false ? 'no' : 'not stated') + '</li>';
        }).join('') + (rights.derivative_permissions ? '<li>Derivative permissions: <span class="cr-eup-league__text">' + esc(rights.derivative_permissions) + '</span></li>' : '') + '</ul>' +
        line('A declaration, not a verdict: your rights decision judges it.');
      if (crit === null) return html + line('The mission and its criteria were not read, so no review is offered. Read the view again.') + actions(doButton('review-close', p.id, 'Close the review')) + '</section>';
      var f = L.forms[F] || {}, out = reviewOutcome(f.mission, f.rights, f.safety);
      var opts = [['', 'Choose…'], ['pass', 'Pass'], ['changes', 'Changes needed'], ['fail', 'Fail']];
      html += '<h5>Decide on three dimensions</h5><div class="cr-eup-league__form">' + selectField(F, 'mission', 'Mission: does it do what the mission asks?', '', opts) + selectField(F, 'rights', 'Rights: does the declaration hold?', '', opts) +
        selectField(F, 'safety', 'Safety', '', opts) + rubricAnswers(F, crit) + areaField(F, 'reason', 'Reason (required unless all three pass; the participant reads it)', '', { rows: 3, max: LIMITS.text.reason }) + '</div>' +
        '<p class="cr-eup__unit-line" data-eup-league-outcome-preview="' + esc(out || 'none') + '">' + esc(out ? 'If recorded, the proof becomes ' + words(out) + (out === 'accepted' ? ' and one completion credit is written.' : '.') : 'Choose all three decisions: accepted only when all pass, rejected when any fails, otherwise changes needed.') + '</p>' +
        actions(cmdButton('proofs.review', p.id, '', 'Record the review of revision ' + R.revision, slot) + doButton('review-close', p.id, 'Close the review'));
      return html + '</section>';
    }
    function viewProofs() {
      var s = readState('proofs'), ix = index();
      var head = filterField('proofs', 'State') + (L.errors.assignments ? readNote(L.errors.assignments, 'assignments') : '') + (L.errors.credits ? readNote(L.errors.credits, 'credits') : '');
      if (s) return head + '<div class="cr-eup__grid"><article class="cr-eup__card cr-eup__card--wide"><h3>Proofs</h3>' + s + '</article></div>';
      var rows = L.data.proofs.filter(isObject);
      return head + '<div class="cr-eup__grid">' + awayBlock('proofs') + (rows.length ? rows.map(function (p) { return proofCard(p, ix); }).join('') :
        '<article class="cr-eup__card cr-eup__card--wide"><h3>Proofs</h3>' + note('empty', 'The Worker returned 0 proofs' + (L.filters.proofs ? ' in state ' + words(L.filters.proofs) : '') + '.') + '</article>') + '</div>';
    }

    /* ================================================================== Consent and publication */
    function consentLine(k) {
      return '<li data-eup-league-consent="' + esc(k.id) + '" data-eup-league-status="' + esc(k.state) + '">' + chip(k.state === 'open' ? 'current' : k.state === 'expired' ? 'stale' : 'draft', words(k.purpose) + ': ' + words(k.state)) +
        ' <small>audience ' + esc(words(k.audience)) + ' · revision ' + esc(k.proof_revision) + ' · notice ' + esc(k.notice_revision) + ' · granted ' + esc(when(k.granted_at)) + (k.expires_at ? ' · expires ' + esc(when(k.expires_at)) : '') +
        (k.revoked_at ? ' · revoked ' + esc(when(k.revoked_at)) : '') + (k.superseded_at ? ' · superseded ' + esc(when(k.superseded_at)) : '') + '</small></li>';
    }
    function publicationLine(b) {
      return '<li data-eup-league-publication="' + esc(b.id) + '" data-eup-league-status="' + esc(b.state + ':' + (b.withdrawn_reason || '')) + '">' + chip(b.state === 'published' && b.effective === true ? 'current' : 'draft', b.state === 'published' ? (b.effective === true ? 'published · effective' : 'published · not effective now') : 'withdrawn' + (b.withdrawn_reason ? ': ' + words(b.withdrawn_reason) : '')) +
        ' <small>revision ' + esc(b.proof_revision) + ' · published ' + esc(when(b.published_at)) + (b.withdrawn_at ? ' · withdrawn ' + esc(when(b.withdrawn_at)) : '') + '</small></li>';
    }
    function publicationCard(p, ix) {
      var slot = 'publication:' + p.id, F = 'publication:' + p.id;
      var rec = L.records['consents:' + p.id], unread = recordState('consents', p.id), list = rec && !rec.error && Array.isArray(rec.data) ? rec.data : null;
      var consents = (list || []).filter(function (k) { return isObject(k) && k.proof_id === p.id; }), capped = !!list && list.length >= LIMITS.list.rows;
      var pubs = (Array.isArray(L.data.publications) ? L.data.publications : []).filter(function (b) { return isObject(b) && b.proof_id === p.id; });
      var usable = consents.filter(function (k) { return k.purpose === 'publish_proof' && k.state === 'open' && k.proof_revision === p.revision && k.asset_revision === p.asset_revision; })[0];
      var html = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-publication-card="' + esc(p.id) + '" data-eup-league-status="' + esc(p.publication_state) + '">' + proofHead(p, ix) +
        '<h4>Consents</h4>' + (list ? (consents.length ? '<ul class="cr-eup__list">' + consents.map(consentLine).join('') + '</ul>' : line('No consent recorded for this proof.')) +
          (capped ? line('This list came back at its cap of ' + LIMITS.list.rows + ' rows, oldest first: later consents may not be shown.') : '') : unread || note('loading', 'Reading consents…')) +
        '<h4>Publications</h4>' + (L.data.publications ? (pubs.length ? '<ul class="cr-eup__list">' + pubs.map(publicationLine).join('') + '</ul>' : line('Never published.')) : readState('publications'));
      if (!validId(p.id)) return html + line('This record has no valid id; no command is offered for it.') + '</article>';
      if (p.publication_state === 'published_released_audience') {
        html += '<div class="cr-eup-league__form">' + textField(F, 'reason', 'Reason to withdraw the publication (required)', '', { max: LIMITS.text.note }) + '</div>' + actions(cmdButton('publications.decide', p.id, 'withdrawn', 'Withdraw the publication', slot));
      } else {
        var why = p.state !== 'accepted' ? 'Only an accepted proof is published.' : p.moderation_state === 'held' ? 'Held: release the hold first.' :
          !list ? 'Consents were not read, so publication is not offered.' :
          !usable && capped ? 'The consent list of this proof came back at its cap, so an open consent may not be shown; publication is not offered from it.' :
          !usable ? 'No open publication consent from the participant for this exact revision and fingerprint. A consent is theirs to give; it publishes nothing by itself.' : null;
        html += why ? line(why, ' data-eup-league-blocked="' + esc(p.id) + '"') : line('The participant consented to this exact revision and fingerprint until ' + when(usable.expires_at) + '. Publishing is still your separate decision.') +
          actions(cmdButton('publications.decide', p.id, 'published:' + usable.id, 'Publish to the campaign\'s released audience', slot));
      }
      return html + outcome(slot) + '</article>';
    }
    function viewPublication() {
      var s = readState('proofs'), ix = index();
      var head = line('Publication means visible to the campaign\'s released audience only. Nothing here is public. A consent publishes nothing; publishing is your separate decision, and revoking a consent withdraws its publication at once.') +
        (L.errors.publications ? readNote(L.errors.publications, 'publications') : '');
      if (s) return head + '<div class="cr-eup__grid"><article class="cr-eup__card cr-eup__card--wide"><h3>Accepted proofs</h3>' + s + '</article></div>';
      var rows = L.data.proofs.filter(publishable);
      return head + '<div class="cr-eup__grid">' + (rows.length ? rows.map(function (p) { return publicationCard(p, ix); }).join('') :
        '<article class="cr-eup__card cr-eup__card--wide"><h3>Accepted proofs</h3>' + note('empty', 'No accepted proof yet: only accepted work can be published.') + '</article>') + '</div>';
    }

    /* ================================================================== Appeals */
    function appealCard(x) {
      var slot = 'appeal:' + x.id, F = 'resolve:' + x.id;
      var html = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-appeal="' + esc(x.id) + '" data-eup-league-status="' + esc(x.state) + '"><h3>Appeal against ' + (x.subject === 'proof' ? 'a proof decision' : 'an application decision') + '</h3>' +
        '<p>' + chip(x.state === 'open' ? 'stale' : 'draft', words(x.state)) + ' <small>opened ' + esc(when(x.created_at)) + (x.resolved_at ? ' · resolved ' + esc(when(x.resolved_at)) : '') + '</small></p>' +
        '<p class="cr-eup__unit-line">' + esc(x.subject === 'proof' ? 'Proof' : 'Application') + ' ' + code(x.subject_id) + '<br>Appellant ' + code(x.appellant) + '</p>' +
        (typeof x.statement === 'string' ? '<p class="cr-eup-league__text">' + esc(x.statement) + '</p>' : '') +
        (x.resolution_reason ? '<p class="cr-eup__unit-line">Resolution: <span class="cr-eup-league__text">' + esc(x.resolution_reason) + '</span></p>' : '');
      if (x.state === 'open' && validId(x.id)) {
        html += '<div class="cr-eup-league__form">' + selectField(F, 'outcome', 'Outcome', '', [['', 'Choose…'], ['upheld', 'Uphold: the decision stands'], ['overturned', 'Overturn: back to submitted for a new decision']]) +
          areaField(F, 'reason', 'Reason (required; the appellant reads it)', '', { rows: 3, max: LIMITS.text.reason }) + '</div>' + actions(cmdButton('appeals.resolve', x.id, '', 'Resolve the appeal', slot));
      }
      return html + outcome(slot) + '</article>';
    }
    function viewAppeals() {
      var s = readState('appeals');
      var head = filterField('appeals', 'State') + line('Overturned: a declined application returns to submitted, or a rejected proof returns to submitted at the same revision, for a new decision. Upheld changes nothing else. Nobody resolves their own appeal.');
      if (s) return head + '<div class="cr-eup__grid"><article class="cr-eup__card cr-eup__card--wide"><h3>Appeals</h3>' + s + '</article></div>';
      var rows = L.data.appeals.filter(isObject);
      return head + '<div class="cr-eup__grid">' + awayBlock('appeals') + (rows.length ? rows.map(appealCard).join('') : '<article class="cr-eup__card cr-eup__card--wide"><h3>Appeals</h3>' + note('empty', 'The Worker returned 0 appeals' + (L.filters.appeals ? ' in state ' + words(L.filters.appeals) : '') + '.') + '</article>') + '</div>';
    }

    /* ================================================================== Retention */
    function viewRetention() {
      var s = readState('due'), pol = L.data.policy, slot = 'purge';
      var retention = isObject(pol) && isObject(pol.document) && isObject(pol.document.retention) ? pol.document.retention : null;
      var head = '<article class="cr-eup__card cr-eup__card--wide" data-eup-league-retention><h3>Retention</h3>' +
        (L.errors.policy ? readNote(L.errors.policy, 'the League policy') : line(retention ? 'From the League policy: media of completed work is kept ' + retention.completed_days + ' days, of withdrawn work ' + retention.withdrawn_days + ' days.' : 'No valid League policy: only discarded, rejected and expired uploads can be due.'));
      if (s) return '<div class="cr-eup__grid">' + head + s + '</article></div>';
      var due = L.data.due, rows = Array.isArray(due.uploads) ? due.uploads.filter(isObject) : [], ready = rows.filter(function (u) { return u.due === true && validId(u.id); }).slice(0, LIMITS.list.purge_batch);
      var html = head + (due.retention_evaluated === false ? line('Retention dates were not evaluated (no valid policy); only the reasons that need no policy were computed.') : '') +
        (rows.length ? '<ul class="cr-eup__list">' + rows.map(function (u) {
          return '<li data-eup-league-due="' + esc(u.id) + '" data-eup-league-status="' + esc(u.state + ':' + (u.reason || '')) + '">' + esc(u.kind) + ' upload ' + code(u.id) + ' ' + chip(u.due === true ? 'stale' : 'draft', u.due === true ? 'due' : 'not due') +
            '<br><small>state ' + esc(words(u.state)) + (u.reason ? ' · reason ' + esc(words(u.reason)) : '') + ' · due ' + esc(when(u.due_at)) + '</small></li>';
        }).join('') + '</ul>' : note('empty', 'Nothing is due.'));
      if (ready.length) {
        html += L.open['confirm:purge'] ? '<div class="cr-eup-league__confirm" data-eup-league-confirm="purge">' + line('Deleting stored media cannot be undone. The record of what existed (its fingerprint and size) is kept, and a publication bound to purged media is withdrawn in the same step.') +
          actions(cmdButton('media.purged', '', ready.map(function (u) { return u.id; }).join(','), 'Purge ' + ready.length + ' due upload' + (ready.length === 1 ? '' : 's') + ' for good', slot) + doButton('cancel', 'purge', 'Keep them')) + '</div>' :
          actions(doButton('confirm', 'purge', 'Purge ' + ready.length + ' due upload' + (ready.length === 1 ? '' : 's') + '…'));
      }
      return '<div class="cr-eup__grid">' + html + outcome(slot) + '</article></div>';
    }

    /* ================================================================== the pane */
    var VIEW_RENDER = { setup: viewSetup, applications: viewApplications, proofs: viewProofs, publication: viewPublication, appeals: viewAppeals, retention: viewRetention };
    /* true while any read of this view (or a record read) is still on its way: the panel says so with aria-busy */
    function busy() {
      return L.loadingView === true || Object.keys(L.loading).some(function (k) { return L.loading[k] === true; }) ||
        Object.keys(L.records).some(function (k) { return L.records[k] && L.records[k].loading === true; }) || !!(L.review && L.review.loading);
    }
    function render() {
      return '<div class="cr-eup-league" data-eup-league="' + esc(L.view) + '">' + moduleLine() +
        '<div class="cr-eup-league__tabs" role="tablist" aria-label="League views" data-eup-league-tabs>' + VIEWS.map(function (v) {
          var on = v.id === L.view;
          return '<button type="button" role="tab" id="eupLeagueTab-' + v.id + '" aria-controls="eupLeagueView" aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '" data-eup-league-tab="' + v.id + '" data-eup-focus="league-tab:' + v.id + '">' + esc(v.label) + '</button>';
        }).join('') + '</div><div class="cr-eup-league__view" id="eupLeagueView" role="tabpanel" aria-labelledby="eupLeagueTab-' + L.view + '" aria-busy="' + busy() + '" data-eup-league-view="' + L.view + '">' + VIEW_RENDER[L.view]() + '</div></div>';
    }

    /* ================================================================== commands from the page */
    var lastPane = null;
    function build(action, id, arg) {
      var c, f, p, text;
      switch (action) {
        case 'policy.set': {
          f = collect(lastPane, 'policy');
          var pol = L.data.policy, built = policyFromForm(f);
          if (!isObject(pol) || !isInt(pol.revision)) return refuse('policy', 'Save the League policy: the stored policy was not read, so its revision is unknown. Read the view again. Nothing was sent.');
          if (built.problem) return refuse('policy', 'Save the League policy: ' + built.problem + ' Nothing was sent.');
          text = typeof f.reason === 'string' ? f.reason.trim() : '';
          p = lineProblem(text, LIMITS.text.policy_reason, 1, 'A reason');
          if (p) return refuse('policy', 'Save the League policy: ' + p + ' Nothing was sent.', fkey('policy', 'reason'));
          return issue('policy', 'policy.set', '', { policy: built.document, reason: text }, pol.revision, function (r) { if (r) clearForm('policy'); });
        }
        case 'campaigns.create': {
          f = collect(lastPane, 'campaign-new');
          var fx = isObject(L.data.fixture) ? L.data.fixture : {}, slug = String(value('campaign-new', 'slug', fx.slug || '')).trim(), title = String(value('campaign-new', 'title', fx.title || '')).trim(), purpose = String(value('campaign-new', 'purpose', fx.purpose || ''));
          p = !PATTERNS.slug.test(slug) ? 'The slug is 2 to 80 lower-case letters, digits and hyphens, starting with a letter or digit.' : lineProblem(title, LIMITS.text.title, 1, 'The title') || linesProblem(purpose, LIMITS.text.purpose, 1, 'The purpose');
          if (p) return refuse('campaign:new', 'Create the campaign: ' + p + ' Nothing was sent.');
          return issue('campaign:new', 'campaigns.create', '', { campaign: { slug: slug, title: title, purpose: purpose } }, null, function (r) { if (r) clearForm('campaign-new'); });
        }
        case 'campaigns.transition': case 'campaigns.audience.set': {
          c = index().campaigns[id];
          if (!c) return;
          if (action === 'campaigns.transition' && (LIFECYCLE[c.state] || []).indexOf(arg) < 0) return;
          if (action === 'campaigns.audience.set' && ENUMS.AUDIENCES.indexOf(arg) < 0) return;
          return issue('campaign:' + id, action, id, action === 'campaigns.transition' ? { to: arg } : { audience: arg }, c.revision, function () { delete L.open['confirm:campaign:' + id]; });
        }
        case 'audience.grants.grant': {
          f = collect(lastPane, 'grant:' + id);
          var account = String(f.account || '').trim().toLowerCase(), gnote = String(f.note || '').trim();
          if (!PATTERNS.uuid.test(account)) return refuse('grants:' + id, 'Grant tester access: the account id is a uuid (8-4-4-4-12 hexadecimal). Nothing was sent.', fkey('grant:' + id, 'account'));
          if (gnote && (p = lineProblem(gnote, LIMITS.text.note, 1, 'The note'))) return refuse('grants:' + id, 'Grant tester access: ' + p + ' Nothing was sent.');
          return issue('grants:' + id, action, id, { grant: gnote ? { account: account, note: gnote } : { account: account } }, null, function (r) { if (r) clearForm('grant:' + id); });
        }
        case 'audience.grants.revoke':
          return issue('grants:' + arg, action, id, {}, null);
        case 'missions.create': {
          f = collect(lastPane, 'mission-new:' + id);
          var all = isObject(L.data.fixture) && Array.isArray(L.data.fixture.missions) ? L.data.fixture.missions.filter(isObject) : [];
          var pick = all.filter(function (m) { return m.slug === (f.fixture || (all[0] && all[0].slug)); })[0];
          var mslug = String(has(f, 'slug') ? f.slug : (pick && pick.slug) || '').trim();
          if (!pick) return refuse('mission-new:' + id, 'Create the mission: choose a mission of the draft catalogue. Nothing was sent.');
          if (!PATTERNS.slug.test(mslug)) return refuse('mission-new:' + id, 'Create the mission: the slug is 2 to 80 lower-case letters, digits and hyphens. Nothing was sent.');
          var mdoc = { slug: mslug, title: pick.title, template: pick.template, proof_modes: pick.proof_modes, requirements: pick.requirements };
          if (typeof pick.acceptance === 'string' && pick.acceptance) mdoc.acceptance = pick.acceptance;
          return issue('mission-new:' + id, action, id, { mission: mdoc }, null, function (r) { if (r) clearForm('mission-new:' + id); });
        }
        case 'missions.update': {
          var hit = index().missions[id];
          if (!hit) return;
          var changes = missionChanges(hit.mission, collect(lastPane, 'mission:' + id));
          if (changes.problem) return refuse('mission:' + id, 'Save mission changes: ' + changes.problem + ' Nothing was sent.');
          if (changes.nothing) return refuse('mission:' + id, 'Save mission changes: nothing differs from what is stored. Nothing was sent.');
          return issue('mission:' + id, action, id, { mission: changes.document }, hit.mission.revision, function (r) { if (r) { clearForm('mission:' + id); delete L.open['edit:' + id]; delete L.records['preview:' + id]; } });
        }
        case 'missions.transition': {
          var mh = index().missions[id];
          if (!mh || (LIFECYCLE[mh.mission.state] || []).indexOf(arg) < 0) return;
          return issue('mission:' + id, action, id, { to: arg }, mh.mission.revision, function () { delete L.open['confirm:mission:' + id]; delete L.records['preview:' + id]; });
        }
        case 'applications.decide': {
          var app = (L.data.applications || []).filter(function (a) { return isObject(a) && a.id === id; })[0], ix = index();
          var crit = app && ix.missions[app.mission_id] ? criteriaOf(ix.missions[app.mission_id].mission, 'application') : null;
          if (!app || crit === null) return;
          f = collect(lastPane, 'decide:' + id);
          var decision = f.decision, reason = typeof f.reason === 'string' ? f.reason : '', answers = answersFrom(f, crit);
          if (ENUMS.APPLICATION_DECISIONS.indexOf(decision) < 0) return refuse('application:' + id, 'Record the decision: choose approve, request changes or decline. Nothing was sent.', fkey('decide:' + id, 'decision'));
          if (decision === 'approved' && answers.some(function (x) { return !x.met; })) return refuse('application:' + id, 'Record the decision: approval needs every criterion met. Nothing was sent.');
          if (decision !== 'approved' && (p = linesProblem(reason, LIMITS.text.reason, 1, 'A reason'))) return refuse('application:' + id, 'Record the decision: ' + p + ' It is required unless you approve. Nothing was sent.', fkey('decide:' + id, 'reason'));
          for (var i = 0; i < answers.length; i += 1) if (answers[i].note && (p = lineProblem(answers[i].note, LIMITS.text.note, 1, 'The note on ' + answers[i].id))) return refuse('application:' + id, 'Record the decision: ' + p + ' Nothing was sent.');
          var body = { decision: decision };
          if (reason.trim()) { if ((p = linesProblem(reason, LIMITS.text.reason, 1, 'The reason'))) return refuse('application:' + id, 'Record the decision: ' + p + ' Nothing was sent.'); body.reason = reason; }
          if (crit.length) body.rubric = answers;
          return issue('application:' + id, action, id, body, app.revision, function (r) { if (r) clearForm('decide:' + id); });
        }
        case 'proofs.review': {
          var R = L.review;
          if (!R || R.proofId !== id || !isObject(R.proof)) return;
          var rx = index(), asg = rx.assignments[R.proof.assignment_id], pcrit = asg && rx.missions[asg.mission_id] ? criteriaOf(rx.missions[asg.mission_id].mission, 'proof') : null;
          if (pcrit === null) return;
          f = collect(lastPane, 'review:' + id);
          var out = reviewOutcome(f.mission, f.rights, f.safety), rreason = typeof f.reason === 'string' ? f.reason : '', ranswers = answersFrom(f, pcrit);
          if (!out) return refuse('proof:' + id, 'Record the review: choose pass, changes needed or fail for mission, rights and safety. Nothing was sent.');
          if (f.mission === 'pass' && ranswers.some(function (x) { return !x.met; })) return refuse('proof:' + id, 'Record the review: a mission pass needs every criterion met. Nothing was sent.');
          if (out !== 'accepted' && (p = linesProblem(rreason, LIMITS.text.reason, 1, 'A reason'))) return refuse('proof:' + id, 'Record the review: ' + p + ' It is required unless all three pass. Nothing was sent.', fkey('review:' + id, 'reason'));
          var review = { asset_revision: R.proof.asset_revision, mission_decision: f.mission, rights_decision: f.rights, safety_decision: f.safety };
          if (pcrit.length) review.rubric = ranswers;
          if (rreason.trim()) { if ((p = linesProblem(rreason, LIMITS.text.reason, 1, 'The reason'))) return refuse('proof:' + id, 'Record the review: ' + p + ' Nothing was sent.'); review.reason = rreason; }
          return issue('proof:' + id, action, id, { review: review }, R.revision, function (r, ok, reason) {
            if (ok || reason === 'revision_conflict' || reason === 'media_binding') { closeReview(); clearForm('review:' + id); }
          });
        }
        case 'proofs.moderate': {
          var proof = (L.data.proofs || []).filter(function (x) { return isObject(x) && x.id === id; })[0];
          if (!proof) return;
          f = collect(lastPane, 'moderate:' + id);
          var mreason = String(f.reason || '');
          if ((p = linesProblem(mreason, LIMITS.text.reason, 1, 'A reason'))) return refuse('proof:' + id, (arg === 'hold' ? 'Hold' : 'Release the hold') + ': ' + p + ' Nothing was sent.', fkey('moderate:' + id, 'reason'));
          return issue('proof:' + id, action, id, { hold: arg === 'hold', reason: mreason }, proof.revision, function (r) { if (r) { clearForm('moderate:' + id); if (arg === 'hold' && L.review && L.review.proofId === id) closeReview(); } });
        }
        case 'publications.decide': {
          var pr = (L.data.proofs || []).filter(function (x) { return isObject(x) && x.id === id; })[0];
          if (!pr) return;
          if (arg.indexOf('published:') === 0) {
            var consentId = arg.slice('published:'.length);
            if (!validId(consentId)) return;
            return issue('publication:' + id, action, id, { decision: 'published', consent_id: consentId }, pr.revision);
          }
          f = collect(lastPane, 'publication:' + id);
          var wreason = String(f.reason || '').trim();
          if ((p = lineProblem(wreason, LIMITS.text.note, 1, 'A reason'))) return refuse('publication:' + id, 'Withdraw the publication: ' + p + ' Nothing was sent.', fkey('publication:' + id, 'reason'));
          return issue('publication:' + id, action, id, { decision: 'withdrawn', reason: wreason }, pr.revision, function (r) { if (r) clearForm('publication:' + id); });
        }
        case 'appeals.resolve': {
          f = collect(lastPane, 'resolve:' + id);
          var outcomeName = f.outcome, areason = typeof f.reason === 'string' ? f.reason : '';
          if (ENUMS.APPEAL_OUTCOMES.indexOf(outcomeName) < 0) return refuse('appeal:' + id, 'Resolve the appeal: choose uphold or overturn. Nothing was sent.', fkey('resolve:' + id, 'outcome'));
          if ((p = linesProblem(areason, LIMITS.text.reason, 1, 'A reason'))) return refuse('appeal:' + id, 'Resolve the appeal: ' + p + ' Nothing was sent.', fkey('resolve:' + id, 'reason'));
          return issue('appeal:' + id, action, id, { outcome: outcomeName, reason: areason }, null, function (r) { if (r) clearForm('resolve:' + id); });
        }
        case 'media.purged': {
          var ids = String(arg || '').split(',').filter(validId);
          if (!ids.length || ids.length > LIMITS.list.purge_batch) return;
          return issue('purge', action, '', { uploads: ids }, null, function () { delete L.open['confirm:purge']; });
        }
      }
      return undefined;
    }
    function openReview(proofId) {
      var proof = (L.data.proofs || []).filter(function (x) { return isObject(x) && x.id === proofId; })[0];
      if (!proof || !validId(proofId) || !isInt(proof.revision)) return;
      closeReview();
      var g = gen, revision = proof.revision, sentAt = now();
      L.review = { proofId: proofId, revision: revision, loading: true };
      redraw();
      var p = host.request(routePath(RECORD_READS.review.path, proofId) + '?revision=' + revision);
      p.then(function (d) {
        var R = L.review;
        if (dead(g, p) || !R || R.proofId !== proofId || R.revision !== revision) return;
        var proofRead = answerOf(d, 'proof', false), media = d.media;
        if (proofRead.id !== proofId || proofRead.revision !== revision || !Array.isArray(media)) throw Object.assign(new Error('the review answer is not this revision'), { malformed: true });
        var seconds = null, got = [];
        media.forEach(function (m, i) {
          if (!isObject(m) || typeof m.url !== 'string' || !/^https:\/\//.test(m.url) || !(typeof m.expires_in === 'number' && m.expires_in > 0)) return;
          got.push({ upload_id: m.upload_id, kind: m.kind === 'video' ? 'video' : 'audio', url: m.url, label: (m.kind === 'video' ? 'Video ' : 'Audio ') + (i + 1) + ' of ' + media.length + ', revision ' + revision + ' under review' });
          seconds = seconds === null ? m.expires_in : Math.min(seconds, m.expires_in);
        });
        if (got.length !== media.length) throw Object.assign(new Error('a media link was not readable'), { malformed: true });
        L.review = { proofId: proofId, revision: revision, proof: proofRead, seconds: seconds === null ? 0 : seconds,
          media: media.map(function (m) { return { upload_id: m.upload_id, kind: m.kind, mime: m.mime, bytes: m.bytes, sha256: m.sha256 }; }) };
        if (seconds === null) return;
        /* counted from when the read was SENT: the store signed it later, so the page never holds a link past its
           life. An answer that arrives after that is never given to a player at all. */
        var left = sentAt + seconds * 1000 - now();
        var expired = 'The ' + seconds + '-second media link expired and was dropped. Open the media again to keep listening.';
        if (left <= 0) { L.review.expired = true; say(expired); return; }
        links = got;
        expiryTimer = setTimeout(function () {
          expiryTimer = null;
          if (dead(g) || !L.review || L.review.proofId !== proofId) return;
          dropLinks(); L.review.expired = true;
          say(expired); redraw();
        }, left);
      }).catch(function (err) {
        var R = L.review;
        if (dead(g, p) || !R || R.proofId !== proofId || R.revision !== revision) return;
        if (ownerLost(err)) { host.concealed(err); return; }
        dropLinks();
        L.review = { proofId: proofId, revision: revision, error: err };
      }).then(function () { if (dead(g, p)) return; redraw(); refocus('league:review:' + proofId); });
    }
    /* The media elements: made once per link, moved into their placeholder after every redraw so a redraw never stops
       playback (an element re-inserted in the same task is not paused). */
    function attachPlayers(pane) {
      if (!links.length) return;
      Array.prototype.forEach.call(pane.querySelectorAll('[data-eup-league-player]'), function (slot) {
        var id = slot.getAttribute('data-eup-league-player'), link = links.filter(function (l) { return l.upload_id === id; })[0];
        if (!link || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
        var el = players[id];
        if (!el) {
          el = document.createElement(link.kind);
          el.setAttribute('controls', '');
          el.setAttribute('preload', 'metadata');
          el.setAttribute('data-eup-league-media', id);
          el.setAttribute('data-eup-focus', 'league:media:' + id);
          el.setAttribute('aria-label', link.label);
          el.setAttribute('src', link.url);
          players[id] = el;
        }
        slot.appendChild(el);
      });
    }
    function ui(what, id) {
      switch (what) {
        case 'resend': return resend(id);
        case 'receipt': return receiptAgain(id);
        case 'edit': if (L.open['edit:' + id]) { delete L.open['edit:' + id]; clearForm('mission:' + id); } else L.open['edit:' + id] = true; return redraw();
        case 'preview': return recordRead('preview', id);
        case 'preview-hide': delete L.records['preview:' + id]; redraw(); return refocus('league:do:preview:' + id);
        case 'accommodation': return recordRead('accommodation', id).then(function () { refocus('league:accommodation:' + id); });
        case 'accommodation-hide': delete L.records['accommodation:' + id]; redraw(); return refocus('league:do:accommodation:' + id);
        /* a destructive step asks once; focus lands on the choice that keeps things as they are */
        case 'confirm': L.open['confirm:' + id] = true; redraw(); return focusKey('league:do:cancel:' + id);
        case 'cancel': delete L.open['confirm:' + id]; redraw(); return focusKey('league:do:confirm:' + id);
        case 'review': return openReview(id);
        case 'review-close': closeReview(); redraw(); return refocus('league:do:review:' + id);
        case 'filter': {
          var f = collect(lastPane, 'filter:' + id), v = String(f.value || '');
          if (FILTERS[id] && FILTERS[id].indexOf(v) >= 0) { L.filters[id] = v; if (id === 'proofs') closeReview(); return read(id); }
          return undefined;
        }
      }
      return undefined;
    }
    function selectView(id, focus) {
      if (!VIEWS.some(function (v) { return v.id === id; })) return;
      if (id !== L.view) { leave(); L.view = id; }
      redraw();
      if (focus) focusKey('league-tab:' + id);
      return load();
    }
    function wire(pane) {
      if (!pane) return;
      lastPane = pane;
      var all = function (sel) { return Array.prototype.slice.call(pane.querySelectorAll(sel)); };
      all('[data-eup-league-tab]').forEach(function (b) {
        b.onclick = function () { selectView(b.getAttribute('data-eup-league-tab'), false); };
        b.onkeydown = function (e) {
          var ids = VIEWS.map(function (v) { return v.id; }), i = ids.indexOf(L.view), to = null;
          if (e.key === 'ArrowRight') to = ids[(i + 1) % ids.length];
          if (e.key === 'ArrowLeft') to = ids[(i + ids.length - 1) % ids.length];
          if (e.key === 'Home') to = ids[0];
          if (e.key === 'End') to = ids[ids.length - 1];
          if (to) { if (e.preventDefault) e.preventDefault(); selectView(to, true); }
        };
      });
      all('[data-eup-league-input]').forEach(function (el) {
        var key = el.getAttribute('data-eup-league-input'), at = key.indexOf('|'), id = key.slice(0, at), name = key.slice(at + 1);
        el.oninput = el.onchange = function () {
          var before = form(id)[name];
          form(id)[name] = el.type === 'checkbox' ? el.checked === true : String(el.value == null ? '' : el.value);
          /* only a choice that changes another line redraws (the review outcome, the slug of a catalogue mission);
             typing never does */
          var follows = (id.indexOf('review:') === 0 && ['mission', 'rights', 'safety'].indexOf(name) >= 0) || (id.indexOf('mission-new:') === 0 && name === 'fixture');
          if (follows && before !== form(id)[name]) redraw();
        };
      });
      all('[data-eup-league-command]').forEach(function (b) {
        b.onclick = function () {
          if (b.getAttribute('aria-disabled') === 'true') return;
          build(b.getAttribute('data-eup-league-command'), b.getAttribute('data-eup-league-id'), b.getAttribute('data-eup-league-arg'));
        };
      });
      all('[data-eup-league-do]').forEach(function (b) { b.onclick = function () { ui(b.getAttribute('data-eup-league-do'), b.getAttribute('data-eup-league-id')); }; });
      attachPlayers(pane);
    }

    return {
      render: render, wire: wire, load: load, leave: function () { leave(); }, reset: reset,
      /* for the unit test only: what the view holds, never a link */
      inspect: function () { return { view: L.view, outcomes: L.outcomes, review: L.review, records: L.records, forms: L.forms, players: Object.keys(players).length, links: links.length }; }
    };
  }

  window.CR.eupLeague = {
    create: create,
    helpers: { PATTERNS: PATTERNS, LIMITS: LIMITS, ENUMS: ENUMS, TEMPLATE_RULES: TEMPLATE_RULES, LIFECYCLE: LIFECYCLE, COMMANDS: COMMANDS, READS: READS, RECORD_READS: RECORD_READS, CARD_FIELDS: CARD_FIELDS,
      VIEWS: VIEWS, VIEW_READS: VIEW_READS, PREFIX: PREFIX, policyProblem: policyProblem, policyForm: policyForm, policyFromForm: policyFromForm, parseRubric: parseRubric, rubricText: rubricText,
      missionChanges: missionChanges, reviewOutcome: reviewOutcome, commandFailure: commandFailure, ownerLost: ownerLost, summary: summary, lineProblem: lineProblem, linesProblem: linesProblem }
  };
})();
