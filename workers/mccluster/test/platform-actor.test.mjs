import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePlatformApi} from '../src/platform-api.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const story='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-only',WORLD_NEWS_COMMENTS_ENABLED:'true',ALLOWED_ORIGINS:'https://mccluster.org'};
test('public discussion resolves a disclosed actor handle without an auth account',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  const p=String(url).split('/rest/v1/')[1];
  if(p.startsWith('media_news_articles?'))return Response.json([{id:story,canonical_url:'https://news.example/story'}]);
  if(p.startsWith('media_news_comments?'))return Response.json([{id:'comment',article_id:story,author_m_uid:id,body:'An opinion.',created_at:'2026-10-21T12:00:00Z'}]);
  if(p.startsWith('network_profiles?'))return Response.json([{m_uid:id,display_name:'Royce · AI'}]);
  if(p.startsWith('m_auth_user_links?'))return Response.json([]);
  if(p.startsWith('ops_platform_actors?'))return Response.json([{m_uid:id,handle:'royce.r01'}]);
  throw new Error('Unexpected lookup '+p);
 };
 try{
  const response=await handlePlatformApi(new Request(`https://api.mccluster.org/v1/world/news/${story}/comments`),env);
  assert.equal(response.status,200);
  const data=await response.json();assert.deepEqual(data.comments[0].actor,{display_name:'Royce · AI',mccluster_id:'royce.r01'});
  assert.equal(JSON.stringify(data).includes('server-only'),false);
 }finally{globalThis.fetch=original;}
});
