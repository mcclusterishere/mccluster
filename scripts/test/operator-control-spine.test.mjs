import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../js/control-room-v2.js', import.meta.url), 'utf8');
const voice = await readFile(new URL('../../js/control-room/voice.js', import.meta.url), 'utf8');
const media = await readFile(new URL('../../js/control-room/media.js', import.meta.url), 'utf8');
const controlHtml = await readFile(new URL('../../control.html', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../workers/mccluster-mcp/src/mcp.js', import.meta.url), 'utf8');
const catalog = JSON.parse(await readFile(new URL('../../core/capabilities/catalog.json', import.meta.url), 'utf8'));
const chatMigration = await readFile(new URL('../../supabase/migrations/20260919043433_operator_local_ai_chat.sql', import.meta.url), 'utf8');
const durableTurnMigration = await readFile(new URL('../../supabase/migrations/20260927222835_resident_ai_durable_vps_turn.sql', import.meta.url), 'utf8');
const aiHarness = await readFile(new URL('../../docs/control-plane/AI-HARNESS.md', import.meta.url), 'utf8');

test('Operator OS commands the signed Core MCP surface, not the legacy task route', () => {
  assert.match(source, /request\("\/v1\/core\/mcp"/);
  assert.match(source, /coreMcp\("tools\/list"\)/);
  assert.match(source, /callCoreTool\("objective\.plan"/);
  assert.match(source, /callCoreTool\("core\.ai\.turn\.submit"/);
  assert.match(source, /callCoreTool\("core\.ai\.turn\.get"/);
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


test('resident AI canonical name is McCluster', () => {
  assert.match(aiHarness, /^# McCluster AI Harness/m);
  assert.match(aiHarness, /The resident AI is named \*\*McCluster\*\*/);
  for (const artifact of [source, voice, aiHarness]) {
    assert.doesNotMatch(artifact, /\bCluster AI\b/);
    assert.doesNotMatch(artifact, /\bresident Cluster\b/);
    assert.doesNotMatch(artifact, /\b(?:ask|talk to|message) Cluster\b/i);
  }
});

test('resident local AI chat is VPS-owned and survives browser loss', () => {
  assert.match(source, /SURFACES = \["home", "ai", "work", "create", "analytics", "system", "apps"\]/);
  assert.match(source, /ops_ai_threads/);
  assert.match(source, /ops_ai_messages/);
  assert.match(source, /function sendAiMessage\(/);
  assert.match(source, /function newAiTurnId\(/);
  assert.match(source, /function waitForResidentAiTurn\(/);
  assert.match(source, /function reconcileResidentAiTurns\(/);
  assert.match(source, /callCoreTool\("core\.ai\.turn\.submit"/);
  assert.match(source, /callCoreTool\("core\.ai\.turn\.get"/);
  assert.match(source, /execution_kind: "resident_ai_turn"/);
  assert.match(source, /McCluster is still working on this saved turn; you can close this window and return later\./);
  assert.match(source, /var keepPendingAfterRecovery = false/);
  assert.match(source, /keepPendingAfterRecovery = state\.aiChatPending === true/);
  assert.match(source, /if \(!keepPendingAfterRecovery\)/);
  assert.doesNotMatch(source, /callCoreTool\("ai\.chat", \{ messages: history/);
  assert.match(durableTurnMigration, /insert into public\.ops_ai_messages/);
  assert.match(durableTurnMigration, /insert into public\.ops_agent_jobs/);
  assert.match(durableTurnMigration, /'resident_ai_turn'/);
  assert.match(durableTurnMigration, /security invoker/i);
  assert.match(durableTurnMigration, /revoke all on function public\.ops_ai_submit_turn[\s\S]*authenticated/);
  assert.match(source, /sourceBanner\(state\.sources\.coreBridge, "Core bridge"\)/);
  assert.match(source, /sourceBanner\(state\.sources\.coreTools, "AI execution path"\)/);
  assert.match(source, /Message McCluster AI/);
});

test('resident AI voice stays on the canonical durable chat path', () => {
  assert.doesNotThrow(() => new vm.Script(voice));
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(controlHtml, /js\/control-room\/voice\.js/);
  assert.match(voice, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(voice, /window\.speechSynthesis/);
  assert.match(voice, /new window\.SpeechSynthesisUtterance/);
  assert.match(voice, /cancelListening/);
  assert.match(source, /stopAiVoiceListening\(true\)/);
  assert.match(source, /function startAiVoiceTurn\(/);
  assert.match(source, /sendAiMessage\(spoken, \{ inputMode: "voice", speakReply: true \}\)/);
  assert.match(source, /input_mode: inputMode/);
  assert.match(source, /data-action="ai-voice-toggle"/);
  assert.match(source, /data-action="ai-stop-speaking"/);
  assert.match(source, /data-action="ai-speak-message"/);
  assert.match(source, /if \(opts\.speakReply\) speakAiText\(payload\.assistant_message\.content\)/);
  assert.doesNotMatch(source, /\/v1\/ai\/voice/);
});



test('Control media generation only exposes prompt-compatible models', () => {
  assert.match(media,/PROMPT_ONLY_CAPABILITIES/);
  for (const capability of ['text-to-image','text-to-video','text-to-3d','text-to-audio']) {
    assert.ok(media.includes('"'+capability+'": true'),capability+' prompt route missing');
  }
  assert.match(media,/specialized model/);
  assert.match(media,/does not yet collect the required reference media/);
  assert.match(media,/Bakeoff models must share one capability/);
  assert.match(media,/That model requires reference\/media inputs/);
});

test('resident AI history is owner-only durable state', () => {
  assert.match(chatMigration, /create table if not exists public\.ops_ai_threads/);
  assert.match(chatMigration, /create table if not exists public\.ops_ai_messages/);
  assert.match(chatMigration, /private\.is_org_owner\(org_id\)/);
  assert.match(chatMigration, /force row level security/);
  assert.match(chatMigration, /foreign key \(thread_id, org_id\)/);
});
