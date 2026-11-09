/* Owner-only local review controls mounted inside the existing World country card.
   The shared server owner gate loads this module, never a new public destination. */
import { onCountryCard } from './hooks.mjs';
import { saveGeneratedRecipe, loadGeneratedRecipe } from '../prim3-tactics/levels/generated.mjs';
import { OBJECTIVES, TERRAINS, SCHEMA } from '../prim3-tactics/levels/recipe.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='prim3.generated.editor.v1.';
export function mountGenerator(country,section,{name,geography}={},storage=globalThis.localStorage) {
  if(!section) return;
  const box=document.createElement('details'); box.className='pw-card pw-generated';
  const field=(key,label,value='',type='text')=>`<label class="pw-field"><span>${esc(label)}</span><input name="${key}" type="${type}" value="${esc(value)}" ${type==='number'?'step="any"':''} required></label>`;
  box.innerHTML=`<summary>Build a playable side operation</summary><p class="pw-note">Owner review preview. Synthetic map, browser-only recipe and save. No publishing, live news fetch, LMS credit or real building reconstruction.</p>
    <form class="pw-form">
    ${field('place','Regional setting',geography?.place||name)}${field('lat','Latitude',geography?.lat??'','number')}${field('lon','Longitude',geography?.lon??'','number')}
    ${field('geoSource','Public geography source URL','','url')}
    <label class="pw-field"><span>Terrain</span><select name="terrain">${TERRAINS.map(t=>`<option>${t}</option>`).join('')}</select></label>
    <label class="pw-field"><span>Objective</span><select name="objective">${Object.entries(OBJECTIVES).map(([id,o])=>`<option value="${id}">${o.role} · ${o.title}</option>`).join('')}</select></label>
    ${field('seed','Layout seed',1,'number')}
    <label class="pw-field pw-span2"><span>Reviewed public news JSON (optional; blank means evergreen practice)</span><textarea name="source" rows="6" style="width:100%;min-width:0;box-sizing:border-box;font-size:16px" placeholder='{"kind":"reviewed-public-news","eventId":"...","url":"https://...","publisher":"...","publishedAt":"...","country":"${esc(country)}","theme":"comms","reviewId":"..."}'></textarea></label>
    <label class="pw-span2"><input name="reviewed" type="checkbox" required> I reviewed the regional coordinates and sources. All incidents and opponents are fictional; this is not a real site's layout.</label>
    <button type="submit" class="pw-btn pw-btn--go">Generate, validate & save</button>
    </form><p class="pw-status" role="status"></p><div class="pw-row" data-result></div>`;
  section.append(box);
  const form=box.querySelector('form'), status=box.querySelector('[role=status]'), result=box.querySelector('[data-result]');
  let lastReviewId=null, lastReviewedFields=null, lastRecipeId=null;
  try {
    const saved=JSON.parse(storage.getItem(KEY+country)||'null');
    if(saved) {
      for(const key of ['place','lat','lon','geoSource','terrain','objective','seed','source']) if(typeof saved[key]==='string') form.elements.namedItem(key).value=saved[key];
      lastReviewId=typeof saved.reviewId==='string'?saved.reviewId:null;
      lastReviewedFields=typeof saved.reviewedFields==='string'?saved.reviewedFields:null;
      lastRecipeId=typeof saved.recipeId==='string'?saved.recipeId:null;
    }
    // Review is deliberately not restored after edits/reload.
  } catch { status.textContent='The previous review form could not be restored. Existing mission saves are unchanged.'; }
  if(lastRecipeId) {
    try {
      if(storage.getItem(`prim3.level.${lastRecipeId}.v1`)!==null) {
        loadGeneratedRecipe(lastRecipeId,storage,Date.now(),{resume:true});
        const resume=document.createElement('a');resume.className='pw-btn';resume.textContent='Resume saved mission';
        resume.href=`prim3-transit.html?level=generated&recipe=${lastRecipeId}`;result.append(resume);
        status.textContent='An existing reviewed run is available. Resume keeps its original scenario and expiry.';
      } else status.textContent='The previous form was restored. Review its fields before generating again.';
    } catch { status.textContent='The prior run needs recovery. Its recipe and tactical save were kept unchanged.'; }
  }
  const fields=()=>Object.fromEntries(['place','lat','lon','geoSource','terrain','objective','seed','source'].map(key=>[key,form.elements.namedItem(key).value]));
  const saveForm=()=>{try{storage.setItem(KEY+country,JSON.stringify({...fields(),reviewId:lastReviewId,reviewedFields:lastReviewedFields,recipeId:lastRecipeId}));}catch{status.textContent='This form could not be saved in this browser.';}};
  form.addEventListener('input',event=>{
    result.replaceChildren();
    if(event.target.name!=='reviewed') form.elements.namedItem('reviewed').checked=false;
    saveForm();
  });
  form.addEventListener('submit',event=>{
    event.preventDefault(); result.replaceChildren();
    try {
      if(!form.reportValidity()||!form.elements.namedItem('reviewed').checked) return;
      const f=fields(), now=Date.now(), source=f.source.trim()?JSON.parse(f.source):null;
      if(!f.lat.trim()||!f.lon.trim()||!f.seed.trim()) throw new Error('Coordinates and seed are required.');
      const reviewedFields=JSON.stringify(f);
      const reviewId=lastReviewedFields===reviewedFields&&lastReviewId?lastReviewId:`owner-local-${now}`;
      const input={schema:SCHEMA,seed:Number(f.seed),objective:f.objective,
        geography:{country,place:f.place,lat:Number(f.lat),lon:Number(f.lon),terrain:f.terrain,sourceUrl:f.geoSource,reviewId},
        source,review:{fiction:true,geography:true,source:!!source}};
      const {level,href,resume}=saveGeneratedRecipe(input,storage,now);
      lastReviewId=reviewId;lastReviewedFields=reviewedFields;
      lastRecipeId=level.RECIPE.id;
      const link=document.createElement('a');link.className='pw-btn pw-btn--go';link.href=href;link.textContent=resume?'Resume saved mission':'Play reviewed mission';result.append(link);
      const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='pw-btn';exportButton.textContent='Export recipe';
      exportButton.addEventListener('click',()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(level.RECIPE.input,null,2)+'\n'],{type:'application/json'}));
        const a=document.createElement('a');a.href=url;a.download=level.RECIPE.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      });result.append(exportButton);
      status.textContent=`Saved ${level.RECIPE.title}. ${level.RECIPE.objectives.length} checkpoint(s), ${level.W} × ${level.H} rule tiles, ${f.terrain} layout. ${source?'News source retained; new starts expire at '+new Date(level.RECIPE.expiresAt).toISOString()+'.':'Evergreen practice; no news source claimed.'} Existing runs keep their own save.`;
      saveForm();
    } catch(error) {status.textContent=error.message;}
  });
  return box;
}
if(typeof document!=='undefined') onCountryCard((country,section,context)=>mountGenerator(country,section,context));
