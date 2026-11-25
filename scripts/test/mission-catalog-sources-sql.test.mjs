// Static checks of the pending mission catalog sources pair (Project Drawdown as the credited source of the mission catalog
// 'drawdown', and the house owner's commands over its source page in the World):
// supabase/pending/20261119140000_mission_catalog_sources_v1.sql and its .rollback.sql. In the root suite, so every pull
// request runs them without a database. The behaviour is proven by scripts/test/mission-catalog-sources.integration.mjs
// (PGlite) and .native.integration.mjs (PostgreSQL 16 and 17); the decisions are recorded in
// docs/control-plane/WORLD-MISSION-SOURCES.md (each a default adopted pending Matthew's confirmation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { splitStatements, normalizeStatement } from './support/network-connections-database.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const FORWARD_FILE = '20261119140000_mission_catalog_sources_v1.sql';
const ROLLBACK_FILE = '20261119140000_mission_catalog_sources_v1.rollback.sql';
// MISSION_CATALOG_SOURCES_DIR replaces supabase/pending/ for the pair (same file names): the mutation runs of the proofs.
const dir = process.env.MISSION_CATALOG_SOURCES_DIR ? pathToFileURL(process.env.MISSION_CATALOG_SOURCES_DIR.replace(/\/?$/, '/')) : new URL('supabase/pending/', ROOT);
const forward = readFileSync(new URL(FORWARD_FILE, dir), 'utf8');
const rollback = readFileSync(new URL(ROLLBACK_FILE, dir), 'utf8');
const words = createRequire(import.meta.url)('../../js/mission-source-words.js');
const statements = (sql) => splitStatements(sql).map((s) => normalizeStatement(s.text));
const body = (sql) => statements(sql).join('\n');
const TRANSACTION_CONTROL = /^(begin|commit|rollback|end|abort|savepoint|release|start transaction)\b/i;
const DESCRIPTION = 'Credited source of the mission catalog drawdown in McCluster Corp\'s World. This record is kept by McCluster Corp; Project Drawdown does not run it. Project Drawdown is a 501(c)(3) nonprofit (drawdown.org/about, read 2026-11-19).';
const ROLE_LINE = 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.';

test('the pair is staged and not applied', () => {
  const staged = readdirSync(new URL('supabase/pending/', ROOT)).filter((f) => f.startsWith('20261119140000_'));
  assert.deepEqual(staged.sort(), [ROLLBACK_FILE, FORWARD_FILE].sort());
  assert.deepEqual(readdirSync(new URL('supabase/migrations/', ROOT)).filter((f) => f.includes('mission_catalog_sources')), [],
    'nothing of it is under supabase/migrations/: it is not applied');
  assert.ok(forward.includes('-- PENDING. Not applied to production. Owner approval required.'));
  assert.ok(forward.startsWith('-- MISSION CATALOG SOURCES v1 (migration name mission_catalog_sources_v1)'));
  assert.ok(forward.includes('after release step 9 (the mission publish) and step 11 (its record)'));
  assert.ok(forward.includes('Decisions D1 to D14 are defaults adopted pending'));
  assert.ok(forward.includes('Matthew\'s confirmation (docs/control-plane/WORLD-MISSION-SOURCES.md)'));
});

test('the forward file is one transaction with a 5 s lock bound', () => {
  const s = statements(forward);
  assert.equal(s[0], 'begin;');
  assert.equal(s[1], "set local lock_timeout = '5s';");
  assert.equal(s.at(-1), 'commit;');
  assert.deepEqual(s.slice(1, -1).filter((x) => TRANSACTION_CONTROL.test(x)), [], 'no other transaction control');
});

test('three guards refuse with 55000 before anything changes: missing tables, no open Drawdown mission, a foreign project-drawdown row', () => {
  const s = statements(forward);
  const guard = s[2];
  assert.match(guard, /^do \$guard\$/);
  for (const t of ['network_organizations', 'action_missions', 'action_mission_details', 'orgs', 'org_members', 'control_audit']) {
    assert.ok(guard.includes(`to_regclass('public.${t}') is null`), `the guard needs ${t}`);
  }
  assert.ok(guard.includes("where d.catalog = 'drawdown' and m.status = 'open'"), 'the publish guard (release step 9 first)');
  assert.ok(guard.includes("where lower(o.slug) = 'project-drawdown'"), 'the existing-row guard');
  assert.equal((guard.match(/errcode = '55000'/g) || []).length, 3, 'each refusal is 55000');
  assert.ok(s.indexOf(guard) < s.findIndex((x) => x.startsWith('insert into public.network_organizations')), 'the guards run first');
});

test('the organization row: unverified, no creator, nonprofit, the one description; inserting it publishes those words', () => {
  const insert = statements(forward).find((x) => x.startsWith('insert into public.network_organizations'));
  assert.ok(insert.includes("'project-drawdown', 'Project Drawdown', 'nonprofit'"));
  assert.ok(insert.includes("'https://drawdown.org/', 'unverified', null"), 'verification_state unverified (D14) and created_by null');
  assert.ok(insert.includes(DESCRIPTION.replace(/'/g, "''")), 'the reviewed description');
  assert.ok(insert.includes("where not exists (select 1 from public.network_organizations where lower(slug) = 'project-drawdown')"), 'safe to run twice');
  assert.equal(words.denied('Project Drawdown'), false, 'the name passes the deny list');
  assert.equal(words.denied(DESCRIPTION), false, 'the description passes the deny list');
  assert.equal(words.denied(ROLE_LINE), false, 'the role line passes the deny list');
  assert.ok(forward.includes(`'${ROLE_LINE}'`), 'the role line, with the typographic apostrophe');
});

test('the link table: catalog-keyed, no foreign key onto any mission, no campaign, on delete restrict, every check named', () => {
  const table = statements(forward).find((x) => x.startsWith('create table if not exists public.mission_catalog_sources'));
  assert.ok(table, 'the table');
  assert.ok(table.includes('constraint mission_catalog_sources_pkey primary key (catalog)'));
  assert.ok(table.includes('foreign key (organization_id) references public.network_organizations (id) on delete restrict'));
  assert.equal((table.match(/references/g) || []).length, 1, 'one foreign key, onto the organization only');
  assert.doesNotMatch(body(forward), /references public\.action_missions|references public\.action_mission_details/, 'no foreign key onto the 125 missions (D6)');
  assert.doesNotMatch(body(forward), /campaign_id|action_campaigns/, 'no campaign (D6)');
  const checks = table.match(/\bcheck\b/g) || [];
  const named = table.match(/constraint mission_catalog_sources_[a-z_]+ check/g) || [];
  assert.equal(named.length, checks.length, 'every check constraint is named');
  assert.deepEqual(named.map((c) => c.split(' ')[1]).sort(), ['mission_catalog_sources_catalog_check', 'mission_catalog_sources_facts_check',
    'mission_catalog_sources_read_on_check', 'mission_catalog_sources_revision_check', 'mission_catalog_sources_role_line_check',
    'mission_catalog_sources_state_check', 'mission_catalog_sources_words_check']);
  assert.ok(table.includes("state text not null default 'draft'"), 'a new link is a draft');
  assert.ok(table.includes("check (state in ('draft', 'shown', 'hidden'))"));
});

test('no write to a mission or its details anywhere in the pair', () => {
  for (const sql of [forward, rollback]) {
    assert.doesNotMatch(body(sql), /(insert into|update|delete from|truncate|alter table|drop table if exists) public\.action_mission/,
      'the 125 missions and their details are frozen');
  }
});

test('the table takes back the defaults first, then grants one read; no write for any API role, nothing for service_role', () => {
  const s = statements(forward);
  const revoke = s.indexOf('revoke all on table public.mission_catalog_sources from public, anon, authenticated, service_role;');
  const grant = s.indexOf('grant select on table public.mission_catalog_sources to anon, authenticated;');
  assert.ok(revoke > 0 && grant > revoke, 'revoke before the one grant');
  const grants = s.filter((x) => /^grant /.test(x));
  assert.deepEqual(grants, [
    'grant select on table public.mission_catalog_sources to anon, authenticated;',
    'grant execute on function public.mission_catalog_source_owner_state(uuid) to service_role;',
    'grant execute on function public.mission_catalog_source_command(uuid, text, text, integer, uuid, text, jsonb) to service_role;'
  ]);
  assert.ok(s.includes('alter table public.mission_catalog_sources enable row level security;'));
  const policy = s.find((x) => x.startsWith('create policy'));
  assert.equal(policy, 'create policy "public reads shown catalog sources" on public.mission_catalog_sources as permissive for select to anon, authenticated using (state = \'shown\');',
    'one read policy: only a shown source, and no admin clause (the owner previews through the route)');
  assert.equal(s.filter((x) => x.startsWith('create policy')).length, 1);
});

test('both functions are SECURITY DEFINER with an empty search_path, re-check the house owner, and run for service_role only', () => {
  const s = statements(forward);
  for (const [name, sig] of [['mission_catalog_source_owner_state', '(uuid)'], ['mission_catalog_source_command', '(uuid, text, text, integer, uuid, text, jsonb)']]) {
    const fn = s.find((x) => x.startsWith(`create or replace function public.${name}(`));
    assert.ok(fn, name);
    assert.match(fn, /security definer set search_path = '' as \$\$/, `${name}: definer, empty search_path`);
    assert.ok(fn.includes("o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner'"), `${name}: the house owner check`);
    assert.ok(fn.includes("raise exception 'house_owner_required' using errcode = '42501'"), `${name}: 42501 for anyone else`);
    assert.ok(s.includes(`revoke all on function public.${name}${sig} from public, anon, authenticated, service_role;`), `${name}: revoked from every role`);
    assert.ok(s.includes(`grant execute on function public.${name}${sig} to service_role;`), `${name}: service_role only`);
  }
  const state = s.find((x) => x.startsWith('create or replace function public.mission_catalog_source_owner_state('));
  assert.doesNotMatch(state, /created_by/, 'the owner read never returns created_by');
  const cmd = s.find((x) => x.startsWith('create or replace function public.mission_catalog_source_command('));
  for (const code of ["'MCS01'", "'MCS02'", "'MCS03'"]) assert.ok(cmd.includes(code), `the command raises ${code}`);
  assert.ok(cmd.includes('perform pg_advisory_xact_lock('), 'one key at a time');
  assert.ok(cmd.includes('insert into public.control_audit'), 'every change is audited in the same transaction');
  assert.ok(cmd.includes("p_payload -> 'permission_confirmed' is distinct from 'true'::jsonb"), 'Show needs the owner\'s confirmation');
  assert.ok(cmd.includes("confirmed < date '2026-11-17' or confirmed > current_date"), 'a confirmation date between the permission statement and today');
});

test('the words check is exactly the deny list of js/mission-source-words.js', () => {
  const table = statements(forward).find((x) => x.startsWith('create table if not exists public.mission_catalog_sources'));
  const m = /constraint mission_catalog_sources_words_check check \(\(role_line \|\| ' ' \|\| facts::text\) !~\* '([^']+)'\)/.exec(table);
  assert.ok(m, 'the words check reads the role line and the facts');
  assert.equal(m[1], words.pgPattern(), 'the SQL pattern equals pgPattern()');
  const entries = words.DENY.map((e) => e[0]);
  for (const w of ['sponsor', 'partner', 'endors', 'official', 'verified', 'recommend', 'account', 'follow', 'funder', 'equity uprise', 'human uprise', 'missions from this source', 'by project drawdown']) {
    assert.ok(entries.includes(w), `the deny list holds ${w}`);
  }
  for (const [text, hit] of [['Missions sponsored by Project Drawdown.', true], ['An official partner.', true], ['Funded by a grant.', true],
    ['Keep   watching these.', true], ['Equity Uprise missions.', true], ['Its account.', true], ['A funding round.', true],
    ['Missions from this source.', true], [ROLE_LINE, false], ['501(c)(3) nonprofit', false], ['St. Paul, Minnesota', false],
    ['Assessments of climate solutions, in the Drawdown Explorer', false], ['Fundamentals of heat pumps', false], ['A refund', false]]) {
    assert.equal(words.denied(text), hit, text);
  }
});

test('the first row: draft, revision 1, the three dated facts, only for the row this file wrote', () => {
  const insert = statements(forward).find((x) => x.startsWith('insert into public.mission_catalog_sources'));
  assert.ok(insert.includes("select 'drawdown', o.id, 'draft', 1,"));
  for (const fact of ['"label": "Organization", "value": "501(c)(3) nonprofit", "source": "https://drawdown.org/about"',
    '"label": "Mailing address", "value": "St. Paul, Minnesota", "source": "https://drawdown.org/contact"',
    '"label": "What it publishes", "value": "Assessments of climate solutions, in the Drawdown Explorer", "source": "https://drawdown.org/explorer"']) {
    assert.ok(insert.includes(fact), fact);
  }
  assert.ok(insert.includes("date '2026-11-19'"), 'read on 2026-11-19');
  assert.ok(insert.includes("o.created_by is null and o.verification_state = 'unverified'"));
  assert.ok(insert.includes('on conflict (catalog) do nothing'));
});

test('the rollback names the forward file, refuses (55000) before it drops anything, keeps the audit and touches no mission', () => {
  assert.ok(rollback.startsWith(`-- Rollback of supabase/pending/${FORWARD_FILE} (migration name mission_catalog_sources_v1_rollback).`));
  const s = statements(rollback);
  assert.equal(s[0], 'begin;');
  assert.equal(s[1], "set local lock_timeout = '5s';");
  assert.equal(s.at(-1), 'commit;');
  const refuse = s[2];
  assert.match(refuse, /^do \$refuse\$/);
  assert.equal((refuse.match(/errcode = '55000'/g) || []).length, 2, 'two refusals: a changed row, and anything naming it');
  for (const t of ['authenticity_checks', 'network_groups', 'action_campaigns', 'network_organization_members']) assert.ok(refuse.includes(`public.${t}`), `it counts ${t}`);
  assert.deepEqual(s.slice(3, -1), [
    'drop function if exists public.mission_catalog_source_command(uuid, text, text, integer, uuid, text, jsonb);',
    'drop function if exists public.mission_catalog_source_owner_state(uuid);',
    'drop table if exists public.mission_catalog_sources;',
    "delete from public.network_organizations o where lower(o.slug) = 'project-drawdown';"
  ], 'after the refusal, exactly the two functions, the table and the one row');
  assert.doesNotMatch(body(rollback), /control_audit/, 'the audit rows stay');
});
