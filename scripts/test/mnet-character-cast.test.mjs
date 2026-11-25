import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

/* MNET character cast (owner, 2026-11-03): the release contract around the cast, the pending
   migration and the OVH switch. Behaviour of the SQL itself: scripts/test-mnet-character-cast-db.sh. */
const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sql = read('supabase/pending/mnet_character_cast_v1.sql').replace(/^\s*--.*$/gm, ''); // code only, not the header prose

test('the migration is pending only: not in migrations, not in the production ledger', () => {
  assert.ok(existsSync(new URL('../../supabase/pending/mnet_character_cast_v1.rollback.sql', import.meta.url)));
  assert.ok(!readdirSync(new URL('../../supabase/migrations/', import.meta.url)).some(f => f.includes('character_cast')));
  assert.ok(!read('supabase/production-ledger.json').includes('character_cast'));
  assert.ok(!read('supabase/schema-manifest.json').includes('ops_character_'));
  assert.match(read('supabase/pending/PROMOTION-ORDER.md'), /mnet_character_cast_v1\.sql/);
});

test('the migration is additive, server-only and reuses the platform-actor path', () => {
  assert.doesNotMatch(sql, /\bdrop\b|alter table public\.(?!ops_character_publications)/i, 'nothing existing is altered or dropped');
  assert.match(sql, /alter table public\.ops_character_publications enable row level security/);
  assert.match(sql, /revoke all on public\.ops_character_publications from public, anon, authenticated/);
  for (const fn of ['ops_character_provision(uuid,text,text,text,text,integer,jsonb)', 'ops_character_publish_post(uuid,uuid,text,text,text,uuid,uuid,text)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
  assert.equal((sql.match(/security invoker set search_path = ''/g) || []).length, 2);
  assert.equal((sql.match(/current_user not in \('service_role','postgres'\)/g) || []).length, 2);
  assert.match(sql, /insert into public\.ops_platform_actors \(actor_key, org_id, m_uid, handle, enabled, daily_limit, persona, authority\)\s+values \(v_key, p_org_id, person, v_key, false,/, 'actors are provisioned disabled');
  assert.doesNotMatch(sql, /auth\.users|password|email/i, 'no login, email or password for a character');
  assert.match(sql, /a\.persona->>'actor_kind' = 'character'/, 'replies only on another character');
});

test('the OVH switch is off by default and the timer is not enabled by deploy', () => {
  const deploy = read('scripts/deploy-ovh-core.sh');
  assert.ok(!deploy.includes('mccluster-core-character-posts'), 'deploy must not enable the character timer');
  assert.match(read('core/systemd/mccluster-core-character-posts.service'), /ExecStart=\/usr\/bin\/node \/opt\/mccluster\/core\/src\/seed-character-posts\.mjs/);
  const seed = read('core/src/seed-character-posts.mjs');
  assert.match(seed, /if \(mode !== 'live'\)/);
  assert.match(read('core/src/executors/character-post.mjs'), /String\(env\.MCCLUSTER_CHARACTER_POSTS \|\| 'off'\)/);
  assert.match(read('core/src/runner.mjs'), /\['character_post', characterPost\]/);
  assert.match(read('core/src/seed-actors.mjs'), /actor_kind!=='character'/, 'the Royce news loop never picks up a story character');
});

test('no AI model names in the cast or its docs, and no raw transcripts', () => {
  const cast = read('core/data/characters/cast.v1.json');
  const doc = read('docs/fictional-city/MNET-CHARACTER-CAST.md');
  for (const text of [cast, doc]) assert.doesNotMatch(text, /\b(?:qwen|llama|mistral|gemma|gpt-?\d|chatgpt|openai|claude|anthropic|gemini|grok|deepseek)\b/i);
  assert.doesNotMatch(cast, /"role"\s*:\s*"(?:assistant|user|system)"/, 'committed result only, no conversation transcript');
});
