import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../supabase/pending_migrations/20260930235930_mnet_action_network_v2.sql', import.meta.url);
const sql = () => readFile(migrationUrl, 'utf8');

test('Mnet is the Action Network: campaigns attach to canonical network groups', async () => {
  const s = await sql();
  assert.match(s, /references public\.network_groups\(id\)/);
  assert.doesNotMatch(s, /create table(?: if not exists)? public\.action_groups\b/);
  assert.doesNotMatch(s, /create table(?: if not exists)? public\.action_profiles\b/);
});

test('campaign 001 is $50k-ready but public money stays off', async () => {
  const s = await sql();
  assert.match(s, /money_goal_cents = 5000000/);
  assert.match(s, /money_enabled = false/);
});

test('missions have an auditable acceptance through verification lifecycle', async () => {
  const s = await sql();
  for (const state of ['accepted','in_progress','submitted','verified','declined','cancelled','needs_revision']) {
    assert.match(s, new RegExp("'" + state + "'"));
  }
  assert.match(s, /create table if not exists public\.action_mission_evidence/);
  assert.match(s, /create table if not exists public\.action_contributions/);
  assert.match(s, /verified_by_m_uid/);
  assert.match(s, /verified_at/);
});

test('mission membership and contribution state use canonical m_uid', async () => {
  const s = await sql();
  assert.match(s, /m_uid uuid not null references public\.m_people\(id\)/);
  assert.match(s, /public\.current_m_uid\(\)/);
  assert.match(s, /network_group_members/);
});

test('mission data is protected with RLS and member-scoped policies', async () => {
  const s = await sql();
  for (const table of ['action_campaign_groups','action_missions','action_mission_assignments','action_mission_evidence','action_contributions']) {
    assert.match(s, new RegExp('alter table public\\.' + table + ' enable row level security'));
  }
  assert.match(s, /members read own assignments/);
  assert.match(s, /members submit own evidence/);
  assert.match(s, /owner writes contributions/);
});

test('member mission RPC exposes assignment state without inventing another identity', async () => {
  const s = await sql();
  assert.match(s, /create or replace function public\.action_my_missions\(\)/);
  assert.match(s, /p\.user_id=auth\.uid\(\)/);
  assert.match(s, /a\.m_uid=public\.current_m_uid\(\)/);
});
