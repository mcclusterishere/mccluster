/* Member-owned front pages. One M Account; existing Mnet identity, not a clone.
   Never infer driver approval from a driver's self-edited profile or ride status. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const handleRE=/^[a-z0-9][a-z0-9._-]{2,39}$/;
const query=new URLSearchParams(location.search);
const requested=String(query.get('handle')||'').trim().toLowerCase();
const form=$('mfEditForm'),editor=$('mfEditor');
let self=null,identity=null,record=null,handle=requested;
function message(text){$('mfStatus').textContent=text||'';}
function safeImage(value){
  try{const u=new URL(String(value||''));return u.protocol==='https:'&&u.username===''&&u.password===''&&u.href.length<=2000?u.href:'';}catch{return'';}
}
function safeLink(value){
  try{const u=new URL(String(value||''));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.href.length<=2000?u.href:'';}catch{return'';}
}
const api=async(path,init)=>{
  if(!window.MCC?.api)throw Error('Sign in with your M Account to view this page.');
  const response=await window.MCC.api(path,init);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||data.message||'This profile is unavailable.');
  return data;
};
function portrait(node,url,fallback){
  const src=safeImage(url);
  node.style.backgroundImage=src?'url('+JSON.stringify(src)+')':'';
  node.textContent=src?'':String(fallback||'M').trim().slice(0,1).toUpperCase();
}
function fillEditor(p){
  for(const key of ['display_name','headline','bio','avatar_url','banner_url','website_url']){
    const field=form.elements.namedItem(key);
    if(field)field.value=String(p[key]||'');
  }
  $('mfEditStatus').textContent='';
}
function render(data){
  record=data;const p=data.profile||{},id=data.identity||{},counts=data.counts||{};
  identity=id;
  const name=String(p.display_name||id.mccluster_id||'Member'),personId=String(id.mccluster_id||handle).toLowerCase();
  handle=personId;
  document.title=name+' · McCluster front page';
  $('mfName').textContent=name;$('mfHandle').textContent='@'+personId;
  $('mfHeadline').textContent=String(p.headline||'');
  $('mfBio').textContent=String(p.bio||'');
  portrait($('mfAvatar'),p.avatar_url,name);
  const cover=safeImage(p.banner_url);
  $('mfCover').style.backgroundImage=cover?'url('+JSON.stringify(cover)+')':'';
  const site=safeLink(p.website_url);
  $('mfSite').hidden=!site;
  if(site)$('mfSite').href=site;
  $('mfCounts').hidden=false;
  $('mfCounts').replaceChildren();
  for(const [value,label] of [[counts.posts,'posts'],[counts.followers,'followers'],[counts.following,'following']]){
    const item=document.createElement('span'),bold=document.createElement('strong');
    bold.textContent=String(Math.max(0,Number(value)||0));item.append(bold,document.createTextNode(label));$('mfCounts').append(item);
  }
  $('mfNetwork').href='mnet.html?profile='+encodeURIComponent(personId);
  const mine=!!self&&personId===String(self.identity?.mccluster_id||'').toLowerCase();
  $('mfCustomize').hidden=!mine;
  $('mfOwnerPanel').hidden=!mine;
  $('mfDriverPanel').hidden=true;
  $('mfWhip').hidden=true;
  // The bar owns the selected profile while signed in. Someone else's public
  // records may be displayed, but nothing on this page changes their data.
  if(window.MCC_BAR?.perspective)window.MCC_BAR.perspective({
    kind:'member',handle:personId,name,avatar:safeImage(p.avatar_url)
  });
  if(mine)void driverWorkspace();
}
async function driverWorkspace(){
  try{
    const data=await api('/api/drivers/me');
    const driver=data.driver;
    if(!driver)return;
    $('mfDriverPanel').hidden=false;$('mfWhip').hidden=false;
    const approved=driver.approval_status==='approved'&&driver.compliance_verified===true;
    $('mfDriverStatus').textContent=approved
      ? 'Driver approval verified by Whip Equipped LLC. Review your operating status and available requests in the driver app.'
      : 'Driver application received. Operator approval, licensing, insurance and screening are still required. You cannot accept trips yet.';
  }catch{/* Whip is independent; failure never blocks a member-owned page. */}
}
async function start(){
  if(!window.MCC?.session?.()?.access_token){
    $('mfName').textContent='Make this space yours.';
    message('Sign in with an M Account to view public member profiles and create your own page.');
    $('mfNetwork').textContent='Sign in ↗';$('mfNetwork').href='account.html';
    return;
  }
  try{
    self=await api('/v1/mnet/bootstrap?app_key=mccluster-web');
    if(!handle)handle=String(self.identity?.mccluster_id||'').toLowerCase();
    if(!handleRE.test(handle))throw Error('Finish choosing your M Account handle in your profile.');
    const data=await api('/v1/mnet/people/'+encodeURIComponent(handle));
    render(data);message('');
  }catch(error){
    $('mfName').textContent='Profile unavailable.';
    message(error?.message||'Could not load this member.');
    $('mfNetwork').href='mnet.html?view=profile';
  }
}
$('mfCustomize').onclick=()=>{if(record&&self&&identity?.mccluster_id===self.identity?.mccluster_id){fillEditor(record.profile||{});editor.showModal();}};
$('mfCancel').onclick=()=>editor.close();
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!self||!record||identity?.mccluster_id!==self.identity?.mccluster_id)return;
  const data={};
  for(const key of ['display_name','headline','bio','avatar_url','banner_url','website_url']){
    data[key]=String(form.elements.namedItem(key)?.value||'').trim();
  }
  if(!data.display_name){$('mfEditStatus').textContent='Display name is required.';return;}
  for(const key of ['avatar_url','banner_url'])if(data[key]&&!safeImage(data[key])){
    $('mfEditStatus').textContent='Use a valid HTTPS image URL for '+key+'.';return;
  }
  if(data.website_url&&!safeLink(data.website_url)){$('mfEditStatus').textContent='Enter a valid website URL.';return;}
  const save=form.querySelector('button[type=submit]');save.disabled=true;
  $('mfEditStatus').textContent='Saving through your M Account…';
  try{
    await api('/v1/mnet/profile?app_key=mccluster-web',{method:'PATCH',body:data});
    const fresh=await api('/v1/mnet/people/'+encodeURIComponent(handle));
    render(fresh);editor.close();message('Your public page was updated.');
  }catch(error){$('mfEditStatus').textContent=error.message||'Save failed. Your original profile is unchanged.';}
  finally{save.disabled=false;}
});
window.addEventListener('mcc:auth-changed',()=>{location.reload();});
start();
})();
