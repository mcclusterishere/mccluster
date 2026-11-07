/* Owner-review Policy mode on the consumer World; no evidence/storage integration. */
(function(w,d){
  'use strict';
  if(new URLSearchParams(w.location.search).get('policy')!=='1')return;
  const root=d.documentElement,host=d.getElementById('mnFeedView');
  if(!host||!w.MCC_POLICY_CORE)return;
  const panel=d.createElement('section');panel.className='policy-mode';panel.id='policyMode';
  const heading=d.createElement('h2');heading.textContent='Policy';panel.append(heading);
  const actions=d.createElement('nav');actions.setAttribute('aria-label','Policy actions');
  const buttons={};
  for(const [id,label] of [['live','Go Live'],['globe','Globe'],['feed','Feed']]){
    const b=d.createElement('button');b.type='button';b.disabled=true;b.textContent=label;b.dataset.policyAction=id;if(id!=='live')b.setAttribute('aria-controls',id==='globe'?'mnWorld':'mnWorldFeed');buttons[id]=b;actions.append(b);
  }
  panel.append(actions);
  const status=d.createElement('p');status.setAttribute('role','status');panel.append(status);
  const back=d.createElement('a');const url=new URL(w.location.href);url.searchParams.delete('policy');back.href=url.href;back.textContent='Return to World';panel.append(back);
  host.prepend(panel);
  function enforceFeed(){if(root.classList.contains('policy-active')&&w.MCC_WORLD_MODE?.get()!=='posts')w.MCC_WORLD_MODE?.set('posts');}
  const control=w.MCC_POLICY_CORE.create({
    verifyOwner:async()=>!!(await w.MCC_BAR?.verifyAdmin())&&!!w.MCC_BAR?.admin(),
    show:view=>{
      w.MCC_MNET?.setView('feed');
      root.dataset.policyView=view;enforceFeed();
      w.dispatchEvent(new Event('resize'));
    },
    studio:async canOpen=>{
      if(!w.MCC_LIVE?.studio)return {opened:false,message:'Live tools are still loading. Try again.'};
      return w.MCC_LIVE.studio(canOpen);
    },
    paint:s=>{
      root.classList.toggle('policy-active',s.active);
      if(!s.active)delete root.dataset.policyView;
      status.textContent=s.message;
      for(const [key,b] of Object.entries(buttons)){b.disabled=!s.active||s.busy;if(key!=='live')b.setAttribute('aria-pressed',String(key===s.view));}
      if(s.active)enforceFeed();
    }
  });
  buttons.globe.onclick=()=>control.select('globe');buttons.feed.onclick=()=>control.select('feed');buttons.live.onclick=()=>control.live();
  w.addEventListener('mcc:appbar-admin',()=>{if(w.MCC_BAR?.admin())control.activate();else control.revoke();});
  w.addEventListener('mcc:world-mode',enforceFeed);
  d.addEventListener('visibilitychange',()=>{if(!d.hidden)control.activate();});
  control.activate();
})(window,document);
