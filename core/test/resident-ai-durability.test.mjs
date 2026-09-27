import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../supabase/migrations/20260927222835_resident_ai_durable_vps_turn.sql', import.meta.url), 'utf8');
const control = await readFile(new URL('../src/resident-ai.mjs', import.meta.url), 'utf8');
const executor = await readFile(new URL('../src/executors/resident-ai-turn.mjs', import.meta.url), 'utf8');
const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
const deploy = await readFile(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');
const resume = await readFile(new URL('../src/tools/resume.mjs', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../js/control-room-v2.js', import.meta.url), 'utf8');

test('one server-side transaction owns message persistence and job creation', () => {
  assert.match(migration, /create or replace function public\.ops_ai_submit_turn/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /insert into public\.ops_ai_messages/);
  assert.match(migration, /insert into public\.ops_agent_jobs/);
  assert.match(migration, /'resident_ai_turn'/);
  assert.match(migration, /'agent_job_id', p_user_message_id::text/);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /revoke all on function public\.ops_ai_submit_turn[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.ops_ai_submit_turn[\s\S]*to service_role/);
});

test('job payload references the durable message rather than duplicating raw conversation text', () => {
  const jobInsert = migration.slice(migration.indexOf("insert into public.ops_agent_jobs"), migration.indexOf("on conflict (id) do nothing", migration.indexOf("insert into public.ops_agent_jobs")));
  assert.match(jobInsert, /'user_message_id', p_user_message_id::text/);
  assert.match(jobInsert, /'assistant_message_id', p_assistant_message_id::text/);
  assert.doesNotMatch(jobInsert, /p_content/);
  assert.doesNotMatch(jobInsert, /v_content/);
});

test('Core submit is service-side and returns only after a durable job exists', () => {
  assert.match(control, /rpc\/ops_ai_submit_turn/);
  assert.match(control, /AI_TURN_NOT_QUEUED/);
  assert.match(control, /assistant_message_id/);
});

test('runner owns resident turns and executor is retry-safe', () => {
  assert.match(runner, /\['resident_ai_turn', residentAiTurn\]/);
  assert.match(executor, /const existingAssistant = await messageById/);
  assert.match(executor, /if \(existingAssistant\)/);
  assert.match(executor, /await localAiChat\(/);
  assert.match(executor, /ops_ai_messages\?on_conflict=id/);
  assert.match(executor, /resolution=ignore-duplicates/);
  assert.match(executor, /task_status: 'done'/);
});

test('browser is a terminal after durable submission', () => {
  assert.match(ui, /callCoreTool\("core\.ai\.turn\.submit"/);
  assert.match(ui, /callCoreTool\("core\.ai\.turn\.get"/);
  assert.match(ui, /function reconcileResidentAiTurns\(/);
  assert.match(ui, /you can close this window and return later/);
  assert.doesNotMatch(ui, /callCoreTool\("ai\.chat", \{ messages: history/);
});

test('VPS has persistent McCluster machine roots without becoming a shadow memory database', () => {
  for (const path of [
    '/var/lib/mccluster-core/workspace',
    '/var/lib/mccluster-core/sessions',
    '/var/lib/mccluster-core/artifacts',
  ]) assert.ok(deploy.includes(path), `deploy missing persistent path ${path}`);

  assert.match(resume, /conversation_truth: 'supabase:ops_ai_threads\+ops_ai_messages'/);
  assert.match(resume, /private_memory_truth: 'supabase:ai_context'/);
  assert.match(resume, /workspace_root: process\.env\.MCCLUSTER_WORKSPACE_ROOT/);
  assert.match(resume, /repository_root: process\.env\.MCCLUSTER_REPO_ROOT/);
});
