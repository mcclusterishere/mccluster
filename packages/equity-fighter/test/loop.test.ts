import { describe, expect, it } from 'vitest';
import { LoopLimitError, runLoop, type Step } from '../src/agent/loop.js';
import { createGateway } from '../src/gateway.js';
import { config, message, MemoryStore, MockAdapter, MockDispatch, MockEquityNet } from './helpers.js';

describe('checkpointed loop', () => {
  it('saves each step and resumes after the last saved one', async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    let crash = true;
    const steps: Step<null>[] = [
      { kind: 'a', run: async () => (calls.push('a'), 1) },
      { kind: 'b', run: async (_c, saved) => (calls.push('b'), (saved.a as number) + 1) },
      {
        kind: 'c',
        run: async (_c, saved) => {
          calls.push('c');
          if (crash) throw new Error('process died');
          return (saved.b as number) + 1;
        },
      },
    ];
    await expect(runLoop('r1', steps, null, store)).rejects.toThrow('process died');
    crash = false;
    const result = await runLoop('r1', steps, null, store);
    expect(calls).toEqual(['a', 'b', 'c', 'c']);
    expect(result).toMatchObject({ resumedFrom: 2, ran: ['c'], outputs: { a: 1, b: 2, c: 3 } });
    expect((await store.loadSteps('r1')).map((s) => s.status)).toEqual(['done', 'done', 'done']);
  });

  it('enforces the step cap and the wall-clock cap', async () => {
    const store = new MemoryStore();
    const step: Step<null> = { kind: 's', run: async () => 1 };
    await expect(runLoop('r2', [step, step, step], null, store, { maxSteps: 2, deadlineMs: 1000 })).rejects.toBeInstanceOf(LoopLimitError);
    let t = 0;
    const slow: Step<null>[] = [{ kind: 'x', run: async () => ((t += 5000), 1) }, { kind: 'y', run: async () => 2 }];
    await expect(runLoop('r3', slow, null, store, { maxSteps: 8, deadlineMs: 1000, now: () => t })).rejects.toBeInstanceOf(LoopLimitError);
  });
});

describe('gateway resume', () => {
  it('a run left at "received" by a crash is finished by relay(), replaying dispatch idempotently', async () => {
    const store = new MemoryStore();
    const adapter = new MockAdapter('slack');
    let fail = true;
    const dispatch = new MockDispatch(() => {
      if (fail) throw new Error('harness down mid-turn');
      return { decision: 'answer', turn_id: 't-9', reply: 'Back online.' };
    });
    const gateway = createGateway({ config: config(), adapters: new Map([['slack', adapter]]), store, dispatch, equitynet: new MockEquityNet() });
    await gateway.handleMessage(message('what is running', { externalEventId: 'Ev-crash' }));
    expect(store.onlyRun().status).toBe('received');
    fail = false;
    await gateway.relay();
    expect(store.onlyRun()).toMatchObject({ status: 'answered', closed: true, turn_id: 't-9' });
    expect(adapter.sent.at(-1)?.reply.text).toBe('Back online.');
    // Same deterministic message id both times, so dispatch.turn replays instead of re-running.
    expect(new Set(dispatch.calls.map((c) => c.message_id)).size).toBe(1);
  });

  it('a forgotten message is not resumed', async () => {
    const store = new MemoryStore();
    const adapter = new MockAdapter('slack');
    const dispatch = new MockDispatch(() => {
      throw new Error('down');
    });
    const gateway = createGateway({ config: config(), adapters: new Map([['slack', adapter]]), store, dispatch, equitynet: new MockEquityNet() });
    await gateway.handleMessage(message('secret plan'));
    await store.forgetConversation('slack', 'D123');
    await gateway.relay();
    expect(store.onlyRun()).toMatchObject({ status: 'failed', closed: true });
    expect(dispatch.calls).toHaveLength(1);
  });
});
