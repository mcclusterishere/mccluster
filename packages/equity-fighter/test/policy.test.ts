import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPABILITY_CLASSES, decide } from '../src/policy/approval-policy.js';
import { ALLOWED_TOOLS } from '../src/harness/mcp-client.js';

const catalogPath = fileURLToPath(new URL('../../../core/capabilities/catalog.json', import.meta.url));

describe('approval policy', () => {
  const owner = { ownerPresent: true };

  it('runs read capabilities, even unattended', () => {
    expect(decide('dispatch.get', { ownerPresent: false, unattended: true }).allow).toBe(true);
    expect(decide('ai.chat', owner).allow).toBe(true);
  });

  it('runs approval-free writes only with the owner present', () => {
    expect(decide('dispatch.turn', owner).allow).toBe(true);
    expect(decide('dispatch.turn', { ownerPresent: false, unattended: true })).toMatchObject({ allow: false, code: 'EF_POLICY_UNATTENDED' });
  });

  it('owner-class capabilities need an explicit confirmation this turn', () => {
    expect(decide('dispatch.execute', owner)).toMatchObject({ allow: false, code: 'EF_POLICY_OWNER_CONFIRMATION' });
    expect(decide('dispatch.execute', { ownerPresent: true, ownerConfirmed: true }).allow).toBe(true);
    expect(decide('dispatch.execute', { ownerPresent: false, ownerConfirmed: true, unattended: true }).allow).toBe(false);
  });

  it('tainted input only reaches reads', () => {
    expect(decide('dispatch.turn', { ownerPresent: true, tainted: true })).toMatchObject({ allow: false, code: 'EF_POLICY_TAINTED' });
    expect(decide('dispatch.get', { ownerPresent: true, tainted: true }).allow).toBe(true);
  });

  it('denies by default and denies every gated class and always-gated risk', () => {
    expect(decide('code.build', { ownerPresent: true, ownerConfirmed: true })).toMatchObject({ allow: false, code: 'EF_POLICY_UNKNOWN' });
    const classes = {
      'x.review': { risk: 'write', approval: 'review-required' },
      'x.budget': { risk: 'write', approval: 'budget-gated' },
      'x.policy': { risk: 'write', approval: 'owner-policy-gated' },
      'x.spend': { risk: 'spend', approval: 'none' },
      'x.deploy': { risk: 'deploy', approval: 'owner' },
      'x.destroy': { risk: 'destructive', approval: 'none' },
    } as const;
    for (const tool of Object.keys(classes)) {
      expect(decide(tool, { ownerPresent: true, ownerConfirmed: true }, classes as any).allow, tool).toBe(false);
    }
  });

  it('covers exactly the tools the harness client may call', () => {
    expect(Object.keys(CAPABILITY_CLASSES).sort()).toEqual([...ALLOWED_TOOLS].sort());
  });

  it('matches core/capabilities/catalog.json (fails on drift)', () => {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    for (const [id, cls] of Object.entries(CAPABILITY_CLASSES)) {
      const entry = catalog.capabilities.find((c: any) => c.id === id);
      expect(entry, `${id} missing from the catalog`).toBeTruthy();
      expect({ risk: entry.risk, approval: entry.approval }, id).toEqual(cls);
      expect(entry.interfaces, `${id} must be reachable over MCP`).toContain('mcp');
    }
  });
});
