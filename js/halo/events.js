/* A single visual vocabulary for Halo's observed objects, warnings and reports.
   Animation describes an event TYPE. It never invents a location, footprint,
   measured wind field, displacement, or motion between provider snapshots. */
(function (root) {
  'use strict';
  const TYPES = Object.freeze({
    tornado: ['Tornado', '#d1d5df'], cyclone: ['Cyclone', '#b9dcec'], quake: ['Earthquake', '#ffb26e'],
    fire: ['Wildfire', '#ff923e'], heat: ['Heat / thermal', '#ffd174'], volcano: ['Volcano', '#dfae9b'],
    flood: ['Flood', '#79cced'], wave: ['Waves', '#75cadd'], rain: ['Rain', '#8dbaf4'], storm: ['Thunderstorm', '#c3b7f2'],
    snow: ['Snow / cold', '#e2f4fc'], ice: ['Ice', '#b1e8f1'], wind: ['Wind', '#b5d9cf'], dust: ['Dust / haze', '#d7b78e'],
    landslide: ['Landslide', '#c89972'], alert: ['Alert', '#e8c778'], vessel: ['Vessel', '#7be2cb'],
    aircraft: ['Aircraft', '#ffcd76'], tide: ['Water-level station', '#6bc9ed'], mission: ['Mission', '#6fe2d2'],
    evidence: ['Evidence', '#eed09a'], person: ['Mission team', '#adc8ff'], camera: ['Camera', '#c8e4ee'], launch: ['Launch site', '#edd5aa']
  });
  const MOTION_CAP = 48, MODEL_CAP = 8;
  const cache = new Map();
  const valid = p => Number.isFinite(p?.lon) && Number.isFinite(p?.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90;
  const kindFor = (layer, item) => ({ military: 'aircraft', vessels: 'vessel', quakes: 'quake', fires: 'heat', perimeters: 'fire', cyclones: 'cyclone', tides: 'tide' }[layer] || (TYPES[item?.kind] ? item.kind : 'alert'));
  const expired = (item, now = Date.now()) => !!item.expires_at && Date.parse(item.expires_at) <= now;
  function symbol(kind, frame = 0) {
    if (!TYPES[kind]) kind = 'alert';
    frame = Math.floor(frame) % 12;
    const key = kind + ':' + frame; if (cache.has(key)) return cache.get(key);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const x = canvas.getContext('2d'), color = TYPES[kind][1], t = frame / 12 * Math.PI * 2;
    x.translate(48, 48); x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = color; x.fillStyle = color; x.shadowColor = '#020812'; x.shadowBlur = 5;
    const line = pts => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.stroke(); };
    const poly = pts => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); x.fill(); };
    const cloud = (y = -15) => { x.beginPath(); x.ellipse(0, y, 30, 12, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(-10, y - 9, 13, 0, Math.PI * 2); x.arc(9, y - 10, 16, 0, Math.PI * 2); x.fill(); };
    if (kind === 'tornado') {
      for (let i = 0; i < 8; i++) { const y = -29 + i * 8, r = 32 - i * 3.7; x.globalAlpha = 1 - i * .045; x.beginPath(); x.ellipse(Math.sin(t + i * .55) * (i + 1) * .5, y, r, 3.6, -.08, 0, Math.PI * 2); x.stroke(); }
    } else if (kind === 'cyclone') {
      x.rotate(t * .5); for (let a = 0; a < 3; a++) { x.rotate(Math.PI * 2 / 3); x.beginPath(); x.moveTo(3, 0); x.bezierCurveTo(36, -26, 34, 32, -16, 34); x.stroke(); } x.beginPath(); x.arc(0, 0, 8, 0, Math.PI * 2); x.stroke();
    } else if (kind === 'quake') {
      for (let i = 0; i < 3; i++) { const f = (frame / 12 + i / 3) % 1; x.globalAlpha = 1 - f * .7; x.beginPath(); x.ellipse(0, 10, 10 + f * 31, 5 + f * 12, 0, 0, Math.PI * 2); x.stroke(); } x.globalAlpha = 1; line([[-18,-30],[-4,-12],[-14,0],[8,13],[0,31],[18,8],[2,-6],[11,-17]]);
    } else if (kind === 'fire' || kind === 'heat') {
      if (kind === 'heat') { for(let j=-1;j<=1;j++){x.beginPath();x.moveTo(j*18,28);x.bezierCurveTo(j*18-14,10,j*18+14,-10,j*18+Math.sin(t+j)*6,-31);x.stroke();} }
      else { poly([[-28,24],[-32,3],[-17,-11],[-14,4],[3,-38],[14,-10],[24,-20],[33,8],[24,30],[0,38]]); x.fillStyle='#fff0b4';poly([[-12,23],[1,-6],[17,23],[8,35],[-5,35]]); }
    } else if (kind === 'volcano' || kind === 'landslide' || kind === 'ice') {
      poly([[-38,30],[-12,-12],[7,-15],[39,30]]);x.strokeStyle='#f0e3ce';line([[-12,-12],[-3,2],[7,-15]]);
      if(kind==='volcano'){x.fillStyle='#b2a69f';for(let i=0;i<4;i++){x.globalAlpha=.85-i*.12;x.beginPath();x.ellipse(Math.sin(t+i)*4,-20-i*8,9+i*5,7,0,0,Math.PI*2);x.fill();}}
      if(kind==='landslide'){x.fillStyle='#f5d6a2';for(let i=0;i<5;i++){const y=((i*13+frame*2)%44)-6;x.fillRect(13+y*.5,y,7,7);}}
      if(kind==='ice'){x.fillStyle='#f1ffff';poly([[-12,-12],[-3,2],[7,-15],[2,17],[-24,14]]);}
    } else if (['flood','wave','tide'].includes(kind)) {
      for(let i=0;i<3;i++){x.beginPath();for(let j=0;j<=64;j++){const p=[j-32,Math.sin(j/9+t)*5+i*13-6];j?x.lineTo(...p):x.moveTo(...p);}x.stroke();}
      if(kind==='flood'){line([[-25,-17],[-10,-31],[5,-17]]);line([[-21,-17],[-21,-5]]);}
      if(kind==='tide'){line([[0,-38],[0,24]]);for(let y=-30;y<0;y+=10)line([[0,y],[9,y]]);}
    } else if (['storm','rain','snow'].includes(kind)) {
      cloud(-17);if(kind==='storm'){x.fillStyle='#ffe3a0';poly([[2,-8],[-12,16],[0,16],[-5,37],[20,4],[7,4],[15,-8]]);}
      else for(let i=0;i<3;i++){const y=4+(i*11+frame*3)%28,c=(i-1)*21;if(kind==='rain')line([[c,y],[c-5,y+9]]);else{line([[c-5,y],[c+5,y]]);line([[c,y-5],[c,y+5]]);}}
    } else if (kind === 'wind' || kind === 'dust') {
      for(let i=0;i<3;i++){const y=(i-1)*17;x.beginPath();x.moveTo(-33+Math.sin(t+i)*5,y);x.bezierCurveTo(20,y,40,y-18,23,y-22);x.stroke();}if(kind==='dust'){x.fillStyle=color;for(let i=0;i<8;i++)x.fillRect((i*17+frame*4)%65-32,(i*29)%55-20,3,3);}
    } else if(kind==='vessel'){poly([[-32,8],[34,8],[21,29],[-20,29]]);x.fillRect(-17,-12,33,15);x.fillRect(-4,-28,13,14);x.strokeStyle='#d2fff4';line([[-29,35],[-15,39],[0,35],[15,39],[29,35]]);}
    else if(kind==='aircraft'){poly([[0,-40],[7,-29],[7,-5],[37,14],[37,22],[7,12],[7,29],[18,36],[18,40],[0,35],[-18,40],[-18,36],[-7,29],[-7,12],[-37,22],[-37,14],[-7,-5],[-7,-29]]);}
    else if(kind==='camera'){x.strokeRect(-32,-19,64,43);x.beginPath();x.arc(0,2,14,0,Math.PI*2);x.stroke();line([[-19,-19],[-12,-30],[12,-30],[19,-19]]);}
    else if(kind==='launch'){poly([[0,-36],[14,-16],[14,13],[26,29],[11,25],[0,34],[-11,25],[-26,29],[-14,13],[-14,-16]]);x.fillStyle='#182a3b';x.beginPath();x.arc(0,-8,6,0,Math.PI*2);x.fill();}
    else if(kind==='mission'){line([[-23,38],[-23,-36],[29,-36],[19,-19],[29,-2],[-23,-2]]);}
    else if(kind==='person'){x.beginPath();x.arc(0,-20,12,0,Math.PI*2);x.stroke();x.beginPath();x.arc(0,27,26,Math.PI,0);x.stroke();}
    else if(kind==='evidence'){x.strokeRect(-25,-34,50,68);line([[-14,-15],[13,-15]]);line([[-14,0],[13,0]]);line([[-14,16],[2,16]]);}
    else{line([[0,-36],[36,29],[-36,29],[0,-36]]);line([[0,-14],[0,9]]);x.beginPath();x.arc(0,20,2,0,Math.PI*2);x.fill();}
    cache.set(key, canvas);return canvas;
  }
  function create(C, viewer) {
    const sets = new Map(), models = new Map();let alive = true, lastTick = 0, selected = null, animated = true, density = 48, active = [], lastSelect = -Infinity, frame = -1;
    const reduce = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    const color = (kind, a=1) => C.Color.fromCssColorString(TYPES[kind][1]).withAlpha(a);
    function removeModel(key){const m=models.get(key);if(m)m.entities.forEach(e=>viewer.entities.remove(e));models.delete(key);}
    function keyFor(layer,item){return layer+':'+(item.id||item.hex||item.mmsi||item.lon+','+item.lat);}
    function clear(layer){const s=sets.get(layer);if(!s)return;viewer.scene.primitives.remove(s.symbols);s.areas.forEach(e=>viewer.entities.remove(e));for(const r of s.rows)removeModel(r.key);sets.delete(layer);lastSelect=-Infinity;}
    function setLayer(layer, items){
      clear(layer);const symbols=viewer.scene.primitives.add(new C.BillboardCollection()),rows=[],areas=[];
      for(const [i,item] of items.entries()){
        if(!valid(item)||expired(item))continue;const kind=kindFor(layer,item),key=keyFor(layer,item,i),pick={haloPick:true,layer,item};
        const position=C.Cartesian3.fromDegrees(item.lon,item.lat,layer==='military'?Math.max(0,item.alt??0):60);
        const symbolSize=kind==='aircraft'?28:['tornado','cyclone','volcano'].includes(kind)?42:30;
        const b=symbols.add({position,imageId:'halo-event:'+kind+':0',image:symbol(kind),width:symbolSize,height:symbolSize,id:pick,scaleByDistance:new C.NearFarScalar(3e5,1.25,2e7,.7)});
        const heading=kind==='aircraft'?item.track:kind==='vessel'?(item.heading??item.cog):null;
        if(Number.isFinite(heading)){const enu=C.Transforms.eastNorthUpToFixedFrame(position);b.alignedAxis=new C.Cartesian3(enu[4],enu[5],enu[6]);b.rotation=-C.Math.toRadians(heading);}
        rows.push({key,kind,item,pick,position,b});
        // Reported polygon with its holes. No generated storm or damage extent.
        for(const poly of (item.polygons||[]).slice(0,8)){
          if(areas.length>=256)break;
          const hierarchy=new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(poly[0].flat()),poly.slice(1).map(r=>new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(r.flat()))));
          const e=viewer.entities.add({polygon:{hierarchy,material:color(kind,.15),outline:true,outlineColor:color(kind,.8)}});e.haloObjectPick=pick;e.haloEventExpires=item.expires_at;areas.push(e);
        }
      }
      sets.set(layer,{symbols,rows,areas});lastSelect=-Infinity;viewer.scene.requestRender();
    }
    const unitFor=r=>Math.max(250,Math.min(16000,C.Cartesian3.distance(viewer.camera.positionWC,r.position)*.022));
    function makeModel(r){
      const entities=[],origin=C.Transforms.eastNorthUpToFixedFrame(r.position),unit=unitFor(r);
      const pos=(x,y,z)=>C.Matrix4.multiplyByPoint(origin,new C.Cartesian3(x*unit,y*unit,z*unit),new C.Cartesian3());
      const add=(x,y,z,shape)=>{const heading=r.kind==='vessel'?(r.item.heading??r.item.cog??0):0,position=pos(x,y,z);if(shape.ellipsoid)shape.ellipsoid={stackPartitions:12,slicePartitions:20,...shape.ellipsoid};const e=viewer.entities.add({position:new C.CallbackPositionProperty(()=>position,false),orientation:C.Transforms.headingPitchRollQuaternion(r.position,new C.HeadingPitchRoll(C.Math.toRadians(heading),0,0)),...shape});e.haloObjectPick=r.pick;entities.push(e);return e;};
      const parts=[];
      if(r.kind==='tornado'){
        for(let i=0;i<8;i++){const h=.15+i*.23,rad=.08+i*.085;parts.push({e:add(0,0,h,{ellipsoid:{radii:new C.Cartesian3(rad*unit,rad*unit,.16*unit),material:C.Color.fromCssColorString(i<3?'#7e7369':'#c4c6c9').withAlpha(.88)}}),i});}
        add(0,0,2.15,{ellipsoid:{radii:new C.Cartesian3(unit,unit,.3*unit),material:C.Color.fromCssColorString('#c3c8d0').withAlpha(.8)}});
      } else if(r.kind==='cyclone'){
        for(let i=0;i<18;i++){const a=i*2.4,rad=.18+i*.045;parts.push({e:add(Math.cos(a)*rad,Math.sin(a)*rad,.1,{ellipsoid:{radii:new C.Cartesian3(.23*unit,.14*unit,.08*unit),material:color('cyclone',.75)}}),i,a,rad});}
      } else if(['quake','flood','wave','tide'].includes(r.kind)){
        for(let i=0;i<3;i++){parts.push({e:add(0,0,.008,{ellipse:{semiMajorAxis:unit*(i+1)/3,semiMinorAxis:unit*(i+1)/3,fill:false,outline:true,outlineColor:color(r.kind,.9),height:100}}),i});}
        if(r.kind==='tide')add(0,0,.3,{cylinder:{length:unit*.6,topRadius:unit*.04,bottomRadius:unit*.1,material:color('tide')}});
      } else if(['storm','rain','snow'].includes(r.kind)){
        for(let i=0;i<3;i++)add((i-1)*.38,0,1.25,{ellipsoid:{radii:new C.Cartesian3(unit*.46,unit*.3,unit*.23),material:C.Color.fromCssColorString(r.kind==='snow'?'#d9e2ea':'#68798a').withAlpha(.9)}});
        if(r.kind==='storm'){
          const e=viewer.entities.add({polyline:{positions:[pos(.1,0,1.1),pos(-.2,0,.6),pos(.12,0,.65),pos(-.12,0,.1)],width:4,material:C.Color.fromCssColorString('#ffe2a1')}});e.haloObjectPick=r.pick;entities.push(e);parts.push({e,i:0,lightning:true});
        } else for(let i=0;i<10;i++)parts.push({e:add((i%5-2)*.23,Math.floor(i/5)*.3-.15,.3+(i%4)*.2,{ellipsoid:{radii:new C.Cartesian3(unit*.018,unit*.018,unit*(r.kind==='rain'?.14:.018)),material:color(r.kind)}}),i,precip:true});
      } else if(['wind','heat','dust'].includes(r.kind)){
        for(let i=0;i<3;i++){
          const e=viewer.entities.add({polyline:{positions:Array.from({length:16},(_,j)=>pos((j-8)*.12,(i-1)*.28,.3+Math.sin(j*.5)*.1)),width:r.kind==='dust'?6:3,material:color(r.kind,.7)}});e.haloObjectPick=r.pick;entities.push(e);parts.push({e,i,flow:true});
        }
      } else if(['fire','volcano'].includes(r.kind)){
        if(r.kind==='volcano')add(0,0,.33,{cylinder:{length:unit*.66,topRadius:unit*.16,bottomRadius:unit*.75,material:C.Color.fromCssColorString('#62504c')}});
        for(let i=0;i<6;i++){parts.push({e:add(Math.sin(i*2)*.12,Math.cos(i*2)*.12,.3+i*.23,{ellipsoid:{radii:new C.Cartesian3(unit*(.13+i*.04),unit*(.13+i*.04),unit*.2),material:i<2?color(r.kind,.9):C.Color.fromCssColorString('#8c8b89').withAlpha(.6-i*.055)}}),i});}
      } else if(r.kind==='vessel'){
        add(0,0,.08,{ellipsoid:{radii:new C.Cartesian3(unit*.2,unit*.65,unit*.12),material:color('vessel')}});
        add(0,-.2,.23,{box:{dimensions:new C.Cartesian3(unit*.3,unit*.35,unit*.3),material:C.Color.WHITE}});
      } else if(r.kind==='aircraft' && Number.isFinite(r.item.alt)){
        const e=add(0,0,0,{model:{uri:'assets/3d/halo/airplane.glb',minimumPixelSize:70,maximumScale:300}});e.orientation=C.Transforms.headingPitchRollQuaternion(r.position,new C.HeadingPitchRoll(C.Math.toRadians((r.item.track||0)+180),0,0));
      } else if(['ice','landslide'].includes(r.kind)) add(0,0,.25,{ellipsoid:{radii:new C.Cartesian3(unit*.7,unit*.4,unit*.4),material:color(r.kind)}});
      // Dynamic properties update an existing object. Reassigning constant
      // geometry every frame repeatedly restarts Cesium's asynchronous build.
      for(const p of parts){
        if(p.e.position){p.position=p.e.position.getValue(viewer.clock.currentTime);p.e.position=new C.CallbackPositionProperty(()=>p.position,false);}
        if(p.e.ellipse){p.radius=unit*(p.i+1)/3;p.tint=color(r.kind,.9);p.e.ellipse.semiMajorAxis=new C.CallbackProperty(()=>p.radius,false);p.e.ellipse.semiMinorAxis=new C.CallbackProperty(()=>p.radius,false);p.e.ellipse.outlineColor=new C.CallbackProperty(()=>p.tint,false);}
        if(p.flow){p.positions=p.e.polyline.positions.getValue(viewer.clock.currentTime);p.e.polyline.positions=new C.CallbackProperty(()=>p.positions,false);}
      }
      return {entities,parts,pos,unit,kind:r.kind};
    }
    function selectRows(){
      const occluder=new C.EllipsoidalOccluder(C.Ellipsoid.WGS84,viewer.camera.positionWC),pool=[];
      for(const s of sets.values())for(const e of s.areas)e.show=!expired({expires_at:e.haloEventExpires});
      for(const s of sets.values())for(const r of s.rows){r.b.show=!expired(r.item);if(r.b.show&&occluder.isPointVisible(r.position))pool.push({r,d:C.Cartesian3.distance(viewer.camera.positionWC,r.position)});}
      pool.sort((a,b)=>(b.r.key===selected)-(a.r.key===selected)||a.d-b.d||a.r.key.localeCompare(b.r.key));
      active=pool.slice(0,density).map(x=>x.r);
      const wanted=new Set(pool.filter(x=>x.r.key===selected||x.d<1.8e6).slice(0,Math.min(MODEL_CAP,density)).map(x=>x.r.key));
      for(const key of models.keys())if(!wanted.has(key))removeModel(key);
      for(const {r} of pool.slice(0,MODEL_CAP))if(wanted.has(r.key)){
        const old=models.get(r.key),unit=unitFor(r);
        if(old&&(unit>old.unit*1.5||unit<old.unit/1.5))removeModel(r.key);
        if(!models.has(r.key))models.set(r.key,makeModel(r));
      }
      // Nearby procedural geometry replaces its far symbol. Keep the fallback
      // for GLB aircraft while the external asset is loading.
      for(const {r} of pool){const m=models.get(r.key);if(m?.entities.length&&m.kind!=='aircraft')r.b.show=false;}
    }
    function tick(){
      if(!alive||document.hidden)return;const now=performance.now();if(now-lastTick<33)return;lastTick=now;
      if(now-lastSelect>650){lastSelect=now;selectRows();}
      const moving=animated&&!reduce?.matches,f=moving?Math.floor(now/100)%12:0;
      // Stable IDs share twelve atlas entries per family, even across thousands
      // of observations. Assigning a canvas to .image generates a new GUID.
      if(frame!==f){frame=f;for(const r of active)r.b.setImage('halo-event:'+r.kind+':'+f,symbol(r.kind,f));}
      const t=moving?now/1000:0;
      for(const m of models.values())for(const p of m.parts){
        if(p.lightning)p.e.show=!moving||Math.floor(t)%4===0;
        else if(p.precip)p.position=m.pos((p.i%5-2)*.23+(m.kind==='snow'?Math.sin(t+p.i)*.08:0),Math.floor(p.i/5)*.3-.15,1.15-((t*(m.kind==='rain'?.7:.2)+p.i*.1)%1));
        else if(p.flow)p.positions=Array.from({length:16},(_,j)=>m.kind==='heat'?m.pos((p.i-1)*.3+Math.sin(j*.5-t)*.08,0,j*.08):m.pos((j-8)*.12,(p.i-1)*.28+Math.sin(j*.5-t)*.08,.3+Math.sin(j*.5-t)*.1));
        else if(m.kind==='tornado')p.position=m.pos(Math.sin(t*2+p.i*.7)*.04*p.i,Math.cos(t*2+p.i*.7)*.04*p.i,.15+p.i*.23);
        else if(m.kind==='cyclone'){const a=p.a+t*.2;p.position=m.pos(Math.cos(a)*p.rad,Math.sin(a)*p.rad,.1);}
        else if(['quake','flood','wave','tide'].includes(m.kind)){const q=(t*.23+p.i/3)%1;p.radius=m.unit*(.12+q);p.tint=color(m.kind,1-q*.85);}
        else p.position=m.pos(Math.sin(t+p.i)*.12,Math.cos(t+p.i)*.12,.3+p.i*.23+Math.sin(t*1.5+p.i)*.08);
      }
    }
    viewer.scene.preRender.addEventListener(tick);
    const clock=setInterval(()=>{if(alive&&!document.hidden&&(sets.size>0)&&((animated&&!reduce?.matches&&density>0)||performance.now()-lastSelect>1000))viewer.scene.requestRender();},100);
    return Object.freeze({setLayer,clear,select(layer,item){selected=item?keyFor(layer,item,0):null;lastSelect=-Infinity;},setAnimated(on){animated=!!on;frame=-1;viewer.scene.requestRender();},setDensity(n){density=Math.max(0,Math.min(MOTION_CAP,Math.floor(Number(n)||0)));lastSelect=-Infinity;},stats(){return {families:Object.keys(TYPES),types:[...new Set([...sets.values()].flatMap(s=>s.rows.map(r=>r.kind)))],loaded:[...sets.values()].reduce((n,s)=>n+s.rows.length,0),animated:!animated||reduce?.matches?0:active.length,models:models.size,modelCap:MODEL_CAP,motionCap:MOTION_CAP};},destroy(){alive=false;clearInterval(clock);viewer.scene.preRender.removeEventListener(tick);for(const id of [...sets.keys()])clear(id);}});
  }
  root.HaloEvents=Object.freeze({TYPES,MOTION_CAP,MODEL_CAP,kindFor,valid,expired,symbol,create});
})(typeof window==='undefined'?globalThis:window);
