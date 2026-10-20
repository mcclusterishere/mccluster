/* Human Uprise World — approved fictional system-account discovery.
   This is an additive layer, NOT the canonical human presence or missions
   layer. All rows come from the McCluster Worker published-only projection.
   No draft identities are read, seeded or invented client-side.
*/
(function(root,factory) {
  const api = factory();
  if(typeof module === 'object' && module.exports)module.exports = api;
  else root.HuHouseAgents = api;
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';
  const API='https://api.mccluster.org/v1/house-agents/public';
  const validCode=v=>typeof v==='string'&&/^[A-Z]{2}$/.test(v);
  const validPoint=a=>Number.isFinite(a?.latitude)&&Number.isFinite(a?.longitude)&&
    Math.abs(a.latitude)<=90&&Math.abs(a.longitude)<=180&&
    !(a.latitude===0&&a.longitude===0);
  function normalize(input) {
    if(!Array.isArray(input))return [];
    const ids = new Set(), out=[];
    for(const a of input.slice(0,250)) {
      if(!a||a.actor_type!=='fictional_system_account'||a.verified_human!==false||
          typeof a.account_id!=='string'||!a.account_id||ids.has(a.account_id)||
          !validCode(a.story_country)||typeof a.display_name!=='string'||
          typeof a.disclosure!=='string')continue;
      ids.add(a.account_id);
      out.push({
        id:a.account_id,name:a.display_name.slice(0,120),handle:String(a.handle||'').slice(0,32),
        mission:String(a.editorial_mission||'').slice(0,2000),
        disclosure:a.disclosure.slice(0,360),
        country:a.story_country,
        region:typeof a.story_region==='string'?a.story_region:null,
        region_label:typeof a.region_label==='string'?a.region_label.slice(0,120):null,
        latitude:validPoint(a)?a.latitude:null,
        longitude:validPoint(a)?a.longitude:null
      });
    }
    return out;
  }
  function byCountry(actors) {
    const counts={};
    for(const a of actors||[])if(validCode(a.country))counts[a.country]=(counts[a.country]||0)+1;
    return counts;
  }
  function byRegion(actors) {
    const regions=new Map();
    for(const a of actors||[]) {
      // Only explicitly approved story association with a real region centroid.
      // Missing place information never becomes an approximate/random point.
      if(!a.region||!/^([A-Z]{2})-[A-Z0-9-]{1,12}$/.test(a.region)||
        !a.region_label||!validPoint(a)||a.region.slice(0,2)!==a.country)continue;
      if(!regions.has(a.region))regions.set(a.region,{
        region_key:a.region,region_label:a.region_label,country:a.country,
        longitude:a.longitude,latitude:a.latitude,accounts:[]
      });
      regions.get(a.region).accounts.push(a);
    }
    return [...regions.values()].sort((a,b)=>a.region_key.localeCompare(b.region_key));
  }
  function mount(viewer, opts={}) {
    if(!viewer||!viewer.entities||!window.Cesium)return null;
    let accounts=[], countries={}, regions=[], markers=[];
    const C=window.Cesium;
    const deck=document.documentElement.classList.contains('globe-surface-network')
      ? document.body : document.getElementById('deck');
    let panel=null;
    function hide() {if(panel)panel.hidden=true;}
    function ensurePanel(){
      if(panel||!deck)return panel;
      panel=document.createElement('section');panel.className='world-house-agents';panel.id='worldHouseAgents';
      panel.setAttribute('aria-label','Fictional character accounts');panel.setAttribute('role','region');panel.hidden=true;
      deck.appendChild(panel);
      return panel;
    }
    function show(title, group){
      const p=ensurePanel();
      if(!p)return;
      p.replaceChildren();
      const heading=document.createElement('div');heading.className='world-house-agents__heading';
      const label=document.createElement('strong');label.textContent=title;
      const close=document.createElement('button');close.type='button';close.textContent='×';
      close.setAttribute('aria-label','Close fictional accounts');close.onclick=hide;
      heading.append(label,close);
      const intro=document.createElement('p');intro.textContent=group.length+' fictional '+(group.length===1?'account':'accounts')+
        ' · AI-produced PRIM3 entertainment. Not verified local residents or mission participants.';
      const list=document.createElement('ul');
      for(const a of group){
        const li=document.createElement('li');
        const button=document.createElement('button');
        button.type='button';
        button.className='world-house-agents__actor';
        button.textContent=a.name+(a.handle?' · @'+a.handle:'');
        const bio=document.createElement('p');bio.className='world-house-agents__mission';bio.textContent=a.mission;
        const disclosure=document.createElement('small');disclosure.textContent=a.disclosure;
        bio.hidden=disclosure.hidden=true;
        button.setAttribute('aria-expanded','false');
        button.onclick=()=>{const open=bio.hidden;bio.hidden=disclosure.hidden=!open;button.setAttribute('aria-expanded',String(open))};
        li.append(button,bio,disclosure);list.appendChild(li);
      }
      p.append(heading,intro,list);p.hidden=false;
    }
    function draw(){
      for(const marker of markers)viewer.entities.remove(marker);
      markers=[];
      for(const group of regions){
        markers.push(viewer.entities.add({
          position:C.Cartesian3.fromDegrees(group.longitude,group.latitude,5000),
          point:{pixelSize:11,color:C.Color.fromCssColorString('#d6a6ff'),
            outlineWidth:2,outlineColor:C.Color.fromCssColorString('#1c1722')},
          label:{text:group.accounts.length+' fictional',
            font:'600 12px system-ui, sans-serif',
            fillColor:C.Color.fromCssColorString('#eee5f8'),
            outlineColor:C.Color.BLACK,outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset:new C.Cartesian2(0,-22),
            distanceDisplayCondition:new C.DistanceDisplayCondition(0,2200000)},
          properties:{houseAgentRegion:group.region_key}
        }));
      }
    }
    function click(picked){
      const key=picked?.id?.properties?.houseAgentRegion?.getValue?.();
      if(!key)return false;
      const found=regions.find(x=>x.region_key===key);
      if(!found)return false;
      show(found.region_label,found.accounts);
      if(opts.onSelect)opts.onSelect({
        region_key:found.region_key,region_label:found.region_label,
        fictional_accounts:found.accounts.length,
        accounts:found.accounts.map(a=>({handle:a.handle,name:a.name}))
      });
      return true;
    }
    const ready=fetch(API,{credentials:'omit',headers:{accept:'application/json'}})
      .then(res=>{if(!res.ok)throw new Error('published fictional accounts unavailable');return res.json()})
      .then(payload=>{
        accounts=normalize(payload?.accounts);
        countries=byCountry(accounts);
        regions=byRegion(accounts);
        draw();
        if(opts.onUpdate)opts.onUpdate({countries,regions:regions.length,accounts:accounts.length});
        return {accounts:accounts.length,regions:regions.length};
      })
      .catch(()=>({accounts:0,regions:0,unavailable:true}));
    return {
      ready, click, hide, countryCount:code=>countries[String(code||'').toUpperCase()]||0,
      showCountry:code=>{
        const c=String(code||'').toUpperCase();const selected=accounts.filter(a=>a.country===c);
        if(selected.length)show('PRIM3 characters · '+c,selected);else hide();
      }
    };
  }
  return Object.freeze({normalize,byCountry,byRegion,mount});
});
