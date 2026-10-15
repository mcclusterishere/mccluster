(function(){'use strict';
const SB='https://zmnhbrjyhxzhkxmhkexs.supabase.co',KEY='sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
const $=id=>document.getElementById(id);const embedded=new URLSearchParams(location.search).has('embedded');if(embedded){document.documentElement.classList.add('globe-embedded');/* inside another page the host owns navigation: no second bar or auth chip (tabbar.js honours data-no-appbar) */document.body.setAttribute('data-no-appbar','')}
/* THE FULL WORLD (owner, 2026-10-15: "if they click the world, it'll allow them to see that in a full pane … without the whole 30, 40 rule"):
   ?explore=1 is this page on its own, the Earth edge to edge (css: .globe-explore). The World's chrome stays home; what floats is the
   way back, the controls, the data toggles, the credit, and the mission in a sheet above the bar. */
const EXPLORE=!embedded&&new URLSearchParams(location.search).has('explore');if(EXPLORE)document.documentElement.classList.add('globe-explore');
/* Network surface: the globe inside the Human Uprise World tab. The parent page owns the feed and the mission context,
   so this frame shows only the Earth and talks to its same-origin parent. Messages carry public mission fields only. */
const parentFrame=embedded&&window.parent!==window?window.parent:null;if(parentFrame&&new URLSearchParams(location.search).get('surface')==='network')document.documentElement.classList.add('globe-surface-network');
/* the network band is short, so its Earth starts closer and fills the frame */
function homeAltitude(){return document.documentElement.classList.contains('globe-surface-network')||EXPLORE?12500000:19000000}
let readyMessage=null;function tell(msg){if(EXPLORE)exploreTell(msg);if(!parentFrame)return;try{parentFrame.postMessage(msg,location.origin)}catch(e){}}
/* on the full pane there is no parent to tell, so the layer line and a guest's lock are painted here, in the World's own words
   (js/mnet.js paintLayerLine). The Vaunt lead is the owner's referral, the same one the World shows. */
const VAUNT_LEAD='https://vauntapi.flyvaunt.com/referral/nuao1K';const exploreLayers={};
function escHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtCount(n){n=Number(n)||0;try{return n.toLocaleString('en-US')}catch(e){return String(n)}}
function exploreTell(d){const box=$('exploreLine');if(!box||!d)return;
 if(d.type==='hu:ask-sign-in'){box.innerHTML='<span>Sign in to see satellites and space missions on the Earth.</span> <a class="explore-lead" href="account.html?stay=1">Sign in \u2192</a>';box.hidden=false;return}
 if(d.type!=='hu:layer')return;
 if(d.on)exploreLayers[d.layer]=d;else delete exploreLayers[d.layer];
 const rows=[],f=exploreLayers.flights,s=exploreLayers.satellites,l=exploreLayers.launches;
 if(f)rows.push(f.unavailable?'<span>Flights are unavailable right now.</span>':'<span>'+escHtml(fmtCount(f.count))+' aircraft in the air right now'+(f.stale?' (last snapshot)':'')+'.</span> <a class="explore-lead" href="'+VAUNT_LEAD+'" target="_blank" rel="noopener sponsored">Fly Vaunt \u2192</a>');
 if(s)rows.push('<span>'+(s.unavailable?'Satellites are unavailable right now.':escHtml(fmtCount(s.count))+' satellites overhead, moving live.')+'</span>');
 if(l){const nx=l.next&&l.next[0];rows.push('<span>'+(l.unavailable?'Launches are unavailable right now.':escHtml(fmtCount(l.count))+' launches coming up'+(nx?' \u00b7 next: '+escHtml(String(nx.name||'').split('|')[0].trim())+(nx.net&&!isNaN(new Date(nx.net))?' \u00b7 '+escHtml(new Date(nx.net).toLocaleDateString('en-US',{month:'short',day:'numeric'})):'')+(nx.where?' \u00b7 '+escHtml(nx.where):''):'')+'.')+'</span>')}
 if(d.failed&&!d.on)rows.push('<span>'+escHtml(d.layer.charAt(0).toUpperCase()+d.layer.slice(1))+' could not load right now.</span>');
 box.innerHTML=rows.join('<br>');box.hidden=!rows.length}
function publicMission(m){return {mission_id:m.mission_id,title:m.title,description:String(m.description||'').slice(0,280),region_label:m.region_label,action_path:m.action_path}}
function announce(){const m=missions[i];if(m)tell({type:'hu:mission-selected',mission:publicMission(m)})}
function focusMission(id){let n=missions.findIndex(m=>m.mission_id===id);if(n<0&&allMissions.some(m=>m.mission_id===id)){$('worldSearch').value='';filterMissions();n=missions.findIndex(m=>m.mission_id===id)}if(n<0)return false;show(n);announce();return true}
window.addEventListener('message',e=>{if(!parentFrame||e.source!==parentFrame||e.origin!==location.origin)return;const d=e.data||{};
if(d.type==='hu:hello'){if(readyMessage)tell(readyMessage);return}
if(d.type==='hu:search'&&typeof d.q==='string'&&viewer){searchPins(d.q.slice(0,80));return}
if(d.type==='hu:focus-mission'&&typeof d.missionId==='string'){if(!viewer||!focusMission(d.missionId))tell({type:'hu:selection-cleared'});return}
if(d.type==='hu:regional'&&viewer){showCities=!!d.on;draw();tell({type:'hu:status',text:!showCities?'Regional impact is hidden.':cities.length?cities.length+(cities.length===1?' region shows its':' regions show their')+' totals: members who agreed to be counted, and verified actions.':'No region has five members who agreed to be counted yet.'});return}
if(d.type==='hu:near-me'){const b=$('ctlLocate');if(b)b.click();return}
/* the creator-only audience layer: the page says who may see the switch, and sends the points it fetched with the creator's own session */
if(d.type==='hu:creator-mode'){const b=$('ctlAudience');if(b){b.hidden=!d.on;if(!d.on){b.setAttribute('aria-pressed','false');drawAudience([])}}return}
if(d.type==='hu:audience-points'&&Array.isArray(d.points)&&viewer){drawAudience(d.points.slice(0,250));return}
if(d.type==='hu:clear-selection'&&viewer){selectionShown=false;missionPins.forEach(p=>{if(p.billboard)p.billboard.scale=1});setSelection(false);closeDetail();viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(0,15,homeAltitude()),duration:1.4})}});let missions=[],allMissions=[],cities=[],regions=[],i=0,viewer,missionPins=[],cityPins=[],showMissions=true,showCities=true,activeRegion=null,regionOutlines=[];
async function rpc(name){const r=await fetch(SB+'/rest/v1/rpc/'+name,{headers:{apikey:KEY,Authorization:'Bearer '+KEY}});if(!r.ok)throw Error('RPC '+r.status);return r.json()}
function clear(arr){arr.forEach(e=>viewer.entities.remove(e));arr.length=0}
function draw(){clear(missionPins);clear(cityPins);drawContinents();
if(showMissions)missions.forEach((m,n)=>missionPins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(m.longitude,m.latitude,3000),billboard:{image:glowPin(activeRegion&&m.region_key!==activeRegion?'#8b93a3':'#ff3d5e'),width:30,height:30,scale:n===i&&selectionShown?1.5:1},label:activeRegion&&m.region_key!==activeRegion?{text:'🔒',font:'14px sans-serif',pixelOffset:new Cesium.Cartesian2(0,-20)}:undefined,properties:{missionIndex:n}})));
if(showCities)cities.forEach(c=>cityPins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(c.longitude,c.latitude),point:{pixelSize:Math.min(22,7+Math.sqrt(c.member_count)),color:Cesium.Color.fromCssColorString('#f4b2b6')},label:{text:c.region_label+' · '+c.member_count+' members · '+c.verified_actions+' actions',font:'12px sans-serif',pixelOffset:new Cesium.Cartesian2(0,-20),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2400000)}})))}
function show(n){if(!missions.length)return;const next=(n+missions.length)%missions.length;const m=missions[next];i=next;selectionShown=true;missionPins.forEach((p,k)=>{if(p.billboard)p.billboard.scale=k===i?1.5:1});$('title').textContent=m.title;$('description').textContent=m.description;$('path').textContent=(m.action_path||'mission').replace('_',' ').toUpperCase()+' · '+m.region_label;$('position').textContent=(i+1)+' / '+missions.length;$('missionLink').href='mnet.html?mission='+encodeURIComponent(m.mission_id);setSelection(true);viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(m.longitude,m.latitude,1150000),orientation:{heading:Cesium.Math.toRadians(0),pitch:Cesium.Math.toRadians(-75),roll:0},duration:2.2,easingFunction:Cesium.EasingFunction.QUADRATIC_IN_OUT})}
function setMode(mode){if(mode==='feed'){$('worldFeed').scrollTo({top:0,behavior:'smooth'});$('feedMode').classList.add('is-active');$('globeMode').classList.remove('is-active');}else{$('globeMode').classList.add('is-active');$('feedMode').classList.remove('is-active');closeDetail();}viewer?.resize();}
function setSelection(selected){$('worldFilters').hidden=selected;$('mission').hidden=!selected;$('clearSelection').hidden=!selected;$('filterBack').hidden=!selected;$('deckHeading').textContent=selected?'Selected mission':'Explore the world';}
function closeDetail(){document.documentElement.classList.remove('world-detail-open');$('worldDetail').hidden=true;$('feedBack').hidden=true;$('feedHeading').textContent='MISSIONS';$('worldFeedList').hidden=false;}
function openDetail(n){if(!missions[n])return;show(n);const m=missions[n];$('detailRegion').textContent=(m.region_label||'World')+' · '+(m.action_path||'mission').replace('_',' ');$('detailTitle').textContent=m.title;$('detailDescription').textContent=m.description||'Open the mission to learn how to take action.';$('detailJoin').href='mnet.html?mission='+encodeURIComponent(m.mission_id);$('worldDetail').hidden=false;$('feedBack').hidden=false;$('worldFeedList').hidden=true;$('feedHeading').textContent='MISSION STORY';document.documentElement.classList.add('world-detail-open');$('worldFeed').scrollTop=0;}
function renderFeed(){const list=$('worldFeedList');list.replaceChildren();$('feedCount').textContent=missions.length+' missions';if(!missions.length){const empty=document.createElement('p');empty.textContent=allMissions.length?'No published missions match your search.':'Regional mission pins have not been published yet.';list.appendChild(empty);if(!allMissions.length){const link=document.createElement('a');link.href='mnet.html?view=missions';link.textContent='Browse worldwide actions →';list.appendChild(link)}return;}missions.forEach((m,n)=>{const article=document.createElement('article');article.className='world-story';article.id='world-story-'+n;article.tabIndex=0;article.setAttribute('role','button');article.setAttribute('aria-label','Read '+m.title);const meta=document.createElement('small');meta.textContent=(m.region_label||'World')+' · '+(m.action_path||'mission').replace('_',' ');const title=document.createElement('h2');title.textContent=m.title;const description=document.createElement('p');description.textContent=m.description||'Explore this mission and the actions people can take.';article.append(meta,title,description);article.onclick=()=>openDetail(n);article.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(n)}};list.appendChild(article);});}
function filterMissions(){const q=$('worldSearch').value.trim().toLocaleLowerCase();const selected=missions[i]?.mission_id;missions=allMissions.filter(m=>(!q||[m.title,m.description,m.region_label,m.action_path].some(v=>String(v||'').toLocaleLowerCase().includes(q))));i=Math.max(0,missions.findIndex(m=>m.mission_id===selected));draw();renderFeed();$('mission').hidden=!missions.length;$('status').hidden=!!missions.length;if(missions.length)show(i);else {setSelection(false);closeDetail();$('status').textContent=allMissions.length?'No missions match your search.':'Regional mission pins are not published yet. Browse worldwide actions in Action Network.';}}
function setRegion(region){activeRegion=region?.region_key||null;const button=$('nearMe');button.textContent=activeRegion?'Region: '+region.region_label:'Near me';$('status').hidden=false;$('status').textContent=activeRegion?'Showing missions in '+region.region_label+'. Other regions are locked in this view; location does not establish mission eligibility.':'Worldwide exploration restored.';filterMissions();}
async function drawBoundaries(){let rows;try{rows=await rpc('action_globe_public_boundaries')}catch(e){console.warn('Boundaries not available',e);return;}regionOutlines.forEach(x=>viewer.dataSources.remove(x));regionOutlines=[];for(const row of rows){try{const feature={type:'Feature',properties:{region_key:row.region_key,region_label:row.region_label},geometry:row.geometry};const source=await Cesium.GeoJsonDataSource.load(feature,{stroke:Cesium.Color.fromCssColorString('#8cb2d9').withAlpha(.65),strokeWidth:1,fill:Cesium.Color.TRANSPARENT,clampToGround:true});await viewer.dataSources.add(source);regionOutlines.push(source);}catch(e){console.warn('Invalid public boundary',row.region_key,e)}}}
function nearestKnownRegion(latitude,longitude){/* Centroids are not boundaries: never use nearest centroid to assert residency. */return null;}
function paintMembersDoor(){const card=$('worldMembers');if(!card)return;let member=false;try{const s=JSON.parse(localStorage.getItem('mccdb_session')||'null');member=!!(s&&(s.access_token||s.refresh_token))}catch(e){}if(member){$('worldMembersText').textContent='Your feed sits under the globe on your World screen.';const a=$('worldMembersLink');a.textContent='Open World';a.href='mnet.html?view=feed'}}
/* ---------- the World look (owner's mockups, 2026-10-14) ----------
   A lit NASA Earth (below), the street map one tap away, an atmosphere
   rim, glowing pins, and continent labels that count public pins only. */
/* THE EARTH (owner's signed-out reference, 2026-10-14): NASA imagery only, all public domain. Day: Blue Marble Next Generation.
   Night: Black Marble city lights. Clouds: the Visible Earth composite, a still, not today's weather. The sun is where it really
   is when the page opens, so the line between day and night is the real one. */
const DAY_TILES='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const NIGHT_TILES='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
const CLOUDS='assets/img/globe/nasa-clouds-2048.webp';
let mapLayer=null,dayLayer=null,nightLayer=null,cloudLayer=null,layerMode='auto',selectionShown=false,continentLabels=[];const pinCache={};
function glowPin(color){if(pinCache[color])return pinCache[color];const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');const r=g.createRadialGradient(32,32,2,32,32,32);r.addColorStop(0,'#ffffff');r.addColorStop(.18,color);r.addColorStop(.42,color+'99');r.addColorStop(1,color+'00');g.fillStyle=r;g.beginPath();g.arc(32,32,32,0,Math.PI*2);g.fill();return pinCache[color]=c.toDataURL()}
function styleScene(){const sc=viewer.scene;sc.backgroundColor=Cesium.Color.fromCssColorString('#03060c');sc.globe.baseColor=Cesium.Color.fromCssColorString('#050a14');
 /* day and night by the real sun. In 3D these fade distances are measured from the Earth's CENTRE, so each carries the radius:
    shading eases off between ~3,000 and ~1,200 km up (the street map takes over at 900 km), and the ground atmosphere's night
    darkness is pushed out of reach so it never paints over the city lights. */
 const R=Cesium.Ellipsoid.WGS84.maximumRadius;viewer.clock.shouldAnimate=false;sc.globe.enableLighting=true;sc.globe.dynamicAtmosphereLighting=true;sc.globe.dynamicAtmosphereLightingFromSun=false;
 sc.globe.lightingFadeOutDistance=R+1.2e6;sc.globe.lightingFadeInDistance=R+3e6;sc.globe.nightFadeOutDistance=R+1.2e6;sc.globe.nightFadeInDistance=1e9;sc.globe.atmosphereLightIntensity=8;if(sc.skyAtmosphere)sc.skyAtmosphere.show=true;sc.globe.showGroundAtmosphere=true;sc.globe.atmosphereBrightnessShift=-0.05;sc.globe.atmosphereSaturationShift=0.1;sc.globe.atmosphereHueShift=-0.04;if(sc.skyAtmosphere){sc.skyAtmosphere.brightnessShift=0.15;sc.skyAtmosphere.saturationShift=0.1}
 /* a hook for the browser test: the evidence shots wait for the tiles */
 window.__huGlobeSettled=()=>!!(viewer&&viewer.scene.globe.tilesLoaded);viewer.camera.percentageChanged=0.08;
 /* labels draw over the limb instead of being cut by it, so only those on the near side of the Earth show */
 viewer.camera.changed.addEventListener(cullLabels);
 /* past street level the night tiles run out of detail, so the map takes over unless someone chose a style or Cesium ion's aerial imagery is there (streetAuto) */
 viewer.camera.changed.addEventListener(()=>{if(layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)});}
const CONTINENTS=[['North America',-100,46],['South America',-60,-16],['Europe',14,53],['Africa',19,4],['Asia',92,38],['Oceania',138,-26]];
/* rough boxes, only to word a label; never used for eligibility or anything a member does */
function continentOf(lat,lon){if(lat<-8&&(lon>110||lon<-150))return 'Oceania';if(lon<-25)return lat>8||lon<-82?'North America':'South America';if(lon>34&&lat>12&&lat<42)return 'Asia';if(lat>35&&lon<45)return 'Europe';if(lat<=37&&lon<52)return 'Africa';return lat>-11?'Asia':'Oceania'}
function drawContinents(){clear(continentLabels);if(!showMissions)return;const counts={};missions.forEach(m=>{if(Number.isFinite(m.latitude)&&Number.isFinite(m.longitude)){const k=continentOf(m.latitude,m.longitude);counts[k]=(counts[k]||0)+1}});
 const far=new Cesium.DistanceDisplayCondition(7000000,Number.POSITIVE_INFINITY);
 CONTINENTS.forEach(([name,lon,lat])=>{const n=counts[name];if(!n)return;const at=Cesium.Cartesian3.fromDegrees(lon,lat,250000);
  continentLabels.push(viewer.entities.add({position:at,label:{text:name,font:'600 14px Inter,system-ui,sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.fromCssColorString('#03060c'),outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,distanceDisplayCondition:far,disableDepthTestDistance:Number.POSITIVE_INFINITY,pixelOffset:new Cesium.Cartesian2(0,-9)}}));
  continentLabels.push(viewer.entities.add({position:at,label:{text:n+(n===1?' mission':' missions'),font:'500 12px Inter,system-ui,sans-serif',fillColor:Cesium.Color.fromCssColorString('#c7d0e0'),outlineColor:Cesium.Color.fromCssColorString('#03060c'),outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,distanceDisplayCondition:far,disableDepthTestDistance:Number.POSITIVE_INFINITY,pixelOffset:new Cesium.Cartesian2(0,9)}}));});cullLabels();}
function cullLabels(){if(!viewer||!continentLabels.length)return;const occ=new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84,viewer.camera.positionWC),now=viewer.clock.currentTime;continentLabels.forEach(e=>{e.show=occ.isPointVisible(e.position.getValue(now))})}
function searchPins(q){$('worldSearch').value=q;const t=q.trim().toLocaleLowerCase();missions=allMissions.filter(m=>!t||[m.title,m.description,m.region_label,m.action_path].some(v=>String(v||'').toLocaleLowerCase().includes(t)));i=0;selectionShown=false;draw();renderFeed()}
/* three looks, one button: the lit Earth (real sun), the night Earth (city lights everywhere, the owner's World mockups), the street map */
function setLayer(mode){layerMode=mode;const night=mode==='night',g=viewer.scene.globe;if(mapLayer)mapLayer.show=mode==='map'||(mode==='auto'&&streetAuto(viewer.camera.positionCartographic.height));
 if(dayLayer)dayLayer.show=!night;if(cloudLayer)cloudLayer.show=!night;if(nightLayer){nightLayer.dayAlpha=night?1:0;nightLayer.brightness=night?2.1:6}
 g.enableLighting=!night;g.atmosphereBrightnessShift=night?-0.35:-0.05;
 const b=$('ctlLayers');if(b){b.setAttribute('aria-pressed',mode==='auto'?'false':'true');b.title={auto:'The Earth (tap for night)',night:'Night Earth (tap for street map)',map:'Street map (tap for the Earth)'}[mode]}}
let audiencePins=[];
/* a hook for the browser test, like __huGlobeSettled: how many audience points are drawn */
window.__huAudienceCount=()=>audiencePins.length;
function drawAudience(points){if(!viewer)return;audiencePins.forEach(e=>viewer.entities.remove(e));audiencePins=[];
 points.forEach(p=>{const lon=Number(p.lon),lat=Number(p.lat),views=Math.max(0,Math.floor(Number(p.views)||0));if(!isFinite(lon)||!isFinite(lat)||Math.abs(lat)>90||Math.abs(lon)>180||!views)return;
  audiencePins.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(lon,lat,2000),point:{pixelSize:Math.min(28,8+Math.sqrt(views)*2),color:Cesium.Color.fromCssColorString('#4fd1ff').withAlpha(.78),outlineColor:Cesium.Color.WHITE.withAlpha(.9),outlineWidth:1.5},
   label:{text:String(p.name||'').slice(0,40)+' · '+views.toLocaleString()+(views===1?' view':' views'),font:'600 12px Inter, system-ui, sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-20),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,1.8e7)}}))})}
/* ---------- THE WORLD'S DATA LAYERS (owner, 2026-10-15: "let's populate it … flights … satellites and space missions, that only logged in users can see") ----------
   Three toggles at the bottom-left. Flights is for everyone; Satellites and Launches are for members: the Worker checks the
   bearer with Supabase (workers/mccluster/src/world-layers.js), and here a guest's lock only says so and opens sign-in.
   Each source is credited on the imagery line while it is on. Satellites are propagated here from CelesTrak's elements
   (vendor/satellite.min.js, loaded on first use) so they move; flights are the last snapshot the Worker holds. */
const API='https://api.mccluster.org';
const DATA_LAYERS={flights:{id:'ctlFlights',members:false,color:'#ffb347',credit:'Flights: OpenSky'},satellites:{id:'ctlSats',members:true,color:'#4fd1ff',credit:'Satellites: CelesTrak'},launches:{id:'ctlLaunch',members:true,color:'#ffffff',credit:'Launches: The Space Devs'}};
const layerState={flights:{on:false,points:null,count:0},satellites:{on:false,points:null,sats:[],labels:[],timer:0,count:0},launches:{on:false,entities:[],count:0}};
/* hooks for the browser test, like __huGlobeSettled */
window.__huLayerCounts=()=>({flights:layerState.flights.count,satellites:layerState.satellites.count,launches:layerState.launches.count});
window.__huLayerOn=k=>!!(layerState[k]&&layerState[k].on);
function sessionToken(){try{const s=JSON.parse(localStorage.getItem('mccdb_session')||'null');return s&&s.access_token||''}catch(e){return ''}}
function paintDataLocks(){const member=!!sessionToken();Object.keys(DATA_LAYERS).forEach(k=>{const b=$(DATA_LAYERS[k].id);if(!b)return;const locked=DATA_LAYERS[k].members&&!member;b.setAttribute('aria-disabled',locked?'true':'false');b.classList.toggle('is-locked',locked)})}
async function layerFetch(k){const headers={accept:'application/json'};if(DATA_LAYERS[k].members){const t=sessionToken();if(!t)throw Error('members');headers.authorization='Bearer '+t}const r=await fetch(API+'/v1/world/layers/'+k,{headers});if(r.status===401)throw Error('members');if(!r.ok)throw Error('layer '+r.status);return r.json()}
function clearLayer(k){const L=layerState[k];if(L.points){viewer.scene.primitives.remove(L.points);L.points=null}if(L.labels){L.labels.forEach(e=>viewer.entities.remove(e));L.labels=[]}if(L.entities){L.entities.forEach(e=>viewer.entities.remove(e));L.entities=[]}if(L.sats)L.sats=[];if(L.timer){clearInterval(L.timer);L.timer=0}L.count=0}
function drawFlights(data){const L=layerState.flights;clearLayer('flights');const col=new Cesium.PointPrimitiveCollection(),c=Cesium.Color.fromCssColorString(DATA_LAYERS.flights.color);(data.aircraft||[]).forEach(a=>{if(!Array.isArray(a)||!isFinite(a[2])||!isFinite(a[3]))return;col.add({position:Cesium.Cartesian3.fromDegrees(a[2],a[3],Math.max(0,a[4]||9000)),pixelSize:3,color:c,id:{layer:'flights',callsign:a[1]}})});viewer.scene.primitives.add(col);L.points=col;L.count=col.length}
function satPos(sat,now){try{const pv=satellite.propagate(sat.rec,now);if(!pv||!pv.position||typeof pv.position!=='object')return null;const g=satellite.eciToGeodetic(pv.position,satellite.gstime(now));if(!isFinite(g.latitude)||!isFinite(g.longitude)||!isFinite(g.height))return null;return Cesium.Cartesian3.fromRadians(g.longitude,g.latitude,Math.max(0,g.height*1000))}catch(e){return null}}
function stepSatellites(){const L=layerState.satellites;if(!L.points||!viewer)return;const now=new Date();L.sats.forEach(s=>{const p=satPos(s,now);if(!p)return;s.point.position=p;if(s.label)s.label.position=p})}
function loadSatelliteLib(){if(window.satellite)return Promise.resolve();return new Promise((res,rej)=>{const t=document.createElement('script');t.src='vendor/satellite.min.js';t.onload=res;t.onerror=()=>rej(Error('sgp4'));document.head.appendChild(t)})}
const NAMED_SATS=/^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST|TIANGONG)/;
async function drawSatellites(data){await loadSatelliteLib();const L=layerState.satellites;clearLayer('satellites');const col=new Cesium.PointPrimitiveCollection(),c=Cesium.Color.fromCssColorString(DATA_LAYERS.satellites.color),now=new Date();(data.satellites||[]).forEach(s=>{let rec;try{rec=satellite.twoline2satrec(String(s.tle1),String(s.tle2))}catch(e){return}const sat={rec,name:String(s.name||'')};const p=satPos(sat,now);if(!p)return;const named=NAMED_SATS.test(sat.name);sat.point=col.add({position:p,pixelSize:named?6:4,color:c,outlineColor:Cesium.Color.WHITE.withAlpha(.7),outlineWidth:named?1.5:0,id:{layer:'satellites',name:sat.name}});if(named){sat.label=viewer.entities.add({position:p,label:{text:sat.name.replace(/ \(.*\)$/,''),font:'12px sans-serif',fillColor:Cesium.Color.fromCssColorString('#dff6ff'),style:Cesium.LabelStyle.FILL_AND_OUTLINE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,pixelOffset:new Cesium.Cartesian2(0,-12),verticalOrigin:Cesium.VerticalOrigin.BOTTOM}});L.labels.push(sat.label)}L.sats.push(sat)});viewer.scene.primitives.add(col);L.points=col;L.count=L.sats.length;L.timer=setInterval(stepSatellites,1500)}
function drawLaunches(data){const L=layerState.launches;clearLayer('launches');(data.launches||[]).forEach((l,n)=>{const pad=l&&l.pad||{};if(!isFinite(pad.lon)||!isFinite(pad.lat))return;const when=l.net?new Date(l.net):null,day=when&&!isNaN(when)?when.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';L.entities.push(viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(pad.lon,pad.lat,4000),billboard:{image:glowPin(DATA_LAYERS.launches.color),width:22,height:22},label:{text:String(l.name||'Launch').split('|')[0].trim().slice(0,40)+(day?' · '+day:''),font:'11px sans-serif',fillColor:Cesium.Color.WHITE,style:Cesium.LabelStyle.FILL_AND_OUTLINE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,pixelOffset:new Cesium.Cartesian2(0,-16),verticalOrigin:Cesium.VerticalOrigin.BOTTOM,distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2.6e7)},id:'hu-launch-'+n+'-'+String(l.id||'').slice(0,40)}))});L.count=L.entities.length}
/* the credit line grows when layers are on; the toggles and the controls stay above it, and the page is told how tall it is */
function creditHeight(){const el=document.querySelector('.osm-credit');return el?Math.ceil(el.getBoundingClientRect().height):0}
function liftAboveCredit(){const h=creditHeight();document.documentElement.style.setProperty('--hu-credit-h',h+'px');
 /* the bar floats a little off the bottom, so what matters is where its top is, not how tall it is */
 if(EXPLORE){const bar=document.querySelector('.appbar'),deck=$('deck'),px=el=>el&&!el.hidden?Math.ceil(el.getBoundingClientRect().height):0,barH=bar?Math.max(0,Math.ceil(innerHeight-bar.getBoundingClientRect().top)):0;document.documentElement.style.setProperty('--hu-bar-h',barH+'px');document.documentElement.style.setProperty('--hu-sheet-h',px(deck)+'px')}
 return h}
function paintLayerCredits(){const c=$('layerCredits');if(!c)return;const parts=Object.keys(DATA_LAYERS).filter(k=>layerState[k].on).map(k=>DATA_LAYERS[k].credit);c.textContent=parts.length?parts.join(' · ')+' · ':'';liftAboveCredit()}
async function toggleLayer(k){const spec=DATA_LAYERS[k],b=$(spec.id),L=layerState[k];if(!viewer||!b)return;if(spec.members&&!sessionToken()){tell({type:'hu:ask-sign-in',reason:'layers'});return}
 if(L.on){L.on=false;b.setAttribute('aria-pressed','false');clearLayer(k);paintLayerCredits();tell({type:'hu:layer',layer:k,on:false,creditHeight:creditHeight()});return}
 b.setAttribute('aria-busy','true');try{const data=await layerFetch(k);if(k==='flights')drawFlights(data);else if(k==='satellites')await drawSatellites(data);else drawLaunches(data);L.on=true;b.setAttribute('aria-pressed','true');paintLayerCredits();
  tell({type:'hu:layer',layer:k,on:true,count:L.count,creditHeight:creditHeight(),unavailable:!!data.unavailable,stale:!!data.stale,attribution:String(data.attribution||''),next:k==='launches'?(data.launches||[]).slice(0,3).map(l=>({name:String(l.name||''),net:l.net||null,where:String(l.pad&&(l.pad.location||l.pad.name)||'')})):undefined})}
 catch(e){if(String(e&&e.message)==='members'){paintDataLocks();tell({type:'hu:ask-sign-in',reason:'layers'})}else{try{console.warn('[world layer] '+k+': '+(e&&e.message||e))}catch(_){}tell({type:'hu:layer',layer:k,on:false,failed:true})}}finally{b.removeAttribute('aria-busy')}}
function wireDataLayers(){Object.keys(DATA_LAYERS).forEach(k=>{const b=$(DATA_LAYERS[k].id);if(b)b.onclick=()=>toggleLayer(k)});paintDataLocks();window.addEventListener('storage',paintDataLocks);liftAboveCredit();window.addEventListener('resize',liftAboveCredit);
 /* the full pane: the bar arrives after this script (js/tabbar.js), and the sheet grows when a mission is chosen */
 if(EXPLORE){new MutationObserver(liftAboveCredit).observe(document.body,{childList:true});if(window.ResizeObserver)new ResizeObserver(liftAboveCredit).observe($('deck'));window.addEventListener('load',liftAboveCredit);const hint=document.querySelector('#worldFilters p');if(hint)hint.textContent='Tap a pin to open its mission. Drag to turn the Earth, pinch to zoom.'}}
function wireControls(){const on=(id,f)=>{const b=$(id);if(b)b.onclick=f};
 on('ctlAudience',()=>{const b=$('ctlAudience'),next=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',next?'true':'false');if(!next)drawAudience([]);tell({type:'hu:audience',on:next})});
 on('ctlWorld',()=>{selectionShown=false;missionPins.forEach(p=>{if(p.billboard)p.billboard.scale=1});setLayer(layerMode==='map'?'auto':layerMode);viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(0,15,homeAltitude()),duration:1.4});tell({type:'hu:selection-cleared'})});
 /* Near me answers in #status; inside the network that line is hidden, so hand the page that one answer */
 on('ctlLocate',()=>{const st=$('status'),mo=new MutationObserver(()=>{tell({type:'hu:status',text:String(st.textContent||'').slice(0,200)});mo.disconnect()});mo.observe(st,{childList:true,characterData:true,subtree:true});$('nearMe').click();setTimeout(()=>mo.disconnect(),15000)});
 const zoom=f=>{const h=viewer.camera.positionCartographic.height;f?viewer.camera.zoomIn(h*.45):viewer.camera.zoomOut(h*.8)};on('ctlZoomIn',()=>zoom(true));on('ctlZoomOut',()=>zoom(false));
 on('ctlLayers',()=>setLayer({auto:'night',night:'map',map:'auto'}[layerMode]||'auto'));}
/* ---------- THE EARTH UP CLOSE: Cesium ion, for signed-in members (owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster worker";
   the public gets the globe and its free layers, the paid map data is for members) ----------
   From far out the Earth stays NASA's, exactly as above. Coming down, Cesium ion takes over: Cesium World Terrain under everything,
   aerial imagery (Bing Aerial with Labels, else Bing Aerial, else Sentinel-2) easing in from 3,000 km and whole by 1,200 km while
   the cloud still eases out, and Cesium OSM Buildings below 50 km. The street map stays one tap away on the Layers button.
   The account's token never comes to the page: Ion.defaultServer is the Worker (workers/mccluster/src/world-ion.js), which asks ion
   for each asset and hands back a token for that one asset that lives about an hour. GET /v1/world/ion says first whether there
   is ion at all; with none, or when any part of it fails, the Earth is what it was. Terrain is built before it is used, so the
   ground never blanks while it loads; vertex normals stay off, because with them the night lights would cover the day side.
   MEMBERS ONLY. A logged-out page never asks the Worker's ion route (not even its status) and never reaches Cesium ion: its Earth
   is NASA's, with the street map below 900 km. A member's page sends its Supabase session to the Worker's ion route in an
   Authorization header, never in a URL: Ion.defaultServer is a Cesium.Resource carrying it, and CesiumJS 1.131 derives every
   asset-endpoint request from Ion.defaultServer (CesiumTerrainProvider and Cesium3DTileset.fromIonAssetId take no server option),
   copying its headers and its retryCallback. The session rotates: when the Worker refuses a stale one (401) the request is retried
   with the newest session in this browser, once per change; with none, or on a 403, 429 or 503, ion steps aside for the page
   (ionOff) and the Earth is NASA's again, quietly. Signing out in another tab does the same; signing in brings ion on the next load. */
const ION_HI=3000000,ION_FULL=1200000,ION_OFF=3400000,BUILD_ON=50000,BUILD_OFF=60000,ION_WAIT=1500,TERRAIN_WAIT=2500;
let ion=null,ionGround=false,ionImagery=null,ionImageryTried=false,ionBuildings=null,ionBuildingsTried=false,ionServer=null;
/* hooks for the browser test, like __huGlobeSettled */
window.__huIon=()=>({on:!!ion,ground:!!(viewer&&viewer.scene.globe.terrainProvider),terrain:!!(viewer&&viewer.scene.globe.terrainProvider&&!(viewer.scene.globe.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)),imagery:!!(ionImagery&&ionImagery.ready),imageryShown:!!(ionImagery&&ionImagery.show),buildings:!!ionBuildings,buildingsShown:!!(ionBuildings&&ionBuildings.show),street:!!(mapLayer&&mapLayer.show),clouds:cloudLayer?Math.round(cloudLayer.alpha*100)/100:null,nightLights:nightLayer?Math.round(nightLayer.nightAlpha*100)/100:null,groundIsIon:ionGround,height:viewer?Math.round(viewer.camera.positionCartographic.height):null});
function ionWarn(what,e){if(!ion)return;try{console.warn('[world ion] '+what+': '+(e&&e.message||e))}catch(_){}}
/* the automatic street map below 900 km, unless ion's aerial imagery is there to show the ground instead */
function streetAuto(h){return h<900000&&!(ionImagery&&ionImagery.ready)}
function ionBearer(){const t=sessionToken();return t?'Bearer '+t:''}
function ionStatus(){if(!ionBearer())return Promise.resolve(null);const late=new Promise(r=>setTimeout(()=>r(null),ION_WAIT));
 const ask=fetch(API+'/v1/world/ion',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).then(s=>s&&s.available===true&&s.assets&&Number.isInteger(s.assets.terrain)?s.assets:null).catch(()=>null);
 return Promise.race([ask,late])}
/* the Worker refused an asset endpoint: a rotated session is tried again; otherwise ion steps aside. Retries happen only when the
   session actually changed, so the high retryAttempts (Cesium counts them for the life of the resource) is never a loop. */
function ionRetry(resource,error){const code=error&&error.statusCode;
 if(code===401){const b=ionBearer();if(b&&resource.headers.Authorization!==b){resource.headers.Authorization=b;if(ionServer)ionServer.headers.Authorization=b;return true}}
 if(code===401||code===403||code===429||code===503)ionOff('the map data answered '+code);
 return false}
/* back to NASA's Earth and the street map, with nothing more asked of ion on this page */
function ionOff(why){if(!ion)return;ionWarn('off',why);ion=null;document.documentElement.classList.remove('globe-ion');if(!viewer)return;
 if(ionImagery){if(viewer.imageryLayers.contains(ionImagery))viewer.imageryLayers.remove(ionImagery,true);ionImagery=null}
 if(cloudLayer)cloudLayer.alpha=1;if(nightLayer)nightLayer.nightAlpha=1;
 if(ionBuildings){viewer.scene.primitives.remove(ionBuildings);ionBuildings=null}
 if(ionGround){ionGround=false;viewer.scene.globe.terrainProvider=new Cesium.EllipsoidTerrainProvider()}
 if(layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)}
function startIon(){if(!ion||!viewer)return;const bearer=ionBearer();if(!bearer){ion=null;return}
 Cesium.Ion.defaultAccessToken=undefined;ionServer=new Cesium.Resource({url:API+'/v1/world/ion/',headers:{Authorization:bearer},retryAttempts:1e9,retryCallback:ionRetry});Cesium.Ion.defaultServer=ionServer;
 window.addEventListener('storage',e=>{if(e&&e.key&&e.key!=='mccdb_session')return;if(!ion)return;const b=ionBearer();if(!b)ionOff('signed out');else ionServer.headers.Authorization=b});
 document.documentElement.classList.add('globe-ion');const line=document.querySelector('.osm-credit');if(line&&window.ResizeObserver)new ResizeObserver(liftAboveCredit).observe(line);liftAboveCredit();
 /* nothing is drawn until the terrain is in hand (or TERRAIN_WAIT passes), so the Earth appears once, with its ground */
 const g=viewer.scene.globe,flat=g.terrainProvider;let landed=false;const land=p=>{if(landed)return;landed=true;ionGround=!!(p&&ion);g.terrainProvider=ionGround?p:flat};
 g.terrainProvider=undefined;Cesium.CesiumTerrainProvider.fromIonAssetId(ion.terrain).then(p=>land(p),e=>{land(null);ionWarn('terrain',e)});setTimeout(()=>land(null),TERRAIN_WAIT);
 viewer.scene.preRender.addEventListener(ionFrame)}
function addIonImagery(k){const id=ion&&Array.isArray(ion.imagery)?ion.imagery[k]:undefined;if(!Number.isInteger(id)||!viewer)return;
 const layer=Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(id),{alpha:0});ionImagery=layer;
 layer.readyEvent.addEventListener(()=>{if(ionImagery===layer&&layerMode==='auto'&&mapLayer)mapLayer.show=false});
 layer.errorEvent.addEventListener(e=>{ionWarn('imagery '+id,e);if(viewer.imageryLayers.contains(layer))viewer.imageryLayers.remove(layer,true);
  if(ionImagery===layer){ionImagery=null;if(cloudLayer)cloudLayer.alpha=1;if(nightLayer)nightLayer.nightAlpha=1;if(layerMode==='auto'&&mapLayer)mapLayer.show=streetAuto(viewer.camera.positionCartographic.height)}addIonImagery(k+1)});
 viewer.imageryLayers.add(layer,viewer.imageryLayers.indexOf(dayLayer)+1)}
function addIonBuildings(){if(!ion||!Number.isInteger(ion.buildings)||!viewer)return;
 const coarse=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
 Cesium.Cesium3DTileset.fromIonAssetId(ion.buildings,{maximumScreenSpaceError:coarse?24:16}).then(ts=>{if(!ion){ts.destroy();return}ts.show=false;ts.style=new Cesium.Cesium3DTileStyle({color:"color('#e4e8ee')"});ionBuildings=viewer.scene.primitives.add(ts)},e=>ionWarn('buildings',e))}
/* every frame: what ion shows at this height, with a little hysteresis so nothing flickers on the line */
function ionFrame(){if(!ion||!viewer)return;const h=viewer.camera.positionCartographic.height,auto=layerMode==='auto';
 if(!ionImageryTried&&auto&&h<ION_HI){ionImageryTried=true;addIonImagery(0)}
 if(ionImagery){const on=auto&&h<(ionImagery.show?ION_OFF:ION_HI);if(ionImagery.show!==on)ionImagery.show=on;const a=Math.min(1,Math.max(0,(ION_HI-h)/(ION_HI-ION_FULL)));if(ionImagery.alpha!==a)ionImagery.alpha=a;
  if(cloudLayer){const c=ionImagery.ready&&on?1-a:1;if(cloudLayer.alpha!==c)cloudLayer.alpha=c}
  /* Black Marble is opaque and sits over the aerial imagery; on the night side it would cover the ground at every height */
  if(nightLayer){const n=ionImagery.ready&&on?1-a:1;if(nightLayer.nightAlpha!==n)nightLayer.nightAlpha=n}}
 /* OSM Buildings sit on Cesium World Terrain's heights; on the flat fallback they would float or sink, so they wait for the real ground */
 if(!ionBuildingsTried&&ionGround&&auto&&h<BUILD_OFF*2){ionBuildingsTried=true;addIonBuildings()}
 if(ionBuildings){const on=auto&&h<(ionBuildings.show?BUILD_OFF:BUILD_ON);if(ionBuildings.show!==on)ionBuildings.show=on}}
async function boot(){paintMembersDoor();
 /* the layout, the data toggles and the mission data do not wait on the ion status; only the Earth itself does */
 wireDataLayers();const ionP=ionStatus(),dataP=Promise.all([rpc('action_globe_public_region_missions'),rpc('action_globe_public_regions')]);dataP.catch(()=>{});
 ion=await ionP;viewer=new Cesium.Viewer('globe',{creditContainer:ion?$('ionCredits'):undefined,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,baseLayer:(dayLayer=new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({url:DAY_TILES,maximumLevel:8,credit:'NASA Blue Marble (GIBS)'}),{saturation:1.15,contrast:1.05}))});/* the night side is lit at Cesium's 30% floor, so the lights are lifted six-fold to read as navy sea and gold cities */nightLayer=new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({url:NIGHT_TILES,maximumLevel:8,credit:'NASA Black Marble (GIBS)'}),{dayAlpha:0,nightAlpha:1,brightness:6,contrast:1.1,saturation:1.15,gamma:0.85,hue:0.2});viewer.imageryLayers.add(nightLayer);cloudLayer=Cesium.ImageryLayer.fromProviderAsync(Cesium.SingleTileImageryProvider.fromUrl(CLOUDS,{rectangle:Cesium.Rectangle.fromDegrees(-180,-90,180,90),credit:'NASA Visible Earth'}),{dayAlpha:0.92,nightAlpha:0.1});viewer.imageryLayers.add(cloudLayer);mapLayer=new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({url:'https://tile.openstreetmap.org/'}));viewer.imageryLayers.add(mapLayer);mapLayer.show=false;styleScene();wireControls();startIon();
 if(ion){const box=viewer.container.querySelector('.cesium-credit-lightbox');if(box)box.addEventListener('click',e=>{if(!(e.target.closest&&e.target.closest('a[href]')))viewer.creditDisplay.hideLightbox()})}
 viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(0,15,homeAltitude())});
viewer.screenSpaceEventHandler.setInputAction(p=>{const e=viewer.scene.pick(p.position);const n=e?.id?.properties?.missionIndex?.getValue();if(Number.isInteger(n)){show(n);announce();return;}const regionKey=e?.id?.properties?.region_key?.getValue?.();if(regionKey){const match=regions.find(r=>r.region_key===regionKey);if(match)setRegion(match);}},Cesium.ScreenSpaceEventType.LEFT_CLICK);
$('nearMe').onclick=()=>{if(!navigator.geolocation){$('status').hidden=false;$('status').textContent='Location is unavailable on this device.';return;}navigator.geolocation.getCurrentPosition(position=>{const {latitude,longitude}=position.coords;viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(longitude,latitude,350000),duration:1.5});$('nearMe').textContent='Nearby ✓';$('status').hidden=false;$('status').textContent='Nearby view enabled for this session. Precise location is not uploaded. Regional locking awaits verified state/province boundary data.';},()=>{$('status').hidden=false;$('status').textContent='Location denied. Worldwide missions remain available.';},{enableHighAccuracy:false,timeout:12000,maximumAge:300000});};
$('globeMode').onclick=()=>setMode('globe');$('feedMode').onclick=()=>setMode('feed');$('openFeed').onclick=()=>openDetail(i);$('feedBack').onclick=closeDetail;$('detailLocate').onclick=()=>{closeDetail();show(i)};$('clearSelection').onclick=()=>{setSelection(false);closeDetail()};$('filterBack').onclick=()=>setSelection(false);$('worldSearch').addEventListener('input',filterMissions);
$('previous').onclick=()=>show(i-1);$('next').onclick=()=>show(i+1);
$('missionsLayer').onclick=()=>{showMissions=!showMissions;draw()};$('citiesLayer').onclick=()=>{showCities=!showCities;draw()};
let touchY;const deck=$('deck');deck.addEventListener('touchstart',e=>{touchY=e.touches[0].clientY},{passive:true});deck.addEventListener('touchend',e=>{if(touchY===undefined)return;const d=e.changedTouches[0].clientY-touchY;if(Math.abs(d)>45)show(i+(d<0?1:-1));touchY=undefined},{passive:true});
try{[missions,cities]=await dataP;regions=cities.slice();const requestedSong=new URLSearchParams(location.search).get('song');if(requestedSong){missions=missions.filter(m=>String(m.song_title||'').toLocaleLowerCase()===requestedSong.toLocaleLowerCase());}allMissions=missions.slice();draw();drawBoundaries();$('status').textContent=missions.length?'':(requestedSong?'No approved regional missions are linked to this song yet.':'No approved globe missions published yet.');if(missions.length){$('status').hidden=true;setSelection(false)}renderFeed();readyMessage={type:'hu:globe-ready',missionIds:allMissions.map(m=>m.mission_id),missions:allMissions.slice(0,200).map(publicMission)};tell(readyMessage)}catch(e){$('status').textContent='Globe data is not available yet.';readyMessage={type:'hu:globe-ready',missionIds:[],dataUnavailable:true};tell(readyMessage);console.warn(e)}}
if(window.Cesium)boot().catch(e=>{$('status').hidden=false;$('status').textContent='Interactive globe unavailable on this device. Mission browsing will be available when the map can load.';readyMessage={type:'hu:globe-unavailable'};tell(readyMessage);console.warn(e)});else{$('status').textContent='Unable to load globe.';readyMessage={type:'hu:globe-unavailable'};tell(readyMessage)}})();