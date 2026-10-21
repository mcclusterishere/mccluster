import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { consolidateKnowledge } from '../src/knowledge-consolidation.mjs';
import { executeResidentTool } from '../src/resident-tools.mjs';

test('consolidation catches up completed UTC days and preserves canonical checksums on OVH', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-'));
  const calls = [];
  try {
    const results = await consolidateKnowledge({ root, now: new Date('2026-10-21T00:00:00Z'), resolveOrg: async () => 'house', query: async (url, init) => {
      const args = JSON.parse(init.body); calls.push(args);
      assert.equal(url, 'rpc/ops_ai_knowledge_consolidate'); assert.equal(args.p_org_id, 'house');
      const markdown = JSON.stringify({schema_version:1,day: args.p_day, news: {records: 42},analytics:{events:10,bot_events:2}});
      return { body: { snapshot_id: 'canonical-id', markdown, content_hash: createHash('sha256').update(markdown).digest('hex'), day: args.p_day, replayed: true } };
    }});
    assert.equal(results.length, 7);
    assert.equal(calls[0].p_day, '2026-10-14'); assert.equal(calls.at(-1).p_day, '2026-10-20');
    const local = JSON.parse(await readFile(path.join(root, '2026-10-20.json')));
    const candidate = JSON.parse(await readFile(path.join(root, '2026-10-20.candidates.jsonl')));
    assert.equal(candidate.status, 'needs_review'); assert.equal(candidate.teacher, 'deterministic_ground_truth');
    assert.match(candidate.messages[2].content, /10 events/);
    assert.equal(local.facts.news.records, 42); assert.equal(local.canonical_store, 'ai_context.context_snapshots');
    await assert.rejects(consolidateKnowledge({root, resolveOrg: async ()=>'house', query: async()=>({body:{snapshot_id:'id',markdown:'{}',content_hash:'wrong'}})}), /checksum/);
  } finally { await rm(root, {recursive:true,force:true}); }
});
test('knowledge reader binds trusted organization and bounds its lookback', async () => {
  const result = await executeResidentTool('knowledge_read', {query:'earthquake',days:100}, {orgId:'trusted-house',turnId:'turn'}, {rest:async(url,init)=> {
    assert.equal(url,'rpc/ops_ai_knowledge_read');
    assert.deepEqual(JSON.parse(init.body), {p_org_id:'trusted-house',p_query:'earthquake',p_days:30});
    return {body:{news:[],analytics:{events:0}}};
  }});
  assert.equal(result.analytics.events,0);
});
