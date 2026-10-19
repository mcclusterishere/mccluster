import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../../tools/helix-local-preview.mjs',import.meta.url));
function get(url,host){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);
    const req=request({hostname:u.hostname,port:u.port,path:u.pathname,method:'GET',headers:host?{Host:host}:{}},res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.once('error',reject);
    req.end();
  });
}
test('Helix preview is loopback only and cannot serve public pages, private scripts or credentials',async t=>{
  const child=spawn(process.execPath,[script,'0'],{stdio:['ignore','pipe','pipe']});
  let output='';
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('preview failed to bind')),10000);
    child.stdout.on('data',chunk=>{
      output+=chunk.toString();
      const match=/HELIX LAB (http:\/\/127\.0\.0\.1:\d+\/_unfinished\/helix\/index\.html)/.exec(output);
      if(match){clearTimeout(timer);resolve(match[1]);}
    });
    child.once('exit',code=>{clearTimeout(timer);reject(Error('preview exited '+code));});
  });
  t.after(()=>child.kill());
  const url=await ready;
  const page=await get(url);
  assert.equal(page.status,200);
  assert.match(page.body.toString(),/class="helix-app"/);
  assert.equal(page.headers['x-robots-tag'],'noindex, nofollow');
  assert.equal(page.headers['cache-control'],'private, no-store');
  const base=new URL(url);
  for(const name of ['/data/albums.json','/_unfinished/helix/main.mjs','/vendor/three.module.min.js']){
    assert.equal((await get(new URL(name,base))).status,200,name);
  }
  for(const name of ['/helix.html','/listen.html','/js/analytics.js','/js/mcc-auth.js','/js/gated-audio.js','/docs/music/HELIX-PROCEDURAL-PROTOTYPE.md']){
    assert.equal((await get(new URL(name,base))).status,404,name+' must not be exposed by local preview');
  }
  assert.equal((await get(url,'public.example.com')).status,403);
});
