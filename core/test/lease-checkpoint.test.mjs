// C3 follow-up: an executor whose lease was lost stops before its next outward action. The runner aborts the
// signal it hands the executor when a heartbeat matches no row (core/src/runner.mjs); stopIfLeaseLost turns that
// into the error the runner records as a lost lease. Executors with injectable dependencies are driven end to end
// in their own tests (code-patch-path-policy, actor-live-comment, actor-news-comment, character-posts,
// prim3-agent-news); the ones that write through the module-level REST client are pinned here by order: the
// check is the statement right before each outward call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stopIfLeaseLost } from '../src/lease.mjs';

const job = { id: 'job-c3' };

test('stopIfLeaseLost does nothing until the signal is aborted, then throws the runner\'s lost-lease error', () => {
  for (const signal of [undefined, null, new AbortController().signal]) assert.doesNotThrow(() => stopIfLeaseLost(job, signal, 'acting'));
  const lease = new AbortController();
  lease.abort(new Error('heartbeat matched no row'));
  assert.throws(() => stopIfLeaseLost(job, lease.signal, 'pushing the branch'), (e) => e.code === 'LEASE_LOST' && e.job_id === 'job-c3' && e.message === 'Lost ownership of job job-c3 before pushing the branch');
});

test('the runner hands executors the signal and treats LEASE_LOST as abandoned, never failed or done', async () => {
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /await executor\(job, \{ signal: lease\.signal, lease: job\.locked_by \|\| null \}\)/);
  assert.match(runner, /if \(error\?\.code === 'LEASE_LOST' \|\| lease\.signal\.aborted\) \{/);
});

test('each outward action that writes through the shared client is preceded by the lease check', async () => {
  const sites = {
    'resident-ai-turn.mjs': ["stopIfLeaseLost(job, signal, 'posting the reply');", "const { body: inserted = [] } = await rest('ops_ai_messages?on_conflict=id&select=*', {"],
    'sms-assistant-turn.mjs': ["stopIfLeaseLost(job, signal, 'queueing the text message');", 'const outbound = await createReply({ job, thread, contact, inbound, body });'],
    'meeting-delegate-dispatch.mjs': ["stopIfLeaseLost(job, signal, 'joining the meeting');", 'const joined = await joinMeeting({'],
    'meeting-delegate-dispatch.mjs#chat': ["stopIfLeaseLost(job, signal, 'posting in the meeting chat');", 'chatDisclosure = await sendMeetingChat({'],
    'preview-deploy.mjs': ["stopIfLeaseLost(job, signal, 'starting the preview build');", "await run('systemctl', ['start', `mccluster-preview-build@${buildId}.service`]"],
    'preview-deploy.mjs#publish': ["stopIfLeaseLost(job, signal, 'publishing the preview');", 'await rename(stage, final);'],
    'world-news-pairing.mjs': ["stopIfLeaseLost(job, signal, 'publishing news pairs');", 'for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {']
  };
  const entry = {
    'resident-ai-turn.mjs': 'export async function residentAiTurn(job, { signal } = {}) {',
    'sms-assistant-turn.mjs': 'export async function smsAssistantTurn(job, { signal } = {}) {',
    'meeting-delegate-dispatch.mjs': 'export async function meetingDelegateDispatch(job, { signal } = {}) {',
    'preview-deploy.mjs': 'export async function previewDeploy(job, { signal } = {}) {',
    'world-news-pairing.mjs': 'env = process.env, now = new Date(), signal,'
  };
  for (const [site, [check, call]] of Object.entries(sites)) {
    const file = site.split('#')[0];
    const source = await readFile(new URL(`../src/executors/${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(entry[file]), `${file} takes the runner's signal`);
    const lines = source.split('\n').map((l) => l.trim());
    const at = lines.findIndex((l) => l.startsWith(call));
    assert.ok(at > 0, `${site}: the outward call is where this test expects it`);
    assert.equal(lines[at - 1], check, `${site}: the lease check is the statement right before the outward call`);
    assert.match(source, /^import \{ stopIfLeaseLost \} from '\.\.\/lease\.mjs';$/m, `${file} imports the check`);
  }
});
