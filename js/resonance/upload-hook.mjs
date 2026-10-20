/* Creator Studio: after rights-attested upload, estimate acoustic metadata on device.
 * Preview only: no API write, no original audio re-upload, no training, no
 * medical/biometric inference. Do not interfere with existing publish review.
 */
import { analyzePcm } from "./core.mjs";
import { estimateMusicTheory } from "./theory.mjs";

const MAX_BYTES=40*1024*1024,MAX_SECONDS=30;
let generation=0;
export async function analyzeCreatorUpload(file,trackId){
  const target=document.getElementById("creatorResearchResult");
  if(!target||!file)return {ok:false,reason:"no file or result surface"};
  const id=++generation;
  target.hidden=false;target.textContent="Research Engine: measuring audio locally after submission…";
  if(file.size>MAX_BYTES){target.textContent="Research analysis available for files up to 40 MiB in this browser. Release submission was not affected.";return {ok:false,reason:"size"};}
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext){target.textContent="Automatic sound analysis is unavailable in this browser. Release submission was not affected.";return {ok:false,reason:"context"};}
  let context=null;
  try{
    context=new AudioContext();
    const bytes=await file.arrayBuffer();
    const decoded=await context.decodeAudioData(bytes);
    const length=Math.min(decoded.length,Math.floor(decoded.sampleRate*MAX_SECONDS));
    if(length<8192)throw Error("Recording is too short to estimate key and tempo");
    const pcm=new Float32Array(length);
    const channels=Math.min(decoded.numberOfChannels,8);
    for(let c=0;c<channels;c++){
      const input=decoded.getChannelData(c);
      for(let i=0;i<length;i++)pcm[i]+=input[i]/channels;
    }
    const model=analyzePcm(pcm,decoded.sampleRate,{maxSeconds:MAX_SECONDS,maxFrames:24});
    const estimated=estimateMusicTheory(pcm,decoded.sampleRate);
    if(id!==generation)return {ok:false,reason:"superseded"};
    const bpm=estimated.tempo.bpm==null?"not resolved":estimated.tempo.bpm+" BPM";
    const key=estimated.key.name||"uncertain";
    target.textContent="Research Engine · local preview — Tempo: "+bpm+
      " · Key: "+key+" · Low-band share: "+
      Math.round(model.features.lowBandFraction*100)+"%. These are estimates, not verified scores or medical findings. "+
      "No research data were saved or uploaded. Release #"+String(trackId).slice(0,8)+" is still subject to rights and publication review.";
    return {ok:true,theory:estimated,analysis:model};
  }catch(error){
    if(id===generation)target.textContent="Research Engine could not decode or analyze this file on device ("+
      (error?.message||"unknown format")+"). Release submission was not affected.";
    return {ok:false,reason:"decode_error"};
  }finally{try{await context?.close();}catch{}}
}
