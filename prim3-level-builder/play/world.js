(function (root) {
  'use strict';
  const buildings = [
    {id:'west-depot',x:-36,y:-8,w:20,d:20,h:8},
    {id:'east-terminal',x:16,y:6,w:20,d:20,h:8},
    {id:'north-tower',x:-44,y:24,w:20,d:20,h:16},
    {id:'control-block',x:-10,y:28,w:24,d:16,h:12},
    {id:'south-warehouse',x:26,y:-50,w:18,d:16,h:6},
    {id:'arrival-depot',x:-52,y:-50,w:16,d:16,h:6},
    {id:'east-service',x:42,y:30,w:14,d:16,h:10}
  ];
  const canal={x:-56,y:-28,w:112,d:7};
  const groundBridges=[{x:-26,y:-29,w:10,d:9},{x:4,y:-29,w:9,d:9},{x:36,y:-29,w:9,d:9}];
  const bridges=[{id:'skybridge',x:-17,y:8,w:35,d:4,h:8}];
  const stairs=[
    {id:'west-stairs',from:{x:-25,y:-17,layer:0},to:{x:-25,y:-7,layer:1},width:4,cost:14},
    {id:'east-stairs',from:{x:43,y:12,layer:0},to:{x:34,y:12,layer:1},width:4,cost:13},
    {id:'north-stairs',from:{x:-51,y:32,layer:0},to:{x:-43,y:32,layer:1},width:4,cost:20},
    {id:'control-stairs',from:{x:6,y:51,layer:0},to:{x:6,y:42,layer:1},width:4,cost:16},
    {id:'south-stairs',from:{x:50,y:-42,layer:0},to:{x:42,y:-42,layer:1},width:4,cost:11}
  ];
  const boxes=[];
  function box(id,x,y,w,d,h,type,color){boxes.push({id,x,y,z:0,w,d,h,type,color});}
  box('barricade-a',-14,-18,7,1,1.25,'cover');
  box('barricade-b',1,-17,6,1,1.25,'cover');
  box('barricade-c',-12,-5,6,1,1.25,'cover');
  box('barricade-d',4,5,7,1,1.25,'cover');
  box('barricade-e',-6,13,7,1,1.25,'cover');
  box('barricade-f',11,-4,1,6,1.25,'cover');
  box('container-west',-48,-16,9,4,3,'container','#97583e');
  box('container-east',25,-17,11,4,3,'container','#97583e');
  box('container-north',-19,27,6,4,3,'container','#596b70');
  box('container-south',2,-44,9,4,3,'container','#9b6147');
  box('crate-1',-30,-35,3,3,1.8,'crate');
  box('crate-2',-30,-32,3,2,1.15,'crate');
  box('crate-3',-10,-32,3,3,1.7,'crate');
  box('crate-4',-6,-20,2,2,1.5,'crate');
  box('crate-5',19,-13,3,3,1.6,'crate');
  box('crate-6',-20,18,3,3,1.5,'crate');
  box('crate-7',38,-8,3,3,1.6,'crate');
  box('crate-8',-3,20,3,3,1.5,'crate');
  box('crate-9',-49,3,4,3,1.9,'crate');
  box('crate-10',17,-40,3,3,1.5,'crate');
  box('fence-west',-10,-12,9,1,2.15,'fence');
  box('fence-east',2,-12,9,1,2.15,'fence');
  const gate={id:'service-gate',x:0,y:-12,w:3,d:1,h:2.15};
  const relay={id:'relay',x:0,y:0,layer:0};
  const evac={x:-20,y:-40,r:9};
  const medkit={x:-10,y:-19,layer:0};
  const inRect=(p,r)=>p.x>=r.x && p.x<r.x+r.w && p.y>=r.y && p.y<r.y+r.d;
  const key=p=>`${p.x},${p.y},${p.layer||0}`;
  const same=(a,b)=>a.x===b.x&&a.y===b.y&&(a.layer||0)===(b.layer||0);
  function roofAt(p){return bridges.find(b=>inRect(p,b))||buildings.find(b=>inRect(p,b));}
  function heightAt(p){if(!(p.layer||0))return 0;const r=roofAt(p);return r?r.h:0;}
  function valid(p){return p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=-64&&p.x<=63&&p.y>=-64&&p.y<=63&&(p.layer===0||p.layer===1||p.layer===undefined);}
  function gateRect(){return{x:gate.x-1,y:gate.y,w:3,d:1};}
  function canStand(p,gateOpen=false){
    if(!valid(p))return false;
    if(p.layer===1)return !!roofAt(p);
    if(buildings.some(b=>inRect(p,b)))return false;
    if(inRect(p,canal)&&!groundBridges.some(b=>inRect(p,b)))return false;
    if(boxes.some(b=>inRect(p,b)))return false;
    if(!gateOpen&&inRect(p,gateRect()))return false;
    if(p.x===relay.x&&p.y===relay.y)return false;
    return true;
  }
  function neighbors(p,gateOpen=false){
    const out=[];
    for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
      const n={x:p.x+dx,y:p.y+dy,layer:p.layer||0,cost:1};
      if(canStand(n,gateOpen)&&Math.abs(heightAt(n)-heightAt(p))<.6)out.push(n);
    }
    for(const s of stairs){
      if(same(p,s.from)&&canStand(s.to,gateOpen))out.push({...s.to,cost:s.cost,stair:s.id});
      if(same(p,s.to)&&canStand(s.from,gateOpen))out.push({...s.from,cost:s.cost,stair:s.id});
    }
    return out;
  }
  function coverAt(p){
    if(p.layer===1){const b=roofAt(p);if(b&&(p.x===b.x||p.y===b.y||p.x===b.x+b.w-1||p.y===b.y+b.d-1))return 1;}
    for(const b of boxes){
      const dx=Math.max(b.x-p.x,0,p.x-(b.x+b.w-1));
      const dy=Math.max(b.y-p.y,0,p.y-(b.y+b.d-1));
      if(!p.layer&&dx+dy<=2)return 1;
    }
    return 0;
  }
  function blocksSight(a,b,gateOpen=false){
    const ax=a.x+.5,ay=a.y+.5,bx=b.x+.5,by=b.y+.5;
    const ah=heightAt(a)+1.55,bh=heightAt(b)+1.55;
    const steps=Math.max(2,Math.ceil(Math.hypot(bx-ax,by-ay)*2));
    for(let i=1;i<steps;i++){
      const t=i/steps,p={x:ax+(bx-ax)*t,y:ay+(by-ay)*t},h=ah+(bh-ah)*t;
      if(buildings.some(r=>inRect(p,r)&&h<r.h+.1))return true;
      if(boxes.some(r=>inRect(p,r)&&h<r.h))return true;
      if(!gateOpen&&inRect(p,gateRect())&&h<gate.h)return true;
      if(bridges.some(r=>inRect(p,r)&&h>=r.h-.45&&h<=r.h+.15))return true;
    }
    return false;
  }
  const level={id:'transit-relay-v1',title:'Transit / Black Signal',bounds:{min:-64,max:63},buildings,boxes,stairs,bridges,canal,groundBridges,relay,evac,gate,medkit,heightAt,canStand,neighbors,coverAt,blocksSight,key,roofAt};
  root.P3Level=level;
  if(typeof module!=='undefined'&&module.exports)module.exports=level;
})(typeof window!=='undefined'?window:globalThis);
