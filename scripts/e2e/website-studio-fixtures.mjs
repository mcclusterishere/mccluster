/** Generate synthetic fixtures only. No account/media/provider calls. */
import {mkdir,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {command,prepareMedia} from '../../core/src/website-studio/prepare.mjs';
const root=fileURLToPath(new URL('../../verification/media/',import.meta.url));
await mkdir(root,{recursive:true});
const file=n=>path.join(root,n);
await command('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file('source.mp4')]);
for(const name of ['trans','music'])await rm(file(name),{recursive:true,force:true});
await prepareMedia(file('source.mp4'),file('trans'),{kind:'transition',in_ms:0,out_ms:1000});
await prepareMedia(file('source.mp4'),file('music'),{kind:'music'});
for(const name of ['desktop.mp4','phone.mp4','poster.jpg'])await copyFile(file('trans/'+name),file(name));
await copyFile(file('music/audio.m4a'),file('audio.m4a'));
await copyFile(file('source.mp4'),file('video.mp4'));
await command('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1024x512:rate=1','-frames:v','1','-q:v','3',file('panorama.jpg')]);
console.log('Synthetic Studio browser fixtures generated.');
