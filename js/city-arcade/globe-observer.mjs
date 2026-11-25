export function observeArcadeView(viewer,Cesium,tell){
 let timer=null;
 const report=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(viewer.isDestroyed())return;const canvas=viewer.scene.canvas;
  const p=viewer.camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth/2,canvas.clientHeight/2),viewer.scene.globe.ellipsoid);
  const c=p?Cesium.Cartographic.fromCartesian(p):viewer.camera.positionCartographic;
  tell({type:'arcade:view',lon:Cesium.Math.toDegrees(c.longitude),lat:Cesium.Math.toDegrees(c.latitude),height:viewer.camera.positionCartographic.height});
 },150);};
 viewer.camera.moveEnd.addEventListener(report);report();
 return ()=>{clearTimeout(timer);if(!viewer.isDestroyed())viewer.camera.moveEnd.removeEventListener(report);};
}
