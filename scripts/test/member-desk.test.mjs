/* The member desk over the World globe, and the profile edit gate.
   docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md
   The database behaviour is proven by scripts/test-profile-edit-gate-db.sh;
   the browser behaviour by scripts/e2e/member-desk.e2e.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../../js/member-desk-core.js");
const CAP = require("../../js/identity-capture-core.js");
const read = (p) => readFile(new URL("../../" + p, import.meta.url), "utf8");

test("desk capability matrix: what each kind of member sees", () => {
  const cap = (x) => D.capabilities(x);
  const guest = cap({ signedIn: false, creator: true, entitlement: { paid: true }, ladder: { policy_seats: [{}] } });
  assert.deepEqual(guest, { signedIn: false, creator: false, business: false, fellow: false }, "a guest gets nothing from claims");
  assert.deepEqual(D.sections(guest), [], "guests have no member workspace on World");
  assert.equal(D.policyMode(guest), null);
  assert.deepEqual(D.sections(null), []);
  assert.equal(D.policyMode({ fellow: true }), null, "a fellow claim cannot open a signed-out desk");

  const fan = cap({ signedIn: true });
  assert.deepEqual(D.sections(fan), ["profile", "missions", "notifications", "policy"]);
  assert.equal(D.policyMode(fan), "ladder");

  const creator = cap({ signedIn: true, creator: true });
  assert.deepEqual(D.sections(creator), ["profile", "missions", "notifications", "creator", "policy"]);

  const business = cap({ signedIn: true, entitlement: { paid: true } });
  assert.deepEqual(D.sections(business), ["profile", "missions", "notifications", "business", "policy"]);
  assert.equal(cap({ signedIn: true, sites: 2 }).business, true, "an owned analytics site is a business desk too");
  assert.equal(cap({ signedIn: true, entitlement: { paid: false }, sites: 0 }).business, false);

  const fellow = cap({ signedIn: true, ladder: { policy_seats: [{ cohort_id: "c" }] } });
  assert.deepEqual(D.sections(fellow), ["profile", "policy", "missions", "notifications"], "a fellow's memo desk comes right after the profile");
  assert.equal(D.policyMode(fellow), "memo_desk");
  assert.equal(cap({ signedIn: true, ladder: { fellowship_application: { status: "accepted" } } }).fellow, true);
  assert.equal(cap({ signedIn: true, ladder: { fellowship_application: { status: "submitted" } } }).fellow, false);

  const all = cap({ signedIn: true, creator: true, entitlement: { paid: true }, ladder: { policy_seats: [{}] } });
  assert.deepEqual(D.sections(all), ["profile", "policy", "missions", "notifications", "creator", "business"]);
});

test("mission buckets follow action_record statuses; verified means admin-approved", () => {
  const b = D.missionBuckets({ missions: [{ status: "joined" }, { status: "submitted" }, { status: "verified" }, { status: "rejected" }] });
  assert.equal(b.inProgress.length, 2);
  assert.equal(b.verified.length, 1);
  assert.equal(b.other.length, 1);
  assert.deepEqual(D.missionBuckets(null), { inProgress: [], verified: [], other: [] });
});

test("desk deep links and the old Policy address", () => {
  assert.equal(D.deskParam("?view=feed"), null);
  assert.equal(D.deskParam("?desk=1"), "open");
  assert.equal(D.deskParam("?view=feed&desk=policy"), "policy");
  assert.equal(D.deskParam("?desk=welcome"), "open");
  assert.equal(D.deskParam("?desk=<script>"), "open");
  assert.equal(D.deskUrl("policy"), "mnet.html?view=feed&desk=policy");
  assert.equal(D.policyRedirect("", ""), "mnet.html?view=feed&desk=policy");
  assert.equal(D.policyRedirect("?region=US-CT&status=passed", "#bills"), "mnet.html?view=feed&desk=policy&region=US-CT&status=passed#bills");
  assert.equal(D.policyRedirect("?region=%3Cx%3E&next=https://evil.example", "#a b"), "mnet.html?view=feed&desk=policy", "nothing else rides along");
});

test("nav: Policy is no longer a separate destination; every door opens the desk", async () => {
  const [mnet, page, globe, eq, tabbar] = await Promise.all([read("mnet.html"), read("action-policy.html"), read("action-globe.html"), read("equity-uprise.html"), read("js/tabbar.js")]);
  assert.doesNotMatch(mnet, /href="action-policy\.html"/, "the World links nowhere else for Policy");
  assert.doesNotMatch(mnet, /data-world-chip="policy"/, "the minimal globe does not add a separate Policy control");
  for (const s of ["js/member-desk-core.js", "js/identity-capture-core.js", "js/profile-edit-gate.js", "js/member-desk.js"]) assert.ok(mnet.indexOf(s) > mnet.indexOf("js/tabbar.js"), s + " loads after the bar");
  assert.match(mnet, /css\/member-desk\.css/);
  assert.doesNotMatch(globe, /href="action-policy\.html"/);
  assert.match(globe, /href="mnet\.html\?view=feed&amp;desk=policy"/);
  assert.doesNotMatch(eq, /href="action-policy\.html"/);
  // the old address still answers: it sends people into the desk
  assert.match(page, /noindex/);
  assert.match(page, /http-equiv="refresh" content="0; url=mnet\.html\?view=feed&amp;desk=policy"/);
  assert.match(page, /policyRedirect\(location\.search,location\.hash\)/);
  assert.doesNotMatch(page, /<section id="ladder"|js\/policy-fellowship-desk\.js/, "the policy desk is not rendered here any more");
  // the bar itself is not rewritten: three columns from tabbar.js, the Desk tab is added by the desk on the World only
  assert.doesNotMatch(tabbar, /data-hu-desk/);
  assert.match(tabbar, /action-policy\\\.html\$/, "the old address still rides on the World's hosts");
});

test("the desk is a layer over the globe that never covers the app bar", async () => {
  const [js, css] = await Promise.all([read("js/member-desk.js"), read("css/member-desk.css")]);
  assert.match(css, /z-index: 190; \/\* under the app bar \(200\)/);
  assert.match(css, /bottom: calc\(var\(--mn-bar-clear, 96px\) \+ 4px\)/, "the sheet sits above the bar");
  assert.match(css, /@media \(min-width: 64rem\)/, "a side panel from 64rem");
  assert.doesNotMatch(css, /max-width:\s*[\d.]+(px|rem|em)\s*\)/, "min-width queries only");
  assert.match(css, /font-size: max\(16px, 1rem\)/);
  assert.doesNotMatch(css, /grid-template-columns:[^;]*(?<!minmax\(0, )\b1fr/, "never a bare 1fr");
  assert.match(js, /new MutationObserver/, "the Desk tab comes back when the bar redraws");
  assert.match(js, /script\("js\/policy-fellowship-desk\.js"\)/, "the fellow memo desk runs inside the desk");
  assert.match(js, /script\("js\/action-policy\.js"\)/, "and the public registry");
  // reused endpoints only, under their own permissions
  for (const e of ["/v1/analytics/my-creator", "/v1/creator-billing/entitlement", "/v1/mnet/notifications", '"action_record"', '"policy_ladder_status"', '"music_creator_state"']) assert.ok(js.includes(e), e);
  assert.doesNotMatch(js, /\bip\b|ip_address|latitude|longitude/i, "no raw IPs or coordinates in the desk");
  assert.doesNotMatch(js, /<svg[^>]*class="[^"]*logo|equity-uprise-mark/, "the desk draws no logo");
});

test("profile edit gate states, from profile_edit_status()", () => {
  const consent = { version: "profile-edit-v1", body: "x" };
  assert.equal(D.gateState(null), "closed");
  assert.equal(D.gateState({ closed: true }), "closed");
  assert.equal(D.gateState({ signed_in: false }), "signed_out");
  assert.equal(D.gateState({ signed_in: true, consent: null }), "consent_pending", "drafts only: nothing can be recorded");
  assert.equal(D.gateState({ signed_in: true, consent }), "ready");
  assert.equal(D.gateState({ signed_in: true, consent, latest: { status: "awaiting_capture" } }), "awaiting_video");
  assert.equal(D.gateState({ signed_in: true, consent, require_persona: true, latest: { status: "submitted", persona_status: null } }), "waiting_persona");
  assert.equal(D.gateState({ signed_in: true, consent, require_persona: true, latest: { status: "submitted", persona_status: "approved" } }), "in_review");
  assert.equal(D.gateState({ signed_in: true, consent, require_persona: false, latest: { status: "submitted" } }), "in_review");
  assert.equal(D.gateState({ signed_in: true, consent, latest: { status: "approved", applied_at: "2026-10-16" } }), "applied");
  assert.equal(D.gateState({ signed_in: true, consent, latest: { status: "rejected" } }), "rejected");
  assert.equal(D.gateState({ signed_in: true, consent, latest: { status: "retake_requested" } }), "retake");
  for (const s of ["ready", "applied", "rejected", "retake", "withdrawn", "expired", "awaiting_video"]) assert.equal(D.canStart(s), true, s);
  for (const s of ["closed", "signed_out", "consent_pending", "waiting_persona", "in_review"]) assert.equal(D.canStart(s), false, s);
});

test("a change request mirrors profile_edit_start()", () => {
  const status = { fields: [
    { key: "legal_name", label: "Legal name", locked: true, requestable: true, max_length: 160, value: "Em Member" },
    { key: "handle", label: "Username (@handle)", locked: true, requestable: true, max_length: 32, pattern: "^[a-z0-9][a-z0-9._-]{2,31}$", value: "em.member" },
    { key: "payout_account", label: "Payout account", locked: true, requestable: false, value: "acct_1" },
    { key: "region", label: "State or region", locked: false, requestable: true, value: "" }
  ] };
  assert.deepEqual(D.validateChanges({ legal_name: " Em Q Member " }, status), { ok: true, changes: { legal_name: "Em Q Member" } });
  assert.equal(D.validateChanges({}, status).ok, false);
  assert.match(D.validateChanges({ legal_name: "Em Member" }, status).error, /already has that value/);
  assert.match(D.validateChanges({ handle: "Bad Handle!" }, status).error, /format/);
  assert.match(D.validateChanges({ payout_account: "acct_2" }, status).error, /own setup/);
  assert.match(D.validateChanges({ region: "NY" }, status).error, /not locked/, "an unset field is changed directly");
  assert.deepEqual(D.lockedFields(status).map((f) => f.key), ["legal_name", "handle", "payout_account"]);
  const lines = D.editScript("Em Member", "harbor 4821", ["legal name"], "I got married");
  assert.equal(lines[1], "My code is: harbor 4821.");
  assert.match(lines[2], /change my legal name/);
  assert.equal(D.FORM_FIELDS.legal_name, "mnLegalName");
});

test("the gate's capture is the identity levels' live-only capture", async () => {
  assert.equal(CAP.LEVELS.profile_edit.maxSeconds, 120);
  const ok = { level: "profile_edit", source: "getUserMedia", size: 2e6, mime: "video/webm", durationMs: 30000, challengeExpiresAt: new Date(Date.now() + 60000).toISOString() };
  assert.equal(CAP.validateRecording(ok).ok, true);
  assert.equal(CAP.validateRecording({ ...ok, source: "file" }).ok, false, "no file path");
  const gate = await read("js/profile-edit-gate.js");
  assert.doesNotMatch(gate, /type="file"|FileReader|<input[^>]*file/i, "no file input, ever");
  assert.match(gate, /getUserMedia/);
  assert.match(gate, /CAP\.assertLiveStream/);
  assert.match(gate, /"profile_edit_start"/);
  assert.match(gate, /"identity_finish_submission"/, "the same finish as V1/V2");
  assert.match(gate, /\/v1\/identity\/persona\/inquiry/, "the same Persona route");
  assert.match(gate, /x-upsert": "false"/);
});

test("server-side enforcement: a data-driven list, an invoker guard, a decision only the gate can make", async () => {
  const [sql, rb, readme, review, ctl, pe, mnetjs] = await Promise.all([read("supabase/pending/20261016010000_profile_edit_gate_v1.sql"), read("supabase/pending/20261016010000_profile_edit_gate_v1.rollback.sql"),
    read("supabase/pending/README.md"), read("js/control-room/identity-review.js"), read("control.html"), read("js/control-room/profile-edit-review.js"), read("js/mnet.js")]);
  for (const k of ["legal_name", "handle", "artist_name", "creator_handle", "region", "country", "globe_region", "payout_account", "display_name"]) assert.match(sql, new RegExp(`\\('${k}',`), k);
  assert.match(sql, /\('display_name',[^\n]*'network_profiles',[^\n]*false, true,/, "display name listed but off");
  assert.match(sql, /\('payout_account',[^\n]*true,  false,/, "payout locked, never by request");
  const guard = sql.slice(sql.indexOf("create or replace function public.profile_edit_guard()"), sql.indexOf("revoke all on function public.profile_edit_guard()"));
  assert.doesNotMatch(guard, /security definer/, "the guard runs as the writer");
  assert.match(guard, /coalesce\(v_claims->>'role', ''\) = 'authenticated'/, "a member through a definer RPC is still a member");
  assert.match(guard, /profile_field_locked/);
  assert.match(sql, /before update or delete on public\.%I/);
  assert.match(sql, /after insert or update of table_name on public\.profile_protected_fields/, "triggers follow the list");
  assert.match(sql, /profile edit requests are decided with profile_edit_review_decide\(\)/);
  assert.match(sql, /'profile-edit-2026-10-draft1'/);
  const body = /\$c\$([\s\S]*?)\$c\$/.exec(sql)[1];
  for (const re of [/review your submissions together, including comparing them/i, /No computer program measures or matches your face/i, /never used to train any AI/i, /\[N\] days after/i, /ask us to delete/i, /never public/i, /Persona/]) assert.match(body, re);
  assert.match(sql, /create trigger profile_edit_audit_immutable before update or delete on public\.profile_edit_audit/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*profile_edit_(requests|audit)[^;]*to (anon|authenticated)/);
  assert.match(rb, /drop table if exists public\.profile_edit_requests/);
  assert.match(rb, /if s\.level <> 'v2_halo_full' then raise exception 'only a full-access request uses the ID check'/, "rollback restores the identity function");
  assert.match(readme, /20261016010000_profile_edit_gate_v1\.sql/);
  // owner queue: a "Profile edit" type with its own decision call
  assert.match(review, /profile_edit: "Profile edit"/);
  assert.match(review, /data-level="' \+ e\(p\.level\) \+ '"/);
  assert.match(pe, /decideRpc: "rpc\/profile_edit_review_decide"/);
  assert.ok(ctl.indexOf("js/control-room/profile-edit-review.js") < ctl.indexOf("js/control-room/identity-review.js"));
  // the World's form shows the lock and explains the server's refusal
  assert.match(mnetjs, /window\.HU_EDIT_GATE\.lockForm\(\)/);
  assert.match(mnetjs, /profile_field_locked/);
});
