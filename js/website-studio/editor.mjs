import {assertDocument} from './contract.mjs';
import {renderWebsite} from './renderer.mjs';
const $=id=>document.getElementById(id),API='https://api.mccluster.org/v1/creator-sites/studio';
const project=new URLSearchParams(location.search).get('project')||'',validProject=/^[a-z0-9][a-z0-9-]{2,39}$/.test(project);let authEpoch=0;
const projectAPI='https://api.mccluster.org/v1/projects/'+encodeURIComponent(project)+'/tiles';
let definition,doc,draftID,revision=0,assets=[],processing={can_prepare:false,blockers:[]},dispose=()=>{},dirty=false,busy=false;
const status=(s,error=false)=>{$('status').textContent=s;$('status').classList.toggle('ws-error',error);};
async function api(path,init={}){
 const epoch=authEpoch;await window.MCC?.refreshIfNeeded?.();if(epoch!==authEpoch)throw Error('Account changed');
 const token=window.MCC?.session()?.access_token;
 let endpoint=/^\/(assets|uploads)/.test(path)?API+path:path==='/workspaces'?'https://api.mccluster.org/v1/creator-billing/entitlement':projectAPI+(path==='/templates'?path:path.endsWith('/preview')?'/preview':path.endsWith('/publish')?'/publish':'');
 const r=await fetch(endpoint,{method:init.method||'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(init.body?{'content-type':'application/json'}:{})},body:init.body?JSON.stringify(init.body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>({}));if(epoch!==authEpoch||window.MCC?.session()?.access_token!==token)throw Error('Account changed');if(!r.ok)throw Error(d.error||'Studio is unavailable');return d;
}
function pending(){sessionStorage.setItem('studio-template-intent','motion-portfolio');}
function changed(){dirty=true;status('Unsaved edits. Save before previewing or publishing.');}
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
function field(parent,label,control){control.setAttribute('aria-label',label);const l=node('label',label);l.append(control);parent.append(l);return control;}
async function media(){const result=await api('/assets');assets=result.assets||[];processing=result.processing||{can_prepare:false,blockers:['Processing readiness could not be verified.']};let notice=$('processingState');if(!notice){notice=node('p');notice.id='processingState';$('guidance').after(notice);}notice.textContent=processing.can_prepare?'Preparation allowance available. Jobs wait for a compatible compute node; refresh media status to track completion.':processing.blockers.join(' ');renderEditor();}
function renderEditor(){
 $('title').value=doc.title;$('mode').value=doc.mode;const host=$('tiles');host.replaceChildren();
 doc.tiles.forEach((t,i)=>{
  const card=node('section');card.className='ws-card';card.append(node('h3','Tile '+(i+1)));
  const kind=node('select');for(const [key,label]of [['music','Music'],['native_video','Native video'],['immersive360','360 panorama']]){const o=node('option',label);o.value=key;kind.append(o);}kind.value=t.kind;field(card,'Content type',kind);kind.onchange=()=>{t.kind=kind.value;t.source_ref=null;t.playback='manual';t.action=null;changed();renderEditor();};
  for(const [key,label,max]of [['headline','Headline',120],['body','Description',2000]]){const c=node(key==='body'?'textarea':'input');c.value=t[key];c.maxLength=max;c.oninput=()=>{t[key]=c.value;changed();};field(card,label,c);}
  const select=node('select');const blank=node('option','Choose approved media');blank.value='';select.append(blank);
  assets.filter(a=>a.kind===t.kind).forEach(a=>{const o=node('option',a.asset_id.slice(0,8)+' · '+a.state+(a.public_approved?' · public approved':''));o.value=a.asset_id;select.append(o);});select.value=t.source_ref?.type==='media_asset'?t.source_ref.key:'';field(card,'Your uploaded media',select);select.onchange=()=>{t.source_ref=select.value?{type:'media_asset',key:select.value}:null;changed();renderEditor();};
  if(t.kind==='native_video'){const post=node('input');post.placeholder='Existing native post UUID';post.value=t.source_ref?.type==='network_post'?t.source_ref.key:'';field(card,'Or pin a registered native post',post);post.onchange=()=>{t.source_ref=post.value.trim()?{type:'network_post',key:post.value.trim()}:null;changed();};card.append(node('p','Only posts with an authorized registered media asset are supported. Private posts stay private.'));}
  const contentFile=node('input');contentFile.type='file';contentFile.accept=t.kind==='music'?'audio/*':t.kind==='immersive360'?'image/jpeg,image/png,image/webp':'video/*';field(card,'Upload your content',contentFile);contentFile.onchange=()=>upload(contentFile.files[0],{kind:t.kind},key=>{t.source_ref={type:'media_asset',key};});
  const transSelect=node('select');const none=node('option','No transition');none.value='';transSelect.append(none);assets.filter(a=>a.kind==='transition').forEach(a=>{const o=node('option',a.asset_id.slice(0,8)+' · '+a.state);o.value=a.asset_id;transSelect.append(o);});transSelect.value=t.transition?.asset_ref.key||'';field(card,'Scroll transition',transSelect);
  transSelect.onchange=()=>{const a=assets.find(x=>x.asset_id===transSelect.value);t.transition=a?transition(a.asset_id,a.settings):null;changed();};
  const timing=node('div');timing.className='ws-inline';const start=node('input'),end=node('input');start.type=end.type='number';start.min='0';end.min='1';start.max=end.max='600';start.step=end.step='.1';start.value='0';end.value='6';field(timing,'Start (seconds)',start);field(timing,'End (seconds)',end);card.append(timing);
  const focal=node('input');focal.type='range';focal.min='0';focal.max='1';focal.step='.01';focal.value='.5';field(card,'Subject position: left to right',focal);
  const clip=node('input');clip.type='file';clip.accept='video/*';field(card,'Upload a transition',clip);clip.onchange=()=>upload(clip.files[0],{kind:'transition',in_ms:Math.round(Number(start.value)*1000),out_ms:Math.round(Number(end.value)*1000),focal_x:Number(focal.value),focal_y:.5},key=>{t.transition=transition(key,{in_ms:Math.round(Number(start.value)*1000),out_ms:Math.round(Number(end.value)*1000),focal_x:Number(focal.value),focal_y:.5});});
  const approve=node('button','Approve selected media for public use');approve.type='button';approve.onclick=()=>guard(async()=>{if(!confirm('Allow the selected content and transition to appear on your public website?'))return;for(const key of [t.source_ref?.type==='media_asset'?t.source_ref.key:null,t.transition?.asset_ref.key].filter(Boolean))await api('/assets/'+key+'/approve',{method:'POST',body:{public_approved:true}});await media();status('Media approval saved. Publish remains a separate step.');});card.append(approve);
  for(const key of [t.source_ref?.type==='media_asset'?t.source_ref.key:null,t.transition?.asset_ref.key].filter(Boolean)){
   const selected=assets.find(a=>a.asset_id===key);if(!selected)continue;
   card.append(node('p','Media '+key.slice(0,8)+': '+selected.state+(selected.error?' · '+selected.error:'')));
   if(selected.retryable){const retry=node('button','Prepare or retry '+key.slice(0,8));retry.type='button';retry.disabled=!processing.can_prepare;retry.onclick=()=>guard(async()=>{if(!confirm('Prepare this retained upload? Each attempt reserves the existing preparation allowance.'))return;const result=await api('/assets/'+key+'/complete',{method:'POST',body:{}});await media();status('Media '+result.state+'. Refresh media status to check completion.');});card.append(retry);}
  }
  const move=node('button','Move tile up');move.disabled=i===0;move.onclick=()=>{[doc.tiles[i-1],doc.tiles[i]]=[doc.tiles[i],doc.tiles[i-1]];changed();renderEditor();};card.append(move);host.append(card);
 });
}
function transition(key,s){return {asset_ref:{type:'media_asset',key},in_ms:s.in_ms,out_ms:s.out_ms,pace:'standard',focal:{desktop:{x:s.focal_x??.5,y:s.focal_y??.5},mobile:{x:s.focal_x??.5,y:s.focal_y??.5}}};}
async function guard(fn){if(busy)return;busy=true;try{await fn();}catch(e){status(e.message,true);}finally{busy=false;}}
async function upload(file,settings,select){if(!file)return;return guard(async()=>{if(!confirm('Do you own this media or have permission to use it?'))return;
 const epoch=authEpoch;status('Registering upload…');const r=await api('/uploads',{method:'POST',body:{bytes:file.size,settings,rights_confirmed:true}});
 status('Uploading. Keep this page open.');const u=new URL(r.upload_url);if(u.origin!=='https://api.mccluster.org'||u.pathname!=='/v1/customer-site/media'||r.upload_method!=='POST'||r.requires_authorization!==true)throw Error('Unexpected upload destination');
 const token=window.MCC?.session()?.access_token;if(!token||epoch!==authEpoch)throw Error('Account changed');
 const response=await fetch(r.upload_url,{method:'POST',headers:{authorization:'Bearer '+token,'x-site-bytes':String(file.size),'content-type':file.type||'application/octet-stream'},body:file,signal:AbortSignal.timeout(130000)});if(epoch!==authEpoch)throw Error('Account changed');if(!response.ok)throw Error('Upload was not confirmed. Refresh storage in Your site before retrying. Your saved draft has not changed.');
 select(r.asset_id);changed();await media();if(!processing.can_prepare){status('Upload retained. Save your draft to keep this selection. '+processing.blockers.join(' '),true);return;}try{const queued=await api('/assets/'+r.asset_id+'/complete',{method:'POST',body:{}});await media();status('Upload saved; media '+queued.state+'. Save your draft and refresh media status to see the result.');}catch(e){await media();throw Error('Upload retained. Save your draft, then use Prepare or retry. '+e.message);}});}
async function start(){
 if(!validProject)throw Error('Choose an existing project from Your projects first.');
 pending();if(!await window.MCC?.user?.()){$('auth').hidden=false;status('Sign in to use this project template.');return;}
 $('auth').hidden=true;const rows=(await api('/templates')).templates;if(!rows?.length)throw Error('The template is not enabled yet.');definition=rows[0];
 $('guidance').textContent='Publishing requires an active paid workspace and a public profile. Private media preparation remains separately gated; no processing allowance is granted here. '+definition.guidance.transition.help;
 const saved=await api('');doc=structuredClone(saved.draft?.document||definition.definition);draftID=saved.draft?.id||'project';revision=saved.draft?.revision||0;dirty=!revision;
 $('editor').hidden=false;$('load').hidden=false;await media();
 const access=await api('/workspaces');$('workspace').replaceChildren();for(const w of access.workspaces||[]){if(!/^[0-9a-f-]{36}$/.test(w.org_id))continue;const option=node('option','Workspace '+w.org_id);option.value=w.org_id;$('workspace').append(option);}
 status(revision?'Loaded saved revision '+revision:'Template ready. This draft is not saved yet.');sessionStorage.removeItem('studio-template-intent');
}
$('useTemplate').onclick=()=>guard(start);
$('authLink').href='account.html?next='+encodeURIComponent('website-studio.html?project='+project);
$('title').oninput=()=>{doc.title=$('title').value;changed();};$('mode').onchange=()=>{doc.mode=$('mode').value;changed();};
$('save').onclick=()=>guard(async()=>{assertDocument(doc);const d=await api('/drafts/'+draftID,{method:'PUT',body:{expected_revision:revision,document:doc}});revision=d.revision;dirty=false;status('Saved to your account · revision '+revision);});
$('load').onclick=()=>guard(async()=>{if(dirty&&!confirm('Replace unsaved edits with the latest saved draft?'))return;const d=(await api('')).draft;if(!d)throw Error('No saved draft yet.');doc=d.document;draftID=d.id;revision=d.revision;dirty=false;$('editor').hidden=false;await media();status('Loaded saved revision '+revision);});
const show=p=>{dispose();$('previewPanel').hidden=false;dispose=renderWebsite($('previewHost'),p);$('previewPanel').scrollIntoView();};
$('preview').onclick=()=>guard(async()=>{if(dirty||!revision)throw Error('Save the draft before previewing.');show(await api('/drafts/'+draftID+'/preview',{method:'POST',body:{}}));});
$('back').onclick=()=>{dispose();$('previewPanel').hidden=true;window.scrollTo(0,0);};$('refreshMedia').onclick=()=>guard(media);
$('publish').onclick=()=>guard(async()=>{if(dirty||!revision)throw Error('Save and review the latest draft first.');if(!confirm('Publish this saved version? Media will be visible publicly.'))return;const r=await api('/drafts/'+draftID+'/publish',{method:'POST',body:{expected_revision:revision,confirm_public:true,org_id:$('workspace').value}});if(r.published!==true)throw Error('Publication not confirmed');const u=new URL(r.url);if(u.origin!=='https://matthew.mccluster.org'||u.pathname!=='/website-studio-view.html')throw Error('Unexpected published destination');const a=node('a','Open published website');a.href=u.href;$('published').replaceChildren(a);status('Published revision '+r.revision);});
$('demo').onclick=()=>guard(async()=>{const p=await(await fetch('data/website-studio/demo-v1.json')).json();status('McCluster demonstration. Your own template starts without this footage or wording.');show(p);});
window.addEventListener('pagehide',()=>dispose());
window.addEventListener('mcc:auth-changed',()=>{authEpoch++;dispose();doc=null;assets=[];revision=0;draftID=null;$('tiles').replaceChildren();$('editor').hidden=true;$('previewPanel').hidden=true;$('published').replaceChildren();status('Account changed. Reopening your project.');location.reload();});
