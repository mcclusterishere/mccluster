/* THE GATED TRACK: three admin-verified missions + a verified identity, and
   every mission completion approved by an admin.

   The rule itself is enforced in SQL (supabase/pending/
   gated_track_mission_identity_v1.sql) and the Worker
   (workers/mccluster/src/music/router.js); both are exercised elsewhere
   (scripts/test-mission-admin-approval-db.sh, workers/mccluster/test/
   music-gate.test.mjs). Here: the browser only REFLECTS the server's answer
   (the 0-3 x identity matrix of what a locked row says), preview and full
   plays are separate events, and the pending SQL keeps its shape. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function loadGatedAudio({ session = null } = {}) {
  const win = {
    MCC: { session: () => session },
    addEventListener() {},
    dispatchEvent() {},
    fetch: () => { throw new Error('the matrix must not touch the network'); }
  };
  win.window = win;
  vm.runInNewContext(read('js/gated-audio.js'), { window: win, CustomEvent: function () {}, fetch: win.fetch, Date, Promise, Number, String });
  return win.MCC_GATED;
}

/* What the Worker hands back for a member (music_gate_rule_state). */
function gate(have, identity, signedIn = true) {
  const missing = [];
  if (!signedIn) missing.push('sign_in');
  if (have < 3) missing.push('missions');
  if (!identity) missing.push('identity_verification');
  return {
    mode: 'rule', allowed: signedIn && have >= 3 && identity, signed_in: signedIn,
    missions: { have, need: 3 }, identity_verified: identity, missing,
    links: { missions: 'mnet.html?view=missions', identity: 'identity-verify.html' }
  };
}

test('the locked row reflects the server: 0-3 missions x identity verified or not', () => {
  const G = loadGatedAudio({ session: { access_token: 't' } });
  for (const have of [0, 1, 2, 3]) {
    for (const identity of [false, true]) {
      const g = gate(have, identity);
      const out = g.allowed ? { state: 'earned', gate: g } : { state: 'locked', gate: g };
      const line = G.progress(out);
      const why = G.explain(out);
      const label = `${have}/3 missions, identity ${identity}`;
      if (have >= 3 && identity) {
        assert.equal(out.state, 'earned', label);
        assert.deepEqual({ b: line.b, s: line.s }, { b: 'PLAY', s: 'full track' }, label);
        assert.equal(why.text, '', label);
        continue;
      }
      if (have < 3) {
        assert.equal(line.b, `${have}/3 MISSIONS`, label);
        assert.match(why.text, new RegExp(`3 verified missions \\(you have ${have}\\)`), label);
        assert.equal(why.links[0].href, 'mnet.html?view=missions', `${label}: the first step is the missions`);
      } else {
        assert.equal(line.b, 'VERIFY ID', label);
        assert.doesNotMatch(why.text, /missions/, `${label}: missions are done, so they are not named`);
      }
      if (!identity) {
        assert.match(why.text, /a verified identity/, label);
        assert.ok(why.links.some((l) => l.href === 'identity-verify.html'), `${label}: links to identity verification`);
      } else {
        assert.doesNotMatch(why.text, /identity/, `${label}: identity is done, so it is not named`);
      }
    }
  }
});

test('signed out: the row says what the full track takes, and asks for sign-in first', () => {
  const G = loadGatedAudio();
  const why = G.explain({ state: 'preview', gate: gate(0, false, false) });
  assert.match(why.text, /3 verified missions \(you have 0\) and a verified identity\. Sign in first\./);
  assert.equal(why.links[0].href, 'account.html');
});

test('the client cannot open the master: no storage signing, play goes through the Worker', () => {
  const src = read('js/gated-audio.js');
  assert.doesNotMatch(src, /storage\/v1\/object\/sign/);
  assert.match(src, /if \(!token && method === "POST"\) return Promise\.resolve\(\{ status: 401/);
  assert.doesNotMatch(src, /five DIFFERENT other songs/, 'the old listen rule is gone from the client copy');
});

test('preview plays and full plays are distinct events; a full play only after the Worker granted it', () => {
  const html = read('album.html');
  assert.match(html, /function gatedPlayEvent\(row, full\)[\s\S]*?full \? "music_full_play" : "music_preview_play"/);
  const grant = html.slice(html.indexOf('function claimThenPlay'), html.indexOf('function spend('));
  const full = grant.indexOf('gatedPlayEvent(row, true)');
  assert.ok(full > grant.indexOf('row.setAttribute("data-granted", "")'), 'music_full_play is recorded only after the Worker returned a play');
  assert.ok(grant.indexOf('gatedPlayEvent(row, false)') > -1 && grant.indexOf('gatedPlayEvent(row, false)') < full,
    'a refused claim plays (and counts) the preview');
  assert.doesNotMatch(html.slice(html.indexOf('function gatedPlayEvent'), html.indexOf('function gatedPlayEvent') + 400), /email|user_id|m_uid|uid/,
    'no personal data beyond the analytics model (track, album, source)');
  assert.doesNotMatch(html, /tap here · free/, 'the record is no longer "free with an account"');
  const suite = read('js/analytics-suite.js');
  assert.match(suite, /key:"Full plays"/);
  assert.match(suite, /key:"Preview plays",value:music\.preview_plays/, 'owner analytics shows both counts');
  const engine = read('js/music-engine.js');
  assert.match(engine, /out\.state === "full" \? "music_full_play" : "music_preview_play"/, 'the mini player already splits them');
});

test('the gated rule is a data row, read server-side, and the identity helper is the one contract', () => {
  const sql = read('supabase/pending/gated_track_mission_identity_v1.sql');
  assert.match(sql, /create or replace function public\.member_identity_verified\(p_user uuid, p_purpose text default 'referral_signup'\)/);
  assert.match(sql, /v\.purpose = coalesce\(p_purpose, 'referral_signup'\) and v\.status = 'verified'/);
  assert.doesNotMatch(sql, /information_schema|v1_live_intro|v\.level/, 'identity is keyed by purpose (PR #443), never a level column');
  assert.match(sql, /array\['music_full_track:niggy-nigg'\], 'identity_verified', null, null,\s*'\{"purpose": "referral_signup", "min_verified_missions": 3/);
  // the same requirement-kind list and purpose check PR #443 sets, so either apply order is clean
  assert.match(sql, /'registration_assists','identity_verified'\)\);/);
  assert.match(sql, /check \(requirement_kind <> 'identity_verified' or params->>'purpose' in \('referral_signup','halo_full'\)\)/);
  const gate = sql.slice(sql.indexOf('create or replace function public.music_gate_rule_state'));
  assert.doesNotMatch(gate.slice(0, gate.indexOf('$$;')), /action_unlock_progress/, 'the gate evaluates the rule itself, whatever order #443 was applied in');
  const claim = sql.slice(sql.indexOf('create or replace function public.music_gate_claim_rule'));
  assert.ok(claim.indexOf("if not coalesce((v_state->>'allowed')::boolean, false) then") < claim.indexOf('insert into public.music_gated_plays'),
    'the play row (the stream token) is written only after the rule allowed it');
  assert.match(sql, /revoke all on function public\.music_gate_claim_rule\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql, /action_member_verified_mission_count\(p_user\)/, 'missions are the shared admin-verified count');
});

test('every mission-completion path is guarded in the pending approval file', () => {
  const sql = read('supabase/pending/mission_admin_approval_v1.sql');
  for (const [table, trigger] of [
    ['action_proofs', 'action_proof_verify_guard'],
    ['action_mission_assignments', 'action_assignment_verify_guard'],
    ['action_points_ledger', 'action_points_mint_guard'],
    ['action_bounty_claims', 'action_bounty_claim_guard'],
    ['action_antisocial_levels', 'action_antisocial_level_review_guard'],
    ['action_antisocial_levels', 'action_antisocial_review_archive'],
    ['action_clip_submissions', 'action_clip_submission_review_guard'],
    ['action_clip_earnings', 'action_clip_earning_release_guard'],
    ['action_clip_campaigns', 'action_clip_campaign_review_guard'],
    ['action_missions', 'action_mission_publish_guard']
  ]) {
    assert.match(sql, new RegExp(`create trigger ${trigger} [^;]* on public\\.${table}`), `${trigger} on ${table}`);
  }
  assert.doesNotMatch(sql.slice(sql.indexOf('create or replace function public.clip_release_due')), /'not_required'/,
    'the scheduled release never treats a clip as needing no review');
  const rollback = read('supabase/pending/mission_admin_approval_v1.rollback.sql');
  for (const t of ['action_proof_verify_guard', 'action_assignment_verify_guard', 'action_points_mint_guard', 'action_mission_publish_guard']) {
    assert.match(rollback, new RegExp(`drop trigger if exists ${t}`), `rollback drops ${t}`);
  }
});
