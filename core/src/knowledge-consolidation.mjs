import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { knowledgeTrainingCandidates } from './knowledge-training-candidates.mjs';
import { rest, resolveHouseOrgId } from './supabase.mjs';

export async function consolidateKnowledge({ query = rest, resolveOrg = resolveHouseOrgId, now = new Date(), root = '/var/lib/mccluster-core/knowledge' } = {}) {
  const orgId = await resolveOrg();
  // Retry the last seven completed days after outages. Immutable canonical
  // snapshots make repeated calls safe; OVH files are rebuildable derivatives.
  const results = [];
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (let age = 7; age >= 1; age--) {
    const day = new Date(now.getTime() - age * 86400000).toISOString().slice(0, 10);
    const { body } = await query('rpc/ops_ai_knowledge_consolidate', { method: 'POST', body: JSON.stringify({ p_org_id: orgId, p_day: day }) });
    if (!body?.snapshot_id || typeof body.markdown !== 'string') throw new Error('Missing canonical daily snapshot');
    const hash = createHash('sha256').update(body.markdown).digest('hex');
    if (hash !== body.content_hash) throw new Error('Canonical snapshot checksum mismatch');
    const facts = JSON.parse(body.markdown);
    const artifact = { ...body, canonical_store: 'ai_context.context_snapshots', org_id: orgId, facts };
    delete artifact.markdown;
    const destination = path.join(root, `${day}.json`);
    await writeFile(`${destination}.tmp`, JSON.stringify(artifact) + '\n', { mode: 0o600 });
    await rename(`${destination}.tmp`, destination);
    const candidates = knowledgeTrainingCandidates(body);
    const trainingPath = path.join(root, `${day}.candidates.jsonl`);
    await writeFile(`${trainingPath}.tmp`, candidates.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
    await rename(`${trainingPath}.tmp`, trainingPath);
    results.push({ day, snapshot_id: body.snapshot_id, content_hash: hash, replayed: body.replayed });
  }
  return results;
}
