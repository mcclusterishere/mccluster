#!/usr/bin/env node
/* Public Pages canary. No admin token or GitHub access is required. */
const args=process.argv.slice(2);
const get=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error('Missing '+name);return args[i+1]};
const url=get('--url').replace(/\/+$/,'');
const sha=get('--commit');
if(!/^https:\/\/[a-z0-9.-]+$/i.test(url))throw Error('Expected HTTPS Pages canary URL');
if(!/^[0-9a-f]{40}$/i.test(sha))throw Error('Expected full source SHA');
const publicFiles=[
  ['/',/text\/html/,/<!doctype html|<html/i],
  ['/album.html',/text\/html/,/<html/i],
  ['/mnet.html',/text\/html/,/<html/i],
  ['/js/tabbar.js',/(?:javascript|text\/plain)/,/.+/],
  ['/data/environments.json',/(?:application\/json|text\/plain)/,/"environments"/]
];
const privateFiles=[
  '/.mcp.json','/core/src/broker-edge-auth.mjs',
  '/platform/config/server-inventory.json','/dns/mccluster.org.zone',
  '/data/analytics/application-schema-inventory.json',
  '/assets/3d/prim3-site0/PRIM3_Site0_CANONICAL_ARCHITECTURE_v03.json'
];
async function probe(path){
  const res=await fetch(url+path,{redirect:'follow',headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
  const type=res.headers.get('content-type')||'';
  return {status:res.status,type,body:await res.text()};
}
async function verify(){
  const p=await probe('/mccluster-release.json');
  if(p.status!==200)throw Error('Release provenance absent: HTTP '+p.status);
  const info=JSON.parse(p.body);
  if(info.source_sha!==sha.toLowerCase()||info.source_type!=='approved-static-export')
    throw Error('Released SHA or type differs from approved source');
  if(info.asset_count<100||info.asset_count>20000)
    throw Error('Unexpected asset count; possible partial publish');
  for(const [path,type,contents] of publicFiles){
    const r=await probe(path);
    if(r.status!==200||!type.test(r.type)||!contents.test(r.body))
      throw Error('Public path smoke failed: '+path+' (HTTP '+r.status+', '+r.type+')');
  }
  for(const path of privateFiles){
    const r=await probe(path);
    if(r.status!==404 && r.status!==403)
      throw Error('PRIVATE SOURCE MAY BE WEB-ACCESSIBLE: '+path+' (HTTP '+r.status+')');
  }
  console.log(JSON.stringify({status:'passed',url,source_sha:sha,assets:info.asset_count,public_checks:publicFiles.length,private_checks:privateFiles.length}));
}
verify().catch(e=>{console.error('PAGES_CANARY_FAILED:',e.message);process.exitCode=1});
