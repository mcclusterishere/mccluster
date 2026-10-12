(function(){
'use strict';
var host=document.getElementById('artistIntelligence');
if(!host)return;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var days=30, sort='starts', rows=[];
function render(){
  var items=rows.slice().sort(function(a,b){return (b[sort]||0)-(a[sort]||0);});
  host.innerHTML='<div class="row"><label>Period <select id="artistDays"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label><label>Rank by <select id="artistSort"><option value="starts">Track starts</option><option value="completions">Completions</option><option value="shares">Shares</option><option value="identified_listeners">Identified listeners</option></select></label></div>'+
    '<div class="bd-scroll"><table><thead><tr><th>Creator track ID</th><th>Starts</th><th>Completions</th><th>Shares</th><th>Signed-in listeners</th></tr></thead><tbody>'+
    items.map(function(t){return '<tr><td><code>'+esc(t.track_id)+'</code></td><td>'+t.starts+'</td><td>'+t.completions+'</td><td>'+t.shares+'</td><td>'+t.identified_listeners+'</td></tr>';}).join('')+'</tbody></table></div>'+
    (!items.length?'<p class="bd-sub">No attributed creator-track events found in this period.</p>':'')+
    '<p class="bd-sub">Event-backed track rankings; album/artist rollups need verified creator ownership. Signed-in listener counts exclude anonymous listeners.</p>';
  document.getElementById('artistDays').value=String(days);
  document.getElementById('artistSort').value=sort;
  document.getElementById('artistDays').onchange=function(e){days=Number(e.target.value);load();};
  document.getElementById('artistSort').onchange=function(e){sort=e.target.value;render();};
}
async function load(){
  host.textContent='Loading owner-only music rankings…';
  try{
    var supa=window.MCC_SUPA;
    var token=supa&&supa.token?await supa.token():null;
    if(!token)throw Error('Owner sign-in required');
    var response=await fetch('https://api.mccluster.org/v1/analytics/artist-rankings?days='+days,{
      headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit'});
    var body=await response.json();
    if(!response.ok||!body.ok)throw Error(body.error||'Analytics unavailable');
    rows=Array.isArray(body.rankings)?body.rankings:[];
    render();
    if(body.sample_limited)host.insertAdjacentHTML('beforeend','<p class="bd-sub">Results are based on the latest 10,000 recorded events and may undercount activity.</p>');
  }catch(e){host.textContent='Artist intelligence unavailable: '+e.message;}
}
load();
})();
