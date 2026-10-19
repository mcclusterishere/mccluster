/* McCluster Research Engine · Underwater World — INTERNAL RESEARCH PROTOTYPE
 * Two systems / one canonical transport:
 *  - DNA = selectable album/song interface (not a literal gene)
 *  - Brain = model-based educational research association (not brain activation)
 *  - Water = aesthetically rendered ideal fixed-edge membrane field (not hydrodynamic CFD).
 * No on-device files uploaded, no listener inference, no new HTMLAudioElement.
 */
import * as THREE from "../../vendor/three.module.min.js";
import { modes, analyzePcm, analyzeTrackouts } from "./core.mjs";
import { estimateMusicTheory } from "./theory.mjs";

const $ = id => document.getElementById(id);
const canvas=$("rwCanvas"),app=$("rwApp"),status=$("rwStatus");
const engine=window.MCC_MUSIC;
const MODES=modes();
const state={
  view:"brain",album:0,track:0,albums:[],networks:[],
  rotation:0,analysis:null,origin:"none",analysisId:null,
  frames:[],activeRegion:null,playing:false
};
const MAX_BROWSER_SECONDS=30,MAX_FILES=8,MAX_FILE_BYTES=40*1024*1024;
const reduced=!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const weights=new Float32Array(MODES.length);
weights[0]=1;
let renderer,scene,camera,water,waterOriginal,brainRoot,dnaRoot,markers=[],rungs=[],particles;
let lastDraw=0,waterSurface=null,orbit=0.20,tilt=0.13,pointers=new Map(),drag=null;
let context=null;
const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2();
const selectedRegion=()=>state.networks.find(x=>x.id===state.activeRegion);

function updateMessage(text){status.textContent=text;}
function fail3D(message){$("rwFallback").hidden=false;updateMessage(message);}
function physicalMat(color,roughness=.86,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function sphere(radius,detail=24){return new THREE.SphereGeometry(radius,detail,Math.floor(detail*.72));}
function makeBrainLobe(side){
  const g=new THREE.SphereGeometry(1,88,64);
  const p=g.attributes.position;
  const colors=new Float32Array(p.count*3);
  const light=new THREE.Color(side<0?0xa98b81:0xb4a097);
  const deep=new THREE.Color(0x765d58);
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    // Repeating narrow sulcal indentation with multiple incommensurate waves.
    // Purely sculptural, not a scan-derived patient or atlas mesh.
    const major=Math.sin(21*x + Math.sin(13*z + 6*y)*.8 + 7*y);
    const micro=Math.sin(34*z + 10*y + 3*Math.sin(9*x));
    const trench=Math.pow(Math.abs(major),7);
    const radius=1-.033*trench+.010*micro;
    p.setXYZ(i,x*radius,y*radius,z*radius);
    const c=light.clone().lerp(deep,Math.min(.58,trench*.5));
    colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b;
  }
  g.setAttribute("color",new THREE.BufferAttribute(colors,3));
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({
    vertexColors:true,roughness:.96,metalness:0,flatShading:false
  }));
  m.position.set(side*.62,.23,-.06);
  m.scale.set(.67,.86,1.14);
  return m;
}
function makeCerebellum(){
  const g=new THREE.SphereGeometry(1,60,44),p=g.attributes.position;
  const cols=new Float32Array(p.count*3);
  const pale=new THREE.Color(0xb9a19a),deep=new THREE.Color(0x796a66);
  for(let i=0;i<p.count;i++){
    const y=p.getY(i),x=p.getX(i),z=p.getZ(i);
    const stripe=Math.pow(Math.abs(Math.sin(22*y+5*x+1.5*z)),8);
    p.setXYZ(i,x*(1-.02*stripe),y*(1-.034*stripe),z*(1-.02*stripe));
    const c=pale.clone().lerp(deep,.5*stripe);
    cols.set([c.r,c.g,c.b],i*3);
  }
  g.setAttribute("color",new THREE.BufferAttribute(cols,3));g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
  m.position.set(0,-.94,-.72);m.scale.set(.85,.40,.55);
  return m;
}
function buildBrain(){
  const group=new THREE.Group();
  group.add(makeBrainLobe(-1),makeBrainLobe(1),makeCerebellum());
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.13,.21,.78,18,12),
    physicalMat(0x927871,.97));
  stem.position.set(0,-1.35,-.45);stem.rotation.x=.17;group.add(stem);
  const markerMat=physicalMat(0xe1d3ad,.65);
  for(const info of state.networks){
    const pin=new THREE.Mesh(sphere(.066,14),markerMat);
    pin.position.set(...info.visualPosition);pin.userData.region=info.id;
    group.add(pin);markers.push(pin);
  }
  return group;
}
function disposeObjects(group){
  for(const child of [...group.children]){
    child.traverse(x=>{if(x.geometry)x.geometry.dispose();});
    group.remove(child);
  }
}
function helixPoint(t,side,scale=1){
  const a=2*Math.PI*(1.8*t)+(-Math.PI/2)+(side?Math.PI:0);
  return new THREE.Vector3(Math.cos(a)*.54*scale,(t-.5)*3.9,Math.sin(a)*.54*scale);
}
function makeRod(a,b,r,material){
  const direction=b.clone().sub(a);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(r,r,direction.length(),10),material);
  rod.position.copy(a).add(b).multiplyScalar(.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
  return rod;
}
function rebuildDNA(){
  if(!dnaRoot)return;
  disposeObjects(dnaRoot);rungs=[];
  const album=state.albums[state.album];
  const count=Math.min(album?.tracks?.length||8,22);
  const rope=physicalMat(0xc2aaa0,.91),connect=physicalMat(0xafa99b,.93);
  for(let side=0;side<2;side++){
    const pts=Array.from({length:145},(_,i)=>helixPoint(i/144,side));
    const curve=new THREE.CatmullRomCurve3(pts);
    dnaRoot.add(new THREE.Mesh(new THREE.TubeGeometry(curve,190,.048,8,false),rope));
    for(let i=0;i<=75;i++){
      const bead=new THREE.Mesh(sphere(.05+(i%3)*.008,9),physicalMat(
        (i%5===0)?0x9b8781:0xd4c1ae,.95));
      bead.position.copy(helixPoint(i/75,side));dnaRoot.add(bead);
    }
  }
  const rungMaterials=[0x9fa7a0,0xc0aab2,0xafaa99,0x9faaa3];
  for(let i=0;i<count;i++){
    const t=(i+1)/(count+1),a=helixPoint(t,0),b=helixPoint(t,1);
    const rod=makeRod(a,b,.032,connect);
    rod.userData.trackIndex=i;rungs.push(rod);dnaRoot.add(rod);
    for(let part=0;part<5;part++){
      const bead=new THREE.Mesh(sphere(.075,9),physicalMat(rungMaterials[(i+part)%4],.94));
      bead.position.copy(a).lerp(b,(part+1)/6);bead.userData.trackIndex=i;
      rungs.push(bead);dnaRoot.add(bead);
    }
  }
  selectRung();
}
function selectRung(){
  for(const item of rungs){
    const chosen=item.userData.trackIndex===state.track;
    item.scale.setScalar(chosen?1.24:1);
    if(item.material.emissive)item.material.emissive.set(chosen?0x181b11:0x000000);
  }
}
function makeWater(){
  const geo=new THREE.PlaneGeometry(17,17,44,44);
  geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position;
  waterOriginal=new Float32Array(pos.count*2);
  for(let i=0;i<pos.count;i++){waterOriginal[2*i]=pos.getX(i);waterOriginal[2*i+1]=pos.getZ(i);}
  waterSurface=new THREE.Mesh(geo,new THREE.MeshPhysicalMaterial({
    color:0x5c9aa0,roughness:.22,metalness:0,transparent:true,opacity:.46,
    side:THREE.DoubleSide,depthWrite:false,clearcoat:.4,clearcoatRoughness:.24
  }));
  waterSurface.position.y=2.8;
  return waterSurface;
}
function makeParticles(){
  const coords=new Float32Array(180*3);
  for(let i=0;i<coords.length;i+=3){
    coords[i]=(Math.random()-.5)*13;coords[i+1]=(Math.random()-.5)*8;coords[i+2]=(Math.random()-.5)*12;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(coords,3));
  const material=new THREE.PointsMaterial({color:0xa0c1c4,size:.018,transparent:true,opacity:.28,depthWrite:false});
  return new THREE.Points(geo,material);
}
function init3D(){
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:"low-power"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x091c24);
    scene.fog=new THREE.FogExp2(0x112d35,.085);
    camera=new THREE.PerspectiveCamera(42,1,.08,65);
    camera.position.set(0,0,8);
    scene.add(new THREE.HemisphereLight(0xd3ddd3,0x132c32,2.5));
    const sun=new THREE.DirectionalLight(0xf5e0c1,2.2);sun.position.set(0,5,3);scene.add(sun);
    const side=new THREE.PointLight(0x6aafb8,32,16,2);side.position.set(-6,.6,-3);scene.add(side);
    brainRoot=buildBrain();brainRoot.position.set(0,-.1,0);scene.add(brainRoot);
    dnaRoot=new THREE.Group();dnaRoot.position.set(-3.7,0,-.7);
    scene.add(dnaRoot);rebuildDNA();
    water=makeWater();scene.add(water);
    particles=makeParticles();scene.add(particles);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),
      new THREE.MeshStandardMaterial({color:0x0a1c22,roughness:1}));
    floor.rotation.x=-Math.PI/2;floor.position.y=-3.4;scene.add(floor);
    const resize=()=>{
      const {width,height}=canvas.getBoundingClientRect();
      if(!width||!height)return;
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    };
    resize();window.addEventListener("resize",resize);
    window.addEventListener("pagehide",()=>renderer?.dispose(),{once:true});
    requestAnimationFrame(animate);
  }catch(error){fail3D("GPU visualization unavailable: "+(error.message||"graphics initialization"));}
}
function animate(ms){
  if(!renderer)return;
  requestAnimationFrame(animate);
  if(document.hidden)return;
  if(ms-lastDraw<(reduced?90:32))return;
  lastDraw=ms;
  const time=ms/1000;
  const current=state.view;
  const desired=current==="brain"?0:-3.7;
  const center=desired;
  const aspect=camera.aspect;
  const dist=aspect<.8?9.1:7.7;
  // The two specimens occupy the same environment. Focus shifts by mode.
  const wanted=new THREE.Vector3(center+Math.sin(orbit)*dist*.15,
    (aspect<.8?.45:.1)+Math.sin(tilt)*.5,
    dist+Math.cos(orbit)*.18);
  camera.position.lerp(wanted,.07);
  camera.lookAt(center,0,0);
  brainRoot.rotation.y+=(reduced?0:.0012);
  brainRoot.position.y=-.1+(reduced?0:Math.sin(time*.5)*.045);
  if(!reduced)dnaRoot.rotation.y+=.0008;
  const p=water.geometry.attributes.position;
  const ranked=[...weights].map((v,i)=>({w:v,mode:MODES[i]})).sort((a,b)=>b.w-a.w).slice(0,6);
  for(let i=0;i<p.count;i++){
    const x=waterOriginal[2*i],z=waterOriginal[2*i+1];
    const nx=(x+8.5)/17,nz=(z+8.5)/17;
    let value=0;
    for(let j=0;j<ranked.length;j++){
      const {w,mode}=ranked[j];if(w<.015)continue;
      const standing=Math.sin(Math.PI*mode.m*nx)*Math.sin(Math.PI*mode.n*nz);
      // Time-scaled artistic rendering; audio frequency is not treated as literal Hz motion.
      value+=w*standing*Math.cos(time*(.32+j*.22));
    }
    p.setY(i,.10*value+Math.sin(x*.95+time*.4)*Math.sin(z*.65+time*.26)*.035);
  }
  p.needsUpdate=true;
  if(Math.floor(time*8)%2===0)water.geometry.computeVertexNormals();
  renderer.render(scene,camera);
}
function renderList(){
  const target=$("rwTracks");target.replaceChildren();
  const tracks=state.albums[state.album]?.tracks||[];
  tracks.forEach((track,i)=>{
    const b=document.createElement("button");b.type="button";
    b.setAttribute("aria-pressed",String(i===state.track));b.dataset.index=String(i);
    const k=document.createElement("span");k.textContent=String(i+1).padStart(2,"0");
    const t=document.createElement("strong");t.textContent=track.title||"Untitled";
    b.append(k,t);b.addEventListener("click",()=>chooseTrack(i));target.append(b);
  });
  $("rwTrackCount").textContent=tracks.length+" SONGS";
  $("rwPlay").disabled=!tracks.length;
  selectRung();
}
function chooseAlbum(i){
  if(!state.albums.length)return;
  state.album=(i+state.albums.length)%state.albums.length;
  state.track=0;
  $("rwAlbum").value=String(state.album);
  rebuildDNA();renderList();
  updateMessage(state.albums[state.album].name+" — scroll along the DNA to select individual songs.");
}
function chooseTrack(i){
  const tracks=state.albums[state.album]?.tracks||[];
  if(!tracks.length)return;
  state.track=(i+tracks.length)%tracks.length;
  selectRung();
  for(const b of $("rwTracks").querySelectorAll("button"))b.setAttribute("aria-pressed",String(Number(b.dataset.index)===state.track));
  updateMessage("Selected "+tracks[state.track].title+". Tap Play to use the canonical Music transport.");
}
function chooseRegion(id){
  const region=state.networks.find(x=>x.id===id);if(!region)return;
  state.activeRegion=id;$("rwRegionName").textContent=region.name;
  $("rwRegionLevel").textContent=region.system.toUpperCase()+" / RESEARCH ASSOCIATION";
  $("rwRegionDetails").textContent=region.evidence;
  $("rwRegionLocation").textContent=region.location+" · "+region.topic;
  const src=$("rwRegionSource");src.textContent=region.source.title+" ↗";src.href=region.source.url;
  for(const button of $("rwRegions").querySelectorAll("button"))button.setAttribute("aria-pressed",String(button.dataset.region===id));
  for(const pin of markers)pin.scale.setScalar(pin.userData.region===id?1.65:1);
  updateMessage("Exploring "+region.name+" — research association, not an activation command.");
}
function drawNetworks(){
  const parent=$("rwRegions");parent.replaceChildren();
  for(const r of state.networks){
    const button=document.createElement("button");button.textContent=r.name;
    button.type="button";button.dataset.region=r.id;
    button.setAttribute("aria-pressed","false");
    button.onclick=()=>{changeView("brain");chooseRegion(r.id);};
    parent.append(button);
  }
  chooseRegion(state.networks[0]?.id);
}
function changeView(mode){
  if(!["brain","dna"].includes(mode))return;
  state.view=mode;for(const b of document.querySelectorAll("[data-rw-mode]")){
    b.setAttribute("aria-selected",String(b.dataset.rwMode===mode));
  }
  $("rwDepthLabel").textContent=mode==="brain"?"NEURAL ASSOCIATIONS":"ALBUM / SONG GEOMETRY";
  updateMessage(mode==="brain"?"Rotate the brain to explore researched neural networks.":"Scroll the DNA to travel through songs; tap a rung to select.");
}
function rayPick(x,y){
  if(!renderer||!scene)return;
  const rect=canvas.getBoundingClientRect();
  mouse.set(((x-rect.left)/rect.width)*2-1,-((y-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(mouse,camera);
  if(state.view==="dna"){
    const hits=raycaster.intersectObjects(rungs,false);
    if(hits.length){chooseTrack(hits[0].object.userData.trackIndex);return;}
  }else{
    const hits=raycaster.intersectObjects(markers,false);
    if(hits.length){chooseRegion(hits[0].object.userData.region);return;}
  }
}
function events(){
  for(const button of document.querySelectorAll("[data-rw-mode]"))button.addEventListener("click",()=>changeView(button.dataset.rwMode));
  canvas.addEventListener("pointerdown",event=>{pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture?.(event.pointerId);});
  canvas.addEventListener("pointermove",event=>{
    const prev=pointers.get(event.pointerId);
    if(!prev)return;
    const dx=event.clientX-prev.x,dy=event.clientY-prev.y;
    if(pointers.size===1){
      orbit+=dx*.004;tilt=Math.max(-.8,Math.min(.8,tilt+dy*.003));
      if(state.view==="dna"&&Math.abs(dy)>18){
        const tracks=state.albums[state.album]?.tracks||[];
        if(tracks.length)chooseTrack(state.track+(dy<0?1:-1));
      }
    }
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  });
  canvas.addEventListener("pointerup",event=>{
    const delta=drag?Math.hypot(event.clientX-drag.x,event.clientY-drag.y):999;
    if(delta<12)rayPick(event.clientX,event.clientY);
    pointers.delete(event.pointerId);drag=null;
  });
  canvas.addEventListener("pointercancel",event=>{pointers.delete(event.pointerId);drag=null;});
  canvas.addEventListener("wheel",event=>{
    if(state.view!=="dna")return;
    event.preventDefault();
    if(Math.abs(event.deltaY)>2)chooseTrack(state.track+(event.deltaY>0?1:-1));
  },{passive:false});
  canvas.addEventListener("keydown",event=>{
    if(state.view==="dna"){
      if(event.key==="ArrowDown"){chooseTrack(state.track+1);event.preventDefault();}
      if(event.key==="ArrowUp"){chooseTrack(state.track-1);event.preventDefault();}
      if(event.key==="ArrowLeft"){chooseAlbum(state.album-1);event.preventDefault();}
      if(event.key==="ArrowRight"){chooseAlbum(state.album+1);event.preventDefault();}
      if(event.key==="Enter"){playSelected("user_selected");event.preventDefault();}
    }else if(["ArrowRight","ArrowLeft"].includes(event.key)){
      const i=state.networks.findIndex(x=>x.id===state.activeRegion);
      chooseRegion(state.networks[(i+(event.key==="ArrowRight"?1:-1)+state.networks.length)%state.networks.length].id);
      event.preventDefault();
    }
  });
  $("rwAlbum").addEventListener("change",e=>chooseAlbum(Number(e.target.value)));
  $("rwPlay").addEventListener("click",()=>playSelected("user_selected"));
  $("rwSurprise").addEventListener("click",()=>{
    const total=state.albums.reduce((n,a)=>n+a.tracks.length,0);
    if(!total)return;
    const random=new Uint32Array(1);crypto.getRandomValues(random);
    let selection=random[0]%total;
    for(let a=0;a<state.albums.length;a++){
      if(selection<state.albums[a].tracks.length){
        chooseAlbum(a);chooseTrack(selection);playSelected("random_one_time_opt_in");break;
      }
      selection-=state.albums[a].tracks.length;
    }
  });
  $("rwMix").addEventListener("change",async e=>{try{await analyzeFiles([...e.target.files],false);}catch(error){$("rwFileStatus").textContent=error.message;}});
  $("rwStems").addEventListener("change",async e=>{try{await analyzeFiles([...e.target.files],true);}catch(error){$("rwFileStatus").textContent=error.message;}});
  $("rwQuizResponse").addEventListener("click",()=>{
    const choice=document.querySelector('[name="q-focus"]:checked')?.value;
    const map={rhythm:"rhythm",melody:"harmony",timbre:"auditory",none:null};
    if(!choice){$("rwQuizAnswer").textContent="Choose an option or leave the question blank.";return;}
    $("rwQuizAnswer").textContent=choice==="none"
      ?"No problem. Listening experiences differ and a correct observation is not required."
      :"Related network highlighted. This is self-reported attention, not measured neural activity.";
    if(map[choice]){changeView("brain");chooseRegion(map[choice]);}
  });
}
function updateAudioResults(analysis,theory){
  state.analysis=analysis;state.frames=analysis.frames||[];
  const t=theory||{};
  $("rwBpm").textContent=t.tempo?.bpm!=null?String(Math.round(t.tempo.bpm))+" BPM":"—";
  $("rwTempoConfidence").textContent=t.tempo?.reason||"Not available";
  $("rwKey").textContent=t.key?.name||"Uncertain";
  $("rwKeyConfidence").textContent=t.key?.reason||"Not available";
  const m=analysis.dominantModes?.[0];
  $("rwMode").textContent=m?"("+m.m+","+m.n+")":"—";
  $("rwBass").textContent=((analysis.features?.lowBandFraction||0)*100).toFixed(1)+"%";
  syncWeights(0);
}
function syncWeights(time){
  const frames=state.frames;if(!frames.length)return;
  let nearest=frames[0],distance=Infinity;
  for(const frame of frames){
    const d=Math.abs(frame.atSeconds-time);
    if(d<distance){nearest=frame;distance=d;}
  }
  const target=nearest.weights||[];
  for(let i=0;i<weights.length;i++){
    const next=Math.max(0,Math.min(1,Number(target[i])||0));
    weights[i]=weights[i]*.35+next*.65;
  }
}
async function decoder(){
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)throw Error("Web Audio decoder unavailable");
  if(!context)context=new AudioContext();
  return context;
}
async function decodeBlob(blob){
  const c=await decoder();
  const buffer=await c.decodeAudioData(await blob.arrayBuffer());
  const length=Math.min(buffer.length,Math.floor(MAX_BROWSER_SECONDS*buffer.sampleRate));
  const pcm=new Float32Array(length);
  if(length<8192)throw Error("Too little audio for key estimation");
  for(let channel=0;channel<Math.min(buffer.numberOfChannels,8);channel++){
    const samples=buffer.getChannelData(channel);
    for(let i=0;i<length;i++)pcm[i]+=samples[i]/Math.min(buffer.numberOfChannels,8);
  }
  return {samples:pcm,sampleRate:buffer.sampleRate};
}
async function analyzeFiles(files,stems){
  if(!files.length)return;
  if(files.length>(stems?MAX_FILES:1))throw Error("Select "+(stems?"up to eight stems":"one complete mix"));
  if(files.reduce((n,f)=>n+f.size,0)>MAX_FILE_BYTES)throw Error("Audio selected exceeds 40 MiB local limit");
  for(const f of files)if(!f.type.startsWith("audio/")&&!/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(f.name))throw Error("Unsupported file: "+f.name);
  $("rwFileStatus").textContent="Decoding locally; no audio upload…";
  const decoded=[];
  for(const f of files){decoded.push({name:f.name,...(await decodeBlob(f))});}
  let analysis,raw;
  if(stems){
    const group=analyzeTrackouts(decoded,{maxSeconds:MAX_BROWSER_SECONDS});
    analysis=group.combined;
    const length=Math.min(...decoded.map(d=>d.samples.length));
    raw=new Float32Array(length);
    for(const stem of decoded)for(let i=0;i<length;i++)raw[i]+=stem.samples[i]/decoded.length;
  }else{raw=decoded[0].samples;analysis=analyzePcm(raw,decoded[0].sampleRate,{maxSeconds:MAX_BROWSER_SECONDS});}
  const theory=estimateMusicTheory(raw,decoded[0].sampleRate);
  state.origin="local";state.analysisId=null;
  updateAudioResults(analysis,theory);
  $("rwFileStatus").textContent=(stems?"Aligned stem sum from "+decoded.length+" files":"One complete mix")+
    " · Key/BPM estimated locally · Water-field calculation updated · no storage or upload."+
    (stems?" Stem extraction from a mixed song requires a separate opt-in ML job.":"");
  updateMessage("Local audio analyzed; the water surface projects the acoustic model.");
}
async function analyzePublished(track){
  if(track.gated||!track.src||!/^assets\/audio\/[a-z0-9_.-]+\.(?:mp3|wav|ogg)$/i.test(track.src)){
    updateMessage("Restricted or remote media cannot be fetched for analysis; the canonical player enforces the access gate.");
    return;
  }
  const url=new URL(track.src,location.href);
  if(url.origin!==location.origin)return;
  const res=await fetch(url.href,{credentials:"same-origin"});
  if(!res.ok)throw Error("Published source unavailable");
  const size=Number(res.headers.get("content-length")||0);
  if(size>MAX_FILE_BYTES)throw Error("On-device analysis cap exceeded");
  const blob=await res.blob();
  if(blob.size>MAX_FILE_BYTES)throw Error("On-device analysis cap exceeded");
  const pcm=await decodeBlob(blob);
  if(state.analysisId!==track.title)return; // reject superseded decode
  updateAudioResults(analyzePcm(pcm.samples,pcm.sampleRate,{maxSeconds:MAX_BROWSER_SECONDS}),
    estimateMusicTheory(pcm.samples,pcm.sampleRate));
  updateMessage("Measured audio ready: tempo/key are estimates, water is a modeled response, brain associations are literature-based.");
}
async function playSelected(origin){
  const album=state.albums[state.album],track=album?.tracks?.[state.track];
  if(!track||!engine?.play){updateMessage("The canonical Music player is not available");return;}
  state.origin=origin;state.analysisId=track.title;
  updateMessage(origin==="random_one_time_opt_in"?"One-time random selection; not a preference or endorsement.":"Playing with the canonical Music engine.");
  // Supplied origin is metadata for a future checked source-of-selection contract;
  // MCC_MUSIC currently ignores its fourth argument. Never pretend it persisted.
  const playing=engine.play(album.slug,track.title,false,origin);
  await Promise.allSettled([playing,analyzePublished(track)]);
}
function synchronize(){
  if(!engine?.current||!state.frames.length||state.origin==="local")return;
  const item=engine.current();
  if(!item||item.title!==state.analysisId)return;
  syncWeights(Math.min(MAX_BROWSER_SECONDS,Number(engine.audio.currentTime)||0));
}
async function boot(){
  events();
  try{
    const [meta,music]=await Promise.all([
      fetch("data/research/music-brain-networks.json").then(x=>{if(!x.ok)throw Error("Brain catalogue unavailable");return x.json();}),
      fetch("data/albums.json").then(x=>{if(!x.ok)throw Error("Music catalogue unavailable");return x.json();})
    ]);
    state.networks=meta.regions;
    state.albums=(music.albums||[]).filter(a=>a.slug&&Array.isArray(a.tracks)&&a.tracks.length);
    const select=$("rwAlbum");select.replaceChildren();
    for(let i=0;i<state.albums.length;i++){
      const option=document.createElement("option");option.value=String(i);
      option.textContent=state.albums[i].name;select.append(option);
    }
    drawNetworks();init3D();chooseAlbum(0);changeView("brain");
    window.addEventListener("mcc:music-state",synchronize);
    engine?.audio?.addEventListener("timeupdate",synchronize);
  }catch(error){fail3D("Could not initialize research world: "+error.message);}
}
boot();
