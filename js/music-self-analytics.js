/* Shared self-service analytics view; authorization is enforced by Worker. */
(function(){
'use strict';
const host=document.getElementById('selfMusicAnalytics');
if(!host)return;
const creator=host.dataset.mode==='creator';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const heading=creator?'Artist analytics':'My listening';
const btn=document.getElementById('selfMusicRefresh');
async function run(){
 host.textContent='Loading '+heading.toLowerCase()+'…';
 try{
  const session=await window.MCC?.refreshIfNeeded?.();
  if(!session?.access_token){host.textContent='Sign in to see your own activity.';return;}
  const res=await fetch('https://api.mccluster.org/v1/analytics/'+(creator?'my-creator':'my-listening'),{
    headers:{Authorization:'Bearer '+session.access_token}});
  const data=await res.json();
  if(!res.ok||data.ok===false)throw Error(data.error||'Analytics unavailable');
  if(creator&&!data.creator){host.textContent='Create your artist profile to see catalog analytics.';return;}
  const metrics=creator?[
   ['Page views',data.page_traffic?.views||0],
   ['Approx. visits',data.page_traffic?.approximate_sessions||0],
   ['Tracks',data.tracks?.length||0],
   ['Observed plays',(data.tracks||[]).reduce((n,t)=>n+t.plays,0)],
   ['Completions',(data.tracks||[]).reduce((n,t)=>n+t.completions,0)],
   ['Shares',(data.tracks||[]).reduce((n,t)=>n+t.shares,0)]
  ]:[['Song starts',data.counts?.song_start||0],['Full plays',data.counts?.music_full_play||0],
   ['Completions',data.counts?.music_complete||0],['Shares',data.counts?.track_share||0]];
  host.innerHTML='<p style="opacity:.8">Last 30 days · Recorded first-party activity</p>'+
   '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">'+
   metrics.map(([label,n])=>'<div style="padding:16px;border:1px solid #555;border-radius:12px"><strong style="font-size:1.6rem">'+esc(n)+'</strong><div>'+esc(label)+'</div></div>').join('')+'</div>'+
   (creator?'<h3>Traffic sources</h3>'+Object.entries(data.page_traffic?.sources||{}).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([source,n])=>'<p>'+esc(source)+' · '+esc(n)+' views</p>').join('')+'<h3>Your releases</h3>'+(data.tracks||[]).map(t=>'<p>'+esc(t.title)+' · '+esc(t.status)+' · '+esc(t.plays)+' observed plays</p>').join(''):'<h3>Your recent listening</h3>'+(data.activity||[]).map(e=>'<p>'+esc(e.at)+' · '+esc(e.track||e.name)+'</p>').join(''))+
   '<p style="opacity:.7;font-size:.8rem">Only recorded events are counted. Missing tracking and sampling can undercount activity. Personal listening history is private.</p>';
 }catch(e){host.textContent='Analytics unavailable: '+e.message;}
}
btn?.addEventListener('click',run);
run();
})();