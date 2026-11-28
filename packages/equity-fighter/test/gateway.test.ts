import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/gateway.js';
import { pairingCode } from '../src/pairing.js';
import { config, message, MemoryStore, MockAdapter, MockDispatch, MockEquityNet, slackEnv } from './helpers.js';
import type { DispatchOutcome } from '../src/types.js';

function setup(next: DispatchOutcome = { decision: 'answer', turn_id: 't-1', reply: 'Hi Matthew.' }, env = slackEnv()) {
  const store = new MemoryStore();
  const adapter = new MockAdapter('slack');
  const dispatch = new MockDispatch(next);
  const equitynet = new MockEquityNet();
  const cfg = config(env);
  const gateway = createGateway({ config: cfg, adapters: new Map([['slack', adapter]]), store, dispatch, equitynet });
  return { store, adapter, dispatch, equitynet, gateway, cfg };
}

describe('owner-only access', () => {
  it('gives a stranger no reply and never reaches the harness', async () => {
    const { gateway, adapter, dispatch, store } = setup();
    await gateway.handleMessage(message('run code.build on mcclusterishere/mccluster', { platformUserId: 'USTRANGER' }));
    expect(adapter.sent).toHaveLength(0);
    expect(dispatch.calls).toHaveLength(0);
    expect(store.runs.size).toBe(0);
  });

  it('pairs an account only with the code minted for that exact account', async () => {
    const { gateway, adapter, dispatch, store, cfg } = setup();
    const codeForOther = await pairingCode(cfg.pairingSecret, 'slack', 'UOTHER');
    await gateway.handleMessage(message(`/pair ${codeForOther}`, { platformUserId: 'UNEW' }));
    expect(adapter.sent).toHaveLength(0);
    expect(await store.trustOf('slack', 'UNEW')).toBeNull();

    const code = await pairingCode(cfg.pairingSecret, 'slack', 'UNEW');
    await gateway.handleMessage(message(`/pair ${code}`, { platformUserId: 'UNEW' }));
    expect(await store.trustOf('slack', 'UNEW')).toBe('owner');
    expect(adapter.sent.at(-1)?.reply.text).toMatch(/^Paired/);

    await gateway.handleMessage(message('status', { platformUserId: 'UNEW' }));
    expect(dispatch.calls).toHaveLength(1);
  });

  it('never pairs a blocked account', async () => {
    const { gateway, store, cfg, adapter } = setup();
    store.identities.set('slack:UBAD', 'blocked');
    await gateway.handleMessage(message(`/pair ${await pairingCode(cfg.pairingSecret, 'slack', 'UBAD')}`, { platformUserId: 'UBAD' }));
    expect(await store.trustOf('slack', 'UBAD')).toBe('blocked');
    expect(adapter.sent).toHaveLength(0);
  });
});

describe('dispatch outcomes', () => {
  it('answers and closes the run', async () => {
    const { gateway, adapter, dispatch, store } = setup();
    await gateway.handleMessage(message('hello'));
    expect(adapter.sent[0]?.reply.text).toBe('Hi Matthew.');
    expect(dispatch.calls[0]?.actor).toMatchObject({ kind: 'owner', user_id: '22222222-2222-4222-8222-222222222222' });
    expect(dispatch.calls[0]?.message_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(store.onlyRun()).toMatchObject({ status: 'answered', closed: true, turn_id: 't-1' });
  });

  it('a gated request starts nothing, points at Control, and waits', async () => {
    const { gateway, adapter, store, equitynet } = setup({ decision: 'approval', turn_id: 't-2', capability: 'code.build', approval_id: 'a-1', decision_id: 'd-1', reply: 'Held for approval.' });
    await gateway.handleMessage(message('build a fix in mcclusterishere/mccluster'));
    const text = adapter.sent[0]?.reply.text ?? '';
    expect(text).toMatch(/approval before anything runs \(code\.build\)/);
    expect(text).toContain('control.html');
    expect(store.onlyRun()).toMatchObject({ status: 'awaiting_approval', closed: false, approval_id: 'a-1', decision_id: 'd-1' });
    expect(equitynet.enqueued).toHaveLength(0);
  });

  it('"go" only asks dispatch.execute; an unapproved turn stays unstarted', async () => {
    const { gateway, adapter, dispatch, store } = setup({ decision: 'approval', turn_id: 't-3', capability: 'deploy.preview' });
    await gateway.handleMessage(message('preview mcclusterishere/mccluster ref main'));
    await gateway.handleMessage(message('go'));
    expect(dispatch.executes).toEqual(['t-3']);
    expect(adapter.sent.at(-1)?.reply.text).toMatch(/waiting for your approval/i);
    expect(store.onlyRun()).toMatchObject({ status: 'awaiting_approval', closed: false });

    dispatch.executeResult = { executed: true, status: 'queued', job_id: 'job-9', relay: 'Approved and started on McCluster Core.' };
    await gateway.handleMessage(message('go'));
    expect(store.onlyRun()).toMatchObject({ status: 'running', job_id: 'job-9' });
  });

  it('"go" with nothing pending calls nothing', async () => {
    const { gateway, dispatch, adapter } = setup();
    await gateway.handleMessage(message('go'));
    expect(dispatch.executes).toHaveLength(0);
    expect(adapter.sent[0]?.reply.text).toMatch(/Nothing here is waiting/);
  });

  it('relays a refusal and records it as closed', async () => {
    const { gateway, adapter, store } = setup({ decision: 'refused', turn_id: 't-4', intent: 'refuse.outreach', reply: 'Outside messages and outreach are not dispatched from chat.' });
    await gateway.handleMessage(message('email all the leads'));
    expect(adapter.sent[0]?.reply.text).toMatch(/not dispatched from chat/);
    expect(store.onlyRun()).toMatchObject({ status: 'refused', closed: true });
  });

  it('a queued job is relayed once it finishes', async () => {
    const { gateway, adapter, dispatch, store } = setup({ decision: 'run', turn_id: 't-5', capability: 'objective.plan', job_id: 'job-1', status: 'queued' });
    await gateway.handleMessage(message('plan the catalogue audit'));
    expect(adapter.sent[0]?.reply.text).toMatch(/Queued objective\.plan/);
    expect(await gateway.relay()).toEqual({ checked: 1, relayed: 0 });
    dispatch.views.set('t-5', { status: 'queued', route: 'run', job: { status: 'done', output: { summary: 'Plan has 6 steps.' } }, approval: null, answer: null, relay: 'Finished.' });
    expect(await gateway.relay()).toEqual({ checked: 1, relayed: 1 });
    expect(adapter.sent.at(-1)?.reply.text).toBe('Done: Plan has 6 steps.');
    expect(store.onlyRun()).toMatchObject({ status: 'done', closed: true });
    expect(await gateway.relay()).toEqual({ checked: 0, relayed: 0 });
  });

  it('tells the owner once when Control approves, and closes on deny', async () => {
    const { gateway, adapter, dispatch } = setup({ decision: 'approval', turn_id: 't-6', capability: 'game.build' });
    await gateway.handleMessage(message('build the game'));
    dispatch.views.set('t-6', { status: 'pending_approval', route: 'approval', job: null, approval: { state: 'approved' }, answer: null, relay: null });
    await gateway.relay();
    await gateway.relay();
    expect(adapter.sent.filter((s) => /Reply "go"/.test(s.reply.text))).toHaveLength(1);
    dispatch.views.set('t-6', { status: 'denied', route: 'approval', job: null, approval: { state: 'denied' }, answer: null, relay: null });
    await gateway.relay();
    expect(adapter.sent.at(-1)?.reply.text).toMatch(/denied/);
    expect(await gateway.relay()).toEqual({ checked: 0, relayed: 0 });
  });

  it('a platform retry of the same event is a no-op', async () => {
    const { gateway, dispatch, adapter } = setup();
    const m = message('hello', { externalEventId: 'Ev-same' });
    await gateway.handleMessage(m);
    await gateway.handleMessage(m);
    expect(dispatch.calls).toHaveLength(1);
    expect(adapter.sent).toHaveLength(1);
  });

  it('a harness failure says nothing new started', async () => {
    const { gateway, adapter, dispatch } = setup();
    dispatch.next = () => {
      throw new Error('boom');
    };
    await gateway.handleMessage(message('hello'));
    expect(adapter.sent[0]?.reply.text).toMatch(/nothing new was started/);
  });
});

describe('gateway commands', () => {
  it('/local goes to EquityNet through ai.chat and relays the device answer', async () => {
    const { gateway, adapter, equitynet, dispatch, store } = setup();
    await gateway.handleMessage(message('/local summarize my week'));
    expect(equitynet.enqueued).toEqual(['summarize my week']);
    expect(dispatch.calls).toHaveLength(0);
    expect(store.onlyRun()).toMatchObject({ capability: 'ai.chat', compute_task_id: 'task-1', status: 'running' });
    equitynet.tasks.set('task-1', { id: 'task-1', status: 'done', output: { message: { role: 'assistant', content: 'You shipped 3 PRs.' } } });
    await gateway.relay();
    expect(adapter.sent.at(-1)?.reply.text).toBe('You shipped 3 PRs.');
  });

  it('/forget deletes stored messages for that conversation only', async () => {
    const { gateway, store } = setup();
    await gateway.handleMessage(message('hello'));
    await gateway.handleMessage(message('hello elsewhere', { reply: { platform: 'slack', conversationId: 'D999' } }));
    await gateway.handleMessage(message('/forget'));
    expect(store.messages.every((m) => m.conversation_id === 'D999')).toBe(true);
    expect(store.messages.length).toBeGreaterThan(0);
  });
});

describe('HTTP surface', () => {
  it('is 503 when disabled and reports health without secrets', async () => {
    const { gateway } = setup(undefined, slackEnv({ EQUITY_FIGHTER_ENABLED: 'false' }));
    const res = await gateway.fetch(new Request('https://ef.example.test/webhooks/slack', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
    const health = await (await gateway.fetch(new Request('https://ef.example.test/health'))).text();
    expect(health).not.toMatch(/test-slack|test-owner-session|test-pairing|test-service-key/);
  });

  it('404s a platform that is not enabled', async () => {
    const { gateway } = setup();
    const res = await gateway.fetch(new Request('https://ef.example.test/webhooks/whatsapp', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
  });
});
