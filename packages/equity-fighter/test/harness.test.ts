import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHarnessClient, HarnessError, unwrapMcpResult } from '../src/harness/mcp-client.js';
import { createDispatchClient, messageIdFor, normalizeTurn } from '../src/harness/dispatch.js';
import { createEquityNetClient, chatText } from '../src/harness/equitynet.js';
import { PolicyDeniedError } from '../src/policy/approval-policy.js';
import { mockFetch, ORG, OWNER } from './helpers.js';
import type { OwnerActor } from '../src/types.js';

const actor: OwnerActor = { kind: 'owner', user_id: OWNER, via: { platform: 'slack', platform_user_id: 'UOWNER' } };
const mcpOk = (value: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }), { status: 200 });

describe('harness MCP client', () => {
  it('edge transport: owner bearer to api.mccluster.org, no self-named actor', async () => {
    const f = mockFetch(() => mcpOk({ route: 'answer', turn_id: 't' }));
    const client = createHarnessClient({ kind: 'edge', url: 'https://api.mccluster.org/v1/core/mcp', ownerAccessToken: 'test-owner-session', timeoutMs: 5000 }, f.fn);
    await client.callTool('dispatch.turn', { message: 'hi' }, actor, { ownerPresent: true });
    expect(f.calls[0]?.url).toBe('https://api.mccluster.org/v1/core/mcp');
    expect((f.calls[0]?.init.headers as any).authorization).toBe('Bearer test-owner-session');
    expect(f.calls[0]?.body.params._meta).toBeUndefined();
    expect(f.calls[0]?.body).toMatchObject({ method: 'tools/call', params: { name: 'dispatch.turn' } });
  });

  it('core transport: signature verifies with Core\'s own broker-edge-auth verifier', async () => {
    const f = mockFetch(() => mcpOk({ ok: true }));
    const client = createHarnessClient({ kind: 'core', baseUrl: 'https://core.example.test', token: 'test-broker-token', signingKey: 'test-edge-signing-key', timeoutMs: 5000 }, f.fn);
    await client.callTool('dispatch.get', { turn_id: 't' }, actor, { ownerPresent: false, unattended: true });
    const call = f.calls[0]!;
    expect(call.url).toBe('https://core.example.test/mcp');
    expect(call.body.params._meta['mccluster/actor']).toEqual({ user_id: OWNER, kind: 'owner', source: 'equity-fighter:slack' });
    const verifierPath = fileURLToPath(new URL('../../../core/src/broker-edge-auth.mjs', import.meta.url));
    const { createEdgeVerifier } = (await import(verifierPath)) as any;
    const verifier = createEdgeVerifier({ secret: 'test-edge-signing-key' });
    const bodyBytes = Buffer.from(call.init.body as Uint8Array);
    expect(() => verifier.verify({ method: 'POST', path: '/mcp', headers: call.init.headers, bodyBytes })).not.toThrow();
    expect(() => verifier.verify({ method: 'POST', path: '/mcp', headers: call.init.headers, bodyBytes })).toThrow(); // replay
  });

  it('refuses tools outside the allowlist and policy denials before any request', async () => {
    const f = mockFetch();
    const client = createHarnessClient({ kind: 'edge', url: 'https://api.mccluster.org/v1/core/mcp', ownerAccessToken: 'x', timeoutMs: 5000 }, f.fn);
    await expect(client.callTool('code.build', {}, actor, { ownerPresent: true, ownerConfirmed: true })).rejects.toBeInstanceOf(HarnessError);
    await expect(client.callTool('dispatch.execute', {}, actor, { ownerPresent: true })).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(f.calls).toHaveLength(0);
  });

  it('rejects plaintext URLs and surfaces MCP tool errors', async () => {
    expect(() => createHarnessClient({ kind: 'edge', url: 'http://api.example.test/mcp', ownerAccessToken: 'x', timeoutMs: 1 })).toThrow(/HTTPS/);
    expect(() => unwrapMcpResult({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'nope', code: 'DISPATCH_NOT_APPLIED', status: 503 }) }] })).toThrow('nope');
  });
});

describe('dispatch client', () => {
  it('derives a stable UUID per platform event', async () => {
    const a = await messageIdFor('slack', 'Ev1');
    expect(a).toBe(await messageIdFor('slack', 'Ev1'));
    expect(a).not.toBe(await messageIdFor('telegram', 'Ev1'));
  });

  it('reads dispatch.turn and fails closed on anything else', () => {
    expect(normalizeTurn({ route: 'approval', turn_id: 't', approval_id: 'a', capability: 'code.build' })).toMatchObject({ decision: 'approval', approval_id: 'a' });
    expect(normalizeTurn({ route: 'run' })).toMatchObject({ decision: 'refused' });
    expect(normalizeTurn({ route: 'yolo', turn_id: 't' })).toMatchObject({ decision: 'refused' });
  });

  it('turns a not-yet-applied dispatch layer into a refusal, not a run', async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'not applied', code: 'DISPATCH_NOT_APPLIED', status: 503 }) }] } })));
    const client = createDispatchClient(createHarnessClient({ kind: 'edge', url: 'https://api.mccluster.org/v1/core/mcp', ownerAccessToken: 'x', timeoutMs: 5000 }, f.fn), { orgId: ORG });
    const outcome = await client.dispatch({ message_id: await messageIdFor('slack', 'e'), message: 'hi', actor });
    expect(outcome.decision).toBe('refused');
    expect(outcome.reply).toMatch(/not live yet/);
    expect(f.calls[0]?.body.params.arguments).toMatchObject({ org_id: ORG, message: 'hi' });
  });
});

describe('EquityNet client', () => {
  it('asks Core for ai.chat and reads the task back', async () => {
    const f = mockFetch((_u, init) => {
      const body = JSON.parse(new TextDecoder().decode(init.body as Uint8Array));
      return mcpOk(body.params.name === 'ai.chat' ? { task: { id: 'task-1', status: 'queued' }, replayed: false } : { id: 'task-1', status: 'done', output: { message: { content: 'hi' } } });
    });
    const net = createEquityNetClient(createHarnessClient({ kind: 'edge', url: 'https://api.mccluster.org/v1/core/mcp', ownerAccessToken: 'x', timeoutMs: 5000 }, f.fn), { orgId: ORG });
    expect(await net.enqueueChat('summarize', actor)).toMatchObject({ id: 'task-1' });
    const task = await net.readTask('task-1', actor);
    expect(chatText(task?.output)).toBe('hi');
  });
});
