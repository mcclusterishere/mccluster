import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../js/control-room-v2.js', import.meta.url), 'utf8');
const voice = await readFile(new URL('../../js/control-room/voice.js', import.meta.url), 'utf8');
const controlHtml = await readFile(new URL('../../control.html', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../workers/mccluster-mcp/src/mcp.js', import.meta.url), 'utf8');
const catalog = JSON.parse(await readFile(new URL('../../core/capabilities/catalog.json', import.meta.url), 'utf8'));
const chatMigration = await readFile(new URL('../../supabase/migrations/20260919043433_operator_local_ai_chat.sql', import.meta.url), 'utf8');

test('Operator OS commands the signed Core MCP surface, not the legacy task route', () => {
  assert.match(source, /request\("\/v1\/core\/mcp"/);
  assert.match(source, /coreMcp\("tools\/list"\)/);
  assert.match(source, /callCoreTool\("objective\.plan"/);
  assert.match(source, /callCoreTool\("ai\.chat"/);
  assert.match(source, /callCoreTool\("compute\.task\.get"/);
  assert.match(source, /callCoreTool\("core\.resume"/);
  assert.match(source, /callCoreTool\("research\.web"/);
  assert.doesNotMatch(source, /request\("\/v1\/ai\/task"/);
});

test('Operator OS exposes a command-center system surface', () => {
  assert.match(source, /SYSTEM_VIEWS = \["command", "overview", "workload", "observability", "resources"\]/);
  assert.match(source, /function renderCommandCenter\(\)/);
  assert.match(source, /Signed Cloudflare → Core MCP/);
  assert.match(source, /same capability bus used by agents/);
});

test('home AI is durable: the UI polls the canonical compute task result', () => {
  assert.match(source, /function waitForComputeTask\(/);
  assert.match(source, /task\.status === "done"/);
  assert.match(source, /task\.status === "failed" \|\| task\.status === "canceled"/);
});

test('edge allowlist and capability catalog carry the command spine', () => {
  for (const capability of ['core.resume', 'ai.chat', 'compute.task.get', 'objective.plan', 'research.web']) {
    assert.ok(mcp.includes(`'${capability}'`), `edge allowlist missing ${capability}`);
    assert.ok(catalog.capabilities.some((entry) => entry.id === capability), `catalog missing ${capability}`);
  }
  assert.ok(catalog.bindings.some((entry) => entry.capability === 'compute.task.get' && entry.status === 'active'));
  assert.ok(catalog.bindings.some((entry) => entry.capability === 'objective.plan' && entry.status === 'active'));
});


test('owner approvals stay human-gated at Cloudflare', () => {
  assert.match(source, /\/v1\/ai\/approvals\/.*\/decision/);
  assert.match(source, /data-action="approval-decide"/);
  assert.match(source, /pending_approvals/);
});


test('resident local AI chat is durable and multi-turn', () => {
  assert.match(source, /SURFACES = \["home", "ai", "work", "create", "analytics", "system", "apps"\]/);
  assert.match(source, /ops_ai_threads/);
  assert.match(source, /ops_ai_messages/);
  assert.match(source, /function waitForAiTask\(/);
  assert.match(source, /function sendAiMessage\(/);
  assert.match(source, /callCoreTool\("ai\.chat", \{ messages: history/);
  assert.match(source, /compute_task_id/);
  assert.match(source, /state\.aiChatTask = task/);
  assert.match(source, /waitForAiTask\(task\.id, 330\)/);
  assert.match(source, /function attachAiTaskToUserMessage\(/);
  assert.match(source, /function persistAiAssistantFromTask\(/);
  assert.match(source, /function reconcileAiTaskReplies\(/);
  assert.match(source, /var inspections = unresolved\.map\(function \(userMessage\)/);
  assert.match(source, /Promise\.all\(inspections\)/);
  assert.match(source, /items\.filter\(Boolean\)\.map\(recoverOne\)/);
  assert.match(source, /function persist\(left\)/);
  assert.doesNotMatch(source, /Reply recovery link could not be saved; keep this chat open/);
  assert.match(source, /\["failed", "canceled"\]\.indexOf\(status\) < 0/);
  assert.match(source, /terminalError\.task = task/);
  assert.match(source, /on_conflict=id/);
  assert.match(source, /id: task\.id/);
  assert.match(source, /compute_task_id: task\.id/);
  assert.match(source, /Queued for local compute\. Your message is saved and has not been lost\./);
  assert.match(source, /sourceBanner\(state\.sources\.coreBridge, "Core bridge"\)/);
  assert.match(source, /sourceBanner\(state\.sources\.coreTools, "AI execution path"\)/);
  assert.match(source, /Message McCluster AI/);
});

test('resident AI voice stays on the canonical durable chat path', () => {
  assert.match(controlHtml, /js\/control-room\/voice\.js/);
  assert.match(voice, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(voice, /window\.speechSynthesis/);
  assert.match(voice, /new SpeechSynthesisUtterance/);
  assert.match(source, /function startAiVoiceTurn\(/);
  assert.match(source, /sendAiMessage\(spoken, \{ inputMode: "voice", speakReply: true \}\)/);
  assert.match(source, /metadata: \{ input_mode: inputMode \}/);
  assert.match(source, /data-action="ai-voice-toggle"/);
  assert.match(source, /data-action="ai-stop-speaking"/);
  assert.match(source, /data-action="ai-speak-message"/);
  assert.match(source, /if \(opts\.speakReply\) speakAiText\(savedAssistant\.content\)/);
  assert.doesNotMatch(source, /\/v1\/ai\/voice/);
});



test('resident AI history is owner-only durable state', () => {
  assert.match(chatMigration, /create table if not exists public\.ops_ai_threads/);
  assert.match(chatMigration, /create table if not exists public\.ops_ai_messages/);
  assert.match(chatMigration, /private\.is_org_owner\(org_id\)/);
  assert.match(chatMigration, /force row level security/);
  assert.match(chatMigration, /foreign key \(thread_id, org_id\)/);
});
