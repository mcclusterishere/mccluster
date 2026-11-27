/* Fellow onboarding (fellow-onboarding.html): invitation or request, review
 * by the desk, three onboarding steps, fellow. The server functions are in
 * supabase/pending/eu_fellow_onboarding_v1.sql; until that file is applied
 * the page says the desk is not open online yet and changes nothing.
 *
 * The private invitation token arrives in the fragment (#invite=<64 hex>), is
 * moved to sessionStorage and removed from the address before any other
 * script runs, and is only ever sent in a POST body. Loads no analytics. */
(function () {
  'use strict';
  var SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
  var KEY = 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
  var STORE = 'mcc.fellow.invitation';
  var SITE = location.origin + location.pathname;

  var hash = new URLSearchParams(location.hash.slice(1));
  var token = hash.get('invite');
  var wantsRequest = location.hash === '#request';
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    try { sessionStorage.setItem(STORE, JSON.stringify({ token: token, at: Date.now() })); } catch (_) {}
    history.replaceState(null, '', location.pathname);
  } else {
    token = null;
    try {
      var kept = JSON.parse(sessionStorage.getItem(STORE) || 'null');
      if (kept && Date.now() - kept.at < 3 * 3600 * 1000 && /^[a-f0-9]{64}$/.test(kept.token)) token = kept.token;
    } catch (_) {}
  }

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function say(msg) { var s = $('foStatus'); if (s) s.textContent = msg || ''; }
  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }

  function accessToken() {
    if (!window.MCC || !MCC.refreshIfNeeded) return Promise.resolve(null);
    return MCC.refreshIfNeeded().then(function (s) { return s && s.access_token ? s.access_token : null; }).catch(function () { return null; });
  }
  /* One door to the database. A missing function (the pending SQL is not
     applied yet) comes back as { missing: true }, never as a thrown error. */
  function call(name, body) {
    return accessToken().then(function (bearer) {
      return fetch(SB + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: { apikey: KEY, authorization: 'Bearer ' + (bearer || KEY), 'content-type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = null; try { data = t ? JSON.parse(t) : null; } catch (_) { data = t; }
        if (res.status === 404 || (data && data.code === 'PGRST202')) return { missing: true };
        if (!res.ok) throw new Error(friendly((data && (data.message || data.error)) || ('Request failed ' + res.status)));
        return { data: data };
      });
    });
  }
  function friendly(msg) {
    if (/INVITATION_UNAVAILABLE/.test(msg)) return 'This invitation has expired, was already used, or was replaced. Ask Matthew for a new link.';
    return msg;
  }
  function links() {
    return ($('foLinks').value || '').split(/\s+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 5);
  }

  var state = null;
  var cohort = null;

  function paint() {
    ['foInvite', 'foAccount', 'foApply', 'foState', 'foSteps', 'foDesk'].forEach(function (id) { show(id, false); });
    var signedIn = state && state.signed_in;
    cohort = (state && state.cohorts && state.cohorts[0]) || null;
    var mine = state && state.enrollment;

    if (token) {
      show('foInvite', true);
      $('foInviteLine').textContent = 'This invitation is for ' + (cohort ? cohort.title : 'an Equity Uprise cohort') + '. Sign in, then tell us the change you want to see to accept it.';
    }
    if (!signedIn) {
      show('foAccount', true);
      say(token ? 'Sign in to accept your invitation.' : 'Sign in to see where you are, or to ask for an invitation.');
      return;
    }
    if (mine && mine.status !== 'declined' && mine.status !== 'withdrawn') {
      show('foState', true);
      var line = {
        requested: 'Your request is with the desk. A person reads every one; you will see the answer here.',
        accepted: 'You are accepted. Finish the three steps below to take your seat in the cohort.',
        fellow: 'You are a fellow of ' + (cohort ? cohort.title : 'the cohort') + '. Welcome.'
      }[mine.status] || '';
      $('foStateLine').textContent = line + (mine.review_note ? ' Note from the desk: ' + mine.review_note : '');
      if (mine.status === 'accepted' || mine.status === 'fellow') {
        show('foChecks', true);
        document.querySelectorAll('#foChecks li').forEach(function (li) { li.classList.toggle('is-done', !!(mine.steps && mine.steps[li.dataset.step])); });
      }
      if (mine.status === 'accepted') {
        show('foSteps', true);
        document.querySelectorAll('#foSteps form').forEach(function (f) { f.hidden = !!(mine.steps && mine.steps[f.dataset.step]); });
      }
      say('');
    } else if (token) {
      show('foApply', true);
      $('foApplyTitle').textContent = 'Accept your invitation';
      $('foApplySubmit').textContent = 'Accept my invitation';
      say(mine && mine.status === 'declined' ? 'Your earlier request was declined, but this invitation still opens a seat.' : '');
    } else if (cohort && cohort.requests_open) {
      show('foApply', true);
      $('foApplyTitle').textContent = 'Ask for an invitation';
      $('foApplySubmit').textContent = 'Send my request';
      say(mine && mine.status === 'declined' ? 'Your request was declined' + (mine.review_note ? ': ' + mine.review_note : '.') : '');
    } else {
      say('The fellowship is invite only right now and requests are closed. If you were invited, open the private link from your invitation.');
    }
    if (state.is_desk) paintDesk();
  }

  function paintDesk() {
    show('foDesk', true);
    call('eu_fellow_desk', {}).then(function (r) {
      if (!r || r.missing || !r.data) return;
      var d = r.data;
      var c = (d.cohorts || [])[0];
      var toggle = $('foToggleRequests');
      toggle.textContent = c && c.requests_open ? 'Close requests' : 'Open requests';
      toggle.onclick = function () {
        if (!c) return;
        toggle.disabled = true;
        call('eu_fellow_set_requests_open', { p_cohort_id: c.cohort_id, p_open: !c.requests_open })
          .then(load).catch(function (e) { say(e.message); }).finally(function () { toggle.disabled = false; });
      };
      var q = $('foQueue'); q.textContent = '';
      if (!(d.enrollments || []).length) q.appendChild(el('p', 'uf-muted', 'Nobody yet.'));
      (d.enrollments || []).forEach(function (e) {
        var row = el('div', 'uf-row');
        var left = el('div');
        left.appendChild(el('b', null, e.display_name + (e.discipline ? ' · ' + e.discipline : '')));
        left.appendChild(el('p', 'uf-muted', e.status + ' · ' + (e.path === 'invite' ? 'invited' : 'asked') + ' · ' + e.statement));
        row.appendChild(left);
        if (e.status === 'requested') {
          var act = el('div', 'uf-actions');
          ['accepted', 'declined'].forEach(function (dec) {
            var b = el('button', 'uf-btn' + (dec === 'accepted' ? ' uf-btn--primary' : ''), dec === 'accepted' ? 'Accept' : 'Decline');
            b.type = 'button';
            b.onclick = function () {
              b.disabled = true;
              var note = window.prompt(dec === 'accepted' ? 'Optional note for the fellow' : 'Optional note explaining the decision') || '';
              call('eu_fellow_review', { p_enrollment_id: e.id, p_decision: dec, p_note: note }).then(load).catch(function (x) { say(x.message); b.disabled = false; });
            };
            act.appendChild(b);
          });
          row.appendChild(act);
        }
        q.appendChild(row);
      });
      var inv = $('foInvites'); inv.textContent = '';
      if (!(d.invites || []).length) inv.appendChild(el('p', 'uf-muted', 'No invitations yet.'));
      (d.invites || []).forEach(function (i) {
        var row = el('div', 'uf-row');
        row.appendChild(el('span', null, (i.label || 'Invitation') + ' · ' + i.state + ' · expires ' + new Date(i.expires_at).toLocaleDateString()));
        if (i.state === 'open') {
          var b = el('button', 'uf-btn', 'Revoke'); b.type = 'button';
          b.onclick = function () { b.disabled = true; call('eu_fellow_revoke_invite', { p_token_hash: i.token_hash }).then(load).catch(function (x) { say(x.message); }); };
          row.appendChild(b);
        }
        inv.appendChild(row);
      });
      $('foInviteForm').onsubmit = function (ev) {
        ev.preventDefault();
        if (!c) return;
        call('eu_fellow_issue_invite', { p_cohort_id: c.cohort_id, p_label: $('foInviteLabel').value, p_days: Number($('foInviteDays').value) })
          .then(function (out) {
            if (!out || !out.data) return;
            $('foInviteLink').textContent = SITE + '#invite=' + out.data.token;
            show('foInviteOut', true);
            $('foInviteLabel').value = '';
            return load(true);
          }).catch(function (x) { say(x.message); });
      };
    }).catch(function () {});
  }

  function load(keepInviteOut) {
    return call('eu_fellow_status', {}).then(function (r) {
      if (r.missing) {
        say('The fellowship desk is not open online yet. If you were invited, keep your link; it will work once the desk opens.');
        return;
      }
      state = r.data || {};
      if (token && state.signed_in) {
        return call('eu_fellow_invite_preview', { p_token: token }).then(function (p) {
          if (p && !p.missing && !p.data) {
            token = null;
            try { sessionStorage.removeItem(STORE); } catch (_) {}
            paint();
            say('This invitation has expired, was already used, or was replaced. Ask Matthew for a new link.');
            return;
          }
          paint();
        });
      }
      paint();
      if (!keepInviteOut) show('foInviteOut', false);
      if (wantsRequest && $('foApply') && !$('foApply').hidden) $('foApply').scrollIntoView({ block: 'start' });
    }).catch(function () {
      say('The fellowship desk could not be reached. Check your connection and reload this page.');
    });
  }

  function wire() {
    $('foSignIn').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = ev.target.querySelector('button'); btn.disabled = true;
      say('Signing in…');
      if (!window.MCC) { say('Account sign in could not load. Reload this page.'); btn.disabled = false; return; }
      MCC.signInWithPassword($('foEmail').value, $('foPassword').value)
        .then(function () { $('foPassword').value = ''; return load(); })
        .catch(function (e) { say(e.message); })
        .finally(function () { btn.disabled = false; });
    });
    $('foApplyForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = $('foApplySubmit'); btn.disabled = true;
      var body = { p_display_name: $('foName').value, p_discipline: $('foDiscipline').value, p_statement: $('foStatement').value, p_work_links: links() };
      var go = token ? call('eu_fellow_accept_invite', Object.assign({ p_token: token }, body))
                     : call('eu_fellow_apply', Object.assign({ p_cohort_id: cohort && cohort.cohort_id }, body));
      go.then(function (r) {
        if (r && r.missing) { say('The fellowship desk is not open online yet.'); return; }
        if (token) { token = null; try { sessionStorage.removeItem(STORE); } catch (_) {} }
        return load();
      }).catch(function (e) { say(e.message); }).finally(function () { btn.disabled = false; });
    });
    document.querySelectorAll('#foSteps form').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = f.querySelector('button'); btn.disabled = true;
        call('eu_fellow_onboarding_step', { p_step: f.dataset.step, p_value: f.elements.value.value })
          .then(function () { return load(); }).catch(function (e) { say(e.message); })
          .finally(function () { btn.disabled = false; });
      });
    });
  }

  function start() { wire(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
