import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFront} from '../../packages/front-config/index.mjs';
const example=JSON.parse(readFileSync(new URL('../../data/equity-uprise-offers-template.json',import.meta.url)));
const prefix='https://db.test/storage/v1/object/public/front-media/owner/projects/site/';
test('ordinary offers template keeps three audiences and nine editable experiences, without identity authority',()=>{
 const {config,dropped}=validateFront({layout:'offers',offer_page:example},{mediaPrefix:prefix});
 assert.deepEqual(dropped,[]);assert.equal(config.offer_page.cards.length,3);
 assert.deepEqual(config.offer_page.cards.map(c=>c.experiences.map(x=>x.title)),[['Build','Run','Grow'],['Discover','Contribute','Earn'],['Discover','Back','Follow']]);
 assert.equal(config.registry_key,undefined);assert.equal(config.owner_user_id,undefined);
});
test('offers reject executable links and foreign media, retaining literal text for DOM textContent rendering',()=>{
 const p=structuredClone(example);p.title='<img src=x onerror=alert(1)>';p.primary.href='javascript:alert(1)';p.cards[0].image=prefix+'photo.jpg';p.cards[1].image='https://db.test/storage/v1/object/public/front-media/other/photo.jpg';
 const {config,dropped}=validateFront({layout:'offers',offer_page:p},{mediaPrefix:prefix});
 assert.equal(config.offer_page.title,p.title);assert.equal(config.offer_page.cards[0].image,p.cards[0].image);
 assert.equal(config.offer_page.cards[1].image,undefined);assert.equal(config.offer_page.primary,undefined);
 assert.deepEqual(dropped,['offer_page.primary','offer_page.cards.1.image']);
 for(const href of ['//evil.test','data:text/html,x','https://ok.test/" onclick="x']){
  p.primary.href=href;assert.ok(validateFront({layout:'offers',offer_page:p}).dropped.includes('offer_page.primary'));
 }
});
test('canonical artist bindings are explicit IDs, separate from civic identity and unchanged recording credits',()=>{
 const data=JSON.parse(readFileSync(new URL('../../data/albums.json',import.meta.url)));
 const equity=data.albums.find(a=>a.slug==='equity-uprise');assert.equal(equity.artist,'Equity Uprise');
 assert.equal(equity.artist_profile_id,'https://matthew.mccluster.org/catalogue.html#artist-equity-uprise');
 assert.equal(data.artist_profiles[equity.artist_profile_id].home,'platform-home.html');
 assert.equal(data.artist_profiles[data.albums.find(a=>a.slug==='here').artist_profile_id].home,'matthew-mccluster.html');
 assert.equal(data.albums.find(a=>a.slug==='cia-mind-control').artist_profile_id,undefined);
});
