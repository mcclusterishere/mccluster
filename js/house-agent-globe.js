/* House-agent story geography on the EXISTING Human Uprise World.
   A fictional system account is not a human, a live position, or a verified
   mission participant. Private house drafts never appear on this layer.
   These pins cluster published fictional characters by approved STORY region,
   leaving location-unknown characters in country-level discovery only. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.HuHouseAgents=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const ENDPOINT='https://api.mccluster.org/v1/house-agents/public';
  const COUNTRY=/^[A-Z]{2}$/;
  const REGION=/^[A-Z]{2}-[A-Z0-9-]{1,10}$/;
  const within=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  function normalize(rows){
    if(!Array.isArray(rows))return [];
    const seen=new Set();
    return rows.filter(a=>{
      if(!a||a.actor_type!=='fictional_system_account'||a.verified_human!==false)return false;
      if(typeof a.account_id!=='string'||!a.account_id||seen.has(a.account_id))return false;
      if(typeof a.handle!=='string'||!a.handle||typeof a.disclosure!=='string'||!a.disclosure)return false;
      if(!COUNTRY.test(String(a.story_country||'')))return false;
      seen.add(a.account_id);
      return true;
    }).slice(0,250);
  }
  function fictionalCountryCounts(accounts){
    const counts={};
    for(const a of normalize(accounts))counts[a.story_country]=(counts[a.story_country]||0)+1;
    return counts;
  }
  function fictionalRegions(accounts){
    const groups=new Map();
    for(const a of normalize(accounts)){
      const region=String(a.story_region||'');
      if(!REGION.test(region)||!region.startsWith(a.story_country+'-')||
         !within(a.latitude,-90,90)||!within(a.longitude,-180,180))continue;
      if(!groups.has(region))groups.set(region,{
        region_key:region,region_label:a.region_label||region,country_code:a.story_country,
        latitude:a.latitude,longitude:a.longitude,accounts:[]
      });
      // A server-approved centroid identifies a *story setting*, never residency.
      groups.get(region).accounts.push(a);
    }
    return [...groups.values()].sort((a,b)=>a.region_key.localeCompare(b.region_key));
  }
  function mount(viewer,opts){
    const C=window.Cesium,o=opts||{},pins=[];
    let accounts=[],groups=[],enabled=true;
    const host=document.querySelector('.globe-data')||document.querySelector('.world-tools');
    const button=document.createElement('button');
    button.type='button';button.id='houseAgentLayer';button.className='globe-ctl globe-ctl--house';
    button.textContent='Characters';button.hidden=true;button.setAttribute('aria-pressed','true');
    button.setAttribute('aria-label','Hide fictional PRIM3 character locations');
    if(host)host.appendChild(button);
    const sheet=document.createElement('section');
    sheet.id='houseActorSheet';sheet.className='house-actor-sheet';sheet.hidden=true;
    sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','false');
    sheet.setAttribute('aria-label','Fictional PRIM3 characters');
    const title=document.createElement('h2'),subtitle=document.createElement('p'),list=document.createElement('div');
    title.className='house-actor-title';subtitle.className='house-actor-subtitle';list.className='house-actor-list';
    const close=document.createElement('button');
    close.type='button';close.textContent='Close';close.setAttribute('aria-label','Close fictional characters');
    close.className='house-actor-close';close.onclick=()=>{sheet.hidden=true};
    sheet.append(close,title,subtitle,list);document.body.appendChild(sheet);
    function draw(){
      for(const p of pins)viewer.entities.remove(p);
      pins.length=0;
      if(!enabled)return;
      for(const g of groups){
        const pos=C.Cartesian3.fromDegrees(g.longitude,g.latitude,6000);
        pins.push(viewer.entities.add({
          position:pos,
          point:{pixelSize:15,color:C.Color.fromCssColorString('#d8c4d0'),
            outlineColor:C.Color.fromCssColorString('#272127'),outlineWidth:3,
            heightReference:C.HeightReference.RELATIVE_TO_GROUND},
          label:{text:String(g.accounts.length)+' FICTIONAL',font:'600 11px system-ui,sans-serif',
            fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:3,
            style:C.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new C.Cartesian2(0,-25),
            distanceDisplayCondition:new C.DistanceDisplayCondition(0,3100000)},
          properties:{houseRegionKey:g.region_key}
        }));
      }
    }
    function details(group){
      if(!group)return;
      title.textContent=group.region_label||group.region_key;
      subtitle.textContent=group.accounts.length+
        (group.accounts.length===1?' fictional AI account':' fictional AI accounts')+
        ' · Story region only, not a verified real-world location or human membership.';
      list.replaceChildren();
      for(const a of group.accounts){
        const article=document.createElement('article');
        const head=document.createElement('h3'),bio=document.createElement('p'),note=document.createElement('small');
        head.textContent=a.display_name||a.handle;
        bio.textContent=a.editorial_mission||'Character story to be developed.';
        note.textContent=a.disclosure;
        article.append(head,bio,note);list.appendChild(article);
      }
      sheet.hidden=false;
    }
    button.onclick=()=>{
      enabled=!enabled;button.setAttribute('aria-pressed',String(enabled));
      button.setAttribute('aria-label',enabled?'Hide fictional PRIM3 character locations':'Show fictional PRIM3 character locations');
      if(!enabled)sheet.hidden=true;
      draw();
    };
    async function load(){
      try{
        const response=await fetch(ENDPOINT,{credentials:'omit',mode:'cors'});
        if(!response.ok) return;
        const body=await response.json();
        accounts=normalize(body.accounts);
        groups=fictionalRegions(accounts);
        button.hidden=!groups.length;
        draw();
        if(o.onCounts)o.onCounts(fictionalCountryCounts(accounts));
      }catch(_){
        // Pending database migrations / unavailable provider must never break
        // travel, missions, the primary globe, or public member data.
      }
    }
    function handlePick(pick){
      const key=pick?.id?.properties?.houseRegionKey?.getValue?.();
      const g=groups.find(x=>x.region_key===key);
      if(!g)return false;
      details(g);
      return true;
    }
    function getAccounts(){return accounts.slice()}
    return {load,handlePick,getAccounts,countryCounts:()=>fictionalCountryCounts(accounts),regions:()=>groups.slice()};
  }
  return Object.freeze({normalize,fictionalCountryCounts,fictionalRegions,mount});
});
