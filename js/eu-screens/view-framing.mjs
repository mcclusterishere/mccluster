/* Equity Uprise camera/presentation math only. Authored geometry, transforms and identities are never changed. */
export function usableViewport(width, height, obstructions = [], gap = 12) {
  let spaces = [{left:gap,top:gap,right:width-gap,bottom:height-gap}];
  for (const raw of obstructions) {
    if (!(raw.right > raw.left && raw.bottom > raw.top)) continue;
    const o = {left:raw.left-gap,top:raw.top-gap,right:raw.right+gap,bottom:raw.bottom+gap};
    spaces = spaces.flatMap(r => {
      if (o.right <= r.left || o.left >= r.right || o.bottom <= r.top || o.top >= r.bottom) return [r];
      return [{...r,right:Math.min(r.right,o.left)},{...r,left:Math.max(r.left,o.right)},
        {...r,bottom:Math.min(r.bottom,o.top)},{...r,top:Math.max(r.top,o.bottom)}]
        .filter(s => s.right-s.left >= 80 && s.bottom-s.top >= 80);
    });
  }
  const r = spaces.sort((a,b)=>(b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
  if (!r) throw new Error('No unobstructed camera viewport');
  return {...r,width:r.right-r.left,height:r.bottom-r.top};
}

export function boxCorners(THREE, box) {
  const out=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])out.push(new THREE.Vector3(x,y,z));
  return out;
}

export function visibleWorldBounds(THREE, root, ceilingY = Infinity) {
  const box=new THREE.Box3();root.updateMatrixWorld(true);
  function visit(o) {
    if (!o.visible) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (b.min.y<=ceilingY) {b.max.y=Math.min(b.max.y,ceilingY);box.union(b);}
    }
    for(const child of o.children)visit(child);
  }
  visit(root);return box;
}

function axes(THREE, direction) {
  const back=direction.clone().normalize(),right=new THREE.Vector3(0,1,0).cross(back).normalize();
  return {back,right,up:back.clone().cross(right).normalize()};
}

export function applyCameraViewport(camera, width, height, rect) {
  camera.aspect=width/height;
  camera.setViewOffset(width,height,width/2-(rect.left+rect.right)/2,height/2-(rect.top+rect.bottom)/2,width,height);
  camera.updateProjectionMatrix();
}

export function fitPerspectiveBox(THREE, {camera,controls,box,width,height,rect,direction=[.72,1.05,.82],fov=52,pad=1.08}) {
  if (box.isEmpty()) throw new Error('Cannot frame empty authored bounds');
  const center=box.getCenter(new THREE.Vector3()),basis=axes(THREE,new THREE.Vector3(...direction));
  const tanY=Math.tan(fov*Math.PI/360)*rect.height/height/pad;
  const tanX=Math.tan(fov*Math.PI/360)*(width/height)*rect.width/width/pad;
  let distance=.1;
  for(const corner of boxCorners(THREE,box)) {
    const delta=corner.sub(center),z=delta.dot(basis.back);
    distance=Math.max(distance,z+Math.abs(delta.dot(basis.right))/tanX,z+Math.abs(delta.dot(basis.up))/tanY);
  }
  distance=Math.max(distance,controls.minDistance||0);
  controls.maxDistance=Math.max(controls.maxDistance||0,distance*1.1);
  camera.fov=fov;camera.position.copy(center).addScaledVector(basis.back,distance);
  controls.target.copy(center);camera.lookAt(center);camera.near=.02;camera.far=Math.max(128,distance+box.getSize(new THREE.Vector3()).length()*4);
  applyCameraViewport(camera,width,height,rect);controls.update();camera.updateMatrixWorld(true);
  return {distance,target:center.toArray(),rect};
}

// A bounded human-scale detail camera may need a wider lens, rather than retreating through a wall.
export function fovForPosition(THREE, {box,position,width,height,rect,pad=1.08}) {
  const center=box.getCenter(new THREE.Vector3()),direction=position.clone().sub(center),distance=direction.length(),basis=axes(THREE,direction);
  let tan=0;
  for(const corner of boxCorners(THREE,box)) {
    const delta=corner.sub(center),depth=distance-delta.dot(basis.back);
    if(depth<=.03)return Infinity;
    tan=Math.max(tan,Math.abs(delta.dot(basis.right))/depth/(rect.width/width)/(width/height),
      Math.abs(delta.dot(basis.up))/depth/(rect.height/height));
  }
  return 2*Math.atan(tan*pad)*180/Math.PI;
}

export function floorCutawayHeight({focus,room,plant,xray,services,cabling}) {
  return /^[0-6]$/.test(String(focus))&&!room&&!plant&&!xray&&!services&&!cabling ?
    (Number(focus)-1)*13.5*.3048+7.5*.3048 : null;
}
