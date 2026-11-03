/* Local-coordinate equipment inspection, not new room geometry. Canonical computer IDs and mm part envelopes
   drive picking; the view never changes simulation state. Three is supplied by the existing site vendor. */
export function visibleComponent(object) {
  let selected = null;
  for (let node = object; node; node = node.parent) {
    if (node.visible === false) return null;
    if (selected === null && node.userData?.component) selected = node.userData.component;
  }
  return selected;
}

export function createComputerView(THREE, el, { device, onPick = () => {} }) {
  const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5)); renderer.setClearColor(0xe5ebed);
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.4;
  renderer.domElement.setAttribute('aria-label','Interactive equipment; drag to orbit, select a component or use the component list.');
  el.append(renderer.domElement);
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(42,1,0.01,20), group=new THREE.Group(); scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff,0x707477,3));
  const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(2,4,2);scene.add(light);
  const rim=new THREE.DirectionalLight(0xcfefff,2);rim.position.set(-2,2,-2);scene.add(rim);
  const mats={}, components=new Map(), fans=[], ledParts=[];
  function mat(name,color,metal=0){return mats[name] ||= new THREE.MeshStandardMaterial({color,metalness:metal,roughness:0.5});}
  const steel=mat('steel',0x9ca8af,0.65), body=mat('body',0x26343e,0.45), pcb=mat('pcb',0x185d4b), dark=mat('dark',0x111a20), pale=mat('pale',0xf2f4f5,0.2), gold=mat('gold',0xc29b47,0.6);
  const size=device.geometry.chassis_mm, W=size.w/1000,H=size.h/1000,D=size.d/1000;
  const benchY=0.04;
  function box(w,h,d,m,x,y,z,parent=group,pick=null){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);if(pick)mesh.userData.component=pick;parent.add(mesh);return mesh;}
  box(Math.max(1.05,W+0.4),0.035,Math.max(1.05,D+0.5),pale,0,0,0);
  const chassis=new THREE.Group();chassis.position.set(-W/2,benchY,D/2);group.add(chassis);
  box(W,0.002,D,steel,W/2,0,-D/2,chassis);
  box(0.002,H,D,body,0,H/2,-D/2,chassis);box(0.002,H,D,body,W,H/2,-D/2,chassis);
  box(W,H,0.002,body,W/2,H/2,-D,chassis);
  const lid=box(W,0.002,D,pale,W/2,H,-D/2,chassis,'COVER');
  const faceHeight=device.server?0.015:H;
  box(W,faceHeight,0.012,body,W/2,device.server?H-faceHeight/2:H/2,0,chassis);
  for(let n=0;n<14;n++)box(0.002,Math.min(H*0.5,0.08),0.013,dark,0.02+n*(W-0.13)/14,H/2,0.002,chassis);
  box(0.012,0.012,0.006,pale,W-0.035,H-0.022,0.009,chassis,'POWER');
  const lamp=box(0.005,0.005,0.003,new THREE.MeshBasicMaterial({color:0x3ddc97}),W-0.018,H-0.022,0.012,chassis);ledParts.push(lamp);
  for(let i=0;i<2;i++)box(0.014,0.006,0.007,dark,W-0.06,H-0.018-i*0.013,0.009,chassis,'USB'+i);
  for(const p of device.parts){
    const [x,y,z,w,h,d]=p.box_mm.map(v=>v/1000),g=new THREE.Group();
    g.position.set(x+w/2,y+h/2,-z-d/2);g.userData.component=p.id;chassis.add(g);components.set(p.id,g);
    const m=p.type==='motherboard'||p.type==='m2_boot_module'||p.type==='dimm'?pcb:p.type==='cpu'?steel:p.type==='psu'?body:p.type==='heatsink'?steel:dark;
    box(w,h,d,m,0,0,0,g,p.id);
    if(p.type==='motherboard')for(let i=0;i<16;i++)box(0.012,0.002,0.018,dark,-w*0.4+(i%4)*w*0.24,0.002,-d*0.38+Math.floor(i/4)*d*0.22,g,p.id);
    if(p.type==='dimm'){
      for(let i=0;i<8;i++)box(0.002,h*0.65,0.011,dark,w/2+0.001,0,-d/2+0.012+i*d/9,g,p.id);
      box(w+0.002,0.003,d*0.94,gold,0,-h/2,0,g,p.id);
    }
    if(p.type==='heatsink'){
      const n=18,geo=new THREE.BoxGeometry(w,Math.max(0.005,h),0.0008), fins=new THREE.InstancedMesh(geo,steel,n),o=new THREE.Object3D();
      for(let i=0;i<n;i++){o.position.set(0,0.003,-d/2+(i+0.5)*d/n);o.updateMatrix();fins.setMatrixAt(i,o.matrix);}g.add(fins);
    }
    if(p.type==='psu'){
      for(let i=0;i<8;i++)box(w*0.6,0.002,0.002,dark,0,-h*0.3+i*h*0.08,-d/2-0.002,g,p.id);
      box(0.014,0.01,0.006,dark,w*0.3,0,-d/2-0.004,g,p.id);
    }
    if(p.type==='fan'){
      const rot=new THREE.Group();rot.position.z=d/2+0.001;g.add(rot);
      for(let i=0;i<7;i++){const arm=new THREE.Group();arm.rotation.z=i*Math.PI*2/7;box(w*0.32,0.004,0.004,steel,w*0.21,0,0,arm,p.id);rot.add(arm);}fans.push({rot,id:p.id});
    }
    if(p.type==='drive_sff')box(w,Math.min(h,0.07),0.005,steel,0,0,d/2,g,p.id);
  }
  const ports=new Map();
  device.ports.forEach((p,i)=>{
    const x=0.02+(i%8)*Math.min((W-0.04)/8,0.04),y=0.018+Math.floor(i/8)*0.02;
    const jack=box(p.kind==='power'?0.018:0.014,0.013,0.01,dark,x,y,-D-0.006,chassis,p.id);
    const plug=box(0.011,0.009,0.025,p.kind==='video'?steel:gold,x,y,-D-0.023,chassis,p.id);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,y,-D-0.03),new THREE.Vector3(x,y+0.015,-D-0.12),new THREE.Vector3(x+0.04,0,-D-0.16)]),new THREE.LineBasicMaterial({color:p.kind==='network'?0x237fa4:0x303c46}));chassis.add(line);
    ports.set(p.id,{jack,plug,line});
  });
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=450;const ctx=canvas.getContext('2d');
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const monitorZ=-D/2-0.16, keyZ=D/2+0.1;
  const monitor=box(0.53,0.31,0.025,body,0,0.43,monitorZ);
  box(0.04,0.17,0.025,steel,0,0.2,monitorZ);box(0.2,0.015,0.13,body,0,0.1,monitorZ+0.03);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.282),new THREE.MeshBasicMaterial({map:tex}));screen.position.set(0,0.43,monitorZ+0.016);screen.userData.component='DISPLAY';group.add(screen);
  box(0.32,0.018,0.105,body,0,0.03,keyZ);
  for(let row=0;row<5;row++)for(let col=0;col<14;col++)box(0.018,0.006,0.014,pale,-0.145+col*0.022,0.042,keyZ-0.038+row*0.019);
  box(0.05,0.018,0.08,body,0.24,0.038,keyZ+0.02);
  let angle=0.62,elevation=0.65,zoom=device.server?1.65:1.45,exploded=false,inspection=false,disposed=false,last=null,frame=0,drag=null;
  function cameraUpdate(){camera.position.set(Math.sin(angle)*zoom,Math.sin(elevation)*zoom+0.15,Math.cos(angle)*Math.cos(elevation)*zoom);camera.lookAt(0,0.19,-0.09);}
  function resize(){const w=el.clientWidth,h=Math.max(320,el.clientHeight);renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
  const ro=new ResizeObserver(resize);ro.observe(el);resize();cameraUpdate();
  function drawScreen(st){ctx.fillStyle='#101b25';ctx.fillRect(0,0,800,450);if(!st.display)return tex.needsUpdate=true;
    ctx.fillStyle='#66dfbe';ctx.font='bold 28px monospace';ctx.fillText('McCluster / SIMULATED EQUIPMENT',28,45);
    ctx.fillStyle='#f1f5f8';ctx.font='22px monospace';[device.id,st.stage,`Memory: ${st.memory_gb} GB`,st.reason||'Hardware checks passed',st.network_up?'Network links: UP':'Network links: DOWN','No live machine access'].forEach((t,i)=>ctx.fillText(t,28,100+i*48));tex.needsUpdate=true;
  }
  function update(st,s){last={st,s};lid.visible=!s.cover&&!inspection&&!exploded;
    let index=0;for(const p of device.parts){const g=components.get(p.id);g.visible=s.parts[p.id]!==false;const y=(p.box_mm[1]+p.box_mm[4]/2)/1000;g.position.y=y+(exploded?0.06+(index++%5)*0.065:0);}
    for(const [id,p] of ports){p.plug.visible=p.line.visible=!s.disconnected.includes(id);}
    lamp.material.color.setHex(!st.ac||st.stage==='OFF'?0x26343e:st.reason?0xf3a345:st.degraded?0xe8b550:0x3ddc97);drawScreen(st);
  }
  const cv=renderer.domElement;
  const ray=new THREE.Raycaster(),pt=new THREE.Vector2();
  function pointerdown(e){drag={x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,moved:false};cv.setPointerCapture(e.pointerId);}
  function pointermove(e){if(!drag)return;const dx=e.clientX-drag.px,dy=e.clientY-drag.py;drag.moved ||= Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6;angle-=dx*0.008;elevation=Math.min(1.35,Math.max(0.08,elevation+dy*0.006));drag.px=e.clientX;drag.py=e.clientY;cameraUpdate();}
  function pointerup(e){if(!drag)return;const moved=drag.moved;drag=null;if(moved)return;const b=cv.getBoundingClientRect();pt.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(pt,camera);for(const hit of ray.intersectObject(group,true)){const part=visibleComponent(hit.object);if(part){onPick(part);break;}}}
  cv.addEventListener('pointerdown',pointerdown);cv.addEventListener('pointermove',pointermove);cv.addEventListener('pointerup',pointerup);cv.addEventListener('pointercancel',()=>{drag=null;});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animate(){if(disposed)return;frame=requestAnimationFrame(animate);if(document.hidden)return;if(last&&!reduced&&last.st.ac&&last.st.stage!=='OFF')for(const f of fans)if(!last.s.faults.includes(f.id))f.rot.rotation.z+=0.12;renderer.render(scene,camera);}
  animate();
  return {update,view(which){inspection=which==='inspect';exploded=which==='explode';angle=which==='rear'?Math.PI+0.2:0.62;elevation=which==='inspect'||exploded?1.1:0.65;cameraUpdate();if(last)update(last.st,last.s);},
    capture(){renderer.render(scene,camera);return cv.toDataURL('image/png');},
    dispose(){disposed=true;cancelAnimationFrame(frame);ro.disconnect();const geos=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)materials.add(o.material);});geos.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());tex.dispose();renderer.dispose();cv.remove();},
  };
}
