/* Local-only preview for the unpublished procedural Helix lab.
 * node tools/helix-local-preview.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url)));
const HOST='127.0.0.1';
const PORT=process.argv[2] == null ? 8765 : Number(process.argv[2]);
if(!Number.isInteger(PORT)||PORT<0||PORT>65535)throw Error('Invalid local port');
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.ogg':'audio/ogg'};
function allowed(path){
  return /^\/_unfinished\/helix\/(?:index\.html|helix\.css|math\.mjs|scene\.mjs|main\.mjs)$/.test(path)
    || /^\/(?:vendor\/three\.module\.min\.js|js\/music-engine\.js|data\/albums\.json)$/.test(path)
    || /^\/data\/lyrics\/[a-z0-9_.-]+\.json$/i.test(path)
    || /^\/assets\/(?:audio|img|frames|video)\/[a-z0-9_./-]+$/i.test(path);
}
const server=createServer((req,res)=>{
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; connect-src 'self'; media-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'"};
  const deny=(status=404)=>{res.writeHead(status,headers);res.end('Not available');};
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))return deny(403);
  if(req.method!=='GET'&&req.method!=='HEAD')return deny(405);
  let url,path;
  try {
    url=new URL(req.url,'http://127.0.0.1');
    path=decodeURIComponent(url.pathname);
  }catch{return deny(400);}
  if(path==='/')path='/_unfinished/helix/index.html';
  if(path.includes('\\')||path.split('/').includes('..')||!allowed(path))return deny();
  const filename=resolve(ROOT,'.'+path);
  if(!filename.startsWith(ROOT+sep)||!existsSync(filename)||!statSync(filename).isFile())return deny();
  const type=TYPES[extname(filename).toLowerCase()];
  if(!type)return deny();
  const size=statSync(filename).size;
  const range=req.headers.range;
  const match=typeof range==='string'?/^bytes=(\d+)-(\d*)$/.exec(range):null;
  const headers2={...headers,'Content-Type':type,'Accept-Ranges':'bytes'};
  if(range&&!match)return deny(416);
  if(match){
    const start=Number(match[1]),end=match[2]?Number(match[2]):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=size)return deny(416);
    res.writeHead(206,{...headers2,'Content-Length':end-start+1,'Content-Range':'bytes '+start+'-'+end+'/'+size});
    if(req.method==='HEAD')return res.end();
    createReadStream(filename,{start,end}).pipe(res);
    return;
  }
  res.writeHead(200,{...headers2,'Content-Length':size});
  if(req.method==='HEAD')return res.end();
  createReadStream(filename).pipe(res);
});
server.listen(PORT,HOST,()=>{
  console.log('HELIX LAB http://'+HOST+':'+server.address().port+'/_unfinished/helix/index.html');
  console.log('Loopback only. Do not port forward or tunnel this viewer.');
});
