/* Deterministic, public-source-only export. Never uploads or selects a repo. */
import {readFile, mkdir, copyFile, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../packages/equity-uprise/environment/manifest.json',import.meta.url),'utf8'));
if(!process.argv[2])throw new Error('Supply a new empty output directory.');
const target=path.resolve(process.argv[2]);
try{await access(target);throw new Error('Export destination already exists; choose a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const file of manifest.files){if(typeof file!=='string'||path.isAbsolute(file)||file.split('/').includes('..'))throw new Error('Invalid manifest path.');}
await mkdir(target,{recursive:true});
for(const file of manifest.files){const output=path.join(target,file);await mkdir(path.dirname(output),{recursive:true});await copyFile(path.join(root,file),output);}
console.log(`Exported ${manifest.files.length} public source files to ${target}. No backend, credentials or private state copied.`);
