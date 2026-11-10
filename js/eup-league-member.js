/* Environmental Justice League · member page (window.MCC_LEAGUE_MEMBER).

   A state machine over the League MEMBER contract (workers/mccluster/src/eup/league-contract.js,
   PREFIX.member = /v1/eup/member/league, served by workers/mccluster/src/eup/league-member.js). It creates no
   permission: every decision is the Worker's and the SQL's, made again on every request, and this page only shows
   what the last answer said. mount(container, opts) draws into ANY element, so the owner can place it on a page they
   name; action/league.html mounts it on its one [data-eup-league-member] element.

   What a visitor sees. Until GET /v1/eup/member/league answers ok:true, nothing but a neutral "not available" state:
   no League name in the heading, no campaign, no mission, no teaser (internal-only: not a customer product). Signed
   out (401) offers sign-in; another account (404) offers switching account; anything else offers trying again.

   Lifecycle (the Control module's rules, js/control-room/eup.js, plus the identity guard):
   - Every request is bounded (a deadline) and abortable, and is stamped with the epoch it started in; an answer that
     arrives in another epoch is dropped.
   - mcc:auth-changed, pageshow from the back-forward cache, and a stored session that is gone or names ANOTHER
     account bump the epoch and, synchronously: abort every request, stop every camera and microphone track, revoke
     every object URL, drop every signed media link, clear the private DOM and forget every unsent command. A stored
     session that is the SAME account with a refreshed token is not an account change and clears nothing.
   - A command captures the identity on screen when it is confirmed (the actor of the read the person is looking at,
     checked against the stored session at that moment). After the last token is acquired and immediately before the
     fetch, the token's account and the stored session's account must both still be that identity; otherwise nothing
     is sent and the page is cleared. A command without a captured identity throws before anything happens.
   - credentials omit, cache no-store, redirect error; an answer counts only with ok:true.
   - A write that times out, loses its connection or gets an answer this page cannot place shows "outcome unknown",
     then READS its receipt (GET receipts/<operation>/<key>): found means it was recorded; not found offers sending the
     same request again with the same key, by an explicit tap, under the same account only. Nothing is ever resent
     automatically.
   - The lyrics workspace autosaves (debounced, full replace, compare-and-swap on the draft revision). A conflict keeps
     the person's text on the page and asks which version to keep; an unknown save stops autosave until it is resolved.
   - Camera and microphone are asked for only inside the Record handler (js/eup-league-capture.js).
   - No League data, signed URL or upload grant is written to localStorage, sessionStorage or the console. A signed
     media link lives in memory and in the media element's src only, and is dropped at its expiry.
   Copy follows the owner's states (DECISIONS section 10): permission denied offers switching account, never paying;
   unconfigured explains and offers nothing to buy; draining or disabled says new work stopped while records,
   withdrawals and revocations stay open. Entitlement is never presented as something to purchase. */
(function (root) {
  'use strict';

  var API = 'https://api.mccluster.org';
  var PREFIX = '/v1/eup/member/league';
  var DEADLINE_MS = 15000;
  var AUTOSAVE_MS = 1200;
  /* contract limits (LIMITS.text / LIMITS.count / LIMITS.consent_max_days); the server checks them again */
  var MAX = { title: 180, lyrics: 10000, statement: 4000, credit_name: 120, credit_role: 80, derivative: 2000, credits: 24, media: 3, consent_days: 366 };
  var UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  var KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
  var TEXT_REFUSED = /[\u0000-\u001f\u007f]/;
  var LINES_REFUSED = /[\u0000-\u0008\u000b-\u001f\u007f]/;
  var SESSION_KEY = 'mccdb_session';
  var RIGHTS = [
    { id: 'owns_master', label: 'I own this recording (the master).' },
    { id: 'controls_composition', label: 'I control the song itself: its words and music.' },
    { id: 'samples_cleared', label: 'Any samples in it are cleared, or it has none.' },
    { id: 'collaborators_cleared', label: 'Everyone who worked on it agrees to this submission.' },
    { id: 'parody_or_derivative', label: 'It is a parody, or based on someone else’s work.' }
  ];
  var KIND_WORDS = { audio: 'audio', video: 'video', lyrics: 'lyrics', text: 'text', link: 'a link' };

  /* ------------------------------------------------------------------ pure helpers (window.MCC_LEAGUE_MEMBER.helpers) */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function codePoints(s) { var n = 0; for (var i = 0; i < s.length; i += 1) { var c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i += 1; } n += 1; } return n; }
  function when(iso) {
    if (!iso) return 'not recorded';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'an unreadable time';
    try { return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  function day(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'an unreadable date';
    try { return d.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  /* The account a bearer token names (its sub claim), lower case, or null. Reads the payload; verifies nothing. */
  function subOf(token) {
    if (typeof token !== 'string') return null;
    var part = token.split('.')[1];
    if (!part) return null;
    try {
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var claims = JSON.parse(decodeURIComponent(Array.prototype.map.call(root.atob(b64), function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
      return claims && typeof claims.sub === 'string' && UUID.test(claims.sub) ? claims.sub.toLowerCase() : null;
    } catch (e) { return null; }
  }
  /* The account of the session this browser holds right now (localStorage mccdb_session, as js/backend.js keeps it). */
  function storedIdentity() {
    try { var s = JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null'); return s && s.access_token ? subOf(s.access_token) : null; } catch (e) { return null; }
  }
  function storedToken() {
    try { var s = JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null'); return Promise.resolve(s && typeof s.access_token === 'string' ? s.access_token : null); } catch (e) { return Promise.resolve(null); }
  }
  /* The site's own token source: js/backend.js refreshes a token that is about to expire. */
  function defaultToken() {
    if (root.MCC_SUPA && typeof root.MCC_SUPA.token === 'function') return Promise.resolve(root.MCC_SUPA.token());
    if (root.MCC && typeof root.MCC.refreshIfNeeded === 'function') return Promise.resolve(root.MCC.refreshIfNeeded()).then(function (s) { return s && s.access_token ? s.access_token : null; });
    return storedToken();
  }
  function newKey() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return 'eul-' + root.crypto.randomUUID();
    throw new Error('This browser cannot make a secure request key, so it cannot send League commands.');
  }
  /* A field's problem in words, or null. multiline allows line feed and tab only (the contract's TEXT_RULES). */
  function textProblem(label, value, max, min, multiline) {
    var v = typeof value === 'string' ? value : '';
    if ((multiline ? LINES_REFUSED : TEXT_REFUSED).test(v)) return label + ' contains a control character the League does not accept; remove it.';
    var n = codePoints(v);
    if (n < (min || 0)) return min === 1 ? label + ' is empty.' : label + ' needs at least ' + min + ' characters.';
    if (n > max) return label + ' is ' + n + ' characters; the limit is ' + max + '.';
    return null;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* What a refusal means for a member, by the Worker's reason. Fixed text: an upstream message is never shown. */
  var REASONS = {
    not_available: 'Not available to your account now: the mission may be paused or closed, or this record changed. Your own records on this page are current.',
    authentication_required: 'Signed out. Sign in again to continue.',
    policy_unavailable: 'The League is not set up for this yet.',
    entitlement_required: 'Taking part is not open yet under the League’s current settings.',
    module_draining: 'New work is stopped while the League is draining. Your records, withdrawals and revocations stay open.',
    module_disabled: 'New work is stopped: the League is disabled. Your records, withdrawals and revocations stay open.',
    module_not_installed: 'The League is not available right now.',
    module_policy_unavailable: 'The League is not available right now.',
    module_policy_changed: 'The League’s settings changed while this was sent. You can send it again.',
    module_busy: 'The League is busy. You can send it again.',
    retry_conflict: 'Nothing was written. You can send it again.',
    revision_conflict: 'This changed somewhere else (another device or tab) since this page read it. The current version is shown below; decide again.',
    requirements_changed: 'The requirements or the notice changed. Read the current version below and accept it to continue.',
    media_binding: 'A take is not the one sealed for this work, or it is still in use. Check your takes below.',
    consent_scope: 'This consent does not match the work, its version, the current notice or the dates allowed.',
    moderation_hold: 'This work is on hold for review: publication and playback are paused.',
    rate_limited: 'A limit on how often this can be done was reached.',
    exists: 'This already exists.',
    idempotency_conflict: 'This request key was already used for something else.',
    invalid: 'The League did not accept the request as written.',
    field_refused: 'The League refused the request.',
    media_type_not_allowed: 'This kind of file is not accepted for this mission.',
    media_too_large: 'This file is larger than the League allows.',
    upload_missing: 'The file has not arrived in storage, so nothing was sealed.',
    upload_expired: 'This upload expired before it finished. Record or choose the file again.',
    media_changed: 'The stored file changed since it was sealed, so it is not played.',
    self_review_denied: 'Nobody reviews their own work.',
    capacity_exhausted: 'No seat is free.'
  };
  var MALFORMED_REQUEST = ['json_required', 'body_required', 'invalid_json', 'body_too_large', 'idempotency_key_required', 'expected_revision_required'];
  var UNKNOWN_503 = ['storage_unavailable', 'authorization_unavailable', 'unavailable'];
  var SEND_AGAIN = ['module_busy', 'module_policy_changed', 'retry_conflict'];
  var READ_AGAIN = ['revision_conflict', 'requirements_changed', 'not_available', 'media_binding', 'consent_scope', 'moderation_hold', 'exists'];
  var MODULE_NOTES = ['module_draining', 'module_disabled', 'module_not_installed', 'module_policy_unavailable'];

  /* classify(err): what a failed request means. settled: it certainly changed nothing; unknown: it may have. */
  function classify(err) {
    var e = err || {};
    if (e.identityChanged) return { identityChanged: true };
    if (e.stale || e.aborted) return { stale: true };
    if (e.status === 401) return { signedOut: true, settled: true, text: REASONS.authentication_required };
    if (e.timeout) return { unknown: true, why: 'no answer within ' + Math.round((e.deadline || DEADLINE_MS) / 1000) + ' s' };
    if (e.network) return { unknown: true, why: 'the connection failed before an answer arrived' };
    if (e.malformed) return { unknown: true, why: 'an answer this page could not read' };
    var reason = typeof e.reason === 'string' ? e.reason : '';
    if (e.status >= 500 && (e.status !== 503 || !reason || UNKNOWN_503.indexOf(reason) >= 0)) return { unknown: true, why: 'the League could not confirm it (HTTP ' + e.status + ')' };
    if (MALFORMED_REQUEST.indexOf(reason) >= 0) return { settled: true, reason: reason, text: 'The page sent a request the League could not read.' };
    var text = Object.prototype.hasOwnProperty.call(REASONS, reason) ? REASONS[reason] : 'Refused (HTTP ' + (e.status || '?') + (reason ? ' ' + reason : '') + ').';
    if (reason === 'invalid' && typeof e.message === 'string' && /:\s*\$/.test(e.message)) text += ' (' + e.message.slice(e.message.indexOf('$')) + ')';
    return { settled: true, reason: reason, text: text, again: SEND_AGAIN.indexOf(reason) >= 0, reread: READ_AGAIN.indexOf(reason) >= 0, module: MODULE_NOTES.indexOf(reason) >= 0 };
  }

  /* ------------------------------------------------------------------ transport: bounded, abortable, epoch-stamped, identity-guarded */
  function makeTransport(o) {
    var inflight = [];
    function failure(fields) { return Object.assign(new Error(fields.reason || (fields.timeout ? 'deadline' : 'request failed')), fields); }
    function send(req) {
      var mutation = req.method !== 'GET';
      if (mutation && !(typeof req.identity === 'string' && UUID.test(req.identity))) {
        throw new Error('A League command needs the identity captured when it was confirmed; nothing was sent.');
      }
      var ac = typeof AbortController === 'function' ? new AbortController() : null;
      if (ac) inflight.push(ac);
      var limit = req.deadline > 0 ? req.deadline : o.deadline();
      var settled = false, timer = null;
      var p = new Promise(function (resolve, reject) {
        timer = o.setTimeout(function () {
          if (settled) return;
          settled = true;
          if (ac) { try { ac.abort(); } catch (e) { /* done */ } }
          reject(failure({ timeout: true, deadline: limit }));
        }, limit);
        Promise.resolve().then(o.token).then(function (token) {
          if (o.epoch() !== req.epoch) throw failure({ stale: true });
          if (!token) throw failure({ status: 401, reason: 'authentication_required' });
          var sub = subOf(token);
          /* the identity guard: after the last token acquisition and immediately before the fetch */
          if (req.identity && (sub !== req.identity || o.currentIdentity() !== req.identity)) throw failure({ identityChanged: true });
          var headers = { authorization: 'Bearer ' + token, accept: 'application/json' };
          if (req.body !== undefined) headers['content-type'] = 'application/json';
          return o.fetch(o.api + req.path, {
            method: req.method, headers: headers, body: req.body === undefined ? undefined : JSON.stringify(req.body),
            credentials: 'omit', cache: 'no-store', redirect: 'error', mode: 'cors', signal: ac ? ac.signal : undefined
          }).then(function (r) {
            return r.text().then(function (text) {
              var data = null;
              try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
              if (!r.ok) throw failure({ status: r.status, reason: data && typeof data.reason === 'string' ? data.reason : null, message: data && typeof data.error === 'string' ? data.error : null });
              if (!data || data.ok !== true) throw failure({ status: r.status, malformed: true });
              return data;
            });
          }, function (err) {
            if (err && err.name === 'AbortError') throw failure({ aborted: true });
            throw failure({ network: true });
          });
        }).then(function (data) {
          if (settled) return;
          settled = true; resolve(data);
        }, function (err) {
          if (settled) return;
          settled = true; reject(err && (err.status || err.timeout || err.network || err.malformed || err.stale || err.aborted || err.identityChanged) ? err : failure({ network: true }));
        });
      });
      p.epoch = req.epoch;
      var done = function () { o.clearTimeout(timer); if (ac) inflight = inflight.filter(function (x) { return x !== ac; }); };
      p.then(done, done);
      return p;
    }
    send.abortAll = function () { var list = inflight; inflight = []; list.forEach(function (ac) { try { ac.abort(); } catch (e) { /* done */ } }); };
    send.inflight = function () { return inflight.length; };
    return send;
  }

  /* ------------------------------------------------------------------ model helpers */
  function freshModel() {
    return { phase: 'checking', unavailable: null, me: null, identity: null, readAt: null, readNote: null, outcomes: {}, sheet: null,
      work: {}, upload: null, players: {}, consentDates: {}, appealText: {}, moduleNote: null };
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function cardsOf(me) { var out = []; list(me && me.catalogue).forEach(function (c) { list(c.missions).forEach(function (m) { out.push({ campaign: c, mission: m }); }); }); return out; }
  function applicationFor(me, missionId) { return list(me && me.applications).filter(function (a) { return a.mission_id === missionId; })[0] || null; }
  function assignmentById(me, id) { return list(me && me.assignments).filter(function (a) { return a.id === id; })[0] || null; }
  function kindsFor(me, mission) {
    var media = me && me.policy && me.policy.media;
    if (!media || media.enabled !== true || !Array.isArray(media.kinds)) return [];
    var modes = list(mission && mission.proof_modes);
    return media.kinds.filter(function (k) { return modes.indexOf(k) >= 0; });
  }
  function capsFor(me) {
    var m = me && me.policy && me.policy.media;
    return { audio: m && typeof m.audio_max_bytes === 'number' ? m.audio_max_bytes : 0, video: m && typeof m.video_max_bytes === 'number' ? m.video_max_bytes : 0 };
  }
  function maxSecondsFor(me) { var m = me && me.policy && me.policy.media; return m && typeof m.max_duration_seconds === 'number' ? m.max_duration_seconds : null; }
  function notice(me, which) { var n = me && me.policy && me.policy.notices && me.policy.notices[which]; return n && typeof n.revision === 'string' ? n : null; }
  function blankCredit() { return { name: '', role: '' }; }
  /* The working copy of an assignment, from its saved draft (or its proof when no draft was saved). */
  function workFrom(a) {
    var saved = a && a.draft && a.draft.document && typeof a.draft.document === 'object' ? a.draft.document : null;
    var proofDoc = a && a.proof && a.proof.document && typeof a.proof.document === 'object' ? a.proof.document : null;
    var d = saved || proofDoc || {};
    var media = list(d.media).map(function (m) { return typeof m === 'string' ? m : (m && m.upload_id) || null; }).filter(function (x) { return typeof x === 'string'; });
    var credits = list(d.credits).map(function (c) { return { name: c && typeof c.name === 'string' ? c.name : '', role: c && typeof c.role === 'string' ? c.role : '' }; });
    var acc = d.accommodation && typeof d.accommodation === 'object' ? d.accommodation : null;
    return {
      revision: a && a.draft && typeof a.draft.revision === 'number' ? a.draft.revision : 0,
      doc: { title: typeof d.title === 'string' ? d.title : '', lyrics: typeof d.lyrics === 'string' ? d.lyrics : '', credits: credits.length ? credits : [blankCredit()],
        rights: d.rights && typeof d.rights === 'object' ? Object.assign({}, d.rights) : {}, media: media.slice(0, MAX.media), statement: acc && typeof acc.statement === 'string' ? acc.statement : '' },
      path: acc ? 'statement' : 'media', dirty: false, saving: false, again: false, status: a && a.draft ? 'saved' : 'empty', note: null, timer: null, command: null, open: false
    };
  }
  function draftDocument(w) {
    var rights = {};
    if (Object.keys(w.doc.rights).length) {
      rights.version = 'music-rights-v1';
      RIGHTS.forEach(function (r) { if (typeof w.doc.rights[r.id] === 'boolean') rights[r.id] = w.doc.rights[r.id]; });
      if (typeof w.doc.rights.derivative_permissions === 'string') rights.derivative_permissions = w.doc.rights.derivative_permissions;
    }
    var doc = { title: w.doc.title, lyrics: w.doc.lyrics, credits: w.doc.credits.slice(0, MAX.credits).map(function (c) { return { name: c.name, role: c.role }; }),
      media: w.doc.media.slice(0, MAX.media), accommodation: w.path === 'statement' ? { statement: w.doc.statement } : null };
    if (Object.keys(rights).length) doc.rights = rights;
    return doc;
  }
  /* Why the working copy cannot be saved as it stands (control characters, lengths), or []. */
  function draftProblems(w) {
    var p = [textProblem('The title', w.doc.title, MAX.title, 0, false), textProblem('The lyrics', w.doc.lyrics, MAX.lyrics, 0, true),
      w.path === 'statement' ? textProblem('The statement', w.doc.statement, MAX.statement, 0, true) : null,
      typeof w.doc.rights.derivative_permissions === 'string' ? textProblem('The permission note', w.doc.rights.derivative_permissions, MAX.derivative, 0, true) : null];
    w.doc.credits.forEach(function (c, i) { p.push(textProblem('Credit ' + (i + 1) + ' name', c.name, MAX.credit_name, 0, false), textProblem('Credit ' + (i + 1) + ' role', c.role, MAX.credit_role, 0, false)); });
    return p.filter(Boolean);
  }
  function sealedUploads(a) { return list(a && a.uploads).filter(function (u) { return u.state === 'sealed' && typeof u.sha256 === 'string'; }); }
  /* What is still missing before the proof can be submitted, in words (an empty list means it can be sent). */
  function proofProblems(me, a, w) {
    var p = [];
    if (!notice(me, 'private_review')) p.push('The League has no private review notice set yet, so nothing can be submitted.');
    var t = textProblem('The title', w.doc.title, MAX.title, 1, false); if (t) p.push(t);
    var l = textProblem('The lyrics', w.doc.lyrics, MAX.lyrics, 1, true); if (l) p.push(l);
    var credits = w.doc.credits.filter(function (c) { return c.name !== '' || c.role !== ''; });
    if (!credits.length) p.push('Add at least one credit: a name and a role.');
    credits.forEach(function (c, i) { var a1 = textProblem('Credit ' + (i + 1) + ' name', c.name, MAX.credit_name, 1, false), a2 = textProblem('Credit ' + (i + 1) + ' role', c.role, MAX.credit_role, 1, false); if (a1) p.push(a1); if (a2) p.push(a2); });
    var unanswered = RIGHTS.filter(function (r) { return typeof w.doc.rights[r.id] !== 'boolean'; });
    if (unanswered.length) p.push('Answer the ' + plural(unanswered.length, 'rights question', 'rights questions') + ' still open.');
    if (w.doc.rights.parody_or_derivative === true) { var dp = textProblem('The permission note', w.doc.rights.derivative_permissions || '', MAX.derivative, 1, true); if (dp) p.push(dp.replace(' is empty.', ' is required for a parody or derivative work.')); }
    if (w.path === 'statement') {
      var s = textProblem('The written statement', w.doc.statement, MAX.statement, 1, true); if (s) p.push(s);
    } else {
      var sealed = sealedUploads(a);
      var chosen = w.doc.media.filter(function (id) { return sealed.some(function (u) { return u.id === id; }); });
      if (!chosen.length) p.push('Add a sealed recording or file, or choose the written statement.');
      if (w.doc.media.length > chosen.length) p.push('A take listed for the submission is not sealed; remove it or wait for it to seal.');
    }
    return p;
  }
  function proofDocument(me, a, w) {
    var rights = { version: 'music-rights-v1' };
    RIGHTS.forEach(function (r) { rights[r.id] = w.doc.rights[r.id] === true; });
    rights.derivative_permissions = w.doc.rights.parody_or_derivative === true ? (w.doc.rights.derivative_permissions || '') : (typeof w.doc.rights.derivative_permissions === 'string' ? w.doc.rights.derivative_permissions : '');
    var proof = { title: w.doc.title, lyrics: w.doc.lyrics, credits: w.doc.credits.filter(function (c) { return c.name !== '' || c.role !== ''; }).map(function (c) { return { name: c.name, role: c.role }; }),
      rights: rights, review_notice_revision: notice(me, 'private_review').revision };
    if (w.path === 'statement') proof.accommodation = { statement: w.doc.statement };
    else {
      var sealed = sealedUploads(a);
      proof.media = w.doc.media.map(function (id) { var u = sealed.filter(function (x) { return x.id === id; })[0]; return u ? { upload_id: u.id, sha256: u.sha256 } : null; }).filter(Boolean);
    }
    return proof;
  }
  function publishConsent(proof) {
    return list(proof && proof.consents).filter(function (c) { return c.purpose === 'publish_proof' && (c.state === 'open' || c.state === 'expired'); })[0] || null;
  }
  /* The consent expiry the date input allows: from tomorrow to 365 days ahead (the contract allows 366), UTC. */
  function consentWindow(nowMs) {
    var d0 = new Date(nowMs); var start = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
    return { min: new Date(start + 86400000).toISOString().slice(0, 10), max: new Date(start + 365 * 86400000).toISOString().slice(0, 10) };
  }
  function consentExpiry(dateValue, nowMs) {
    if (typeof dateValue !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
    var w = consentWindow(nowMs);
    if (dateValue < w.min || dateValue > w.max) return null;
    return dateValue + 'T23:59:59Z';
  }

  var OPERATIONS = {
    'applications.save': 'Your application', 'applications.withdraw': 'Withdrawing your application', 'assignments.accept': 'Accepting the requirements',
    'assignments.withdraw': 'Withdrawing from the mission', 'drafts.save': 'Saving your draft', 'uploads.begin': 'Starting the upload', 'uploads.discard': 'Removing the take',
    'proofs.submit': 'Submitting for private review', 'consents.grant': 'Allowing publication', 'consents.revoke': 'Revoking your publication consent',
    'appeals.open': 'Your appeal', 'appeals.withdraw': 'Withdrawing your appeal'
  };

  /* ------------------------------------------------------------------ views (strings; mount() wires them) */
  function note(kind, text, extra) {
    var label = { pending: 'Sending', done: 'Done', refused: 'Not done', unknown: 'Outcome unknown', checking: 'Outcome unknown', info: 'Note', stopped: 'Stopped', saved: 'Saved' }[kind] || 'Note';
    return '<p class="eul-note eul-note--' + esc(kind) + '" data-eul-note="' + esc(kind) + '"' + (extra || '') + '><strong>' + esc(label) + ':</strong> ' + esc(text) + '</p>';
  }
  function outcomeBlock(model, slot) {
    var o = model.outcomes[slot];
    if (!o) return '';
    var html = note(o.kind, o.text, ' data-eul-outcome="' + esc(slot) + '"');
    if (o.resend && o.command) html += '<div class="eul-actions"><button type="button" class="eul-btn" data-eul-act="resend" data-slot="' + esc(slot) + '" data-eul-focus="resend:' + esc(slot) + '">Send the same request again</button></div><p class="eul-fine">It carries the same key, so the League records it at most once. Only this account can send it.</p>';
    else if (o.check && o.command) html += '<div class="eul-actions"><button type="button" class="eul-btn" data-eul-act="check" data-slot="' + esc(slot) + '" data-eul-focus="check:' + esc(slot) + '">Check again</button></div>';
    return html;
  }
  /* A button that may be refused: aria-disabled keeps it reachable, and the reason is text next to it. */
  function button(act, label, attrs, blockedReason, id) {
    var rid = blockedReason ? 'eulWhy-' + id : null;
    return '<button type="button" class="eul-btn' + (attrs.primary ? ' eul-btn--primary' : '') + '" data-eul-act="' + esc(act) + '"' + (attrs.data || '') + ' data-eul-focus="' + esc(attrs.focus || act) + '"' +
      (blockedReason ? ' aria-disabled="true" aria-describedby="' + esc(rid) + '"' : '') + '>' + esc(label) + '</button>' +
      (blockedReason ? '<span class="eul-why" id="' + esc(rid) + '">' + esc(blockedReason) + '</span>' : '');
  }
  function modesText(modes) {
    var m = list(modes);
    if (m.indexOf('lyrics') >= 0 && (m.indexOf('audio') >= 0 || m.indexOf('video') >= 0)) {
      var rec = m.filter(function (x) { return x === 'audio' || x === 'video'; }).map(function (x) { return KIND_WORDS[x]; });
      return 'Lyrics, with an ' + rec.join(' or ') + ' recording, or a written statement if you cannot record.';
    }
    return m.map(function (x) { return KIND_WORDS[x] || x; }).join(', ');
  }
  function seatsText(card) {
    if (card.capacity === null || card.capacity === undefined) return 'No seat limit.';
    return plural(card.seats_taken || 0, 'seat', 'seats') + ' of ' + card.capacity + ' taken.';
  }
  function missionBody(card) {
    return '<div class="eul-req"><h4>Requirements</h4><p class="eul-pre">' + esc(card.requirements) + '</p>' +
      (card.acceptance ? '<h4>How it is reviewed</h4><p class="eul-pre">' + esc(card.acceptance) + '</p>' : '') +
      '<p class="eul-fine">What you send: ' + esc(modesText(card.proof_modes)) + ' Requirements version ' + esc(card.requirements_revision) + '.</p></div>';
  }
  function readiness(me) {
    if (!me.policy) return 'The League is not set up for taking part yet. Your own records stay readable here.';
    if (me.policy.entitlement !== 'none_required') return 'Taking part is not open yet under the League’s current settings. Your own records stay readable here.';
    return null;
  }

  var APP_STATUS = { draft: 'Draft, not sent', submitted: 'Sent; waiting for a decision', changes_requested: 'Changes requested', approved: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn by you' };
  var ASSIGN_STATUS = { offered: 'Offered: accept the requirements to start', accepted: 'Accepted: working', completed: 'Completed', withdrawn: 'Withdrawn' };
  var PROOF_STATE = { submitted: 'Submitted privately; waiting for review', accepted: 'Accepted', needs_changes: 'Changes requested', rejected: 'Not accepted' };
  var DECISION_WORDS = { pass: 'pass', changes: 'changes needed', fail: 'does not pass' };
  var REJECT_WORDS = { empty: 'the stored file has no bytes', too_large: 'the stored file is larger than allowed', size_mismatch: 'the stored file is not the size that was announced', unrecognised: 'the stored bytes are not a known audio or video format', family_mismatch: 'the stored bytes are not the format the file was announced as' };
  var WITHDRAWN_WORDS = { owner: 'the League withdrew it', consent_revoked: 'you revoked your consent', moderation_hold: 'the work was put on hold', media_purged: 'its media was removed under the retention rules', assignment_withdrawn: 'the mission place was withdrawn', mission_withdrawn: 'the mission was withdrawn', campaign_withdrawn: 'the campaign was withdrawn' };

  function viewCatalogue(model) {
    var me = model.me, cards = cardsOf(me), blocked = readiness(me);
    if (!cards.length) return '<section class="eul-sec" aria-labelledby="eulCatH"><h2 id="eulCatH">Missions open to you</h2><p class="eul-muted">No mission is open to you right now.</p></section>';
    var html = '<section class="eul-sec" aria-labelledby="eulCatH"><h2 id="eulCatH">Missions open to you</h2>';
    list(me.catalogue).forEach(function (c) {
      html += '<div class="eul-campaign"><h3 class="eul-campaign__title">' + esc(c.title) + '</h3><p class="eul-pre eul-muted">' + esc(c.purpose) + '</p>';
      list(c.missions).forEach(function (m) {
        var app = applicationFor(me, m.id);
        var slot = 'app:' + m.id;
        html += '<article class="eul-card" data-eul-mission="' + esc(m.id) + '"><h3>' + esc(m.title) + '</h3><p class="eul-fine">' + esc(seatsText(m)) + '</p>' + missionBody(m) +
          '<div class="eul-actions">' + (app ? '<p class="eul-status">Your application: <strong>' + esc(APP_STATUS[app.status] || app.status) + '</strong>.</p>' +
            (['draft', 'submitted', 'changes_requested', 'withdrawn'].indexOf(app.status) >= 0 ? button('apply-open', app.status === 'withdrawn' ? 'Apply again' : app.status === 'submitted' ? 'Change application' : 'Continue application', { data: ' data-mission="' + esc(m.id) + '"', focus: 'apply:' + m.id }, blocked, 'apply-' + m.id) : '')
            : button('apply-open', 'Apply', { primary: true, data: ' data-mission="' + esc(m.id) + '"', focus: 'apply:' + m.id }, blocked, 'apply-' + m.id)) + '</div>' +
          (app ? '' : outcomeBlock(model, slot)) + '</article>'; // once an application exists, its outcome is shown on it
      });
      html += '</div>';
    });
    return html + '</section>';
  }

  function viewDecisions(decisions) {
    var d = list(decisions);
    if (!d.length) return '';
    return '<ul class="eul-list">' + d.map(function (x) {
      return '<li><strong>' + esc(APP_STATUS[x.decision] || x.decision) + '</strong> · ' + esc(when(x.decided_at)) + (x.reason ? '<br><span class="eul-pre">' + esc(x.reason) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function viewAppeals(model, subject, subjectId, appeals, canOpen) {
    var a = list(appeals), open = a.filter(function (x) { return x.state === 'open'; })[0];
    var html = a.length ? '<ul class="eul-list">' + a.map(function (x) {
      return '<li>Appeal ' + esc(x.state === 'open' ? 'open' : x.state) + ' · sent ' + esc(when(x.created_at)) + (x.resolution_reason ? '<br><span class="eul-pre">' + esc(x.resolution_reason) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '';
    if (open) html += '<div class="eul-actions">' + button('appeal-withdraw', 'Withdraw your appeal', { data: ' data-appeal="' + esc(open.id) + '"', focus: 'appeal-withdraw:' + open.id }, null, 'aw-' + open.id) + '</div>' + outcomeBlock(model, 'appeal-withdraw:' + open.id);
    else if (canOpen && a.length < 2) {
      var fid = 'eulAppeal-' + subjectId;
      html += '<label class="eul-field" for="' + fid + '"><span>Ask for this decision to be looked at again (what should be reconsidered)</span>' +
        '<textarea id="' + fid + '" rows="3" maxlength="4000" data-eul-bind="appeal" data-subject-id="' + esc(subjectId) + '" data-eul-focus="appeal:' + esc(subjectId) + '">' + esc(model.appealText[subjectId] || '') + '</textarea></label>' +
        '<div class="eul-actions">' + button('appeal-open', 'Send the appeal', { data: ' data-subject="' + esc(subject) + '" data-subject-id="' + esc(subjectId) + '"', focus: 'appeal-open:' + subjectId }, null, 'ao-' + subjectId) + '</div>';
    }
    return html + outcomeBlock(model, 'appeal:' + subjectId);
  }
  function viewApplications(model) {
    var apps = list(model.me.applications);
    if (!apps.length) return '';
    return '<section class="eul-sec" aria-labelledby="eulAppH"><h2 id="eulAppH">Your applications</h2>' + apps.map(function (app) {
      var m = app.mission || {};
      var withdrawable = ['draft', 'submitted', 'changes_requested'].indexOf(app.status) >= 0;
      var editable = ['draft', 'submitted', 'changes_requested', 'withdrawn'].indexOf(app.status) >= 0 && m.open === true;
      return '<article class="eul-card" data-eul-application="' + esc(app.id) + '"><h3>' + esc(m.title || 'Mission') + '</h3>' +
        '<p class="eul-status">Status: <strong>' + esc(APP_STATUS[app.status] || app.status) + '</strong> · last changed ' + esc(when(app.updated_at)) + (app.recorded ? ' · recorded for you by the League' : '') + '</p>' +
        (m.open === false ? '<p class="eul-muted">This mission is ' + esc(m.state === 'paused' ? 'paused' : m.state === 'withdrawn' ? 'withdrawn' : 'not open') + ': new work is stopped. Your record stays here.</p>' : '') +
        (app.accommodation_requested ? '<p class="eul-fine">You asked for an accommodation. Only the house owner deciding can read it, and each reading is recorded.</p>' : '') +
        viewDecisions(app.decisions) +
        '<div class="eul-actions">' + (editable ? button('apply-open', app.status === 'withdrawn' ? 'Apply again' : 'Open application', { data: ' data-mission="' + esc(app.mission_id) + '"', focus: 'apply:' + app.mission_id + ':own' }, null, 'ao-' + app.id) : '') +
        (withdrawable ? button('app-withdraw', 'Withdraw application', { data: ' data-application="' + esc(app.id) + '"', focus: 'app-withdraw:' + app.id }, null, 'aw-' + app.id) : '') + '</div>' +
        outcomeBlock(model, 'app:' + app.mission_id) + outcomeBlock(model, 'app-withdraw:' + app.id) +
        (app.status === 'declined' || list(app.appeals).length ? '<h4>Appeal</h4>' + viewAppeals(model, 'application', app.id, app.appeals, app.status === 'declined') : '') +
        '</article>';
    }).join('') + '</section>';
  }

  function viewOffer(model, a) {
    var me = model.me, m = a.mission || {}, n = notice(me, 'participation');
    var changed = a.accepted_requirements_revision !== null && a.accepted_requirements_revision !== undefined && a.accepted_requirements_revision !== m.requirements_revision;
    var blocked = readiness(me) || (m.open !== true ? 'This mission is not open right now, so it cannot be accepted. Your record stays here.' : null) || (!n ? 'The League has no participation notice set yet.' : null);
    return '<div class="eul-offer">' + (changed ? note('info', 'The requirements changed after you accepted them (you accepted version ' + a.accepted_requirements_revision + '; the current version is ' + m.requirements_revision + '). Read the current version and accept it to keep working. Your draft is kept.') : '') +
      missionBody(m) + (n ? '<div class="eul-notice"><h4>Participation notice</h4><p class="eul-pre">' + esc(n.text) + '</p><p class="eul-fine">Notice version ' + esc(n.revision) + '.</p></div>' : '') +
      '<div class="eul-actions">' + button('accept', changed ? 'Accept the current requirements' : 'Accept the requirements', { primary: true, data: ' data-assignment="' + esc(a.id) + '"', focus: 'accept:' + a.id }, blocked, 'acc-' + a.id) + '</div>' +
      outcomeBlock(model, 'accept:' + a.id) + '</div>';
  }

  function viewCapture(model, a, w, capture) {
    var me = model.me, kinds = kindsFor(me, a.mission), cs = capture && capture.aid === a.id ? capture.session.state : null;
    var up = model.upload && model.upload.aid === a.id ? model.upload : null;
    var canRecord = function (kind) { return kinds.indexOf(kind) >= 0 && typeof model.canRecord === 'function' && model.canRecord(kind); };
    var media = me.policy && me.policy.media && me.policy.media.enabled === true;
    var html = '<fieldset class="eul-choices"><legend>How will you send your song?</legend>' +
      '<p class="eul-fine">Each way is reviewed the same way and earns the same completion credit.</p><div class="eul-choice-row">';
    var busy = (cs && ['requesting', 'recording', 'stopping'].indexOf(cs.state) >= 0) || (up && up.phase !== 'done');
    ['audio', 'video'].forEach(function (kind) {
      if (kinds.indexOf(kind) < 0) return;
      if (canRecord(kind)) html += button('record', kind === 'audio' ? 'Record audio' : 'Record video', { data: ' data-assignment="' + esc(a.id) + '" data-kind="' + kind + '"', focus: 'record:' + kind + ':' + a.id }, busy ? 'Finish or cancel the current take first.' : null, 'rec-' + kind + '-' + a.id);
    });
    if (media && kinds.length) {
      html += '<label class="eul-btn eul-file" data-eul-focus-wrap><input type="file" class="eul-file__input" accept="' + esc(kinds.map(function (k) { return k + '/*'; }).join(',')) + '" data-eul-bind="file" data-assignment="' + esc(a.id) + '" data-eul-focus="file:' + esc(a.id) + '"' + (busy ? ' disabled' : '') + '><span>Upload a file</span></label>';
    }
    html += button('path', 'Write a statement instead', { data: ' data-assignment="' + esc(a.id) + '" data-path="statement"', focus: 'path:statement:' + a.id }, null, 'pst-' + a.id) + '</div>';
    if (!media) html += '<p class="eul-muted">Recording and file uploads are not switched on in the League right now. The written statement is open.</p>';
    else if (kinds.length && !kinds.some(canRecord)) html += '<p class="eul-muted">Recording is not available in this browser. Upload a file, or write a statement instead.</p>';
    html += '</fieldset>';
    if (cs) {
      if (cs.state === 'denied') html += note('refused', 'Camera or microphone permission was not given, so nothing was recorded. You can upload a file instead, or write a statement.');
      else if (cs.state === 'nodevice') html += note('refused', 'No camera or microphone was found. You can upload a file instead, or write a statement.');
      else if (cs.state === 'unsupported') html += note('refused', 'Recording is not available in this browser. You can upload a file instead, or write a statement.');
      else if (cs.state === 'error') html += note('refused', 'The recording stopped with an error, so nothing was kept. Try again, upload a file, or write a statement.');
      else if (cs.state === 'requesting') html += note('pending', 'Asking for the ' + (cs.kind === 'video' ? 'camera and microphone' : 'microphone') + '…');
      else if (cs.state === 'recording' || cs.state === 'stopping') {
        html += '<div class="eul-take" data-eul-recording>' + (cs.kind === 'video' ? '<video class="eul-camera" muted playsinline autoplay data-eul-live aria-label="Camera preview"></video>' : '') +
          '<p class="eul-rec"><span class="eul-rec__dot" aria-hidden="true"></span><strong>Recording</strong> <span data-eul-rec-time>' + esc(cs.seconds) + ' s</span>' + (cs.maxSeconds ? ' of at most ' + esc(cs.maxSeconds) + ' s' : '') + '</p>' +
          '<div class="eul-actions">' + button('stop', 'Stop', { primary: true, data: ' data-assignment="' + esc(a.id) + '"', focus: 'stop:' + a.id }, cs.state === 'stopping' ? 'Stopping…' : null, 'stop-' + a.id) +
          button('cancel-take', 'Cancel', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'cancel-take:' + a.id }, null, 'ct-' + a.id) + '</div></div>';
      } else if (cs.state === 'preview') {
        var uploading = up && (up.phase === 'begin' || up.phase === 'put' || up.phase === 'seal');
        html += '<div class="eul-take" data-eul-preview><h4>' + (cs.source === 'file' ? 'Your file' : 'Your take') + '</h4>' +
          (cs.kind === 'video' ? '<video class="eul-player" controls playsinline preload="metadata" data-eul-preview-player></video>' : '<audio class="eul-player" controls preload="metadata" data-eul-preview-player></audio>') +
          '<p class="eul-fine">' + esc((cs.source === 'file' && cs.name ? cs.name + ' · ' : '') + cs.kind + ' · ' + root.MCC_LEAGUE_CAPTURE.megabytes(cs.bytes) + (cs.seconds ? ' · ' + cs.seconds + ' s' : '')) + '. It stays on this device until you send it.</p>' +
          (uploading ? '<div class="eul-progress" data-eul-progress><label><span data-eul-progress-text>' + esc(up.phase === 'begin' ? 'Preparing the upload…' : up.phase === 'seal' ? 'Checking the stored file…' : 'Uploading: ' + up.pct + '%') + '</span>' +
            '<progress max="100" value="' + esc(up.pct) + '" data-eul-progress-bar></progress></label>' + (up.phase === 'put' ? '<div class="eul-actions">' + button('upload-cancel', 'Cancel the upload', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'upload-cancel:' + a.id }, null, 'uc-' + a.id) + '</div>' : '') + '</div>'
            : '<div class="eul-actions">' + button('use-take', cs.source === 'file' ? 'Send this file' : 'Send this take', { primary: true, data: ' data-assignment="' + esc(a.id) + '"', focus: 'use-take:' + a.id }, w.doc.media.length >= MAX.media ? 'At most three takes can be in one submission; remove one below first.' : null, 'ut-' + a.id) +
              (cs.source === 'recording' ? button('retake', 'Retake', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'retake:' + a.id }, null, 'rt-' + a.id) : '') +
              button('cancel-take', 'Cancel', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'cancel-take:' + a.id }, null, 'ct2-' + a.id) + '</div>') + '</div>';
      }
    }
    if (model.fileNote && model.fileNote.aid === a.id) html += note('refused', model.fileNote.text, ' data-eul-file-note');
    return html + outcomeBlock(model, 'upload:' + a.id);
  }

  function viewUploads(model, a, w) {
    var shown = list(a.uploads).filter(function (u) { return u.state === 'staged' || u.state === 'sealed' || u.state === 'rejected'; });
    var gone = list(a.uploads).length - shown.length;
    if (!shown.length && !gone) return '';
    var html = '<div class="eul-uploads"><h4>Your takes</h4>';
    if (shown.length) {
      html += '<ul class="eul-list">' + shown.map(function (u) {
        var chosen = w.doc.media.indexOf(u.id) >= 0, player = model.players[u.id];
        var line = '<li data-eul-upload="' + esc(u.id) + '" data-eul-upload-state="' + esc(u.state) + '"><strong>' + esc(u.kind === 'video' ? 'Video' : 'Audio') + '</strong> · ' + esc(u.mime) + ' · ' + esc(root.MCC_LEAGUE_CAPTURE.megabytes(u.bytes || u.declared_bytes || 0)) + ' · ';
        if (u.state === 'sealed') {
          line += 'Sealed ' + esc(when(u.sealed_at)) + '<br><span class="eul-fp">Fingerprint (SHA-256): <code data-eul-fingerprint>' + esc(u.sha256) + '</code></span>' +
            '<span class="eul-fine">The League checked the file’s type and size and fixed this fingerprint. That is not a malware scan.</span>';
          line += (u.kind === 'video' ? '<video class="eul-player" controls playsinline preload="none" data-eul-player="' + esc(u.id) + '"' + (player ? '' : ' hidden') + '></video>' : '<audio class="eul-player" controls preload="none" data-eul-player="' + esc(u.id) + '"' + (player ? '' : ' hidden') + '></audio>');
          line += '<div class="eul-actions">' + button('play', player ? 'Load again' : 'Play', { data: ' data-upload="' + esc(u.id) + '"', focus: 'play:' + u.id }, null, 'pl-' + u.id) +
            (w.path === 'media' ? '<label class="eul-check"><input type="checkbox" data-eul-bind="choose" data-assignment="' + esc(a.id) + '" data-upload="' + esc(u.id) + '" data-eul-focus="choose:' + esc(u.id) + '"' + (chosen ? ' checked' : '') + '><span>In my submission</span></label>' : '') +
            button('discard', 'Remove', { data: ' data-upload="' + esc(u.id) + '" data-assignment="' + esc(a.id) + '"', focus: 'discard:' + u.id }, null, 'dc-' + u.id) + '</div>';
        } else if (u.state === 'staged') {
          line += 'Waiting for the file to arrive<div class="eul-actions">' + button('complete', 'Check whether it arrived', { data: ' data-upload="' + esc(u.id) + '" data-assignment="' + esc(a.id) + '"', focus: 'complete:' + u.id }, null, 'cp-' + u.id) +
            button('discard', 'Remove', { data: ' data-upload="' + esc(u.id) + '" data-assignment="' + esc(a.id) + '"', focus: 'discard:' + u.id }, null, 'dc-' + u.id) + '</div>';
        } else {
          line += 'Not accepted: ' + esc(REJECT_WORDS[u.rejected_reason] || 'the stored file did not pass the check') + '<div class="eul-actions">' + button('discard', 'Remove', { data: ' data-upload="' + esc(u.id) + '" data-assignment="' + esc(a.id) + '"', focus: 'discard:' + u.id }, null, 'dc-' + u.id) + '</div>';
        }
        return line + outcomeBlock(model, 'discard:' + u.id) + outcomeBlock(model, 'play:' + u.id) + outcomeBlock(model, 'complete:' + u.id) + '</li>';
      }).join('') + '</ul>';
    }
    if (gone) html += '<p class="eul-fine">' + esc(plural(gone, 'earlier take was', 'earlier takes were')) + ' removed.</p>';
    return html + '</div>';
  }

  function viewRights(a, w, locked) {
    var dis = locked ? ' disabled' : '';
    var html = '<fieldset class="eul-rights"><legend>Rights declaration (music-rights-v1)</legend><p class="eul-fine">A declaration, not a verdict: a reviewer checks the rights separately.</p>';
    RIGHTS.forEach(function (r) {
      var v = w.doc.rights[r.id], name = 'eulR-' + r.id + '-' + a.id;
      html += '<fieldset class="eul-yn"><legend>' + esc(r.label) + '</legend><div class="eul-yn__row">' +
        '<label class="eul-check"><input type="radio" name="' + esc(name) + '" value="yes" data-eul-bind="rights" data-field="' + r.id + '" data-assignment="' + esc(a.id) + '" data-eul-focus="rights:' + r.id + ':yes:' + esc(a.id) + '"' + (v === true ? ' checked' : '') + dis + '><span>Yes</span></label>' +
        '<label class="eul-check"><input type="radio" name="' + esc(name) + '" value="no" data-eul-bind="rights" data-field="' + r.id + '" data-assignment="' + esc(a.id) + '" data-eul-focus="rights:' + r.id + ':no:' + esc(a.id) + '"' + (v === false ? ' checked' : '') + dis + '><span>No</span></label></div></fieldset>';
    });
    if (w.doc.rights.parody_or_derivative === true) {
      var did = 'eulDer-' + a.id;
      html += '<label class="eul-field" for="' + did + '"><span>What permission do you have to use the original work?</span><textarea id="' + did + '" rows="3" maxlength="' + MAX.derivative + '" data-eul-bind="derivative" data-assignment="' + esc(a.id) + '" data-eul-focus="derivative:' + esc(a.id) + '"' + dis + '>' + esc(w.doc.rights.derivative_permissions || '') + '</textarea></label>';
    }
    return html + '</fieldset>';
  }

  function saveLine(w) {
    var text = { empty: 'Nothing saved yet. Your work saves as you type.', saved: 'Saved.', dirty: 'Changes not saved yet…', saving: 'Saving…', conflict: 'Not saved: this draft changed on another device or tab.', unknown: 'Not confirmed: the last save did not answer.', refused: 'Not saved.', blocked: 'Not saved yet.' }[w.status] || '';
    return text + (w.note ? ' ' + w.note : '');
  }
  function viewWorkspace(model, a, w, capture) {
    var me = model.me, m = a.mission || {};
    var locked = m.open !== true;
    var dis = locked ? ' readonly' : '';
    var t = 'eulT-' + a.id, l = 'eulL-' + a.id;
    var html = '<div class="eul-work" data-eul-workspace="' + esc(a.id) + '">' +
      (locked ? note('stopped', 'This mission is ' + (m.state === 'paused' ? 'paused' : 'not open') + ': new work is stopped. Your draft and takes stay here, and you can still withdraw.') : '') +
      '<p class="eul-save" role="status" data-eul-save="' + esc(a.id) + '">' + esc(saveLine(w)) + '</p>';
    if (w.status === 'conflict') html += '<div class="eul-actions">' + button('draft-load', 'Load the saved version', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'draft-load:' + a.id }, null, 'dl-' + a.id) + button('draft-overwrite', 'Keep my version and save it', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'draft-overwrite:' + a.id }, null, 'do-' + a.id) + '</div>';
    if (w.status === 'unknown' && w.command) html += '<div class="eul-actions">' + button('draft-check', 'Check whether it saved', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'draft-check:' + a.id }, null, 'dk-' + a.id) + (w.resend ? button('draft-resend', 'Save again (same request)', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'draft-resend:' + a.id }, null, 'dr-' + a.id) : '') + '</div>';
    html += '<label class="eul-field" for="' + t + '"><span>Song title</span><input id="' + t + '" type="text" maxlength="' + MAX.title + '" autocomplete="off" value="' + esc(w.doc.title) + '" data-eul-bind="title" data-assignment="' + esc(a.id) + '" data-eul-focus="title:' + esc(a.id) + '"' + dis + '></label>' +
      '<label class="eul-field" for="' + l + '"><span>Lyrics</span><textarea id="' + l + '" rows="10" maxlength="' + MAX.lyrics + '" data-eul-bind="lyrics" data-assignment="' + esc(a.id) + '" data-eul-focus="lyrics:' + esc(a.id) + '"' + dis + '>' + esc(w.doc.lyrics) + '</textarea></label>';
    html += '<fieldset class="eul-credits"><legend>Credits</legend><p class="eul-fine">Everyone who made the song, with their role. The credits are the only names shown if you later allow publication.</p>';
    w.doc.credits.forEach(function (c, i) {
      var n = 'eulCN-' + a.id + '-' + i, r = 'eulCR-' + a.id + '-' + i;
      html += '<div class="eul-credit"><label class="eul-field" for="' + n + '"><span>Name ' + (i + 1) + '</span><input id="' + n + '" type="text" maxlength="' + MAX.credit_name + '" autocomplete="off" value="' + esc(c.name) + '" data-eul-bind="credit-name" data-index="' + i + '" data-assignment="' + esc(a.id) + '" data-eul-focus="cn:' + i + ':' + esc(a.id) + '"' + dis + '></label>' +
        '<label class="eul-field" for="' + r + '"><span>Role ' + (i + 1) + '</span><input id="' + r + '" type="text" maxlength="' + MAX.credit_role + '" autocomplete="off" value="' + esc(c.role) + '" data-eul-bind="credit-role" data-index="' + i + '" data-assignment="' + esc(a.id) + '" data-eul-focus="cr:' + i + ':' + esc(a.id) + '"' + dis + '></label>' +
        (w.doc.credits.length > 1 && !locked ? button('credit-remove', 'Remove credit ' + (i + 1), { data: ' data-assignment="' + esc(a.id) + '" data-index="' + i + '"', focus: 'credit-remove:' + i + ':' + a.id }, null, 'cx-' + i + '-' + a.id) : '') + '</div>';
    });
    if (!locked && w.doc.credits.length < MAX.credits) html += '<div class="eul-actions">' + button('credit-add', 'Add a credit', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'credit-add:' + a.id }, null, 'ca-' + a.id) + '</div>';
    html += '</fieldset>' + viewRights(a, w, locked);
    if (!locked) html += viewCapture(model, a, w, capture);
    if (w.path === 'statement') {
      var s = 'eulS-' + a.id;
      html += '<div class="eul-statement"><label class="eul-field" for="' + s + '"><span>Your written statement (sent with the lyrics instead of a recording)</span><textarea id="' + s + '" rows="4" maxlength="' + MAX.statement + '" data-eul-bind="statement" data-assignment="' + esc(a.id) + '" data-eul-focus="statement:' + esc(a.id) + '"' + dis + '>' + esc(w.doc.statement) + '</textarea></label>' +
        '<p class="eul-fine">If you cannot record, the lyrics with this statement are your submission. It is reviewed the same way and earns the same credit.</p>' +
        (locked ? '' : '<div class="eul-actions">' + button('path', 'Send recordings instead', { data: ' data-assignment="' + esc(a.id) + '" data-path="media"', focus: 'path:media:' + a.id }, null, 'pm-' + a.id) + '</div>') + '</div>';
    }
    html += viewUploads(model, a, w);
    var n = notice(me, 'private_review');
    html += '<div class="eul-submit"><h4>Submit privately for review</h4>' + (n ? '<div class="eul-notice"><p class="eul-pre">' + esc(n.text) + '</p><p class="eul-fine">Private review notice version ' + esc(n.revision) + '. Submitting shares this work with the reviewers only.</p></div>' : '') +
      '<div data-eul-submit-block="' + esc(a.id) + '">' + viewSubmit(model, a, w) + '</div></div>';
    return html + '</div>';
  }
  /* The part of the submit block that follows the fields: redrawn on its own while the person types, so no text
     field is ever replaced under the cursor. */
  function viewSubmit(model, a, w) {
    var me = model.me, locked = !a.mission || a.mission.open !== true;
    var problems = proofProblems(me, a, w);
    var blocked = locked ? 'This mission is not open right now.' : readiness(me) || (problems.length ? 'Not ready to submit yet: see the list above this button.' : null) || (w.status === 'conflict' ? 'Resolve the draft conflict first.' : null);
    return (problems.length && !locked ? '<ul class="eul-todo" data-eul-todo>' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="eul-actions">' + button('submit-proof', a.proof ? 'Submit the new version privately' : 'Submit privately for review', { primary: true, data: ' data-assignment="' + esc(a.id) + '"', focus: 'submit-proof:' + a.id }, blocked, 'sp-' + a.id) + '</div>' +
      outcomeBlock(model, 'proof:' + a.id);
  }

  function viewReviews(reviews) {
    var r = list(reviews);
    if (!r.length) return '';
    return '<ul class="eul-list">' + r.map(function (x) {
      return '<li>Version ' + esc(x.proof_revision) + ': <strong>' + esc(PROOF_STATE[x.decision] || x.decision) + '</strong> · ' + esc(when(x.created_at)) +
        '<br>Mission ' + esc(DECISION_WORDS[x.mission_decision] || x.mission_decision) + ' · rights ' + esc(DECISION_WORDS[x.rights_decision] || x.rights_decision) + ' · safety ' + esc(DECISION_WORDS[x.safety_decision] || x.safety_decision) +
        (x.reason ? '<br><span class="eul-pre">' + esc(x.reason) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function viewPublication(model, a) {
    var me = model.me, p = a.proof, consent = publishConsent(p), n = notice(me, 'publication'), pub = p.publication;
    var held = p.moderation_state === 'held';
    var html = '<div class="eul-publish" data-eul-publication="' + esc(p.id) + '"><h4>Publication (optional)</h4>' +
      '<p class="eul-status" data-eul-publication-state="' + esc(p.publication_state) + '">' + esc(p.publication_state === 'published_released_audience' ? 'Shown to this campaign’s released audience.' : p.publication_state === 'withdrawn' ? 'Not shown: publication was withdrawn' + (pub && pub.withdrawn_reason ? ' (' + (WITHDRAWN_WORDS[pub.withdrawn_reason] || pub.withdrawn_reason) + ')' : '') + '.' : 'Private: only the reviewers have seen it.') + '</p>' +
      '<p class="eul-fine">If you allow it, the League may show your song, its lyrics and its credits to the people this campaign is released to. It is never public. You can revoke at any time, and revoking withdraws it. Your completion credit is the same either way.</p>';
    if (held) return html + note('stopped', REASONS.moderation_hold) + '</div>';
    if (consent) {
      html += '<p>' + esc(consent.state === 'expired' ? 'Your consent ended on ' + day(consent.expires_at) + '.' : 'You allowed publication until ' + day(consent.expires_at) + ' (notice version ' + consent.notice_revision + ').') +
        (p.publication_state === 'published_released_audience' ? '' : ' The League decides separately whether to publish it.') + '</p>' +
        '<div class="eul-actions">' + button('consent-revoke', 'Revoke publication consent', { data: ' data-consent="' + esc(consent.id) + '" data-proof="' + esc(p.id) + '"', focus: 'consent-revoke:' + consent.id }, null, 'cr-' + consent.id) + '</div>';
    }
    /* the outcome of a revocation outlives the consent it ended, so it is shown whichever form follows */
    list(p.consents).forEach(function (c) { if (c.purpose === 'publish_proof') html += outcomeBlock(model, 'revoke:' + c.id); });
    if (!consent) {
      var win = consentWindow(model.now()), did = 'eulCD-' + p.id;
      var blocked = readiness(me) || (!n ? 'The League has no publication notice set yet.' : null) || (!consentExpiry(model.consentDates[p.id], model.now()) ? 'Choose the last day it may be shown first.' : null);
      html += (n ? '<div class="eul-notice"><p class="eul-pre">' + esc(n.text) + '</p><p class="eul-fine">Publication notice version ' + esc(n.revision) + '.</p></div>' : '') +
        '<label class="eul-field" for="' + did + '"><span>Last day it may be shown (it ends at the end of that day, UTC)</span><input id="' + did + '" type="date" min="' + win.min + '" max="' + win.max + '" value="' + esc(model.consentDates[p.id] || '') + '" data-eul-bind="consent-date" data-proof="' + esc(p.id) + '" data-eul-focus="consent-date:' + esc(p.id) + '"></label>' +
        '<div class="eul-actions">' + button('consent-grant', 'Allow publication to the campaign audience', { data: ' data-assignment="' + esc(a.id) + '" data-proof="' + esc(p.id) + '"', focus: 'consent-grant:' + p.id }, blocked, 'cg-' + p.id) + '</div>';
    }
    return html + outcomeBlock(model, 'consent:' + p.id) + '</div>';
  }

  function viewAssignment(model, a, capture) {
    var m = a.mission || {}, w = model.work[a.id], p = a.proof;
    var html = '<article class="eul-card eul-card--assignment" data-eul-assignment="' + esc(a.id) + '" data-eul-assignment-status="' + esc(a.status) + '"><h3>' + esc(m.title || 'Mission') + '</h3>' +
      '<p class="eul-status">' + esc(ASSIGN_STATUS[a.status] || a.status) + (a.status === 'accepted' && a.accepted_at ? ' · accepted ' + when(a.accepted_at) : '') + '</p>';
    if (a.status === 'offered') html += viewOffer(model, a);
    if (p) {
      html += '<div class="eul-proof" data-eul-proof="' + esc(p.id) + '" data-eul-proof-state="' + esc(p.state) + '"><h4>Your submission</h4><p class="eul-status">Version ' + esc(p.revision) + ': <strong>' + esc(PROOF_STATE[p.state] || p.state) + '</strong> · ' + esc(when(p.updated_at)) + '</p>' +
        '<p class="eul-fp">Work fingerprint: <code data-eul-asset>' + esc(p.asset_revision) + '</code></p>' + (p.moderation_state === 'held' ? note('stopped', REASONS.moderation_hold) : '') + viewReviews(p.reviews) + '</div>';
      if (p.state === 'rejected' || list(p.appeals).length) html += '<h4>Appeal</h4>' + viewAppeals(model, 'proof', p.id, p.appeals, p.state === 'rejected');
    }
    if (a.status === 'completed' || a.credit) {
      html += a.credit ? '<p class="eul-credit-line" data-eul-credit>' + note('done', 'Completion credit recorded on ' + when(a.credit.created_at) + ' for version ' + a.credit.proof_revision + '. It does not depend on publication.') + '</p>' : '';
      if (p && p.state === 'accepted') html += viewPublication(model, a);
    }
    var open = a.status === 'accepted' && w && (!p || p.state === 'needs_changes' || w.open);
    /* the submit outcome sits under the Submit button while the workspace is open, and here once it has closed */
    if (!open) html += outcomeBlock(model, 'proof:' + a.id);
    if (a.status === 'accepted' && w) {
      if (p && p.state === 'submitted' && !w.open) html += '<div class="eul-actions">' + button('work-open', 'Change my submission', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'work-open:' + a.id }, null, 'wo-' + a.id) + '</div><p class="eul-fine">You can send a new version while it waits; the reviewers then see the new one.</p>';
      if (open) html += viewWorkspace(model, a, w, capture);
    }
    if (a.status === 'withdrawn') html += '<p class="eul-muted">You are no longer on this mission (since ' + esc(when(a.withdrawn_at)) + '). Your records stay here.</p>';
    if (a.status === 'offered' || a.status === 'accepted') html += '<div class="eul-actions eul-actions--quiet">' + button('assign-withdraw', 'Withdraw from this mission', { data: ' data-assignment="' + esc(a.id) + '"', focus: 'assign-withdraw:' + a.id }, null, 'aw-' + a.id) + '</div>';
    return html + outcomeBlock(model, 'assign-withdraw:' + a.id) + '</article>';
  }
  function viewAssignments(model, capture) {
    var all = list(model.me.assignments);
    if (!all.length) return '';
    return '<section class="eul-sec" aria-labelledby="eulWorkH"><h2 id="eulWorkH">Your missions</h2>' + all.map(function (a) { return viewAssignment(model, a, capture); }).join('') + '</section>';
  }
  function viewPublished(model) {
    var pubs = list(model.me.published);
    if (!pubs.length) return '';
    return '<section class="eul-sec" aria-labelledby="eulPubH"><h2 id="eulPubH">Shared with this campaign</h2><p class="eul-fine">Work its makers chose to publish to this campaign’s released audience. It is not public.</p>' + pubs.map(function (p) {
      return '<article class="eul-card" data-eul-published="' + esc(p.publication_id) + '"><h3>' + esc(p.title) + '</h3><p class="eul-fine">Credits: ' + esc(list(p.credits).map(function (c) { return c.name + ' (' + c.role + ')'; }).join(', ')) + ' · shared ' + esc(when(p.published_at)) + '</p>' +
        '<p class="eul-pre eul-lyrics">' + esc(p.lyrics) + '</p>' + list(p.media).map(function (m) {
          var player = model.players[m.upload_id];
          return '<div class="eul-media">' + (m.kind === 'video' ? '<video class="eul-player" controls playsinline preload="none" data-eul-player="' + esc(m.upload_id) + '"' + (player ? '' : ' hidden') + '></video>' : '<audio class="eul-player" controls preload="none" data-eul-player="' + esc(m.upload_id) + '"' + (player ? '' : ' hidden') + '></audio>') +
            '<div class="eul-actions">' + button('play', player ? 'Load again' : 'Play ' + (m.kind === 'video' ? 'video' : 'audio'), { data: ' data-upload="' + esc(m.upload_id) + '"', focus: 'play:' + m.upload_id + ':pub' }, null, 'pp-' + m.upload_id) + '</div>' + outcomeBlock(model, 'play:' + m.upload_id) + '</div>';
        }).join('') + '</article>';
    }).join('') + '</section>';
  }
  function viewLeague(model, capture) {
    var me = model.me, r = readiness(me);
    return '<header class="eul-head"><h1 id="eulTitle" tabindex="-1">Environmental Justice League</h1>' +
      '<p class="eul-lede">The missions you were invited to, your applications and your work. Your work is private to you and its reviewers unless you choose to publish it.</p>' +
      '<p class="eul-fine" data-eul-read>Read ' + esc(when(model.readAt)) + '. ' + button('reload', 'Check for updates', { focus: 'reload' }, null, 'rl') + '</p>' +
      (model.readNote ? note('info', model.readNote) : '') + (model.moduleNote ? note('stopped', model.moduleNote, ' data-eul-module-note') : '') + (r ? note('info', r, ' data-eul-readiness') : '') + '</header>' +
      viewAssignments(model, capture) + viewApplications(model) + viewCatalogue(model) + viewPublished(model);
  }
  function viewNeutral(model, here) {
    var u = model.unavailable;
    if (model.phase === 'checking') return '<section class="eul-neutral" aria-labelledby="eulTitle"><h1 id="eulTitle" tabindex="-1">One moment</h1><p>Checking what is available to your account.</p></section>';
    var next = '/account.html?next=' + encodeURIComponent(here || '/action/league.html');
    var html = '<section class="eul-neutral" aria-labelledby="eulTitle" data-eul-unavailable="' + esc(u ? u.kind : 'not_available') + '"><h1 id="eulTitle" tabindex="-1">Not available</h1>';
    if (u && u.kind === 'signed_out') html += '<p>Sign in to see what is available to your account.</p><div class="eul-actions"><a class="eul-btn eul-btn--primary" href="' + esc(next) + '" data-eul-focus="signin">Sign in</a></div>';
    else if (u && u.kind === 'unreadable') html += '<p>This could not be checked right now. Nothing was changed.</p><div class="eul-actions">' + button('reload', 'Try again', { focus: 'reload' }, null, 'rl') + '</div>';
    else html += '<p>Nothing on this page is available to the account you are signed in with.</p><div class="eul-actions"><a class="eul-btn" href="' + esc(next) + '" data-eul-focus="switch">Use another account</a></div>';
    return html + '</section>';
  }
  function viewSheet(model) {
    var s = model.sheet, me = model.me;
    if (!s || !me) return '';
    var card = cardsOf(me).map(function (x) { return x.mission; }).filter(function (m) { return m.id === s.missionId; })[0] || (applicationFor(me, s.missionId) || {}).mission;
    if (!card) return '';
    var submitted = s.status === 'submitted';
    var slot = 'app:' + s.missionId;
    return '<dialog class="eul-sheet" aria-labelledby="eulSheetH" data-eul-sheet>' +
      '<form method="dialog" class="eul-sheet__body" data-eul-sheet-form><h2 id="eulSheetH">Apply: ' + esc(card.title) + '</h2>' +
      '<p class="eul-fine">You are applying to the requirements as they are now (version ' + esc(card.requirements_revision) + '). A person in the League decides each application; nothing else admits anyone.</p>' +
      missionBody(card) +
      '<label class="eul-field" for="eulSheetStatement"><span>Why you would like to take part</span><textarea id="eulSheetStatement" rows="5" maxlength="' + MAX.statement + '" data-eul-bind="sheet-statement" data-eul-focus="sheet-statement">' + esc(s.statement) + '</textarea></label>' +
      '<label class="eul-check"><input type="checkbox" data-eul-bind="sheet-acc" data-eul-focus="sheet-acc"' + (s.accOn ? ' checked' : '') + '><span>I would like to ask for an accommodation</span></label>' +
      (s.accOn ? '<label class="eul-field" for="eulSheetAcc"><span>What would help (read only by the house owner deciding; each reading is recorded)</span><textarea id="eulSheetAcc" rows="3" maxlength="' + MAX.statement + '" data-eul-bind="sheet-acc-text" data-eul-focus="sheet-acc-text">' + esc(s.accText) + '</textarea></label>' : '') +
      (s.problem ? note('refused', s.problem, ' data-eul-sheet-problem') : '') + outcomeBlock(model, slot) +
      '<div class="eul-actions">' + (submitted ? '' : button('sheet-save', 'Save draft', { focus: 'sheet-save' }, null, 'ss')) +
      button('sheet-submit', submitted ? 'Send the changes' : 'Submit application', { primary: true, focus: 'sheet-submit' }, null, 'sb') +
      button('sheet-close', 'Close', { focus: 'sheet-close' }, null, 'sc') + '</div></form></dialog>';
  }

  /* ------------------------------------------------------------------ mount */
  function mount(container, opts) {
    opts = opts || {};
    if (!container || container.eulController) return container ? container.eulController : null;
    var doc = container.ownerDocument || root.document;
    var capApi = opts.capture || root.MCC_LEAGUE_CAPTURE;
    var later = opts.setTimeout || root.setTimeout.bind(root);
    var cancelLater = opts.clearTimeout || root.clearTimeout.bind(root);
    var now = opts.now || function () { return Date.now(); };
    var epoch = 0, readSeq = 0, deadline = opts.deadlineMs > 0 ? opts.deadlineMs : DEADLINE_MS, destroyed = false;
    /* a model with nothing private in it; canRecord asks the browser for nothing, it only looks for the APIs */
    function blank() { var m = freshModel(); m.now = now; m.canRecord = function (kind) { return capApi.recordingSupported(kind, opts.captureEnv); }; return m; }
    var model = blank();
    var currentIdentity = opts.currentIdentity || storedIdentity;
    var send = makeTransport({
      api: opts.api || API, fetch: opts.fetch || function (u, i) { return root.fetch(u, i); }, token: opts.token || defaultToken,
      currentIdentity: currentIdentity, epoch: function () { return epoch; }, deadline: function () { return deadline; }, setTimeout: later, clearTimeout: cancelLater
    });
    var here = opts.here || (root.location ? root.location.pathname + root.location.search : '/action/league.html');
    var capture = null; // { aid, session }
    var xfer = null; // the PUT in flight: { abort }
    var expiry = {}; // upload id -> timer of its signed link
    if (container.classList) container.classList.add('eul');
    container.innerHTML = '<div class="eul-sr" role="status" aria-live="polite" data-eul-announce></div><div class="eul-main" data-eul-main></div><div data-eul-sheet-host></div>';
    var main = container.querySelector('[data-eul-main]'), announcer = container.querySelector('[data-eul-announce]'), sheetHost = container.querySelector('[data-eul-sheet-host]');

    function alive(e) { return !destroyed && (e === undefined || e === epoch); }
    function say(text) { if (announcer) announcer.textContent = text || ''; }
    function setTitle() { if (doc && opts.manageTitle !== false) doc.title = model.phase === 'ready' ? 'Environmental Justice League · Equity Uprise' : 'Equity Uprise'; }
    function getCapture(aid) {
      if (capture && capture.aid === aid) return capture;
      if (capture) capture.session.release();
      capture = { aid: aid, session: capApi.createSession(Object.assign({}, opts.captureEnv || {}, { onChange: function (s, why) { if (why === 'tick') patchTimer(s); else render(); } })) };
      return capture;
    }
    function patchTimer(s) { var el = main && main.querySelector('[data-eul-rec-time]'); if (el) el.textContent = s.seconds + ' s'; }

    /* ---------- rendering ---------- */
    function render() {
      if (destroyed || !main) return;
      var focused = doc && doc.activeElement, key = focused && focused.getAttribute ? focused.getAttribute('data-eul-focus') : null, caret = null;
      try { if (key && typeof focused.selectionStart === 'number') caret = [focused.selectionStart, focused.selectionEnd]; } catch (e) { caret = null; }
      if (main.setAttribute) main.setAttribute('aria-busy', model.phase === 'checking' ? 'true' : 'false');
      main.innerHTML = model.phase === 'ready' && model.me ? viewLeague(model, capture) : viewNeutral(model, here);
      setTitle();
      afterRender();
      if (key && main.querySelector) {
        var again = main.querySelector('[data-eul-focus="' + key.replace(/"/g, '') + '"]');
        if (again && again.focus) { again.focus(); if (caret && again.setSelectionRange) { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text field */ } } }
      }
    }
    /* Media sources are set as properties after drawing: a signed link or an object URL is never part of the markup. */
    function afterRender() {
      if (!main || !main.querySelectorAll) return;
      var s = capture && capture.session.state;
      main.querySelectorAll('[data-eul-preview-player]').forEach(function (el) { if (s && s.url) el.src = s.url; });
      main.querySelectorAll('[data-eul-live]').forEach(function (el) { if (s && s.stream) { try { el.srcObject = s.stream; } catch (e) { /* no live preview */ } } });
      main.querySelectorAll('[data-eul-player]').forEach(function (el) {
        var p = model.players[el.getAttribute('data-eul-player')];
        if (p && p.until > now()) { el.hidden = false; el.src = p.url; }
      });
    }
    function setOutcome(slot, o) { if (o) model.outcomes[slot] = o; else delete model.outcomes[slot]; if (o && o.text) say(o.text); }

    /* ---------- the sheet (a native modal dialog; focus returns to the button that opened it) ---------- */
    function drawSheet() {
      if (!sheetHost) return;
      var wasOpen = sheetHost.querySelector && sheetHost.querySelector('[data-eul-sheet]');
      var focused = doc && doc.activeElement, key = focused && focused.getAttribute ? focused.getAttribute('data-eul-focus') : null, caret = null;
      try { if (key && typeof focused.selectionStart === 'number') caret = [focused.selectionStart, focused.selectionEnd]; } catch (e) { caret = null; }
      if (wasOpen && wasOpen.open && typeof wasOpen.close === 'function') { wasOpen.eulKeep = true; try { wasOpen.close(); } catch (e) { /* closed */ } }
      sheetHost.innerHTML = viewSheet(model);
      var dlg = sheetHost.querySelector && sheetHost.querySelector('[data-eul-sheet]');
      if (!dlg) return;
      if (typeof dlg.showModal === 'function') { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } } else dlg.setAttribute('open', '');
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeSheet(); });
      var target = (key && dlg.querySelector('[data-eul-focus="' + key.replace(/"/g, '') + '"]')) || dlg.querySelector('[data-eul-focus="sheet-statement"]');
      if (target && target.focus) { target.focus(); if (caret && target.setSelectionRange) { try { target.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not text */ } } }
    }
    function closeSheet() {
      var opener = model.sheet && model.sheet.opener;
      model.sheet = null;
      var dlg = sheetHost && sheetHost.querySelector && sheetHost.querySelector('[data-eul-sheet]');
      if (dlg && dlg.open && typeof dlg.close === 'function') { try { dlg.close(); } catch (e) { /* closed */ } }
      if (sheetHost) sheetHost.innerHTML = '';
      render();
      var back = opener && main && main.querySelector('[data-eul-focus="' + opener.replace(/"/g, '') + '"]');
      if (back && back.focus) back.focus();
    }

    /* ---------- lifecycle ---------- */
    function dropPlayers() {
      Object.keys(expiry).forEach(function (id) { cancelLater(expiry[id]); });
      expiry = {};
      if (main && main.querySelectorAll) main.querySelectorAll('audio, video').forEach(function (el) { try { el.pause(); } catch (e) { /* not playing */ } el.removeAttribute('src'); try { el.srcObject = null; } catch (e) { /* none */ } try { el.load(); } catch (e) { /* detached */ } });
      model.players = {};
    }
    function stopEverything() {
      send.abortAll();
      if (xfer) { xfer.abort(); xfer = null; }
      if (capture) { capture.session.release(); capture = null; }
      Object.keys(model.work).forEach(function (id) { var w = model.work[id]; if (w.timer) cancelLater(w.timer); w.timer = null; });
      dropPlayers();
    }
    /* An account change: everything private goes, synchronously, then the new session is read. */
    function invalidate(reason) {
      if (destroyed) return;
      epoch += 1;
      stopEverything();
      var dlg = sheetHost && sheetHost.querySelector && sheetHost.querySelector('[data-eul-sheet]');
      if (dlg && dlg.open && typeof dlg.close === 'function') { try { dlg.close(); } catch (e) { /* closed */ } }
      if (sheetHost) sheetHost.innerHTML = '';
      model = blank();
      render();
      say(reason || 'The account changed. Nothing from the previous account is shown or sent.');
      var mine = epoch;
      later(function () { if (alive(mine)) read(); }, 0);
    }
    function conceal(kind) {
      epoch += 1;
      stopEverything();
      if (sheetHost) sheetHost.innerHTML = '';
      model = blank();
      model.phase = 'unavailable'; model.unavailable = { kind: kind };
      render();
    }

    /* ---------- the member read ---------- */
    function read() {
      if (destroyed) return Promise.resolve();
      var mine = ++readSeq, at = epoch, identity = model.identity;
      if (!identity && currentIdentity() === null) { conceal('signed_out'); return Promise.resolve(); }
      var p = send({ method: 'GET', path: PREFIX, epoch: at, identity: identity || undefined });
      return p.then(function (d) {
        if (!alive(at) || mine !== readSeq) return;
        var me = d.league;
        if (!me || typeof me.actor !== 'string' || !UUID.test(me.actor) || !Array.isArray(me.catalogue) || !Array.isArray(me.applications) || !Array.isArray(me.assignments) || !Array.isArray(me.published)) throw Object.assign(new Error('malformed'), { malformed: true });
        if (identity && me.actor !== identity) { invalidate(); return; }
        /* the answer names someone other than the session held now: an account change in flight, or (on a first read)
           an answer that cannot be trusted; never shown either way */
        if (me.actor !== currentIdentity()) { if (identity) invalidate(); else conceal('unreadable'); return; }
        model.me = me; model.identity = me.actor; model.phase = 'ready'; model.readAt = new Date(now()).toISOString(); model.readNote = null; model.unavailable = null;
        reconcile(me);
        render();
        if (model.sheet) drawSheet();
      }).catch(function (err) {
        if (!alive(at) || mine !== readSeq) return;
        var f = classify(err);
        if (f.stale) return;
        if (f.identityChanged) { invalidate(); return; }
        if (f.signedOut) { conceal('signed_out'); return; }
        if (err && err.status === 404) { conceal('not_available'); return; }
        if (model.phase === 'ready') { model.readNote = 'The latest could not be read (' + (f.why || f.text || 'unknown') + '); what is shown was read ' + when(model.readAt) + '.'; render(); return; }
        model.phase = 'unavailable'; model.unavailable = { kind: 'unreadable' }; render();
      });
    }
    function reconcile(me) {
      var ids = {};
      list(me.assignments).forEach(function (a) {
        ids[a.id] = true;
        var w = model.work[a.id];
        if (!w) { model.work[a.id] = workFrom(a); return; }
        /* text that waited for the requirements to be accepted again is saved once they are */
        if (w.status === 'blocked' && w.dirty && !w.saving && !w.timer && editable(a)) { schedule(a.id, 0); return; }
        if (w.dirty || w.saving || w.status === 'conflict' || w.status === 'unknown' || w.timer) return; // the person's unsaved text wins until they decide
        var serverRev = a.draft ? a.draft.revision : 0;
        if (serverRev !== w.revision) { var fresh = workFrom(a); fresh.open = w.open; model.work[a.id] = fresh; }
      });
      Object.keys(model.work).forEach(function (id) { if (!ids[id]) delete model.work[id]; });
      if (model.sheet) {
        var app = applicationFor(me, model.sheet.missionId);
        if (app && typeof app.revision === 'number' && app.revision > model.sheet.revision) { model.sheet.revision = app.revision; model.sheet.status = app.status; }
      }
    }

    /* ---------- commands ---------- */
    /* confirm(): the identity on screen, checked against the stored session NOW; null (and the page cleared) if they differ. */
    function confirmIdentity() {
      if (!model.identity) return null;
      if (currentIdentity() !== model.identity) { invalidate(); return null; }
      return model.identity;
    }
    function command(slot, operation, method, path, body, onDone) {
      if (!alive() || model.phase !== 'ready') return null;
      var o = model.outcomes[slot];
      if (o && (o.kind === 'pending' || o.kind === 'checking')) return null;
      var identity = confirmIdentity();
      if (!identity) return null;
      var key;
      try { key = newKey(); } catch (e) { setOutcome(slot, { kind: 'refused', text: e.message }); render(); return null; }
      var cmd = { slot: slot, operation: operation, method: method, path: path, body: Object.assign({ idempotency_key: key }, body), key: key, identity: identity, epoch: epoch, onDone: onDone };
      run(cmd, false);
      return cmd;
    }
    function run(cmd, again) {
      var name = OPERATIONS[cmd.operation] || cmd.operation;
      setOutcome(cmd.slot, { kind: 'pending', text: name + ': sending' + (again ? ' again with the same key' : '') + '…' });
      render();
      var p;
      try { p = send({ method: cmd.method, path: cmd.path, body: cmd.body, identity: cmd.identity, epoch: cmd.epoch }); } catch (e) { setOutcome(cmd.slot, { kind: 'refused', text: e.message }); render(); return Promise.resolve(); }
      return p.then(function (d) {
        if (!alive(cmd.epoch)) return;
        model.moduleNote = null;
        setOutcome(cmd.slot, { kind: 'done', text: name + ': done · ' + when(new Date(now()).toISOString()) + '.' });
        if (typeof cmd.onDone === 'function') cmd.onDone(d, false);
        render();
        return read();
      }, function (err) { return failed(cmd, err); });
    }
    function failed(cmd, err) {
      if (!alive(cmd.epoch)) return;
      var name = OPERATIONS[cmd.operation] || cmd.operation, f = classify(err);
      if (f.stale) return;
      if (f.identityChanged) { invalidate(); return; }
      if (f.signedOut) { conceal('signed_out'); return; }
      if (f.unknown) {
        setOutcome(cmd.slot, { kind: 'checking', text: name + ': ' + f.why + '. The outcome is unknown and it was not resent. Checking whether it was recorded…', command: cmd });
        render();
        return checkReceipt(cmd);
      }
      if (f.module) model.moduleNote = f.text;
      setOutcome(cmd.slot, { kind: 'refused', text: name + ': ' + f.text + ' Nothing was changed.', command: f.again ? cmd : null, resend: !!f.again });
      if (typeof cmd.onRefused === 'function') cmd.onRefused(f);
      render();
      if (f.reread) return read();
    }
    /* The receipt of an unknown outcome. Found: it was recorded. Not found: offer the same key again, explicitly. */
    function checkReceipt(cmd) {
      var name = OPERATIONS[cmd.operation] || cmd.operation;
      var p;
      try { p = send({ method: 'GET', path: PREFIX + '/receipts/' + encodeURIComponent(cmd.operation) + '/' + encodeURIComponent(cmd.key), epoch: cmd.epoch, identity: cmd.identity }); } catch (e) { return Promise.resolve(); }
      return p.then(function (d) {
        if (!alive(cmd.epoch)) return;
        var receipt = d && d.receipt;
        if (!receipt || receipt.idempotency_key !== cmd.key || receipt.operation !== cmd.operation) throw Object.assign(new Error('malformed'), { malformed: true });
        setOutcome(cmd.slot, { kind: 'done', text: name + ': it was recorded (its key was found ' + when(new Date(now()).toISOString()) + '). It was not resent.' });
        if (typeof cmd.onDone === 'function') cmd.onDone({ ok: true, receipt: receipt, fromReceipt: true }, true);
        render();
        return read();
      }, function (err) {
        if (!alive(cmd.epoch)) return;
        var f = classify(err);
        if (f.stale) return;
        if (f.identityChanged) { invalidate(); return; }
        if (f.signedOut) { conceal('signed_out'); return; }
        if (err && err.status === 404) setOutcome(cmd.slot, { kind: 'unknown', text: name + ': not recorded as of ' + when(new Date(now()).toISOString()) + ' (its key is not on record). Nothing was resent.', command: cmd, resend: true });
        else setOutcome(cmd.slot, { kind: 'unknown', text: name + ': it could not be checked (' + (f.why || f.text) + '). Nothing was resent.', command: cmd, check: true });
        if (typeof cmd.onUnknown === 'function') cmd.onUnknown();
        render();
      });
    }
    function resend(slot) {
      var o = model.outcomes[slot];
      if (!o || !o.resend || !o.command) return;
      var cmd = o.command;
      if (cmd.epoch !== epoch || cmd.identity !== model.identity || currentIdentity() !== cmd.identity) { invalidate(); return; }
      run(cmd, true);
    }
    function recheck(slot) {
      var o = model.outcomes[slot];
      if (!o || !o.check || !o.command) return;
      if (o.command.epoch !== epoch || currentIdentity() !== o.command.identity) { invalidate(); return; }
      setOutcome(slot, { kind: 'checking', text: (OPERATIONS[o.command.operation] || '') + ': checking whether it was recorded…', command: o.command });
      render();
      checkReceipt(o.command);
    }

    /* ---------- the draft: debounced autosave with compare-and-swap ---------- */
    function editable(a) { return a && a.status === 'accepted' && a.mission && a.mission.open === true && a.accepted_requirements_revision === a.mission.requirements_revision; }
    function edited(aid) {
      var w = model.work[aid];
      if (!w) return;
      w.dirty = true;
      if (w.status !== 'conflict' && w.status !== 'unknown') { w.status = 'dirty'; w.note = null; }
      patchSave(aid);
      patchSubmit(aid);
      schedule(aid);
    }
    function patchSave(aid) {
      var el = main && main.querySelector && main.querySelector('[data-eul-save="' + aid + '"]');
      if (el && model.work[aid]) el.textContent = saveLine(model.work[aid]);
    }
    function patchSubmit(aid) {
      var el = main && main.querySelector && main.querySelector('[data-eul-submit-block="' + aid + '"]');
      var a = assignmentById(model.me, aid), w = model.work[aid];
      if (!el || !a || !w) return;
      var focused = doc && doc.activeElement, inside = focused && el.contains && el.contains(focused) ? focused.getAttribute('data-eul-focus') : null;
      el.innerHTML = viewSubmit(model, a, w);
      if (inside) { var again = el.querySelector('[data-eul-focus="' + inside.replace(/"/g, '') + '"]'); if (again && again.focus) again.focus(); }
    }
    function schedule(aid, ms) {
      var w = model.work[aid];
      if (!w) return;
      if (w.timer) cancelLater(w.timer);
      var at = epoch;
      w.timer = later(function () { w.timer = null; if (alive(at)) saveDraft(aid, false); }, ms === undefined ? AUTOSAVE_MS : ms);
    }
    function saveDraft(aid, explicit) {
      var w = model.work[aid], a = assignmentById(model.me, aid);
      if (!w || !a || !alive()) return;
      if (w.saving) { w.again = true; return; }
      if (!explicit && (w.status === 'conflict' || w.status === 'unknown')) return;
      if (!editable(a)) { w.status = 'blocked'; w.note = a.status === 'offered' ? 'Accept the current requirements to keep saving; your text is kept on this page.' : 'New work is stopped on this mission; your text is kept on this page.'; patchSave(aid); return; }
      var problems = draftProblems(w);
      if (problems.length) { w.status = 'refused'; w.note = problems[0]; patchSave(aid); return; }
      var identity = confirmIdentity();
      if (!identity) return;
      var key;
      try { key = newKey(); } catch (e) { w.status = 'refused'; w.note = e.message; patchSave(aid); return; }
      var cmd = { slot: 'draft:' + aid, operation: 'drafts.save', method: 'POST', path: PREFIX + '/assignments/' + aid + '/draft', key: key, identity: identity, epoch: epoch,
        body: { idempotency_key: key, expected_revision: w.revision, draft: draftDocument(w) } };
      sendDraft(aid, cmd);
    }
    function sendDraft(aid, cmd) {
      var w = model.work[aid];
      w.saving = true; w.again = false; w.dirty = false; w.status = 'saving'; w.note = null; w.command = cmd; w.resend = false;
      patchSave(aid);
      var p;
      try { p = send({ method: 'POST', path: cmd.path, body: cmd.body, identity: cmd.identity, epoch: cmd.epoch }); } catch (e) { w.saving = false; w.status = 'refused'; w.note = e.message; patchSave(aid); return; }
      p.then(function (d) {
        if (!alive(cmd.epoch) || model.work[aid] !== w) return;
        var saved = d && d.draft;
        if (!saved || typeof saved.revision !== 'number') throw Object.assign(new Error('malformed'), { malformed: true });
        w.revision = saved.revision; w.saving = false; w.command = null;
        w.status = w.dirty ? 'dirty' : 'saved'; w.note = w.dirty ? null : '';
        patchSave(aid);
        if (w.dirty || w.again) schedule(aid);
      }).catch(function (err) {
        if (!alive(cmd.epoch) || model.work[aid] !== w) return;
        w.saving = false; w.dirty = true;
        var f = classify(err);
        if (f.stale) return;
        if (f.identityChanged) { invalidate(); return; }
        if (f.signedOut) { conceal('signed_out'); return; }
        if (f.unknown) {
          w.status = 'unknown'; w.note = 'The outcome is unknown and it was not resent. Checking whether it was saved…';
          patchSave(aid); render();
          draftReceipt(aid, cmd);
          return;
        }
        if (f.reason === 'revision_conflict') { w.status = 'conflict'; w.note = 'Your text here is kept and was not saved. Choose which version to keep.'; render(); return; }
        if (f.module) model.moduleNote = f.text;
        /* waiting for the current requirements to be accepted, or for the mission to open again: saved then (reconcile) */
        w.status = f.reason === 'requirements_changed' || f.reason === 'not_available' ? 'blocked' : 'refused';
        w.note = f.text + (w.status === 'blocked' ? ' Your text is kept on this page and is saved when work can continue.' : '');
        render();
        if (f.reread) read();
      });
    }
    function draftReceipt(aid, cmd) {
      var w = model.work[aid];
      var p;
      try { p = send({ method: 'GET', path: PREFIX + '/receipts/drafts.save/' + encodeURIComponent(cmd.key), epoch: cmd.epoch, identity: cmd.identity }); } catch (e) { return; }
      p.then(function (d) {
        if (!alive(cmd.epoch) || model.work[aid] !== w) return;
        var r = d && d.receipt, rev = r && r.result && r.result.revision;
        if (typeof rev !== 'number' || r.idempotency_key !== cmd.key) throw Object.assign(new Error('malformed'), { malformed: true });
        w.revision = rev; w.command = null; w.resend = false;
        w.status = 'dirty'; w.note = 'The last save was recorded (its key was found); it was not resent.';
        render();
        schedule(aid);
      }, function (err) {
        if (!alive(cmd.epoch) || model.work[aid] !== w) return;
        var f = classify(err);
        if (f.stale) return;
        if (f.identityChanged) { invalidate(); return; }
        if (f.signedOut) { conceal('signed_out'); return; }
        w.status = 'unknown';
        w.resend = err && err.status === 404;
        w.note = w.resend ? 'It was not saved as of ' + when(new Date(now()).toISOString()) + ' (its key is not on record). Nothing was resent; autosave waits for you.' : 'It could not be checked (' + (f.why || f.text) + '). Nothing was resent; autosave waits for you.';
        render();
      });
    }

    /* ---------- uploads: begin, PUT, complete ---------- */
    function useTake(aid) {
      var a = assignmentById(model.me, aid), c = capture && capture.aid === aid ? capture.session.state : null;
      if (!a || !c || c.state !== 'preview' || !c.blob || (model.upload && model.upload.aid === aid && model.upload.phase !== 'done')) return;
      var identity = confirmIdentity();
      if (!identity) return;
      var key;
      try { key = newKey(); } catch (e) { setOutcome('upload:' + aid, { kind: 'refused', text: e.message }); render(); return; }
      var upload = { kind: c.kind, mime: c.mime, bytes: c.bytes };
      if (c.source === 'recording' && c.seconds >= 1) upload.duration_seconds = Math.min(c.seconds, c.maxSeconds || 3600);
      var cmd = { slot: 'upload:' + aid, operation: 'uploads.begin', method: 'POST', path: PREFIX + '/assignments/' + aid + '/uploads', key: key, identity: identity, epoch: epoch,
        body: { idempotency_key: key, upload: upload }, blob: c.blob };
      beginUpload(aid, cmd);
    }
    function beginUpload(aid, cmd) {
      model.upload = { aid: aid, phase: 'begin', pct: 0, uploadId: null, cmd: cmd };
      setOutcome(cmd.slot, null);
      cmd.onDone = function (d, fromReceipt) {
        if (fromReceipt) { model.upload = null; setOutcome(cmd.slot, { kind: 'unknown', text: 'The upload was started (its key was found), but its answer was lost, so the file was not sent. Send the same request again to continue it.', command: cmd, resend: true }); return; }
      };
      cmd.onUnknown = function () { model.upload = null; };
      render();
      var p;
      try { p = send({ method: 'POST', path: cmd.path, body: cmd.body, identity: cmd.identity, epoch: cmd.epoch }); } catch (e) { model.upload = null; setOutcome(cmd.slot, { kind: 'refused', text: e.message }); render(); return; }
      p.then(function (d) {
        if (!alive(cmd.epoch)) return;
        var row = d && d.upload, grant = d && d.grant;
        if (!row || typeof row.id !== 'string' || !grant || typeof grant.url !== 'string') throw Object.assign(new Error('malformed'), { malformed: true });
        model.upload.uploadId = row.id; model.upload.phase = 'put'; model.upload.pct = 0;
        render();
        var t = capApi.put(grant, cmd.blob, { timeoutMs: 120000 + Math.ceil(cmd.blob.size / 20), XMLHttpRequest: opts.XMLHttpRequest, onProgress: function (loaded, total) {
          if (!alive(cmd.epoch) || !model.upload) return;
          model.upload.pct = Math.max(0, Math.min(100, Math.floor((loaded / (total || 1)) * 100)));
          var bar = main && main.querySelector('[data-eul-progress-bar]'), txt = main && main.querySelector('[data-eul-progress-text]');
          if (bar) bar.value = model.upload.pct;
          if (txt) txt.textContent = 'Uploading: ' + model.upload.pct + '%';
        } });
        xfer = t;
        return t.promise.then(function () {
          xfer = null;
          if (!alive(cmd.epoch) || !model.upload) return;
          model.upload.phase = 'seal'; model.upload.pct = 100;
          render();
          return completeUpload(aid, row.id, cmd);
        }, function (e) {
          xfer = null;
          if (!alive(cmd.epoch) || !model.upload) return;
          if (e && e.aborted && model.upload.cancelled) return; // the person cancelled: cancelUpload() owns what follows
          model.upload = null;
          setOutcome(cmd.slot, { kind: 'unknown', text: 'The file transfer did not finish (' + (e && e.timeout ? 'it timed out' : e && e.status ? 'storage answered ' + e.status : 'the connection failed') + '). Nothing was sealed and nothing was resent. Check whether it arrived below, or remove it.' });
          render();
          return read();
        });
      }).catch(function (err) { model.upload = null; return failed(cmd, err); });
    }
    function completeUpload(aid, uploadId, cmd) {
      var slot = cmd ? cmd.slot : 'complete:' + uploadId;
      var identity = cmd ? cmd.identity : confirmIdentity();
      if (!identity) return;
      var at = cmd ? cmd.epoch : epoch;
      if (!cmd) { setOutcome(slot, { kind: 'pending', text: 'Checking the stored file…' }); render(); }
      var p;
      try { p = send({ method: 'POST', path: PREFIX + '/uploads/' + uploadId + '/complete', body: {}, identity: identity, epoch: at }); } catch (e) { return; }
      return p.then(function (d) {
        if (!alive(at)) return;
        var row = d && d.upload;
        if (!row || typeof row.state !== 'string') throw Object.assign(new Error('malformed'), { malformed: true });
        model.upload = null;
        if (row.state === 'sealed') {
          var w = model.work[aid];
          if (w && w.doc.media.indexOf(row.id) < 0 && w.doc.media.length < MAX.media) { w.doc.media.push(row.id); w.path = 'media'; edited(aid); }
          if (capture && capture.aid === aid) capture.session.cancel();
          setOutcome(slot, { kind: 'done', text: 'Sealed. Fingerprint (SHA-256): ' + row.sha256 + '. It is listed under your takes.' });
        } else if (row.state === 'rejected') setOutcome(slot, { kind: 'refused', text: 'The stored file was not accepted: ' + (REJECT_WORDS[row.rejected_reason] || 'it did not pass the check') + '. It is not part of your work.' });
        else setOutcome(slot, { kind: 'refused', text: 'This upload expired before it finished. Send the take again.' });
        render();
        return read();
      }).catch(function (err) {
        if (!alive(at)) return;
        model.upload = null;
        var f = classify(err);
        if (f.stale) return;
        if (f.identityChanged) { invalidate(); return; }
        if (f.signedOut) { conceal('signed_out'); return; }
        setOutcome(slot, { kind: f.unknown ? 'unknown' : 'refused', text: f.unknown ? 'Checking the stored file: ' + f.why + '. Nothing was resent; check again below.' : 'Checking the stored file: ' + f.text });
        render();
        return read();
      });
    }
    /* Cancel is offered only while the bytes are being sent (the staged row then exists and is discarded). */
    function cancelUpload(aid) {
      var up = model.upload;
      if (!up || up.aid !== aid || up.phase !== 'put' || !up.uploadId) return;
      up.cancelled = true;
      if (xfer) { xfer.abort(); xfer = null; }
      var uploadId = up.uploadId;
      model.upload = null;
      /* the staged row is discarded, so the Worker deletes whatever reached storage */
      command('discard:' + uploadId, 'uploads.discard', 'POST', PREFIX + '/uploads/' + uploadId + '/discard', {}, function () {
        setOutcome('upload:' + aid, { kind: 'done', text: 'Upload cancelled. Nothing was kept in storage; your take is still on this device.' });
      });
    }
    function playUpload(uploadId) {
      var identity = confirmIdentity();
      if (!identity) return;
      var slot = 'play:' + uploadId, at = epoch;
      setOutcome(slot, { kind: 'pending', text: 'Getting a private link to play it…' });
      render();
      var p;
      try { p = send({ method: 'GET', path: PREFIX + '/uploads/' + uploadId + '/url', identity: identity, epoch: at }); } catch (e) { return; }
      p.then(function (d) {
        if (!alive(at)) return;
        if (!d || typeof d.url !== 'string' || !/^https:\/\//.test(d.url) || !(d.expires_in > 0)) throw Object.assign(new Error('malformed'), { malformed: true });
        var ms = Math.max(1000, d.expires_in * 1000 - 5000);
        model.players[uploadId] = { url: d.url, until: now() + ms };
        if (expiry[uploadId]) cancelLater(expiry[uploadId]);
        expiry[uploadId] = later(function () {
          if (!alive(at)) return;
          delete model.players[uploadId]; delete expiry[uploadId];
          var el = main && main.querySelector('[data-eul-player="' + uploadId + '"]');
          if (el) { try { el.pause(); } catch (e) { /* idle */ } el.removeAttribute('src'); try { el.load(); } catch (e) { /* detached */ } }
          setOutcome(slot, { kind: 'info', text: 'The private link ended. Press Play to get a new one.' });
          render();
        }, ms);
        setOutcome(slot, null);
        render();
        var el = main && main.querySelector('[data-eul-player="' + uploadId + '"]');
        if (el) { if (el.focus) el.focus(); if (typeof el.play === 'function') { try { var pr = el.play(); if (pr && pr.catch) pr.catch(function () { /* the controls are there */ }); } catch (e) { /* controls */ } } }
      }).catch(function (err) {
        if (!alive(at)) return;
        var f = classify(err);
        if (f.stale) return;
        if (f.identityChanged) { invalidate(); return; }
        if (f.signedOut) { conceal('signed_out'); return; }
        setOutcome(slot, { kind: 'refused', text: 'Playing it: ' + (f.text || f.why) });
        render();
      });
    }

    /* ---------- actions (the delegated handlers call these; tests call act() directly) ---------- */
    function needWork(aid) { return model.work[aid] || null; }
    var ACTIONS = {
      /* an explicit refresh starts from a clean slate of notes: what finished is not repeated, what is open stays */
      reload: function () {
        Object.keys(model.outcomes).forEach(function (slot) { var o = model.outcomes[slot]; if (o && (o.kind === 'done' || o.kind === 'info')) delete model.outcomes[slot]; });
        read();
      },
      resend: function (d) { resend(d.slot); },
      check: function (d) { recheck(d.slot); },
      'apply-open': function (d, el) {
        var me = model.me, app = applicationFor(me, d.mission);
        model.sheet = { missionId: d.mission, revision: app ? app.revision : 0, status: app ? app.status : null, statement: app && app.document && typeof app.document.statement === 'string' ? app.document.statement : '',
          accOn: !!(app && app.accommodation), accText: app && app.accommodation && typeof app.accommodation.statement === 'string' ? app.accommodation.statement : '', problem: null,
          opener: el && el.getAttribute ? el.getAttribute('data-eul-focus') : 'apply:' + d.mission };
        drawSheet();
      },
      'sheet-close': function () { closeSheet(); },
      'sheet-save': function () { saveApplication(false); },
      'sheet-submit': function () { saveApplication(true); },
      'app-withdraw': function (d) { command('app-withdraw:' + d.application, 'applications.withdraw', 'POST', PREFIX + '/applications/' + d.application + '/withdraw', {}); },
      accept: function (d) {
        var a = assignmentById(model.me, d.assignment), n = notice(model.me, 'participation');
        if (!a || !n) return;
        command('accept:' + a.id, 'assignments.accept', 'POST', PREFIX + '/assignments/' + a.id + '/accept', { expected_revision: a.revision, requirements_revision: a.mission.requirements_revision, notice_revision: n.revision });
      },
      'assign-withdraw': function (d) { command('assign-withdraw:' + d.assignment, 'assignments.withdraw', 'POST', PREFIX + '/assignments/' + d.assignment + '/withdraw', {}); },
      'work-open': function (d) { var w = needWork(d.assignment); if (w) { w.open = true; render(); } },
      path: function (d) { var w = needWork(d.assignment); if (!w) return; w.path = d.path === 'statement' ? 'statement' : 'media'; edited(d.assignment); render(); var f = main.querySelector('[data-eul-focus="' + (w.path === 'statement' ? 'statement:' : 'path:statement:') + d.assignment + '"]'); if (f && f.focus) f.focus(); },
      /* THE Record handler: the only caller of a device request */
      record: function (d) {
        var a = assignmentById(model.me, d.assignment);
        if (!a || !editable(a) || kindsFor(model.me, a.mission).indexOf(d.kind) < 0) return;
        if (model.upload && model.upload.aid === a.id) return;
        model.fileNote = null;
        var w = needWork(a.id); if (w && w.path !== 'media') { w.path = 'media'; edited(a.id); }
        var c = getCapture(a.id);
        c.session.start(d.kind, maxSecondsFor(model.me));
      },
      stop: function (d) { if (capture && capture.aid === d.assignment) capture.session.stop(); },
      retake: function (d) { if (capture && capture.aid === d.assignment) capture.session.retake(maxSecondsFor(model.me)); },
      'cancel-take': function (d) { if (capture && capture.aid === d.assignment) { capture.session.cancel(); var f = main.querySelector('[data-eul-focus^="record:"]'); if (f && f.focus) f.focus(); } },
      'use-take': function (d) { useTake(d.assignment); },
      'upload-cancel': function (d) { cancelUpload(d.assignment); },
      complete: function (d) { completeUpload(d.assignment, d.upload, null); },
      discard: function (d) {
        command('discard:' + d.upload, 'uploads.discard', 'POST', PREFIX + '/uploads/' + d.upload + '/discard', {}, function () {
          var w = needWork(d.assignment); if (w && w.doc.media.indexOf(d.upload) >= 0) { w.doc.media = w.doc.media.filter(function (x) { return x !== d.upload; }); edited(d.assignment); }
          if (model.players[d.upload]) { delete model.players[d.upload]; }
        });
      },
      play: function (d) { playUpload(d.upload); },
      'credit-add': function (d) { var w = needWork(d.assignment); if (w && w.doc.credits.length < MAX.credits) { w.doc.credits.push(blankCredit()); edited(d.assignment); render(); var f = main.querySelector('[data-eul-focus="cn:' + (w.doc.credits.length - 1) + ':' + d.assignment + '"]'); if (f && f.focus) f.focus(); } },
      'credit-remove': function (d) { var w = needWork(d.assignment), i = Number(d.index); if (w && w.doc.credits.length > 1 && i >= 0 && i < w.doc.credits.length) { w.doc.credits.splice(i, 1); edited(d.assignment); render(); var f = main.querySelector('[data-eul-focus="credit-add:' + d.assignment + '"]'); if (f && f.focus) f.focus(); } },
      'draft-load': function (d) { var a = assignmentById(model.me, d.assignment), w = needWork(d.assignment); if (!a || !w) return; if (w.timer) cancelLater(w.timer); var fresh = workFrom(a); fresh.open = w.open; model.work[a.id] = fresh; render(); read(); },
      'draft-overwrite': function (d) {
        var w = needWork(d.assignment); if (!w) return;
        /* read the current revision first, then save this text over it: a new, explicit command */
        w.status = 'saving'; w.note = 'Reading the saved version…'; patchSave(d.assignment);
        var at = epoch;
        read().then(function () {
          if (!alive(at)) return;
          var a = assignmentById(model.me, d.assignment), cur = model.work[d.assignment];
          if (!a || cur !== w) return;
          w.revision = a.draft ? a.draft.revision : 0; w.status = 'dirty'; w.note = null;
          saveDraft(d.assignment, true);
        });
      },
      'draft-check': function (d) { var w = needWork(d.assignment); if (w && w.command && w.status === 'unknown') { w.note = 'Checking whether it was saved…'; patchSave(d.assignment); draftReceipt(d.assignment, w.command); } },
      'draft-resend': function (d) {
        var w = needWork(d.assignment);
        if (!w || !w.command || !w.resend) return;
        if (w.command.epoch !== epoch || currentIdentity() !== w.command.identity) { invalidate(); return; }
        sendDraft(d.assignment, w.command);
      },
      'submit-proof': function (d) {
        var a = assignmentById(model.me, d.assignment), w = needWork(d.assignment);
        if (!a || !w || !editable(a) || proofProblems(model.me, a, w).length || w.status === 'conflict') return;
        if (w.timer) { cancelLater(w.timer); w.timer = null; }
        command('proof:' + a.id, 'proofs.submit', 'POST', PREFIX + '/assignments/' + a.id + '/proof', { expected_revision: a.proof ? a.proof.revision : 0, proof: proofDocument(model.me, a, w) }, function () { w.open = false; });
        if (w.dirty) saveDraft(a.id, false);
      },
      'consent-grant': function (d) {
        var a = assignmentById(model.me, d.assignment), n = notice(model.me, 'publication'), at = consentExpiry(model.consentDates[d.proof], now());
        if (!a || !a.proof || a.proof.id !== d.proof || !n || !at) return;
        command('consent:' + a.proof.id, 'consents.grant', 'POST', PREFIX + '/proofs/' + a.proof.id + '/consent', { expected_revision: a.proof.revision,
          consent: { purpose: 'publish_proof', audience: 'released_audience', asset_revision: a.proof.asset_revision, notice_revision: n.revision, expires_at: at } });
      },
      'consent-revoke': function (d) {
        command('revoke:' + d.consent, 'consents.revoke', 'POST', PREFIX + '/consents/' + d.consent + '/revoke', {}, function () {
          /* a revoked consent leaves nothing behind in the form: a new one starts with no date chosen */
          if (d.proof) { delete model.consentDates[d.proof]; delete model.outcomes['consent:' + d.proof]; }
        });
      },
      'appeal-open': function (d) {
        var text = model.appealText[d.subjectId] || '', problem = textProblem('The appeal', text, MAX.statement, 1, true);
        if (problem) { setOutcome('appeal:' + d.subjectId, { kind: 'refused', text: problem + ' Nothing was sent.' }); render(); return; }
        command('appeal:' + d.subjectId, 'appeals.open', 'POST', PREFIX + '/' + (d.subject === 'proof' ? 'proofs/' : 'applications/') + d.subjectId + '/appeal', { appeal: { statement: text } }, function () { delete model.appealText[d.subjectId]; });
      },
      'appeal-withdraw': function (d) { command('appeal-withdraw:' + d.appeal, 'appeals.withdraw', 'POST', PREFIX + '/appeals/' + d.appeal + '/withdraw', {}); }
    };
    function saveApplication(submit) {
      var s = model.sheet, me = model.me;
      if (!s || !me) return;
      var card = cardsOf(me).map(function (x) { return x.mission; }).filter(function (m) { return m.id === s.missionId; })[0] || (applicationFor(me, s.missionId) || {}).mission;
      if (!card) return;
      var problem = textProblem('Your reason for taking part', s.statement, MAX.statement, submit ? 1 : 0, true) || (s.accOn ? textProblem('The accommodation request', s.accText, MAX.statement, 1, true) : null);
      if (problem) { s.problem = problem + ' Nothing was sent.'; drawSheet(); return; }
      s.problem = null;
      var cmd = command('app:' + s.missionId, 'applications.save', 'POST', PREFIX + '/missions/' + s.missionId + '/application',
        { expected_revision: s.revision, application: { submit: submit, requirements_revision: card.requirements_revision, statement: s.statement, accommodation: s.accOn ? { statement: s.accText } : null } },
        function (d, fromReceipt) {
          var row = fromReceipt ? d.receipt && d.receipt.result : d && d.application;
          if (model.sheet && row && typeof row.revision === 'number') { model.sheet.revision = row.revision; model.sheet.status = row.status; }
          if (submit && model.sheet && model.sheet.missionId === s.missionId) closeSheet();
          else if (model.sheet) drawSheet();
        });
      if (cmd) { cmd.onRefused = function () { if (model.sheet) drawSheet(); }; cmd.onUnknown = function () { if (model.sheet) drawSheet(); }; drawSheet(); }
    }
    function act(name, data, el) {
      if (destroyed || !Object.prototype.hasOwnProperty.call(ACTIONS, name)) return;
      ACTIONS[name](data || {}, el || null);
    }
    /* typed values: kept in the model as they are typed (never re-rendered under the cursor) */
    function bind(name, data, el) {
      var aid = data.assignment, w = aid ? model.work[aid] : null, v = el ? (el.type === 'checkbox' ? el.checked : el.value) : data.value;
      switch (name) {
        case 'title': if (w) { w.doc.title = String(v); edited(aid); } break;
        case 'lyrics': if (w) { w.doc.lyrics = String(v); edited(aid); } break;
        case 'statement': if (w) { w.doc.statement = String(v); edited(aid); } break;
        case 'credit-name': if (w && w.doc.credits[Number(data.index)]) { w.doc.credits[Number(data.index)].name = String(v); edited(aid); } break;
        case 'credit-role': if (w && w.doc.credits[Number(data.index)]) { w.doc.credits[Number(data.index)].role = String(v); edited(aid); } break;
        case 'derivative': if (w) { w.doc.rights.derivative_permissions = String(v); edited(aid); } break;
        case 'rights': if (w) { var before = w.doc.rights.parody_or_derivative; w.doc.rights[data.field] = v === 'yes'; if (typeof w.doc.rights.derivative_permissions !== 'string') w.doc.rights.derivative_permissions = ''; edited(aid); if (data.field === 'parody_or_derivative' && before !== w.doc.rights.parody_or_derivative) render(); } break;
        case 'choose': if (w) { var id = data.upload; if (v === true && w.doc.media.indexOf(id) < 0 && w.doc.media.length < MAX.media) w.doc.media.push(id); if (v === false) w.doc.media = w.doc.media.filter(function (x) { return x !== id; }); edited(aid); render(); } break;
        case 'consent-date': model.consentDates[data.proof] = String(v); render(); break;
        case 'appeal': model.appealText[data.subjectId] = String(v); break;
        case 'sheet-statement': if (model.sheet) model.sheet.statement = String(v); break;
        case 'sheet-acc': if (model.sheet) { model.sheet.accOn = v === true; drawSheet(); } break;
        case 'sheet-acc-text': if (model.sheet) model.sheet.accText = String(v); break;
        case 'file': if (aid && el && el.files && el.files[0]) chooseFile(aid, el.files[0], el); break;
        default: break;
      }
    }
    function chooseFile(aid, file, input) {
      var a = assignmentById(model.me, aid);
      if (!a || !editable(a)) return;
      model.fileNote = null;
      var at = epoch;
      capApi.inspectFile(file, { kinds: kindsFor(model.me, a.mission), caps: capsFor(model.me) }).then(function (r) {
        if (!alive(at)) return;
        if (input) { try { input.value = ''; } catch (e) { /* read-only */ } }
        if (!r.ok) { model.fileNote = { aid: aid, text: r.reason + ' Nothing was sent.' }; say(model.fileNote.text); render(); return; }
        var w = needWork(aid); if (w && w.path !== 'media') { w.path = 'media'; edited(aid); }
        getCapture(aid).session.useFile(file, r);
      });
    }

    /* ---------- DOM wiring (delegated: survives every redraw) ---------- */
    function closestAct(t) { return t && t.closest ? t.closest('[data-eul-act]') : null; }
    function onClick(e) {
      var el = closestAct(e.target);
      if (!el || (container.contains && !container.contains(el))) return;
      e.preventDefault();
      if (el.getAttribute('aria-disabled') === 'true') {
        var why = el.getAttribute('aria-describedby'), w = why && doc.getElementById(why);
        if (w) say(w.textContent);
        return;
      }
      act(el.getAttribute('data-eul-act'), el.dataset, el);
    }
    function onInput(e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-eul-bind]') : null;
      if (!el || el.type === 'radio' || el.type === 'checkbox' || el.type === 'file' || el.type === 'date') return;
      bind(el.getAttribute('data-eul-bind'), el.dataset, el);
    }
    function onChange(e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-eul-bind]') : null;
      if (!el || !(el.type === 'radio' || el.type === 'checkbox' || el.type === 'file' || el.type === 'date')) return;
      bind(el.getAttribute('data-eul-bind'), el.dataset, el);
    }
    function onSubmit(e) { e.preventDefault(); }
    if (container.addEventListener) {
      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      container.addEventListener('change', onChange);
      container.addEventListener('submit', onSubmit);
    }
    /* account changes */
    function onAuth() { invalidate(); }
    function onStorage(e) {
      if (!e || (e.key !== null && e.key !== SESSION_KEY)) return;
      var who = currentIdentity();
      if (model.identity && who === model.identity) return; // the same account with a refreshed token
      if (!model.identity && model.phase === 'checking') return;
      invalidate();
    }
    function onPageShow(e) { if (e && e.persisted) invalidate('This page was restored. It is read again for the account signed in now.'); }
    function onVisible() {
      if (!doc || doc.visibilityState !== 'visible' || model.phase !== 'ready') return;
      if (currentIdentity() !== model.identity) { invalidate(); return; }
      read();
    }
    function unsaved() {
      if (model.upload) return true;
      if (capture && ['recording', 'stopping', 'preview', 'requesting'].indexOf(capture.session.state.state) >= 0) return true;
      return Object.keys(model.work).some(function (id) { var w = model.work[id]; return w.dirty || w.saving || w.status === 'unknown' || w.status === 'conflict'; });
    }
    function onBeforeUnload(e) { if (unsaved()) { e.preventDefault(); e.returnValue = ''; return ''; } }
    var win = opts.window || root;
    if (win && win.addEventListener) {
      win.addEventListener('mcc:auth-changed', onAuth);
      win.addEventListener('storage', onStorage);
      win.addEventListener('pageshow', onPageShow);
      win.addEventListener('beforeunload', onBeforeUnload);
    }
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisible);

    function destroy() {
      if (destroyed) return;
      stopEverything();
      destroyed = true; epoch += 1;
      if (win && win.removeEventListener) { win.removeEventListener('mcc:auth-changed', onAuth); win.removeEventListener('storage', onStorage); win.removeEventListener('pageshow', onPageShow); win.removeEventListener('beforeunload', onBeforeUnload); }
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisible);
      if (container.removeEventListener) { container.removeEventListener('click', onClick); container.removeEventListener('input', onInput); container.removeEventListener('change', onChange); container.removeEventListener('submit', onSubmit); }
      container.innerHTML = '';
      container.eulController = null;
    }

    var controller = {
      act: act, bind: bind, read: read, invalidate: invalidate, destroy: destroy, unsaved: unsaved,
      model: function () { return model; }, epoch: function () { return epoch; }, capture: function () { return capture; },
      inflight: function () { return send.inflight(); }, setDeadline: function (ms) { if (ms > 0) deadline = ms; }
    };
    container.eulController = controller;
    render();
    read();
    return controller;
  }

  root.MCC_LEAGUE_MEMBER = Object.freeze({
    mount: mount,
    helpers: Object.freeze({
      API: API, PREFIX: PREFIX, DEADLINE_MS: DEADLINE_MS, AUTOSAVE_MS: AUTOSAVE_MS, MAX: MAX, REASONS: REASONS, RIGHTS: RIGHTS,
      esc: esc, subOf: subOf, newKey: newKey, textProblem: textProblem, classify: classify, makeTransport: makeTransport, freshModel: freshModel,
      workFrom: workFrom, draftDocument: draftDocument, draftProblems: draftProblems, proofProblems: proofProblems, proofDocument: proofDocument,
      consentWindow: consentWindow, consentExpiry: consentExpiry, publishConsent: publishConsent, viewNeutral: viewNeutral, KEY_PATTERN: KEY_PATTERN
    })
  });

  /* action/league.html (and any page the owner names) carries one element with this attribute */
  function autoMount() {
    if (!root.document || !root.document.querySelectorAll) return;
    root.document.querySelectorAll('[data-eup-league-member]').forEach(function (el) { mount(el, {}); });
  }
  if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoMount);
  else if (root.document) autoMount();
})(typeof window !== 'undefined' ? window : globalThis);
