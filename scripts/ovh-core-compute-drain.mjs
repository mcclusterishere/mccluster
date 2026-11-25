#!/usr/bin/env node
// Deployment fencing uses the existing canonical node state, never a new queue.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { nodeIdFromPublicKey } from '../core/src/compute/signature.mjs';

const query = (values) => new URLSearchParams(values).toString();
const request = (rest, path, init = {}) => rest(path, { ...init, signal: AbortSignal.timeout(10_000) });

export async function beginDrain({ rest, nodeId, orgId, save }) {
  const filter = query({ id: `eq.${nodeId}`, org_id: `eq.${orgId}`, select: 'id,org_id,state,revoked_at' });
  const { body: rows } = await request(rest, `ops_compute_nodes?${filter}`);
  const node = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!node || node.revoked_at || !['online', 'draining'].includes(node.state)) {
    throw new Error('Canonical compute node is missing, revoked, or unavailable; refusing deployment');
  }
  const receipt = { schema_version: 1, node_id: nodeId, org_id: orgId, previous_state: node.state };
  // Persist BEFORE the request: a lost PATCH response may still have committed.
  save(receipt);
  if (node.state === 'online') {
    const match = query({ id: `eq.${nodeId}`, org_id: `eq.${orgId}`, state: 'eq.online', revoked_at: 'is.null' });
    const { body } = await request(rest, `ops_compute_nodes?${match}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ state: 'draining' }),
    });
    if (!Array.isArray(body) || body.length !== 1 || body[0].state !== 'draining') {
      throw new Error('Compute drain was not acknowledged; refusing deployment');
    }
  }
  return receipt;
}

function validateReceipt(receipt) {
  if (receipt?.schema_version !== 1 || !/^node_[a-f0-9]{32}$/.test(receipt.node_id || '') ||
      !/^[a-f0-9-]{36}$/.test(receipt.org_id || '') || !['online', 'draining'].includes(receipt.previous_state)) {
    throw new Error('Invalid compute drain receipt');
  }
}

async function readNode(rest, receipt) {
  validateReceipt(receipt);
  const { body } = await request(rest, `ops_compute_nodes?${query({
    id: `eq.${receipt.node_id}`, org_id: `eq.${receipt.org_id}`, select: 'id,state,revoked_at',
  })}`);
  if (!Array.isArray(body) || body.length !== 1) throw new Error('Compute node cannot be verified');
  return body[0];
}

export async function checkDrain({ rest, receipt }) {
  const node = await readNode(rest, receipt);
  if (node.state !== 'draining' || node.revoked_at) throw new Error('Compute drain fence was lost');
  // Count expired leases too: expiry alone is not proof that execution finished.
  const { body } = await request(rest, `ops_compute_leases?${query({
    node_id: `eq.${receipt.node_id}`, status: 'in.(leased,running)', select: 'id', limit: '1',
  })}`);
  if (!Array.isArray(body)) throw new Error('Compute lease state cannot be verified');
  return body.length === 0;
}

export async function endDrain({ rest, receipt }) {
  const node = await readNode(rest, receipt);
  // A preexisting operator drain remains in place. Never undo revocation or
  // quarantine, including a concurrent operator change during deployment.
  if (receipt.previous_state === 'draining' || node.revoked_at || ['revoked', 'quarantined'].includes(node.state)) return;
  if (node.state === 'online') return;
  if (node.state !== 'draining') throw new Error('Unexpected node state during drain recovery');
  const { body } = await request(rest, `ops_compute_nodes?${query({
    id: `eq.${receipt.node_id}`, org_id: `eq.${receipt.org_id}`, state: 'eq.draining', revoked_at: 'is.null',
  })}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ state: 'online' }) });
  if (!Array.isArray(body) || body.length !== 1 || body[0].state !== 'online') throw new Error('Compute drain recovery was not acknowledged');
}

// Node installs its own signal defaults even when the spawning rollback shell
// ignores TERM. Protect only bounded recovery reads/writes, never normal work.
export function protectRecoverySignals() {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {});
}

async function main() {
  const [action, receiptPath] = process.argv.slice(2);
  if (!['begin', 'check', 'end'].includes(action) || !receiptPath) throw new Error('Expected begin|check|end and receipt path');
  if (action === 'end') protectRecoverySignals();
  const { rest } = await import('../core/src/supabase.mjs');
  if (action === 'begin') {
    const identity = JSON.parse(readFileSync('/var/lib/mccluster-node/identity.json', 'utf8'));
    const nodeId = nodeIdFromPublicKey(identity.publicKeyPem);
    if (identity.nodeId !== nodeId) throw new Error('Local compute node identity mismatch');
    const { body: house } = await request(rest, 'orgs?slug=eq.mccluster&select=id,enabled&limit=1');
    const orgId = Array.isArray(house) && house[0]?.enabled === true ? house[0].id : null;
    if (!/^[a-f0-9-]{36}$/.test(orgId || '')) throw new Error('Canonical house cannot be verified');
    await beginDrain({ rest, nodeId, orgId, save: (receipt) => writeFileSync(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }) });
    return;
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (action === 'check') {
    if (!await checkDrain({ rest, receipt })) process.exitCode = 10;
  } else {
    await endDrain({ rest, receipt });
    unlinkSync(receiptPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never print backend error bodies or environment/identity material.
    console.error('Canonical compute drain operation failed; deployment must stop and recover.');
    process.exitCode = 1;
  });
}
