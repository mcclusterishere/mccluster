/* Calibrated-data-ready MUSIC theory consensus, NOT calibrated confidence today.
 * Mathematical model agreement does not replace ground-truth BPM/key data.
 * A human editor can always correct the result before score publication.
 */
const finite=x=>Number.isFinite(x)&&x>0;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const round=(x,n=2)=>Number(x.toFixed(n));
const NAMES=["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const PITCH={C:0,"B#":0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,Fb:4,"E#":5,F:5,
  "F#":6,Gb:6,G:7,"G#":8,Ab:8,A:9,"A#":10,Bb:10,B:11,Cb:11};
const near=(a,b,t=.04)=>Math.abs(a-b)/Math.max(a,b)<=t;
const nearOctave=(a,b)=>[.5,1,2].some(r=>near(a*r,b));

function canonicalKey(text) {
  const match=/^([A-G](?:#|b|♯|♭)?)\s+(major|minor)$/i.exec(String(text||"").trim());
  if(!match)return null;
  const root=match[1].replace("♯","#").replace("♭","b");
  const normalized=root.charAt(0).toUpperCase()+root.slice(1);
  const pc=PITCH[normalized];
  return pc===undefined?null:{tonic:pc,mode:match[2].toLowerCase(),
    key:pc+":"+match[2].toLowerCase(),name:NAMES[pc]+" "+match[2].toLowerCase()};
}
function weightedMedian(rows){
  const ordered=[...rows].sort((a,b)=>a.bpm-b.bpm);
  const total=ordered.reduce((s,x)=>s+x.weight,0);
  let n=0;
  for(const row of ordered){n+=row.weight;if(n>=total/2)return row.bpm;}
  return ordered.at(-1).bpm;
}

export function reconcileMusicTheory(inputs,options={}){
  if(!Array.isArray(inputs)||inputs.length>8)throw Error("up to eight independent model estimates accepted");
  const entries=inputs.filter(x=>x&&typeof x.method==="string"&&
      /^[a-z][a-z0-9._-]{2,60}$/.test(x.method)).map(x=>({
    method:x.method,tempo:x.tempo||{},key:x.key||{},
    provenance:x.provenance||"estimated-not-calibrated"
  }));
  if(new Set(entries.map(x=>x.method)).size!==entries.length)
    throw Error("duplicate model methods cannot create artificial agreement");
  const tempo=entries.map(x=>({method:x.method,bpm:Number(x.tempo.bpm),
    weight:clamp(Number(x.tempo.confidence)||0,.02,.95)}))
    .filter(x=>finite(x.bpm)&&x.bpm>=35&&x.bpm<=260);
  let tempoResult={bpm:null,confidence:0,confidenceCalibrated:false,candidates:[],
    reason:"no credible tempo measurements"};
  if(tempo.length){
    const anchor=[...tempo].sort((a,b)=>b.weight-a.weight)[0];
    const similar=tempo.filter(x=>nearOctave(x.bpm,anchor.bpm));
    const dissimilar=tempo.filter(x=>!similar.includes(x));
    // Normalize octave-related candidates to the chosen model's metrical octave;
    // actual perceived beat level remains a separate human-validation problem.
    const grouped=similar.map(x=>{
      const ratios=[.5,1,2,4].map(scale=>({bpm:x.bpm*scale,
        distance:Math.abs(Math.log2((x.bpm*scale)/anchor.bpm))}));
      const candidate=ratios.sort((a,b)=>a.distance-b.distance)[0];
      return {bpm:candidate.bpm,weight:x.weight,original:x.bpm};
    });
    const central=weightedMedian(grouped);
    const agreeing=grouped.filter(x=>near(x.bpm,central,.05));
    const agreeWeight=agreeing.reduce((s,x)=>s+x.weight,0);
    const totalWeight=tempo.reduce((s,x)=>s+x.weight,0);
    const contradiction=dissimilar.reduce((s,x)=>s+x.weight,0)/Math.max(.01,totalWeight);
    const center=round(central);
    const ambiguity=similar.some(x=>!near(x.bpm,x.original,.03));
    const confidence=clamp((agreeWeight/Math.max(.01,totalWeight))*
      (agreeing.length>1?.84:.52)*Math.min(.95,agreeWeight/Math.max(1,tempo.length)),0,.92);
    tempoResult={
      bpm:contradiction>.37||confidence<.13?null:center,
      confidence:round(confidence,3),confidenceCalibrated:false,
      halfDoubleTimeAmbiguous:ambiguity||tempo.length<=1,
      candidates:[center/2,center,center*2].filter(x=>x>=40&&x<=260).map(x=>round(x)),
      methods:similar.map(x=>x.method),
      reason:contradiction>.37?"independent models disagree beyond beat octaves":
        "octave-normalized model agreement; beat level still requires human confirmation"
    };
  }
  const keys=entries.map(x=>({method:x.method,value:canonicalKey(x.key.name),
    weight:clamp(Number(x.key.confidence)||0,.02,.95)})).filter(x=>x.value);
  const totals=new Map();
  for(const vote of keys){
    const record=totals.get(vote.value.key)||{name:vote.value.name,weight:0,methods:[]};
    record.weight+=vote.weight;record.methods.push(vote.method);
    totals.set(vote.value.key,record);
  }
  const ranked=[...totals.values()].sort((a,b)=>b.weight-a.weight);
  let keyResult={name:null,confidence:0,confidenceCalibrated:false,candidates:[],
    reason:"tonality unknown or no reliable key model"};
  if(ranked.length){
    const total=ranked.reduce((s,x)=>s+x.weight,0),best=ranked[0];
    const share=best.weight/total;
    keyResult={
      name:best.methods.length>=2&&share>=.57?best.name:null,
      confidence:round(clamp(share*(best.methods.length>1?.78:.36),0,.88),3),
      confidenceCalibrated:false,
      candidates:ranked.slice(0,4).map(x=>({name:x.name,voteShare:round(x.weight/total,3)})),
      methods:best.methods,reason:best.methods.length<2?
        "single unverified tonal model; no reliable cross-model consensus":
        share<.57?"tonal methods disagree or modulation may be present":
        "independent tonal models agree; verify against annotated music"
    };
  }
  return {
    schema:"mcc.music.tempo-key-consensus.v1",status:"estimated-not-ground-truth",
    tempo:tempoResult,key:keyResult,
    sourceMethods:entries.map(x=>x.method),modelAgreementNotBiology:true,
    requiresHumanCorrectionForNotation:true,
    limitation:"Calibrate confidence and abstention rates against held-out annotated audio before production-grade claims"
  };
}
