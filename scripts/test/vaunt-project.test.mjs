import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const ctx={window:{}};vm.runInNewContext(read('js/front-projects.js'),ctx);
const project=ctx.window.MCC_FRONT_PROJECTS.get('vaunt');
test('project is creator content, not an account; unknown and prototype names fail closed',()=>{
 assert.equal(project.owner,'Matthew McCluster');
 for(const name of ['unknown','__proto__','constructor','toString'])assert.equal(ctx.window.MCC_FRONT_PROJECTS.get(name),null);
 assert.ok(Object.isFrozen(project.config.media));
 assert.equal(project.auth_user_id,undefined);
});
test('all three exact scenes and existing links remain in order, on the original assets',()=>{
 const m=project.config.media,manifest=JSON.parse(read('assets/frames/manifest.json'));
 assert.equal(m.scene1.prefix,'vauntlive_');assert.equal(m.scene2.prefix,'vaunt_');
 for(const [key,name] of [['scene1','vauntlive'],['scene2','vaunt']]){
  assert.equal(m[key].count,manifest[name].count);
  for(const dir of ['', 'sm/'])for(const frame of ['0001',String(m[key].count).padStart(4,'0')])assert.ok(existsSync(new URL('../../'+m[key].base+dir+m[key].prefix+frame+'.webp',import.meta.url)));
 }
 assert.equal(m.cabin.src,'assets/video/vaunt-360.mp4');
 assert.equal(m.sound.src,'assets/audio/who-did-the-shoot.mp3');
 assert.ok(project.config.links.some(x=>x.href==='album.html?album=vaunt-ep'));
 assert.equal(project.config.vr.spots[0].href,'https://vauntapi.flyvaunt.com/referral/nuao1K');
 const old=read('data/front-projects/vaunt-original.html');
 assert.ok(old.indexOf('cmdCanvas5')<old.indexOf('cmdCanvas4'));
 for(const id of ['cmdCanvas5','cmdCanvas4','workVR']){assert.ok(old.includes('id="'+id+'"'));assert.ok(!read('index.html').includes('id="'+id+'"'));}
 assert.match(read('index.html'),/id="work" aria-labelledby="vauntProjectTitle"/);
});
test('public shells share one footer outside metric containers; no account policy mutation',()=>{
 for(const file of ['index.html','front.html','member-front.html']){
  const html=read(file);assert.equal((html.match(/id="guestWorld"/g)||[]).length,1);
  assert.ok(html.indexOf('id="guestWorld"')>html.indexOf('</main>'));
  assert.match(html,/data-profile-world/);assert.match(html,/css\/profile-shell.css/);
 }
 assert.match(read('js/guest-world.js'),/seq!==epoch/);
 assert.match(read('js/front-member.js'),/credentials: "omit"/);
});
