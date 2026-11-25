/** Native CPU media preparation. Inputs are downloaded by the trusted executor,
 * never passed to FFmpeg as remote URLs. No shell or arbitrary filter input.
 */
import {spawn} from 'node:child_process';
import {stat, mkdir, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const PROCESSOR_VERSION='studio-native-1';
export function command(program,args,{timeout=45000}={}){
 return new Promise((resolve,reject)=>{const p=spawn(program,args,{stdio:['ignore','pipe','pipe'],shell:false});let out='',err='',done=false;
 const timer=setTimeout(()=>{p.kill('SIGKILL');finish(new Error('Media processing deadline exceeded'));},timeout);
 function finish(e){if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(out);}
 p.on('error',finish);p.stdout.on('data',b=>{out+=b;if(out.length>1048576){p.kill('SIGKILL');finish(new Error('Probe output too large'));}});
 p.stderr.on('data',b=>{err=(err+b).slice(-8192);});p.on('close',c=>finish(c===0?null:new Error('Media could not be processed: '+err.slice(-400))));});
}
const base=['-nostdin','-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,mp3,wav,flac,image2,png_pipe,jpeg_pipe,webp_pipe'];
export function normalizeSettings(s){
 if(!s||!['transition','music','native_video','immersive360'].includes(s.kind))throw new TypeError('Unsupported media purpose');
 const result={kind:s.kind,in_ms:s.in_ms??0,out_ms:s.out_ms??null,focal_x:s.focal_x??.5,focal_y:s.focal_y??.5};
 if(!Number.isSafeInteger(result.in_ms)||result.in_ms<0||result.in_ms>600000)throw new TypeError('Invalid clip start');
 if(result.out_ms!==null&&(!Number.isSafeInteger(result.out_ms)||result.out_ms<=result.in_ms||result.out_ms>600000))throw new TypeError('Invalid clip end');
 if(s.kind==='transition'&&(result.out_ms===null||result.out_ms-result.in_ms>12000||result.out_ms-result.in_ms<1000))throw new TypeError('Select 1–12 seconds');
 if(![result.focal_x,result.focal_y].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw new TypeError('Invalid crop');
 return result;
}
export async function prepareMedia(input,output,settings){
 const s=normalizeSettings(settings), info=await stat(input);
 if(!info.isFile()||info.size<1||info.size>64*1024*1024)throw new TypeError('Source must be 1 byte–64 MiB');
 const probe=JSON.parse(await command('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,mp3,wav,flac,image2,png_pipe,jpeg_pipe,webp_pipe','-show_streams','-show_format','-of','json',input]));
 const video=probe.streams?.find(x=>x.codec_type==='video'&&x.disposition?.attached_pic!==1),audio=probe.streams?.find(x=>x.codec_type==='audio');
 const duration=Number(probe.format?.duration||video?.duration||audio?.duration||0);
 if(video&&(video.width*video.height>16777216||video.width>8192||video.height>8192))throw new TypeError('Source dimensions exceed pilot limit');
 if(s.kind==='music'&&!audio)throw new TypeError('No audio stream');
 if(s.kind!=='music'&&!video)throw new TypeError('No visual stream');
 if(['smpte2084','arib-std-b67'].includes(video?.color_transfer))throw new TypeError('Export SDR footage for this pilot; HDR conversion is not enabled');
 if(s.kind!=='immersive360'&&(!Number.isFinite(duration)||duration<=0||duration>600))throw new TypeError('Source must be at most ten minutes');
 if(s.out_ms!==null&&s.out_ms>Math.round(duration*1000)+50)throw new TypeError('Selected segment extends beyond the source');
 await mkdir(output,{recursive:false});
 const span=s.out_ms===null?duration-s.in_ms/1000:(s.out_ms-s.in_ms)/1000;
 const pre=[...base,'-ss',String(s.in_ms/1000),'-i',input,'-t',String(span)];
 const outputFile=n=>path.join(output,n);
 if(s.kind==='music'){
  await command('ffmpeg',[...pre,'-map','0:a:0','-vn','-c:a','aac','-b:a','128k','-map_metadata','-1','-movflags','+faststart',outputFile('audio.m4a')]);
 }else if(s.kind==='immersive360'){
  // Only real still 2:1 panoramas in this release; no fake VR from flat video.
  if(!['mjpeg','png','webp','av1'].includes(video.codec_name)||audio||Math.abs(video.width/video.height-2)>.025||duration>1)throw new TypeError('Use a 2:1 still panorama; 360 video is not enabled in this pilot');
  await command('ffmpeg',[...base,'-i',input,'-frames:v','1','-vf','scale=2048:1024','-q:v','3','-map_metadata','-1',outputFile('panorama.jpg')]);
 }else{
  const sizes=s.kind==='transition'?[['desktop.mp4',1280,720],['phone.mp4',432,768]]:[['video.mp4',1280,720]];
  for(const [name,w,h]of sizes){
   const scale=s.kind==='transition'?`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-ow)*${s.focal_x}:(ih-oh)*${s.focal_y},setsar=1,fps=24`:'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1';
   const encoding=s.kind==='transition'?['-an','-g','1','-keyint_min','1','-crf','26']:['-c:a','aac','-b:a','128k','-crf','25'];
   await command('ffmpeg',[...pre,'-map','0:v:0','-map','0:a:0?','-vf',scale,'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',...encoding,'-map_metadata','-1','-movflags','+faststart',outputFile(name)]);
  }
  await command('ffmpeg',[...base,'-ss',String(s.in_ms/1000),'-i',input,'-frames:v','1','-vf','scale=768:-2','-q:v','4','-map_metadata','-1',outputFile('poster.jpg')]);
 }
 const files=[];let bytes=0;
 for(const name of await readdir(output)){const buf=await readFile(outputFile(name));bytes+=buf.length;files.push({name,bytes:buf.length,sha256:createHash('sha256').update(buf).digest('hex')});}
 if(bytes>128*1024*1024)throw new Error('Prepared media exceeds output budget');
 return {version:PROCESSOR_VERSION,kind:s.kind,duration_seconds:span,width:video?.width||null,height:video?.height||null,
  source_sha256:createHash('sha256').update(await readFile(input)).digest('hex'),bytes,files};
}
