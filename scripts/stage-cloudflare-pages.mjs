#!/usr/bin/env node
/**
 * Prepare an APPROVED STATIC WEB EXPORT for Cloudflare Pages Direct Upload.
 *
 * Source must be the already-built public web tree, NOT the mccluster/main
 * source checkout. No credential, runner, SQL, or backend source is ever
 * included. A signed-off build SHA is required for deployment provenance.
 *
 * Usage:
 *   node scripts/stage-cloudflare-pages.mjs \
 *     --input /srv/mccluster/public-export \
 *     --output /srv/mccluster/releases/new-dist \
 *     --commit <40-hex-source-sha>
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const allowedDirectories = new Set([
  'assets','auth','oauth','action','closet','css','data','demos',
  'engineering','equity-uprise-preview','js','portfolio','site0',
  'tracks','walls','whip','vendor'
]);
/* This list is for web-delivered assets only. Site 0 authoring GLBs,
   CAD manifests and tools under assets/3d are NOT runtime assets:
   tools/publish-site0.sh separately promotes the approved runtime into site0/. */
const publicAssetGroups = new Set([
  'frames','flags','brand','img','video','audio','credentials','landmarks',
  'fonts','captions','resume','hitman','likeness','nfc','outfit'
]);
const allowedExtensions = new Set([
  '.html','.htm','.css','.js','.mjs','.json','.webmanifest',
  '.xml','.txt','.svg','.png','.jpg','.jpeg','.webp','.avif',
  '.gif','.ico','.woff','.woff2','.ttf','.otf',
  '.mp3','.m4a','.wav','.ogg','.mp4','.webm','.mov','.vtt','.srt',
  '.pdf','.glb','.gltf','.bin','.obj','.mtl','.hdr','.ktx2',
  '.wasm','.geojson','.csv','.ics','.vcf','.docx'
]);
const forbiddenFiles = new Set([
  'AGENTS.md','CLAUDE.md','CODEX.md','GEMINI.md','README.md',
  'package.json','package-lock.json','wrangler.toml','wrangler.jsonc',
  '.mcp.json','.cursorrules','CNAME','CITATION.cff','LICENSE',
  'data/analytics/application-schema-inventory.json',
  'data/clients.json','whip/manufacturing-crm.json'
]);
const forbiddenSegments = /^(?:\.git|\.github|\.cursor|\.claude|node_modules|__tests__|tests?|scripts?|src|\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/i;
const privateName = /(?:^|[/])(?:[^/]*\.(?:pem|key|crt|p12|pfx|sql|db|sqlite|ts|tsx|py|sh|service|timer|map|md|mdx|yaml|yml|toml|lock)|[^/]*(?:credentials|secrets?|private-key)[^/]*)$/i;
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk_live_[A-Za-z0-9]{10,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/
];
const MAX_ASSET = 25 * 1024 * 1024;
const MAX_FILES = 20000;
const textTypes = /\.(?:html?|css|js|mjs|json|webmanifest|xml|txt|svg|geojson|csv)$/i;
const argv = process.argv.slice(2);
function argument(name) {
  const i = argv.indexOf(name);
  if (i < 0 || !argv[i+1] || argv[i+1].startsWith('--')) throw new Error('Missing ' + name);
  return argv[i+1];
}
function shouldPublish(path) {
  const posix = path.replaceAll('\\','/');
  const pieces = posix.split('/');
  if (pieces.some(x=>x.startsWith('.') || forbiddenSegments.test(x))) return false;
  if (forbiddenFiles.has(posix) || privateName.test(posix)) return false;
  if (pieces.length > 1 && !allowedDirectories.has(pieces[0])) return false;
  if (pieces[0] === 'assets') {
    if (pieces.length < 3 || !publicAssetGroups.has(pieces[1])) return false;
    if (pieces[1] === 'brand' && !/\.(?:png|jpe?g|webp|avif|svg|gif|css|json)$/i.test(posix)) return false;
    if (pieces[1] === 'credentials' && !posix.toLowerCase().endsWith('.pdf')) return false;
    if (pieces[1] === 'resume' && !/\.(?:pdf|docx)$/i.test(posix)) return false;
  }
  if (posix.endsWith('.docx') && !posix.startsWith('assets/resume/')) return false;
  const name = basename(posix);
  const dot = name.lastIndexOf('.');
  if (dot < 0 || !allowedExtensions.has(name.slice(dot).toLowerCase())) return false;
  return true;
}
async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/* Scan ALL accepted text files, including multi-megabyte JS bundles and JSON.
   Retain overlap between chunks so split credentials cannot bypass detection. */
async function verifyText(path, rel) {
  const decoder=new TextDecoder('utf-8');
  let tail='';
  for await(const bytes of createReadStream(path,{highWaterMark:64*1024})) {
    const segment=tail+decoder.decode(bytes,{stream:true});
    if(credentialPatterns.some(pattern=>pattern.test(segment)))
      throw new Error('Possible secret in web export; review before deploying: '+rel);
    tail=segment.slice(-256);
  }
  if(credentialPatterns.some(pattern=>pattern.test(tail+decoder.decode())))
    throw new Error('Possible secret in web export; review before deploying: '+rel);
}
async function stage() {
  const src = resolve(argument('--input')), dst = resolve(argument('--output'));
  const report = argv.includes('--report') ? resolve(argument('--report')) : dst+'.excluded.json';
  const commit = argument('--commit');
  if(report===dst || report.startsWith(dst+sep) || report===src || report.startsWith(src+sep))
    throw new Error('Excluded-file report must be OUTSIDE both source and public deployment directories');
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('--commit must be a full 40-hex source SHA');
  if (src === dst || dst.startsWith(src+sep) || src.startsWith(dst+sep) || dst === '/' || dst === process.cwd())
    throw new Error('Input and output must be separate release directories');
  const srcInfo = await lstat(src);
  if (!srcInfo.isDirectory()) throw new Error('Expected a directory of built static assets');
  const sourceItems = await readdir(src);
  if (['workers','supabase','.github','AGENTS.md'].some(name=>sourceItems.includes(name)))
    throw new Error('Input resembles the PRIVATE SOURCE CHECKOUT, not a published web export; refuse upload');
  await mkdir(dst,{recursive:true});
  if ((await readdir(dst)).length) throw new Error('Output directory must be empty; refusing to overwrite a prior release');

  const found=[],excluded=[];
  async function scan(dir, prefix='') {
    for (const item of await readdir(dir,{withFileTypes:true})) {
      const rel = prefix ? prefix+'/'+item.name : item.name;
      if (item.isSymbolicLink()) throw new Error('Symbolic link in web export is forbidden: ' + rel);
      if (item.isDirectory()) {
        if (prefix==='' && !allowedDirectories.has(item.name)) { excluded.push(rel+'/'); continue; }
        if (item.name.startsWith('.') || forbiddenSegments.test(item.name)) { excluded.push(rel+'/'); continue; }
        await scan(join(dir,item.name),rel);
      } else if (item.isFile()) {
        if (shouldPublish(rel)) found.push({rel,path:join(dir,item.name)});
        else excluded.push(rel);
      } else throw new Error('Unsupported file type in export: ' + rel);
    }
  }
  await scan(src);
  if (found.length > MAX_FILES-1) throw new Error('Cloudflare free-tier file count exceeded');
  const present = new Set(found.map(f=>f.rel));
  for (const required of ['index.html','404.html','js/tabbar.js'])
    if (!present.has(required)) throw new Error('Missing critical public web file: ' + required);
  if (!found.some(f=>f.rel.startsWith('assets/'))) throw new Error('Missing site assets');
  found.sort((a,b)=>a.rel.localeCompare(b.rel));
  const manifestHash = createHash('sha256');
  let bytes=0;
  for (const file of found) {
    const info = await lstat(file.path);
    if (!info.isFile() || info.size > MAX_ASSET)
      throw new Error('Asset is not a regular Cloudflare Pages file or exceeds 25 MiB: ' + file.rel);
    if (textTypes.test(file.rel)) await verifyText(file.path,file.rel);
    bytes += info.size;
    const fileHash = await digestFile(file.path);
    manifestHash.update(file.rel+'\t'+info.size+'\t'+fileHash+'\n');
  }
  for (const file of found) {
    const dest=join(dst,...file.rel.split('/'));
    await mkdir(dirname(dest),{recursive:true});
    await copyFile(file.path,dest);
  }
  const provenance={
    source_sha:commit.toLowerCase(),source_type:'approved-static-export',
    asset_count:found.length+1,asset_bytes:bytes,
    manifest_sha256:manifestHash.digest('hex'),
    created_at:new Date().toISOString(),
    excluded_count:excluded.length,
    publisher:'cloudflare-pages-direct-upload'
  };
  await writeFile(join(dst,'mccluster-release.json'),JSON.stringify(provenance,null,2)+'\n');
  /* This path report is operator-only evidence: NEVER put it in the web root. */
  await mkdir(dirname(report),{recursive:true});
  await writeFile(report,JSON.stringify({
    source_sha:commit.toLowerCase(),excluded_count:excluded.length,
    excluded_paths:excluded.sort()
  },null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'ready',output:dst,excluded_report:report,provenance},null,2));
}
stage().catch(err=>{console.error('PAGES_STAGING_REFUSED:',err.message);process.exitCode=1;});
