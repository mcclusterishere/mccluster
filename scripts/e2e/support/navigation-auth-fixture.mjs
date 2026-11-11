/* Playwright runs init scripts in every frame. Seed only the page under test:
   a same-origin child must not rewrite shared auth and fire a storage event in
   its parent. That event correctly fences the customer's private workspace. */
export function seedNavigationAuth({signed, USER}) {
  if (window !== window.top) return;
  window.__navFrames=[];
  const sample=()=>{
    const bar=document.querySelector('.appbar');
    if(bar){const style=getComputedStyle(bar);if(style.visibility==='visible'&&style.display!=='none')window.__navFrames.push(bar.querySelectorAll('[data-appnav]').length);}
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
  if(signed){
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({sub:USER,exp,email:'qa@fixture.invalid'}))+'.y',expires_at:exp,refresh_token:'fixture-only',user:{id:USER,email:'qa@fixture.invalid'}}));
  }
}
