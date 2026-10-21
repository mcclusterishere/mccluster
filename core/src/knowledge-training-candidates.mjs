// Seed grounded reading examples for later teacher distillation. These are
// review candidates, never an automatically approved fine-tuning dataset.
import { createHash } from 'node:crypto';
export function knowledgeTrainingCandidates(snapshot) {
  const facts = JSON.parse(snapshot.markdown);
  if (facts.schema_version !== 1 || !Number.isSafeInteger(facts.news?.records) || !Number.isSafeInteger(facts.analytics?.events)) throw new Error('Unsupported knowledge snapshot');
  const evidence = { day: facts.day, news: facts.news, analytics: facts.analytics, coverage: facts.coverage };
  return [{
    id: `${snapshot.snapshot_id}:coverage-v1`,
    status: 'needs_review', teacher: 'deterministic_ground_truth',
    source_snapshot_id: snapshot.snapshot_id, source_sha256: snapshot.content_hash,
    suggested_split: parseInt(createHash('sha256').update(facts.day).digest('hex').slice(0,8),16)%5===0 ? 'evaluation' : 'training',
    messages: [
      {role:'system',content:'You are McCluster. Answer from supplied evidence, cite its snapshot, distinguish stored records from world events and analytics events from people.'},
      {role:'user',content:`What does this daily snapshot establish, and what does it not establish?\nSnapshot ${snapshot.snapshot_id}\n${JSON.stringify(evidence)}`},
      {role:'assistant',content:`On ${facts.day}, the stored GDELT metadata contains ${facts.news.records} records. First-party analytics recorded ${facts.analytics.events} events, including ${facts.analytics.bot_events} marked bot events. These counts do not establish the total number of world events or unique human visitors. Evidence: snapshot ${snapshot.snapshot_id}.`},
    ],
  }];
}
