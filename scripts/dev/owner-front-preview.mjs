// Loopback-only development preview. Real editor + renderer + isolated SQL;
// synthetic identities, no production services, no arbitrary SQL HTTP endpoint.
import http from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownerFrontFixture,owner,other} from '../test/support/owner-front-db.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4','.mp3':'audio/mpeg'};
const tokens={owner:'fixture-owner-local-only',member:'fixture-member-local-only'};
export async function startOwnerFrontPreview({port=4317,dataDir}={}){
  const db=await ownerFrontFixture({dataDir});await db.exec('reset role');
  let origin;
  const actor=req=>req.headers.authorization==='Bearer '+tokens.owner?owner:req.headers.authorization==='Bearer '+tokens.member?other:null;
  async function asUser(id,run){return db.transaction(async tx=>{
    await tx.exec(id?'set local role authenticated':'set local role anon');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
    return run(tx);
  });}
  const server=http.createServer(async(req,res)=>{
    const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    try{
      if(req.headers.host!==new URL(origin).host)return json({error:'Loopback host required'},403);
      if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==origin)return json({error:'Origin refused'},403);
      const url=new URL(req.url,origin),path=url.pathname;
      if(path==='/__preview/session')return json({owner:tokens.owner,member:tokens.member,notice:'Synthetic local accounts only'});
      if(path.startsWith('/rest/v1/rpc/')){
        if(req.method!=='POST')return json({error:'POST required'},405);
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>24000)return json({error:'Body too large'},413);}
        const b=JSON.parse(body||'{}'),name=path.split('/').pop();
        const routes={
          owner_front_snapshot_v1:['select public.owner_front_snapshot_v1() as result',[]],
          owner_front_publish_v1:['select public.owner_front_publish_v1($1,$2::jsonb) as result',[b.p_expected_revision,b.p_value===null?null:JSON.stringify(b.p_value)]],
          owner_front_draft_save_v1:['select public.owner_front_draft_save_v1($1,$2,$3::jsonb) as result',[b.p_expected_revision,b.p_base_revision,b.p_value===null?null:JSON.stringify(b.p_value)]],
          owner_front_draft_discard_v1:['select public.owner_front_draft_discard_v1($1) as result',[b.p_expected_revision]]
        };
        if(!routes[name])return json({error:'RPC not exposed in this preview'},404);
        const [sql,args]=routes[name];return json(await asUser(actor(req),async tx=>(await tx.query(sql,args)).rows[0].result));
      }
      if(path==='/rest/v1/site_content')return json(await asUser(null,async tx=>(await tx.query("select slot,kind,value,updated_at from public.site_content where page=$1 and ($2='' or slot=$2)",[(url.searchParams.get('page')||'eq.index.html').replace(/^eq\./,''),(url.searchParams.get('slot')||'').replace(/^eq\./,'')])).rows));
      if(path.startsWith('/rest/')||path.startsWith('/auth/')||path.startsWith('/v1/')||path.startsWith('/__api/'))return json({error:'Unavailable in isolated preview'},404);
      res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; form-action 'self'; object-src 'none'");
      res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
      if(path==='/'||path==='/control.html'){
        res.setHeader('content-type','text/html');return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated owner controls preview</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/control-room-v2.css"><link rel="stylesheet" href="/css/control-admin.css"></head><body class="cr"><header style="padding:16px"><h1>Owner controls · isolated preview</h1><p>Synthetic accounts and local database. Nothing here changes the live site.</p><label>Preview role <select id="role"><option value="owner">Owner</option><option value="member">Member</option><option value="guest">Guest</option></select></label> <a href="/index.html" target="_blank">Open published local page</a></header><main id="host" style="padding:16px"></main><script>
        var selected=sessionStorage.getItem('owner-preview-role')||'owner';document.getElementById('role').value=selected;
        var tokens=${JSON.stringify(tokens)};window.MCC_SUPA={url:location.origin,key:'local-fixture-only',token:async function(){return tokens[selected]||null;}};
        document.getElementById('role').onchange=function(){selected=this.value;sessionStorage.setItem('owner-preview-role',selected);window.dispatchEvent(new Event('mcc:auth-changed'));};
        </script><script src="/js/control-room/front-page.js"></script><script>
        function render(){document.getElementById('host').innerHTML=CR.frontPage.render();CR.frontPage.bind(document.getElementById('host'));}
        CR.frontPage.init({request:function(){},render:render});render();
        </script></body></html>`);
      }
      const rel=decodeURIComponent(path).replace(/^\//,'');
      if(!(rel==='index.html'||/^(js|css|assets|fonts|vendor|data)\//.test(rel))||rel.split('/').some(x=>x.startsWith('.')))return json({error:'Not served'},404);
      const file=await realpath(resolve(root,rel));if(!file.startsWith(resolve(root)+sep))return json({error:'Not served'},404);
      let bytes=await readFile(file);const type=types[extname(file)]||'application/octet-stream';
      if(/javascript|html|css|json/.test(type))bytes=Buffer.from(bytes.toString().replace(/https:\/\/[a-z0-9-]+\.supabase\.co/g,origin).replace(/https:\/\/(?:[a-z0-9-]+\.)?mccluster\.org/g,origin));
      res.setHeader('content-type',type);res.end(bytes);
    }catch(error){json({code:error.code||'PREVIEW_ERROR',message:error.message},error.code==='42501'?403:error.code==='40001'?409:error.code==='22023'?400:500);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  return {origin,db,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await startOwnerFrontPreview({port:Number(process.env.OWNER_PREVIEW_PORT||4317),dataDir:process.env.OWNER_PREVIEW_DB||'/tmp/mccluster-owner-preview-db'});
  console.log('Isolated preview: '+app.origin+'/control.html');
  console.log('Local database: '+(process.env.OWNER_PREVIEW_DB||'/tmp/mccluster-owner-preview-db'));
  process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
}
