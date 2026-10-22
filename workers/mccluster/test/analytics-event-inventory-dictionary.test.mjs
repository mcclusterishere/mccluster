import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DICTIONARY_VERSION, DICTIONARY_SOURCE, EVENT_DICTIONARY } from '../src/analytics/measurement-dictionary.js';

test('reviewed taxonomy and owner measurement dictionary stay identical',()=>{
  const sql=readFileSync(new URL('../../../supabase/pending/analytics_event_inventory_v1.sql', import.meta.url),'utf8');
  const rows=sql.split('\n').map(line=>line.match(/^\s+\('([^']+)','([^']+)','([^']+)'\),?$/)).filter(Boolean);
  assert.equal(rows.length,30);
  assert.equal(DICTIONARY_VERSION,'analytics-dictionary/2026-10-21.1');
  assert.equal(DICTIONARY_SOURCE.reviewed_taxonomy_migration,'supabase/pending/analytics_event_inventory_v1.sql');
  for(const [,name,stage,note] of rows){
    const row=EVENT_DICTIONARY.find(x=>x.event_name===name);
    assert.ok(row,'Missing reviewed name '+name);
    assert.equal(row.source_stage,stage,name);
    assert.equal(row.meaning,note,name);
    assert.equal(row.verified_outcome,false,name);
  }
  const signup=EVENT_DICTIONARY.find(x=>x.event_name==='signup_succeeded');
  if(signup) assert.equal(signup.source_stage,'unclassified','A reported signup is not an auth.users registration');
});
