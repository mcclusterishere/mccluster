/* Owner Finance is another mode of the existing World, not another viewer or backend. */
const root=document.documentElement,frame=document.getElementById('mnWorldFrame'),feed=document.getElementById('mnWorldFeed');
let panel=null,finance=null;
function stop(){finance?.destroy();finance=null;panel?.remove();panel=null;}
function sync(){
  const mode=window.MCC_WORLD_MODE?.get?.()||root.dataset.worldMode;
  let globe;try{globe=frame?.contentWindow?.HuGlobe;}catch{}
  if(mode!=='finance'||document.hidden||!globe?.owner?.()){stop();return;}
  frame.contentWindow.postMessage({type:'hu:finance-mode',on:true},location.origin);
  if(finance||!window.HaloFinance||!feed)return;
  panel=document.createElement('section');panel.id='worldFinance';panel.className='hm__finance wf-panel';panel.setAttribute('data-private','');panel.setAttribute('aria-label','Owner Finance');feed.append(panel);
  finance=window.HaloFinance.mount(panel,{...globe,financeAutoMap:true,cesium:()=>frame.contentWindow.Cesium});
}
window.addEventListener('mcc:world-mode',sync);
window.addEventListener('mcc:auth-changed',()=>{stop();sync();});
window.addEventListener('storage',e=>{if(!e.key||e.key==='mccdb_session')stop();});
document.addEventListener('visibilitychange',sync);
window.addEventListener('message',e=>{
  if(!frame||e.source!==frame.contentWindow||e.origin!==location.origin)return;
  if(e.data?.type==='hu:globe-ready'||e.data?.type==='hu:finance-access')sync();
  if(e.data?.type==='hu:finance-company'&&finance&&/^[A-Z][A-Z0-9.\-]{0,14}$/.test(e.data.symbol||'')&&/^[A-Z0-9]{4}$/.test(e.data.mic||''))finance.selectLeadership(e.data.symbol,e.data.mic);
});
window.addEventListener('pagehide',stop);sync();
