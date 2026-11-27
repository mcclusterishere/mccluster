// Editorial evidence only. Library stops are not shipment or device records.
export const evidence = [
  {
    "id": "cobalt-mine",
    "material": "Cobalt",
    "stage": "Extraction",
    "impact": "Power & trade",
    "place": "DR Congo",
    "lat": -2.88,
    "lon": 23.65,
    "date": "2025",
    "dateLabel": "2025 production estimate",
    "title": "Where mined cobalt comes from",
    "claim": "USGS estimates that the DR Congo accounted for about 73% of global cobalt mine output in 2025. This describes a market, not the origin of any phone.",
    "source": "https://pubs.usgs.gov/periodicals/mcs2026/mcs2026.pdf",
    "sourceTitle": "USGS: Mineral Commodity Summaries 2026",
    "certainty": "Industry example"
  },
  {
    "id": "cobalt-workers",
    "material": "Cobalt",
    "stage": "Extraction",
    "impact": "People",
    "place": "DR Congo",
    "lat": -2.88,
    "lon": 23.65,
    "date": "2024",
    "dateLabel": "2024 reporting year",
    "title": "What a labor finding can tell us",
    "claim": "The U.S. Department of Labor reports child labor in mining activities that include cobalt ore. This national finding does not identify the supplier of a given phone or describe every mine.",
    "source": "https://www.dol.gov/agencies/ilab/resources/reports/child-labor/congo-democratic-republic-drc",
    "sourceTitle": "U.S. Department of Labor: 2024 findings",
    "certainty": "Reported country-level finding"
  },
  {
    "id": "cobalt-policy",
    "material": "Cobalt",
    "stage": "Trade",
    "impact": "Power & trade",
    "place": "DR Congo",
    "lat": -2.88,
    "lon": 23.65,
    "date": "2025-10",
    "dateLabel": "October 2025",
    "title": "An export restriction changes",
    "claim": "USGS reports that the DR Congo replaced a temporary cobalt export ban with quotas in October 2025. This is a dated policy report, not a live statement of the rules today.",
    "source": "https://pubs.usgs.gov/periodicals/mcs2026/mcs2026.pdf",
    "sourceTitle": "USGS: Mineral Commodity Summaries 2026",
    "certainty": "Dated policy report"
  },
  {
    "id": "cobalt-refine",
    "material": "Cobalt",
    "stage": "Processing",
    "impact": "Power & trade",
    "place": "China",
    "lat": 35.86,
    "lon": 104.19,
    "date": "2025",
    "dateLabel": "2025 market estimate",
    "title": "Refining is a separate step",
    "claim": "USGS identifies China as the leading producer of refined cobalt. These country markers are not evidence of a shipment between them.",
    "source": "https://pubs.usgs.gov/periodicals/mcs2026/mcs2026.pdf",
    "sourceTitle": "USGS: Mineral Commodity Summaries 2026",
    "certainty": "Industry example"
  },
  {
    "id": "cobalt-product",
    "material": "Cobalt",
    "stage": "Device",
    "impact": "Environment",
    "place": null,
    "lat": null,
    "lon": null,
    "date": "2025-09",
    "dateLabel": "September 2025 product disclosure",
    "title": "A product disclosure changes the story",
    "claim": "Apple reports 100% recycled cobalt in the iPhone 17 battery. That is a model-level manufacturer claim, not a record of an individual device, battery replacement, refinery, or mine.",
    "source": "https://www.apple.com/iphone-17/specs/",
    "sourceTitle": "Apple: iPhone 17 specifications",
    "certainty": "Manufacturer model disclosure"
  },
  {
    "id": "lithium-mine",
    "material": "Lithium",
    "stage": "Extraction",
    "impact": "Power & trade",
    "place": "Australia",
    "lat": -25.27,
    "lon": 133.78,
    "date": "2025",
    "dateLabel": "2025 production estimate",
    "title": "Australia is a major lithium producer",
    "claim": "USGS lists Australia among the leading lithium mining countries in 2025. This is a country-level reference point, not a specific mine or a phone's origin.",
    "source": "https://pubs.usgs.gov/periodicals/mcs2026/mcs2026.pdf",
    "sourceTitle": "USGS: Mineral Commodity Summaries 2026",
    "certainty": "Industry example"
  },
  {
    "id": "lithium-refine",
    "material": "Lithium",
    "stage": "Processing",
    "impact": "Power & trade",
    "place": "China",
    "lat": 35.86,
    "lon": 104.19,
    "date": "2025",
    "dateLabel": "2025 data, 2026 outlook",
    "title": "Processing is concentrated",
    "claim": "The IEA identifies China as the leading lithium refiner. Mining output and refining capacity answer different questions; a map cannot join them into a documented shipment without further evidence.",
    "source": "https://www.iea.org/reports/global-critical-minerals-outlook-2026/executive-summary",
    "sourceTitle": "IEA: Global Critical Minerals Outlook 2026",
    "certainty": "Industry example"
  },
  {
    "id": "lithium-product",
    "material": "Lithium",
    "stage": "Device",
    "impact": "Environment",
    "place": null,
    "lat": null,
    "lon": null,
    "date": "2025-09",
    "dateLabel": "September 2025 product disclosure",
    "title": "A battery material can have previous lives",
    "claim": "Apple reports 95% recycled lithium in the iPhone 17 battery. This model-level disclosure does not locate the material's prior use, recycling plant, or the origin of your particular unit.",
    "source": "https://www.apple.com/iphone-17/specs/",
    "sourceTitle": "Apple: iPhone 17 specifications",
    "certainty": "Manufacturer model disclosure"
  }
];
export const actionChoices = [
  {
    "id": "repair",
    "title": "Check repair options",
    "copy": "Compare an authorized or independent repair quote before replacing a working phone.",
    "url": "https://www.ifixit.com/Device/Phone"
  },
  {
    "id": "reuse",
    "title": "Pass on a working phone",
    "copy": "Back up your data, follow your manufacturer’s reset instructions, and confirm the recipient accepts the device.",
    "url": "https://www.epa.gov/recycle/electronics-donation-and-recycling"
  },
  {
    "id": "recycle",
    "title": "Find electronics take-back",
    "copy": "Use a program that accepts devices with lithium-ion batteries. Keep the phone out of household trash and recycling bins.",
    "url": "https://www.epa.gov/recycle/used-lithium-ion-batteries"
  }
];
export const lenses = ['All', 'Environment', 'People', 'Power & trade'];
export const materials = ['Cobalt', 'Lithium'];
export function selectEvidence(material, lens, view) {
  const items = evidence.filter(x => (material === 'All' || x.material === material) && (lens === 'All' || x.impact === lens));
  if (view === 'Timeline') {
    // Year-only sources are grouped under the year without inventing a day.
    return items.sort((a,b) => b.date.split('-')[0].localeCompare(a.date.split('-')[0]) || Number(b.date.length > 4) - Number(a.date.length > 4) || b.date.localeCompare(a.date));
  }
  return items;
}
export function focusPayload(record) {
  return Number.isFinite(record?.lat) && Number.isFinite(record?.lon)
    ? {type:'hu:focus-place',lat:record.lat,lon:record.lon,label:record.place+' · country reference'} : null;
}
export function mountTrace(doc, w) {
  const host=doc.getElementById('traceTech'), frame=doc.getElementById('mnWorldFrame');
  if(!host || host.dataset.mounted) return;
  host.dataset.mounted='true';
  const make=(tag,label)=>{const el=doc.createElement(tag); if(label) el.textContent=label; return el;};
  const wrap=(label,input)=>{const row=make('label');row.append(make('span',label),input);return row;};
  const select=(values)=>{const node=make('select');values.forEach(v=>{const o=make('option',v);o.value=v;node.append(o);});return node;};
  const link=(url,title)=>{const node=make('a',title);node.href=url;node.target='_blank';node.rel='noopener noreferrer';return node;};
  const button=(label,fn)=>{const node=make('button',label);node.type='button';node.addEventListener('click',fn);return node;};
  const card=make('div'), intro=make('p','Pick a battery material. Follow the evidence around the globe, then choose what to do with a phone you already own.');
  const start=button('Start the trace',()=>{card.hidden=false;start.hidden=true; material.focus();});
  const material=select(['All',...materials]), lens=select(lenses), view=select(['Stories','Timeline','Materials','Sources']);
  const controls=make('div'); controls.className='trace-tech-controls';controls.append(wrap('Material',material),wrap('Impact',lens),wrap('View',view));
  const status=make('p');status.setAttribute('role','status');
  const items=make('div'), choice=select(['Choose an action',...actionChoices.map(x=>x.title)]), step=make('p'), feedback=make('p');
  feedback.setAttribute('role','status');
  const visited=new Set();
  const selectStop=(r)=>{
    const payload=focusPayload(r);
    if(!payload||!frame?.contentWindow)return;
    frame.contentWindow.postMessage(payload,w.location.origin);
    frame.scrollIntoView({block:'nearest'});
  };
  const render=()=>{
    items.replaceChildren(); const mode=view.value;
    if(mode==='Materials'){
      materials.filter(x=>material.value==='All'||x===material.value).forEach(name=>{
        const h=make('h3',name), p=make('p',name==='Cobalt'?'Used in some rechargeable battery cathodes; not every battery chemistry uses it.':'Used in lithium-ion cells. A product-level recycled-content figure does not identify the origin of individual material.');
        const go=button('See '+name+' stories',()=>{material.value=name;lens.value='All';view.value='Stories';render();items.querySelector('button')?.focus();});
        items.append(h,p,go);
      }); return;
    }
    const records=selectEvidence(material.value,lens.value,mode);
    if(mode==='Sources'){
      const list=make('ul');
      Array.from(new Map(records.map(r=>[r.source,r.sourceTitle]))).forEach(([u,title])=>{const li=make('li');li.append(link(u,title));list.append(li);});
      if(!records.length) items.append(make('p','No sources for this filter combination.'));
      items.append(list);return;
    }
    if(!records.length)items.append(make('p','No sourced stories for these filters yet.'));
    for(const r of records){
      const article=make('article'), meta=make('p',[r.stage,r.place,r.dateLabel,r.impact].filter(Boolean).join(' · '));
      const detail=make('details'), summary=make('summary',r.title);
      detail.append(summary,make('p',r.claim),make('p',r.certainty),link(r.source,r.sourceTitle));
      detail.addEventListener('toggle',()=>{if(!detail.open)return;visited.add(r.id);status.textContent=visited.size+' evidence cards opened in this visit.';});
      if(focusPayload(r)&&frame)detail.append(button('Show '+r.place+' on the globe',()=>selectStop(r)));
      article.append(meta,detail);items.append(article);
    }
  };
  [material,lens,view].forEach(el=>el.addEventListener('change',render));
  let selection;
  choice.addEventListener('change',()=>{selection=actionChoices.find(x=>x.title===choice.value);step.replaceChildren();feedback.textContent='';if(selection)step.append(doc.createTextNode(selection.copy+' '),link(selection.url,'Open the guide'));});
  const plan=button('Mark my next step',()=>{feedback.textContent=selection?'Next step selected for this visit: '+selection.title+'. This does not report that you completed the action.':'Choose an action first.';});
  const scope=()=>{host.hidden=!(w.MCC_WORLD_MODE?.get?.()==='posts'&&w.MCC_FEED_SCOPE?.get?.()==='equity');};
  card.hidden=true;
  card.append(make('p','These are sourced examples and disclosures, not verified provenance for your phone. This briefing is a dated snapshot, not a live feed.'),controls,items,status,make('h3','Take a next step'),wrap('Choose an action',choice),step,plan,feedback);
  const h=make('h2','Trace Your Tech'); h.id='traceTechTitle';
  host.append(make('p','FIELD MISSION PREVIEW'),h,intro,start,card);
  for(const t of ['mcc:feed-scope','mcc:world-mode'])w.addEventListener(t,scope);
  w.addEventListener('DOMContentLoaded',scope,{once:true});scope();render();
}
if(typeof window!=='undefined') mountTrace(document,window);
