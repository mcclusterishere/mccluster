/* Identity verification levels: the capture rules, the page, the owner
   queue and the pending schema's shape.
   docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md
   Database BEHAVIOUR (real roles, RLS, storage policies) is proven by
   scripts/test-identity-verification-db.sh on a scratch Postgres; this file
   pins the static contract so a later edit cannot quietly open a file path
   or a public read. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const C = require("../../js/identity-capture-core.js");
const page = read("identity-verify.html");
const pageJs = read("js/identity-verify.js");
const coreJs = read("js/identity-capture-core.js");
const review = read("js/control-room/identity-review.js");
const sql = read("supabase/pending/20261015230000_identity_verification_levels_v1.sql");
const rollback = read("supabase/pending/20261015230000_identity_verification_levels_v1.rollback.sql");
const fn = (name) => {
  const m = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`).exec(sql);
  assert.ok(m, `function ${name} exists`);
  return m[0];
};
const track = (readyState, enabled = true) => ({ readyState, enabled });
const stream = (...tracks) => ({ getVideoTracks: () => tracks });

test("NO FILE UPLOAD PATH: the capture page and its scripts never read a file from disk", () => {
  for (const [name, src] of [["identity-verify.html", page], ["js/identity-verify.js", pageJs], ["js/identity-capture-core.js", coreJs]]) {
    assert.doesNotMatch(src, /type\s*=\s*["']?file/i, `${name}: no file input`);
    assert.doesNotMatch(src, /FileReader|showOpenFilePicker|webkitdirectory|\bcapture\s*=\s*["']/i, `${name}: no file reading or OS capture handoff`);
    assert.doesNotMatch(src, /accept\s*=\s*["'][^"']*video/i, `${name}: no video accept attribute`);
  }
  assert.match(pageJs, /navigator\.mediaDevices\.getUserMedia\(/);
  assert.match(pageJs, /new window\.MediaRecorder\(S\.stream/);
  assert.match(pageJs, /C\.assertLiveStream\(stream\)/, "the stream is checked live before a challenge is requested");
  assert.match(pageJs, /C\.assertLiveStream\(S\.stream\)/, "and again before recording");
});

test("a stream without a live, enabled video track is refused", () => {
  assert.throws(() => C.assertLiveStream(null), /No live camera stream/);
  assert.throws(() => C.assertLiveStream({}), /No live camera stream/);
  assert.throws(() => C.assertLiveStream(stream()), /not live/);
  assert.throws(() => C.assertLiveStream(stream(track("ended"))), /not live/);
  assert.throws(() => C.assertLiveStream(stream(track("live", false))), /not live/);
  assert.equal(C.assertLiveStream(stream(track("ended"), track("live"))).readyState, "live");
});

test("a recording is sendable only if it is live, typed, sized, timed and inside its challenge window", () => {
  const ok = { level: "v1_live_intro", source: "getUserMedia", size: 2e6, mime: "video/webm;codecs=vp8,opus", durationMs: 20000, challengeExpiresAt: new Date(Date.now() + 60000).toISOString() };
  assert.deepEqual(C.validateRecording(ok), { ok: true });
  assert.equal(C.validateRecording({ ...ok, source: "file" }).ok, false);
  assert.equal(C.validateRecording({ ...ok, mime: "image/jpeg" }).ok, false);
  assert.equal(C.validateRecording({ ...ok, size: 0 }).ok, false);
  assert.equal(C.validateRecording({ ...ok, size: C.MAX_BYTES + 1 }).ok, false);
  assert.equal(C.validateRecording({ ...ok, durationMs: 1000 }).ok, false);
  assert.equal(C.validateRecording({ ...ok, durationMs: 90000 }).ok, false, "V1 is at most 60 s");
  assert.equal(C.validateRecording({ ...ok, level: "v2_halo_full", durationMs: 90000 }).ok, true, "V2 allows 120 s");
  assert.equal(C.validateRecording({ ...ok, challengeExpiresAt: new Date(Date.now() - 1000).toISOString() }).ok, false, "an expired code cannot be sent");
  assert.equal(C.captureMeta(track("live"), "video/mp4").source, "getUserMedia");
  assert.equal(C.captureMeta(track("ended")).track_state, "ended");
});

test("CONSENT and the NONCE come first: no challenge without consent, a name, and (V1) location consent", () => {
  const base = { level: "v1_live_intro", consentVersion: "v1-x", consentAccepted: true, name: "Em Member", locationConsent: true };
  assert.equal(C.validateStart(base).ok, true);
  assert.match(C.validateStart({ ...base, consentAccepted: false }).error, /consent/i);
  assert.match(C.validateStart({ ...base, consentVersion: null }).error, /consent/i);
  assert.match(C.validateStart({ ...base, name: "Em" }).error, /first and last name/);
  assert.match(C.validateStart({ ...base, locationConsent: false }).error, /region/);
  assert.match(C.validateStart({ ...base, level: "v2_halo_full", locationConsent: false }).error, /access/);
  const lines = C.scriptLines("v2_halo_full", "Em Member", "harbor 4821", "the analyst globe");
  assert.ok(lines.some((l) => l.includes("harbor 4821")) && lines.some((l) => l.includes("Em Member")) && lines.some((l) => /promise/.test(l)) && lines.some((l) => /access to the analyst globe/.test(l)));
  // the server, not the browser, issues the phrase, and it is required on every row
  assert.match(sql, /challenge_phrase text not null check \(challenge_phrase ~ '\^\[a-z\]\{3,12\} \[0-9\]\{4\}\$'\)/);
  assert.match(fn("identity_start_submission"), /v_phrase := public\.identity_challenge_phrase\(\)/);
  assert.match(fn("identity_start_submission"), /consent required/);
  assert.match(fn("identity_start_submission"), /location consent required/);
  assert.match(fn("identity_start_submission"), /interval '10 minutes'/);
  assert.match(fn("identity_finish_submission"), /only a live camera recording is accepted/);
  assert.match(fn("identity_finish_submission"), /from storage\.objects/, "finish checks the real stored object, not the client's word");
});

test("the consent text says what the owner directed: comparison disclosed, owner + named admins, retention N, deletion, no AI training, never public", () => {
  for (const level of ["v1-live-intro-2026-10-draft1", "v2-halo-full-2026-10-draft1"]) {
    const body = new RegExp(`'${level}'[\\s\\S]*?\\$c\\$([\\s\\S]*?)\\$c\\$`).exec(sql)[1];
    assert.match(body, /review your submissions together, including comparing them/i, level);
    assert.match(body, /owner\) personally reviews/i, level);
    assert.match(body, /admins the owner names/i, level);
    assert.match(body, /\[N\] days after/i, level);
    assert.match(body, /ask us to delete/i, level);
    assert.match(body, /never used to train any AI/i, level);
    assert.match(body, /never public|It is never public/i, level);
    assert.match(body, /No computer program measures or matches your face/i, level);
  }
  assert.deepEqual(C.consentParagraphs("Keep [N] days.\n\nSecond.", 30), ["Keep 30 days.", "Second."]);
  // drafts only: a consent goes live only with owner approval, N and a counsel review date
  assert.match(sql, /check \(status <> 'active' or \(approved_at is not null and approved_by is not null\s+and retention_days is not null and counsel_reviewed_at is not null\)\)/);
  assert.doesNotMatch(sql, /status\) values[^;]*'active'/, "no consent is seeded active");
});

test("RLS-SHAPED ACCESS: private bucket; a member inserts once at the issued path and reads nothing; only reviewers read or delete", () => {
  assert.match(sql, /values \('identity-verification-videos', 'identity-verification-videos', false, 52428800, array\['video\/webm','video\/mp4'\]\)/);
  const policies = [...sql.matchAll(/create policy "identity videos: [^"]+" on storage\.objects for (\w+) to (\w+)\s+(?:with check|using) \(([\s\S]*?)\);\n/g)].map((m) => ({ op: m[1], role: m[2], expr: m[3] }));
  assert.deepEqual(policies.map((p) => p.op).sort(), ["delete", "insert", "select"], "no UPDATE policy: a video can never be replaced");
  assert.ok(policies.every((p) => p.role === "authenticated"), "no anon policy");
  const ins = policies.find((p) => p.op === "insert").expr;
  assert.match(ins, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.match(ins, /identity_can_upload\(name\)/);
  for (const op of ["select", "delete"]) assert.match(policies.find((p) => p.op === op).expr, /identity_is_reviewer\(\)/, op);
  assert.match(fn("identity_can_upload"), /s\.status = 'awaiting_capture' and now\(\) <= s\.challenge_expires_at/);
  // reviewer = owner, or a NAMED admin
  assert.match(fn("identity_is_reviewer"), /eu_is_admin\(\)/);
  assert.match(fn("identity_is_reviewer"), /identity_reviewers/);
  for (const t of ["identity_submissions", "identity_review_log", "identity_persona_events", "identity_reviewers", "identity_consent_acceptances"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} force row level security`), `${t} forces RLS`);
    assert.match(sql, new RegExp(`revoke all on public\\.[\\w, .]*${t}[\\w, .]* from public, anon, authenticated`), `${t} has no default API grants`);
  }
  assert.match(sql, /create policy "member or reviewer reads submissions" on public\.identity_submissions for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) or \(select public\.identity_is_reviewer\(\)\)\)/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*identity_submissions[^;]*to authenticated/, "members never write submissions directly");
  // service-role-only Persona functions
  for (const f of ["identity_apply_persona_event", "identity_record_persona_inquiry", "identity_entitlement_for", "identity_submission_for_persona"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;\\ngrant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
  }
});

test("ENTITLEMENT ONLY AFTER OWNER APPROVAL: one writer of verified rows, and the halo_full rule ships disabled awaiting counsel", () => {
  const writers = [...sql.matchAll(/insert into public\.action_member_verifications/g)];
  assert.equal(writers.length, 1, "exactly one place writes a verification row");
  const decide = fn("identity_review_decide");
  assert.match(decide, /insert into public\.action_member_verifications/);
  assert.match(decide, /if p_decision = 'approve' then\s+v_purpose/);
  assert.match(decide, /identity_is_reviewer\(\)/);
  assert.match(decide, /you cannot review your own submission/);
  assert.match(decide, /persona_status, ''\) <> 'approved'/, "full access needs Persona approved");
  assert.match(decide, /their live introduction is not approved/, "full access needs the approved V1");
  assert.match(sql, /\('halo_full', [^\n]*\n\s+null, null, '\{"purpose": "halo_full", "sla_hours": 24\}', false, false, true\)/);
  assert.match(fn("action_unlock_progress"), /v\.purpose = 'referral_signup'/, "E=Up counts live introductions only");
  // the log is append-only
  assert.match(fn("identity_log_immutable"), /append-only/);
  assert.match(sql, /create trigger identity_review_log_immutable before update or delete on public\.identity_review_log/);
});

test("nothing biometric or ID-document shaped is stored", () => {
  const columns = (/create table if not exists public\.identity_submissions \(([\s\S]*?)\n\);/.exec(sql) || [])[1];
  assert.ok(columns);
  assert.doesNotMatch(columns, /face|template|embedding|landmark|document_number|id_image|birthdate|date_of_birth|ssn/i);
  assert.match(columns, /persona_birth_year smallint/);
});

test("rollback reverses every object the file creates", () => {
  for (const name of [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])) {
    if (name === "action_unlock_progress") continue; // restored by re-running the ladder file
    assert.match(rollback, new RegExp(`drop function if exists public\\.${name}\\(`), `rollback drops ${name}`);
  }
  for (const t of ["identity_persona_events", "identity_review_log", "identity_submissions", "identity_consent_acceptances", "identity_consent_versions", "identity_reviewers"]) assert.match(rollback, new RegExp(t), t);
  assert.match(rollback, /delete from storage\.buckets where id = 'identity-verification-videos'/);
  assert.match(rollback, /BEFORE running: delete/);
});

test("phone first: the capture page follows the 390px rules", () => {
  assert.doesNotMatch(page, /max-width\s*:\s*\d+px\s*\)/, "no max-width media queries");
  assert.doesNotMatch(page, /@media\s*\(\s*max-width/);
  assert.doesNotMatch(page, /repeat\(\s*\d+\s*,\s*1fr\)|[\s:]1fr[;\s]/, "minmax(0,1fr), never a bare 1fr");
  assert.match(page, /input,select,textarea\{[^}]*font-size:max\(16px,1rem\)/);
  assert.doesNotMatch(page, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(page, /js\/tabbar\.js/);
  assert.doesNotMatch(page, /<svg|<img/i, "no drawn or placed marks on this page");
});

test("owner queue: logged open, five-minute signed URLs, side by side, decisions through one RPC", () => {
  assert.match(review, /rpc\/identity_review_open/);
  assert.match(review, /object\/sign\//);
  assert.match(review, /Math\.min\(300,/);
  assert.match(review, /rpc\/identity_review_decide/);
  assert.match(review, /idr-pair/);
  assert.match(review, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(review, /min-width:900px/);
  assert.doesNotMatch(review, /download\s*=|createObjectURL/, "the queue never saves a copy");
  const control = read("control.html");
  assert.match(control, /js\/control-room\/identity-review\.js/);
  assert.match(read("js/control-room/action-network.js"), /\["identity","Identity"\]/);
});
