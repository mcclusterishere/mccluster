import {regionPolicies} from './region-policies.mjs';
export function eligibleView(view,{active=false,policy=regionPolicies['bridgeport-golden-hill.v1']}={}) {
  if(!view||![view.lon,view.lat,view.height].every(Number.isFinite))return false;
  const {anchor,gating:g}=policy;
  const distance=Math.hypot((view.lon-anchor.lon)*111320*Math.cos(anchor.lat*Math.PI/180),(view.lat-anchor.lat)*111320);
  return view.height>=0&&view.height<=(active?g.exitCameraHeightM:g.enterCameraHeightM)&&distance<=(active?g.exitRadiusM:g.centerRadiusM);
}
// Abort and generation identity are both needed: sources may resolve after abort.
export function regionGate({load,attach,detach,onError=()=>{},policy=()=>regionPolicies['bridgeport-golden-hill.v1']}){
  let generation=0,controller=null,value=null,wanted=false,failed=false;
  return {
    update({owner,entered,view}){
      const next=owner&&entered&&eligibleView(view,{active:!!value||!!controller,policy:policy()});
      if(!next){wanted=false;failed=false;generation++;controller?.abort();controller=null;if(value){detach(value);value=null;}return;}
      wanted=true;if(value||controller||failed)return;const token=++generation,c=new AbortController();controller=c;
      Promise.resolve().then(()=>load(c.signal)).then(result=>{if(token!==generation||c.signal.aborted||!wanted)return;controller=null;value=result;attach(result);}).catch(error=>{if(token!==generation||c.signal.aborted)return;controller=null;wanted=false;failed=true;if(value){detach(value);value=null;}onError(error);});
    },
    dispose(){this.update({owner:false});},
    status(){return {loading:!!controller,attached:!!value,generation};}
  };
}
