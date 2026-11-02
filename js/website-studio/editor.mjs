import {assertDocument} from './contract.mjs';
import {renderWebsite} from './renderer.mjs';
import {captureBase,envelope,validateChanges,candidate,stillValid,createRun,undoEntry} from './proposal.mjs';
const $=id=>document.getElementById(id),API='https://api.mccluster.org/v1/creator-sites/studio';
const project=new URLSearchParams(location.search).get('project')||'',validProject=/^[a-z0-9][a-z0-9-]{2,39}$/.test(project);let authEpoch=0;
const projectAPI='https://api.mccluster.org/v1/projects/'+encodeURIComponent(project)+'/tiles';
const bridgeAPI='https://api.mccluster.org/v2/projects/'+encodeURIComponent(project)+'/tiles';
let definition,doc,draftID,revision=0,assets=[],processing={can_prepare:false,blockers:[]},dispose=()=>{},dirty=false,busy=false;
/* The dual-revision Tile bridge (docs/productization/20261102-tile-bridge/HANDOFF.md): once the project is enrolled in the
   versioned editor, every save/publish/unpublish/withdraw/recover/switch carries BOTH the editor-head revision and the
   Studio draft revision; a stale pair is a 409 that keeps the edits here. Legacy v1 writes remain only where the bridge
   reports itself unconfigured, with the existing single expected_revision. */
let bridge=null;   // null: legacy; otherwise {editor_revision, owner_withdrawn, presentation, removed}
let conflict=null; // a stale write waiting for a decision: {what, fn}
/* THE OWNED PROPOSAL SLICE (proposal.mjs): one tile's headline/body, captured against both revisions and a digest;
   pure preview; explicit Apply = the one dual-revision save; one Undo transaction = a new deliberate save of the
   prior draft. Source is McCluster (bounded nonstreaming request through the one plane; see the backend request in
   docs/productization/20261102-claude/HANDOFF.md) or the owner's own typed text. Nothing here publishes. */
const PROPOSAL_ROUTE='https://api.mccluster.org/v1/ai/tile-proposal';
let P={state:'idle',base:null,env:null,run:null,cand:null,error:'',source:'mccluster',undo:[]};
const status=(s,error=false)=>{$('status').textContent=s;$('status').classList.toggle('ws-error',error);};
async function api(path,init={}){
 const epoch=authEpoch;await window.MCC?.refreshIfNeeded?.();if(epoch!==authEpoch)throw Error('Account changed');
 const token=window.MCC?.session()?.access_token;
 let endpoint=/^\/(assets|uploads)/.test(path)?API+path:path==='/workspaces'?'https://api.mccluster.org/v1/creator-billing/entitlement':path.startsWith('/v2')?bridgeAPI+path.slice(3):projectAPI+(path==='/templates'?path:path.endsWith('/preview')?'/preview':path.endsWith('/publish')?'/publish':'');
 const r=await fetch(endpoint,{method:init.method||'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(init.body?{'content-type':'application/json'}:{})},body:init.body?JSON.stringify(init.body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>({}));if(epoch!==authEpoch||window.MCC?.session()?.access_token!==token)throw Error('Account changed');if(!r.ok)throw Object.assign(Error(d.error||'Studio is unavailable'),{status:r.status,body:d});return d;
}
/* `unconfigured` is ONLY the bridge's own contract signal (503 {code:'unconfigured'}); 403, a generic 503, a network
   failure, a timeout or a malformed answer fail closed: no legacy write, edits kept, specific reason shown. */
const kindOf=e=>e&&e.status===409?'conflict':e&&e.status===503&&e.body&&e.body.code==='unconfigured'?'unconfigured':e&&e.status===401?'signin':e&&e.status===403?'forbidden':e&&e.malformed?'malformed':e&&typeof e.status==='number'?'other':'network';
const wellFormedBridge=d=>!!d&&typeof d==='object'&&Number.isSafeInteger(d.editor_revision)&&d.editor_revision>=0&&Number.isSafeInteger(d.studio_revision)&&d.studio_revision>=0;
let blocked=null,legacy=false; // blocked: the classified error that paused writes; legacy: true ONLY on the bridge's own unconfigured signal
function tokens(){return bridge?{expected_editor_revision:bridge.editor_revision,expected_revision:revision}:{expected_revision:revision};}
function adoptBridge(d){if(!wellFormedBridge(d))throw Object.assign(Error('The server\'s answer was not in the expected form; nothing was assumed.'),{malformed:true,status:200});bridge={editor_revision:d.editor_revision,owner_withdrawn:!!d.owner_withdrawn,presentation:d.presentation||(bridge&&bridge.presentation)||'tiles',removed:!!d.removed};revision=d.studio_revision;blocked=null;}
function refuse(what){if(bridge||legacy)return false;status('Not '+what+': the versioned Tile bridge could not be reached when this project opened'+(blocked?' ('+blocked+')':'')+'. Your edits are kept here. Reload the project; nothing was written.',true);return true;}
/* after a lost response: THIS operation counts as committed only if the editor-head history records it
   (`tiles_<action>`) at exactly expected+1, the Studio revision moved as this operation moves it, and the state shows
   its effect (the sent document for save; publication cleared for unpublish/withdraw; …). Anything else is unknown:
   edits kept, nothing retried. */
const OP={'/v2':'tiles_save','/v2/unpublish':'tiles_unpublish','/v2/withdraw':'tiles_withdraw','/v2/recover':'tiles_recover','/v2/switch-front':'tiles_switch_front'};
async function readback(what,path,body){
 status('Checking what was saved…');
 let now=null,hist=null;
 try{now=await api('/v2');const token=window.MCC?.session()?.access_token;hist=await fetch('https://api.mccluster.org/v2/projects/'+encodeURIComponent(project)+'/history',{headers:{authorization:'Bearer '+token},cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);}catch(_){now=null;}
 if(!wellFormedBridge(now)){status('Unknown whether it was '+what+': the project could not be read back. Nothing is assumed; your edits are kept here.',true);return false;}
 if(now.editor_revision===bridge.editor_revision&&now.studio_revision===revision){status('Not '+what+': the connection dropped and nothing reached the server. Your edits are kept; try again.',true);return false;}
 const row=Array.isArray(hist?.history)?hist.history.find(h=>h&&h.revision===bridge.editor_revision+1):null;
 const op=path==='/v2/publish'?(row&&/^tiles_publish/.test(String(row.operation))?row.operation:null):OP[path];
 const stepped=now.editor_revision===bridge.editor_revision+1&&now.studio_revision===revision+(path==='/v2'?1:0);
 const effect=path==='/v2'?JSON.stringify(now.draft?.document)===JSON.stringify(body.document):path==='/v2/unpublish'||path==='/v2/withdraw'?now.published_revision==null:path==='/v2/recover'?!now.removed&&!now.owner_withdrawn:path==='/v2/publish'?!!now.published_revision:true;
 if(stepped&&row&&op&&row.operation===op&&effect){status('Confirmed from the history: it was '+what+' before the connection dropped · draft revision '+now.studio_revision+' · editor revision '+now.editor_revision);return {...now,recovered:true};}
 status('Unknown whether it was '+what+': the history does not show this exact operation at the next revision'+(stepped?'':' (the project moved by a different step)')+'. Nothing is assumed and nothing was retried. Your edits are kept; load the latest saved draft to see the current state.',true);return false;}
function manage(){
 const m=$('manage');if(!m)return;m.replaceChildren();if(!bridge){m.hidden=true;return;}m.hidden=false;
 const b=(text,fn)=>{const x=node('button',text);x.type='button';x.onclick=()=>guard(fn);m.append(x);return x;};
 if(bridge.owner_withdrawn){m.append(node('p','You withdrew this project: it is not public. Its drafts, history and address are kept.'));b('Recover project (stays unpublished)',async()=>{const r=await write('/v2/recover',{},'recovered');adoptBridge(r);if(!r.recovered)status('Recovered. Nothing is published until you publish again.');manage();});return;}
 if(bridge.removed){m.append(node('p','McCluster took this project down. Its drafts are kept; it cannot be recovered from here.'));return;}
 b('Take the published website down',async()=>{if(!confirm('Take the published website down? Your drafts and history are kept.'))return;const r=await write('/v2/unpublish',{},'taken down');adoptBridge(r);$('published').replaceChildren();if(!r.recovered)status('Taken down · revision '+revision);manage();});
 b('Switch to the front-page presentation (unpublished)',async()=>{if(!confirm('Switch this project to its retained front-page draft? Nothing is published by the switch; the tile drafts stay.'))return;const r=await write('/v2/switch-front',{},'switched');adoptBridge(r);if(!r.recovered)status('Switched to the front presentation, unpublished. Edit it in Project Studio; the tile drafts are kept here.');manage();});
 b('Withdraw project',async()=>{if(!confirm('Withdraw this project? Its page stops being public; drafts, history and address are kept and you can recover it.'))return;const r=await write('/v2/withdraw',{},'withdrawn');adoptBridge(r);$('published').replaceChildren();if(!r.recovered)status('Withdrawn · not public · drafts kept');manage();});
}
/* one versioned write; a 409 keeps the edits and offers the decision; a lost response is read back */
async function write(path,body,what){
 if(refuse(what))throw Object.assign(Error(''),{handled:true});
 conflict=null;$('keepMine')?.remove();
 try{return await api(path,{method:path==='/v2'?'PUT':'POST',body:{...tokens(),...body}});}
 catch(e){
  const k=kindOf(e);
  if(k==='conflict'){
   const now=await api('/v2').catch(()=>null);
   status('Not '+what+': this project was saved somewhere else since you opened it'+(now?' (editor revision '+now.editor_revision+', draft revision '+now.studio_revision+')':'')+'. Your edits are kept here. Load the latest saved draft to take theirs, or keep yours and save over it.',true);
   const keep=node('button','Keep mine and save over it');keep.id='keepMine';keep.type='button';keep.onclick=()=>guard(async()=>{if(!now)throw Error('The latest revisions could not be read; try again.');adoptBridge({...now,studio_revision:now.studio_revision});keep.remove();const r=await write(path,body,what);adoptBridge(r);if(path==='/v2'){dirty=false;if(!r.recovered)status('Saved over the other change · revision '+revision);}else{if(!r.recovered)status(what.charAt(0).toUpperCase()+what.slice(1)+' · revision '+revision);manage();}});
   $('status').after(keep);throw Object.assign(Error(''),{handled:true});
  }
  /* CONTRACT: write() resolves to a well-formed bridge state on success — the server's own answer, or, after a lost
     response, the state the history readback CONFIRMED (flagged recovered:true). It never resolves to null; every other
     outcome throws (handled:true once the status line already says why). Consumers adopt the resolved state exactly as
     they would a direct answer; no second write is ever issued to repair the screen. */
  if(k==='network'&&bridge){const recovered=await readback(what,path,body);if(recovered)return recovered;throw Object.assign(Error(''),{handled:true});}
  if(k==='malformed'){status('Not '+what+': '+e.message+' Your edits are kept.',true);throw Object.assign(Error(''),{handled:true});}
  if(k==='forbidden'){status('Not '+what+': you are not allowed to change this project (403). Your edits are kept.',true);throw Object.assign(Error(''),{handled:true});}
  if(k==='signin'){status('Not '+what+': you are signed out. Sign in again; your edits stay on this screen.',true);throw Object.assign(Error(''),{handled:true});}
  throw e;
 }
}
function pending(){sessionStorage.setItem('studio-template-intent','motion-portfolio');}
function changed(){dirty=true;status('Unsaved edits. Save before previewing or publishing.');if(P.cand){P.cand=null;P.state='rejected';P.error='The draft changed, so the proposal was set aside. Save, then ask again.';assistPanel();}}
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
async function guard(fn){if(busy)return;busy=true;try{await fn();}catch(e){if(!e||!e.handled)status(e.message,true);}finally{busy=false;}}
async function upload(file,settings,select){if(!file)return;return guard(async()=>{if(!confirm('Do you own this media or have permission to use it?'))return;
 const epoch=authEpoch;status('Registering upload…');const r=await api('/uploads',{method:'POST',body:{bytes:file.size,settings,rights_confirmed:true}});
 status('Uploading. Keep this page open.');const u=new URL(r.upload_url);if(u.origin!=='https://api.mccluster.org'||u.pathname!=='/v1/customer-site/media'||r.upload_method!=='POST'||r.requires_authorization!==true)throw Error('Unexpected upload destination');
 const token=window.MCC?.session()?.access_token;if(!token||epoch!==authEpoch)throw Error('Account changed');
 const response=await fetch(r.upload_url,{method:'POST',headers:{authorization:'Bearer '+token,'x-site-bytes':String(file.size),'content-type':file.type||'application/octet-stream'},body:file,signal:AbortSignal.timeout(130000)});if(epoch!==authEpoch)throw Error('Account changed');if(!response.ok)throw Error('Upload was not confirmed. Refresh storage in Your site before retrying. Your saved draft has not changed.');
 select(r.asset_id);changed();await media();if(!processing.can_prepare){status('Upload retained. Save your draft to keep this selection. '+processing.blockers.join(' '),true);return;}try{const queued=await api('/assets/'+r.asset_id+'/complete',{method:'POST',body:{}});await media();status('Upload saved; media '+queued.state+'. Save your draft and refresh media status to see the result.');}catch(e){await media();throw Error('Upload retained. Save your draft, then use Prepare or retry. '+e.message);}});}
function proposalReset(){P.state='idle';P.base=null;P.env=null;P.cand=null;P.error='';if(P.run)P.run.cancel();P.run=null;}
function assistPanel(){
 const a=$('assist');if(!a)return;a.replaceChildren();if(!doc||!bridge){a.hidden=true;return;}a.hidden=false;
 a.append(node('h2','Suggest a change to one tile'));
 a.append(node('p','One tile\'s headline and description, as a proposal you preview first. Nothing is saved until you press Apply, and Apply is the same revision-checked save as the Save button. Publishing stays separate.'));
 const form=node('form');form.className='ws-inline';
 const tileSel=node('select');doc.tiles.forEach((t,i)=>{const o=node('option','Tile '+(i+1)+' · '+t.kind+' · '+(t.headline||'(no headline)').slice(0,40));o.value=t.id;tileSel.append(o);});field(form,'Which tile',tileSel);
 const src=node('select');for(const [k,l] of [['mccluster','Ask McCluster for wording'],['own','Write the new wording myself']]){const o=node('option',l);o.value=k;src.append(o);}src.value=P.source;src.onchange=()=>{P.source=src.value;assistPanel();};field(form,'Where the suggestion comes from',src);
 const ask=node('textarea');ask.rows=3;ask.maxLength=2000;const head=node('input');head.maxLength=120;const body=node('textarea');body.rows=4;body.maxLength=2000;
 if(P.source==='mccluster')field(form,'What should change (sent to McCluster with only that tile\'s current text)',ask);else{field(form,'New headline (leave blank to keep)',head);field(form,'New description (leave blank to keep)',body);}
 const go=node('button',P.source==='mccluster'?'Ask for a proposal':'Preview my wording');go.type='submit';go.disabled=P.state==='requesting'||P.state==='applying'||busy;form.append(go);
 form.onsubmit=ev=>{ev.preventDefault();propose(tileSel.value,P.source==='mccluster'?{ask:ask.value}:{headline:head.value,body:body.value});};
 a.append(form);
 const st=node('p',P.state==='requesting'?'Asking McCluster… (one bounded request; no streaming)':P.state==='proposed'||P.state==='previewed'?'Proposal ready. Review the change below, then Apply or discard.':P.state==='applying'?'Applying…':P.error||'');st.className=P.error?'ws-error':'';st.setAttribute('role','status');a.append(st);
 if(P.cand){
  const diff=node('dl');diff.className='ws-diff';for(const d of P.cand.diff){diff.append(node('dt',d.field));const dd=node('dd');dd.append(node('del',d.before||'(empty)'),node('ins',d.after));diff.append(dd);}a.append(diff);
  const row=node('div');row.className='ws-inline';
  const prev=node('button','Preview the whole website with this change');prev.type='button';prev.onclick=()=>{P.state='previewed';show(P.cand.document);};
  const apply=node('button','Apply (saves a new revision)');apply.type='button';apply.disabled=busy;apply.onclick=()=>guard(applyProposal);
  const drop=node('button','Discard proposal');drop.type='button';drop.onclick=()=>{proposalReset();assistPanel();};
  row.append(prev,apply,drop);a.append(row);
 }
 if(P.undo.length){const u=P.undo[P.undo.length-1];const undo=node('button','Undo the last applied proposal (saves the previous wording as a new revision)');undo.type='button';undo.disabled=busy;undo.onclick=()=>guard(undoProposal);a.append(undo);a.append(node('p','Last applied: '+u.at+' · saved as draft revision '+u.tokens.studio+', editor revision '+u.tokens.editor+'.'));}
}
async function propose(tileId,input){
 if(dirty){P.error='Save your edits first: a proposal is made against the saved draft so nothing you typed is overwritten quietly.';assistPanel();return;}
 proposalReset();
 try{P.base=await captureBase({projectId:project,document:doc,editorRevision:bridge.editor_revision,studioRevision:revision});}
 catch(e){P.error=e.message;assistPanel();return;}
 const r=createRun();P.run=r;P.env=envelope(P.base,{proposalId:'prop-'+r.run.id,runId:r.run.id,tileId});
 const tile=P.base.document.tiles.find(t=>t.id===tileId);
 let raw;
 if(P.source==='own'){raw={};if(String(input.headline||'').trim())raw.headline=input.headline;if(String(input.body||'').trim())raw.body=input.body;}
 else{
  P.state='requesting';assistPanel();
  try{
   const epoch=authEpoch;await window.MCC?.refreshIfNeeded?.();const token=window.MCC?.session()?.access_token;if(!token||epoch!==authEpoch)throw Error('Account changed');
   const res=await fetch(PROPOSAL_ROUTE,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({schema:P.env.schema,proposal_id:P.env.proposalId,run_id:P.env.runId,target:P.env.target,base_revision:P.env.baseRevision,base_document_digest:P.env.baseDocumentDigest,request:String(input.ask||'').slice(0,2000),tile:{kind:tile.kind,headline:tile.headline,body:tile.body}}),cache:'no-store',signal:AbortSignal.timeout(60000)});
   const d=await res.json().catch(()=>({}));
   if(r.run.cancelled)return;
   if(res.status===404||res.status===503||res.status===501){P.state='failed';P.error='McCluster suggestions are not available on this site yet: the proposal route is not registered on the plane. You can still write the wording yourself above; Apply and Undo work the same way.';assistPanel();return;}
   if(res.status===401){throw Error('Sign in again to ask McCluster.');}
   if(res.status===429){throw Error('McCluster is busy (one request at a time). Try again in a moment.');}
   if(!res.ok)throw Error(d.error||'McCluster could not answer.');
   if(d.proposal_id!==P.env.proposalId||d.run_id!==P.env.runId)throw Error('The answer does not belong to this request and was discarded.');
   if(d.status&&d.status!=='complete'){P.state='failed';P.error='The suggestion did not complete ('+d.status+'). Nothing was changed.';assistPanel();return;}
   raw=d.changes;
  }catch(e){if(r.run.cancelled)return;P.state='failed';P.error=e.message;assistPanel();return;}
 }
 try{P.cand=candidate(P.base,P.env,validateChanges(raw));P.state='proposed';P.error='';}
 catch(e){P.state='rejected';P.cand=null;P.error='Proposal refused: '+e.message;}
 assistPanel();
}
async function applyProposal(){
 if(!P.cand||!P.base)return;
 const still=await stillValid(P.base,{document:doc,editorRevision:bridge.editor_revision,studioRevision:revision,projectId:project});
 if(!still.ok){P.state='rejected';P.error=still.reason==='dirty_draft'?'The draft changed since this proposal was made. Discard it and ask again.':still.reason==='revision_changed'?'The project was saved elsewhere since this proposal was made. Load the latest draft, then ask again.':'The project changed. Ask again.';assistPanel();return;}
 P.state='applying';assistPanel();
 const before=structuredClone(doc),after=P.cand.document;
 let d;try{d=await write('/v2',{document:after},'applied');}catch(e){P.state='failed';P.error=e&&e.handled?'Apply was not confirmed; nothing was assumed. See the status line above.':(e&&e.message)||'Apply failed.';assistPanel();if(!(e&&e.handled))throw e;return;}
 adoptBridge(d);doc=structuredClone(after);dirty=false;renderEditor();
 P.undo.push(undoEntry({before,after,appliedTokens:{editor:bridge.editor_revision,studio:revision},proposalId:P.env.proposalId}));
 const n=P.undo.length;proposalReset();P.state='applied';P.error='';status('Applied the proposal · draft revision '+revision+' · editor revision '+bridge.editor_revision+'. Not published.');assistPanel();
}
async function undoProposal(){
 const u=P.undo[P.undo.length-1];if(!u)return;
 if(dirty){P.error='Save or load first: undo replaces the saved draft, not unsaved typing.';assistPanel();return;}
 if(bridge.editor_revision!==u.tokens.editor||revision!==u.tokens.studio){P.error='Something was saved after that proposal, so it cannot be undone blindly. Use History or edit by hand.';assistPanel();return;}
 if(!confirm('Undo the last applied proposal? The previous wording is saved as a NEW revision; nothing is deleted from history.'))return;
 const d=await write('/v2',{document:u.before},'undone');
 adoptBridge(d);doc=structuredClone(u.before);dirty=false;renderEditor();P.undo.pop();status('Undone as a new revision · draft revision '+revision+' · editor revision '+bridge.editor_revision);assistPanel();
}
async function start(){
 if(!validProject)throw Error('Choose an existing project from Your projects first.');
 pending();if(!await window.MCC?.user?.()){$('auth').hidden=false;status('Sign in to use this project template.');return;}
 $('auth').hidden=true;const rows=(await api('/templates')).templates;if(!rows?.length)throw Error('The template is not enabled yet.');definition=rows[0];
 $('guidance').textContent='Publishing requires an active paid workspace and a public profile. Private media preparation remains separately gated; no processing allowance is granted here. '+definition.guidance.transition.help;
 const saved=await api('');doc=structuredClone(saved.draft?.document||definition.definition);draftID=saved.draft?.id||'project';revision=saved.draft?.revision||0;dirty=!revision;
 bridge=null;legacy=false;blocked=null;
 try{adoptBridge(await api('/v2'));}
 catch(e){const k=kindOf(e);if(k==='unconfigured')legacy=true;else{blocked=k;status('The versioned Tile bridge could not be reached ('+k+'). Saving and publishing are paused until it answers; reload the project to try again. Your edits stay on this screen.',true);}}
 manage();proposalReset();P.undo=[];assistPanel();
 $('editor').hidden=false;$('load').hidden=false;await media();
 $('guidance').textContent=(saved.free_publication?'Publish your owned website for free with a public profile.':'Publishing requires an active paid workspace and a public profile.')+' Media approval and preparation allowances remain separate. '+definition.guidance.transition.help;
 $('workspace').closest('label').hidden=saved.free_publication===true;
 const access=saved.free_publication?{workspaces:[]}:await api('/workspaces');$('workspace').replaceChildren();for(const w of access.workspaces||[]){if(!/^[0-9a-f-]{36}$/.test(w.org_id))continue;const option=node('option','Workspace '+w.org_id);option.value=w.org_id;$('workspace').append(option);}
 if(bridge||legacy)status(revision?'Loaded saved revision '+revision:'Template ready. This draft is not saved yet.');sessionStorage.removeItem('studio-template-intent');
}
$('useTemplate').onclick=()=>guard(start);
$('authLink').href='account.html?next='+encodeURIComponent('website-studio.html?project='+project);
$('title').oninput=()=>{doc.title=$('title').value;changed();};$('mode').onchange=()=>{doc.mode=$('mode').value;changed();};
$('save').onclick=()=>guard(async()=>{if(!bridge&&!legacy){refuse('saved');return;}assertDocument(doc);
 if(bridge){const d=await write('/v2',{document:doc},'saved');adoptBridge(d);dirty=false;if(!d.recovered)status('Saved to your account · draft revision '+revision+' · editor revision '+bridge.editor_revision);return;}
 if(!legacy){refuse('saved');return;}
 const d=await api('/drafts/'+draftID,{method:'PUT',body:{expected_revision:revision,document:doc}});revision=d.revision;dirty=false;status('Saved to your account · revision '+revision);});
$('load').onclick=()=>guard(async()=>{if(dirty&&!confirm('Replace unsaved edits with the latest saved draft?'))return;const latest=await api('');const d=latest.draft;if(!d)throw Error('No saved draft yet.');doc=d.document;draftID=d.id;revision=d.revision;dirty=false;$('keepMine')?.remove();if(bridge)adoptBridge(await api('/v2').catch(()=>null));manage();$('editor').hidden=false;await media();status('Loaded saved revision '+revision);});
const show=p=>{dispose();$('previewPanel').hidden=false;dispose=renderWebsite($('previewHost'),p);$('previewPanel').scrollIntoView();};
$('preview').onclick=()=>guard(async()=>{if(dirty||!revision)throw Error('Save the draft before previewing.');show(await api('/drafts/'+draftID+'/preview',{method:'POST',body:{}}));});
$('back').onclick=()=>{dispose();$('previewPanel').hidden=true;window.scrollTo(0,0);};$('refreshMedia').onclick=()=>guard(media);
$('publish').onclick=()=>guard(async()=>{if(!bridge&&!legacy){refuse('published');return;}if(dirty||!revision)throw Error('Save and review the latest draft first.');if(!confirm('Publish this saved version? Media will be visible publicly.'))return;const r=bridge?await write('/v2/publish',{confirm_public:true,org_id:$('workspace').value},'published'):await api('/drafts/'+draftID+'/publish',{method:'POST',body:{expected_revision:revision,confirm_public:true,org_id:$('workspace').value}});if(bridge)adoptBridge(r);
 if(r.recovered){const a=node('a','Open published website');a.href='https://matthew.mccluster.org/website-studio-view.html?project='+encodeURIComponent(project);$('published').replaceChildren(a);manage();return;}
 if(r.published!==true)throw Error('Publication not confirmed');const u=new URL(r.url);if(u.origin!=='https://matthew.mccluster.org'||u.pathname!=='/website-studio-view.html')throw Error('Unexpected published destination');const a=node('a','Open published website');a.href=u.href;$('published').replaceChildren(a);status('Published revision '+(r.revision??revision));manage();});
$('demo').onclick=()=>guard(async()=>{const p=await(await fetch('data/website-studio/demo-v1.json')).json();status('McCluster demonstration. Your own template starts without this footage or wording.');show(p);});
window.addEventListener('pagehide',()=>dispose());
window.addEventListener('mcc:auth-changed',()=>{authEpoch++;proposalReset();P.undo=[];dispose();doc=null;assets=[];revision=0;draftID=null;$('tiles').replaceChildren();$('editor').hidden=true;$('previewPanel').hidden=true;$('published').replaceChildren();status('Account changed. Reopening your project.');location.reload();});
