import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnalyticsPages } from '../src/analytics/paged-reads.js';

const row = (n, at='2026-10-23T23:00:00.123456+00:00') => ({ id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`, at });
for (const direction of ['asc','desc']) test(`event cursor preserves timestamp ties and all rows ${direction}`, async () => {
  const source=[row(1),row(2),row(3,'2026-10-23T23:00:00.123457+00:00'),row(4,'2026-10-23T23:00:01+00:00')];
  if(direction==='desc')source.reverse();
  const calls=[];
  const result=await readAnalyticsPages(async(path,start,end)=>{
    const q=new URL('https://db.test/'+path).searchParams;
    calls.push({q,start,end});
    assert.equal(start,0,'cursor pages never use an offset');
    assert.deepEqual(q.getAll('at').slice(0,2),['gte.2026-10-01','lt.2026-10-24']);
    assert.equal(q.get('site_id'),'is.null');
    assert.equal(q.get('uid'),'in.(account1,account2)');
    if(calls.length===1){assert.equal(q.get('or'),null);return source.slice(0,2);}
    const last=source[(calls.length-1)*2-1],op=direction==='asc'?'gt':'lt';
    assert.equal(q.getAll('at')[2],`${op}e.${last.at}`);
    assert.equal(q.get('or'),`(at.${op}.${last.at},and(at.eq.${last.at},id.${op}.${last.id}))`);
    return source.slice((calls.length-1)*2,calls.length*2);
  },`events?site_id=is.null&uid=in.(account1,account2)&at=gte.2026-10-01&at=lt.2026-10-24&select=id,at,props&order=at.${direction},id.${direction}`,10,2);
  assert.deepEqual(result,source);
  assert.equal(result.readMetadata.status,'complete');
  assert.equal(result.readMetadata.pages,3);
});

test('cursor caps remain partial and unchanged cursors fail visibly',async()=>{
  const path='events_lean?select=id,at&order=at.asc,id.asc';
  const capped=await readAnalyticsPages(async()=>[row(1),row(2)],path,2,2);
  assert.equal(capped.readMetadata.status,'limit_reached');
  await assert.rejects(readAnalyticsPages(async()=>[row(1),row(2)],path,6,2),/did not advance/);
  await assert.rejects(readAnalyticsPages(async()=>[{id:'invalid',at:'yesterday'}],path,2,1),/Invalid analytics page cursor/);
});

test('unordered and non-event callers retain bounded offset pagination',async()=>{
  const calls=[],source=[1,2,3];
  const path='experience_decisions?select=id,created_at&order=created_at.desc,id.desc';
  const out=await readAnalyticsPages(async(p,start,end)=>{assert.equal(p,path);calls.push([start,end]);return source.slice(start,end+1);},path,10,2);
  assert.deepEqual(out,source);assert.deepEqual(calls,[[0,1],[2,3]]);
});
