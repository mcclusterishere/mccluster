import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const H=require('../../js/world-house-agents.js');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const a=(id,country='US',region='US-CT')=>({
  actor_type:'fictional_system_account',
  account_id:id,
  handle:'prim3-'+id,
  display_name:'Character '+id,
  disclosure:'Fictional AI-produced entertainment account by McCluster Corp.',
  editorial_mission:'Tell a coherent fictional story.',
  story_country:country,
  story_region:region,
  region_label:'Connecticut',
  latitude:41.55,
  longitude:-72.7,
  verified_human:false
});

test('invalid/human accounts are excluded before a World layer is formed',()=>{
  const v=H.normalize([a('a'),a('a'),{...a('b'),verified_human:true},
    {...a('c'),actor_type:'human'},{...a('d'),story_country:'USA'},a('z','US',null)]);
  assert.equal(v.length,2);
  assert.deepEqual(v.map(x=>x.id),['a','z']);
  assert.equal(v[1].region,null);
});
test('regional markers require explicit location and never use country centre for unknown users',()=>{
  const list=H.normalize([a('a'),a('b'),a('c','US',null),
    {...a('d'),latitude:0,longitude:0},
    {...a('e'),latitude:null,longitude:null},
    {...a('f'),story_region:'US-NY',region_label:'New York',latitude:40.7,longitude:-74},
    {...a('g'),story_region:'CA-BC',story_country:'US'}]);
  const grouped=H.byRegion(list);
  assert.equal(grouped.length,2);
  assert.deepEqual(grouped.map(x=>[x.region_key,x.accounts.length]),[['US-CT',2],['US-NY',1]]);
  assert.equal(H.byCountry(list).US,7);
});
test('World does not borrow region member counts or geolocation to place fictional accounts',()=>{
  const source=read('js/world-house-agents.js');
  assert.doesNotMatch(source,/geolocation\.getCurrentPosition|action_globe_public_regions|member_count/);
  assert.match(source,/verified_human!==false/);
  assert.match(source,/Fictional character accounts/);
  assert.match(source,/not verified local residents/i);
});
test('Cesium World owns one additive fictional-account layer with no new global nav',()=>{
  const html=read('action-globe.html');
  const action=read('js/action-globe.js');
  const countries=read('js/world-countries.js');
  assert.match(html, /css\/world-house-agents\.css/);
  assert.ok(html.indexOf('js/world-house-agents.js') < html.indexOf('js/action-globe.js'));
  assert.match(action,/mountHouseAgents\(\)/);
  assert.match(action,/if\(houseAgents&&houseAgents\.click\(e\)\)return/);
  assert.match(action,/if\(!window\.HuHouseAgents\|\|ANALYTICS\|\|!viewer\)return/);
  assert.match(countries,/fictional character/);
  assert.match(countries,/not members/);
});
test('no public actor appears from an unapproved draft or a fake frontend seed',()=>{
  const source=read('js/world-house-agents.js');
  assert.match(source,/\/v1\/house-agents\/public/);
  assert.doesNotMatch(source,/\/v1\/house-agents\/owner|proposed_not_provisioned|house_system_accounts/);
  assert.match(source,/if\(!res\.ok\)throw new Error/);
  assert.match(source,/\.catch\(\(\)=>\(\{accounts:0,regions:0,unavailable:true\}\)\)/);
});


test('fictional-character directory is visible in embedded Human Uprise World, where legacy #deck is hidden',()=>{
  const source=read('js/world-house-agents.js');
  const css=read('css/world-house-agents.css');
  const globeCss=read('css/action-globe.css');
  assert.ok(globeCss.includes('.globe-surface-network #deck') && globeCss.includes('display:none!important'));
  assert.match(source,/document\.documentElement\.classList\.contains\('globe-surface-network'\)[\s\S]*?\? document\.body : document\.getElementById\('deck'\)/);
  assert.match(css,/html\.globe-surface-network \.world-house-agents/);
  assert.match(css,/max-height:calc\(100dvh - 16px\)/);
});
