/* Exploratory music theory extraction from decoded PCM.
 * Estimates are hypotheses (not ground-truth key, tempo or sheet music).
 * Uses the shared FFT, no remote service; requires independently validated examples.
 */
import { fftPower } from "./core.mjs";

const PITCHES=["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
const MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
const round=(x,p=3)=>Number(x.toFixed(p));

function dotCorrelation(a,b) {
  const am=a.reduce((s,x)=>s+x,0)/a.length;
  const bm=b.reduce((s,x)=>s+x,0)/b.length;
  let numerator=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){const x=a[i]-am,y=b[i]-bm;numerator+=x*y;aa+=x*x;bb+=y*y;}
  return aa>0&&bb>0?numerator/Math.sqrt(aa*bb):0;
}

export function chromaEstimate(samples,sr,{fftSize=8192,hop=4096,maxFrames=80}={}) {
  if(!(samples instanceof Float32Array||samples instanceof Float64Array)||samples.length<fftSize)
    return {name:null,majorMinor:null,confidence:0,candidates:[],chroma:Array(12).fill(0),reason:"insufficient decoded PCM"};
  const chroma=new Float64Array(12);
  const count=Math.min(maxFrames,Math.max(1,Math.floor((samples.length-fftSize)/hop)+1));
  for(let j=0;j<count;j++){
    const pos=Math.floor((samples.length-fftSize)*j/Math.max(1,count-1));
    const p=fftPower(samples.subarray(pos,pos+fftSize),fftSize);
    for(let k=1;k<p.length;k++){
      const hz=k*sr/fftSize;
      if(hz<85||hz>2000)continue;
      const midi=69+12*Math.log2(hz/440),note=Math.round(midi);
      if(note<40||note>94)continue;
      const dist=Math.abs(midi-note);
      if(dist>0.28)continue;
      // Broad-band and overtones remain a source of estimation uncertainty.
      const weighted=Math.sqrt(p[k])*(1-dist/0.28)/Math.sqrt(hz/100);
      chroma[((note%12)+12)%12]+=weighted;
    }
  }
  const total=chroma.reduce((a,b)=>a+b,0);
  if(total<1e-6)return {name:null,majorMinor:null,confidence:0,candidates:[],chroma:Array(12).fill(0),reason:"insufficient pitched energy"};
  const normalized=[...chroma].map(v=>v/total);
  const energyClasses=normalized.filter(x=>x>=.07).length;
  const ranked=[];
  for(let tonic=0;tonic<12;tonic++)for(const [mode,profile] of [["major",MAJOR],["minor",MINOR]]) {
    const template=Array.from({length:12},(_,pitch)=>profile[(pitch-tonic+12)%12]);
    ranked.push({tonic,mode,score:dotCorrelation(normalized,template)});
  }
  ranked.sort((a,b)=>b.score-a.score);
  const candidates=ranked.slice(0,3).map(r=>({name:PITCHES[r.tonic]+" "+r.mode,correlation:round(r.score)}));
  const gap=Math.max(0,ranked[0].score-ranked[1].score);
  const confidence=clamp(.12+.72*gap*2.5,0,.85)*clamp(energyClasses/4,0,1);
  // One note or power chord does not establish a major/minor key.
  const isEnough=energyClasses>=3&&ranked[0].score>=.27&&confidence>=.18;
  return {name:isEnough?candidates[0].name:null,majorMinor:isEnough?ranked[0].mode:null,
    confidence:round(confidence),candidates,
    chroma:normalized.map(v=>round(v,4)),reason:isEnough?"statistical chroma-template estimate; mode may be ambiguous":"low confidence; insufficient tonal evidence or ambiguous chroma"};
}

export function tempoEstimate(samples,sr,{maxSeconds=80,hop=256,minBpm=55,maxBpm=220}={}) {
  if(!(samples instanceof Float32Array||samples instanceof Float64Array)||samples.length<4096)
    return {bpm:null,confidence:0,candidates:[],reason:"insufficient PCM"};
  const length=Math.min(samples.length,Math.floor(maxSeconds*sr));
  const block=1024,frames=Math.floor((length-block)/hop)+1;
  if(frames<20)return {bpm:null,confidence:0,candidates:[],reason:"too short for tempo"};
  const energy=new Float32Array(frames);
  for(let j=0;j<frames;j++) {
    let sum=0;
    for(let i=0;i<block;i++){let sample=samples[j*hop+i];sum+=sample*sample;}
    energy[j]=Math.sqrt(sum/block);
  }
  const onset=new Float32Array(frames);
  for(let j=1;j<frames;j++)onset[j]=Math.max(0,energy[j]-energy[j-1]);
  const mean=onset.reduce((a,b)=>a+b,0)/frames;
  let variance=0;
  for(let i=0;i<frames;i++){onset[i]=Math.max(0,onset[i]-mean*.5);variance+=onset[i]*onset[i];}
  if(variance<1e-8)return {bpm:null,confidence:0,candidates:[],reason:"no reliable onsets"};
  const proposals=[];
  for(let bpm=minBpm;bpm<=maxBpm;bpm+=.5) {
    const delay=Math.round(60*sr/(bpm*hop));
    if(delay<2||delay>=frames-4)continue;
    let score=0,denA=0,denB=0;
    for(let k=delay;k<frames;k++){const a=onset[k],b=onset[k-delay];score+=a*b;denA+=a*a;denB+=b*b;}
    score=denA*denB>0?score/Math.sqrt(denA*denB):0;
    proposals.push({bpm,score});
  }
  proposals.sort((a,b)=>b.score-a.score);
  const candidates=[];
  for(const p of proposals){
    if(candidates.every(c=>Math.abs(c.bpm-p.bpm)>4))candidates.push({bpm:round(p.bpm,1),strength:round(p.score)});
    if(candidates.length===4)break;
  }
  const best=candidates[0];
  if(!best||best.strength<.09)return {bpm:null,confidence:0,candidates,reason:"weak rhythmic periodicity"};
  // Beat tracking requires meter context; double/half-time ambiguity is explicit.
  return {bpm:best.bpm,confidence:round(clamp(best.strength,0,.95)),candidates,
    reason:"onset-envelope periodicity; 2×/½× tempo alternatives may be equally perceptible"};
}

export function estimateMusicTheory(samples,sampleRate,options={}) {
  if(!(samples instanceof Float32Array||samples instanceof Float64Array)||
     !Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)
    throw new TypeError("expected decoded finite-rate mono PCM");
  const key=chromaEstimate(samples,sampleRate,options.key);
  const tempo=tempoEstimate(samples,sampleRate,options.tempo);
  return {schema:"mcc.music-theory.estimated.v1",status:"estimated_not_verified",
    key,tempo,score:{available:false,reason:"Sheet music requires isolated notes/onsets, instrument-aware transcription, beat quantization and human verification."},
    separation:{available:false,reason:"Full mix is not authentic multitrack audio; GPU separation is a separate opted-in derived-media job."},
    note:"These fields describe inferred musical structure, not listener brain activity, genetics or health."};
}
