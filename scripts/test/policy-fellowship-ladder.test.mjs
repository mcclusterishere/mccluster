// Policy Fellowship ladder: the shared rules module agrees with the pending
// SQL, illegal transitions are refused, an owner edit needs a note and a real
// change, the ladder rule is data, and the schema keeps memos private.
// The database behaviour itself is proven by scripts/test-policy-fellowship-db.sh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const L = require("../../js/policy-fellowship-ladder.js");
const read = (p) => fs.readFile(new URL("../../" + p, import.meta.url), "utf8");
const SQL_PATH = "supabase/pending/policy_fellowship_ladder_v1.sql";

function sqlTransitions(sql) {
  const block = sql.split("-- transitions:begin")[1].split("-- transitions:end")[0];
  return [...block.matchAll(/\('([a-z_]+)','([a-z_]+)','([a-z_]+)','([a-z_]+)'\)/g)].map((m) => m.slice(1, 5));
}

test("the JS state machine is the SQL state machine", async () => {
  const sql = await read(SQL_PATH);
  const fromSql = sqlTransitions(sql);
  assert.equal(fromSql.length, 14);
  assert.deepEqual(fromSql, L.TRANSITIONS);
  for (const [from, , , to] of fromSql) {
    assert.ok(L.STATUSES.includes(from), from);
    assert.ok(L.STATUSES.includes(to), to);
  }
  const checkList = sql.match(/status in \(([^)]*)\)\),\n draft_title/)[1];
  assert.deepEqual(checkList.replace(/'/g, "").split(","), L.STATUSES);
});

test("every transition not in the table is illegal", () => {
  const actions = ["submit", "resubmit", "withdraw", "start_review", "approve", "decline", "request_changes", "owner_edit", "publish"];
  let legal = 0;
  for (const from of L.STATUSES) for (const action of actions) for (const actor of ["fellow", "owner", "anon"]) {
    const to = L.nextStatus(from, action, actor);
    const listed = L.TRANSITIONS.find((t) => t[0] === from && t[1] === action && t[2] === actor);
    assert.equal(to, listed ? listed[3] : null, `${from} ${action} ${actor}`);
    if (to) legal++;
  }
  assert.equal(legal, 14);
  // the ones that matter most
  assert.equal(L.nextStatus("submitted", "approve", "owner"), null, "approval needs a review first");
  assert.equal(L.nextStatus("draft", "approve", "fellow"), null, "a fellow never approves");
  assert.equal(L.nextStatus("in_review", "owner_edit", "fellow"), null, "a fellow cannot owner-edit");
  for (const t of L.TERMINAL) for (const a of actions) for (const actor of ["fellow", "owner"]) {
    assert.equal(L.nextStatus(t, a, actor), null, `${t} is terminal`);
  }
  assert.equal(L.nextStatus("declined", "resubmit", "fellow"), null, "a pass is final; start a new memo");
});

test("decline, request_changes and owner_edit need a note; owner_edit needs a real change", () => {
  for (const action of L.NOTE_REQUIRED) {
    const r = L.checkAction({ from: "in_review", action, actor: "owner", note: "", body: "new", currentBody: "old" });
    assert.equal(r.ok, false);
    assert.match(r.error, /needs a note/);
  }
  assert.match(L.checkAction({ from: "in_review", action: "owner_edit", actor: "owner", note: "Tightened", body: "same", currentBody: "same" }).error, /must change the text/);
  assert.match(L.checkAction({ from: "in_review", action: "owner_edit", actor: "owner", note: "Tightened", body: "   ", currentBody: "x" }).error, /needs the edited text/);
  assert.deepEqual(L.checkAction({ from: "in_review", action: "owner_edit", actor: "owner", note: "Tightened", body: "new", currentBody: "old" }), { ok: true, to: "owner_edited" });
  assert.deepEqual(L.checkAction({ from: "in_review", action: "approve", actor: "owner" }), { ok: true, to: "approved" });
  assert.match(L.checkAction({ from: "draft", action: "submit", actor: "fellow", body: "" }).error, /write the memo/);
  assert.match(L.checkAction({ from: "submitted", action: "approve", actor: "owner" }).error, /illegal transition/);
});

test("the SQL enforces the same note and change rules", async () => {
  const sql = await read(SQL_PATH);
  assert.match(sql, /if p_action in \('decline','request_changes','owner_edit'\) and char_length\(coalesce\(v_note, ''\)\) < 3/);
  assert.match(sql, /if p_body = v_current\.body then raise exception 'owner_edit must change the text'/);
  assert.match(sql, /check \(author_role <> 'owner' or \(parent_version_id is not null and diff_from_parent is not null/);
  assert.deepEqual(L.NOTE_REQUIRED, ["decline", "request_changes", "owner_edit"]);
});

test("ladder eligibility is data: all kinds, any n, creator switch", () => {
  const all = { required_kinds: ["help_person", "write_song", "attend_rally"], min_count: null, creator_exclusive: false };
  assert.equal(L.evaluateLadder(all, []).eligible, false);
  assert.deepEqual(L.evaluateLadder(all, ["help_person", "write_song"]).remaining, ["attend_rally"]);
  assert.equal(L.evaluateLadder(all, ["help_person", "write_song", "attend_rally"]).eligible, true);
  assert.equal(L.evaluateLadder(all, ["help_person", "help_person", "write_song"]).eligible, false, "two missions of one kind are one kind");
  assert.equal(L.evaluateLadder(all, ["help_person", "write_song", "unrelated"]).eligible, false);
  const any1 = { ...all, min_count: 1 };
  assert.equal(L.evaluateLadder(any1, ["write_song"]).eligible, true);
  assert.equal(L.evaluateLadder(all, ["help_person", "write_song", "attend_rally"], { isCreator: true }).eligible, true, "non-exclusive by default");
  const excl = { ...all, creator_exclusive: true };
  const r = L.evaluateLadder(excl, ["help_person", "write_song", "attend_rally"], { isCreator: true });
  assert.equal(r.eligible, false);
  assert.equal(r.blocked_reason, "creator_exclusive");
  assert.equal(L.evaluateLadder({ required_kinds: [] }, []).eligible, false);
});

test("the seeded rule is all three starter kinds and non-exclusive; completion means a verified assignment", async () => {
  const sql = await read(SQL_PATH);
  assert.match(sql, /'starter_kinds',\n   array\['help_person','write_song','attend_rally'\], null, '\{\}', false, true, false\)/);
  assert.match(sql, /creator_exclusive boolean not null default false/);
  const elig = sql.slice(sql.indexOf("function public.action_unlock_progress"), sql.indexOf("revoke all on function public.action_unlock_progress"));
  assert.match(elig, /a\.status = 'verified'/);
  assert.match(elig, /coalesce\(r\.min_count, cardinality\(r\.required_kinds\)\)/);
  assert.match(sql, /public\.action_unlock_progress\(p_user, 'policy_fellowship'\)/);
  assert.match(sql, /if v_cohort\.program = 'policy_fellowship' and not public\.policy_ladder_eligible\(v_app\.user_id\)/);
});

test("next step follows the ladder", () => {
  assert.equal(L.nextStep(null), "sign_in");
  assert.equal(L.nextStep({ signed_in: true, eligible: false }), "complete_starter_missions");
  assert.equal(L.nextStep({ signed_in: true, eligible: true }), "apply_for_fellowship");
  assert.equal(L.nextStep({ signed_in: true, eligible: true, fellowship_application: { status: "declined" } }), "apply_for_fellowship");
  assert.equal(L.nextStep({ signed_in: true, eligible: true, fellowship_application: { status: "submitted" } }), "await_fellowship_review");
  assert.equal(L.nextStep({ signed_in: true, eligible: true, fellowship_application: { status: "accepted" } }), "await_policy_cohort_seat");
  assert.equal(L.nextStep({ signed_in: true, eligible: false, policy_seats: [{ cohort_id: "x" }] }), "write_memo");
});

test("the line diff matches the SQL fixtures byte for byte", async () => {
  const beh = await read("supabase/tests/policy_fellowship_ladder.behaviour.sql");
  const fixture = (label) => {
    const i = beh.indexOf(`'${label}'`);
    const chunk = beh.slice(beh.lastIndexOf("action_policy_memo_line_diff(", i), i);
    const lit = chunk.match(/= *\n? *'(\{.*\})'::jsonb/s)[1];
    return JSON.parse(lit);
  };
  assert.deepEqual(L.lineDiff("a\nb\nc", "a\nx\nc"), fixture("line diff fixture"));
  assert.deepEqual(L.lineDiff("", "x"), fixture("line diff from empty"));
  const owner = L.lineDiff("Problem\nEvidence: statute 12-34\nRecommendation\nCost: $2M", "Problem\nEvidence: statute 12-34\nRecommendation: fund 200 units\nCost: $2M");
  assert.equal(owner.added, 1);
  assert.equal(owner.removed, 1);
  assert.equal(L.lineDiff("x\n".repeat(1200), "y\n".repeat(1200)).too_large, true);
});

test("memos are private: RLS on, no anon grant, own rows or the desk", async () => {
  const sql = await read(SQL_PATH);
  for (const t of ["action_policy_memos", "action_policy_memo_versions", "action_policy_memo_reviews", "action_policy_memo_research_items", "action_unlock_rules", "action_member_verifications", "action_ladder_mission_kinds", "action_ladder_starter_kinds"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t);
  }
  const memoGrants = sql.match(/grant select on public\.action_policy_memos[^;]*;/)[0];
  assert.match(memoGrants, /to authenticated;$/);
  assert.doesNotMatch(memoGrants, /anon/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*public\.action_policy_memo[^;]*to (anon|authenticated)/);
  assert.match(sql, /"fellow reads own memos" on public\.action_policy_memos for select to authenticated\n using \(author_uid = \(select auth\.uid\(\)\) or \(select public\.eu_is_admin\(\)\)\)/);
  for (const t of ["versions", "reviews", "research"]) {
    assert.match(sql, new RegExp(`"fellow reads own memo ${t}"[^;]*m\\.author_uid = \\(select auth\\.uid\\(\\)\\)`), t);
  }
  // every RPC decides identity on the server
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  for (const f of ["create_policy_memo", "save_policy_memo_draft", "submit_policy_memo", "withdraw_policy_memo", "review_policy_memo", "policy_memo_history", "add_policy_memo_research_item", "remove_policy_memo_research_item", "policy_ladder_status", "admit_fellow_to_cohort"]) {
    assert.ok(fns.includes(f), f);
    const body = sql.slice(sql.indexOf(`function public.${f}(`));
    assert.match(body.slice(0, 600), /security definer\nset search_path = ''/, f);
  }
  assert.match(sql, /if v_user is null or not \(select public\.eu_is_admin\(\)\) then raise exception 'not authorized'/);
  assert.match(sql, /you cannot review your own memo/);
  assert.match(sql, /revoke all on function public\.policy_ladder_eligible\(uuid\) from public, anon, authenticated/);
});

test("research items are leads with provenance, never scraped Scholar results", async () => {
  const sql = await read(SQL_PATH);
  assert.match(sql, /evidence_status text not null default 'unverified_lead' check \(evidence_status in \('unverified_lead'\)\)/);
  assert.match(sql, /canon_source_id uuid,/);
  assert.match(sql, /check \(provider = 'manual' or retrieved_at is not null\)/);
  const providers = sql.match(/provider text not null check \(provider in \(([^)]*)\)\)/)[1];
  assert.doesNotMatch(providers, /google|'scholar'/i);
  for (const p of ["openalex", "crossref", "semantic_scholar", "core", "arxiv", "pubmed", "gdelt", "openstates", "manual"]) assert.match(providers, new RegExp(`'${p}'`));
  assert.match(sql, /url ~\* '\^https:\/\/'/);
});

test("versions and the review log are immutable; the pending file is honest and seeds no people", async () => {
  const sql = await read(SQL_PATH);
  assert.match(sql, /before update or delete on public\.action_policy_memo_versions/);
  assert.match(sql, /before update or delete on public\.action_policy_memo_reviews/);
  assert.match(sql, /PENDING: not applied in production/);
  assert.match(sql, /ROLLBACK/);
  const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(topLevel, /insert into public\.(action_policy_official_profiles|action_policy_memos|action_cohorts|m_people|action_missions|civic_\w+)\b/);
  assert.match(topLevel, /insert into public\.action_ladder_mission_kinds/);
  const readme = await read("supabase/pending/README.md");
  assert.match(readme, /policy_fellowship_ladder_v1\.sql/);
});

test("the ladder doc carries the compliance boundary and the open questions", async () => {
  const doc = await read("docs/control-plane/POLICY-FELLOWSHIP-LADDER.md");
  for (const re of [/501\(c\)\(3\)/, /lobbying/i, /separate/i, /psychological profiling/i, /sensitive-trait inference/i, /covert persuasion/i,
    /Google Scholar/, /no official API/i, /OpenAlex/, /Open States/, /OPENSTATES_API_KEY/, /unverified lead/i, /Open questions/i, /counsel/i]) {
    assert.match(doc, re);
  }
});

test("the desk and the fellow surfaces are wired to the same rules", async () => {
  const [control, mod, page, desk] = await Promise.all([read("control.html"), read("js/control-room/action-network.js"), read("action-policy.html"), read("js/policy-fellowship-desk.js")]);
  assert.ok(control.indexOf("js/policy-fellowship-ladder.js") < control.indexOf("js/control-room/action-network.js"), "rules load before the desk");
  assert.match(mod, /\["memos","Policy memos"\]/);
  assert.match(mod, /rpc\/review_policy_memo/);
  assert.match(mod, /L\.TRANSITIONS\.filter\(function\(t\)\{return t\[0\]===status&&t\[2\]==="owner";\}\)/);
  assert.match(mod, /L\.checkAction\(/);
  assert.match(page, /<section id="ladder"/);
  assert.ok(page.indexOf("js/policy-fellowship-ladder.js") < page.indexOf("js/policy-fellowship-desk.js"));
  assert.match(page, /font-size:max\(16px,1rem\)/);
  assert.doesNotMatch(page, /max-width:\s*\d+px\)/, "no max-width media queries");
  for (const fn of ["policy_ladder_status", "create_policy_memo", "save_policy_memo_draft", "submit_policy_memo", "withdraw_policy_memo", "policy_memo_history", "add_policy_memo_research_item", "remove_policy_memo_research_item"]) assert.match(desk, new RegExp(`"${fn}"`), fn);
  assert.doesNotMatch(desk, /scholar\.google/i, "the fellow desk never fetches Google Scholar");
});

test("every unlock is a row; counsel-gated rules ship disabled and cannot be enabled unsigned", async () => {
  const sql = await read(SQL_PATH);
  assert.match(sql, /check \(not enabled or not requires_counsel_signoff or counsel_signoff_at is not null\)/);
  assert.match(sql, /\('equity_uprise_activation',[^\n]*\n[^\n]*null, 3, '[^']*', false, false, true\)/);
  assert.match(sql, /\('whip_transport_partner',[^\n]*'registration_assists',\n[^\n]*null, 10, '[^']*', false, false, true\)/);
  assert.match(sql, /'public_free_layer'[^\n]*array\['globe_layer:flights'\], 'none'/);
  assert.match(sql, /v_reason := 'counting_source_pending_counsel'/);
  assert.match(sql, /if r\.requires_counsel_signoff and r\.counsel_signoff_at is null then v_met := false/);
  const ver = sql.slice(sql.indexOf("create table if not exists public.action_member_verifications"), sql.indexOf("alter table public.action_member_verifications enable"));
  assert.doesNotMatch(ver, /image|photo|selfie|template|document_number|date_of_birth|dob|ssn/i);
  assert.match(sql, /alter table public\.action_member_verifications force row level security/);
  assert.doesNotMatch(sql, /grant (insert|update|all)[^;]*action_member_verifications[^;]*to (anon|authenticated)/);
  // no voter data anywhere
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /voter_file|party_affiliation|vote_choice|voted_for/i);
  assert.equal(L.ruleLive({ enabled: false }), false);
  assert.equal(L.ruleLive({ enabled: true, requires_counsel_signoff: true }), false);
  assert.equal(L.ruleLive({ enabled: true, requires_counsel_signoff: true, counsel_signoff_at: "2026-10-15" }), true);
  assert.equal(L.evaluateLadder({ required_kinds: ["a"], enabled: false }, ["a"]).blocked_reason, "disabled");
});

test("the doc carries the unlock model and the Whip / voter / biometric boundaries", async () => {
  const doc = await read("docs/control-plane/POLICY-FELLOWSHIP-LADDER.md");
  for (const re of [/Whip Equipped LLC is Matthew's separate company/i, /never a McCluster Corp brand/i, /background check/i, /eligibility to apply/i,
    /requires_counsel_signoff/, /nonpartisan/i, /never (collect|store)[^.]*how anyone votes/i, /voter-file/i, /BIPA/, /retention/i,
    /never[^.]*(face image|biometric template)/i, /Stripe Identity/, /Persona/, /0037_whip_mobility/, /read-only/i, /fund/i]) assert.match(doc, re);
});
